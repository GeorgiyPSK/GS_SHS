# lua_store.py
import os
import json
import threading
from datetime import datetime

_lock = threading.Lock()
_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lua_scripts")
os.makedirs(_DIR, exist_ok=True)


def _paths(script_id):
    """Возвращает (json_path, lua_path) для скрипта."""
    return (
        os.path.join(_DIR, f"{script_id}.json"),
        os.path.join(_DIR, f"{script_id}.lua"),
    )


def load_all():
    """Читает все скрипты из папки. Возвращает dict {id: script}."""
    out = {}
    if not os.path.isdir(_DIR):
        return out
    for name in os.listdir(_DIR):
        if not name.endswith(".json"):
            continue
        sid = name[:-5]  # без .json
        rec = load_one(sid)
        if rec:
            out[sid] = rec
    return out


def load_one(script_id):
    """Читает один скрипт. Возвращает dict или None."""
    json_path, lua_path = _paths(script_id)
    if not os.path.exists(json_path):
        return None

    try:
        with open(json_path, encoding="utf-8") as f:
            meta = json.load(f) or {}
    except Exception:
        return None

    # код — из .lua, если есть
    code = meta.get("code", "")
    if os.path.exists(lua_path):
        try:
            with open(lua_path, encoding="utf-8") as f:
                code = f.read()
        except Exception:
            pass

    return {
        "id": script_id,
        "name": meta.get("name", "Без имени"),
        "description": meta.get("description", ""),
        "enabled": bool(meta.get("enabled", True)),
        "triggers": meta.get("triggers", []),
        "updated": meta.get("updated", ""),
        "code": code,
    }
    


def save_one(script):
    """Сохраняет один скрипт. script — dict с полями id, name, code, ..."""
    sid = script.get("id")
    if not sid:
        return False

    json_path, lua_path = _paths(sid)
    meta = {
        "id": sid,
        "name": script.get("name", ""),
        "description": script.get("description", ""),
        "enabled": bool(script.get("enabled", True)),
        "triggers": script.get("triggers", []),
        "updated": script.get("updated") or datetime.now().isoformat(timespec="seconds"),
    }

    with _lock:
        try:
            with open(json_path, "w", encoding="utf-8") as f:
                json.dump(meta, f, ensure_ascii=False, indent=2)

            with open(lua_path, "w", encoding="utf-8") as f:
                f.write(script.get("code", "") or "")
            return True
        except Exception:
            return False


def delete_one(script_id):
    """Удаляет файлы скрипта."""
    json_path, lua_path = _paths(script_id)
    ok = False
    with _lock:
        for p in (json_path, lua_path):
            if os.path.exists(p):
                try:
                    os.remove(p)
                    ok = True
                except Exception:
                    pass
    return ok