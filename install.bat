@echo off
chcp 65001 >nul
REM HudIRON 三鐵車 Fitting 分析 — Windows 一鍵安裝 / One-click installer for Windows
REM 用法:雙擊這個檔案(若出現 SmartScreen,選「其他資訊 → 仍要執行」)
setlocal
cd /d "%~dp0"
echo.
echo === HudIRON 三鐵車 Fitting 分析 · 安裝 / Install ===
echo 安裝位置 / folder: %CD%
echo.

set "PATH=%USERPROFILE%\.local\bin;%PATH%"
where uv >nul 2>nul
if errorlevel 1 (
  echo [1/4] 安裝 uv - Python 管理工具 / Installing uv ...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex"
  if errorlevel 1 goto :fail
  set "PATH=%USERPROFILE%\.local\bin;%PATH%"
) else (
  echo [1/4] 已有 uv / uv found
)

echo [2/4] 建立執行環境(第一次會下載 Python,約 1-2 分鐘)/ Creating environment ...
uv venv .venv --python 3.12 --seed -q
if errorlevel 1 goto :fail

echo [3/4] 安裝套件(約 300 MB,請稍候)/ Installing packages ...
uv pip install --python .venv\Scripts\python.exe -r requirements.txt -q
if errorlevel 1 goto :fail

echo [4/4] 下載姿態偵測模型(約 30 MB,來自 Google MediaPipe)/ Downloading pose model ...
.venv\Scripts\python.exe -c "from fitting.config import MODEL; from fitting.model_fetch import ensure_model; ensure_model(MODEL)"
if errorlevel 1 goto :fail

if not "%NO_SHORTCUT%"=="1" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\HudIRON.lnk'); $s.TargetPath='%CD%\start.bat'; $s.WorkingDirectory='%CD%'; $s.IconLocation='%CD%\static\app.ico'; $s.Save()"
  echo 已在桌面建立 HudIRON 捷徑 / Desktop shortcut created.
)

echo.
echo 安裝完成! / Done!  之後雙擊桌面的 HudIRON 或資料夾裡的 start.bat 即可開啟。
if not "%NO_LAUNCH%"=="1" (
  echo 現在先幫你開啟 ... / Launching now ...
  call start.bat
)
exit /b 0

:fail
echo.
echo *** 安裝失敗,請檢查網路後重試,或把上面的訊息貼到 GitHub Issues。 / Install failed. Check your network and retry. ***
pause
exit /b 1
