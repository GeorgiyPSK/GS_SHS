# state.py
import json
import os
import threading
import logging
from datetime import datetime

log = logging.getLogger("smarthome.state")

# --- Конфигурация путей ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATE_DIR = os.path.join(BASE_DIR, "state")
os.makedirs(STATE_DIR, exist_ok=True)

# Карта: ключ в state -> имя файла
STATE_FILES = {
    "devices": "devices.json",
    "rooms": "rooms.json",
    "plan": "plan.json",
    "mqtt_config": "mqtt_config.json",      # будет разбираться на mqtt и mqtt_triggers
    "automation": "automation.json",        # будет разбираться на scenario_groups, scenarios, events, timers
    "settings": "settings.json",
    "security": "security.json",            # будет разбираться на users и tokens
    "custom_types": "custom_types.json",
    "knx_ga": "knx_ga.json",          
}

# Старый файл для обратной совместимости
LEGACY_STATE_FILE = os.path.join(BASE_DIR, "smarthome.json")

_lock = threading.Lock()

# --- Глобальное состояние ---
# --- Глобальное состояние ---
state = {
    "devices": {},
    "plan": {
        "main": {"image": None, "updated": None},
        "rooms": {},
        "charts": [],
    },
    "rooms": {},
    "events": {},
    "scenario_groups": {},
    "scenarios": {},
    "timers": {},
    "mqtt_triggers": {},
    "custom_types": {},
    "knx_group_addresses": {},
    "users": {},
    "tokens": {},
    "mqtt": {
        "enabled": False,
        "host": "localhost",
        "port": 1883,
        "username": "",
        "password": "",
        "client_id": "smarthome-server",
        "base_topic": "smarthome",
        "keepalive": 60,
        "status_topic": "smarthome/status",
    },
     "settings": {
        "mode": "user",
        "poll_interval": 2000,
        "host": "0.0.0.0",
        "port": 5000,
        "telegram": {
            "enabled": False,
            "bot_token": "",
            "default_chat_id": "",
            "parse_mode": "HTML",   # "" | "HTML" | "Markdown"
            "notify_on_errors": True,
            "proxy_url": "",
        },
        "zigbee2mqtt": {
            "enabled": False,
            "base_topic": "zigbee2mqtt",
            "host": "http://localhost:8080",
        },
        "modbus_poll_ms": 2000,
        "knx": {
            "enabled": False,
            "connection": "automatic",
            "gateway_ip": "",
            "gateway_port": 3671,
            "own_address": "15.15.250",
            "individual_address": "15.15.250",
        },
    },
}

STATE_VERSION = 0


def _get_file_path(key: str) -> str:
    """Возвращает полный путь к файлу для данного ключа."""
    filename = STATE_FILES.get(key, f"{key}.json")
    return os.path.join(STATE_DIR, filename)


def _load_json_file(filepath: str) -> dict:
    """Загружает JSON из файла. Возвращает пустой dict при ошибке."""
    if not os.path.exists(filepath):
        return {}
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f) or {}
    except (json.JSONDecodeError, OSError) as e:
        log.error("[state] Ошибка загрузки %s: %s", filepath, e)
        return {}


def _save_json_file(filepath: str, data) -> None:
    """Атомарно сохраняет JSON в файл. Несериализуемые объекты → str()."""
    tmp = filepath + ".tmp"
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, default=str)
    os.replace(tmp, filepath)


def _migrate_from_legacy():
    """Мигрирует данные из старого smarthome.json в новую структуру."""
    if not os.path.exists(LEGACY_STATE_FILE):
        return
    log.info("[state] Найден старый файл %s, выполняю миграцию...", LEGACY_STATE_FILE)
    try:
        with open(LEGACY_STATE_FILE, "r", encoding="utf-8") as f:
            old_data = json.load(f) or {}
    except (json.JSONDecodeError, OSError) as e:
        log.error("[state] Не удалось прочитать старый файл: %s", e)
        return

    # 1. Устройства
    if "devices" in old_data:
        _save_json_file(_get_file_path("devices"), old_data["devices"])

    # 2. Комнаты
    if "rooms" in old_data:
        _save_json_file(_get_file_path("rooms"), old_data["rooms"])

    # 3. План
    if "plan" in old_data:
        _save_json_file(_get_file_path("plan"), old_data["plan"])

    # 4. MQTT
    mqtt_data = {
        "settings": old_data.get("mqtt", {}),
        "triggers": old_data.get("mqtt_triggers", {}),
    }
    _save_json_file(_get_file_path("mqtt_config"), mqtt_data)

    # 5. Автоматизация
    automation_data = {
        "scenario_groups": old_data.get("scenario_groups", {}),
        "scenarios": old_data.get("scenarios", {}),
        "events": old_data.get("events", {}),
        "timers": old_data.get("timers", {}),
    }
    _save_json_file(_get_file_path("automation"), automation_data)

    # 6. Настройки
    if "settings" in old_data:
        _save_json_file(_get_file_path("settings"), old_data["settings"])

    # 7. Безопасность
    security_data = {
        "users": old_data.get("users", {}),
        "tokens": old_data.get("tokens", {}),
    }
    _save_json_file(_get_file_path("security"), security_data)

    # 8. Кастомные типы
    if "custom_types" in old_data:
        _save_json_file(_get_file_path("custom_types"), old_data["custom_types"])

    # Переименовываем старый файл, чтобы миграция не выполнялась снова
    backup_name = LEGACY_STATE_FILE + ".migrated"
    try:
        os.replace(LEGACY_STATE_FILE, backup_name)
        log.info("[state] Старый файл переименован в %s", backup_name)
    except OSError as e:
        log.warning("[state] Не удалось переименовать старый файл: %s", e)


def load_state():
    """Загружает состояние из нескольких файлов."""
    global state

    # Если есть старый файл и нет новых — мигрируем
    if os.path.exists(LEGACY_STATE_FILE) and not os.listdir(STATE_DIR):
        _migrate_from_legacy()

    # Загружаем простые файлы
    for key in ("devices", "rooms", "plan", "custom_types"):
        data = _load_json_file(_get_file_path(key))
        if isinstance(data, dict):
            state[key] = data

    # План — с поддержкой старого формата (на всякий случай)
    raw_plan = _load_json_file(_get_file_path("plan"))
    if "image" in raw_plan and "main" not in raw_plan:
        state["plan"] = {
            "main": {"image": raw_plan.get("image"), "updated": raw_plan.get("updated")},
            "rooms": {},
            "charts": [],
        }
    else:
        state["plan"] = {
            "main": raw_plan.get("main", {"image": None, "updated": None}),
            "rooms": raw_plan.get("rooms", {}) or {},
            "charts": raw_plan.get("charts", []) or [],
        }


    # MQTT
    mqtt_data = _load_json_file(_get_file_path("mqtt_config"))
    if isinstance(mqtt_data, dict):
        state["mqtt"].update(mqtt_data.get("settings", {}) or {})
        state["mqtt_triggers"] = mqtt_data.get("triggers", {}) or {}

    # Автоматизация
    automation_data = _load_json_file(_get_file_path("automation"))
    if isinstance(automation_data, dict):
        for k in ("scenario_groups", "scenarios", "events", "timers"):
            state[k] = automation_data.get(k, {}) or {}

    # Настройки
    settings_data = _load_json_file(_get_file_path("settings"))
    if isinstance(settings_data, dict):
        state["settings"].update(settings_data)

    # Безопасность
    security_data = _load_json_file(_get_file_path("security"))
    if isinstance(security_data, dict):
        state["users"] = security_data.get("users", {}) or {}
        state["tokens"] = security_data.get("tokens", {}) or {}
    # Lua-скрипты — из отдельной папки
    try:
        import lua_store
        state["lua_scripts"] = lua_store.load_all()
    except Exception as e:
        log.warning("[state] Не удалось загрузить lua_scripts: %s", e)
        state["lua_scripts"] = {}
    log.info("[state] Состояние загружено из %s", STATE_DIR)
    # KNX групповые адреса
    knx_ga = _load_json_file(_get_file_path("knx_ga"))
    if isinstance(knx_ga, dict):
        state["knx_group_addresses"] = knx_ga
    else:
        state["knx_group_addresses"] = {}

def save_state():
    """Сохраняет состояние в несколько файлов."""
    global STATE_VERSION
    with _lock:
        # 1. Простые файлы
        _save_json_file(_get_file_path("devices"), state.get("devices", {}))
        _save_json_file(_get_file_path("rooms"), state.get("rooms", {}))
        _save_json_file(_get_file_path("plan"), state.get("plan", {}))
        _save_json_file(_get_file_path("custom_types"), state.get("custom_types", {}))

        # 2. MQTT
        mqtt_data = {
            "settings": state.get("mqtt", {}),
            "triggers": state.get("mqtt_triggers", {}),
        }
        _save_json_file(_get_file_path("mqtt_config"), mqtt_data)

        # 3. Автоматизация
        automation_data = {
            "scenario_groups": state.get("scenario_groups", {}),
            "scenarios": state.get("scenarios", {}),
            "events": state.get("events", {}),
            "timers": state.get("timers", {}),
        }
        _save_json_file(_get_file_path("automation"), automation_data)

        # 4. Настройки
        _save_json_file(_get_file_path("settings"), state.get("settings", {}))

        # 5. Безопасность
        security_data = {
            "users": state.get("users", {}),
            "tokens": state.get("tokens", {}),
        }
        _save_json_file(_get_file_path("security"), security_data)
        # 6. KNX групповые адреса
        _save_json_file(_get_file_path("knx_ga"), state.get("knx_group_addresses", {}))
        
        STATE_VERSION += 1

    try:
        from api import notify_state_changed
        notify_state_changed()
    except Exception:
        pass


def new_id():
    return os.urandom(4).hex()


def normalize_state():
    """Приводит состояние к ожидаемому виду."""
    if "tokens" not in state or not isinstance(state["tokens"], dict):
        state["tokens"] = {}
    if "users" not in state or not isinstance(state["users"], dict):
        state["users"] = {}
    if "custom_types" not in state or not isinstance(state["custom_types"], dict):
        state["custom_types"] = {}
    if not isinstance(state["plan"].get("charts"), list):
        state["plan"]["charts"] = []
    if "lua_scripts" not in state or not isinstance(state["lua_scripts"], dict):
        state["lua_scripts"] = {}
    # секция zigbee2mqtt в settings
    st = state.setdefault("settings", {})
    z2m = st.setdefault("zigbee2mqtt", {})
    z2m.setdefault("enabled", False)
    z2m.setdefault("base_topic", "zigbee2mqtt")
    z2m.setdefault("host", "http://localhost:8080")

    # секция modbus в settings
    st.setdefault("modbus_poll_ms", 2000)
     # секция telegram в settings
    tg = st.setdefault("telegram", {})
    tg.setdefault("enabled", False)
    tg.setdefault("bot_token", "")
    tg.setdefault("default_chat_id", "")
    tg.setdefault("parse_mode", "HTML")
    tg.setdefault("notify_on_errors", True)
    tg.setdefault("proxy_url", "")
    # секция KNX в settings
    knx = st.setdefault("knx", {})
    knx.setdefault("enabled", False)
    knx.setdefault("connection", "automatic")
    knx.setdefault("gateway_ip", "")
    knx.setdefault("gateway_port", 3671)
    knx.setdefault("own_address", "15.15.250")
    knx.setdefault("individual_address", "15.15.250")

    from devices import default_state

    for dev in state["devices"].values():
        dev.setdefault("extra_rooms", [])
        dev.setdefault("mqtt", {"state_topic": "", "sub_topic": "", "retain": True})

        ref = default_state(dev.get("type", ""))
        s = dev.get("state", {})
        for k, ref_val in ref.items():
            if k not in s:
                continue
            v = s[k]
            if isinstance(ref_val, bool):
                s[k] = (v.strip().lower() in ("1", "true", "yes", "on", "вкл", "да")) if isinstance(v, str) else bool(v)
            elif isinstance(ref_val, int) and not isinstance(ref_val, bool):
                try:
                    s[k] = int(float(v))
                except (TypeError, ValueError):
                    s[k] = ref_val
            elif isinstance(ref_val, float):
                try:
                    s[k] = float(v)
                except (TypeError, ValueError):
                    s[k] = ref_val
            elif isinstance(ref_val, str):
                s[k] = str(v)

    for coll in (state["scenarios"].values(), state["timers"].values()):
        for item in coll:
            for a in item.get("actions", []):
                if a.get("type") == "set_state" and "value" in a:
                    dev = state["devices"].get(a.get("device"))
                    if not dev:
                        continue
                    cur = dev["state"].get(a.get("field"))
                    if isinstance(cur, bool):
                        a["value"] = str(a["value"]).strip().lower() in ("1", "true", "yes", "on", "вкл")
                    elif isinstance(cur, int) and not isinstance(cur, bool):
                        try:
                            a["value"] = int(float(a["value"]))
                        except (TypeError, ValueError):
                            pass
                    elif isinstance(cur, float):
                        try:
                            a["value"] = float(a["value"])
                        except (TypeError, ValueError):
                            pass