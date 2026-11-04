# bacnet_server.py
"""
BACnet-сервер для GS Smart.
Публикует выбранные KNX GA как объекты BACnet AnalogValue / BinaryValue
(commandable, writable из BACnet-клиента).

Обратная синхронизация: если BACnet-клиент записал новое значение
в Present_Value, оно передаётся в KNX через knx_client.write_group_address.
"""
import asyncio
import logging
import threading
from datetime import datetime

from state import state, save_state

log = logging.getLogger("smarthome.bacnet")

# --------------------------------------------------------------------
# Импорт BAC0 / моделей (совместимость с разными версиями)
# --------------------------------------------------------------------
try:
    import BAC0
    try:
        from BAC0.core.devices.local.models import (
            analog_value, binary_value,
        )
    except ImportError:
        from BAC0.core.devices.local.factory import (
            analog_value, binary_value,
        )
    _HAS_BAC0 = True
except Exception as e:
    BAC0 = None
    analog_value = binary_value = None
    _HAS_BAC0 = False
    log.info("[bacnet] BAC0 не установлен или API несовместим: %s", e)


# --------------------------------------------------------------------
# Глобальное состояние модуля
# --------------------------------------------------------------------
_loop: asyncio.AbstractEventLoop | None = None
_thread: threading.Thread | None = None
_bacnet = None            # экземпляр BAC0.lite(...)
_started = False
_last_error: str | None = None

# { ga_address: {"object": "AV,1", "type": "AV"|"BV",
#                "instance": 1, "name": "GA_0_0_1", "is_bool": bool} }
_published: dict[str, dict] = {}

# последнее считанное presentValue — для детекта изменений от BACnet-клиента
_last_seen: dict[str, any] = {}

# следующий instance-номер (уникален в рамках устройства)
_next_instance = 1

_stop_event = threading.Event()


# --------------------------------------------------------------------
# Настройки
# --------------------------------------------------------------------
def _cfg() -> dict:
    st = state.setdefault("settings", {})
    return st.setdefault("bacnet", {
        "enabled": False,
        "ip": "0.0.0.0/24",
        "port": 47808,
        "device_id": 1001,
        "device_name": "GS-Smart",
        "vendor_id": 999,
    })


def is_available() -> bool:
    return _HAS_BAC0


def is_started() -> bool:
    return _started


def get_status() -> dict:
    return {
        "available": _HAS_BAC0,
        "started": _started,
        "last_error": _last_error,
        "published": list(_published.items()),
        "config": _cfg(),
    }


# --------------------------------------------------------------------
# Поток / event loop
# --------------------------------------------------------------------
def _thread_main():
    global _loop, _started, _last_error
    _loop = asyncio.new_event_loop()
    asyncio.set_event_loop(_loop)
    try:
        _loop.run_until_complete(_run_server(_cfg()))
    except BaseException as e:
        _last_error = f"thread error: {e}"
        log.exception("[bacnet] thread error: %s", e)
    finally:
        _started = False
        try:
            if _loop and not _loop.is_closed():
                _loop.close()
        except Exception:
            pass


async def _run_server(cfg: dict):
    global _bacnet, _started, _last_error
    log.info("[bacnet] starting on %s device_id=%s",
             cfg.get("ip"), cfg.get("device_id"))

    # --- создание BAC0.lite() ---
    try:
        _bacnet = BAC0.lite(
            ip=cfg["ip"],
            deviceId=cfg["device_id"],
            localObjName=cfg.get("device_name", "GS-Smart"),
        )
    except Exception as e:
        _last_error = f"BAC0.lite failed: {e}"
        log.error("[bacnet] lite failed: %s", e)
        _bacnet = None
        _started = False
        return

    _started = True
    _last_error = None
    log.info("[bacnet] started")

    # --- публикация объектов ---
    try:
        _rebuild_objects()
    except Exception as e:
        _last_error = f"_rebuild_objects: {e}"
        log.exception("[bacnet] rebuild error: %s", e)

    # --- цикл: ждём stop + раз в секунду проверяем изменения BACnet ---
    while not _stop_event.is_set():
        await asyncio.sleep(1.0)
        try:
            await _poll_bacnet_changes()
        except Exception as e:
            log.debug("[bacnet] poll changes error: %s", e)

    # --- остановка ---
    try:
        if _bacnet is not None:
            result = _bacnet.disconnect()
            if asyncio.iscoroutine(result):
                await result
    except Exception as e:
        log.debug("[bacnet] disconnect error: %s", e)
    _bacnet = None
    _started = False
    log.info("[bacnet] stopped")


async def _poll_bacnet_changes():
    """Раз в секунду: если presentValue у объекта изменилось снаружи
    (BACnet-клиент записал), толкаем значение в KNX."""
    if not _bacnet or not _published:
        return

    for addr, info in list(_published.items()):
        try:
            obj = _bacnet[info["name"]]
            cur = obj.presentValue
        except Exception:
            continue

        prev = _last_seen.get(addr, _MISSING := object())
        if prev is _MISSING:
            _last_seen[addr] = cur
            continue
        if cur == prev:
            continue

        _last_seen[addr] = cur
        log.info("[bacnet] %s changed %r -> %r, pushing to KNX",
                 addr, prev, cur)

        try:
            rec = (state.get("knx_group_addresses") or {}).get(addr) or {}
            dpt = rec.get("dpt") or "DPT-1.001"
            import knx_client
            knx_client.write_group_address(addr, cur, dpt)
            # обновим значение в реестре
            try:
                import knx_ga_store
                knx_ga_store.set_value(addr, cur, source="bacnet")
            except Exception:
                pass
        except Exception as e:
            log.warning("[bacnet] push to KNX error for %s: %s", addr, e)


# --------------------------------------------------------------------
# Публикация GA → BACnet
# --------------------------------------------------------------------
def _rebuild_objects():
    """Собрать объекты для published GA и добавить все за один вызов."""
    global _next_instance
    if not _started or not _bacnet:
        return

    _published.clear()
    _last_seen.clear()
    _next_instance = 1

    gas = (state.get("knx_group_addresses") or {})
    objects_to_add = []

    for addr, rec in gas.items():
        if not rec.get("bacnet_published"):
            continue
        obj = _publish_ga(addr, rec)
        if obj is not None:
            objects_to_add.append(obj)

    if not objects_to_add:
        log.info("[bacnet] no objects to publish")
        return

    # регистрируем ВСЕ объекты одной пачкой (важно!)
    try:
        # BAC0: add_objects_to_application(device) — метод у последней модели
        objects_to_add[-1].add_objects_to_application(_bacnet)
        log.info("[bacnet] added %d objects to application", len(objects_to_add))
    except Exception as e:
        log.error("[bacnet] add_objects_to_application error: %s", e)
        _last_error = f"add_objects_to_application: {e}"
        return

    # инициализируем _last_seen текущими значениями
    for addr, info in _published.items():
        try:
            _last_seen[addr] = _bacnet[info["name"]].presentValue
        except Exception:
            pass


def _publish_ga(addr: str, rec: dict):
    """Создать объект BACnet для одного GA. НЕ регистрирует в application —
    это делает `_rebuild_objects` пачкой."""
    global _next_instance
    if not _started or not _bacnet:
        return None

    dpt = (rec.get("dpt") or "").upper()
    value = rec.get("value")

    is_bool = dpt.startswith("DPT-1.") or isinstance(value, bool)
    instance = _next_instance
    _next_instance += 1

    obj_name = f"GA_{addr.replace('/', '_')}"
    descr = f"{rec.get('name') or ''} [{addr}]"

    try:
        if is_bool:
            obj = binary_value(
                instance=instance,
                name=obj_name,
                description=descr,
                presentValue=bool(value),
                is_commandable=True,      # writable из BACnet
            )
            kind = "BV"
        else:
            if not isinstance(value, (int, float)) and value is not None:
                log.info("[bacnet] skip non-numeric GA %s (value=%r)", addr, value)
                return None
            obj = analog_value(
                instance=instance,
                name=obj_name,
                description=descr,
                presentValue=float(value) if value is not None else 0.0,
                properties={"units": "noUnits"},
                is_commandable=True,      # writable из BACnet
            )
            kind = "AV"

        _published[addr] = {
            "object": f"{kind},{instance}",
            "type": kind,
            "instance": instance,
            "name": obj_name,
            "is_bool": is_bool,
        }
        return obj
    except Exception as e:
        log.warning("[bacnet] publish %s error: %s", addr, e)
        _last_error = f"publish {addr}: {e}"
        return None


def unpublish_ga(addr: str):
    """Убрать GA из публикации (полная перестройка)."""
    if not _started:
        return
    _rebuild_objects()


# --------------------------------------------------------------------
# Обновление значения из KNX (GA → BACnet)
# --------------------------------------------------------------------
def update_value(addr: str, value):
    """Вызывается из knx_client / knx_ga_store при изменении GA."""
    if not _started or addr not in _published:
        return

    info = _published[addr]
    try:
        obj = _bacnet[info["name"]]
        if info.get("is_bool"):
            obj.presentValue = bool(value)
        else:
            if isinstance(value, (int, float)):
                obj.presentValue = float(value)
        _last_seen[addr] = obj.presentValue
    except Exception as e:
        log.debug("[bacnet] update %s error: %s", addr, e)


# --------------------------------------------------------------------
# Управление сервисом
# --------------------------------------------------------------------
def start():
    global _thread, _bacnet, _started
    if not _HAS_BAC0:
        log.info("[bacnet] BAC0 недоступен")
        return
    if not _cfg().get("enabled"):
        log.info("[bacnet] disabled in settings")
        return

    # добить остатки прошлого запуска
    if _bacnet is not None:
        try:
            _bacnet.disconnect()
        except Exception:
            pass
        _bacnet = None
    if _thread and not _thread.is_alive():
        _thread = None
        _started = False
    if _thread and _thread.is_alive():
        return

    _stop_event.clear()
    _started = False
    _thread = threading.Thread(target=_thread_main, daemon=True, name="bacnet")
    _thread.start()


def stop():
    global _bacnet, _started
    _stop_event.set()
    if _thread and _thread.is_alive():
        _thread.join(timeout=20)

    # Попытка принудительно закрыть сокеты BAC0
    try:
        if _bacnet is not None:
            # Новый API bacpypes3
            mux = getattr(_bacnet, 'this_application', None)
            if mux:
                mux = getattr(mux, 'mux', None)
            if mux:
                for port_name in ('directPort', 'broadcastPort'):
                    port = getattr(mux, port_name, None)
                    if port and hasattr(port, 'handle_close'):
                        try:
                            port.handle_close()
                        except Exception:
                            pass
            _bacnet.disconnect()
    except Exception:
        pass
    _bacnet = None
    _started = False


def restart():
    stop()
    start()