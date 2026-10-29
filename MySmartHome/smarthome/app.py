import threading
from datetime import datetime
from auth import register_auth_routes, login_required
from flask import Flask, render_template, jsonify, request

from state import load_state, normalize_state, state, save_state
from devices import seed_if_empty, add_device, default_state, migrate_positions
from events import trigger_events
from scenarios import run_all_scenarios
from timers import timer_worker
from api import api
import mqtt_client



app = Flask(__name__, static_folder="static", template_folder="templates")
app.json.default = str
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024
register_auth_routes(app)
app.register_blueprint(api)
# ============================================================
# Логирование
# ============================================================
import logging
import os
from logging.handlers import RotatingFileHandler
logging.getLogger("smarthome.knx").setLevel(logging.DEBUG)
# папка log/ рядом с app.py
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_LOG_DIR  = os.path.join(_BASE_DIR, "log")
os.makedirs(_LOG_DIR, exist_ok=True)      # создаём, если нет

_LOG_FILE = os.path.join(_LOG_DIR, "server.log")

_fmt = logging.Formatter('%(asctime)s [%(levelname)s] %(name)s: %(message)s')

# файл с ротацией: 5 файлов по 5 МБ
_fh = RotatingFileHandler(
    _LOG_FILE,
    maxBytes=5 * 1024 * 1024,
    backupCount=5,
    encoding='utf-8',
)
_fh.setFormatter(_fmt)

_sh = logging.StreamHandler()
_sh.setFormatter(_fmt)

_root = logging.getLogger()
_root.setLevel(logging.INFO)
_root.addHandler(_fh)
_root.addHandler(_sh)

# ============================================================
# Кастомный обработчик логов для SSE
# ============================================================
from api import notify_clients
import json

class SSEHandler(logging.Handler):
    def emit(self, record):
        try:
            # Форматируем запись так же, как в файле
            msg = self.format(record)
            # Отправляем через SSE
            notify_clients("server_log", {
                "ts": record.created, # timestamp в секундах
                "level": record.levelname,
                "name": record.name,
                "message": record.getMessage(),
                "formatted": msg
            })
        except Exception:
            self.handleError(record)

# Подключаем к корневому логгеру
_sse_handler = SSEHandler()
_sse_handler.setFormatter(_fmt) # используем форматтер из файла
_sse_handler.setLevel(logging.INFO) # логи уровня DEBUG не шлем, чтобы не забивать эфир
_root.addHandler(_sse_handler)

# Werkzeug в файл пишет только ошибки (не логируем "GET / 200 -")
logging.getLogger('werkzeug').setLevel(logging.ERROR)

# удобный логгер для своих сообщений
log = logging.getLogger("smarthome")

@app.route("/")
@login_required
def index():
    return render_template("index.html")


@app.route("/view")
@login_required
def view_only():
    """Отдельный интерфейс только для просмотра."""
    room_id = request.args.get("room", "")
    return render_template("view.html", initial_room=room_id)


@app.route("/update")
@login_required
def legacy_update():
    climate = [d for d in state["devices"].values() if d["type"] == "climate"]
    if not climate:
        dev = add_device("climate", "Уличный датчик", "Улица")
        climate = [dev]
    t = request.args.get("airTemp") or request.args.get("waterTemp")
    h = request.args.get("humidity")
    changed_any = False
    for d in climate:
        if t is not None:
            try: d["state"]["temp"] = float(t); changed_any = True
            except ValueError: pass
        if h is not None:
            try: d["state"]["humidity"] = float(h); changed_any = True
            except ValueError: pass
        d["updated"] = datetime.now().isoformat(timespec="seconds")
    if changed_any:
        save_state()
        for d in climate:
            trigger_events(d["id"], "temp", d["state"]["temp"])
            trigger_events(d["id"], "humidity", d["state"]["humidity"])
        run_all_scenarios()
    return jsonify({"status": "ok", "updated": len(climate)})


@app.route("/app")
@login_required
def appw():
    return render_template("app.html")


@app.route("/set")
@login_required
def api_set_get():
    did = request.args.get("id") or request.args.get("device")
    field = request.args.get("field")
    value = request.args.get("value")
    if not did or not field:
        return jsonify({"error": "id and field required"}), 400
    dev = state["devices"].get(did)
    if not dev:
        return jsonify({"error": "device not found"}), 404
    if field not in dev["state"]:
        return jsonify({"error": f"unknown field '{field}'",
                        "allowed": list(dev["state"].keys())}), 400
    ref = default_state(dev["type"]).get(field, dev["state"][field])
    raw = value
    try:
        if isinstance(ref, bool):
            v = str(value).strip().lower() in ("1","true","yes","on","y","t","вкл","да","+")
            v = bool(v)
        elif isinstance(ref, int) and not isinstance(ref, bool):
            v = int(float(value))
        elif isinstance(ref, float):
            v = float(value)
        else:
            v = value
    except (TypeError, ValueError):
        return jsonify({"error": "bad value", "got": raw}), 400

    dev["state"][field] = v

    if dev["type"] == "text" and field == "text":
        try:
            w = int(dev["state"].get("width") or 0)
            if w > 0:
                dev["state"]["text"] = str(v)[:w]
        except (TypeError, ValueError):
            pass

    dev["updated"] = datetime.now().isoformat(timespec="seconds")
    save_state()

    # Публикуем новое состояние в MQTT (в state_topic или дефолтный)
    try:
        mqtt_client.publish_device_state(did)
        log.info("[set] published state for%s", did)
    except Exception as e:
        log.info("[set] mqtt publish error:%s", e)

    trigger_events(did, field, v)
    run_all_scenarios()
    return jsonify({"status": "ok", "device": dev["id"], "field": field,
                    "value": v, "raw": raw})


# ============================================================
# Загрузка состояния и запуск фоновых потоков
# ============================================================
load_state()
normalize_state()
migrate_positions()      # ← теперь импортирована из devices
seed_if_empty()

try:
    import modbus_client
    modbus_client.start_polling()
except Exception as e:
    logging.getLogger("smarthome").warning("modbus start failed: %s", e)
    
try:
    import knx_client
    knx_client.start()
except Exception as e:
    import logging
    logging.getLogger("smarthome").warning("knx start failed: %s", e)    
    
# MQTT запускается ТОЛЬКО после load_state(),
# иначе state["mqtt"] будет дефолтным (enabled: false)
mqtt_client.start()

threading.Thread(target=timer_worker, daemon=True).start()

import button as button_mod
button_mod.release_all_on_start()


if __name__ == "__main__":
    host = state["settings"].get("host", "0.0.0.0")
    port = int(state["settings"].get("port", 5000))
    log.info(f"[server] запуск на http://{host}:{port}")
    app.run(host=host, port=port, debug=False, use_reloader=False)
try:
    import modbus_client
    modbus_client.start_polling()
except Exception as e:
    import logging
    logging.getLogger("smarthome").warning("modbus start failed: %s", e)    
    
def create_app():
    """Фабрика для waitress. Ничего дополнительно не делает —
    просто возвращает уже сконфигурированный Flask-объект."""
    return app