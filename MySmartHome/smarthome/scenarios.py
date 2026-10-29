from datetime import datetime
from state import state
from http_client import fire_requests
from http_client import render_placeholders
import logging
from events import trigger_events

log = logging.getLogger("smarthome.scenarios")
def get_device_value(device_id, field):
    dev = state["devices"].get(device_id)
    return dev["state"].get(field) if dev else None


def cmp_values(left, op, right):
    if op == "contains":
        return str(right).lower() in str(left).lower()
    try:
        l, r = float(left), float(right)
    except (TypeError, ValueError):
        l, r = str(left), str(right)
    if op == "==":  return l == r
    if op == "!=":  return l != r
    if op == ">":   return l > r
    if op == "<":   return l < r
    if op == ">=":  return l >= r
    if op == "<=":  return l <= r
    return False


def eval_condition(cond):
    val = get_device_value(cond.get("device"), cond.get("field"))
    if val is None:
        return False
    res = cmp_values(val, cond.get("op", "=="), cond.get("value"))
    return (not res) if cond.get("negate") else res


def eval_scenario(sc):
    conds = sc.get("conditions", [])
    if not conds:
        return False
    logic = sc.get("logic", "AND").upper()
    results = [eval_condition(c) for c in conds]
    if logic == "AND": return all(results)
    if logic == "OR":  return any(results)
    if logic == "NOT": return not all(results)
    return False

def _do_notify(act):
    """Отправляет уведомление всем подключённым SSE-клиентам.
    UI покажет браузерное Notification."""
    title = render_placeholders(act.get("title") or "Уведомление")
    body  = render_placeholders(act.get("body")  or "")
    level = act.get("level") or "info"   # info | warning | error
    tag   = act.get("tag")   or ""

    payload = {
        "title": title,
        "body":  body,
        "level": level,
        "tag":   tag,
    }

    # 1) всем SSE-клиентам
    try:
        from api import notify_clients
        notify_clients("notify", payload)
    except Exception as e:
        log.info("[scenarios] notify SSE error:%s", e)

    # 2) сохранить в историю уведомлений
    try:
        state.setdefault("notifications", [])
        state["notifications"].append({
            "ts":    __import__("datetime").datetime.now().isoformat(timespec="seconds"),
            "title": title,
            "body":  body,
            "level": level,
            "tag":   tag,
        })
        # ограничим историю 200 последними
        if len(state["notifications"]) > 200:
            state["notifications"] = state["notifications"][-200:]
        from state import save_state
        save_state()
    except Exception as e:
        log.info("[scenarios] notify save error:%s", e)

    log.info(f"[scenarios] notify: {title} — {body}")

import time
import threading

def _do_action(act):
    """Выполняет одно действие (кроме delay).
    Поддерживает: set_state, request, mqtt_publish, notify, lua."""
    if not isinstance(act, dict):
        return
    t = act.get("type")
    try:
        # ---------- set_state ----------
        if t == "set_state":
            dev_id = act.get("device")
            field  = act.get("field")
            if not dev_id or field is None:
                log.info("[scenarios] set_state: не указаны device/field")
                return

            value = _resolve_set_state_value(act)

            src_mode = ((act.get("value_source") or {}).get("mode") or "const").lower()
            if value is None and src_mode in ("device", "expr"):
                log.info(f"[scenarios] set_state: значение не получено для {dev_id}.{field} "
                      f"(mode={src_mode}) — пропускаем")
                return

            from devices import set_device_state
            changed = set_device_state(dev_id, {field: value}) or {}

            if changed:
                try:
                    from state import save_state
                    save_state()
                except Exception as e:
                    log.info("[scenarios] set_state save_state error:%s", e)
                try:
                    from api import notify_state_changed
                    notify_state_changed()
                except Exception:
                    pass
                for k, v in changed.items():
                    try:
                        trigger_events(dev_id, k, v)
                    except Exception as e:
                        log.info("[scenarios] trigger_events error:%s", e)

            log.info(f"[scenarios] set_state: {dev_id}.{field} = {value!r} "
                  f"(mode={src_mode})")

        # ---------- request ----------
        elif t == "request":
            if act.get("enabled", True):
                from http_client import perform_request
                perform_request(act)

        # ---------- mqtt_publish ----------
        elif t == "mqtt_publish":
            if act.get("enabled", True):
                from mqtt_client import publish_template
                publish_template(
                    act.get("topic", ""),
                    act.get("payload", ""),
                    device_id=act.get("device_id") or None,
                    retain=bool(act.get("retain", False)),
                    qos=int(act.get("qos", 0) or 0),
                )

        # ---------- lua ----------
        elif t == "lua":
            if act.get("enabled", True):
                import lua_engine
                script_id = act.get("script_id")
                code = act.get("code") or ""
                if script_id:
                    s = state.get("lua_scripts", {}).get(script_id)
                    if s and s.get("enabled"):
                        lua_engine.run_script(
                            s["code"],
                            context={"trigger": "scenario", "script_id": script_id},
                        )
                    else:
                        log.info("[scenarios] lua: скрипт %s не найден или отключён", script_id)
                elif code:
                    lua_engine.run_script(code, context={"trigger": "scenario"})

        # ---------- notify ----------
        elif t == "notify":
            if act.get("enabled", True):
                try:
                    _do_notify(act)
                except Exception as e:
                    log.info("[scenarios] notify error:%s", e)

        # ---------- неизвестное действие ----------
        else:
            log.info(f"[scenarios] неизвестный тип действия: {t!r}")

    except Exception as e:
        log.info("[scenarios] action error:%s %s", t, e)

def _resolve_set_state_value(act):
    """Вычисляет значение для действия set_state с учётом value_source.

    Режимы:
      - const  : берётся act["value"] (по умолчанию)
      - device : берётся текущее значение devices[source.device].state[source.field]
      - expr   : строка с плейсхолдерами {dev:xxx:field}, приводится к числу/строке/bool
    Возвращает None, если значение получить не удалось.
    """
    src = act.get("value_source") or {}
    mode = (src.get("mode") or "const").lower()

    # ---------- const ----------
    if mode == "const":
        return act.get("value")

    # ---------- device ----------
    if mode == "device":
        src_dev_id = (src.get("device") or "").strip()
        src_field  = (src.get("field")  or "").strip()
        if not src_dev_id or not src_field:
            log.info("[scenarios] value_source=device: не указаны device/field")
            return None
        src_dev = state["devices"].get(src_dev_id)
        if not src_dev:
            log.info(f"[scenarios] value_source=device: устройство не найдено: {src_dev_id}")
            return None
        st = src_dev.get("state") or {}
        if src_field not in st:
            log.info(f"[scenarios] value_source=device: нет поля {src_field} у {src_dev_id}")
            return None
        return st[src_field]

    # ---------- expr ----------
    if mode == "expr":
        expr = (src.get("expr") or "").strip()
        if not expr:
            log.info("[scenarios] value_source=expr: пустое выражение")
            return None
        try:
            from http_client import render_placeholders
            rendered = render_placeholders(expr)
        except Exception as e:
            log.info("[scenarios] value_source=expr: ошибка render_placeholders:%s", e)
            return None

        s = (rendered or "").strip()

        # приведение типа: bool → number → str
        if s.lower() in ("true", "false"):
            return s.lower() == "true"
        try:
            # int, если нет точки и не пусто
            if s and ("." not in s) and ("e" not in s.lower()):
                return int(s)
        except ValueError:
            pass
        try:
            return float(s)
        except ValueError:
            pass
        return rendered

    # ---------- неизвестный режим ----------
    log.info(f"[scenarios] value_source: неизвестный mode={mode!r}, использую value")
    return act.get("value")

def _run_actions_worker(actions, initial_delay=0):
    try:
        d0 = float(initial_delay or 0)
    except (TypeError, ValueError):
        d0 = 0
    if d0 > 0:
        time.sleep(min(d0, 3600))

    for act in actions or []:
        if not isinstance(act, dict):
            continue
        t = act.get("type")
        if t == "delay":
            try:
                sec = float(act.get("seconds") or 0)
            except (TypeError, ValueError):
                sec = 0
            if sec > 0:
                time.sleep(min(sec, 3600))
            continue

        _do_action(act)

        # После каждого действия — уведомить SSE-клиентов
        try:
            from api import notify_state_changed
            notify_state_changed()
        except Exception:
            pass

    # В конце — проверить сценарии ещё раз (на случай цепочек)
    try:
        from scenarios import run_all_scenarios
        run_all_scenarios()
    except Exception:
        pass


def run_actions(actions, initial_delay=0):
    """Синхронное выполнение (оставлено для совместимости).
    ВНИМАНИЕ: блокирует поток. Используйте run_actions_async,
    если в actions есть задержки."""
    _run_actions_worker(actions, initial_delay)

def run_actions_async(actions, initial_delay=0):
    log.info(f"[scenarios] run_actions_async: initial_delay = {initial_delay}, actions = {len(actions or [])}")
  
    th = threading.Thread(
    target=_run_actions_worker,
    args=(actions, initial_delay),
    daemon=True,
)
    th.start()
    return th

_scenario_last = {}


def run_all_scenarios():
    for sc in state["scenarios"].values():
        if not sc.get("enabled", True):
            continue
        try:
            result = eval_scenario(sc)
        except Exception as e:
            log.info("[scenario]", sc.get("name"), "error:%s", e)
            continue
        prev = _scenario_last.get(sc["id"])
        _scenario_last[sc["id"]] = result
        if result and not prev:
           run_actions_async(sc.get("actions", []), initial_delay=sc.get("initial_delay", 0))