# knx_import.py
"""
Импорт ETS-проекта (.knxproj) через xknxproject.
Создаёт устройства в state["devices"] с готовыми knx.fields.

Структура KNXProject (xknxproject):
  project["devices"][ia] = {
      "name": ...,
      "communication_object_ids": ["1.1.11/O-6_R-7", ...],
      "channels": {
          "CH-79": {
              "name": "Выходы",
              "communication_object_ids": [...]
          }
      }
  }

  project["group_addresses"][ga_address] = {
      "name": "прав атр t рядом с LCD",
      "address": "0/0/1",
      "dpt": {"main": 9, "sub": 1},
      "communication_object_ids": ["1.3.56/O-80_R-81", ...]
  }
"""
import logging
import os
import re
import tempfile
from datetime import datetime

from state import state, save_state, new_id

log = logging.getLogger("smarthome.knx_import")

try:
    from xknxproject import XKNXProj
    XKNXPROJECT_AVAILABLE = True
except ImportError:
    XKNXPROJECT_AVAILABLE = False


def is_available():
    return XKNXPROJECT_AVAILABLE


def parse_knxproj(path: str, password: str = "", language: str = "ru-RU") -> dict:
    if not XKNXPROJECT_AVAILABLE:
        raise RuntimeError("xknxproject не установлен. Выполните: pip install xknxproject")
    knxproj = XKNXProj(path=path, password=password or None, language=language)
    return knxproj.parse()


# ============================================================
# Индексы
# ============================================================
def _build_co_index(project: dict) -> dict:
    """
    Возвращает: {co_id: [ga_address, ga_address, ...]}.
    co_id — это строка вида "1.1.11/O-6_R-7".
    """
    idx = {}
    for ga_addr, ga in (project.get("group_addresses") or {}).items():
        for co_id in (ga.get("communication_object_ids") or []):
            idx.setdefault(co_id, []).append(ga_addr)
    return idx


def _build_ga_info(project: dict) -> dict:
    """
    Возвращает: {ga_address: {name, dpt_str}}.
    """
    out = {}
    for ga_addr, ga in (project.get("group_addresses") or {}).items():
        out[ga_addr] = {
            "name": ga.get("name", ""),
            "dpt": _dpt_str(ga.get("dpt")),
        }
    return out


def _dpt_str(dpt) -> str:
    """{'main': 9, 'sub': 1} → 'DPT-9.001'."""
    if not isinstance(dpt, dict):
        return ""
    main = dpt.get("main")
    sub = dpt.get("sub")
    if main is None:
        return ""
    if sub is None:
        return f"DPT-{main}"
    try:
        return f"DPT-{main}.{int(sub):03d}"
    except (TypeError, ValueError):
        return f"DPT-{main}.{sub}"


# ============================================================
# Определение нашего типа устройства
# ============================================================
def _guess_device_type(device: dict, ga_info: dict) -> str:
    """
    Определяет наш тип устройства по DPT его объектов.
    """
    # Собираем DPT всех GA, привязанных к объектам устройства
    co_index = _co_index_global  # см. ниже — используется глобальный кэш
    dp_types = set()
    for co_id in (device.get("communication_object_ids") or []):
        for ga_addr in co_index.get(co_id, []):
            gi = ga_info.get(ga_addr) or {}
            dpt = gi.get("dpt") or ""
            m = re.match(r"DPT-(\d+)", dpt)
            if m:
                dp_types.add(int(m.group(1)))

    if 1 in dp_types:
        return "light_switch"
    if 5 in dp_types:
        return "light"
    if 9 in dp_types:
        return "climate"
    if 14 in dp_types:
        return "climate"

    name = (device.get("name") or "").lower()
    if "свет" in name or "light" in name:
        return "light_switch"
    if "термо" in name or "thermo" in name:
        return "thermostat"
    if "двер" in name or "door" in name:
        return "door"
    if "движ" in name or "motion" in name:
        return "motion"
    if "протеч" in name or "leak" in name:
        return "leak"

    return "climate"


_co_index_global = {}  # заполняется в import_knxproj


# ============================================================
# Формирование полей knx.fields
# ============================================================
def _normalize_field_name(name: str) -> str:
    if not name:
        return ""
    name = name.strip().lower()
    name = re.sub(r"[^a-z0-9_]+", "_", name)
    name = re.sub(r"_+", "_", name).strip("_")
    return name[:40]


def _build_knx_fields(device: dict, co_index: dict, ga_info: dict) -> dict:
    """
    Формирует {field: {address, dpt}} для устройства.
    Поле — из имени первого GA, привязанного к объекту.
    """
    fields = {}
    used_names = set()

    # Собираем все co_id устройства: и в корне, и в каналах
    all_co_ids = list(device.get("communication_object_ids") or [])
    for ch in (device.get("channels") or {}).values():
        all_co_ids.extend(ch.get("communication_object_ids") or [])

    for co_id in all_co_ids:
        ga_list = co_index.get(co_id) or []
        for ga_addr in ga_list:
            gi = ga_info.get(ga_addr)
            if not gi:
                continue
            addr = ga_addr
            dpt = gi.get("dpt") or ""

            base = _normalize_field_name(gi.get("name") or "")
            if not base:
                base = "ga_" + ga_addr.replace("/", "_")
            field = base
            n = 2
            while field in used_names:
                field = f"{base}_{n}"
                n += 1
            used_names.add(field)

            fields[field] = {"address": addr, "dpt": dpt}

    return fields


# ============================================================
# Импорт
# ============================================================
def import_knxproj(path: str, password: str = "", language: str = "ru-RU",
                   dry_run: bool = True) -> dict:
    """
    Импортирует .knxproj и создаёт устройства.
    Возвращает отчёт: {added: [...], skipped: [...], errors: [...]}.
    """
    global _co_index_global

    project = parse_knxproj(path, password, language)

    co_index = _build_co_index(project)
    ga_info  = _build_ga_info(project)
    _co_index_global = co_index

    report = {"added": [], "skipped": [], "errors": [], "total_devices": 0}

    devices = project.get("devices") or {}
    report["total_devices"] = len(devices)

    for ia, dev in devices.items():
        try:
            name = dev.get("name") or f"KNX {ia}"
            fields = _build_knx_fields(dev, co_index, ga_info)

            if not fields:
                report["skipped"].append({
                    "name": name, "ia": ia,
                    "reason": "нет групповых адресов",
                })
                continue

            # Проверка: не импортировали ли уже это устройство
            already = any(
                d.get("knx", {}).get("individual_address") == ia
                for d in state["devices"].values()
            )
            if already:
                report["skipped"].append({
                    "name": name, "ia": ia,
                    "reason": "уже импортировано",
                })
                continue

            dtype = _guess_device_type(dev, ga_info)

            if dry_run:
                report["added"].append({
                    "name": name, "ia": ia,
                    "type": dtype,
                    "fields": list(fields.keys())[:20],  # первые 20 для UI
                    "fields_total": len(fields),
                })
                continue

            from devices import add_device
            dev_new = add_device(dtype, name, "")
            dev_new["knx"] = {
                "enabled": True,
                "individual_address": ia,
                "fields": fields,
            }
            report["added"].append({
                "id": dev_new["id"],
                "name": name,
                "ia": ia,
                "type": dtype,
                "fields": list(fields.keys())[:20],
                "fields_total": len(fields),
            })
        except Exception as e:
            log.warning("[knx-import] error on %s: %s", ia, e, exc_info=True)
            report["errors"].append({"ia": ia, "error": str(e)})

    # Заполнить реестр всех GA — независимо от устройств
    if not dry_run:
        try:
            import knx_ga_store
            items = []
            for ga_addr, ga in (project.get("group_addresses") or {}).items():
                items.append({
                    "address": ga_addr,
                    "name": ga.get("name", ""),
                    "dpt": _dpt_str(ga.get("dpt")),
                })
            knx_ga_store.bulk_upsert(items)
        except Exception as e:
            log.warning("[knx-import] не удалось заполнить реестр GA: %s", e)

        # Привязка GA к устройствам — по co_index
        try:
            import knx_ga_store
            for ia, dev in devices.items():
                dev_new = next(
                    (d for d in state["devices"].values()
                     if d.get("knx", {}).get("individual_address") == ia),
                    None
                )
                if not dev_new:
                    continue
                fields = dev_new.get("knx", {}).get("fields") or {}
                for field, spec in fields.items():
                    addr = spec.get("address")
                    if addr:
                        knx_ga_store.link_to_device(addr, dev_new["id"], field)
        except Exception as e:
            log.warning("[knx-import] link_to_device error: %s", e)

    return report