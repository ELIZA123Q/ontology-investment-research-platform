#!/bin/bash
set -euo pipefail

PACKAGE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME_DIR="$(cd "$PACKAGE_DIR/../.." && pwd)"
APP_PORT="${VNEXT_PORT:-3000}"

if [ -z "${VNEXT_DSH_GATEWAY_TOKEN:-}" ]; then
  echo "VNEXT_DSH_GATEWAY_TOKEN is required. Generate a random local token before startup." >&2
  exit 1
fi

cd "$RUNTIME_DIR"
bash scripts/start-all.sh &
DOMAIN_STACK_PID=$!
cleanup() { kill "$DOMAIN_STACK_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

for _ in $(seq 1 80); do
  if curl --noproxy '*' -fsS --max-time 1 "http://127.0.0.1:$APP_PORT/api/v2/health" >/dev/null 2>&1; then break; fi
  if ! kill -0 "$DOMAIN_STACK_PID" 2>/dev/null; then
    echo "The domain service failed before DSH could start." >&2
    exit 1
  fi
  sleep 0.25
done

bash "$PACKAGE_DIR/scripts/start-dsh-web.sh"
