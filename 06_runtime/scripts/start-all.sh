#!/bin/bash
set -euo pipefail

RUNTIME_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_PORT="${VNEXT_PORT:-3000}"
cd "$RUNTIME_DIR"
mkdir -p .data/logs

npm run worker > .data/logs/worker.log 2>&1 &
WORKER_PID=$!
export VNEXT_WORKER_PID="$WORKER_PID"
AKSHARE_PID=""
WEB_PID=""

if [ -n "${VNEXT_AKSHARE_URL:-}" ] && command -v uv >/dev/null 2>&1; then
  uv run --project connectors/akshare python connectors/akshare/server.py > .data/logs/akshare.log 2>&1 &
  AKSHARE_PID=$!
fi

cleanup() {
  kill "$WORKER_PID" 2>/dev/null || true
  [ -z "$AKSHARE_PID" ] || kill "$AKSHARE_PID" 2>/dev/null || true
  [ -z "$WEB_PID" ] || kill "$WEB_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

./node_modules/.bin/next start -H 127.0.0.1 -p "$APP_PORT" > .data/logs/web.log 2>&1 &
WEB_PID=$!

READY="false"
FAILURE_REASON=""
for _ in $(seq 1 80); do
  if curl --noproxy '*' -fsS --max-time 1 "http://127.0.0.1:$APP_PORT/api/v2/health" >/dev/null 2>&1; then READY="true"; break; fi
  if ! kill -0 "$WEB_PID" 2>/dev/null; then FAILURE_REASON="Web 进程已退出"; break; fi
  if ! kill -0 "$WORKER_PID" 2>/dev/null; then FAILURE_REASON="worker 进程已退出"; break; fi
  sleep 0.25
done

if [ "$READY" != "true" ]; then
  echo "工作台未能就绪${FAILURE_REASON:+：$FAILURE_REASON}。最近日志："
  tail -n 30 .data/logs/web.log 2>/dev/null || true
  tail -n 30 .data/logs/worker.log 2>/dev/null || true
  exit 1
fi

echo "投研判断工作台已就绪：http://127.0.0.1:$APP_PORT"
if [ "${VNEXT_AUTO_OPEN:-true}" = "true" ] && command -v open >/dev/null 2>&1; then open "http://127.0.0.1:$APP_PORT"; fi
while kill -0 "$WEB_PID" 2>/dev/null; do
  if ! kill -0 "$WORKER_PID" 2>/dev/null; then
    echo "worker 意外退出，研究任务将无法继续。最近日志："
    tail -n 30 .data/logs/worker.log 2>/dev/null || true
    exit 1
  fi
  sleep 2
done
wait "$WEB_PID"
