#!/usr/bin/env bash
# 固定入口：只打开 http://127.0.0.1:3000 （不用 localhost，避免代理劫持）
set -euo pipefail
URL="http://127.0.0.1:3000"
echo "Workbench: $URL"
if command -v open >/dev/null 2>&1; then
  open "$URL"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL"
else
  echo "请在浏览器打开 $URL"
fi
