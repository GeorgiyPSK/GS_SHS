@echo off
setlocal

cd /d "%~dp0"

if not exist ".venv\Scripts\activate.bat" (
    echo .venv not found. Run install.bat first.
    pause
    exit /b 1
)

call ".venv\Scripts\activate.bat"

echo ============================================================
echo  GS Smart - Start (Flask dev)
echo ============================================================
python app.py
pause
endlocal