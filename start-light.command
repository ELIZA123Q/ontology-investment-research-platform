#!/bin/bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNTIME_DIR="$REPO_DIR/06_runtime"

unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy 2>/dev/null || true
unset SOCKS_PROXY SOCKS5_PROXY socks_proxy socks5_proxy 2>/dev/null || true

cd "$RUNTIME_DIR"
if [ ! -d node_modules ]; then
  npm install
fi
npm run build
exec npm run start:all
