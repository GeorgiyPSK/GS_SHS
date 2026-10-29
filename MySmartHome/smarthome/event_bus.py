# event_bus.py
"""
Единая шина событий.

Типы событий:
  knx, mqtt, device_changed, timer, scenario, manual, script_log
"""

import logging
import threading
from datetime import datetime
from typing import Callable

log = logging.getLogger("smarthome.event_bus")

_lock = threading.RLock()
_subscribers = []          # [(callback, filter_type|None)]
_last_events = []
_MAX_HISTORY = 200


def subscribe(callback: Callable[[dict], None], event_type: str | None = None):
    with _lock:
        _subscribers.append((callback, event_type))
    log.debug("[bus] subscribe %s -> %s", callback, event_type or "*")


def unsubscribe(callback: Callable, event_type: str | None = None):
    with _lock:
        _subscribers[:] = [
            (cb, t) for (cb, t) in _subscribers
            if not (cb == callback and t == event_type)
        ]


def publish(event_type: str, **payload):
    ev = {
        "type": event_type,
        "ts": datetime.now().isoformat(timespec="seconds"),
        **payload,
    }

    with _lock:
        _last_events.append(ev)
        if len(_last_events) > _MAX_HISTORY:
            del _last_events[:-_MAX_HISTORY]
        subs = list(_subscribers)

    for cb, filt in subs:
        if filt is not None and filt != event_type:
            continue
        try:
            cb(ev)
        except Exception as e:
            log.warning("[bus] subscriber %s error on %s: %s", cb, event_type, e)

    try:
        from api import notify_clients
        notify_clients("bus_event", ev)
    except Exception:
        pass


def recent_events(limit: int = 50):
    with _lock:
        return list(_last_events[-limit:])