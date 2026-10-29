# zigbee2mqtt.py
"""
Интеграция с Zigbee2MQTT:
- получение списка устройств (HTTP /api/devices или MQTT /bridge/devices);
- сопоставление model/vendor с типами нашей системы;
- автоимпорт устройств.
"""
import json
import urllib.request
import urllib.error
import threading
import time

from state import state, save_state, new_id


# ============================================================
# HTTP-клиент к Z2M
# ============================================================
def fetch_z2m_devices_http():
    """Возвращает список устройств из HTTP API Z2M.
    Z2M frontend слушает на порту 8080, endpoint /api/devices.
    """
    cfg = state.get("settings", {}).get("zigbee2mqtt", {})
    base = (cfg.get("host") or "http://localhost:8080").rstrip("/")
    url = base + "/api/devices"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "SmartHome/1.0"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8", "replace"))
        if isinstance(data, list):
            return data, None
        return None, "неожиданный формат ответа"
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}: {e.reason}"
    except urllib.error.URLError as e:
        return None, f"URL error: {e.reason}"
    except Exception as e:
        return None, str(e)


# ============================================================
# Сопоставление model → тип нашей системы
# ============================================================
# Ключи — подстроки в нижнем регистре; значения — имя типа в нашей системе.
# Если ничего не подошло, ставим дефолтный тип.
MODEL_HINTS = [
    # Лампы
    ("bulb", "light"),
    ("lamp", "light"),
    ("light", "light"),
    ("led", "light"),
    ("dimmer", "light"),
    ("globe", "light"),
    ("ceiling", "light"),

    # Розетки / реле
    ("plug", "light_switch"),
    ("socket", "light_switch"),
    ("outlet", "light_switch"),
    ("relay", "light_switch"),
    ("switch", "light_switch"),

    # Датчики температуры/влажности
    ("temperature", "climate"),
    ("humidity", "climate"),
    ("th", "climate"),           # часто в модели TH01, WSDCGQ11LM и т.п.
    ("climate", "climate"),

    # Термостаты / TRV
    ("thermostat", "thermostat"),
    ("trv", "thermostat"),
    ("radiator", "thermostat"),
    ("heating", "thermostat"),

    # Открытие
    ("contact", "door"),
    ("magnet", "door"),
    ("door", "door"),
    ("window", "door"),

    # Протечка
    ("water", "leak"),
    ("leak", "leak"),
    ("flood", "leak"),

    # Движение / присутствие
    ("motion", "motion"),
    ("pir", "motion"),
    ("occupancy", "motion"),
    ("presence", "motion"),
    ("human", "motion"),

    # Шторы
    ("curtain", "curtain"),
    ("blind", "curtain"),
    ("shade", "curtain"),
    ("cover", "curtain"),

    # Вентилятор
    ("fan", "fan"),
]

VENDOR_HINTS = [
    ("philips", "light"),
    ("ikea", "light"),
    ("osram", "light"),
    ("lidl", "light"),
    ("gledopto", "light"),
    ("tuya", "light_switch"),
    ("xiaomi", "climate"),
    ("aqara", "climate"),
    ("sonoff", "light_switch"),
]


def guess_type(z2m_dev):
    """Пытается определить наш тип по полям из Z2M.
    Возвращает (type, reason)."""
    definition = z2m_dev.get("definition") or {}
    model = (definition.get("model") or z2m_dev.get("model_id") or "").lower()
    vendor = (definition.get("vendor") or z2m_dev.get("vendor") or "").lower()
    desc = (definition.get("description") or "").lower()

    haystack = f"{model} {desc}".strip()

    for key, t in MODEL_HINTS:
        if key in haystack:
            return t, f"model содержит '{key}'"

    for key, t in VENDOR_HINTS:
        if key in vendor:
            return t, f"vendor содержит '{key}'"

    return None, "не удалось определить тип"


# ============================================================
# Полезная нагрузка → дефолтное состояние устройства
# ============================================================
def build_state_for_type(dtype, z2m_dev):
    """Строит стартовое state для устройства нашего типа,
    частично заполняя поля из expose-описания Z2M."""
    from devices import default_state

    s = dict(default_state(dtype) or {})

    definition = z2m_dev.get("definition") or {}
    exposes = definition.get("exposes") or []

    def walk(exposes_list):
        for e in exposes_list or []:
            if not isinstance(e, dict):
                continue
            if e.get("type") == "list" and isinstance(e.get("item"), dict):
                yield from walk([e["item"]])
                continue
            if e.get("type") == "composite" and isinstance(e.get("features"), list):
                yield from walk(e["features"])
                continue
            yield e

    flat = list(walk(exposes))

    # маппинг z2m-полей → наших полей
    field_map = {
        "state":   ("on", lambda v: str(v).upper() == "ON"),
        "brightness": ("brightness", lambda v: int(v)),
        "occupancy": ("motion", bool),
        "contact":   ("open", lambda v: not bool(v)),   # contact=true → закрыто → open=false
        "water_leak": ("leak", bool),
        "temperature": ("temp", float),
        "humidity":    ("humidity", float),
        "current_heating_setpoint": ("target", float),
        "local_temperature": ("current", float),
        "position":   ("position", int),
    }

    for e in flat:
        name = e.get("property") or e.get("name")
        if not name:
            continue
        if name in field_map:
            our_field, _ = field_map[name]
            if our_field in s:
                continue    # уже есть в default_state
            s[our_field] = None if e.get("type") == "numeric" else ""

    return s


# ============================================================
# Импорт
# ============================================================
def z2m_device_to_our(z2m_dev):
    """Преобразует Z2M-устройство в наше представление (без id).
    Возвращает dict для добавления в state["devices"] или None,
    если устройство служебное (Coordinator, Router-без-model)."""
    # Пропускаем координатора и «мосты»
    if z2m_dev.get("type") in ("Coordinator",):
        return None
    definition = z2m_dev.get("definition") or {}
    if not definition.get("model"):
        return None

    friendly = z2m_dev.get("friendly_name") or z2m_dev.get("ieee_address")
    if not friendly:
        return None

    dtype, reason = guess_type(z2m_dev)
    if not dtype:
        # не смогли определить — используем climate как нейтральный
        dtype = "climate"
        reason = "по умолчанию (climate)"

    state_fields = build_state_for_type(dtype, z2m_dev)

    return {
        "type": dtype,
        "name": friendly,
        "room": "",
        "room_id": "",
        "extra_rooms": [],
        "state": state_fields,
        "x": 50.0,
        "y": 50.0,
        "positions": {"main": {"x": 50.0, "y": 50.0}},
        "on_plan": False,
        "mqtt": {"state_topic": "", "sub_topic": "", "retain": True},
        "z2m_name": friendly,
        "z2m_ieee": z2m_dev.get("ieee_address"),
        "z2m_model": definition.get("model"),
        "z2m_vendor": definition.get("vendor"),
        "z2m_reason": reason,
        "updated": None,
    }

def import_from_bridge_cache(dry_run=False):
    """Импортирует устройства из MQTT-кэша (zigbee2mqtt/bridge/devices),
    полученного ранее. Работает так же, как import_new_devices,
    но источник — _bridge_devices, а не HTTP."""
    with _bridge_lock:
        cached = list(_bridge_devices)
        updated = _bridge_updated

    if not cached:
        return {
            "added": [],
            "skipped": [],
            "errors": ["bridge/devices ещё не получен по MQTT. "
                       "Убедитесь, что MQTT включён, Z2M активен и "
                       "топик zigbee2mqtt/bridge/devices пришёл (retained)."],
            "source": "mqtt",
        }

    # индексируем наши устройства по z2m_name
    known = {}
    for did, dev in state["devices"].items():
        z = (dev.get("z2m_name") or "").strip()
        if z:
            known[z] = did

    added, skipped, errors = [], [], []
    to_save = False

    for z2m_dev in cached:
        our = z2m_device_to_our(z2m_dev)
        if not our:
            continue
        name = our["z2m_name"]
        if name in known:
            skipped.append({"name": name, "id": known[name], "reason": "уже есть"})
            continue
        if dry_run:
            added.append({"name": name, "type": our["type"],
                          "reason": our["z2m_reason"], "dry_run": True})
            continue
        try:
            from state import new_id
            import datetime as _dt
            did = new_id()
            our["id"] = did
            our["updated"] = _dt.datetime.now().isoformat(timespec="seconds")
            state["devices"][did] = our
            added.append({"name": name, "id": did, "type": our["type"],
                          "reason": our["z2m_reason"]})
            to_save = True
        except Exception as e:
            errors.append(f"{name}: {e}")

    if to_save and not dry_run:
        save_state()

    return {
        "added": added,
        "skipped": skipped,
        "errors": errors,
        "source": "mqtt",
        "bridge_updated": updated,
    }


def bridge_cache_info():
    """Информация о кэше bridge/devices для UI."""
    with _bridge_lock:
        return {
            "count": len(_bridge_devices),
            "updated": _bridge_updated,
            "names": [
                (d.get("friendly_name") or d.get("ieee_address") or "?")
                for d in _bridge_devices
            ],
        }

def import_new_devices(dry_run=False):
    """Забирает список Z2M и добавляет те, которых у нас ещё нет.
    Возвращает отчёт: {added: [...], skipped: [...], errors: [...]}.
    Если dry_run=True — ничего не сохраняет, только показывает,
    что было бы добавлено.
    """
    devices, err = fetch_z2m_devices_http()
    if err:
        return {"added": [], "skipped": [], "errors": [err], "source": "http"}

    # индексируем наши устройства по z2m_name
    known = {}
    for did, dev in state["devices"].items():
        z = (dev.get("z2m_name") or "").strip()
        if z:
            known[z] = did

    added, skipped, errors = [], [], []
    to_save = False

    for z2m_dev in devices:
        our = z2m_device_to_our(z2m_dev)
        if not our:
            continue
        name = our["z2m_name"]
        if name in known:
            skipped.append({"name": name, "id": known[name], "reason": "уже есть"})
            continue
        if dry_run:
            added.append({"name": name, "type": our["type"],
                          "reason": our["z2m_reason"], "dry_run": True})
            continue
        # создаём
        try:
            did = new_id()
            our["id"] = did
            our["updated"] = __import__("datetime").datetime.now().isoformat(timespec="seconds")
            state["devices"][did] = our
            added.append({"name": name, "id": did, "type": our["type"],
                          "reason": our["z2m_reason"]})
            to_save = True
        except Exception as e:
            errors.append(f"{name}: {e}")

    if to_save and not dry_run:
        save_state()

    return {"added": added, "skipped": skipped, "errors": errors, "source": "http"}


# ============================================================
# MQTT-путь (опционально)
# ============================================================
_bridge_lock = threading.Lock()
_bridge_devices = []
_bridge_updated = 0


def mqtt_bridge_devices_payload(payload):
    """Принимает и bytes, и str. Парсит JSON со списком устройств.
    Игнорирует служебные ответы (true/false/null) и всё, что не список."""
    global _bridge_devices, _bridge_updated

    if isinstance(payload, (bytes, bytearray)):
        try:
            payload = payload.decode("utf-8", "replace")
        except Exception as e:
            print("[z2m] bridge/devices decode error:", e)
            return
    if not isinstance(payload, str):
        print("[z2m] bridge/devices: неожиданный тип payload:", type(payload).__name__)
        return

    text = payload.strip()
    if not text:
        return
    if text in ("true", "false", "null"):
        print(f"[z2m] bridge/devices: служебный ответ '{text}', пропускаю")
        return

    try:
        data = json.loads(text)
    except Exception as e:
        print("[z2m] bridge/devices parse error:", e, "| payload:", text[:200])
        return

    if not isinstance(data, list):
        print(f"[z2m] bridge/devices: ожидался список, получили {type(data).__name__}")
        return

    with _bridge_lock:
        _bridge_devices = data
        _bridge_updated = time.time()
    print(f"[z2m] bridge/devices: {len(data)} устройств")


def get_cached_bridge_devices():
    with _bridge_lock:
        return list(_bridge_devices)
        
def z2m_fields_for_device(did):
    """Возвращает список полей Z2M для устройства по его z2m_name."""
    try:
        dev = state["devices"].get(did)
        if not dev or not isinstance(dev, dict):
            return []
        z2m_name = (dev.get("z2m_name") or "").strip()
        if not z2m_name:
            return []

        with _bridge_lock:
            cached = list(_bridge_devices)

        found = None
        for z in cached:
            if not isinstance(z, dict):
                continue
            if (z.get("friendly_name") or z.get("ieee_address")) == z2m_name:
                found = z
                break
        if not found:
            return []

        definition = found.get("definition") or {}
        if not isinstance(definition, dict):
            return []
        exposes = definition.get("exposes") or []
        if not isinstance(exposes, list):
            return []

        def walk(items):
            for e in items or []:
                if not isinstance(e, dict):
                    continue
                features = e.get("features")
                if isinstance(features, list):
                    yield from walk(features)
                    continue
                if e.get("type") == "list" and isinstance(e.get("item"), dict):
                    yield from walk([e["item"]])
                    continue
                yield e

        st = dev.get("state")
        if not isinstance(st, dict):
            st = {}

        fields = []
        seen = set()
        for e in walk(exposes):
            name = e.get("property") or e.get("name")
            if not name or name in seen:
                continue
            seen.add(name)
            fields.append({
                "name": name,
                "type": e.get("type"),
                "access": e.get("access"),
                "unit": e.get("unit"),
                "values": e.get("values"),
                "value_min": e.get("value_min"),
                "value_max": e.get("value_max"),
                "value_step": e.get("value_step"),
                "current_value": st.get(_z2m_to_our_name(dev, name)),
            })
        return fields
    except Exception as ex:
        import traceback
        traceback.print_exc()
        return []
def _z2m_to_our_name(dev, z2m_name):
    """Сопоставляет имя поля из Z2M с именем поля в state устройства.
    Должно совпадать с _z2m_to_ours в mqtt_client.py."""
    dtype = (dev.get("type") or "").lower()
    common = {
        "temperature":              "temp",
        "humidity":                 "humidity",
        "pressure":                 "pressure",
        "battery":                  "battery",
        "voltage":                  "voltage",
        "linkquality":              "linkquality",
        "illuminance":              "illuminance",
        "occupancy":                "motion",
        "water_leak":               "leak",
        "current_heating_setpoint": "target",
        "local_temperature":        "current",
        "system_mode":              "mode",
        "brightness":               "brightness",
        "position":                 "position",
    }
    if z2m_name in common:
        return common[z2m_name]
    if z2m_name == "state":
        return "open" if dtype == "curtain" else "on"
    if z2m_name == "contact":
        return "open"
    return z2m_name