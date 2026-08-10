#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNTIME_DIR="$PROJECT_DIR/06_runtime"
VNEXT_PORT="${VNEXT_PORT:-3000}"
export VNEXT_PORT

unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy 2>/dev/null || true
unset SOCKS_PROXY SOCKS5_PROXY socks_proxy socks5_proxy 2>/dev/null || true

cd "$RUNTIME_DIR"

if [ ! -d node_modules ]; then
  echo "==> 安装 Runtime 依赖"
  npm install
fi

if [ ! -f .next/package.json ]; then
  echo "==> 构建投研判断工作台"
  npm run build
fi

echo "==> 启动 Research Lead Runtime 与工作台"
echo "    http://127.0.0.1:$VNEXT_PORT"
exec npm run start:all
