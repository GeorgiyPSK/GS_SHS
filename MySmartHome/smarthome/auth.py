# auth.py
import os
import secrets
from functools import wraps
from datetime import datetime

from flask import session, redirect, url_for, request, jsonify, render_template_string
from werkzeug.security import generate_password_hash, check_password_hash

from state import state, save_state
import logging
log = logging.getLogger("smarthome.auth")
# Секретный ключ для подписи сессий.
# Храним в отдельном файле, чтобы сессии не сбрасывались при рестарте.
SECRET_FILE = os.path.join(os.path.dirname(__file__), "secret.key")


def _load_secret():
    if os.path.exists(SECRET_FILE):
        with open(SECRET_FILE, "rb") as f:
            return f.read()
    key = secrets.token_bytes(32)
    with open(SECRET_FILE, "wb") as f:
        f.write(key)
    return key


def get_secret_key():
    return _load_secret()


# ---------- Пользователи ----------

def users():
    return state.setdefault("users", {})


def has_any_user():
    return bool(users())


def create_user(username: str, password: str, is_admin: bool = True):
    username = (username or "").strip()
    if not username or not password:
        return None, "Пустой логин или пароль"
    if username in users():
        return None, "Пользователь уже существует"
    users()[username] = {
        "username": username,
        "password_hash": generate_password_hash(password),
        "is_admin": bool(is_admin),
        "created": datetime.now().isoformat(timespec="seconds"),
    }
    save_state()
    return users()[username], None


def verify_user(username: str, password: str):
    u = users().get((username or "").strip())
    if not u:
        return None
    if not check_password_hash(u["password_hash"], password or ""):
        return None
    return u


def change_password(username: str, old_password: str, new_password: str):
    u = verify_user(username, old_password)
    if not u:
        return False, "Неверный текущий пароль"
    u["password_hash"] = generate_password_hash(new_password)
    save_state()
    return True, None


# ---------- Сессии ----------

def current_user():
    username = session.get("user")
    if not username:
        return None
    return users().get(username)


def login_session(user: dict):
    session.permanent = True
    session["user"] = user["username"]


def logout_session():
    session.pop("user", None)


# ---------- Декораторы ----------

def login_required(view):
    """Для HTML-страниц: редирект на /login."""
    @wraps(view)
    def wrapper(*args, **kwargs):
        if not has_any_user():
            return redirect(url_for("auth_setup"))
        if not current_user():
            return redirect(url_for("auth_login", next=request.path))
        return view(*args, **kwargs)
    return wrapper


def api_login_required(view):
    """Для API: 401 JSON. Понимает и сессию, и Authorization: Bearer <token>."""
    @wraps(view)
    def wrapper(*args, **kwargs):
        # 1) Bearer-токен
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            raw = auth[7:].strip()
            u = verify_token(raw)
            if u:
                return view(*args, **kwargs)
            return jsonify({"error": "invalid token"}), 401

        # 2) Обычная сессия
        if not has_any_user():
            return jsonify({"error": "setup_required"}), 401
        if not current_user():
            return jsonify({"error": "unauthorized"}), 401
        return view(*args, **kwargs)
    return wrapper


# ---------- HTML ----------

LOGIN_HTML = """
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Вход — GS Smart</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="{{ url_for('static', filename='style.css') }}">
</head>
<body>
  <div class="header">
    <div id="date"></div>
    <div id="time"></div>
  </div>
  <div class="toolbar" style="max-width:400px;margin:4rem auto;flex-direction:column;gap:1rem;">
    <h2 style="margin:0;text-align:center;">🔐 Вход в GS Smart</h2>
    {% if error %}<div class="hint" style="background:rgba(229,57,53,.25);border-color:#e53935;">{{ error }}</div>{% endif %}
    <form method="post" style="display:flex;flex-direction:column;gap:.8rem;width:100%;">
      <input type="text" name="username" placeholder="Логин" required autofocus>
      <input type="password" name="password" placeholder="Пароль" required>
      <button type="submit">Войти</button>
    </form>
  </div>
  <script>
    function tick(){
      const n = new Date();
      document.getElementById('date').textContent =
        n.toLocaleDateString('ru-RU', {year:'numeric',month:'long',day:'numeric',weekday:'long'}).replace(' г.','');
      document.getElementById('time').textContent =
        n.toLocaleTimeString('ru-RU', {hour12:false});
    }
    tick(); setInterval(tick, 1000);
  </script>
</body>
</html>
"""

SETUP_HTML = """
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Первый запуск — GS Smart</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="{{ url_for('static', filename='style.css') }}">
</head>
<body>
  <div class="toolbar" style="max-width:460px;margin:4rem auto;flex-direction:column;gap:1rem;">
    <h2 style="margin:0;text-align:center;">🛠 Первый запуск</h2>
    <p style="text-align:center;opacity:.85;margin:0;">
      Создайте учётную запись администратора.
    </p>
    {% if error %}<div class="hint" style="background:rgba(229,57,53,.25);border-color:#e53935;">{{ error }}</div>{% endif %}
    <form method="post" style="display:flex;flex-direction:column;gap:.8rem;width:100%;">
      <input type="text" name="username" placeholder="Логин" required autofocus>
      <input type="password" name="password" placeholder="Пароль" required minlength="4">
      <input type="password" name="password2" placeholder="Повтор пароля" required minlength="4">
      <button type="submit">Создать и войти</button>
    </form>
  </div>
</body>
</html>
"""


def register_auth_routes(app):
    app.secret_key = get_secret_key()

    @app.route("/login", methods=["GET", "POST"], endpoint="auth_login")
    def auth_login():
        if not has_any_user():
            return redirect(url_for("auth_setup"))
        error = None
        if request.method == "POST":
            u = verify_user(request.form.get("username"), request.form.get("password"))
            if u:
                login_session(u)
                nxt = request.args.get("next") or "/"
                if not nxt.startswith("/"):
                    nxt = "/"
                return redirect(nxt)
            error = "Неверный логин или пароль"
        return render_template_string(LOGIN_HTML, error=error)

    @app.route("/setup", methods=["GET", "POST"], endpoint="auth_setup")
    def auth_setup():
        if has_any_user():
            return redirect(url_for("auth_login"))
        error = None
        if request.method == "POST":
            u_name = request.form.get("username", "").strip()
            p1 = request.form.get("password", "")
            p2 = request.form.get("password2", "")
            if not u_name:
                error = "Введите логин"
            elif p1 != p2:
                error = "Пароли не совпадают"
            elif len(p1) < 4:
                error = "Пароль слишком короткий"
            else:
                user, err = create_user(u_name, p1, is_admin=True)
                if err:
                    error = err
                else:
                    login_session(user)
                    return redirect("/")
        return render_template_string(SETUP_HTML, error=error)

    @app.route("/logout", endpoint="auth_logout")
    def auth_logout():
        logout_session()
        return redirect(url_for("auth_login"))

# ============================================================
# API-токены
# ============================================================
import secrets
from datetime import datetime, timedelta


def tokens():
    """Хранилище токенов: dict[token_id] -> {token_hash, name, created, last_used, user}."""
    return state.setdefault("tokens", {})


def _hash_token(token: str) -> str:
    """Хеш токена для хранения. Используем sha256 — токен длинный и случайный."""
    import hashlib
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_token(name: str, username: str) -> dict:
    """Создаёт новый токен. Возвращает {id, token, name, created}.
    Сам токен показывается только один раз — потом хранится только хеш."""
    name = (name or "").strip() or "API-токен"
    raw = secrets.token_urlsafe(32)                 # ~43 символа
    tid = secrets.token_hex(6)                       # короткий id для управления
    rec = {
        "id": tid,
        "name": name,
        "username": username,
        "token_hash": _hash_token(raw),
        "created": datetime.now().isoformat(timespec="seconds"),
        "last_used": None,
    }
    tokens()[tid] = rec
    save_state()
    return {
        "id": tid,
        "name": name,
        "username": username,
        "token": raw,                                # ← показывается один раз
        "created": rec["created"],
    }


def list_tokens(username: str = None) -> list:
    out = []
    for tid, rec in tokens().items():
        if username and rec.get("username") != username:
            continue
        out.append({
            "id": tid,
            "name": rec.get("name", ""),
            "username": rec.get("username", ""),
            "created": rec.get("created"),
            "last_used": rec.get("last_used"),
        })
    out.sort(key=lambda r: r.get("created") or "", reverse=True)
    return out


def delete_token(tid: str, username: str = None) -> bool:
    rec = tokens().get(tid)
    if not rec:
        return False
    if username and rec.get("username") != username:
        return False
    del tokens()[tid]
    save_state()
    return True


def verify_token(raw: str):
    """Проверяет токен. Возвращает dict пользователя или None."""
    if not raw:
        return None
    h = _hash_token(raw)
    for tid, rec in tokens().items():
        if rec.get("token_hash") == h:
            rec["last_used"] = datetime.now().isoformat(timespec="seconds")
            save_state()
            return users().get(rec.get("username"))
    return None