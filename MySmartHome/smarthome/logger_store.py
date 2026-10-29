# logger_store.py
"""
Журнал значений полей устройств.

Для каждого устройства пишет строки в CSV:
    ts, field, value

Файлы: logs/devices/<device_id>.csv
Ротация по размеру (по умолчанию 1 МБ), хранится N последних файлов.
"""
from __future__ import annotations

import csv
import logging
import os
import threading
from datetime import datetime

log = logging.getLogger("smarthome.logger_store")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_DIR = os.path.join(BASE_DIR, "logs", "devices")
os.makedirs(LOG_DIR, exist_ok=True)

_lock = threading.Lock()

# сколько записей максимум отдавать по API
MAX_READ_ROWS = 5000
# размер файла для ротации, байт
ROTATE_BYTES = 1024 * 1024
# сколько последних файлов на устройство держать
KEEP_FILES = 5


def _device_file(dev_id: str) -> str:
    return os.path.join(LOG_DIR, f"{dev_id}.csv")


def _rotate_if_needed(path: str) -> None:
    try:
        if not os.path.exists(path):
            return
        if os.path.getsize(path) < ROTATE_BYTES:
            return
        # сдвигаем .csv -> .csv.1 -> .csv.2 -> ...
        for i in range(KEEP_FILES - 1, 0, -1):
            src = f"{path}.{i}"
            dst = f"{path}.{i + 1}"
            if os.path.exists(src):
                os.replace(src, dst)
        os.replace(path, path + ".1")
    except OSError as e:
        log.warning("[logger] rotate %s: %s", path, e)


def append(dev_id: str, field: str, value) -> None:
    """Пишет одну строку в CSV-журнал устройства."""
    if not dev_id or not field:
        return
    path = _device_file(dev_id)
    with _lock:
        _rotate_if_needed(path)
        new_file = not os.path.exists(path)
        try:
            with open(path, "a", encoding="utf-8", newline="") as f:
                w = csv.writer(f)
                if new_file:
                    w.writerow(["ts", "field", "value"])
                w.writerow([
                    datetime.now().isoformat(timespec="seconds"),
                    field,
                    _to_jsonable(value),
                ])
        except OSError as e:
            log.warning("[logger] append %s: %s", path, e)


def _to_jsonable(v):
    if v is None or isinstance(v, (bool, int, float, str)):
        return v
    return str(v)


def read(dev_id: str, field: str | None = None,
         limit: int = 500,
         ts_from: str | None = None,
         ts_to: str | None = None) -> list[dict]:
    """
    Читает записи журнала устройства.
    - field:   фильтр по имени поля
    - ts_from: ISO-строка, включая (например '2026-10-01T00:00:00')
    - ts_to:   ISO-строка, включая
    - limit:   максимум записей (по умолчанию 500, максимум MAX_READ_ROWS)
    """
    path = _device_file(dev_id)
    if not os.path.exists(path):
        return []

    files = [path]
    for i in range(1, KEEP_FILES):
        p = f"{path}.{i}"
        if os.path.exists(p):
            files.append(p)

    rows: list[dict] = []
    for p in files:
        try:
            with open(p, "r", encoding="utf-8", newline="") as f:
                rd = csv.DictReader(f)
                for r in rd:
                    if field and r.get("field") != field:
                        continue
                    ts = r.get("ts") or ""
                    if ts_from and ts < ts_from:
                        continue
                    if ts_to and ts > ts_to:
                        continue
                    rows.append(r)
        except OSError:
            continue

    if len(rows) > MAX_READ_ROWS:
        rows = rows[-MAX_READ_ROWS:]
    if limit and len(rows) > limit:
        rows = rows[-limit:]
    return rows

def series(dev_id: str, field: str,
           ts_from: str | None = None,
           ts_to: str | None = None,
           max_points: int = 1000) -> list[dict]:
    """
    Возвращает [{"ts": ..., "v": ...}, ...] для построения графика.
    Если записей больше max_points — прореживает равномерно.
    """
    rows = read(dev_id, field=field, limit=MAX_READ_ROWS,
                ts_from=ts_from, ts_to=ts_to)

    out = []
    for r in rows:
        v = r.get("value")
        try:
            v = float(v)
        except (TypeError, ValueError):
            # нечисловые значения игнорируем для графика
            continue
        out.append({"ts": r.get("ts"), "v": v})

    if len(out) > max_points:
        step = len(out) / max_points
        thinned = []
        i = 0.0
        while int(i) < len(out):
            thinned.append(out[int(i)])
            i += step
        if thinned and thinned[-1] is not out[-1]:
            thinned.append(out[-1])
        out = thinned
    return out

def clear(dev_id: str) -> bool:
    """Удаляет все журналы устройства (включая ротации)."""
    base = _device_file(dev_id)
    removed = False
    for p in [base] + [f"{base}.{i}" for i in range(1, KEEP_FILES)]:
        if os.path.exists(p):
            try:
                os.remove(p)
                removed = True
            except OSError:
                pass
    return removed


def list_devices() -> list[dict]:
    """Список устройств, у которых есть журналы."""
    out = []
    try:
        for name in os.listdir(LOG_DIR):
            if not name.endswith(".csv"):
                continue
            dev_id = name[:-4]
            path = os.path.join(LOG_DIR, name)
            try:
                size = os.path.getsize(path)
                mtime = datetime.fromtimestamp(os.path.getmtime(path)).isoformat(timespec="seconds")
            except OSError:
                size = 0
                mtime = None
            out.append({"device_id": dev_id, "size": size, "updated": mtime})
    except OSError:
        pass
    out.sort(key=lambda x: x.get("updated") or "", reverse=True)
    return out