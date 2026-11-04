# bacnet_server.py
"""
BACnet-сервер для GS Smart.
Публикует выбранные KNX GA и MQTT-топики как объекты BACnet
AnalogValue / BinaryValue (commandable, writable из BACnet-клиента).

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

# { addr: {"object": "AV,1", "type": "AV"|"BV",
#          "instance": 1, "name": "GA_0_0_1", "is_bool": bool} }
_published: dict[str, dict] = {}

# последнее считанное presentValue — для детекта изменений от BACnet-клиента
_last_seen: dict[str, object] = {}

# следующий instance-номер (уникален в рамках устройства)
_next_instance = 1

_stop_event = threading.Event()


# --------------------------------------------------------------------
# Настройки / статус
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
        # корректно отменяем pending-задачи, чтобы задачи BAC0
        # (_i_am, Ping Registered Devices, ...) не вылетали
        # с "Task was destroyed but it is pending"
        try:
            if _loop and not _loop.is_closed():
                pending = asyncio.all_tasks(_loop)
                for task in pending:
                    task.cancel()
                if pending:
                    _loop.run_until_complete(
                        asyncio.gather(*pending, return_exceptions=True)
                    )
        except Exception as e:
            log.debug("[bacnet] cancel pending tasks: %s", e)
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

        # BAC0 после такой ошибки больше не запустится в этом процессе.
        # Перезапускаем весь сервер, чтобы освободить сокет и задачи BAC0.
        import sys, os, time, subprocess, threading
        def _hard_restart():
            time.sleep(1.5)
            try:
                flags = getattr(subprocess, "CREATE_NEW_CONSOLE", 0)
                subprocess.Popen(
                    [sys.executable] + sys.argv,
                    cwd=os.getcwd(),
                    creationflags=flags,
                )
            except Exception as ee:
                log.warning("[bacnet] hard restart Popen failed: %s", ee)
            os._exit(0)
        threading.Thread(target=_hard_restart, daemon=True).start()
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
    if not _bacnet or not _published:
        return

    for addr, info in list(_published.items()):
        try:
            obj = _bacnet[info["name"]]
            cur = obj.presentValue
        except Exception:
            continue

        if addr not in _last_seen:
            _last_seen[addr] = cur
            continue
        prev = _last_seen[addr]
        if cur == prev:
            continue

        _last_seen[addr] = cur
        log.info("[bacnet] %s changed %r -> %r", addr, prev, cur)

        # ---- 1) KNX GA ----
        if "/" in addr and addr.count("/") == 2:
            try:
                rec = (state.get("knx_group_addresses") or {}).get(addr) or {}
                dpt = rec.get("dpt") or "DPT-1.001"
                import knx_client
                knx_client.write_group_address(addr, cur, dpt)
                try:
                    import knx_ga_store
                    knx_ga_store.set_value(addr, cur, source="bacnet")
                except Exception:
                    pass
            except Exception as e:
                log.warning("[bacnet] push to KNX error for %s: %s", addr, e)
            continue

        # ---- 2) Поле устройства: <did>:<field> ----
        if ":" in addr:
            did, fname = addr.split(":", 1)
            dev = state["devices"].get(did)
            if not dev:
                continue
            cur_state = (dev.get("state") or {}).get(fname)
            # приведение к типу
            if isinstance(cur_state, bool):
                new_val = bool(cur)
            elif isinstance(cur_state, int) and not isinstance(cur_state, bool):
                try: new_val = int(cur)
                except Exception: new_val = cur
            elif isinstance(cur_state, float):
                try: new_val = float(cur)
                except Exception: new_val = cur
            else:
                new_val = cur

            if cur_state == new_val:
                continue

            dev["state"][fname] = new_val
            from datetime import datetime
            dev["updated"] = datetime.now().isoformat(timespec="seconds")
            save_state()

            try:
                import event_bus
                event_bus.publish(
                    "device_changed",
                    source="bacnet_client",
                    device_id=did,
                    field=fname,
                    value=new_val,
                )
            except Exception:
                pass

            # событие и сценарии
            try:
                from events import trigger_events
                from scenarios import run_all_scenarios
                trigger_events(did, fname, new_val)
                run_all_scenarios()
            except Exception:
                pass
            continue

        # ---- 3) MQTT-топик ----
        # (здесь можно толкнуть в mqtt_client.publish_raw, если нужно)
        log.debug("[bacnet] unknown addr format for push: %r", addr)


# --------------------------------------------------------------------
# Публикация объектов (KNX GA + MQTT)
# --------------------------------------------------------------------
def _rebuild_objects():
    """Потокобезопасная перестройка объектов BACnet.
    Выполняется в event loop потока BAC0."""
    if not _started or not _bacnet or not _loop:
        return

    try:
        running = asyncio.get_running_loop()
    except RuntimeError:
        running = None

    if running is _loop:
        _rebuild_objects_sync()
        return

    fut = asyncio.run_coroutine_threadsafe(_do_async(), _loop)
    try:
        fut.result(timeout=10)
    except Exception as e:
        log.warning("[bacnet] rebuild future error: %s", e)


async def _do_async():
    """Выполняется внутри event loop потока BAC0."""
    try:
        _rebuild_objects_sync()
    except Exception as e:
        log.exception("[bacnet] rebuild sync error: %s", e)


def _rebuild_objects_sync():
    global _next_instance
    if not _started or not _bacnet:
        return

    # 1) удаляем все наши объекты по именам-префиксам
    try:
        app = getattr(_bacnet, "this_application", None)
        if app:
            for oid, obj in list(app.objects.items()):
                n = str(getattr(obj, "objectName", ""))
                if n.startswith(("GA_", "MQTT_", "DEV_")):
                    try:
                        if hasattr(app, "delete_object"):
                            app.delete_object(oid)
                        else:
                            app.objects.pop(oid, None)
                    except Exception:
                        pass
    except Exception as e:
        log.debug("[bacnet] cleanup error: %s", e)

    _published.clear()
    _last_seen.clear()
    _next_instance = 1

    objects_to_add = []

    # 3) KNX GA
    for addr, rec in (state.get("knx_group_addresses") or {}).items():
        if not rec.get("bacnet_published"):
            continue
        obj = _publish_ga(addr, rec)
        if obj is not None:
            objects_to_add.append(obj)

    # 4) MQTT-топики
    for topic, link in (state.get("mqtt_bacnet_links") or {}).items():
        did = link.get("device_id") or ""
        field = link.get("field") or ""
        value = None
        if did and field:
            dev = state["devices"].get(did)
            if dev and dev.get("state") and field in dev["state"]:
                value = dev["state"][field]

        dpt = "DPT-1.001" if link.get("type") == "BV" else "DPT-9.001"
        rec = {"dpt": dpt, "value": value, "name": topic}
        obj = _publish_ga(topic, rec)
        if obj is not None:
            objects_to_add.append(obj)
    # --- 5) BACnet-привязки из карточек устройств ---
    for did, fields in (state.get("bacnet_device_links") or {}).items():
        dev = state["devices"].get(did)
        if not dev:
            continue
        for fname, spec in (fields or {}).items():
            if not isinstance(spec, dict):
                continue
            value = (dev.get("state") or {}).get(fname)
            obj_type = spec.get("type") or "AV"
            dpt = "DPT-1.001" if obj_type == "BV" else "DPT-9.001"
            # синтетический ключ: <did>:<field>, чтобы не пересекаться с GA и MQTT
            key = f"{did}:{fname}"
            rec = {
                "dpt": dpt,
                "value": value,
                "name": fname,
                # префикс объекта делаем DEV_<did>_<field>
            }
            obj = _publish_ga(key, rec)
            if obj is not None:
                objects_to_add.append(obj)
    if not objects_to_add:
        log.info("[bacnet] no new objects to add")
        return

    # 5) регистрируем все новые объекты одной пачкой
    try:
        objects_to_add[-1].add_objects_to_application(_bacnet)
        log.info("[bacnet] added %d objects to application", len(objects_to_add))
    except Exception as e:
        log.error("[bacnet] add_objects_to_application error: %s", e)
        _last_error = f"add_objects_to_application: {e}"
        return

    # 6) инициализируем _last_seen
    for addr, info in _published.items():
        try:
            _last_seen[addr] = _bacnet[info["name"]].presentValue
        except Exception:
            pass


def _obj_name_for(addr: str) -> str:
    """GA_X_Y_Z — для KNX; MQTT_xxx — для топика; DEV_<did>_<field> — для поля устройства."""
    import re
    if re.match(r"^\d+/\d+/\d+$", addr or ""):
        return f"GA_{addr.replace('/', '_')}"
    if ":" in addr:
        did, fname = addr.split(":", 1)
        safe_did = re.sub(r"[^A-Za-z0-9_]", "_", did)[:20]
        safe_f   = re.sub(r"[^A-Za-z0-9_]", "_", fname)[:20]
        return f"DEV_{safe_did}_{safe_f}"
    safe = re.sub(r"[^A-Za-z0-9_]+", "_", addr or "")
    return f"MQTT_{safe[:40]}"


def _publish_ga(addr: str, rec: dict):
    """Создать объект BACnet для одного GA/MQTT-топика.
    Если объект с таким именем уже есть — обновить presentValue
    и вернуть None (чтобы не дублировать его в add_objects_to_application)."""
    global _next_instance
    if not _started or not _bacnet:
        return None

    obj_name = _obj_name_for(addr)
    dpt = (rec.get("dpt") or "").upper()
    value = rec.get("value")
    is_bool = dpt.startswith("DPT-1.") or isinstance(value, bool)

    # ---- если объект уже есть: обновить значение, не добавлять повторно ----
    existing = _find_existing_object(obj_name)
    if existing is not None:
        try:
            if is_bool:
                existing.presentValue = bool(value)
            elif isinstance(value, (int, float)):
                existing.presentValue = float(value)
        except Exception as e:
            log.debug("[bacnet] update existing %s: %s", obj_name, e)

        # зарегистрируем в _published, чтобы update_value работал
        kind = "BV" if is_bool else "AV"
        oid = getattr(existing, "objectIdentifier", None)
        instance = oid[1] if isinstance(oid, tuple) and len(oid) == 2 else 0
        _published[addr] = {
            "object": f"{kind},{instance}",
            "type": kind,
            "instance": instance,
            "name": obj_name,
            "is_bool": is_bool,
        }
        return None     # ← ВАЖНО: не добавляем повторно

    # ---- создаём новый объект ----
    instance = _next_instance
    _next_instance += 1
    descr = f"{rec.get('name') or ''} [{addr}]"

    try:
        if is_bool:
            obj = binary_value(
                instance=instance,
                name=obj_name,
                description=descr,
                presentValue=bool(value),
                is_commandable=True,
            )
            kind = "BV"
        else:
            if not isinstance(value, (int, float)) and value is not None:
                log.info("[bacnet] skip non-numeric %s (value=%r)", addr, value)
                return None
            obj = analog_value(
                instance=instance,
                name=obj_name,
                description=descr,
                presentValue=float(value) if value is not None else 0.0,
                properties={"units": "noUnits"},
                is_commandable=True,
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
# Обновление значения 
# --------------------------------------------------------------------
def update_value(addr: str, value):
    """Вызывается из knx_client / knx_ga_store / api при изменении GA,
    MQTT-топика или поля устройства.

    addr: "X/Y/Z" (KNX GA), "topic" (MQTT) или "<device_id>:<field>".
    """
    if not _started:
        return
    if addr not in _published:
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

    try:
        if _bacnet is not None:
            res = _bacnet.disconnect()
            if asyncio.iscoroutine(res):
                try:
                    asyncio.run(res)
                except RuntimeError:
                    pass
    except Exception:
        pass
    _bacnet = None
    _started = False


def restart():
    stop()
    start()


# --------------------------------------------------------------------
# Вспомогательные
# --------------------------------------------------------------------
def _unpublish_object(name: str):
    """Удалить объект из BACnet-приложения по имени."""
    if not _bacnet:
        return
    try:
        app = getattr(_bacnet, "this_application", None)
        if not app:
            return

        objs = getattr(app, "objects", None) or {}
        target = str(name)

        for oid, obj in list(objs.items()):
            obj_name = getattr(obj, "objectName", None)
            if obj_name is None:
                continue
            if str(obj_name) == target:
                try:
                    if hasattr(app, "delete_object"):
                        app.delete_object(oid)
                    else:
                        objs.pop(oid, None)
                    log.info("[bacnet] removed object %s (%s)", target, oid)
                except Exception as e:
                    log.warning("[bacnet] delete_object %s error: %s", oid, e)
                return
        log.debug("[bacnet] unpublish: %r not found", name)
    except Exception as e:
        log.debug("[bacnet] unpublish %s error: %s", name, e)


def _find_existing_object(name: str):
    if not _bacnet:
        return None
    try:
        app = getattr(_bacnet, "this_application", None)
        if not app:
            return None
        for oid, obj in getattr(app, "objects", {}).items():
            if str(getattr(obj, "objectName", "")) == str(name):
                return obj
    except Exception:
        pass
    return None