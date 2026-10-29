@echo off
setlocal

cd /d "%~dp0"

if not exist ".venv\Scripts\activate.bat" (
    echo .venv not found. Run install.bat first.
    pause
    exit /b 1
)

call ".venv\Scripts\activate.bat"

python -c "import waitress" >nul 2>nul
if errorlevel 1 (
    echo waitress is not installed. Installing ...
    pip install "waitress>=3.0"
)

echo ============================================================
echo  GS Smart - Start (waitress)
echo ============================================================
python run_waitress.py
pause
endlocal