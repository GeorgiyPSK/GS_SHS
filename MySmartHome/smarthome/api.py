# api.py
from datetime import datetime
import os
import tempfile
import json
import knx_import
import queue
import threading
import mqtt_client
import lua_store
import lua_engine
import event_bus
from flask import Blueprint, request, jsonify, Response, stream_with_context
from auth import api_login_required
from state import state, save_state, new_id
from devices import add_device, set_device_state, default_state
from events import trigger_events
from scenarios import run_all_scenarios
from datetime import datetime
import logging
from flask import request, jsonify
from auth import login_required
log = logging.getLogger("smarthome.api")
api = Blueprint("api", __name__, url_prefix="/api")
lua_engine.init_event_bus()
@api.before_request
def _require_auth():
    # пропускаем только /api/theme (GET) и /api/events/stream,
    # чтобы страница логина могла работать, а SSE не ломался
    exempt = (
        request.endpoint == "api.theme_get" or
        request.endpoint == "api.events_stream"
    )
    if exempt:
        return None
    return api_login_required(lambda: None)()

# ============================================================
# SSE: Server-Sent Events
# ============================================================
_sse_clients = []
_sse_lock = threading.Lock()

def notify_clients(event_type, data):
    """Отправляет всем SSE-клиентам произвольное событие.
    event_type: строка ('notify', 'changed', ...).
    data: dict или строка."""
    import json as _json
    payload = _json.dumps({"type": event_type, "data": data}, ensure_ascii=False)
    with _sse_lock:
        for q in list(_sse_clients):
            try:
                q.put_nowait(payload)
            except Exception:
                pass

import threading, time

_ui_notify_lock = threading.Lock()
_ui_notify_pending = False
_ui_notify_last_ts = 0.0
UI_NOTIFY_MIN_INTERVAL = 0.5   # сек — не чаще 2 раз в секунду


def _do_notify_clients_changed():
    """
    Реальная отправка 'changed' в SSE.
    Именно эту строку раньше слал notify_state_changed().
    """
    try:
        notify_clients("changed", None)
    except Exception as e:
        log.warning("[api] notify changed error: %s", e)


def notify_state_changed():
    """
    Публичная функция с дебаунсом: не чаще 2 раз в секунду.
    Вызывается из knx_client, modbus_client, devices.set_device_state и т.д.
    """
    global _ui_notify_pending, _ui_notify_last_ts

    now = time.time()
    with _ui_notify_lock:
        # слишком часто — откладываем
        if now - _ui_notify_last_ts < UI_NOTIFY_MIN_INTERVAL:
            if _ui_notify_pending:
                return
            _ui_notify_pending = True

            def _later():
                global _ui_notify_pending, _ui_notify_last_ts
                time.sleep(UI_NOTIFY_MIN_INTERVAL)
                with _ui_notify_lock:
                    _ui_notify_pending = False
                    _ui_notify_last_ts = time.time()
                _do_notify_clients_changed()

            threading.Timer(UI_NOTIFY_MIN_INTERVAL, _later).start()
            return

        _ui_notify_last_ts = now

    _do_notify_clients_changed()


@api.route("/events/stream")
def events_stream():
    q = queue.Queue()
    with _sse_lock:
        _sse_clients.append(q)

    def gen():
        try:
            yield "data: init\n\n"
            while True:
                try:
                    msg = q.get(timeout=25)
                    yield f"data: {msg}\n\n"
                except queue.Empty:
                    yield ": ping\n\n"
        finally:
            with _sse_lock:
                if q in _sse_clients:
                    _sse_clients.remove(q)

    return Response(
        stream_with_context(gen()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache",
                 "X-Accel-Buffering": "no"},
    )


# ============================================================
# Публичный просмотр (read-only)
# ============================================================
@api.route("/view/devices", methods=["GET"])
def view_devices():
    return jsonify(list(state["devices"].values()))


@api.route("/view/rooms", methods=["GET"])
def view_rooms():
    rooms = list(state["rooms"].values())
    rooms.sort(key=lambda r: r.get("name", ""))
    return jsonify(rooms)


@api.route("/view/plan", methods=["GET"])
def view_plan():
    return jsonify(state["plan"])


@api.route("/view/plan/meta", methods=["GET"])
def view_plan_meta():
    plan = state["plan"]
    main = plan.get("main") or {}
    rooms = plan.get("rooms") or {}
    return jsonify({
        "main": {"updated": main.get("updated"), "has_image": bool(main.get("image"))},
        "rooms": {rid: {"updated": (r or {}).get("updated"),
                        "has_image": bool((r or {}).get("image"))}
                  for rid, r in rooms.items()},
    })


# ============================================================
# Настройки
# ============================================================
@api.route("/settings", methods=["GET", "POST"])
def settings():
    if request.method == "POST":
        body = request.get_json(silent=True) or {}
        if "mode" in body and body["mode"] in ("user", "edit"):
            state["settings"]["mode"] = body["mode"]
        if "poll_interval" in body:
            try:
                state["settings"]["poll_interval"] = max(500, int(body["poll_interval"]))
            except (TypeError, ValueError):
                pass
        save_state()
    return jsonify(state["settings"])


# ============================================================
# MQTT
# ============================================================
@api.route("/mqtt/settings", methods=["GET", "POST"])
def mqtt_settings():
    if request.method == "POST":
        body = request.get_json(silent=True) or {}
        cfg = state["mqtt"]
        for k in ("enabled", "host", "port", "username", "password",
                  "client_id", "base_topic", "keepalive", "status_topic"):
            if k in body:
                cfg[k] = body[k]
        save_state()
        mqtt_client.restart()
    return jsonify(state["mqtt"])


@api.route("/mqtt/status", methods=["GET"])
def mqtt_status():
    return jsonify({
        "available": mqtt_client.is_available(),
        "connected": mqtt_client.is_connected(),
    })


@api.route("/devices/<did>/mqtt", methods=["POST"])
def devices_set_mqtt(did):
    dev = state["devices"].get(did)
    if not dev:
        return jsonify({"error": "not found"}), 404
    body = request.get_json(silent=True) or {}
    dev.setdefault("mqtt", {"state_topic": "", "sub_topic": "", "retain": True})
    for k in ("state_topic", "sub_topic", "retain"):
        if k in body:
            dev["mqtt"][k] = body[k]
    save_state()
    if mqtt_client.is_connected():
        mqtt_client.refresh_subscriptions()
    return jsonify(dev)


# ============================================================
# MQTT-триггеры
# ============================================================
@api.route("/mqtt_triggers", methods=["GET"])
def mqtt_triggers_list():
    return jsonify(list(state.get("mqtt_triggers", {}).values()))


@api.route("/mqtt_triggers", methods=["POST"])
def mqtt_triggers_add():
    body = request.get_json(silent=True) or {}
    tid = new_id()
    state.setdefault("mqtt_triggers", {})[tid] = {
        "id": tid,
        "name": body.get("name", "Новый триггер"),
        "topic": body.get("topic", ""),
        "payload_match": body.get("payload_match", ""),
        "scenario_id": body.get("scenario_id", ""),
        "enabled": bool(body.get("enabled", True)),
    }
    save_state()
    if mqtt_client.is_connected():
        mqtt_client.refresh_subscriptions()
    return jsonify(state["mqtt_triggers"][tid]), 201


@api.route("/mqtt_triggers/<tid>", methods=["POST"])
def mqtt_triggers_update(tid):
    t = state.get("mqtt_triggers", {}).get(tid)
    if not t:
        return jsonify({"error": "not found"}), 404
    body = request.get_json(silent=True) or {}
    for k in ("name", "topic", "payload_match", "scenario_id", "enabled"):
        if k in body:
            t[k] = body[k]
    save_state()
    if mqtt_client.is_connected():
        mqtt_client.refresh_subscriptions()
    return jsonify(t)


@api.route("/mqtt_triggers/<tid>", methods=["DELETE"])
def mqtt_triggers_delete(tid):
    if tid not in state.get("mqtt_triggers", {}):
        return jsonify({"error": "not found"}), 404
    del state["mqtt_triggers"][tid]
    save_state()
    if mqtt_client.is_connected():
        mqtt_client.refresh_subscriptions()
    return jsonify({"status": "ok"})


# ============================================================
# Устройства
# ============================================================
@api.route("/devices", methods=["GET"])
def devices_list():
    return jsonify(list(state["devices"].values()))


@api.route("/devices", methods=["POST"])
def devices_add():
    body = request.get_json(silent=True) or {}
    dtype = body.get("type")
    known = {"thermostat", "climate", "door", "leak", "motion",
             "light", "light_switch", "curtain", "fan", "button", "text"}
    if dtype not in known and dtype not in state.get("custom_types", {}):
        return jsonify({
            "error": "unknown type",
            "allowed": sorted(known | set(state.get("custom_types", {}).keys())),
        }), 400
    dev = add_device(dtype, body.get("name", ""), body.get("room", ""),
                     room_id=body.get("room_id", ""),
                     x=body.get("x"), y=body.get("y"),
                     on_plan=body.get("on_plan", False))
    if body.get("z2m_name"):
        dev["z2m_name"] = str(body["z2m_name"]).strip()
    save_state()
    return jsonify(dev), 201


def _cascade_delete_device(did: str) -> dict:
    """
    Удаляет устройство и подчищает все ссылки на него.
    Возвращает отчёт: {deleted, events, scenarios, timers,
                       mqtt_triggers, knx_links, plan_charts}.
    """
    report = {
        "deleted": False,
        "events": 0,
        "scenarios": 0,
        "timers": 0,
        "mqtt_triggers": 0,
        "knx_links": 0,
        "plan_charts": 0,
    }

    dev = state["devices"].get(did)
    if not dev:
        return report
    del state["devices"][did]
    report["deleted"] = True

    # --- События: если событие триггерится от этого устройства — удаляем
    for eid in list(state.get("events", {}).keys()):
        ev = state["events"][eid]
        if ev.get("source_device") == did:
            del state["events"][eid]
            report["events"] += 1

    # --- Сценарии: чистим условия и действия
    for sc in state.get("scenarios", {}).values():
        conds = sc.get("conditions") or []
        new_conds = [c for c in conds if c.get("device") != did]
        if len(new_conds) != len(conds):
            sc["conditions"] = new_conds
            report["scenarios"] += 1

        acts = sc.get("actions") or []
        new_acts = []
        for a in acts:
            # set_state — от этого устройства
            if a.get("type") == "set_state" and a.get("device") == did:
                continue
            # request / mqtt / notify / delay / lua — оставляем
            # (value_source может ссылаться на did — очищаем)
            vs = a.get("value_source")
            if isinstance(vs, dict) and vs.get("device") == did:
                a = dict(a)
                a.pop("value_source", None)
            new_acts.append(a)
        if len(new_acts) != len(acts):
            sc["actions"] = new_acts
            report["scenarios"] += 1

    # --- Таймеры: чистим действия
    for t in state.get("timers", {}).values():
        acts = t.get("actions") or []
        new_acts = []
        for a in acts:
            if a.get("type") == "set_state" and a.get("device") == did:
                continue
            vs = a.get("value_source")
            if isinstance(vs, dict) and vs.get("device") == did:
                a = dict(a)
                a.pop("value_source", None)
            new_acts.append(a)
        if len(new_acts) != len(acts):
            t["actions"] = new_acts
            report["timers"] += 1

    # --- MQTT-триггеры: если триггер указывает на сценарий — оставляем,
    #    но если у триггера есть привязка к устройству — чистим
    for tr in state.get("mqtt_triggers", {}).values():
        if tr.get("device_id") == did:
            tr["device_id"] = ""
            report["mqtt_triggers"] += 1

    # --- KNX-привязки в реестре GA
    try:
        import knx_ga_store
        for ga in knx_ga_store.all_gas().values():
            if ga.get("device_id") == did:
                ga["device_id"] = ""
                ga["field"] = ""
                report["knx_links"] += 1
    except Exception as e:
        log.warning("[cascade] knx_ga error: %s", e)

    # --- Графики на плане
    charts = state.get("plan", {}).get("charts") or []
    new_charts = []
    for c in charts:
        series = c.get("series") or []
        new_series = [s for s in series if s.get("device_id") != did]
        # если основное device_id совпадает и series пуст — удаляем виджет
        if c.get("device_id") == did and not new_series:
            report["plan_charts"] += 1
            continue
        if len(new_series) != len(series):
            c = dict(c)
            c["series"] = new_series
        new_charts.append(c)
    if len(new_charts) != len(charts):
        state["plan"]["charts"] = new_charts

    # --- positions/extra_rooms в других устройствах не трогаем —
    #     они не ссылаются на конкретное устройство

    return report


@api.route("/devices/<did>", methods=["DELETE"])
def devices_delete(did):
    if did not in state["devices"]:
        return jsonify({"error": "not found"}), 404
    report = _cascade_delete_device(did)
    save_state()
    return jsonify({"status": "ok", "report": report})


@api.route("/devices/<did>/state", methods=["POST"])
def devices_set_state(did):
    dev = state["devices"].get(did)
    if not dev:
        return jsonify({"error": "not found"}), 404

    patch = request.get_json(silent=True)
    if not isinstance(patch, dict):
        patch = {}

    # Специальная обработка кнопки: pressed=true запускает автосброс
    if dev.get("type") == "button" and "pressed" in patch:
        want = patch["pressed"]
        try:
            if isinstance(want, str):
                want_bool = want.strip().lower() in ("1", "true", "yes", "on", "вкл")
            else:
                want_bool = bool(want)
        except Exception:
            want_bool = False

        if want_bool:
            import button as button_mod
            button_mod.press(did)
        else:
            if dev["state"].get("pressed") is not False:
                dev["state"]["pressed"] = False
                dev["updated"] = datetime.now().isoformat(timespec="seconds")
                save_state()
                try:
                    mqtt_client.publish_device_state(did)
                except Exception as e:
                    log.info("[button] mqtt publish error:%s", e)
                trigger_events(did, "pressed", False)
                run_all_scenarios()
        patch = {k: v for k, v in patch.items() if k != "pressed"}

    # ← вынесено из if-button: теперь выполняется всегда
    changed = set_device_state(did, patch) or {}

    if changed:
        save_state()
        for k, v in changed.items():
            trigger_events(did, k, v)
            try:
                event_bus.publish(
                    "device_changed",
                    source="api",
                    device_id=did,
                    field=k,
                    value=v,
                )
            except Exception as e:
                log.warning("[api] event_bus error: %s", e)
        run_all_scenarios()

        # Zigbee2MQTT: если у устройства есть z2m_name — публикуем в /set
        if dev.get("z2m_name"):
            try:
                import mqtt_client
                mqtt_client._publish_z2m_command(dev, changed)
            except Exception as e:
                log.info("[api] Z2M publish error:%s", e)

    return jsonify(dev)


@api.route("/devices/<did>/hold", methods=["POST"])
def devices_set_hold(did):
    dev = state["devices"].get(did)
    if not dev or dev.get("type") != "button":
        return jsonify({"error": "not found"}), 404
    body = request.get_json(silent=True) or {}
    try:
        v = int(body.get("hold_ms", 500))
    except (TypeError, ValueError):
        v = 500
    dev["hold_ms"] = max(50, min(v, 60000))
    dev["updated"] = datetime.now().isoformat(timespec="seconds")
    save_state()
    return jsonify(dev)


@api.route("/devices/<did>/position", methods=["POST"])
def devices_set_position(did):
    dev = state["devices"].get(did)
    if not dev:
        return jsonify({"error": "not found"}), 404

    body = request.get_json(silent=True) or {}
    plan = body.get("plan") or "main"
    if plan != "main" and plan not in state["rooms"]:
        return jsonify({"error": "plan not found"}), 404

    dev.setdefault("positions", {})
    pos = dev["positions"].setdefault(plan, {})
    if "x" in body:
        try:
            pos["x"] = max(0.0, min(100.0, float(body["x"])))
        except (TypeError, ValueError):
            return jsonify({"error": "bad x"}), 400
    if "y" in body:
        try:
            pos["y"] = max(0.0, min(100.0, float(body["y"])))
        except (TypeError, ValueError):
            return jsonify({"error": "bad y"}), 400

    if plan == "main":
        if "x" in pos: dev["x"] = pos["x"]
        if "y" in pos: dev["y"] = pos["y"]

    if "on_plan" in body:
        dev["on_plan"] = bool(body["on_plan"])

    dev["updated"] = datetime.now().isoformat(timespec="seconds")
    save_state()
    return jsonify(dev)


@api.route("/devices/<did>/extra_rooms", methods=["POST"])
def devices_set_extra_rooms(did):
    dev = state["devices"].get(did)
    if not dev:
        return jsonify({"error": "not found"}), 404
    body = request.get_json(silent=True) or {}
    rooms = body.get("extra_rooms")
    if not isinstance(rooms, list):
        return jsonify({"error": "extra_rooms must be a list"}), 400
    valid = [rid for rid in rooms if rid in state["rooms"]]
    dev["extra_rooms"] = valid

    dev.setdefault("positions", {})
    main_pos = dev["positions"].get("main") or {
        "x": float(dev.get("x", 50.0)),
        "y": float(dev.get("y", 50.0)),
    }
    for rid in valid:
        dev["positions"].setdefault(rid, {
            "x": main_pos["x"],
            "y": main_pos["y"],
        })
    own_rid = dev.get("room_id") or ""
    for rid in list(dev["positions"].keys()):
        if rid == "main" or rid == own_rid:
            continue
        if rid not in valid:
            del dev["positions"][rid]

    dev["updated"] = datetime.now().isoformat(timespec="seconds")
    save_state()
    return jsonify(dev)


@api.route("/devices/<did>/room", methods=["POST"])
def devices_set_room(did):
    dev = state["devices"].get(did)
    if not dev:
        return jsonify({"error": "not found"}), 404
    body = request.get_json(silent=True) or {}
    rid = body.get("room_id", "")
    if rid and rid not in state["rooms"]:
        return jsonify({"error": "room not found"}), 404
    dev["room_id"] = rid
    dev["room"] = state["rooms"][rid]["name"] if rid else ""

    dev.setdefault("positions", {})
    if rid and rid not in dev["positions"]:
        main_pos = dev["positions"].get("main") or {
            "x": float(dev.get("x", 50.0)),
            "y": float(dev.get("y", 50.0)),
        }
        dev["positions"][rid] = {"x": main_pos["x"], "y": main_pos["y"]}

    dev["updated"] = datetime.now().isoformat(timespec="seconds")
    save_state()
    return jsonify(dev)


@api.route("/devices/bulk_room", methods=["POST"])
def devices_bulk_room():
    body = request.get_json(silent=True) or {}
    ids = body.get("ids") or []
    rid = body.get("room_id", "")
    if rid and rid not in state["rooms"]:
        return jsonify({"error": "room not found"}), 404
    room_name = state["rooms"][rid]["name"] if rid else ""
    changed = 0
    for did in ids:
        dev = state["devices"].get(did)
        if not dev:
            continue
        dev["room_id"] = rid
        dev["room"] = room_name
        dev["updated"] = datetime.now().isoformat(timespec="seconds")
        changed += 1
    save_state()
    return jsonify({"status": "ok", "changed": changed})


# ============================================================
# Комнаты
# ============================================================
@api.route("/rooms", methods=["GET"])
def rooms_list():
    rooms = list(state["rooms"].values())
    rooms.sort(key=lambda r: r.get("name", ""))
    return jsonify(rooms)


@api.route("/rooms", methods=["POST"])
def rooms_add():
    body = request.get_json(silent=True) or {}
    rid = new_id()
    state["rooms"][rid] = {
        "id": rid,
        "name": body.get("name", "Комната"),
        "icon": body.get("icon", "🏠"),
        "color": body.get("color", "#4caf50"),
        "x": float(body.get("x", 10)),
        "y": float(body.get("y", 10)),
        "w": float(body.get("w", 25)),
        "h": float(body.get("h", 25)),
    }
    save_state()
    return jsonify(state["rooms"][rid]), 201


@api.route("/rooms/<rid>", methods=["POST"])
def rooms_update(rid):
    r = state["rooms"].get(rid)
    if not r:
        return jsonify({"error": "not found"}), 404
    body = request.get_json(silent=True) or {}
    for k in ("name", "icon", "color", "x", "y", "w", "h"):
        if k in body:
            r[k] = body[k]
    if "name" in body:
        for d in state["devices"].values():
            if d.get("room_id") == rid:
                d["room"] = r["name"]
    save_state()
    return jsonify(r)


@api.route("/rooms/<rid>", methods=["DELETE"])
def rooms_delete(rid):
    if rid not in state["rooms"]:
        return jsonify({"error": "not found"}), 404
    del state["rooms"][rid]
    state["plan"]["rooms"].pop(rid, None)
    for d in state["devices"].values():
        if d.get("room_id") == rid:
            d["room_id"] = ""
            d["room"] = ""
        if d.get("extra_rooms") and rid in d["extra_rooms"]:
            d["extra_rooms"] = [x for x in d["extra_rooms"] if x != rid]
        if isinstance(d.get("positions"), dict):
            d["positions"].pop(rid, None)
    save_state()
    return jsonify({"status": "ok"})


# ============================================================
# План
# ============================================================
@api.route("/plan/meta", methods=["GET"])
def plan_meta():
    plan = state["plan"]
    main = plan.get("main") or {}
    rooms = plan.get("rooms") or {}
    return jsonify({
        "main": {
            "updated": main.get("updated"),
            "has_image": bool(main.get("image")),
        },
        "rooms": {
            rid: {
                "updated": (r or {}).get("updated"),
                "has_image": bool((r or {}).get("image")),
            }
            for rid, r in rooms.items()
        },
    })


@api.route("/plan", methods=["GET"])
def plan_get():
    return jsonify(state["plan"])


@api.route("/plan/main", methods=["POST"])
def plan_main_set():
    body = request.get_json(silent=True) or {}
    image = body.get("image")
    if not image or not isinstance(image, str) or not image.startswith("data:image/"):
        return jsonify({"error": "image data-url required"}), 400
    state["plan"]["main"]["image"] = image
    state["plan"]["main"]["updated"] = datetime.now().isoformat(timespec="seconds")
    save_state()
    return jsonify({"status": "ok"})


@api.route("/plan/main", methods=["DELETE"])
def plan_main_delete():
    state["plan"]["main"]["image"] = None
    state["plan"]["main"]["updated"] = datetime.now().isoformat(timespec="seconds")
    save_state()
    return jsonify({"status": "ok"})


@api.route("/plan/rooms/<rid>", methods=["POST"])
def plan_room_set(rid):
    if rid not in state["rooms"]:
        return jsonify({"error": "room not found"}), 404
    body = request.get_json(silent=True) or {}
    image = body.get("image")
    if not image or not isinstance(image, str) or not image.startswith("data:image/"):
        return jsonify({"error": "image data-url required"}), 400
    state["plan"]["rooms"][rid] = {
        "image": image,
        "updated": datetime.now().isoformat(timespec="seconds"),
    }
    save_state()
    return jsonify({"status": "ok"})


@api.route("/plan/rooms/<rid>", methods=["DELETE"])
def plan_room_delete(rid):
    state["plan"]["rooms"].pop(rid, None)
    save_state()
    return jsonify({"status": "ok"})


# ============================================================
# Плейсхолдеры
# ============================================================
@api.route("/placeholders", methods=["GET"])
def placeholders():
    out = {}
    for did, dev in state["devices"].items():
        out[did] = {
            "name": dev.get("name", ""),
            "type": dev.get("type", ""),
            "fields": list(dev.get("state", {}).keys()),
        }
    return jsonify(out)


# ============================================================
# События
# ============================================================
@api.route("/events", methods=["GET"])
def events_list():
    return jsonify(list(state["events"].values()))


@api.route("/events", methods=["POST"])
def events_add():
    body = request.get_json(silent=True) or {}
    eid = new_id()
    state["events"][eid] = {
        "id": eid, "name": body.get("name", "Новое событие"),
        "source_device": body.get("source_device", ""),
        "source_field": body.get("source_field", ""),
        "when": body.get("when", "any"),
        "requests": body.get("requests", []),
        "mqtt_publishes": body.get("mqtt_publishes", []),
        "enabled": bool(body.get("enabled", True)),
    }
    save_state()
    return jsonify(state["events"][eid]), 201


@api.route("/events/<eid>", methods=["POST"])
def events_update(eid):
    ev = state["events"].get(eid)
    if not ev:
        return jsonify({"error": "not found"}), 404
    body = request.get_json(silent=True) or {}
    for k in ("name", "source_device", "source_field", "when",
              "requests", "mqtt_publishes", "enabled"):
        if k in body:
            ev[k] = body[k]
    save_state()
    return jsonify(ev)


@api.route("/events/<eid>", methods=["DELETE"])
def events_delete(eid):
    if eid not in state["events"]:
        return jsonify({"error": "not found"}), 404
    del state["events"][eid]
    save_state()
    return jsonify({"status": "ok"})


# ============================================================
# Группы сценариев
# ============================================================
@api.route("/scenario_groups", methods=["GET"])
def groups_list():
    groups = list(state["scenario_groups"].values())
    groups.sort(key=lambda g: (g.get("order", 0), g.get("name", "")))
    return jsonify(groups)


@api.route("/scenario_groups", methods=["POST"])
def groups_add():
    body = request.get_json(silent=True) or {}
    gid = new_id()
    order = max([g.get("order", 0) for g in state["scenario_groups"].values()] + [0]) + 1
    state["scenario_groups"][gid] = {
        "id": gid, "name": body.get("name", "Группа"), "order": order
    }
    save_state()
    return jsonify(state["scenario_groups"][gid]), 201


@api.route("/scenario_groups/<gid>", methods=["POST"])
def groups_update(gid):
    g = state["scenario_groups"].get(gid)
    if not g:
        return jsonify({"error": "not found"}), 404
    body = request.get_json(silent=True) or {}
    for k in ("name", "order"):
        if k in body:
            g[k] = body[k]
    save_state()
    return jsonify(g)


@api.route("/scenario_groups/<gid>", methods=["DELETE"])
def groups_delete(gid):
    if gid not in state["scenario_groups"]:
        return jsonify({"error": "not found"}), 404
    del state["scenario_groups"][gid]
    for sc in state["scenarios"].values():
        if sc.get("group") == gid:
            sc["group"] = ""
    save_state()
    return jsonify({"status": "ok"})


# ============================================================
# Сценарии
# ============================================================
@api.route("/scenarios", methods=["GET"])
def scenarios_list():
    return jsonify(list(state["scenarios"].values()))


@api.route("/scenarios", methods=["POST"])
def scenarios_add():
    body = request.get_json(silent=True) or {}
    sid = new_id()
    state["scenarios"][sid] = {
        "id": sid, "name": body.get("name", "Новый сценарий"),
        "group": body.get("group", ""),
        "enabled": bool(body.get("enabled", True)),
        "logic": body.get("logic", "AND"),
         "initial_delay": float(body.get("initial_delay", 0) or 0),
        "conditions": body.get("conditions", []),
        "actions": body.get("actions", []),
    }
    save_state()
    return jsonify(state["scenarios"][sid]), 201


@api.route("/scenarios/<sid>", methods=["POST"])
def scenarios_update(sid):
    sc = state["scenarios"].get(sid)
    if not sc:
        return jsonify({"error": "not found"}), 404
    body = request.get_json(silent=True) or {}
    for k in ("name", "enabled", "logic", "conditions", "actions", "group", "initial_delay"):
        if k in body:
            sc[k] = body[k]
    save_state()
    return jsonify(sc)


@api.route("/scenarios/<sid>", methods=["DELETE"])
def scenarios_delete(sid):
    if sid not in state["scenarios"]:
        return jsonify({"error": "not found"}), 404
    del state["scenarios"][sid]
    save_state()
    return jsonify({"status": "ok"})


# ============================================================
# Таймеры
# ============================================================
@api.route("/timers", methods=["GET"])
def timers_list():
    return jsonify(list(state["timers"].values()))


@api.route("/timers", methods=["POST"])
def timers_add():
    body = request.get_json(silent=True) or {}
    tid = new_id()
    state["timers"][tid] = {
        "id": tid, "name": body.get("name", "Новый таймер"),
        "enabled": bool(body.get("enabled", True)),
        "kind": body.get("kind", "interval"),
        "interval_sec": body.get("interval_sec", 60),
        "time": body.get("time", "08:00"),
        "weekdays": body.get("weekdays", []),
        "at_iso": body.get("at_iso", ""),
        "last_fired_iso": None,
        "actions": body.get("actions", []),
    }
    save_state()
    return jsonify(state["timers"][tid]), 201


@api.route("/timers/<tid>", methods=["POST"])
def timers_update(tid):
    t = state["timers"].get(tid)
    if not t:
        return jsonify({"error": "not found"}), 404
    body = request.get_json(silent=True) or {}
    for k in ("name", "enabled", "kind", "interval_sec", "time",
              "weekdays", "at_iso", "actions"):
        if k in body:
            t[k] = body[k]
    save_state()
    return jsonify(t)


@api.route("/timers/<tid>", methods=["DELETE"])
def timers_delete(tid):
    if tid not in state["timers"]:
        return jsonify({"error": "not found"}), 404
    del state["timers"][tid]
    save_state()
    return jsonify({"status": "ok"})


# ============================================================
# Импорт / экспорт
# ============================================================
@api.route("/export", methods=["GET"])
def export_json():
    data = json.dumps(state, ensure_ascii=False, indent=2)
    ts = datetime.now().strftime("%Y-%m-%d_%H-%M")
    return Response(
        data,
        mimetype="application/json",
        headers={"Content-Disposition": f'attachment; filename="smarthome-{ts}.json"'},
    )


@api.route("/version", methods=["GET"])
def version():
    from state import STATE_VERSION
    return jsonify({"v": STATE_VERSION})


@api.route("/import", methods=["POST"])
def import_json():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"error": "invalid json"}), 400
    for k in ("devices", "events", "scenarios", "scenario_groups",
              "timers", "rooms", "mqtt_triggers", "custom_types"):
        if k in body and isinstance(body[k], dict):
            state[k] = body[k]
    if "plan" in body and isinstance(body["plan"], dict):
        state["plan"] = body["plan"]
    if "mqtt" in body and isinstance(body["mqtt"], dict):
        state["mqtt"].update(body["mqtt"])
    if "settings" in body and isinstance(body["settings"], dict):
        state["settings"].update(body["settings"])

    # ← Lua-скрипты: пишем в отдельную папку
    if "lua_scripts" in body and isinstance(body["lua_scripts"], dict):
        for sid, rec in body["lua_scripts"].items():
            if not isinstance(rec, dict):
                continue
            rec = dict(rec)         # копия, чтобы не мутировать body
            rec["id"] = sid
            lua_store.save_one(rec)
        state["lua_scripts"] = lua_store.load_all()

    save_state()
    return jsonify({"status": "ok"})


# ============================================================
# Пользовательские типы устройств
# ============================================================
@api.route("/custom_types", methods=["GET"])
def custom_types_list():
    return jsonify(state.get("custom_types", {}))


@api.route("/custom_types", methods=["POST"])
def custom_types_add():
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name required"}), 400

    tid = body.get("id") or new_id()
    if tid in state.get("custom_types", {}):
        return jsonify({"error": "type already exists"}), 400

    fields = body.get("fields") or []
    if not isinstance(fields, list) or not fields:
        return jsonify({"error": "fields required"}), 400

    # нормализуем icon_rules (для типа)
    icon_rules_norm = []
    if "icon_rules" in body and isinstance(body["icon_rules"], list):
        for r in body["icon_rules"]:
            if not isinstance(r, dict):
                continue
            field = (r.get("field") or "").strip()
            if not field:
                continue
            op = r.get("op") or "=="
            if op not in ("==","!=",">","<",">=","<=","contains","between"):
                op = "=="
            icon = (r.get("icon") or "").strip()
            if not icon:
                continue
            icon_rules_norm.append({
                "field": field, "op": op,
                "value": r.get("value"), "icon": icon,
            })
    norm_fields = []
    for f in fields:
        if not isinstance(f, dict):
            continue
        fname = (f.get("name") or "").strip()
        if not fname:
            continue
        ftype = f.get("type") or "bool"
        if ftype not in ("bool", "number", "string"):
            ftype = "string"
        fcontrol = f.get("control") or (
            "switch" if ftype == "bool" else
            "number" if ftype == "number" else "text"
        )
        if fcontrol not in ("switch", "button", "slider", "number",
                            "text", "select", "onoff"):
            fcontrol = "text"
        default = f.get("default")
        if ftype == "bool":
            default = bool(default) if default is not None else False
        elif ftype == "number":
            try:
                default = float(default) if default not in (None, "") else 0
            except (TypeError, ValueError):
                default = 0
        else:
            default = str(default) if default is not None else ""

        options = f.get("options") or []
        if not isinstance(options, list):
            options = []
        options = [str(o) for o in options if str(o).strip()]

        flabel = (f.get("label") or "").strip()

        norm_fields.append({
            "name": fname,
            "label": flabel,
            "type": ftype,
            "control": fcontrol,
            "default": default,
            "options": options,
        })

    if not norm_fields:
        return jsonify({"error": "no valid fields"}), 400

    display_field = (body.get("display_field") or "").strip()
    field_names = {f["name"] for f in norm_fields}
    if display_field and display_field not in field_names:
        display_field = ""

    state.setdefault("custom_types", {})[tid] = {
        "id": tid,
        "name": name,
        "icon": body.get("icon") or "📦",
        "label": body.get("label") or name,
        "display_field": display_field,
        "fields": norm_fields,
        "icon_rules": icon_rules_norm,
    }
    save_state()
    return jsonify(state["custom_types"][tid]), 201


@api.route("/custom_types/<tid>", methods=["POST"])
def custom_types_update(tid):
    t = state.get("custom_types", {}).get(tid)
    if not t:
        return jsonify({"error": "not found"}), 404

    body = request.get_json(silent=True) or {}

    if "icon_rules" in body and isinstance(body["icon_rules"], list):
        norm = []
        for r in body["icon_rules"]:
            if not isinstance(r, dict):
                continue
            field = (r.get("field") or "").strip()
            if not field:
                continue
            op = r.get("op") or "=="
            if op not in ("==","!=",">","<",">=","<=","contains","between"):
                op = "=="
            icon = (r.get("icon") or "").strip()
            if not icon:
                continue
            norm.append({
                "field": field, "op": op,
                "value": r.get("value"), "icon": icon,
            })
        t["icon_rules"] = norm
    if "name" in body and body["name"].strip():
        t["name"] = body["name"].strip()
    if "icon" in body:
        t["icon"] = body["icon"] or t.get("icon") or "📦"
    if "label" in body and body["label"].strip():
        t["label"] = body["label"].strip()

    if "fields" in body and isinstance(body["fields"], list):
        norm_fields = []
        for f in body["fields"]:
            if not isinstance(f, dict):
                continue
            fname = (f.get("name") or "").strip()
            if not fname:
                continue
            ftype = f.get("type") or "bool"
            if ftype not in ("bool", "number", "string"):
                ftype = "string"
            fcontrol = f.get("control") or (
                "switch" if ftype == "bool" else
                "number" if ftype == "number" else "text"
            )
            if fcontrol not in ("switch", "button", "slider", "number",
                                "text", "select", "onoff"):
                fcontrol = "text"
            default = f.get("default")
            if ftype == "bool":
                default = bool(default) if default is not None else False
            elif ftype == "number":
                try:
                    default = float(default) if default not in (None, "") else 0
                except (TypeError, ValueError):
                    default = 0
            else:
                default = str(default) if default is not None else ""

            options = f.get("options") or []
            if not isinstance(options, list):
                options = []
            options = [str(o) for o in options if str(o).strip()]

            flabel = (f.get("label") or "").strip()

            norm_fields.append({
                "name": fname,
                "label": flabel,
                "type": ftype,
                "control": fcontrol,
                "default": default,
                "options": options,
            })
        if norm_fields:
            t["fields"] = norm_fields

    if "display_field" in body:
        df = (body.get("display_field") or "").strip()
        names = {f["name"] for f in t.get("fields", [])}
        t["display_field"] = df if df in names else ""

    save_state()
    return jsonify(t)


@api.route("/custom_types/<tid>", methods=["DELETE"])
def custom_types_delete(tid):
    if tid not in state.get("custom_types", {}):
        return jsonify({"error": "not found"}), 404

    # удаляем все устройства этого типа
    to_delete = [did for did, d in state["devices"].items() if d.get("type") == tid]
    for did in to_delete:
        del state["devices"][did]

    del state["custom_types"][tid]
    save_state()
    return jsonify({"status": "ok", "devices_deleted": len(to_delete)})
    
from auth import create_user, users, current_user
from werkzeug.security import generate_password_hash

@api.route("/users", methods=["GET"])
def users_list():
    if not current_user() or not current_user().get("is_admin"):
        return jsonify({"error": "forbidden"}), 403
    return jsonify([
        {"username": u["username"], "is_admin": u.get("is_admin", False),
         "created": u.get("created")}
        for u in users().values()
    ])

   
import os
import subprocess
import sys
import threading
import signal

# ============================================================
# Управление сервером: порт и перезапуск
# ============================================================
@api.route("/server/info", methods=["GET"])
def server_info():
    return jsonify({
        "host": state["settings"].get("host", "0.0.0.0"),
        "port": int(state["settings"].get("port", 5000)),
        "pid": os.getpid(),
        "python": sys.executable,
    })


@api.route("/server/port", methods=["POST"])
def server_set_port():
    body = request.get_json(silent=True) or {}
    try:
        port = int(body.get("port", 5000))
    except (TypeError, ValueError):
        return jsonify({"error": "bad port"}), 400
    if port < 1 or port > 65535:
        return jsonify({"error": "port out of range"}), 400
    state["settings"]["port"] = port
    save_state()
    return jsonify({"status": "ok", "port": port})


@api.route("/server/restart", methods=["POST"])
def server_restart():
    def _restart():
        import time
        time.sleep(0.6)
        if sys.platform.startswith("win"):
            TASK = "GS Smart Server"
            try:
                subprocess.run(["schtasks", "/End", "/TN", TASK], check=False)
                time.sleep(0.5)
                subprocess.run(["schtasks", "/Run", "/TN", TASK], check=False)
            except Exception as e:
                log.info("[restart] schtasks error:%s", e)
            os._exit(0)
        else:
            os.execv(sys.executable, [sys.executable] + sys.argv)

    threading.Thread(target=_restart, daemon=True).start()
    return jsonify({"status": "restarting"})
    
@api.route("/devices/<did>/name", methods=["POST"])
def devices_set_name(did):
    dev = state["devices"].get(did)
    if not dev:
        return jsonify({"error": "not found"}), 404
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name required"}), 400
    dev["name"] = name
    dev["updated"] = datetime.now().isoformat(timespec="seconds")
    save_state()
    return jsonify(dev)

@api.route("/zigbee2mqtt/settings", methods=["GET", "POST"])
def zigbee2mqtt_settings():
    cfg = state["settings"].setdefault(
        "zigbee2mqtt",
        {"enabled": False, "base_topic": "zigbee2mqtt", "host": "http://localhost:8080"}
    )
    if request.method == "POST":
        body = request.get_json(silent=True) or {}
        if "enabled" in body:
            cfg["enabled"] = bool(body["enabled"])
        if "base_topic" in body:
            cfg["base_topic"] = (str(body["base_topic"]) or "zigbee2mqtt").strip() or "zigbee2mqtt"
        if "host" in body:
            cfg["host"] = (str(body["host"]) or "http://localhost:8080").strip() or "http://localhost:8080"
        save_state()
        try:
            import mqtt_client
            if mqtt_client.is_connected():
                mqtt_client.refresh_subscriptions()
        except Exception as e:
            log.info("[z2m] refresh_subscriptions error:%s", e)
    return jsonify(cfg)


@api.route("/zigbee2mqtt/devices", methods=["GET"])
def zigbee2mqtt_devices():
    """Список устройств Z2M, зарегистрированных в нашей системе."""
    out = []
    for dev in state["devices"].values():
        if dev.get("z2m_name"):
            out.append({
                "id": dev["id"],
                "name": dev.get("name", ""),
                "type": dev.get("type", ""),
                "z2m_name": dev.get("z2m_name"),
                "z2m_online": dev.get("z2m_online"),
                "z2m_linkquality": dev.get("z2m_linkquality"),
                "z2m_seen": dev.get("z2m_seen"),
            })
    return jsonify(out)
    
from auth import create_token, list_tokens, delete_token, current_user

# ============================================================
# API-токены
# ============================================================
@api.route("/tokens", methods=["GET"])
def tokens_list():
    u = current_user()
    if not u:
        return jsonify({"error": "unauthorized"}), 401
    # Обычный пользователь видит только свои токены
    return jsonify(list_tokens(username=u["username"]))


@api.route("/tokens", methods=["POST"])
def tokens_add():
    u = current_user()
    if not u:
        return jsonify({"error": "unauthorized"}), 401
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip() or "API-токен"
    rec = create_token(name, u["username"])
    return jsonify(rec), 201


@api.route("/tokens/<tid>", methods=["DELETE"])
def tokens_delete(tid):
    u = current_user()
    if not u:
        return jsonify({"error": "unauthorized"}), 401
    if not delete_token(tid, username=u["username"]):
        return jsonify({"error": "not found"}), 404
    return jsonify({"status": "ok"})
 

# ============================================================
# Zigbee2MQTT: автоимпорт
# ============================================================
@api.route("/zigbee2mqtt/import/preview", methods=["POST"])
def z2m_import_preview():
    """Показывает, что было бы добавлено (dry-run)."""
    try:
        import zigbee2mqtt as z2m_mod
    except ImportError as e:
        return jsonify({"error": f"module zigbee2mqtt.py not found: {e}"}), 500
    report = z2m_mod.import_new_devices(dry_run=True)
    return jsonify(report)


@api.route("/zigbee2mqtt/import", methods=["POST"])
def z2m_import_apply():
    """Реально добавляет новые устройства из Z2M."""
    try:
        import zigbee2mqtt as z2m_mod
    except ImportError as e:
        return jsonify({"error": f"module zigbee2mqtt.py not found: {e}"}), 500
    report = z2m_mod.import_new_devices(dry_run=False)
    return jsonify(report)


@api.route("/zigbee2mqtt/bridge_devices", methods=["GET"])
def z2m_bridge_devices_cached():
    """Список устройств из MQTT bridge/devices (если был получен)."""
    try:
        import zigbee2mqtt as z2m_mod
    except ImportError:
        return jsonify([])
    return jsonify(z2m_mod.get_cached_bridge_devices()) 
    
@api.route("/zigbee2mqtt/bridge_info", methods=["GET"])
def z2m_bridge_info():
    """Информация о MQTT-кэше bridge/devices."""
    try:
        import zigbee2mqtt as z2m_mod
    except ImportError as e:
        return jsonify({"error": f"module zigbee2mqtt.py not found: {e}"}), 500
    return jsonify(z2m_mod.bridge_cache_info())


@api.route("/zigbee2mqtt/import_mqtt/preview", methods=["POST"])
def z2m_import_mqtt_preview():
    try:
        import zigbee2mqtt as z2m_mod
    except ImportError as e:
        return jsonify({"error": f"module zigbee2mqtt.py not found: {e}"}), 500
    report = z2m_mod.import_from_bridge_cache(dry_run=True)
    return jsonify(report)


@api.route("/zigbee2mqtt/import_mqtt", methods=["POST"])
def z2m_import_mqtt_apply():
    try:
        import zigbee2mqtt as z2m_mod
    except ImportError as e:
        return jsonify({"error": f"module zigbee2mqtt.py not found: {e}"}), 500
    report = z2m_mod.import_from_bridge_cache(dry_run=False)
    return jsonify(report)

@api.route("/devices/<did>/z2m_fields", methods=["GET"])
def devices_z2m_fields(did):
    """Поля Z2M для устройства (по данным bridge/devices)."""
    try:
        import zigbee2mqtt as z2m_mod
    except ImportError as e:
        return jsonify({"error": f"module zigbee2mqtt.py not found: {e}"}), 500
    return jsonify(z2m_mod.z2m_fields_for_device(did))
    
@api.route("/notifications", methods=["GET"])
def notifications_list():
    return jsonify(state.get("notifications", [])[-50:])   # последние 50
    
from auth import users, current_user
from werkzeug.security import generate_password_hash

# ============================================================
# Управление пользователями
# ============================================================
def _require_admin():
    u = current_user()
    if not u:
        return None, (jsonify({"error": "unauthorized"}), 401)
    if not u.get("is_admin"):
        return None, (jsonify({"error": "forbidden"}), 403)
    return u, None





@api.route("/users", methods=["POST"])
def users_add():
    u, err = _require_admin()
    if err: return err
    body = request.get_json(silent=True) or {}
    name = (body.get("username") or "").strip()
    pwd  = body.get("password") or ""
    is_admin = bool(body.get("is_admin", False))
    if not name or not pwd:
        return jsonify({"error": "username и password обязательны"}), 400
    if name in users():
        return jsonify({"error": "пользователь уже существует"}), 400
    users()[name] = {
        "username": name,
        "password_hash": generate_password_hash(pwd),
        "is_admin": is_admin,
        "created": datetime.now().isoformat(timespec="seconds"),
    }
    save_state()
    return jsonify({"username": name}), 201


@api.route("/users/<name>", methods=["POST"])
def users_update(name):
    u, err = _require_admin()
    if err: return err
    rec = users().get(name)
    if not rec:
        return jsonify({"error": "not found"}), 404
    body = request.get_json(silent=True) or {}

    if "password" in body and body["password"]:
        rec["password_hash"] = generate_password_hash(body["password"])
    if "is_admin" in body:
        # не дать снять is_admin с последнего администратора
        if not body["is_admin"]:
            admins = [x for x in users().values() if x.get("is_admin")]
            if len(admins) <= 1 and rec.get("is_admin"):
                return jsonify({"error": "нельзя снять права с последнего админа"}), 400
        rec["is_admin"] = bool(body["is_admin"])
    save_state()
    return jsonify({"username": name})


@api.route("/users/<name>", methods=["DELETE"])
def users_delete(name):
    u, err = _require_admin()
    if err: return err
    if name not in users():
        return jsonify({"error": "not found"}), 404
    # нельзя удалить самого себя
    if name == u["username"]:
        return jsonify({"error": "нельзя удалить себя"}), 400
    # нельзя удалить последнего админа
    admins = [x for x in users().values() if x.get("is_admin")]
    if users()[name].get("is_admin") and len(admins) <= 1:
        return jsonify({"error": "нельзя удалить последнего админа"}), 400

    del users()[name]

    # удалить все токены этого пользователя
    toks = state.setdefault("tokens", {})
    for tid in [t for t, rec in toks.items() if rec.get("username") == name]:
        del toks[tid]

    save_state()
    return jsonify({"status": "ok"})


@api.route("/me/password", methods=["POST"])
def me_change_password():
    u = current_user()
    if not u:
        return jsonify({"error": "unauthorized"}), 401
    body = request.get_json(silent=True) or {}
    old = body.get("old") or ""
    new = body.get("new") or ""
    if len(new) < 4:
        return jsonify({"error": "пароль слишком короткий"}), 400
    from werkzeug.security import check_password_hash
    if not check_password_hash(u["password_hash"], old):
        return jsonify({"error": "неверный текущий пароль"}), 400
    u["password_hash"] = generate_password_hash(new)
    save_state()
    return jsonify({"status": "ok"})
    
@api.route("/devices/<did>/icon_rules", methods=["POST"])
def devices_set_icon_rules(did):
    dev = state["devices"].get(did)
    if not dev:
        return jsonify({"error": "not found"}), 404
    body = request.get_json(silent=True) or {}
    rules = body.get("icon_rules")
    if not isinstance(rules, list):
        return jsonify({"error": "icon_rules must be a list"}), 400

    norm = []
    for r in rules:
        if not isinstance(r, dict): continue
        field = (r.get("field") or "").strip()
        if not field: continue
        op = r.get("op") or "=="
        if op not in ("==","!=",">","<",">=","<=","contains","between"):
            op = "=="
        icon = (r.get("icon") or "").strip()
        if not icon: continue
        value = r.get("value")
        norm.append({
            "field": field,
            "op": op,
            "value": value,
            "icon": icon,
        })

    dev["icon_rules"] = norm
    dev["updated"] = datetime.now().isoformat(timespec="seconds")
    save_state()
    return jsonify(dev)
    
# ============================================================
# Modbus
# ============================================================
@api.route("/modbus/settings", methods=["GET", "POST"])
def modbus_settings():
    if request.method == "POST":
        body = request.get_json(silent=True) or {}
        if "poll_ms" in body:
            try:
                state["settings"]["modbus_poll_ms"] = max(200, int(body["poll_ms"]))
            except (TypeError, ValueError):
                pass
        save_state()
        return jsonify({"poll_ms": state["settings"].get("modbus_poll_ms", 2000)})
    return jsonify({"poll_ms": state["settings"].get("modbus_poll_ms", 2000)})


@api.route("/devices/<did>/modbus", methods=["GET", "POST"])
def device_modbus(did):
    dev = state["devices"].get(did)
    if not dev:
        return jsonify({"error": "not found"}), 404
    dev.setdefault("modbus", {"enabled": False, "conn": {}, "fields": {}})
    if request.method == "POST":
        body = request.get_json(silent=True) or {}
        m = dev["modbus"]
        if "enabled" in body:
            m["enabled"] = bool(body["enabled"])
        if "conn" in body and isinstance(body["conn"], dict):
            m.setdefault("conn", {}).update(body["conn"])
        if "fields" in body and isinstance(body["fields"], dict):
            m["fields"] = body["fields"]
        dev["updated"] = datetime.now().isoformat(timespec="seconds")
        save_state()
    return jsonify(dev["modbus"])


@api.route("/devices/<did>/modbus/read", methods=["POST"])
def device_modbus_read(did):
    if did not in state["devices"]:
        return jsonify({"error": "not found"}), 404
    try:
        import modbus_client
        vals = modbus_client.read_device(did)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify(vals)
    

# ============================================================
# KNX
# ============================================================
# ============================================================
# KNX
# ============================================================
@api.route("/knx/settings", methods=["GET", "POST"])
def knx_settings():
    cfg = state["settings"].setdefault("knx", {
        "enabled": False,
        "connection": "automatic",
        "gateway_ip": "",
        "gateway_port": 3671,
        "own_address": "15.15.250",
        "individual_address": "15.15.250",
    })
    if request.method == "POST":
        body = request.get_json(silent=True) or {}
        for k in ("enabled", "connection", "gateway_ip", "gateway_port",
                  "own_address", "individual_address"):
            if k in body:
                cfg[k] = body[k]
        save_state()
        try:
            import knx_client
            knx_client.restart()
        except Exception as e:
            log.info("[knx] restart error: %s", e)
    return jsonify(cfg)


@api.route("/knx/status", methods=["GET"])
def knx_status():
    try:
        import knx_client
        return jsonify(knx_client.get_status())
    except Exception as e:
        return jsonify({
            "available": False,
            "connected": False,
            "last_error": str(e),
            "running": False,
        })


@api.route("/devices/<did>/knx", methods=["GET", "POST"])
def device_knx(did):
    dev = state["devices"].get(did)
    if not dev:
        return jsonify({"error": "not found"}), 404
    dev.setdefault("knx", {"enabled": False, "fields": {}})
    dev["knx"].setdefault("fields", {})
    if request.method == "POST":
        body = request.get_json(silent=True) or {}
        if "enabled" in body:
            dev["knx"]["enabled"] = bool(body["enabled"])
        if "fields" in body and isinstance(body["fields"], dict):
            dev["knx"]["fields"] = body["fields"]
        dev["updated"] = datetime.now().isoformat(timespec="seconds")
        save_state()
        try:
            import knx_client
            knx_client.refresh_subscriptions()
        except Exception:
            pass
    return jsonify(dev["knx"])


@api.route("/devices/<did>/knx/read", methods=["POST"])
def device_knx_read(did):
    if did not in state["devices"]:
        return jsonify({"error": "not found"}), 404
    body = request.get_json(silent=True) or {}
    field = (body.get("field") or "").strip()
    try:
        import knx_client
        if field:
            ok = knx_client.read_field(did, field)
        else:
            # прочитать все поля с адресом чтения
            ok = False
            knx = state["devices"][did].get("knx") or {}
            for f in (knx.get("fields") or {}):
                if knx_client.read_field(did, f):
                    ok = True
        return jsonify({"ok": ok})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
        
# ============================================================
# Логирование полей устройства
# ============================================================
@api.route("/devices/<did>/logging", methods=["GET", "POST"])
def device_logging(did):
    dev = state["devices"].get(did)
    if not dev:
        return jsonify({"error": "not found"}), 404
    dev.setdefault("logging", {"enabled": False, "fields": [], "max": 1000})
    dev["logging"].setdefault("fields", [])
    if request.method == "POST":
        body = request.get_json(silent=True) or {}
        if "enabled" in body:
            dev["logging"]["enabled"] = bool(body["enabled"])
        if "fields" in body and isinstance(body["fields"], list):
            dev["logging"]["fields"] = [str(f) for f in body["fields"]]
        if "max" in body:
            try:
                dev["logging"]["max"] = max(1, min(50000, int(body["max"])))
            except (TypeError, ValueError):
                pass
        dev["updated"] = datetime.now().isoformat(timespec="seconds")
        save_state()
    return jsonify(dev["logging"])



@api.route("/logs/devices", methods=["GET"])
def logs_devices():
    try:
        import logger_store
        return jsonify(logger_store.list_devices())
    except Exception as e:
        return jsonify({"error": str(e)}), 500
        
@api.route("/devices/<did>/logs", methods=["GET"])
def device_logs(did):
    if did not in state["devices"]:
        return jsonify({"error": "not found"}), 404
    field = request.args.get("field") or None
    ts_from = request.args.get("from") or None
    ts_to   = request.args.get("to") or None
    try:
        limit = int(request.args.get("limit", "500"))
    except ValueError:
        limit = 500
    try:
        import logger_store
        rows = logger_store.read(did, field=field, limit=limit,
                                 ts_from=ts_from, ts_to=ts_to)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify(rows)


@api.route("/devices/<did>/logs/series", methods=["GET"])
def device_logs_series(did):
    if did not in state["devices"]:
        return jsonify({"error": "not found"}), 404
    field = (request.args.get("field") or "").strip()
    if not field:
        return jsonify({"error": "field required"}), 400
    ts_from = request.args.get("from") or None
    ts_to   = request.args.get("to") or None
    try:
        max_points = int(request.args.get("max_points", "1000"))
    except ValueError:
        max_points = 1000

    try:
        import logger_store
        data = logger_store.series(did, field=field,
                                   ts_from=ts_from, ts_to=ts_to,
                                   max_points=max_points)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({
        "device_id": did,
        "field": field,
        "from": ts_from,
        "to": ts_to,
        "points": data,
    })
    
# ============================================================
# Графики на планах
# ============================================================
@api.route("/plan/charts", methods=["GET"])
def plan_charts_list():
    plan = request.args.get("plan") or None
    charts = state["plan"].get("charts") or []
    if plan:
        charts = [c for c in charts if c.get("plan") == plan]
    return jsonify(charts)


@api.route("/plan/charts", methods=["POST"])
def plan_charts_add():
    body = request.get_json(silent=True) or {}
    plan = (body.get("plan") or "main").strip() or "main"
    if plan != "main" and plan not in state["rooms"]:
        return jsonify({"error": "plan not found"}), 404
    if not body.get("device_id") or not body.get("field"):
        return jsonify({"error": "device_id and field required"}), 400

    chart = {
        "id": new_id(),
        "plan": plan,
        "device_id": body["device_id"],
        "field": body["field"],
        "series": body.get("series") or [
        {"device_id": body["device_id"], "field": body["field"]}
        ],
        "title": body.get("title") or "",
        "period": body.get("period") or "24h",
        "from": body.get("from"),
        "to": body.get("to"),
        "max_points": int(body.get("max_points") or 300),
        "x": float(body.get("x", 50.0)),
        "y": float(body.get("y", 50.0)),
        "w": float(body.get("w", 26.0)),
        "h": float(body.get("h", 22.0)),
        "style": {
            "bg": (body.get("style") or {}).get("bg", "rgba(20,30,60,.72)"),
            "border": (body.get("style") or {}).get("border", "#4fc3f7"),
            "color": (body.get("style") or {}).get("color", "#ffffff"),
            "type": (body.get("style") or {}).get("type", "line"),
        },
    }
    state["plan"].setdefault("charts", []).append(chart)
    save_state()
    return jsonify(chart), 201


@api.route("/plan/charts/<cid>", methods=["POST"])
def plan_charts_update(cid):
    chart = next((c for c in state["plan"].get("charts", []) if c.get("id") == cid), None)
    if not chart:
        return jsonify({"error": "not found"}), 404

    body = request.get_json(silent=True) or {}

    # простые поля
    for k in ("title", "period", "from", "to", "device_id", "field"):
        if k in body:
            chart[k] = body[k]

    # серии (мультиграфик)
    if "series" in body and isinstance(body["series"], list):
        chart["series"] = body["series"]

    # геометрия
    for k in ("x", "y", "w", "h", "max_points"):
        if k in body:
            try:
                chart[k] = float(body[k]) if k in ("x", "y", "w", "h") else int(body[k])
            except (TypeError, ValueError):
                pass

    # стиль
    if "style" in body and isinstance(body["style"], dict):
        chart.setdefault("style", {}).update(body["style"])

    save_state()
    return jsonify(chart)


@api.route("/plan/charts/<cid>", methods=["DELETE"])
def plan_charts_delete(cid):
    charts = state["plan"].setdefault("charts", [])
    before = len(charts)
    state["plan"]["charts"] = [c for c in charts if c.get("id") != cid]
    if len(state["plan"]["charts"]) == before:
        return jsonify({"error": "not found"}), 404
    save_state()
    return jsonify({"status": "ok"})
    
@api.route("/plan/charts/<cid>/data", methods=["GET"])
def plan_chart_data(cid):
    """Возвращает данные для всех серий графика."""
    chart = next((c for c in state["plan"].get("charts", []) if c.get("id") == cid), None)
    if not chart:
        return jsonify({"error": "not found"}), 404

    # период
    period = chart.get("period") or "24h"
    ts_from = request.args.get("from") or chart.get("from")
    ts_to   = request.args.get("to")   or chart.get("to")

    if not ts_from or not ts_to:
        from datetime import datetime, timedelta
        now = datetime.now()
        hours = 24
        if period == "1h":  hours = 1
        elif period == "7d":  hours = 24 * 7
        elif period == "30d": hours = 24 * 30
        ts_from = (now - timedelta(hours=hours)).isoformat(timespec="seconds")
        ts_to   = now.isoformat(timespec="seconds")

    max_points = int(request.args.get("max_points") or chart.get("max_points") or 300)

    series = chart.get("series") or [
        {"device_id": chart.get("device_id"), "field": chart.get("field")}
    ]

    import logger_store
    result = []
    for s in series:
        did = s.get("device_id")
        fld = s.get("field")
        if not did or not fld:
            continue
        try:
            pts = logger_store.series(did, field=fld,
                                      ts_from=ts_from, ts_to=ts_to,
                                      max_points=max_points)
        except Exception as e:
            pts = []
        result.append({
            "device_id": did,
            "field": fld,
            "points": pts,
        })

    return jsonify({
        "chart_id": cid,
        "from": ts_from,
        "to": ts_to,
        "series": result,
    })
    
@api.route("/lua/run", methods=["POST"])
def lua_run():
    body = request.get_json(silent=True) or {}
    code = body.get("code", "")
    if not code:
        return jsonify({"error": "code required"}), 400
    import lua_engine
    result = lua_engine.run_script(code)
    return jsonify(result)


@api.route("/lua/devices", methods=["GET"])
def lua_devices_list():
    """Список устройств для подсказок в редакторе."""
    return jsonify({
        did: {"name": d.get("name"), "fields": list(d.get("state", {}).keys())}
        for did, d in state["devices"].items()
    })
    
# ============================================================
# Lua-скрипты
# ============================================================
@api.route("/lua_scripts", methods=["GET"])
def lua_scripts_list():
    # перечитываем с диска — на случай ручных правок
    try:
        state["lua_scripts"] = lua_store.load_all()
    except Exception as e:
        log.warning("[lua] load_all error: %s", e, exc_info=True)
        # не глотаем — вернём ошибку клиенту, чтобы понять, в чём дело
        return jsonify({"error": f"lua_store.load_all: {e}"}), 500
    scripts = list(state.get("lua_scripts", {}).values())
    scripts.sort(key=lambda s: (s.get("name", "").lower()))
    return jsonify(scripts)



@api.route("/lua_scripts/<sid>/run", methods=["POST"])
def lua_scripts_run(sid):
    s = state.get("lua_scripts", {}).get(sid)
    if not s:
        return jsonify({"error": "not found"}), 404
    if not s.get("enabled"):
        return jsonify({"ok": False, "error": "скрипт отключён"}), 400
    import lua_engine
    result = lua_engine.run_script(s.get("code", ""), context={
        "trigger": "manual",
        "script_id": sid,          
    })
    return jsonify(result)
    
@api.route("/lua_scripts/<sid>/logs", methods=["GET"])
def lua_scripts_logs(sid):
    import lua_engine
    return jsonify(lua_engine._lua_logs.get(sid, []))


@api.route("/lua_scripts/<sid>/logs", methods=["DELETE"])
def lua_scripts_logs_clear(sid):
    import lua_engine
    lua_engine._lua_logs[sid] = []
    return jsonify({"status": "ok"})
    
import lua_store

@api.route("/lua_scripts", methods=["POST"])
def lua_scripts_add():
    body = request.get_json(silent=True) or {}
    sid = new_id()
    rec = {
        "id": sid,
        "name": body.get("name", "Новый скрипт"),
        "description": body.get("description", ""),
        "code": body.get("code", "-- Lua-скрипт\n"),
        "enabled": bool(body.get("enabled", True)),
        "triggers": body.get("triggers", []),
        "updated": datetime.now().isoformat(timespec="seconds"),
    }
    # сохраняем в память И на диск
    state.setdefault("lua_scripts", {})[sid] = rec
    lua_store.save_one(rec)
    save_state()                      # на всякий случай, чтобы devices.json тоже был актуален
    return jsonify(rec), 201


@api.route("/lua_scripts/<sid>", methods=["POST"])
def lua_scripts_update(sid):
    s = state.get("lua_scripts", {}).get(sid)
    if not s:
        return jsonify({"error": "not found"}), 404
    body = request.get_json(silent=True) or {}
    for k in ("name", "description", "code", "enabled", "triggers"):
        if k in body:
            s[k] = body[k]
    s["updated"] = datetime.now().isoformat(timespec="seconds")

    lua_store.save_one(s)             # ← запись на диск
    save_state()
    return jsonify(s)


@api.route("/lua_scripts/<sid>", methods=["DELETE"])
def lua_scripts_delete(sid):
    if sid not in state.get("lua_scripts", {}):
        return jsonify({"error": "not found"}), 404
    del state["lua_scripts"][sid]

    lua_store.delete_one(sid)         # ← удаление файлов
    save_state()
    return jsonify({"status": "ok"})
    
@api.route("/debug/events", methods=["GET"])
def debug_events():
    import event_bus
    return jsonify(event_bus.recent_events(100))
    
@api.route("/knx/import_knxproj/preview", methods=["POST"])
def knx_import_knxproj_preview():
    """Dry-run: показать, что будет создано."""
    if "file" not in request.files:
        return jsonify({"error": "file required"}), 400

    f = request.files["file"]
    password = request.form.get("password", "")
    language = request.form.get("language", "ru-RU")

    # сохраняем во временный файл
    tmp = os.path.join(tempfile.gettempdir(), f"knx_{new_id()}.knxproj")
    f.save(tmp)
    try:
        report = knx_import.import_knxproj(tmp, password, language, dry_run=True)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass

    return jsonify(report)


@api.route("/knx/import_knxproj", methods=["POST"])
def knx_import_knxproj_apply():
    """Реально создать устройства."""
    if "file" not in request.files:
        return jsonify({"error": "file required"}), 400

    f = request.files["file"]
    password = request.form.get("password", "")
    language = request.form.get("language", "ru-RU")

    tmp = os.path.join(tempfile.gettempdir(), f"knx_{new_id()}.knxproj")
    f.save(tmp)
    try:
        report = knx_import.import_knxproj(tmp, password, language, dry_run=False)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass

    try:
        import knx_client
        knx_client.refresh_subscriptions()
    except Exception:
        pass

    return jsonify(report)
    
import knx_ga_store

# ============================================================
# KNX: групповые адреса
# ============================================================
@api.route("/knx/group_addresses", methods=["GET"])
def knx_ga_list():
    """Список всех групповых адресов."""
    try:
        state["knx_group_addresses"] = (
            state.get("knx_group_addresses") or {}
        )
        knx_ga_store.normalize()
        return jsonify(list(state["knx_group_addresses"].values()))
    except Exception as e:
        log.warning("[knx-ga] list error: %s", e, exc_info=True)
        return jsonify({"error": str(e)}), 500


@api.route("/knx/group_addresses/<path:addr>", methods=["POST"])
def knx_ga_update(addr):
    """Редактирование GA: name/dpt/link."""
    rec = knx_ga_store.get(addr)
    if not rec:
        return jsonify({"error": "not found"}), 404
    body = request.get_json(silent=True) or {}
    for k in ("name", "dpt", "readable", "writable"):
        if k in body:
            rec[k] = body[k]
    if "device_id" in body or "field" in body:
        dev_id = body.get("device_id", "")
        field  = body.get("field", "")
        if dev_id and field:
            knx_ga_store.link_to_device(addr, dev_id, field)
        else:
            knx_ga_store.unlink(addr)
    save_state()
    return jsonify(rec)


@api.route("/knx/group_addresses/<path:addr>/write", methods=["POST"])
def knx_ga_write(addr):
    """Записать значение в шину."""
    body = request.get_json(silent=True) or {}
    value = body.get("value")
    dpt = body.get("dpt") or (knx_ga_store.get(addr) or {}).get("dpt") or "DPT-1.001"

    try:
        import knx_client
    except ImportError:
        return jsonify({"error": "knx_client not available"}), 500

    if not knx_client.is_connected():
        return jsonify({"error": "KNX не подключён"}), 400

    try:
        ok = knx_client.write_group_address(addr, value, dpt)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    if not ok:
        return jsonify({"error": "write failed"}), 500

    knx_ga_store.set_value(addr, value, source="ui")
    return jsonify({"status": "ok", "address": addr, "value": value})


@api.route("/knx/group_addresses/<path:addr>/read", methods=["POST"])
def knx_ga_read(addr):
    """Отправить GroupValueRead."""
    try:
        import knx_client
    except ImportError:
        return jsonify({"error": "knx_client not available"}), 500

    if not knx_client.is_connected():
        return jsonify({"error": "KNX не подключён"}), 400

    ok = knx_client.read_group_address(addr)
    return jsonify({"ok": ok})


@api.route("/knx/group_addresses/import", methods=["POST"])
def knx_ga_import():
    """Полный импорт GA из проекта (без устройств)."""
    if "file" not in request.files:
        return jsonify({"error": "file required"}), 400
    f = request.files["file"]
    password = request.form.get("password", "")
    language = request.form.get("language", "ru-RU")

    tmp = os.path.join(tempfile.gettempdir(), f"knx_{new_id()}.knxproj")
    f.save(tmp)
    try:
        project = knx_import.parse_knxproj(tmp, password, language)
        items = []
        for ga_addr, ga in (project.get("group_addresses") or {}).items():
            items.append({
                "address": ga_addr,
                "name": ga.get("name", ""),
                "dpt": knx_import._dpt_str(ga.get("dpt")),
            })
        count = knx_ga_store.bulk_upsert(items)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass

    return jsonify({"status": "ok", "imported": count})
    
@api.route("/knx/group_addresses", methods=["POST"])
def knx_ga_add():
    """Ручное добавление GA в реестр."""
    body = request.get_json(silent=True) or {}
    addr = (body.get("address") or "").strip()
    if not addr:
        return jsonify({"error": "address required"}), 400

    # Формат X/Y/Z
    import re
    if not re.match(r"^\d+/\d+/\d+$", addr):
        return jsonify({"error": "address must be X/Y/Z (например 1/2/3)"}), 400

    # Проверка, что такого адреса ещё нет
    existing = knx_ga_store.get(addr)
    if existing:
        return jsonify({"error": "address already exists",
                        "ga": existing}), 409

    name = (body.get("name") or "").strip()
    dpt  = (body.get("dpt") or "").strip() or "DPT-1.001"

    rec = knx_ga_store.upsert(
        addr,
        name=name,
        dpt=dpt,
        value=None,
        updated="",
        readable=bool(body.get("readable", True)),
        writable=bool(body.get("writable", True)),
    )
    save_state()
    return jsonify(rec), 201
    
@api.route("/devices/bulk_delete", methods=["POST"])
def devices_bulk_delete():
    body = request.get_json(silent=True) or {}
    ids = body.get("ids") or []
    deleted = 0
    for did in ids:
        if did in state["devices"]:
            del state["devices"][did]
            deleted += 1
            # (опционально) отвязать GA
            try:
                import knx_ga_store
                for ga in knx_ga_store.all_gas().values():
                    if ga.get("device_id") == did:
                        ga["device_id"] = ""
                        ga["field"] = ""
            except Exception:
                pass
    save_state()
    return jsonify({"status": "ok", "deleted": deleted})
    
    
import os, json

_THEME_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'theme.json')
_DEFAULT_THEME = 'deepblue'

@api.route("/theme", methods=["GET"])
def theme_get():
    if not os.path.exists(_THEME_FILE):
        return jsonify({"theme": _DEFAULT_THEME})
    try:
        with open(_THEME_FILE, encoding='utf-8') as f:
            data = json.load(f)
        return jsonify({"theme": data.get('theme', _DEFAULT_THEME)})
    except Exception:
        return jsonify({"theme": _DEFAULT_THEME})

@api.route("/theme", methods=["POST"])
def theme_set():
    data = request.get_json(silent=True) or {}
    theme = data.get("theme", _DEFAULT_THEME)
    try:
        with open(_THEME_FILE, 'w', encoding='utf-8') as f:
            json.dump({"theme": theme}, f, ensure_ascii=False)
        return jsonify({"ok": True, "theme": theme})
    except Exception as e:
        # не 500 — отдаём дефолт, чтобы UI не падал
        return jsonify({"ok": False, "error": str(e), "theme": _DEFAULT_THEME})
        

# ============================================================
# Telegram настройки
# ============================================================

@api.route("/settings/telegram", methods=["GET"])
def api_get_telegram_settings():
    tg = (state.get("settings", {}) or {}).get("telegram", {}) or {}
    token = tg.get("bot_token") or ""
    masked = (token[:6] + "…" + token[-4:]) if len(token) > 12 else ("•••" if token else "")
    return jsonify({
        "enabled": bool(tg.get("enabled")),
        "bot_token_masked": masked,
        "has_token": bool(token),
        "default_chat_id": tg.get("default_chat_id") or "",
        "parse_mode": tg.get("parse_mode") or "",
        "notify_on_errors": bool(tg.get("notify_on_errors", True)),
        "proxy_url": tg.get("proxy_url") or "",
    })


@api.route("/settings/telegram", methods=["POST"])
def api_save_telegram_settings():
    data = request.get_json(force=True) or {}
    tg = state.setdefault("settings", {}).setdefault("telegram", {})

    if "enabled" in data:
        tg["enabled"] = bool(data["enabled"])
    if "default_chat_id" in data:
        tg["default_chat_id"] = str(data["default_chat_id"] or "").strip()
    if "parse_mode" in data:
        pm = str(data["parse_mode"] or "").strip()
        tg["parse_mode"] = pm if pm in ("", "HTML", "Markdown") else ""
    if "notify_on_errors" in data:
        tg["notify_on_errors"] = bool(data["notify_on_errors"])
    if "proxy_url" in data:
        tg["proxy_url"] = str(data["proxy_url"] or "").strip()

    new_token = (data.get("bot_token") or "").strip()
    if new_token and "…" not in new_token and "•" not in new_token:
        tg["bot_token"] = new_token

    save_state()
    return jsonify({"ok": True})


@api.route("/settings/telegram/test", methods=["POST"])
def api_telegram_test():
    import lua_engine
    me = lua_engine._api_telegram_me()
    if not me.get("ok"):
        return jsonify({"ok": False, "error": me.get("error") or "getMe failed"})
    bot = me.get("result") or {}
    sent = lua_engine._api_telegram_send(
        None, f"✅ Тест из GS Smart\nБот: @{bot.get('username','?')}"
    )
    if not sent.get("ok"):
        return jsonify({"ok": False, "bot": bot, "error": sent.get("error")})
    return jsonify({"ok": True, "bot": bot})





