# 🏠 GS Smart — Умный дом, который думает

[![Python](https://img.shields.io/badge/Python-3.10%2B-blue?logo=python&logoColor=white)](https://www.python.org/)
[![Flask](https://img.shields.io/badge/Flask-2.x-000000?logo=flask&logoColor=white)](https://flask.palletsprojects.com/)
[![Lua](https://img.shields.io/badge/Lua-5.4-2C2D72?logo=lua&logoColor=white)](https://www.lua.org/)
[![KNX](https://img.shields.io/badge/KNX-IP-2e7d32)](https://www.knx.org/)
[![MQTT](https://img.shields.io/badge/MQTT-3.1.1-660066?logo=mqtt&logoColor=white)](https://mqtt.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**GS Smart** — это локальная, расширяемая и гибкая платформа для автоматизации дома. Она объединяет в себе мощь промышленных протоколов (KNX, Modbus, BACnet), гибкость MQTT и Zigbee2MQTT, а также интеллект современных LLM (Ollama, DeepSeek) и синтез речи.

Это не просто «ещё один умный дом». Это ваш персональный инженер, который понимает ваши сценарии, говорит с вами голосом.

---

## ✨ Ключевые возможности

### 🔌 Промышленная интеграция
- **KNX/IP**: Прямое подключение к шлюзу, поддержка DPT, импорт из ETS (`.knxproj`), чтение/запись групповых адресов.
- **Modbus**: TCP и RTU. Чтение и запись регистров (holding, input, coil, discrete), масштабирование.
- **BACnet**: Публикация объектов AnalogValue/BinaryValue, обратная синхронизация с KNX и устройствами.
- **MQTT**: Публикация состояний, приём команд, MQTT-триггеры, интеграция с Zigbee2MQTT (автоимпорт устройств).

### 🧠 Искусственный интеллект и голос
- **Локальная LLM**: Поддержка Ollama (`qwen2.5`, `llama3.2`) и DeepSeek API.
- **Генерация сценариев по тексту**: Напишите «Если я ухожу, выключи свет», и ИИ создаст готовый JSON-сценарий.
- **Генерация Lua-скриптов**: Опишите задачу — ИИ напишет код, зная все ваши устройства.
- **TTS (Text-to-Speech)**: Озвучка событий через `xVibePocketTTS` (мужские/женские голоса).
- **Push-уведомления**: Pushover, Telegram, браузерные уведомления.

### 🎨 Визуализация и управление
- **План этажа**: Загрузка изображений, расстановка устройств, комнаты, масштабирование.
- **Дашборд**: Карточки устройств с плиткой и списком, быстрые действия, слайдеры.
- **Графики**: Построение графиков по логам, отображение на планах/вкладках.
- **Тёмная тема**: Глубокая и приятная для глаз.

### ⚙️ Гибкость и автоматизация
- **Lua-скрипты**: Полноценный редактор с подсветкой синтаксиса, справочником и выполнением.
- **Сценарии**: Условия (AND/OR/NOT), действия (set_state, notify, delay, mqtt, lua, http).
- **Таймеры**: Интервальные, ежедневные, по дням недели, разовые.
- **Виртуальные устройства**: Вычисляемые значения (средняя температура, суммарное потребление) на основе формул.
- **События**: Привязка HTTP-запросов и MQTT-сообщений к изменениям полей.
- **Zigbee2MQTT**: Автоматический импорт устройств, поля, линккачество, онлайн-статус.

### 🛡️ Безопасность и удобство
- **Пользователи и роли**: Администратор/пользователь, смена пароля.
- **API-токены**: Долгоживущие токены для интеграций (Node-RED, скрипты).
- **Резервное копирование**: Экспорт/импорт всей конфигурации в JSON.
- **SSE (Server-Sent Events)**: Мгновенное обновление интерфейса без перезагрузки.
- **Логирование**: Журналы устройств, логи сервера, отладка.

---

## 🚀 Быстрый старт

### 1. Клонирование и установка
```bash
git clone https://github.com/GeorgiyPSK/GS_SHS.git
Install. bat - установка сервера
start_waitress.bat - запуск
localhost: 5000 Admin: 165538

2. Установка ИИ и TTS (опционально)
Запустите install_ai.bat (Windows) от имени администратора. Он установит:

Ollama (локальная LLM) и модель qwen2.5.

xVibePocketTTS (синтез речи).

Или установите вручную:

bash
# Ollama
irm https://ollama.com/install.ps1 | iex
ollama pull qwen2.5

# TTS
pip install git+https://github.com/GenVoice/xVibePocketTTS.git
3. Запуск
bash
python app.py
Откройте браузер: http://localhost:5000
```
Первый вход: Логин admin, пароль admin (смените в настройках!).

🛠️ Технологии
Backend: Python 3.10+, Flask, xknx, pymodbus, BAC0, paho-mqtt, lupa (Lua).

Frontend: Vanilla JS, CSS3, Chart.js, Drawflow.

AI: Ollama, DeepSeek API, xVibePocketTTS.

Хранение: JSON-файлы (атомарная запись, миграции).

📂 Структура проекта
```bash
text
smarthome/
├── app.py                 # Точка входа
├── api.py                 # REST API (Flask Blueprint)
├── state.py               # Глобальное состояние + загрузка/сохранение
├── devices.py             # Устройства, виртуальные вычисления
├── scenarios.py           # Движок сценариев
├── events.py              # Обработка событий
├── knx_client.py          # KNX/IP
├── modbus_client.py       # Modbus TCP/RTU
├── mqtt_client.py         # MQTT
├── bacnet_server.py       # BACnet
├── lua_engine.py          # Lua + AI + TTS
├── static/
│   ├── style.css
│   ├── app.js
│   └── ui/                # JS-модули (devices, plan, knx, mqtt, lua)
├── templates/
│   └── index.html
├── state/                 # JSON-файлы конфигурации
└── lua_scripts/           # Пользовательские Lua-скрипты
```
🤝 Вклад
Мы открыты для идей и пул-реквестов! Если вы хотите добавить новый протокол, улучшить UI или предложить интеграцию — создайте issue или напишите в Telegram.

Форкните репозиторий.

Создайте ветку (git checkout -b feature/amazing).

Закоммитьте изменения (git commit -m 'Add amazing feature').

Запушьте (git push origin feature/amazing).

Откройте Pull Request.

📄 Лицензия

Этот проект распространяется под лицензией MIT. Используйте, модифицируйте и делитесь на здоровье.

💡 Идеи для будущего
```bash
□ Мобильное приложение (PWA).
□ Голосовой ввод (STT) через Vosk/Whisper.
□ Интеграция с Яндекс.Умный дом (OAuth + Adapter API).
□ 3D-план этажа (Three.js).
```
GS Smart — потому что умный дом должен быть умным не только на словах.
Сделано с ❤️ и большим количеством кофе.
