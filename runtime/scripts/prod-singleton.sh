#!/usr/bin/env bash
# 生产模式单实例启动：彻底关闭文件监听 / HMR，内存占用显著低于 dev 模式。
# 前置：需先 build；本脚本在 .next 缺失或传入 --rebuild 时自动 build 一次。
# 唯一入口：http://127.0.0.1:3000 （禁止改用 localhost 或其他端口）
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=3000
HOST=127.0.0.1
# 清理端口占用（含正在运行的 dev 服务，先释放其内存再构建）
if command -v lsof >/dev/null 2>&1; then
  for pid in $(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true); do
    echo "stopping pid $pid on :$PORT"
    kill "$pid" 2>/dev/null || true
  done
  sleep 1
fi
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy
unset SOCKS_PROXY SOCKS5_PROXY socks_proxy socks5_proxy
export PORT
# 若未构建或要求重建，则先构建（内存高峰仅在此阶段，构建完即释放）
if [ ! -d ".next" ] || [ "${1:-}" = "--rebuild" ]; then
  echo "building for production (one-time memory peak)..."
  npm run build
fi
echo "Workbench canonical URL: http://${HOST}:${PORT}"
worker_pid=""
cleanup() {
  if [ -n "$worker_pid" ] && kill -0 "$worker_pid" 2>/dev/null; then
    kill "$worker_pid" 2>/dev/null || true
    wait "$worker_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM
NODE_OPTIONS='--conditions=react-server' ./node_modules/.bin/tsx scripts/research-worker.ts &
worker_pid=$!
npm run start
