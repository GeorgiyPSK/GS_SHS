@echo off
setlocal

cd /d "%~dp0"

echo ============================================================
echo  GS Smart - Install
echo ============================================================

REM --- 1) Check Python ---
where python >nul 2>nul
if errorlevel 1 (
    echo Python not found in PATH.
    echo Install Python 3.11+ from https://www.python.org/downloads/
    pause
    exit /b 1
)

for /f "tokens=2" %%v in ('python --version 2^>^&1') do set PYVER=%%v
echo Python %PYVER%

REM --- 2) Virtual environment ---
if not exist ".venv" (
    echo Creating virtual environment .venv ...
    python -m venv .venv
    if errorlevel 1 (
        echo Failed to create .venv
        pause
        exit /b 1
    )
) else (
    echo .venv already exists
)

REM --- 3) Activate and install dependencies ---
call ".venv\Scripts\activate.bat"

echo Upgrading pip ...
python -m pip install --upgrade pip

echo Installing requirements from requirements.txt ...
pip install -r requirements.txt
if errorlevel 1 (
    echo Failed to install dependencies
    pause
    exit /b 1
)

REM --- 4) Folders ---
if not exist "logs"  mkdir logs
if not exist "log"   mkdir log
if not exist "state" mkdir state

echo.
echo ============================================================
echo  Install complete.
echo  Next: start.bat (Flask dev) or start_waitress.bat
echo ============================================================
pause
endlocal