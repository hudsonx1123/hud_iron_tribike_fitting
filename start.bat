@echo off
chcp 65001 >nul
REM 啟動 HudIRON(自動開啟瀏覽器;關閉這個視窗即停止)
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo 尚未安裝,請先雙擊 install.bat / Please run install.bat first.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" app.py
pause
