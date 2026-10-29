import time
from datetime import datetime
from state import state, save_state
from scenarios import run_actions_async
import logging
log = logging.getLogger("smarthome.timers")
WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _fire_timer(t):
    t["last_fired_iso"] = datetime.now().isoformat(timespec="seconds")
    run_actions_async(t.get("actions", []))
    save_state()


def _parse_hhmm(s):
    try:
        hh, mm = s.split(":")
        return int(hh), int(mm)
    except Exception:
        return None


def timer_worker():
    while True:
        try:
            now = datetime.now()
            for t in list(state["timers"].values()):
                if not t.get("enabled", True):
                    continue
                kind = t.get("kind", "interval")

                if kind == "interval":
                    sec = max(1, int(t.get("interval_sec") or 60))
                    last = t.get("last_fired_iso")
                    if not last:
                        _fire_timer(t); continue
                    try:
                        last_dt = datetime.fromisoformat(last)
                    except Exception:
                        _fire_timer(t); continue
                    if (now - last_dt).total_seconds() >= sec:
                        _fire_timer(t)

                elif kind == "daily":
                    hhmm = _parse_hhmm(t.get("time") or "")
                    if not hhmm: continue
                    hh, mm = hhmm
                    last = t.get("last_fired_iso")
                    last_dt = None
                    if last:
                        try: last_dt = datetime.fromisoformat(last)
                        except Exception: last_dt = None
                    should = (now.hour == hh and now.minute == mm)
                    already = last_dt and last_dt.date() == now.date() and last_dt.hour == hh and last_dt.minute == mm
                    if should and not already:
                        _fire_timer(t)

                elif kind == "weekly":
                    hhmm = _parse_hhmm(t.get("time") or "")
                    if not hhmm: continue
                    hh, mm = hhmm
                    wd = now.weekday()
                    if wd not in (t.get("weekdays") or []):
                        continue
                    last = t.get("last_fired_iso")
                    last_dt = None
                    if last:
                        try: last_dt = datetime.fromisoformat(last)
                        except Exception: last_dt = None
                    should = (now.hour == hh and now.minute == mm)
                    already = last_dt and last_dt.date() == now.date() and last_dt.hour == hh and last_dt.minute == mm
                    if should and not already:
                        _fire_timer(t)

                elif kind == "once":
                    at = t.get("at_iso")
                    if not at: continue
                    try: at_dt = datetime.fromisoformat(at)
                    except Exception: continue
                    if t.get("last_fired_iso"): continue
                    if now >= at_dt:
                        _fire_timer(t)
                        t["enabled"] = False
                        save_state()

            time.sleep(1)
        except Exception as e:
            log.info("[timer_worker]%s", e)
            time.sleep(1)