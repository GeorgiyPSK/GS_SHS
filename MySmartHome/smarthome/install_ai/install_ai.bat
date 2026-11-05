@echo off
chcp 1251 >nul
setlocal enabledelayedexpansion
title Установка AI и TTS для GS Smart

echo ========================================================
echo   Установка компонентов для Ассистента (Ollama + TTS)
echo ========================================================
echo.

:: Проверка прав администратора
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [ОШИБКА] Запустите скрипт от имени Администратора!
    pause >nul
    exit /b
)

:: 1. Python
echo [1/6] Проверка Python...
python --version >nul 2>&1
if %errorLevel% neq 0 (
    echo [ОШИБКА] Python не найден. Установите с https://www.python.org/downloads/
    pause
    exit /b
)
python -m pip install --upgrade pip >nul 2>&1
echo OK.
echo.

:: 2. Ollama
echo [2/6] Установка Ollama...
where ollama >nul 2>&1
if %errorLevel% neq 0 (
    echo Скачиваем Ollama...
    powershell -Command "irm https://ollama.com/install.ps1 | iex"
    where ollama >nul 2>&1
    if !errorLevel! neq 0 (
        echo [ОШИБКА] Не удалось установить. Скачайте вручную: https://ollama.com/download
        pause
        exit /b
    )
) else (
    echo Ollama уже установлена.
)
tasklist /FI "IMAGENAME eq ollama.exe" 2>NUL | find /I "ollama.exe" >NUL
if %errorLevel% neq 0 (
    echo Запуск Ollama...
    start /B "" ollama serve
    timeout /t 3 >nul
)
echo.

:: 3. Модель
echo [3/6] Загрузка модели qwen2.5...
ollama pull qwen2.5
if !errorLevel! neq 0 (
    echo [ОШИБКА] Не удалось скачать модель.
    pause
    exit /b
)
echo Проверка API...
powershell -Command "(Invoke-WebRequest -method POST -Body '{\"model\":\"qwen2.5\", \"prompt\":\"Hi\", \"stream\": false}' -uri http://localhost:11434/api/generate).Content"
echo.

:: 4. Build Tools
echo [4/6] Проверка Visual C++ Build Tools...
where cl >nul 2>&1
if !errorLevel! neq 0 (
    echo [ПРЕДУПРЕЖДЕНИЕ] Компилятор C++ не найден.
    echo Если TTS не установится, поставьте: https://visualstudio.microsoft.com/visual-cpp-build-tools/
)
echo.

:: 5. TTS
echo [5/6] Установка xVibePocketTTS...
pip install git+https://github.com/GenVoice/xVibePocketTTS.git
if !errorLevel! neq 0 (
    echo [ОШИБКА] Не удалось установить xVibePocketTTS.
    pause
    exit /b
)
pip install hf_xet
echo.

:: 6. Тест
echo [6/6] Тест TTS...
xvibe-tts generate --text "Privet! Eto proverka." --voice male_deep --output test.wav
if !errorLevel! neq 0 (
    echo [ОШИБКА] TTS завершился с ошибкой.
    pause
    exit /b
)
if exist test.wav (
    echo [УСПЕХ] Файл test.wav создан.
) else (
    echo [ОШИБКА] Файл не создан.
)

echo.
echo Версии:
ollama --version
xvibe-tts --version
python --version

echo.
echo ========================================================
echo   Установка завершена!
echo ========================================================
pause