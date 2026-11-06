# devices.py
from datetime import datetime
from state import state, save_state, new_id
import logging
import ast
import operator as op
import re

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
    "virtual": [
        # Иконки для виртуальных устройств можно задать позже через UI
    ],
}


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
    if dtype == "virtual":
        return {
            "value": 0.0,
            "formula": "",
            "unit": "",
            "updated": None,
        }

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
            "fields": {},
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

    # Пересчёт виртуальных устройств (если изменилось что-то, что может влиять)
    try:
        recalc_virtuals()
    except Exception as e:
        log.warning("[devices] recalc_virtuals error: %s", e)

    # SSE
    try:
        from api import notify_state_changed
        notify_state_changed()
    except Exception as e:
        log.error("[devices] notify_state_changed error:%s", e)

    return changed


# ============================================================
# Виртуальные устройства
# ============================================================

_ALLOWED_BINOPS = {
    ast.Add: op.add, ast.Sub: op.sub, ast.Mult: op.mul,
    ast.Div: op.truediv, ast.FloorDiv: op.floordiv,
    ast.Mod: op.mod, ast.Pow: op.pow,
}
_ALLOWED_UNARY = {ast.UAdd: op.pos, ast.USub: op.neg}
_ALLOWED_FUNCS = {
    "abs": abs, "min": min, "max": max, "round": round,
    "int": int, "float": float,
}


def _safe_eval_expr(expr: str):
    """Безопасно вычисляет математическое выражение (без eval)."""
    try:
        node = ast.parse(str(expr), mode="eval")
    except SyntaxError:
        # Если это просто число — вернём его
        try:
            return float(expr)
        except (ValueError, TypeError):
            return 0.0

    def _ev(n):
        if isinstance(n, ast.Expression): return _ev(n.body)
        if isinstance(n, ast.Constant):   return n.value
        if isinstance(n, ast.Name):
            if n.id in _ALLOWED_FUNCS: return _ALLOWED_FUNCS[n.id]
            raise ValueError(n.id)
        if isinstance(n, ast.BinOp) and type(n.op) in _ALLOWED_BINOPS:
            return _ALLOWED_BINOPS[type(n.op)](_ev(n.left), _ev(n.right))
        if isinstance(n, ast.UnaryOp) and type(n.op) in _ALLOWED_UNARY:
            return _ALLOWED_UNARY[type(n.op)](_ev(n.operand))
        if isinstance(n, ast.Call):
            f = _ev(n.func)
            if f not in _ALLOWED_FUNCS.values():
                raise ValueError("call not allowed")
            return f(*[_ev(a) for a in n.args])
        if isinstance(n, (ast.Tuple, ast.List)):
            return [_ev(e) for e in n.elts]
        raise ValueError(type(n).__name__)

    try:
        result = _ev(node)
        return float(result) if isinstance(result, (int, float)) else 0.0
    except Exception:
        return 0.0


def _render_formula(formula: str) -> str:
    """
    Подставляет значения из устройств в формулу.
    Ищет паттерны {dev_id:field} и заменяет их на текущие значения.
    """
    def _repl(m):
        dev_id = m.group(1)
        field = m.group(2)
        dev = state["devices"].get(dev_id)
        if not dev:
            return "0"
        val = (dev.get("state") or {}).get(field)
        if val is None:
            return "0"
        return str(val)

    # Паттерн {dev_id:field}
    return re.sub(r"\{([^:}]+):([^}]+)\}", _repl, formula)


def recalc_virtuals():
    """
    Пересчитывает все виртуальные устройства.
    Вызывается после изменения любого устройства (через set_device_state)
    или по запросу из API.
    """
    virtuals = [
        (did, dev) for did, dev in state["devices"].items()
        if dev.get("type") == "virtual"
    ]
    if not virtuals:
        return

    any_changed = False

    for did, dev in virtuals:
        st = dev.get("state") or {}
        formula = (st.get("formula") or "").strip()
        if not formula:
            continue

        try:
            # 1. Подставляем значения из других устройств
            rendered = _render_formula(formula)

            # 2. Вычисляем
            value = _safe_eval_expr(rendered)

            # 3. Обновляем состояние
            old = st.get("value")
            if old != value:
                st["value"] = value
                st["updated"] = datetime.now().isoformat(timespec="seconds")
                dev["updated"] = st["updated"]
                any_changed = True

                # Уведомляем UI
                try:
                    from api import notify_state_changed
                    notify_state_changed()
                except Exception:
                    pass

                # Событие для сценариев / event_bus
                try:
                    import event_bus
                    event_bus.publish(
                        "device_changed",
                        source="virtual",
                        device_id=did,
                        field="value",
                        value=value,
                        old_value=old,
                    )
                except Exception:
                    pass

                # BACnet
                try:
                    import bacnet_server
                    bacnet_server.update_value(f"{did}:value", value)
                except Exception:
                    pass

                # Сценарии
                try:
                    from scenarios import run_all_scenarios
                    run_all_scenarios()
                except Exception:
                    pass

        except Exception as e:
            log.warning("[devices] recalc_virtuals %s error: %s", did, e)

    if any_changed:
        save_state()


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