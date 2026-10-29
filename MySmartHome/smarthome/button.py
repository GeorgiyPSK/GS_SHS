# button.py
import threading
from datetime import datetime

from state import state, save_state

# id устройства -> момент нажатия (unix time). Нужно, чтобы повторное нажатие
# перезапускало таймер, а не «накладывалось» на старое.
_last_press = {}
_lock = threading.Lock()

DEFAULT_HOLD_MS = 500


def _publish(device_id):
    """Публикует состояние кнопки в MQTT (в state_topic или дефолтный).
    Импорт локальный — чтобы избежать циклического импорта."""
    try:
        import mqtt_client
        mqtt_client.publish_device_state(device_id)
    except Exception as e:
        print("[button] mqtt publish error:", e)


def press(device_id, hold_ms=None):
    """Устанавливает pressed=True, планирует автоматический возврат в False."""
    dev = state["devices"].get(device_id)
    if not dev or dev.get("type") != "button":
        return False

    hold = int(hold_ms if hold_ms is not None else (dev.get("hold_ms") or DEFAULT_HOLD_MS))
    hold = max(50, min(hold, 60000))   # 50 мс … 60 сек

    with _lock:
        _last_press[device_id] = (datetime.now().timestamp(), hold)

    # Немедленно выставляем pressed = True
    if dev["state"].get("pressed") is not True:
        dev["state"]["pressed"] = True
        dev["updated"] = datetime.now().isoformat(timespec="seconds")
        save_state()
        _publish(device_id)          # ← публикуем в MQTT
        _fire(device_id, "pressed", True)

    # Фоновый возврат в False
    t = threading.Thread(target=_release_after, args=(device_id, hold), daemon=True)
    t.start()
    return True


def _release_after(device_id, hold_ms):
    import time
    time.sleep(hold_ms / 1000.0)
    with _lock:
        entry = _last_press.get(device_id)
    # Если за время ожидания было новое нажатие — выходим, оно само отожмёт
    if entry is None:
        return
    pressed_at, pressed_hold = entry
    # Проверяем, что за это время не было новых нажатий
    now = datetime.now().timestamp()
    if (now - pressed_at) * 1000 < pressed_hold:
        return  # ещё рано, подожди следующего

    dev = state["devices"].get(device_id)
    if not dev:
        return
    if dev["state"].get("pressed") is True:
        dev["state"]["pressed"] = False
        dev["updated"] = datetime.now().isoformat(timespec="seconds")
        save_state()
        _publish(device_id)          # ← публикуем в MQTT
        _fire(device_id, "pressed", False)


def _fire(device_id, field, value):
    """Запускает события и сценарии. Импортируем локально, чтобы избежать циклов."""
    try:
        from events import trigger_events
        from scenarios import run_all_scenarios
        trigger_events(device_id, field, value)
        run_all_scenarios()
    except Exception as e:
        print("[button] fire error:", e)


def release_all_on_start():
    """При старте сервера сбрасывает все кнопки в False — на случай, если
    сервер был выключен во время нажатия."""
    changed_ids = []
    for dev_id, dev in state["devices"].items():
        if dev.get("type") == "button" and dev["state"].get("pressed"):
            dev["state"]["pressed"] = False
            dev["updated"] = datetime.now().isoformat(timespec="seconds")
            changed_ids.append(dev_id)
    if changed_ids:
        save_state()
        for did in changed_ids:
            _publish(did)