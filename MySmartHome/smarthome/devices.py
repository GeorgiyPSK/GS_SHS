# devices.py
from datetime import datetime
from state import state, save_state, new_id
import logging
log = logging.getLogger("smarthome.devices")
DEFAULT_ICON_RULES = {
    "door": [
        {"field": "open",  "op": "==", "value": True,  "icon": "🚪"},
        {"field": "open",  "op": "==", "value": False, "icon": "🔒"},
    ],
    "leak": [
        {"field": "leak",  "op": "==", "value": True,  "icon": "🌊"},
        {"field": "leak",  "op": "==", "value": False, "icon": "✅"},
    ],
    "motion": [
        {"field": "motion","op": "==", "value": True,  "icon": "👁️"},
        {"field": "motion","op": "==", "value": False, "icon": "🌙"},
    ],
    "light": [
        {"field": "on",    "op": "==", "value": True,  "icon": "💡"},
        {"field": "on",    "op": "==", "value": False, "icon": "🌑"},
    ],
    "light_switch": [
        {"field": "on",    "op": "==", "value": True,  "icon": "🔆"},
        {"field": "on",    "op": "==", "value": False, "icon": "🔅"},
    ],
    "curtain": [
        {"field": "open",  "op": "==", "value": True,  "icon": "🪟"},
        {"field": "open",  "op": "==", "value": False, "icon": "🚪"},
    ],
    "fan": [
        {"field": "on",    "op": "==", "value": True,  "icon": "🌀"},
        {"field": "on",    "op": "==", "value": False, "icon": "⏸️"},
    ],
    "climate": [
        {"field": "temp",  "op": "<",  "value": 15,    "icon": "🥶"},
        {"field": "temp",  "op": "<=", "value": 25,    "icon": "🌤️"},
        {"field": "temp",  "op": ">",  "value": 25,    "icon": "🥵"},
    ],
    "button": [
        {"field": "pressed","op": "==", "value": True, "icon": "🔴"},
        {"field": "pressed","op": "==", "value": False,"icon": "🔘"},
    ],
};

def default_state(dtype):
    if dtype == "thermostat":
        return {"current": 22.0, "target": 23.0, "mode": "heat"}
    if dtype == "door":
        return {"open": False}
    if dtype == "leak":
        return {"leak": False}
    if dtype == "climate":
        return {"temp": 22.0, "humidity": 45.0}
    if dtype == "motion":
        return {"motion": False}
    if dtype == "light":
        return {"on": False, "brightness": 100}
    if dtype == "light_switch":
        return {"on": False}
    if dtype == "curtain":
        return {"open": False, "position": 0}
    if dtype == "fan":
        return {"on": False, "speed": 0}
    if dtype == "button":
        return {"pressed": False}
    if dtype == "text":
        return {"text": "", "width": 40}

    # Кастомный тип: берём поля из state["custom_types"]
    from state import state as _state
    ct = _state.get("custom_types", {}).get(dtype)
    if ct:
        out = {}
        for f in ct.get("fields", []):
            fname = f.get("name")
            if not fname:
                continue
            out[fname] = f.get("default")
        return out

    return {}


def add_device(dtype, name, room="", room_id="", x=None, y=None, on_plan=False):
    did = new_id()
    px = x if x is not None else 50.0
    py = y if y is not None else 50.0

    state["devices"][did] = {
        "id": did,
        "type": dtype,
        "name": name or dtype,
        "room": room,
        "room_id": room_id,
        "extra_rooms": [],
        "state": default_state(dtype),
        "x": px,
        "y": py,
        "positions": {"main": {"x": px, "y": py}},
        "on_plan": bool(on_plan),
        "mqtt": {"state_topic": "", "sub_topic": "", "retain": True},
        "icon_rules": DEFAULT_ICON_RULES.get(dtype, []),
        # ─── Логирование полей ────────────────────────
        "logging": {
            "enabled": False,
            "fields": [],        # ["on", "temp", "battery"]  — пусто = все поля
            "max": 1000,         # максимум строк в выборке для API
        },
        "knx": {
            "enabled": False,
            "fields": {
                # "on":   {"address": "1/2/3", "dpt": "DPT-1.001"},
                # "temp": {"read":  {"address": "1/2/4", "dpt": "DPT-9.001"},
                #          "write": {"address": "1/2/5", "dpt": "DPT-9.001"}},
            },
        },

        # ─── Modbus ──────────────────────────────────
        "modbus": {
            "enabled": False,
            "conn": {
                "transport": "tcp",
                "host": "127.0.0.1",
                "tcp_port": 502,
                "port": "COM1",
                "baudrate": 9600,
                "parity": "N",
                "stopbits": 1,
                "bytesize": 8,
                "unit": 1,
                "timeout": 1.0,
            },
            "fields": {},
        },

        "updated": datetime.now().isoformat(timespec="seconds"),
    }

    if dtype == "button":
        state["devices"][did]["hold_ms"] = 500
    return state["devices"][did]


def set_device_state(did, patch):
    dev = state["devices"].get(did)
    if not dev:
        return None

    allowed = set(dev["state"].keys())
    changed = {}
    for k, v in patch.items():
        if k in allowed:
            dev["state"][k] = v
            changed[k] = v
    dev["updated"] = datetime.now().isoformat(timespec="seconds")

    if not changed:
        return changed

    # MQTT
    try:
        from mqtt_client import publish_device_state
        publish_device_state(did)
    except Exception as e:
        log.error("[devices] mqtt publish error:%s", e)

    # KNX
    try:
        from knx_client import publish_fields
        publish_fields(did, changed)
    except Exception as e:
        log.error("[devices] knx publish error:%s", e)

    # Modbus
    m = dev.get("modbus") or {}
    if m.get("enabled"):
        try:
            from modbus_client import write_field
            for k, v in changed.items():
                spec = (m.get("fields") or {}).get(k)
                if spec and spec.get("rw") in ("w", "rw"):
                    write_field(did, k, v)
        except Exception as e:
            log.error("[devices] modbus write error:%s", e)

    # Логирование значений
    try:
        log_cfg = dev.get("logging") or {}
        if log_cfg.get("enabled"):
            allowed = set(log_cfg.get("fields") or [])
            from logger_store import append as log_append
            for k, v in changed.items():
                if allowed and k not in allowed:
                    continue
                log_append(did, k, v)
    except Exception as e:
        log.error("[devices] logger error:%s", e)

    # SSE
    try:
        from api import notify_state_changed
        notify_state_changed()
    except Exception as e:
        log.error("[devices] notify_state_changed error:%s", e)

    return changed


def migrate_positions():
    """У старых устройств нет поля positions — создаём его из x/y."""
    changed = False
    for dev in state["devices"].values():
        if "positions" not in dev or not isinstance(dev["positions"], dict):
            dev["positions"] = {}
            changed = True
        # main — из legacy x/y
        if "main" not in dev["positions"]:
            dev["positions"]["main"] = {
                "x": float(dev.get("x", 50.0)),
                "y": float(dev.get("y", 50.0)),
            }
            changed = True
        # если устройство привязано к комнате и для неё нет позиции — создаём
        rid = dev.get("room_id")
        if rid and rid not in dev["positions"]:
            dev["positions"][rid] = {
                "x": dev["positions"]["main"]["x"],
                "y": dev["positions"]["main"]["y"],
            }
            changed = True
        # extra_rooms — тоже создаём позицию, если её нет
        for erid in (dev.get("extra_rooms") or []):
            if erid not in dev["positions"]:
                dev["positions"][erid] = {
                    "x": dev["positions"]["main"]["x"],
                    "y": dev["positions"]["main"]["y"],
                }
                changed = True
    if changed:
        save_state()


def seed_if_empty():
    if state["devices"]:
        return
    add_device("thermostat", "Термостат гостиной", "Гостиная", x=25, y=30, on_plan=True)
    add_device("climate", "Климат-датчик спальни", "Спальня", x=70, y=25, on_plan=True)
    add_device("door", "Входная дверь", "Прихожая", x=15, y=80, on_plan=True)
    add_device("leak", "Датчик протечки (кухня)", "Кухня", x=80, y=70, on_plan=True)
    add_device("motion", "Датчик движения (коридор)", "Коридор", x=50, y=55, on_plan=True)
    add_device("light", "Свет в гостиной", "Гостиная", x=40, y=20, on_plan=True)
    if not state["scenario_groups"]:
        gid = new_id()
        state["scenario_groups"][gid] = {"id": gid, "name": "Общие", "order": 0}
    save_state()