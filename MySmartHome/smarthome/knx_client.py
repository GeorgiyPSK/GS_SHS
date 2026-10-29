# knx_client.py
"""
KNX/IP для GS Smart на базе xknx (структура как в modbus).

- device["knx"]["fields"] = { field: spec }, где spec:
    { "address": "1/2/3", "dpt": "DPT-1.001",
      "mul"/"div"/"add"/"sub"/"round"/"clamp": ...,
      "read":  { address, dpt, mul, ... },
      "write": { address, dpt, mul, ... } }
- Опрос и запись работают по всем устройствам с knx.enabled = true.
- При приёме телеграмм из шины обновляет state и уведомляет UI через SSE.
"""
from __future__ import annotations
import time
import asyncio
import logging
import struct
import threading
from datetime import datetime

from state import state, save_state

log = logging.getLogger("smarthome.knx")

try:
    from xknx import XKNX
    from xknx.io import ConnectionConfig, ConnectionType
    from xknx.telegram import Telegram, GroupAddress
    from xknx.telegram.apci import GroupValueRead, GroupValueWrite
    from xknx.telegram.address import parse_device_group_address
    from xknx.dpt import DPTBase, DPTBinary, DPTArray
    XKNX_AVAILABLE = True
except Exception:
    XKNX = None
    ConnectionConfig = None
    ConnectionType = None
    Telegram = None
    GroupAddress = None
    GroupValueRead = None
    GroupValueWrite = None
    parse_device_group_address = None
    DPTBase = None
    DPTBinary = None
    DPTArray = None
    XKNX_AVAILABLE = False


# ------------------------------------------------------------
# Глобальное состояние модуля
# ------------------------------------------------------------
_xknx: "XKNX|None" = None
_loop: asyncio.AbstractEventLoop | None = None
_thread: threading.Thread | None = None
_stop = threading.Event()           # для xknx-потока
_stop_watchdog = threading.Event()  # для watchdog

# подписки: group_address(str) -> (dev_id, field)
_subscriptions: dict[str, tuple[str, str]] = {}
_subs_lock = threading.Lock()
_connected = False
_last_error: str | None = None
_last_change_ts: float = 0.0
_reconnect_attempts = 0
_watchdog_thread: threading.Thread | None = None

# --- Автопереподключение ---
RECONNECT_AFTER = 10          # сек без связи до первого рестарта
RECONNECT_MIN_INTERVAL = 15   # минимум между попытками
RECONNECT_MAX_INTERVAL = 300  # максимум между попытками
_reconnect_attempts = 0
_last_reconnect_ts = 0.0
_restart_in_progress = False
# ------------------------------------------------------------
# Настройки KNX
# ------------------------------------------------------------
def _cfg() -> dict:
    st = state.setdefault("settings", {})
    return st.setdefault("knx", {
        "enabled": False,
        "connection": "automatic",
        "gateway_ip": "",
        "gateway_port": 3671,
        "own_address": "15.15.250",
        "individual_address": "15.15.250",
    })

def _watchdog_loop():
    global _last_error, _reconnect_attempts, _last_reconnect_ts, _restart_in_progress, _last_change_ts
    log.info("[knx] watchdog started")
    while not _stop_watchdog.is_set():
        for _ in range(50):
            if _stop_watchdog.is_set():
                break
            time.sleep(0.1)
        if _stop_watchdog.is_set():
            break

        try:
            cfg = _cfg()
            if not cfg.get("enabled"):
                _reconnect_attempts = 0
                _last_reconnect_ts = 0.0
                continue

            connected = _is_knx_connected()

            if connected:
                if _last_error:
                    _last_error = None
                    log.info("[knx] connection restored (watchdog)")
                    _notify_ui()
                _reconnect_attempts = 0
                _last_reconnect_ts = 0.0
                continue

            now = time.time()
            if not _last_change_ts:
                _last_change_ts = now
            down_for = now - _last_change_ts

            if _last_error != "connection lost":
                _last_error = "connection lost"
                log.warning("[knx] connection lost")
                _notify_ui()

            if down_for < RECONNECT_AFTER:
                continue

            if _restart_in_progress:
                continue

            backoff = min(
                RECONNECT_MAX_INTERVAL,
                RECONNECT_MIN_INTERVAL * (2 ** _reconnect_attempts),
            )
            if now - _last_reconnect_ts < backoff:
                continue

            _reconnect_attempts += 1
            _last_reconnect_ts = now
            _restart_in_progress = True
            log.warning(
                "[knx] reconnecting (attempt %d, down %.1fs, backoff %ds)",
                _reconnect_attempts, down_for, backoff,
            )
            _last_error = f"reconnecting (attempt {_reconnect_attempts})"
            _notify_ui()

            def _do_restart():
                global _restart_in_progress
                try:
                    restart()
                except Exception as e:
                    log.warning("[knx] reconnect failed: %s", e)
                finally:
                    _restart_in_progress = False

            threading.Thread(
                target=_do_restart, daemon=True, name="knx-reconnect"
            ).start()

        except Exception as e:
            log.warning("[knx] watchdog error: %s", e)
            
def _do_restart():
    global _restart_in_progress
    try:
        restart()
    except Exception as e:
        log.warning("[knx] reconnect failed: %s", e)
    finally:
        _restart_in_progress = False



def _notify_ui():
    try:
        from api import notify_state_changed
        notify_state_changed()
    except Exception:
        pass
        
def is_available() -> bool:
    return XKNX_AVAILABLE


def is_connected() -> bool:
    return _is_knx_connected()


# ------------------------------------------------------------
# DPT
# ------------------------------------------------------------
def _dpt_class(dpt: str):
    """Возвращает класс DPT по имени вроде 'DPT-1.001' / '1.001' / 'DPT-9.001'."""
    if not XKNX_AVAILABLE or not dpt:
        return None
    name = dpt.strip().upper()
    if name.startswith("DPT-"):
        name = name[4:]
    name = name.replace("/", ".")
    try:
        return DPTBase.parse_transcoder(name)
    except Exception:
        log.warning("[knx] неизвестный DPT %r", dpt)
        return None


def _to_knx(value, dpt: str):
    cls = _dpt_class(dpt)
    if cls is not None:
        try:
            return cls.to_knx(value)
        except Exception:
            pass
    if isinstance(value, bool):
        return DPTBinary(1 if value else 0)
    return value


def _ensure_primitive(v):
    """Гарантирует, что значение можно сериализовать в JSON."""
    if v is None or isinstance(v, (bool, int, float, str)):
        return v
    if isinstance(v, (list, tuple)):
        return [_ensure_primitive(x) for x in v]
    if isinstance(v, dict):
        return {str(k): _ensure_primitive(val) for k, val in v.items()}
    if isinstance(v, (bytes, bytearray)):
        return int.from_bytes(bytes(v), "big")
    return str(v)


def _from_knx(payload, dpt: str):
    """payload из xknx → python-примитив."""
    cls = _dpt_class(dpt)
    if cls is not None:
        try:
            return _ensure_primitive(cls.from_knx(payload))
        except Exception:
            pass

    if isinstance(payload, DPTBinary):
        return bool(payload.value)

    if isinstance(payload, DPTArray):
        try:
            raw = bytes(payload.value)
            if len(raw) == 1:
                return raw[0]
            if len(raw) == 2:
                return int.from_bytes(raw, "big")
            if len(raw) == 4:
                try:
                    return struct.unpack(">f", raw)[0]
                except Exception:
                    return int.from_bytes(raw, "big")
            return int.from_bytes(raw, "big")
        except Exception:
            return None

    inner = getattr(payload, "value", None)
    if inner is not None and not isinstance(inner, (str, int, float, bool, dict, list)):
        return _from_knx(inner, dpt)
    return _ensure_primitive(payload)


# ------------------------------------------------------------
# Постобработка значения (как в modbus)
# ------------------------------------------------------------
def _apply_scale(raw, spec):
    """Порядок: formula → mul → div → add → sub → round → clamp."""
    x = raw

    formula = spec.get("formula")
    if formula:
        x = _safe_eval_formula(formula, x)
    else:
        mul = spec.get("mul", spec.get("scale"))
        div = spec.get("div")
        add = spec.get("add", spec.get("offset"))
        sub = spec.get("sub")
        try:
            if mul is not None:  x = float(x) * float(mul)
            if div not in (None, 0): x = float(x) / float(div)
            if add is not None:  x = float(x) + float(add)
            if sub is not None:  x = float(x) - float(sub)
        except Exception:
            pass

    try:
        r = spec.get("round")
        if r is not None:
            x = round(float(x), int(r))
    except Exception:
        pass

    try:
        cl = spec.get("clamp")
        if isinstance(cl, (list, tuple)) and len(cl) == 2:
            x = max(float(cl[0]), min(float(cl[1]), float(x)))
    except Exception:
        pass

    return _ensure_primitive(x)


def _reverse_scale(value, spec):
    """Обратное преобразование для записи."""
    x = value

    try:
        cl = spec.get("clamp")
        if isinstance(cl, (list, tuple)) and len(cl) == 2:
            x = max(float(cl[0]), min(float(cl[1]), float(x)))
    except Exception:
        pass

    mul = spec.get("mul", spec.get("scale"))
    div = spec.get("div")
    add = spec.get("add", spec.get("offset"))
    sub = spec.get("sub")

    try:
        if sub is not None:  x = float(x) + float(sub)
        if add is not None:  x = float(x) - float(add)
        if div not in (None, 0): x = float(x) * float(div)
        if mul not in (None, 0): x = float(x) / float(mul)
    except Exception:
        pass

    dpt = (spec.get("dpt") or "").upper()
    # для целочисленных DPT — округляем
    if any(k in dpt for k in ("1.", "5.", "7.", "8.", "12.", "13.", "20.")):
        try:
            x = int(round(float(x)))
        except Exception:
            pass
    return x


# ------------------------------------------------------------
# Безопасный вычислитель formula
# ------------------------------------------------------------
import ast
import operator as _op

_ALLOWED_BINOPS = {
    ast.Add: _op.add, ast.Sub: _op.sub, ast.Mult: _op.mul,
    ast.Div: _op.truediv, ast.FloorDiv: _op.floordiv,
    ast.Mod: _op.mod, ast.Pow: _op.pow,
}
_ALLOWED_UNARY = {ast.UAdd: _op.pos, ast.USub: _op.neg}
_ALLOWED_FUNCS = {
    "abs": abs, "min": min, "max": max, "round": round,
    "int": int, "float": float,
}


def _safe_eval_formula(expr: str, x):
    try:
        node = ast.parse(str(expr), mode="eval")
    except SyntaxError:
        return x

    def _ev(n):
        if isinstance(n, ast.Expression): return _ev(n.body)
        if isinstance(n, ast.Constant):   return n.value
        if isinstance(n, ast.Name):
            if n.id == "x": return x
            if n.id in _ALLOWED_FUNCS: return _ALLOWED_FUNCS[n.id]
            raise ValueError(n.id)
        if isinstance(n, ast.BinOp) and type(n.op) in _ALLOWED_BINOPS:
            return _ALLOWED_BINOPS[type(n.op)](_ev(n.left), _ev(n.right))
        if isinstance(n, ast.UnaryOp) and type(n.op) in _ALLOWED_UNARY:
            return _ALLOWED_UNARY[type(n.op)](_ev(n.operand))
        if isinstance(n, ast.Call):
            f = _ev(n.func)
            if f not in _ALLOWED_FUNCS.values():
                raise ValueError("call not allowed")
            return f(*[_ev(a) for a in n.args])
        if isinstance(n, (ast.Tuple, ast.List)):
            return [_ev(e) for e in n.elts]
        raise ValueError(type(n).__name__)

    try:
        return _ev(node)
    except Exception:
        return x


# ------------------------------------------------------------
# Спеки полей: общая + read/write
# ------------------------------------------------------------
def _spec_read(spec: dict) -> dict:
    if not spec: return {}
    r = dict(spec)
    sub = spec.get("read")
    if isinstance(sub, dict):
        for k, v in sub.items():
            r[k] = v
    return r


def _spec_write(spec: dict) -> dict:
    if not spec: return {}
    w = dict(spec)
    sub = spec.get("write")
    if isinstance(sub, dict):
        for k, v in sub.items():
            w[k] = v
    return w


# ------------------------------------------------------------
# Подписки
# ------------------------------------------------------------
def _normalize_knx(dev: dict) -> dict:
    """Приводит старую структуру knx (address/read_address/write_address/field/dpt)
    к новой — fields = {field: spec}."""
    knx = dev.setdefault("knx", {})
    if "fields" in knx and isinstance(knx["fields"], dict) and knx["fields"]:
        return knx

    field = (knx.get("field") or "").strip()
    address = (knx.get("address") or "").strip()
    read_a = (knx.get("read_address") or "").strip()
    write_a = (knx.get("write_address") or "").strip()
    dpt = knx.get("dpt") or "DPT-1.001"

    if field and (address or read_a or write_a):
        spec = {"dpt": dpt}
        if read_a and write_a and read_a != write_a:
            spec["read"] = {"address": read_a, "dpt": dpt}
            spec["write"] = {"address": write_a, "dpt": dpt}
        else:
            spec["address"] = address or read_a or write_a
        knx["fields"] = {field: spec}
        # не удаляем старые поля — совместимость
    else:
        knx.setdefault("fields", {})
    return knx


def _build_subscriptions():
    new_map: dict[str, tuple[str, str]] = {}
    for dev_id, dev in state["devices"].items():
        knx = _normalize_knx(dev)
        if not knx.get("enabled"):
            continue
        for field, spec in (knx.get("fields") or {}).items():
            rspec = _spec_read(spec)
            addr = (rspec.get("address") or "").strip()
            if addr:
                new_map[addr] = (dev_id, field)
    with _subs_lock:
        _subscriptions.clear()
        _subscriptions.update(new_map)
    log.info("[knx] subscriptions: %s", list(new_map.keys()))


# ------------------------------------------------------------
# Приём телеграмм
# ------------------------------------------------------------
from xknx.telegram.apci import GroupValueRead, GroupValueWrite, GroupValueResponse
def _telegram_received(telegram):
    try:
        src = str(telegram.source_address)
        dst = str(telegram.destination_address)
        payload = telegram.payload

#        log.debug("[knx] telegram: %s → %s : %r", src, dst, payload)

        if isinstance(payload, GroupValueRead):
#            log.debug("[knx] skip GroupValueRead %s from %s", dst, src)
            return

        with _subs_lock:
            target = _subscriptions.get(dst)
        if not target:
#            log.debug("[knx] no subscription for %s", dst)
            return

        dev_id, field = target
        dev = state["devices"].get(dev_id)
        if not dev:
#            log.warning("[knx] device %s not found", dev_id)
            return

        knx = _normalize_knx(dev)
        spec = (knx.get("fields") or {}).get(field)
        if not spec:
#            log.warning("[knx] no field spec for %s.%s", dev_id, field)
            return

        rspec = _spec_read(spec)
        dpt = rspec.get("dpt") or "DPT-1.001"

        # ▼▼▼ ЛОГ ДО ПАРСИНГА ▼▼▼
#        log.info("[knx] parse %s.%s payload=%r dpt=%s", dev_id, field, payload, dpt)

        value = _ensure_primitive(_from_knx(payload, dpt))

        # ▼▼▼ ЛОГ ПОСЛЕ ПАРСИНГА ▼▼▼
#        log.info("[knx] parsed value=%r type=%s", value, type(value).__name__)

        value = _apply_scale(value, rspec)

#        log.info("[knx] scaled value=%r", value)

        cur = dev["state"].get(field)
        if isinstance(cur, bool):
            value = bool(value)
        elif isinstance(cur, int) and not isinstance(cur, bool):
            try: value = int(value)
            except Exception: pass
        elif isinstance(cur, float):
            try: value = float(value)
            except Exception: pass

        if dev["state"].get(field) == value:
            log.info("[knx] %s.%s unchanged (%r == %r)", dev_id, field, dev["state"].get(field), value)
            return

        old_value = dev["state"].get(field)
        dev["state"][field] = value
        dev["updated"] = datetime.now().isoformat(timespec="seconds")
        save_state()
        # Обновляем реестр GA
        try:
            import knx_ga_store
            knx_ga_store.set_value(dst, value, source="bus")
        except Exception as e:
            log.warning("[knx] ga_store error: %s", e)
        # Логирование значений
        try:
            log_cfg = dev.get("logging") or {}
            if log_cfg.get("enabled"):
                allowed = set(log_cfg.get("fields") or [])
                if (not allowed) or (field in allowed):
                    from logger_store import append as log_append
                    log_append(dev_id, field, value)
        except Exception:
            pass

        # === event_bus: телеграмма KNX ===
        try:
            import event_bus
            event_bus.publish(
                "knx",
                source="knx_client",
                knx={
                    "source": src,
                    "dest":   dst,
                    "value":  value,
                },
            )
            # изменение устройства
            event_bus.publish(
                "device_changed",
                source="knx_client",
                device_id=dev_id,
                field=field,
                value=value,
                old_value=old_value,
            )
        except Exception as e:
            log.warning("[knx] event_bus error: %s", e)
    except Exception as e:
        log.warning("[knx] telegram handler error: %s", e)

# ------------------------------------------------------------
# XKNX loop
# ------------------------------------------------------------
async def _run_xknx():
    global _xknx, _connected, _last_error, _last_change_ts

    cfg = _cfg()

    if cfg.get("connection") == "tunnel" and cfg.get("gateway_ip"):
        conn = ConnectionConfig(
            connection_type=ConnectionType.TUNNELING,
            gateway_ip=cfg["gateway_ip"],
            gateway_port=int(cfg.get("gateway_port") or 3671),
            route_back=bool(cfg.get("route_back", False)),
        )
        _xknx = XKNX(connection_config=conn)
    elif cfg.get("connection") == "routing":
        conn = ConnectionConfig(connection_type=ConnectionType.ROUTING)
        _xknx = XKNX(connection_config=conn)
    else:
        _xknx = XKNX()

    # (Никаких _on_disconnected() здесь — состояния задаются ниже.)

    def _on_conn_state_changed(state):
        global _connected, _last_error, _last_change_ts, _reconnect_attempts
        name = str(getattr(state, "name", state)).upper()
        if name == "CONNECTED":
            _connected = True
            _last_error = None
            _last_change_ts = 0.0
            _reconnect_attempts = 0
            log.info("[knx] connected to gateway")
        else:
            was = _connected
            _connected = False
            if was:
                # фиксируем момент разрыва только при переходе из connected
                _last_change_ts = time.time()
                _last_error = f"state={name.lower()}"
                log.warning("[knx] connection lost: %s", _last_error)

    try:
        cm = _xknx.connection_manager
        cm.register_connection_state_changed_cb(_on_conn_state_changed)
        # применим текущее состояние сразу
        _on_conn_state_changed(getattr(cm, "state", None))
    except Exception as e:
        log.info("[knx] connection_state callback not available: %s", e)

    _xknx.telegram_queue.register_telegram_received_cb(_telegram_received)

    started_ok = False
    try:
        await _xknx.start()
        _connected = True
        _last_change_ts = 0.0
        started_ok = True
        log.info("[knx] started (connection=%s)", cfg.get("connection"))
    except Exception as e:
        _connected = False
        _last_error = str(e)
        _last_change_ts = time.time()
        log.error("[knx] start failed: %s", e)

    if not started_ok:
        try:
            await _xknx.stop()
        except Exception:
            pass
        _xknx = None
        _connected = False
        return

    _build_subscriptions()

    while not _stop.is_set():
        await asyncio.sleep(0.5)

    try:
        await _xknx.stop()
    except Exception:
        pass
    _connected = False
    _xknx = None
    log.info("[knx] stopped")


def _thread_main():
    global _loop
    _loop = asyncio.new_event_loop()
    asyncio.set_event_loop(_loop)
    try:
        _loop.run_until_complete(_run_xknx())
    except Exception as e:
        log.error("[knx] thread error: %s", e)
    finally:
        _loop.close()

def _is_knx_connected() -> bool:
    """Реальное состояние соединения через xknx 3.20."""
    if _xknx is None:
        return False
    cm = getattr(_xknx, "connection_manager", None)
    if cm is None:
        return False
    st = getattr(cm, "state", None)
    if st is None:
        return bool(_connected)
    name = str(getattr(st, "name", st)).upper()
    return name == "CONNECTED"

# ------------------------------------------------------------
# Публичное API
# ------------------------------------------------------------
def start():
    global _thread, _watchdog_thread
    if not XKNX_AVAILABLE:
        log.info("[knx] xknx не установлен — KNX отключён")
        return
    if not _cfg().get("enabled"):
        log.info("[knx] disabled in settings")
        return
    if _thread and _thread.is_alive():
        return

    _stop.clear()
    _thread = threading.Thread(target=_thread_main, daemon=True, name="knx")
    _thread.start()

    if not (_watchdog_thread and _watchdog_thread.is_alive()):
        _stop_watchdog.clear()
        _watchdog_thread = threading.Thread(target=_watchdog_loop, daemon=True, name="knx-watchdog")
        _watchdog_thread.start()


def stop():
    _stop.set()          # только xknx-поток

def stop_all():
    _stop.set()
    _stop_watchdog.set()

def restart():
    stop()
    if _thread and _thread.is_alive():
        _thread.join(timeout=5)
    start()


def refresh_subscriptions():
    _build_subscriptions()


# ------------------------------------------------------------
# Чтение значения с шины (GroupValueRead)
# ------------------------------------------------------------
def read_field(dev_id: str, field: str) -> bool:
    """
    Отправляет GroupValueRead на адрес чтения (read.address).
    Ответ придёт в _telegram_received, обновит state.
    """
    if not (_xknx and _loop):
        return False

    dev = state["devices"].get(dev_id)
    if not dev:
        return False

    knx = _normalize_knx(dev)
    spec = (knx.get("fields") or {}).get(field)
    if not spec:
        return False

    rspec = _spec_read(spec)
    read_addr = (rspec.get("address") or "").strip()
    if not read_addr:
        return False

    async def _do_read():
        try:
            ga = parse_device_group_address(read_addr)
            telegram = Telegram(
                destination_address=ga,
                payload=GroupValueRead(),
            )
            await _xknx.telegrams.put(telegram)
            log.info("[knx] read request sent: %s (%s.%s)", read_addr, dev_id, field)
        except Exception as e:
            log.warning("[knx] read %s: %s", read_addr, e)

    asyncio.run_coroutine_threadsafe(_do_read(), _loop)
    return True


# ------------------------------------------------------------
# Запись в шину (GroupValueWrite)
# ------------------------------------------------------------
def publish_fields(dev_id: str, changed: dict) -> bool:
    """Отправляет GroupValueWrite для изменённых полей, у которых есть write-адрес."""
    if not (_xknx and _loop):
        return False

    dev = state["devices"].get(dev_id)
    if not dev:
        return False
    knx = _normalize_knx(dev)
    if not knx.get("enabled"):
        return False

    fields = knx.get("fields") or {}
    sent = False

    for field, value in changed.items():
        spec = fields.get(field)
        if not spec:
            continue
        wspec = _spec_write(spec)
        write_addr = (wspec.get("address") or "").strip()
        if not write_addr:
            continue
        dpt = wspec.get("dpt") or "DPT-1.001"
        raw_value = _reverse_scale(value, wspec)
        payload = _to_knx(raw_value, dpt)

        async def _do_write(addr=write_addr, pl=payload, vl=value, dp=dpt, f=field):
            try:
                ga = parse_device_group_address(addr)
                telegram = Telegram(
                    destination_address=ga,
                    payload=GroupValueWrite(pl),
                )
                await _xknx.telegrams.put(telegram)
                log.info("[knx] >> %s.%s = %r -> %s (dpt=%s)", dev_id, f, vl, addr, dp)

                # publish в event_bus
                try:
                    import event_bus
                    event_bus.publish(
                        "knx",
                        source="knx_client_write",
                        knx={
                            "source": "server",
                            "dest":   addr,
                            "value":  vl,
                        },
                    )
                except Exception:
                    pass

            except Exception as e:
                log.warning("[knx] write %s: %s", addr, e)
                try:
                    import knx_ga_store
                    knx_ga_store.set_value(addr, vl, source="ui")
                except Exception as e:
                    log.warning("[knx] ga_store write error: %s", e)
        asyncio.run_coroutine_threadsafe(_do_write(), _loop)
        sent = True

    return sent
    
def get_status() -> dict:
    """Полный статус KNX для API/UI."""
    return {
        "available": XKNX_AVAILABLE,
        "connected": is_connected(),
        "last_error": _last_error,
        "last_change": _last_change_ts,
        "running": _xknx is not None,
    }
    
    
def write_group_address(addr: str, value, dpt: str = "DPT-1.001") -> bool:
    """Записать значение в GA (без привязки к устройству)."""
    if not (_xknx and _loop):
        return False
    try:
        raw = _reverse_scale(value, {"dpt": dpt})
        payload = _to_knx(raw, dpt)
    except Exception as e:
        log.warning("[knx] write_group_address convert error: %s", e)
        return False

    async def _do():
        try:
            ga = parse_device_group_address(addr)
            telegram = Telegram(
                destination_address=ga,
                payload=GroupValueWrite(payload),
            )
            await _xknx.telegrams.put(telegram)
            log.info("[knx] >> GA %s = %r (dpt=%s)", addr, value, dpt)
        except Exception as e:
            log.warning("[knx] write GA %s error: %s", addr, e)

    asyncio.run_coroutine_threadsafe(_do(), _loop)
    return True


def read_group_address(addr: str) -> bool:
    """Отправить GroupValueRead на GA."""
    if not (_xknx and _loop):
        return False

    async def _do():
        try:
            ga = parse_device_group_address(addr)
            telegram = Telegram(
                destination_address=ga,
                payload=GroupValueRead(),
            )
            await _xknx.telegrams.put(telegram)
            log.info("[knx] read GA %s", addr)
        except Exception as e:
            log.warning("[knx] read GA %s error: %s", addr, e)

    asyncio.run_coroutine_threadsafe(_do(), _loop)
    return True