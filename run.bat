@echo off
chcp 65001 >nul
rem Double-click this file to start the dashboard.
cd /d "%~dp0"

where py >nul 2>&1
if not errorlevel 1 goto run_py

where python >nul 2>&1
if not errorlevel 1 goto run_python

echo.
echo پایتون پیدا نشد.
echo از python.org نصبش کنید و موقع نصب، گزینه‌ی "Add Python to PATH" را تیک بزنید.
goto end

:run_py
py run.py
goto end

:run_python
python run.py

:end
echo.
pause
