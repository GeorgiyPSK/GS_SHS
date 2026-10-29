# theme_store.py
import json
import os
import threading

# Куда сохранять. Можно поменять на свой путь.
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_FILE = os.path.join(_BASE_DIR, "theme.json")

_lock = threading.Lock()

# Допустимые темы — должны совпадать с THEMES в theme.js
VALID_THEMES = {
    "deepblue", "midnight", "forest",
    "sunset", "light", "hc",
}

_DEFAULT_THEME = "deepblue"


def _read_all():
    if not os.path.exists(_FILE):
        return {}
    try:
        with open(_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, dict):
                return data
    except Exception as e:
        print("[theme_store] read error:", e)
    return {}


def _write_all(data):
    tmp = _FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, _FILE)


def get_theme():
    """Возвращает сохранённую тему или None, если её нет."""
    with _lock:
        data = _read_all()
    t = data.get("theme")
    if t in VALID_THEMES:
        return t
    return None


def set_theme(theme):
    """Сохраняет тему. Возвращает True, если значение валидное."""
    if theme not in VALID_THEMES:
        return False
    with _lock:
        data = _read_all()
        data["theme"] = theme
        _write_all(data)
    return True


def get_default():
    return _DEFAULT_THEME