"""
Запуск GS Smart через waitress.
Использование:
    python run_waitress.py
Параметры host/port берутся из state['settings'].
"""
import logging
from waitress import serve

# Импортируем готовое Flask-приложение.
# Если в app.py есть фабрика create_app() — используем её,
# иначе — глобальный объект app.
try:
    from app import create_app
    application = create_app()
except Exception:
    from app import app as application

from state import state

log = logging.getLogger("smarthome.waitress")

host = state["settings"].get("host", "0.0.0.0")
port = int(state["settings"].get("port", 5000))
threads = int(state["settings"].get("waitress_threads", 8))

log.info("[waitress] serving on http://%s:%s (threads=%s)", host, port, threads)

if __name__ == "__main__":
    serve(application, host=host, port=port, threads=threads)