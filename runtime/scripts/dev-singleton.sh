#!/usr/bin/env bash
# 只保留一个本机工作台进程，避免多端口僵尸 next 导致 EMFILE / Load failed。
# 同时清掉 Cursor 沙箱注入的代理变量，避免 Node 走失效代理导致 Connection error。
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-3000}"
if command -v lsof >/dev/null 2>&1; then
  for pid in $(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true); do
    echo "stopping pid $pid on :$PORT"
    kill "$pid" 2>/dev/null || true
  done
  sleep 1
fi
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy
unset SOCKS_PROXY SOCKS5_PROXY socks_proxy socks5_proxy
export WATCHPACK_POLLING=true
export CHOKIDAR_USEPOLLING=true
exec npm run dev
