# knx_ga_store.py
"""
Реестр групповых адресов KNX.
Хранится в state["knx_group_addresses"] = {
    "0/0/1": {
        "address": "0/0/1",
        "name": "прав атр t рядом с LCD",
        "dpt": "DPT-9.001",
        "device_id": "",            # к какому устройству привязан (или "")
        "field": "",                # какое поле (или "")
        "value": None,              # текущее значение
        "updated": "",              # когда обновлено
        "readable": True,           # можно ли читать с шины
        "writable": True,           # можно ли писать в шину
    },
    ...
}
"""
import logging
from datetime import datetime

from state import state, save_state

log = logging.getLogger("smarthome.knx_ga")

STORE_KEY = "knx_group_addresses"


def all_gas() -> dict:
    return state.setdefault(STORE_KEY, {})


def get(addr: str) -> dict | None:
    return all_gas().get(addr)


def upsert(addr: str, **fields) -> dict:
    """Создаёт или обновляет запись GA."""
    rec = all_gas().setdefault(addr, {"address": addr})
    for k, v in fields.items():
        if v is not None:
            rec[k] = v
    rec.setdefault("updated", "")
    return rec


def set_value(addr: str, value, source: str = "bus"):
    """Обновляет текущее значение GA."""
    rec = all_gas().get(addr)
    if not rec:
        return
    rec["value"] = value
    rec["updated"] = datetime.now().isoformat(timespec="seconds")
    rec["value_source"] = source   # "bus" | "ui" | "device"
    save_state()


def bulk_upsert(items: list[dict]):
    """
    Импорт из ETS-проекта.
    items = [{address, name, dpt}, ...]
    Существующие записи не перетираются (кроме name/dpt).
    """
    store = all_gas()
    for it in items:
        addr = it.get("address")
        if not addr:
            continue
        rec = store.setdefault(addr, {"address": addr})
        if it.get("name"):
            rec["name"] = it["name"]
        if it.get("dpt"):
            rec["dpt"] = it["dpt"]
        rec.setdefault("value", None)
        rec.setdefault("updated", "")
    save_state()
    return len(items)


def link_to_device(addr: str, device_id: str, field: str):
    rec = upsert(addr, device_id=device_id, field=field)
    return rec


def unlink(addr: str):
    rec = all_gas().get(addr)
    if not rec:
        return
    rec["device_id"] = ""
    rec["field"] = ""
    save_state()


def normalize():
    """Гарантирует базовую структуру у всех записей."""
    for addr, rec in all_gas().items():
        rec.setdefault("address", addr)
        rec.setdefault("name", "")
        rec.setdefault("dpt", "")
        rec.setdefault("device_id", "")
        rec.setdefault("field", "")
        rec.setdefault("value", None)
        rec.setdefault("updated", "")
        rec.setdefault("readable", True)
        rec.setdefault("writable", True)