# mqtt_client.py
import json
import threading
import time
from datetime import datetime
from http_client import render_placeholders
try:
    import paho.mqtt.client as mqtt
    _HAS_PAHO = True
except ImportError:
    _HAS_PAHO = False

from state import state, save_state
from devices import set_device_state
from events import trigger_events
from scenarios import run_all_scenarios
import logging
log = logging.getLogger("smarthome.mqtt")
# Глобальный клиент и статус
_client = None
_client_lock = threading.Lock()
_connected = False
_started = False


def _default_state_topic(did):
    """Дефолтный топик состояния: <base_topic>/<device_id>/state."""
    base = (state["mqtt"].get("base_topic") or "smarthome").rstrip("/")
    return f"{base}/{did}/state"


def publish_raw(topic, payload, retain=False, qos=0):
    if not (_client and _connected):
        log.info("[mqtt] publish_raw skipped (not connected): %s", topic)
        return False
    if not topic:
        return False
    try:
        if isinstance(payload, (dict, list)):
            payload = json.dumps(payload, ensure_ascii=False)
        _client.publish(topic, str(payload), retain=bool(retain), qos=int(qos))
        return True
    except Exception as e:
        log.error("[mqtt] publish_raw error: %s", e)
        return False


def publish_template(topic_tpl, payload_tpl, device_id=None, retain=False, qos=0):
    """Раскрывает плейсхолдеры в топике и payload и публикует."""
    topic = _resolve_topic(topic_tpl, device_id or "")
    if isinstance(payload_tpl, (dict, list)):
        payload = json.dumps(payload_tpl, ensure_ascii=False)
    else:
        payload = render_placeholders(str(payload_tpl or ""))
    if device_id:
        dev = state["devices"].get(device_id) or {}
        payload = payload.replace("{device_id}", device_id)
        payload = payload.replace("{device_name}", dev.get("name", ""))
        payload = payload.replace("{device_type}", dev.get("type", ""))
    return publish_raw(topic, payload, retain=retain, qos=qos)


def is_available():
    return _HAS_PAHO


def is_connected():
    return _connected


def _on_connect(client, userdata, flags, rc, properties=None):
    global _connected
    if rc == 0:
        _connected = True
        log.info("[mqtt] connected")
        _resubscribe_all(client)
        cfg = state["mqtt"]
        topic = cfg.get("status_topic") or ""
        if topic:
            client.publish(topic, "online", retain=True)
    else:
        _connected = False
        log.info("[mqtt] connect failed, rc =%s", rc)


def _on_disconnect(client, userdata, rc, properties=None):
    global _connected
    _connected = False
    log.info("[mqtt] disconnected, rc =%s", rc)


def _resolve_topic(template, did):
    """Подставляет {dev:<id>:<field>} и {device_id}/{device_name}/{device_type}."""
    if not isinstance(template, str) or not template:
        return ""
    topic = render_placeholders(template)
    dev = state["devices"].get(did) or {}
    topic = topic.replace("{device_id}", did)
    topic = topic.replace("{device_name}", dev.get("name", ""))
    topic = topic.replace("{device_type}", dev.get("type", ""))
    return topic


def _check_mqtt_triggers(topic, payload):
    for tr in state.get("mqtt_triggers", {}).values():
        if not tr.get("enabled", True):
            continue
        if tr.get("topic") != topic:
            continue
        match = tr.get("payload_match") or ""
        if match and match not in payload:
            continue
        sid = tr.get("scenario_id")
        sc = state["scenarios"].get(sid)
        if not sc:
            continue
        try:
            from scenarios import run_actions_async
            run_actions_async(
                sc.get("actions", []),
                initial_delay=sc.get("initial_delay", 0),
            )
        except Exception as e:
            log.info("[mqtt] trigger scenario error:%s", e)


def _on_message(client, userdata, msg):
    log.info("[mqtt] << %s -> %s", msg.topic, msg.payload)
    try:
        topic = msg.topic
        payload = msg.payload.decode("utf-8", "replace")
    except Exception as e:
        log.info("[mqtt] bad message:%s", e)
        return

    # KNX-мост
    try:
        from knx_client import handle_knx_message
        if handle_knx_message(topic, payload):
            return
    except Exception as e:
        log.warning("[mqtt] knx handler error: %s", e)
    # === event_bus: MQTT-сообщение ===
    try:
        import event_bus
        event_bus.publish(
            "mqtt",
            source="mqtt_client",
            mqtt={
                "topic": topic,
                "payload": payload,
                "qos": msg.qos,
                "retain": msg.retain,
            },
        )
    except Exception as e:
        log.warning("[mqtt] event_bus error: %s", e)
    # 1) триггеры сценариев по MQTT
    _check_mqtt_triggers(topic, payload)

    # 2) команда <base>/<id>/<field>/set
    if _handle_command_topic(topic, payload):
        return

    # 3) Zigbee2MQTT
    if _handle_zigbee2mqtt_message(topic, payload):
        return

    # 4) иначе ищем устройства по sub_topic
    matched = []
    for did, dev in state["devices"].items():
        raw = (dev.get("mqtt") or {}).get("sub_topic") or ""
        if not raw:
            continue
        if _resolve_topic(raw, did) == topic:
            matched.append(did)
    log.info("[mqtt] matched by sub_topic:%s", matched)
    if not matched:
        log.info("[mqtt] no device for topic %s", topic)
        return

    for did in matched:
        _handle_device_message(did, topic, payload)

def _handle_zigbee2mqtt_message(topic, payload):
    """Обрабатывает топики Zigbee2MQTT: state и availability."""
    z2m = state.get("settings", {}).get("zigbee2mqtt", {})
    if not z2m.get("enabled"):
        return False

    base = (z2m.get("base_topic") or "zigbee2mqtt").rstrip("/")

    # bridge/devices — служебный топик со списком устройств
    if topic == f"{base}/bridge/devices":
        try:
            import zigbee2mqtt as z2m_mod
            z2m_mod.mqtt_bridge_devices_payload(payload)
        except Exception as e:
            log.info("[z2m] bridge/devices handler:", e)
        return True

    # availability: <base>/<name>/availability
    prefix_av = base + "/"
    if topic.startswith(prefix_av) and topic.endswith("/availability"):
        name = topic[len(prefix_av):-len("/availability")]
        _handle_z2m_availability(name, payload)
        return True

    # state: <base>/<name>
    if topic.startswith(prefix_av):
        rest = topic[len(prefix_av):]
        if "/" in rest:
            return False          # это /set, /availability, /get и т.п.
        _handle_z2m_state(rest, payload)
        return True

    return False


def _find_device_by_z2m_name(name):
    for dev in state["devices"].values():
        if (dev.get("z2m_name") or "").strip() == name:
            return dev
    return None

def _z2m_to_ours(dev, z2m_field):
    """Сопоставляет имя поля из Z2M с именем поля в state устройства.
    Учитывает тип устройства (light → on, curtain → open)."""
    dtype = (dev.get("type") or "").lower()

    common = {
        "temperature":              "temp",
        "humidity":                 "humidity",
        "pressure":                 "pressure",
        "battery":                  "battery",
        "voltage":                  "voltage",
        "linkquality":              "linkquality",
        "illuminance":              "illuminance",
        "occupancy":                "motion",
        "water_leak":               "leak",
        "current_heating_setpoint": "target",
        "local_temperature":        "current",
        "system_mode":              "mode",
        "brightness":               "brightness",
        "position":                 "position",
    }
    if z2m_field in common:
        return common[z2m_field]

    if z2m_field == "state":
        if dtype == "curtain":
            return "open"
        # light, light_switch, fan, switch → on
        return "on"

    if z2m_field == "contact":
        return "open"

    return z2m_field

def _handle_z2m_state(name, payload):
    """Обрабатывает состояние устройства от Zigbee2MQTT.
    Мапит поля Z2M на наши, приводит значения, уведомляет SSE,
    запускает триггеры и сценарии."""
    dev = _find_device_by_z2m_name(name)
    if not dev:
        log.info(f"[mqtt] Z2M: нет устройства с z2m_name = {name!r}")
        return

    # парсим JSON
    try:
        data = json.loads(payload)
    except (ValueError, TypeError):
        data = {"_raw": payload}
    if not isinstance(data, dict):
        log.info(f"[mqtt] Z2M: payload не dict: {type(data).__name__}")
        return

    dtype = (dev.get("type") or "").lower()
    dev_state = dev.setdefault("state", {})
    changed = {}

    for z2m_k, v in data.items():
        our_k = _z2m_to_ours(dev, z2m_k)

        # --- преобразование значений ---
        if z2m_k == "state" and isinstance(v, str):
            # "ON"/"OFF" → bool
            v = v.upper() == "ON"
        elif z2m_k == "contact":
            # contact=true → закрыто → open=false
            v = not bool(v)
        elif z2m_k == "system_mode":
            v = "heat" if v == "heat" else "cool"
        elif z2m_k == "water_leak":
            v = bool(v)
        elif z2m_k == "occupancy":
            v = bool(v)

        # --- записываем в state ---
        if our_k in dev_state:
            dev_state[our_k] = _coerce_value(dev_state[our_k], v)
        else:
            # неизвестное поле: создаём как есть
            dev_state[our_k] = v

        changed[our_k] = dev_state[our_k]

    # служебные поля Z2M — не в state, а в отдельные ключи устройства
    if "linkquality" in data:
        dev["z2m_linkquality"] = data["linkquality"]

    dev["updated"] = datetime.now().isoformat(timespec="seconds")
    dev["z2m_seen"] = dev["updated"]
    save_state()

    if changed:
        # === event_bus: изменения устройств из Z2M ===
        try:
            import event_bus
            for k, v in changed.items():
                event_bus.publish(
                    "device_changed",
                    source="mqtt_client",
                    device_id=dev["id"],
                    field=k,
                    value=v,
                )
        except Exception as e:
            log.warning("[mqtt] event_bus error: %s", e)
        # SSE — мгновенное обновление UI
        try:
            from api import notify_state_changed
            notify_state_changed()
        except Exception:
            pass

        # события и сценарии
        for k, v in changed.items():
            try:
                trigger_events(dev["id"], k, v)
            except Exception as e:
                log.info("[mqtt] trigger_events error:%s", e)
        try:
            run_all_scenarios()
        except Exception as e:
            log.info("[mqtt] run_all_scenarios error:%s", e)

    log.info(f"[mqtt] Z2M state {name}: {list(changed.keys())}")


def _handle_z2m_availability(name, payload):
    dev = _find_device_by_z2m_name(name)
    if not dev:
        return
    try:
        data = json.loads(payload)
    except (ValueError, TypeError):
        data = {}
    online = (isinstance(data, dict) and data.get("state") == "online") or payload.strip() == "online"
    dev["z2m_online"] = bool(online)
    dev["updated"] = datetime.now().isoformat(timespec="seconds")
    save_state()
    log.info(f"[mqtt] Z2M availability {name}: {'online' if online else 'offline'}")

def _handle_command_topic(topic, payload):
    """Разбирает топик <base>/<device_id>/<field>/set."""
    base = (state["mqtt"].get("base_topic") or "smarthome").rstrip("/")
    parts = topic.split("/")
    if len(parts) < 4:
        return False
    if parts[-1] != "set":
        return False
    prefix = "/".join(parts[:-3])
    if prefix != base:
        return False

    did = parts[-3]
    field = parts[-2]
    dev = state["devices"].get(did)
    if not dev:
        log.info("[mqtt] command: device not found:%s", did)
        return True
    if field not in dev["state"]:
        log.info("[mqtt] command: unknown field %s", field, "for %s", did)
        return True

    value = _coerce_value(dev["state"][field], payload)

    # Специальная обработка кнопки — автосброс
    if dev.get("type") == "button" and field == "pressed":
        want_bool = value if isinstance(value, bool) else (
            str(value).strip().lower() in ("1", "true", "yes", "on", "вкл", "да", "+")
        )
        if want_bool:
            import button as button_mod
            button_mod.press(did)
            publish_device_state(did)
        else:
            if dev["state"].get("pressed") is not False:
                dev["state"]["pressed"] = False
                dev["updated"] = datetime.now().isoformat(timespec="seconds")
                save_state()
                trigger_events(did, "pressed", False)
                run_all_scenarios()
                publish_device_state(did)
        return True

    # text — обрезаем по width
    if dev.get("type") == "text" and field == "text":
        try:
            w = int(dev["state"].get("width") or 0)
            if w > 0:
                value = str(value)[:w]
        except (TypeError, ValueError):
            pass

    dev["state"][field] = value
    dev["updated"] = datetime.now().isoformat(timespec="seconds")
    save_state()
    try:
        import event_bus
        event_bus.publish(
            "device_changed",
            source="mqtt_client",
            device_id=did,
            field=field,
            value=value,
        )
    except Exception as e:
        log.warning("[mqtt] event_bus error: %s", e)
    trigger_events(did, field, value)
    run_all_scenarios()
    publish_device_state(did)
    log.info("[mqtt] command ok:%s", did, field, "=%s", value)
    # Zigbee2MQTT: если устройство привязано к Z2M — публикуем в /set
    if dev.get("z2m_name"):
        try:
            _publish_z2m_command(dev, {field: value})
        except Exception as e:
            log.info("[mqtt] Z2M publish error:%s", e)    
    return True
    
# маппинг наших полей в поля Z2M
Z2M_FIELD_MAP = {
    "on":         ("state",      lambda v: "ON" if v else "OFF"),
    "brightness": ("brightness", lambda v: int(v)),
    "open":       ("state",      lambda v: "OPEN" if v else "CLOSE"),
    "position":   ("position",   lambda v: int(v)),
    "target":     ("current_heating_setpoint", lambda v: float(v)),
    "mode":       ("system_mode", lambda v: "heat" if v == "heat" else "cool"),
    "speed":      ("fan_mode",   lambda v: int(v)),
}

def _publish_z2m_command(dev, patch: dict):
    """Публикует JSON в zigbee2mqtt/<z2m_name>/set."""
    z2m = state.get("settings", {}).get("zigbee2mqtt", {})
    if not z2m.get("enabled"):
        return
    if not (_client and _connected):
        return
    base = (z2m.get("base_topic") or "zigbee2mqtt").rstrip("/")
    name = (dev.get("z2m_name") or "").strip()
    if not name:
        return
    topic = f"{base}/{name}/set"
    payload = json.dumps(patch, ensure_ascii=False)
    try:
        _client.publish(topic, payload)
        log.info(f"[mqtt] Z2M -> {topic}: {payload}")
    except Exception as e:
        log.info("[mqtt] Z2M publish error:%s", e)

def _handle_device_message(did, topic, payload):
    dev = state["devices"].get(did)
    if not dev:
        return

    data = None
    try:
        data = json.loads(payload)
    except (ValueError, TypeError):
        data = None

    changed = {}

    if isinstance(data, dict):
        for field, val in data.items():
            if field in dev["state"]:
                changed[field] = _coerce_value(dev["state"][field], val)
    else:
        field = _guess_field_from_topic(topic, dev)
        if field:
            changed[field] = _coerce_value(dev["state"][field], payload)
        else:
            fields = list(dev["state"].keys())
            if len(fields) == 1:
                changed[fields[0]] = _coerce_value(dev["state"][fields[0]], payload)

    # Обрезка текста по width
    if dev.get("type") == "text" and "text" in changed:
        try:
            w = int(dev["state"].get("width") or 0)
            if w > 0:
                changed["text"] = str(changed["text"])[:w]
        except (TypeError, ValueError):
            pass

    # Кнопка — автосброс
    if dev.get("type") == "button":
        field = "pressed"
        want = _coerce_value(dev["state"].get(field, False), payload)
        if want:
            import button as button_mod
            button_mod.press(did)
            publish_device_state(did)
            return
        else:
            if dev["state"].get(field) is not False:
                dev["state"][field] = False
                dev["updated"] = datetime.now().isoformat(timespec="seconds")
                save_state()
                trigger_events(did, field, False)
                run_all_scenarios()
                publish_device_state(did)
            return

    if not changed:
        log.info("[mqtt] nothing to change:%s %s", topic, payload)
        return

    set_device_state(did, changed)
    save_state()
    for k, v in changed.items():
        trigger_events(did, k, v)
    run_all_scenarios()
    publish_device_state(did)


def _coerce_value(cur, raw):
    try:
        if isinstance(cur, bool):
            s = str(raw).strip().lower()
            if s in ("on", "off"):
                return s == "on"
            return s in ("1", "true", "yes", "on", "вкл", "да", "+")
        if isinstance(cur, int) and not isinstance(cur, bool):
            return int(float(raw))
        if isinstance(cur, float):
            return float(raw)
    except (TypeError, ValueError):
        pass
    return raw


def _guess_field_from_topic(topic, dev):
    """По топику пытается угадать поле: smarthome/door/open/set -> 'open'."""
    parts = topic.split("/")
    if parts and parts[-1] in ("set", "cmd", "command"):
        parts = parts[:-1]
    if parts:
        candidate = parts[-1]
        if candidate in dev["state"]:
            return candidate
        for field in dev["state"].keys():
            if field in parts:
                return field

    fields = list(dev["state"].keys())
    if len(fields) == 1:
        return fields[0]

    if dev.get("type") in ("light", "light_switch") and "on" in dev["state"]:
        return "on"

    if "text" in dev["state"]:
        return "text"

    return None


_subscriptions = {}


def _resubscribe_all(client):
    """Подписка на sub_topic устройств + общий командный шаблон."""
    global _subscriptions

    desired = {}

    # 1) подписки на sub_topic устройств
    for did, dev in state["devices"].items():
        raw = (dev.get("mqtt") or {}).get("sub_topic") or ""
        if not raw:
            continue
        topic = _resolve_topic(raw, did)
        if not topic:
            continue
        desired.setdefault(topic, set()).add(did)

# 2) общая подписка на команды <base_topic>/<device_id>/<field>/set
    base = (state["mqtt"].get("base_topic") or "smarthome").rstrip("/")
    command_topic = f"{base}/+/+/set"
    desired.setdefault(command_topic, set())

    # 2.1) KNX-мост
    try:
        knx_cfg = (state.get("settings") or {}).get("knx") or {}
        if knx_cfg.get("enabled"):
            prefix = knx_cfg.get("read_prefix") or "knx/"
            desired.setdefault(f"{prefix}#", set())
    except Exception as e:
        log.warning("[mqtt] knx subscribe error: %s", e)

    # 3) Zigbee2MQTT
    z2m = state.get("settings", {}).get("zigbee2mqtt", {})
    if z2m.get("enabled"):
        base = (z2m.get("base_topic") or "zigbee2mqtt").rstrip("/")
        desired.setdefault(f"{base}/+", set())
        desired.setdefault(f"{base}/+/availability", set())
        desired.setdefault(f"{base}/+/set", set())
        desired.setdefault(f"{base}/bridge/devices", set())
        log.info(f"[mqtt] Z2M подписки: {base}/+ , {base}/+/availability")

    # 4) топики MQTT-триггеров
    for tr in state.get("mqtt_triggers", {}).values():
        if not tr.get("enabled", True):
            continue
        t = (tr.get("topic") or "").strip()
        if not t:
            continue
        desired.setdefault(t, set())
        log.info(f"[mqtt] триггер подпишется на: {t}")

    # отписка от ненужных
    for topic in list(_subscriptions.keys()):
        if topic not in desired:
            try:
                client.unsubscribe(topic)
                log.info("[mqtt] unsubscribed:%s", topic)
            except Exception:
                pass

    # новые подписки
    for topic in desired.keys():
        if topic not in _subscriptions:
            try:
                client.subscribe(topic)
                log.info("[mqtt] subscribed:%s", topic)
            except Exception as e:
                log.info("[mqtt] subscribe error:%s", e)

    _subscriptions = desired


def refresh_subscriptions():
    if _client and _connected:
        _resubscribe_all(_client)


def start():
    """Запуск клиента. Идемпотентно."""
    global _client, _started
    if not _HAS_PAHO:
        log.info("[mqtt] paho-mqtt не установлен — MQTT отключён")
        return
    with _client_lock:
        if _started:
            return
        cfg = state["mqtt"]
        if not cfg.get("enabled"):
            log.info("[mqtt] disabled in settings")
            return
        client = mqtt.Client(client_id=cfg.get("client_id") or "smarthome-server")
        if cfg.get("username"):
            client.username_pw_set(cfg["username"], cfg.get("password") or "")
        client.on_connect = _on_connect
        client.on_disconnect = _on_disconnect
        client.on_message = _on_message
        try:
            client.connect(cfg.get("host") or "localhost",
                           int(cfg.get("port") or 1883),
                           int(cfg.get("keepalive") or 60))
        except Exception as e:
            log.info("[mqtt] connect error:%s", e)
            return
        client.loop_start()
        _client = client
        _started = True


def stop():
    global _client, _started, _connected, _subscriptions
    with _client_lock:
        if _client:
            try:
                cfg = state["mqtt"]
                topic = cfg.get("status_topic") or ""
                if topic and _connected:
                    _client.publish(topic, "offline", retain=True)
                _client.loop_stop()
                _client.disconnect()
            except Exception:
                pass
            _client = None
        _started = False
        _connected = False


def restart():
    stop()
    start()


def publish_device_state(did):
    """Публикует состояние устройства в его state_topic.
    Если не задан — использует дефолтный <base_topic>/<device_id>/state."""
    if not (_client and _connected):
        return
    dev = state["devices"].get(did)
    if not dev:
        return

    mqtt_cfg = dev.get("mqtt") or {}
    state_topic = mqtt_cfg.get("state_topic") or _default_state_topic(did)

    payload = {
        "id": did,
        "name": dev.get("name", ""),
        "type": dev.get("type", ""),
        "updated": dev.get("updated"),
        "state": dev["state"],
    }
    try:
        _client.publish(state_topic, json.dumps(payload, ensure_ascii=False), retain=True)
        log.info("[mqtt] published state:%s", state_topic)
    except Exception as e:
        log.info("[mqtt] publish error:%s", e)


def publish_all_states():
    if not (_client and _connected):
        return
    for did in list(state["devices"].keys()):
        publish_device_state(did)