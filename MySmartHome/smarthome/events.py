from state import state
import json
import urllib.request
import urllib.parse
from http_client import render_placeholders  # если у вас есть http_client.py
import logging
log = logging.getLogger("smarthome.events")


def _http_request(req):
    if not req or req.get("enabled") is False:
        return
    # --- lua ---
    if req.get("type") == "lua":
        sid = req.get("script_id")
        if not sid:
            return
        s = state.get("lua_scripts", {}).get(sid)
        if s and s.get("enabled"):
            try:
                import lua_engine
                lua_engine.run_script(
                    s.get("code", ""),
                    context={"trigger": "event", "script_id": sid}
                )
            except Exception as e:
                log.info("[events] lua error:%s", e)
        return
    # --- HTTP ---
    method = (req.get("method") or "GET").upper()
    url = render_placeholders(req.get("url") or "")
    if not url:
        return
    headers = {}
    for h in (req.get("headers") or []):
        k = h.get("k"); v = h.get("v")
        if k:
            headers[k] = render_placeholders(v or "")

    body = None
    body_type = req.get("body_type") or "none"
    if method == "POST" and body_type != "none":
        raw = render_placeholders(req.get("body") or "")
        if body_type == "json":
            body = raw.encode("utf-8")
            headers.setdefault("Content-Type", "application/json")
        elif body_type == "form":
            body = raw.encode("utf-8")
            headers.setdefault("Content-Type", "application/x-www-form-urlencoded")
        else:  # raw
            body = raw.encode("utf-8")

    try:
        r = urllib.request.Request(url, data=body, headers=headers, method=method)
        with urllib.request.urlopen(r, timeout=5) as resp:
            log.info(f"[events] HTTP {method} {url} -> {resp.status}")
    except Exception as e:
        log.info(f"[events] HTTP {method} {url} error:%s", e)


def fire_requests(requests):
    for req in (requests or []):
        _http_request(req)


def _fire_mqtt_publishes(publishes, device_id=None):
    for pub in (publishes or []):
        if not pub.get("enabled", True):
            continue
        try:
            from mqtt_client import publish_template
            publish_template(
                pub.get("topic", ""),
                pub.get("payload", ""),
                device_id=device_id,
                retain=bool(pub.get("retain", False)),
                qos=int(pub.get("qos", 0)),
            )
        except Exception as e:
            log.info("[events] mqtt_publish error:%s", e)


def trigger_events(device_id, field, value):
    log.info(f"[events] trigger_events({device_id}, {field}, {value})")
    for ev in state["events"].values():
        if not ev.get("enabled", True):
            continue
        if ev.get("source_device") != device_id:
            continue
        if ev.get("source_field") != field:
            continue
        when = ev.get("when", "any")
        match = False
        if when == "any":
            match = True
        elif when == "true":
            match = bool(value)
        elif when == "false":
            match = not bool(value)
        else:
            try:
                match = (float(value) == float(when))
            except (TypeError, ValueError):
                match = (str(value) == str(when))
        log.info(f"[events] event {ev.get('id')} match={match}")
        if match:
            fire_requests(ev.get("requests", []))
            _fire_mqtt_publishes(ev.get("mqtt_publishes", []), device_id=device_id)
                        # --- Lua-скрипты ---
            for act in (ev.get("lua_scripts") or []):
                if not act.get("enabled", True):
                    continue
                sid = act.get("script_id")
                if not sid:
                    continue
                s = state.get("lua_scripts", {}).get(sid)
                if s and s.get("enabled"):
                    try:
                        import lua_engine
                        lua_engine.run_script(
                            s.get("code", ""),
                            context={"trigger": "event", "script_id": sid}
                        )
                    except Exception as e:
                        log.info("[events] lua error:%s", e)