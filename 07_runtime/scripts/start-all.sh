#!/bin/bash
set -euo pipefail

RUNTIME_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_PORT="${VNEXT_PORT:-3000}"
cd "$RUNTIME_DIR"

npm run worker &
WORKER_PID=$!

cleanup() {
  kill "$WORKER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

./node_modules/.bin/next start -H 127.0.0.1 -p "$APP_PORT"
