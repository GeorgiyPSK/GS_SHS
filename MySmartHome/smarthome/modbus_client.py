# modbus_client.py
"""
Modbus TCP / RTU для GS Smart.

- Опрашивает устройства с полем device["modbus"] и раскладывает значения в state.
- Пишет значения в регистры, когда меняется state (через devices.set_device_state).
- Совместим с pymodbus 3.6 (slave=) и 3.7+/3.8 (device_id=/unit=).
- Поддерживает постобработку значения: +-*/ , round, clamp, formula.
"""
from __future__ import annotations

import ast
import inspect
import operator as _op
import struct
import threading
import time
import logging
from datetime import datetime

from state import state, save_state

log = logging.getLogger("smarthome.modbus")

try:
    from pymodbus.client import ModbusTcpClient, ModbusSerialClient
    from pymodbus.exceptions import ModbusException
    PYMODBUS_AVAILABLE = True
except Exception:
    ModbusTcpClient = None
    ModbusSerialClient = None
    ModbusException = Exception
    PYMODBUS_AVAILABLE = False


# ------------------------------------------------------------
# Совместимость с разными версиями pymodbus
# ------------------------------------------------------------
def _call_modbus(method, *args, **kwargs):
    try:
        sig = inspect.signature(method)
    except (TypeError, ValueError):
        return method(*args, **kwargs)

    params = sig.parameters

    if "slave" in params:
        return method(*args, **kwargs)
    if "device_id" in params and "slave" in kwargs:
        kwargs["device_id"] = kwargs.pop("slave")
        return method(*args, **kwargs)
    if "unit" in params and "slave" in kwargs:
        kwargs["unit"] = kwargs.pop("slave")
        return method(*args, **kwargs)

    kwargs.pop("slave", None)
    return method(*args, **kwargs)


# ------------------------------------------------------------
# Безопасный вычислитель formula
# ------------------------------------------------------------
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
    """Вычисляет formula с переменной x. Разрешены только арифметика и min/max/abs/round/int/float."""
    try:
        node = ast.parse(str(expr), mode="eval")
    except SyntaxError as e:
        log.warning("[modbus] formula parse error: %s (%s)", expr, e)
        return x

    def _ev(n):
        if isinstance(n, ast.Expression):
            return _ev(n.body)
        if isinstance(n, ast.Constant):
            return n.value
        if isinstance(n, ast.Name):
            if n.id == "x":
                return x
            if n.id in _ALLOWED_FUNCS:
                return _ALLOWED_FUNCS[n.id]
            raise ValueError(f"name not allowed: {n.id}")
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
        raise ValueError(f"node not allowed: {type(n).__name__}")

    try:
        return _ev(node)
    except Exception as e:
        log.warning("[modbus] formula eval error: %s (%s)", expr, e)
        return x

def _spec_read(spec: dict) -> dict:
    """Собирает эффективную спеку для чтения: read + общие поля."""
    if not spec:
        return {}
    r = dict(spec)
    sub = spec.get("read")
    if isinstance(sub, dict):
        # sub переопределяет kind/address/type/count, но наследует scale/mul/…,
        # если они не заданы явно в sub
        for k, v in sub.items():
            r[k] = v
    return r


def _spec_write(spec: dict) -> dict:
    """Собирает эффективную спеку для записи: write + общие поля."""
    if not spec:
        return {}
    w = dict(spec)
    sub = spec.get("write")
    if isinstance(sub, dict):
        for k, v in sub.items():
            w[k] = v
    return w
# ------------------------------------------------------------
# Постобработка значения (после чтения)
# ------------------------------------------------------------
def _apply_scale(raw, spec):
    """
    Порядок:
      1) formula (если задана) — вместо цепочки mul/div/add/sub
      2) mul -> div -> add -> sub  (scale/offset = алиасы mul/add)
      3) round
      4) clamp
    """
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
            if mul is not None:
                x = float(x) * float(mul)
            if div not in (None, 0):
                x = float(x) / float(div)
            if add is not None:
                x = float(x) + float(add)
            if sub is not None:
                x = float(x) - float(sub)
        except Exception:
            pass

    try:
        r = spec.get("round")
        if r is not None:
            nd = int(r)
            x = round(float(x), nd)
    except Exception:
        pass

    try:
        cl = spec.get("clamp")
        if isinstance(cl, (list, tuple)) and len(cl) == 2:
            lo, hi = float(cl[0]), float(cl[1])
            x = max(lo, min(hi, float(x)))
    except Exception:
        pass

    return x


# ------------------------------------------------------------
# Обратное преобразование (перед записью)
# ------------------------------------------------------------
def _reverse_scale(value, spec):
    """
    Инвертирует цепочку mul/div/add/sub и clamp.
    formula не инвертируется (произвольное выражение).
    """
    x = value

    # снимаем clamp
    try:
        cl = spec.get("clamp")
        if isinstance(cl, (list, tuple)) and len(cl) == 2:
            lo, hi = float(cl[0]), float(cl[1])
            x = max(lo, min(hi, float(x)))
    except Exception:
        pass

    # снимаем round — просто оставляем как есть, округление не мешает

    mul = spec.get("mul", spec.get("scale"))
    div = spec.get("div")
    add = spec.get("add", spec.get("offset"))
    sub = spec.get("sub")

    try:
        if sub is not None:
            x = float(x) + float(sub)
        if add is not None:
            x = float(x) - float(add)
        if div not in (None, 0):
            x = float(x) * float(div)
        if mul not in (None, 0):
            x = float(x) / float(mul)
    except Exception:
        pass

    # приводим к int, если исходный тип целочисленный
    dtype = (spec.get("type") or "uint16").lower()
    if dtype in ("uint16", "int16", "uint32", "int32", "bool"):
        try:
            x = int(round(float(x)))
        except Exception:
            pass
    return x


# ------------------------------------------------------------
# Пул соединений
# ------------------------------------------------------------
_clients: dict[str, "ModbusTcpClient|ModbusSerialClient"] = {}
_clients_lock = threading.Lock()


def _conn_key(cfg: dict) -> str:
    if cfg.get("transport") == "rtu":
        return "rtu:{port}:{baudrate}:{parity}:{stopbits}:{bytesize}:{unit}".format(
            port=cfg.get("port") or "",
            baudrate=cfg.get("baudrate", 9600),
            parity=cfg.get("parity", "N"),
            stopbits=cfg.get("stopbits", 1),
            bytesize=cfg.get("bytesize", 8),
            unit=cfg.get("unit", 1),
        )
    return "tcp:{host}:{port}".format(
        host=cfg.get("host") or "",
        port=cfg.get("tcp_port", 502),
    )


def _get_client(cfg: dict):
    if not PYMODBUS_AVAILABLE:
        raise RuntimeError("pymodbus не установлен (pip install pymodbus)")
    key = _conn_key(cfg)
    with _clients_lock:
        cli = _clients.get(key)
        if cli and getattr(cli, "connected", False):
            return cli

        if cfg.get("transport") == "rtu":
            cli = ModbusSerialClient(
                port=cfg.get("port"),
                baudrate=int(cfg.get("baudrate", 9600)),
                parity=cfg.get("parity", "N"),
                stopbits=int(cfg.get("stopbits", 1)),
                bytesize=int(cfg.get("bytesize", 8)),
                timeout=float(cfg.get("timeout", 1.0)),
            )
        else:
            cli = ModbusTcpClient(
                host=cfg.get("host", "127.0.0.1"),
                port=int(cfg.get("tcp_port", 502)),
                timeout=float(cfg.get("timeout", 1.0)),
            )

        try:
            cli.connect()
        except Exception as e:
            log.warning("[modbus] connect %s: %s", key, e)

        _clients[key] = cli
        return cli


def close_all():
    with _clients_lock:
        for cli in _clients.values():
            try:
                cli.close()
            except Exception:
                pass
        _clients.clear()


# ------------------------------------------------------------
# Чтение / запись регистров
# ------------------------------------------------------------
def _read_one(cli, unit: int, spec: dict):
    kind = (spec.get("kind") or "holding").lower()
    addr = int(spec.get("address", 0))
    count = int(spec.get("count", 1))
    dtype = (spec.get("type") or "uint16").lower()

    if kind == "coil":
        rr = _call_modbus(cli.read_coils, addr, count=count, slave=unit)
    elif kind == "discrete":
        rr = _call_modbus(cli.read_discrete_inputs, addr, count=count, slave=unit)
    elif kind == "input":
        rr = _call_modbus(cli.read_input_registers, addr, count=count, slave=unit)
    else:
        rr = _call_modbus(cli.read_holding_registers, addr, count=count, slave=unit)

    if rr is None or rr.isError():
        raise ModbusException(f"read error: {rr}")

    if kind in ("coil", "discrete"):
        bits = list(rr.bits)[:count]
        return bool(bits[0]) if count == 1 else [bool(b) for b in bits]

    regs = list(rr.registers)[:count]

    if dtype in ("uint16", "int16", "bool"):
        v = regs[0]
        if dtype == "int16" and v >= 0x8000:
            v -= 0x10000
        if dtype == "bool":
            return bool(v)
        return v
    if dtype == "uint32":
        return (regs[0] << 16) | regs[1]
    if dtype == "int32":
        v = (regs[0] << 16) | regs[1]
        if v >= 0x80000000:
            v -= 0x100000000
        return v
    if dtype == "float32":
        return struct.unpack(">f", struct.pack(">HH", regs[0], regs[1]))[0]
    return regs[0]


def _write_one(cli, unit: int, spec: dict, value):
    kind = (spec.get("kind") or "holding").lower()
    addr = int(spec.get("address", 0))
    dtype = (spec.get("type") or "uint16").lower()

    if kind == "coil":
        return _call_modbus(cli.write_coil, addr, bool(value), slave=unit)
    if kind != "holding":
        raise ModbusException("запись возможна только в coil/holding")

    if dtype in ("uint16", "int16", "bool"):
        v = int(value)
        if dtype == "int16" and v < 0:
            v += 0x10000
        if dtype == "bool":
            v = 1 if value else 0
        return _call_modbus(cli.write_register, addr, v & 0xFFFF, slave=unit)

    if dtype == "uint32":
        v = int(value) & 0xFFFFFFFF
        regs = [(v >> 16) & 0xFFFF, v & 0xFFFF]
    elif dtype == "int32":
        v = int(value) & 0xFFFFFFFF
        regs = [(v >> 16) & 0xFFFF, v & 0xFFFF]
    elif dtype == "float32":
        regs = list(struct.unpack(">HH", struct.pack(">f", float(value))))
    else:
        regs = [int(value) & 0xFFFF]
    return _call_modbus(cli.write_registers, addr, regs, slave=unit)


# ------------------------------------------------------------
# Публичное: читать все поля одного устройства
# ------------------------------------------------------------
def read_device(dev_id: str) -> dict:
    dev = state["devices"].get(dev_id)
    if not dev:
        return {}
    m = dev.get("modbus") or {}
    if not m.get("enabled"):
        return {}
    fields = m.get("fields") or {}
    if not fields:
        return {}

    cfg = m.get("conn") or {}
    cli = _get_client(cfg)
    unit = int(cfg.get("unit", 1))
    out = {}
    for field, spec in fields.items():
        if not spec or spec.get("rw") == "w":
            continue
        try:
            rspec = _spec_read(spec)
            if not rspec.get("kind") and not rspec.get("address"):
                continue
            raw = _read_one(cli, unit, rspec)
            out[field] = _apply_scale(raw, rspec)
        except Exception as e:
            log.warning("[modbus] read %s.%s: %s", dev_id, field, e)
    return out


# ------------------------------------------------------------
# Публичное: писать одно поле
# ------------------------------------------------------------
def write_field(dev_id: str, field: str, value) -> bool:
    dev = state["devices"].get(dev_id)
    if not dev:
        print(f"[modbus] write {dev_id}.{field}: device not found")
        return False
    m = dev.get("modbus") or {}
    spec = (m.get("fields") or {}).get(field)
    if not spec or spec.get("rw") == "r":
        return False
    wspec = _spec_write(spec)
    if not wspec.get("kind") and not wspec.get("address"):
        log.warning("[modbus] write %s.%s: нет write-спеки", dev_id, field)
        return False
    cfg = m.get("conn") or {}
    cli = _get_client(cfg)
    unit = int(cfg.get("unit", 1))
    raw = _reverse_scale(value, wspec)
    try:
        rr = _write_one(cli, unit, wspec, raw)
        print(f"[modbus] write result: {rr}")
        if rr is None or rr.isError():
            log.warning("[modbus] write %s.%s: %s", dev_id, field, rr)
            return False
        return True
    except Exception as e:
        print(f"[modbus] write exception: {e}")
        log.warning("[modbus] write %s.%s: %s", dev_id, field, e)
        return False


# ------------------------------------------------------------
# Фоновый цикл опроса
# ------------------------------------------------------------
_poll_thread = None
_poll_stop = threading.Event()


def _poll_loop():
    log.info("[modbus] polling started")
    while not _poll_stop.is_set():
        try:
            poll_ms = int(state.get("settings", {}).get("modbus_poll_ms", 2000))
        except Exception:
            poll_ms = 2000
        interval = max(0.2, poll_ms / 1000.0)

        for dev_id, dev in list(state["devices"].items()):
            m = dev.get("modbus") or {}
            if not m.get("enabled"):
                continue
            try:
                new_vals = read_device(dev_id)
            except Exception as e:
                log.warning("[modbus] poll %s: %s", dev_id, e)
                continue
            if not new_vals:
                continue

            changed = False
            for k, v in new_vals.items():
                if dev["state"].get(k) != v:
                    dev["state"][k] = v
                    changed = True

            # Логирование значений
            try:
                log_cfg = dev.get("logging") or {}
                if log_cfg.get("enabled"):
                    allowed = set(log_cfg.get("fields") or [])
                    from logger_store import append as log_append
                    for k, v in new_vals.items():
                        if allowed and k not in allowed:
                            continue
                        log_append(dev_id, k, v)
            except Exception:
                pass

            if changed:
                dev["updated"] = datetime.now().isoformat(timespec="seconds")
                save_state()
                try:
                    from api import notify_state_changed
                    notify_state_changed()
                except Exception:
                    pass

        _poll_stop.wait(interval)


def start_polling():
    global _poll_thread
    if _poll_thread and _poll_thread.is_alive():
        return
    _poll_stop.clear()
    _poll_thread = threading.Thread(
        target=_poll_loop, daemon=True, name="modbus-poll"
    )
    _poll_thread.start()


def stop_polling():
    _poll_stop.set()