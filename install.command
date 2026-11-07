#!/bin/bash
# HudIRON 三鐵車 Fitting 分析 — macOS 一鍵安裝 / One-click installer for macOS
# 用法:在 Finder 對這個檔案按右鍵 → 打開;或在終端機執行  bash install.command
set -e
cd "$(dirname "$0")"
HERE="$(pwd)"
echo ""
echo "=== HudIRON 三鐵車 Fitting 分析 · 安裝 / Install ==="
echo "安裝位置 / folder: $HERE"
echo ""

# 1) uv:一個小工具,負責下載獨立的 Python 3.12 與套件,不動系統的 Python,也不需要管理員密碼
if ! command -v uv >/dev/null 2>&1; then
  export PATH="$HOME/.local/bin:$HOME/.cargo/bin:/opt/homebrew/bin:$PATH"
fi
if ! command -v uv >/dev/null 2>&1; then
  echo "[1/4] 安裝 uv(Python 管理工具) / Installing uv ..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
else
  echo "[1/4] 已有 uv / uv found"
fi

# 2) 虛擬環境(Python 3.12)
echo "[2/4] 建立執行環境(第一次會下載 Python,約 1–2 分鐘) / Creating environment ..."
uv venv .venv --python 3.12 --seed -q

# 3) 套件
echo "[3/4] 安裝套件(約 300 MB,請稍候) / Installing packages ..."
uv pip install --python .venv/bin/python -r requirements.txt -q

# 4) 姿態模型
echo "[4/4] 下載姿態偵測模型(約 30 MB,來自 Google MediaPipe) / Downloading pose model ..."
.venv/bin/python -c "from fitting.config import MODEL; from fitting.model_fetch import ensure_model; ensure_model(MODEL)"

# 桌面捷徑
if [ "$NO_SHORTCUT" != "1" ] && [ -d "$HOME/Desktop" ]; then
  printf '#!/bin/bash\ncd "%s" && exec ./start.command\n' "$HERE" > "$HOME/Desktop/HudIRON.command"
  chmod +x "$HOME/Desktop/HudIRON.command"
  echo "已在桌面建立 HudIRON.command / Desktop shortcut created."
fi
chmod +x start.command 2>/dev/null || true

echo ""
echo "安裝完成!/ Done!  之後雙擊「start.command」或桌面的「HudIRON.command」即可開啟。"
if [ "$NO_LAUNCH" != "1" ]; then
  echo "現在先幫你開啟 … / Launching now ..."
  exec ./start.command
fi
