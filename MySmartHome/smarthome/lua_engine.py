# lua_engine.py
import logging
import json as _json
import urllib.request
import urllib.error


def _api_http_get(url, timeout=10):
    """GET-запрос, возвращает (body_str, status_code)."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "SmartHome/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            return body, resp.status
    except urllib.error.HTTPError as e:
        try:
            body = e.read().decode("utf-8", errors="replace")
        except Exception:
            body = ""
        return body, e.code
    except Exception as e:
        log.warning("[lua] http.get error: %s", e)
        return str(e), 0


def _api_http_tcp_check(host, port, timeout=5):
    """Проверка доступности TCP-порта. Возвращает (ok: bool, err: str|None)."""
    import socket as _socket
    try:
        s = _socket.create_connection((host, int(port)), timeout=timeout)
        s.close()
        return True, None
    except Exception as e:
        return False, str(e)


def _api_json_decode(text):
    """Разбор JSON-строки в Lua-таблицу (через рекурсию lupa)."""
    try:
        return _json.loads(text)
    except Exception as e:
        log.warning("[lua] json.decode error: %s", e)
        return None


def _api_json_encode(obj):
    """Сериализация питоновского объекта (полученного из Lua) в JSON."""
    try:
        return _json.dumps(obj, ensure_ascii=False)
    except Exception as e:
        log.warning("[lua] json.encode error: %s", e)
        return None
from state import state, save_state

log = logging.getLogger("smarthome.lua")

try:
    import lupa
    from lupa import LuaRuntime
    LUPA_AVAILABLE = True
except ImportError:
    LUPA_AVAILABLE = False


_runtime = None


def _api_device_get(dev_id, field=None):
    dev = state["devices"].get(dev_id)
    if not dev:
        return None
    if field:
        return dev.get("state", {}).get(field)
    return dict(dev.get("state", {}))


def _api_device_set(dev_id, field, value):
    from devices import set_device_state
    dev = state["devices"].get(dev_id)
    if not dev:
        return False
    if field not in dev.get("state", {}):
        return False
    set_device_state(dev_id, {field: value})
    save_state()
    return True


def _api_device_list():
    return {did: d.get("name", did) for did, d in state["devices"].items()}


def _api_knx_read(dev_id, field):
    try:
        import knx_client
        return knx_client.read_field(dev_id, field)
    except Exception as e:
        log.warning("[lua] knx.read error: %s", e)
        return False


def _api_knx_write(dev_id, field, value):
    try:
        import knx_client
        return knx_client.publish_fields(dev_id, {field: value})
    except Exception as e:
        log.warning("[lua] knx.write error: %s", e)
        return False


def _api_modbus_read(dev_id, field):
    try:
        import modbus_client
        vals = modbus_client.read_device(dev_id)
        return vals.get(field) if isinstance(vals, dict) else None
    except Exception as e:
        log.warning("[lua] modbus.read error: %s", e)
        return None


def _api_modbus_write(dev_id, field, value):
    try:
        import modbus_client
        return modbus_client.write_field(dev_id, field, value)
    except Exception as e:
        log.warning("[lua] modbus.write error: %s", e)
        return False


def _api_mqtt_publish(topic, payload, retain=False, qos=0):
    try:
        import mqtt_client
        return mqtt_client.publish_raw(topic, payload, retain=retain, qos=qos)
    except Exception as e:
        log.warning("[lua] mqtt.publish error: %s", e)
        return False

# ============================================================
# Telegram Bot API
# ============================================================
# Настройки берутся из state["telegram"]:
#   { "enabled": bool, "bot_token": str, "default_chat_id": str|int }
# Либо можно передавать token/chat_id напрямую в вызове функции.

def _telegram_config():
    """Возвращает (enabled, token, default_chat_id, parse_mode)."""
    try:
        from state import state
        tg = (state.get("settings", {}) or {}).get("telegram", {}) or {}
        return (
            bool(tg.get("enabled")),
            (tg.get("bot_token") or "").strip(),
            tg.get("default_chat_id"),
            (tg.get("parse_mode") or "").strip() or None,
        )
    except Exception:
        return (False, "", None, None)


def _telegram_request(method, payload, token=None, timeout=15):
    enabled, cfg_token, _, _ = _telegram_config()
    tok = (token or cfg_token or "").strip()
    if not tok:
        return {"ok": False, "error": "telegram: bot_token не настроен"}
    if not enabled and not token:
        return {"ok": False, "error": "telegram: интеграция отключена в настройках"}

    url = f"https://api.telegram.org/bot{tok}/{method}"
    data = _json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "SmartHome/1.0",
        },
        method="POST",
    )

    # --- Прокси (безопасное чтение) ---
    try:
        from state import state as _st
        _tg = (_st.get("settings", {}) or {}).get("telegram", {}) or {}
        proxy_url = str(_tg.get("proxy_url") or "").strip()
    except Exception:
        proxy_url = ""

    if proxy_url:
        if not proxy_url.lower().startswith(("http://", "https://")):
            return {
                "ok": False,
                "error": "telegram: proxy_url должен начинаться с http:// или https://",
            }
        proxy_handler = urllib.request.ProxyHandler({
            "http":  proxy_url,
            "https": proxy_url,
        })
        opener = urllib.request.build_opener(proxy_handler)
        open_func = opener.open
    else:
        open_func = urllib.request.urlopen

    try:
        with open_func(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            parsed = _json.loads(body) if body else {}
            if parsed.get("ok"):
                return {"ok": True, "result": parsed.get("result")}
            return {
                "ok": False,
                "error": parsed.get("description") or f"HTTP {resp.status}",
            }
    except urllib.error.HTTPError as e:
        try:
            body = e.read().decode("utf-8", errors="replace")
            parsed = _json.loads(body)
            return {"ok": False, "error": parsed.get("description") or f"HTTP {e.code}"}
        except Exception:
            return {"ok": False, "error": f"HTTP {e.code}"}
    except Exception as e:
        log.warning("[lua] telegram.%s error: %s", method, e)
        return {"ok": False, "error": str(e)}


def _tg_resolve_chat(chat_id):
    """chat_id из аргумента или default_chat_id из настроек."""
    if chat_id is not None and str(chat_id).strip() != "":
        return chat_id
    _, _, default_chat = _telegram_config()
    return default_chat


def _api_telegram_send(chat_id, text, parse_mode=None, token=None,
                       disable_notification=False):
    chat = _tg_resolve_chat(chat_id)
    if chat is None or str(chat).strip() == "":
        return {"ok": False, "error": "telegram: chat_id не задан"}

    if parse_mode is None:
        _, _, _, cfg_mode = _telegram_config()
        parse_mode = cfg_mode

    payload = {
        "chat_id": chat,
        "text": str(text),
        "disable_notification": bool(disable_notification),
    }
    if parse_mode:
        payload["parse_mode"] = parse_mode
    return _telegram_request("sendMessage", payload, token=token)


def _api_telegram_send_markdown(chat_id, text, token=None):
    return _api_telegram_send(chat_id, text, parse_mode="Markdown", token=token)


def _api_telegram_send_html(chat_id, text, token=None):
    return _api_telegram_send(chat_id, text, parse_mode="HTML", token=token)


def _api_telegram_photo(chat_id, photo, caption=None, token=None):
    """Отправить фото по URL. Локальные файлы не поддерживаются (нужен multipart)."""
    chat = _tg_resolve_chat(chat_id)
    if chat is None or str(chat).strip() == "":
        return {"ok": False, "error": "telegram: chat_id не задан"}
    if not str(photo).lower().startswith(("http://", "https://")):
        return {"ok": False, "error": "telegram.photo: поддерживаются только URL"}
    payload = {"chat_id": chat, "photo": str(photo)}
    if caption:
        payload["caption"] = str(caption)
    return _telegram_request("sendPhoto", payload, token=token)


def _api_telegram_me(token=None):
    """Проверка токена — возвращает информацию о боте."""
    return _telegram_request("getMe", {}, token=token)
    
# накопитель логов по script_id: {script_id: [ {ts, level, text} ]}
_lua_logs = {}

def _api_log(msg):
    log.info("[lua] %s", msg)
    sid = _current_script_id
    if sid:
        from datetime import datetime
        _lua_logs.setdefault(sid, []).append({
            "ts": datetime.now().strftime("%H:%M:%S"),
            "level": "info",
            "text": str(msg),
        })
        if len(_lua_logs[sid]) > 500:
            _lua_logs[sid] = _lua_logs[sid][-500:]

    try:
        from api import notify_clients
        notify_clients("lua_log", {
            "script_id": sid,
            "text": str(msg),
            "level": "info",
        })
    except Exception:
        pass


def _api_notify(title, body, level="info"):
    try:
        from api import notify_clients
        notify_clients("notify", {"title": title, "body": body, "level": level})
        return True
    except Exception as e:
        log.warning("[lua] notify error: %s", e)
        return False


def _build_lua_env(rt):
    g = rt.globals()

    # --- devices ---
    devices_tbl = rt.table()
    devices_tbl["get"] = _api_device_get
    devices_tbl["set"] = _api_device_set
    devices_tbl["list"] = _api_device_list
    g["devices"] = devices_tbl

    # --- knx ---
    knx_tbl = rt.table()
    knx_tbl["read"] = _api_knx_read
    knx_tbl["write"] = _api_knx_write
    g["knx"] = knx_tbl

    # --- modbus ---
    mb_tbl = rt.table()
    mb_tbl["read"] = _api_modbus_read
    mb_tbl["write"] = _api_modbus_write
    g["modbus"] = mb_tbl

    # --- mqtt ---
    mqtt_tbl = rt.table()
    mqtt_tbl["publish"] = _api_mqtt_publish
    g["mqtt"] = mqtt_tbl
    
     # --- http ---
    http_tbl = rt.table()
    http_tbl["get"] = _api_http_get
    http_tbl["check"] = _api_http_tcp_check
    g["http"] = http_tbl

    # --- telegram ---
    tg_tbl = rt.table()
    tg_tbl["send"]          = _api_telegram_send
    tg_tbl["send_markdown"] = _api_telegram_send_markdown
    tg_tbl["send_html"]     = _api_telegram_send_html
    tg_tbl["photo"]         = _api_telegram_photo
    tg_tbl["me"]            = _api_telegram_me
    g["telegram"] = tg_tbl
    
    # --- json ---
    json_tbl = rt.table()
    json_tbl["decode"] = _api_json_decode
    json_tbl["encode"] = _api_json_encode
    g["json"] = json_tbl

    # --- log / notify ---
    g["log"] = _api_log
    g["notify"] = _api_notify

    # --- ctx (контекст запуска) ---
    g["ctx"] = {}


def init_lua():
    global _runtime
    if not LUPA_AVAILABLE:
        log.warning("[lua] lupa не установлена — Lua-скрипты отключены")
        return None
    if _runtime is None:
        _runtime = LuaRuntime(unpack_returned_tuples=True)
        _build_lua_env(_runtime)
        log.info("[lua] runtime инициализирован")
    return _runtime

_current_script_id = None

def run_script(code: str, context: dict | None = None) -> dict:
    global _current_script_id
    rt = init_lua()
    if not rt:
        return {"ok": False, "error": "lupa not available"}

    # 1) Устанавливаем script_id ДО выполнения
    ctx_data = context or {}
    _current_script_id = ctx_data.get("script_id")

    try:
        # 2) Собираем Lua-таблицу ctx
        lua_ctx = rt.table()
        for k, v in ctx_data.items():
            lua_ctx[k] = v
        rt.globals()["ctx"] = lua_ctx

        # 3) Выполняем скрипт ОДИН раз
        result = rt.execute(code)
        return {"ok": True, "result": result}
    except Exception as e:
        log.warning("[lua] script error: %s", e)
        return {"ok": False, "error": str(e)}
    finally:
        # 4) Сбрасываем контекст
        _current_script_id = None
        
# lua_engine.py (в конце)

import event_bus


def _match_trigger(script: dict, ev: dict) -> bool:
    """Подходит ли скрипт под событие."""
    triggers = script.get("triggers") or []
    if not triggers:
        return False

    for t in triggers:
        if not isinstance(t, dict):
            continue
        ttype = t.get("type")

        if ttype == "manual":
            continue

        if ttype == "knx":
            if ev.get("type") != "knx":
                continue
            addr = t.get("address")
            if addr and ev.get("knx", {}).get("dest") != addr:
                continue
            return True

        if ttype == "mqtt":
            if ev.get("type") != "mqtt":
                continue
            topic = t.get("topic")
            if topic and ev.get("mqtt", {}).get("topic") != topic:
                continue
            pm = t.get("payload_match")
            if pm and pm not in str(ev.get("mqtt", {}).get("payload", "")):
                continue
            return True

        if ttype == "device_changed":
            if ev.get("type") != "device_changed":
                continue
            did = t.get("device")
            if did and ev.get("device_id") != did:
                continue
            fld = t.get("field")
            if fld and ev.get("field") != fld:
                continue
            return True

        if ttype == "timer":
            if ev.get("type") != "timer":
                continue
            tid = t.get("timer_id")
            if tid and ev.get("timer_id") != tid:
                continue
            return True

        if ttype == "any":
            return True

    return False


def _on_bus_event(ev: dict):
    """Подписчик шины: запускает подходящие Lua-скрипты."""
    if ev.get("type") == "script_log":
        return

    try:
        from state import state
        scripts = state.get("lua_scripts", {}) or {}
    except Exception:
        return

    for sid, script in scripts.items():
        if not script.get("enabled"):
            continue
        if not _match_trigger(script, ev):
            continue

        ctx = {
            "trigger": ev.get("type"),
            "script_id": sid,
            "event": ev,
        }
        for k in ("knx", "mqtt", "device_id", "field", "value", "old_value",
                  "timer_id", "source"):
            if k in ev:
                ctx[k] = ev[k]

        try:
            run_script(script.get("code", ""), context=ctx)
        except Exception as e:
            log.warning("[lua] script %s on %s error: %s", sid, ev.get("type"), e)


def init_event_bus():
    """Подписать lua_engine на шину. Вызвать один раз при старте."""
    event_bus.subscribe(_on_bus_event)
    log.info("[lua] подписан на event_bus")