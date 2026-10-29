import threading
import urllib.request
import urllib.error

from state import state


PLACEHOLDER_RE = r"\{dev:([0-9a-f]+):([a-zA-Z_][a-zA-Z0-9_]*)\}"


def render_placeholders(text: str) -> str:
    """Заменяет {dev:<id>:<field>} на текущее значение поля устройства.
    Если устройство или поле не найдены — подставляет пустую строку."""
    import re
    if not isinstance(text, str):
        return text

    def repl(m):
        did, field = m.group(1), m.group(2)
        dev = state["devices"].get(did)
        if not dev:
            return ""
        val = dev["state"].get(field)
        if val is None:
            return ""
        if isinstance(val, bool):
            return "true" if val else "false"
        return str(val)

    return re.sub(PLACEHOLDER_RE, repl, text)

def _headers_to_dict(headers):
    out = {}
    for h in headers or []:
        k = (h.get("k") or "").strip()
        if k:
            out[k] = h.get("v", "")
    return out


def perform_request(req):
    method = (req.get("method") or "GET").upper()

    url = render_placeholders(req.get("url") or "")
    if not url.startswith(("http://", "https://")):
        return False, 0, "bad url"

    headers = {}
    for h in req.get("headers") or []:
        k = (h.get("k") or "").strip()
        if k:
            headers[k] = render_placeholders(h.get("v", ""))

    data = None
    body_type = req.get("body_type") or "none"
    body = render_placeholders(req.get("body") or "")

    if method == "POST":
        if body_type == "json":
            data = body.encode("utf-8")
            headers.setdefault("Content-Type", "application/json")
        elif body_type == "form":
            data = body.encode("utf-8")
            headers.setdefault("Content-Type", "application/x-www-form-urlencoded")
        elif body_type == "raw":
            data = body.encode("utf-8")
    headers.setdefault("User-Agent", "SmartHome/1.0")

    try:
        r = urllib.request.Request(url, data=data, headers=headers, method=method)
        with urllib.request.urlopen(r, timeout=8) as resp:
            txt = resp.read().decode("utf-8", "replace")[:2000]
            return True, resp.status, txt
    except urllib.error.HTTPError as e:
        try:
            txt = e.read().decode("utf-8", "replace")[:500]
        except Exception:
            txt = str(e)
        return False, getattr(e, "code", 0), txt
    except Exception as e:
        return False, 0, str(e)


def fire_requests(requests_list):
    for r in requests_list or []:
        if not r.get("enabled", True):
            continue
        if not (r.get("url") or "").startswith(("http://", "https://")):
            continue
        threading.Thread(target=perform_request, args=(r,), daemon=True).start()