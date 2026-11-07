#!/bin/bash
# 啟動 HudIRON(會自動開啟瀏覽器;關閉這個視窗或按 Ctrl+C 即停止)
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then echo "尚未安裝,請先執行 install.command / Please run install.command first."; read -r -p "Enter 離開"; exit 1; fi
exec .venv/bin/python app.py
