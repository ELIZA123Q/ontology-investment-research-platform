#!/bin/bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNTIME_DIR="$REPO_DIR/06_runtime"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export NO_PROXY="127.0.0.1,localhost${NO_PROXY:+,$NO_PROXY}"
export no_proxy="$NO_PROXY"

fail() {
  echo
  echo "启动失败：$1"
  echo "日志位于 $RUNTIME_DIR/.data/logs"
  read -r -p "按回车关闭窗口…" _
  exit 1
}

command -v node >/dev/null 2>&1 || fail "未找到 Node.js，需要 Node.js 24。"
command -v npm >/dev/null 2>&1 || fail "未找到 npm。"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 24 ] || fail "当前 Node.js 为 $(node -v)，需要 24 或更高版本。"

for candidate in $(seq 3000 3010); do
  if curl --noproxy '*' -fsS --max-time 1 "http://127.0.0.1:$candidate/vnext/health" 2>/dev/null | grep -q 'investment-research-copilot-vnext'; then
    echo "工作台已在 http://127.0.0.1:$candidate 运行，正在打开。"
    open "http://127.0.0.1:$candidate"
    exit 0
  fi
done

APP_PORT=""
for candidate in $(seq "${VNEXT_PORT:-3000}" 3010); do
  if ! nc -z 127.0.0.1 "$candidate" >/dev/null 2>&1; then APP_PORT="$candidate"; break; fi
done
[ -n "$APP_PORT" ] || fail "3000–3010 端口都已被占用。"
export VNEXT_PORT="$APP_PORT"

AKSHARE_PORT=""
for candidate in $(seq 3110 3120); do
  if ! nc -z 127.0.0.1 "$candidate" >/dev/null 2>&1; then AKSHARE_PORT="$candidate"; break; fi
done
if [ -n "$AKSHARE_PORT" ]; then
  export VNEXT_AKSHARE_PORT="$AKSHARE_PORT"
  export VNEXT_AKSHARE_URL="http://127.0.0.1:$AKSHARE_PORT"
fi
export VNEXT_INTERNAL_CONNECTOR_TOKEN="${VNEXT_INTERNAL_CONNECTOR_TOKEN:-$(openssl rand -hex 24)}"

cd "$RUNTIME_DIR"
mkdir -p .data/logs
if [ ! -d node_modules ]; then npm install || fail "npm 依赖安装失败。"; fi
if command -v uv >/dev/null 2>&1 && [ -n "$AKSHARE_PORT" ]; then
  uv sync --project connectors/akshare --python 3.12 --locked || echo "警告：AKShare 依赖未就绪，工作台将以数据源降级模式启动。"
else
  echo "警告：未找到 uv 或可用端口，AKShare 数据源将不可用。"
  unset VNEXT_AKSHARE_URL VNEXT_AKSHARE_PORT 2>/dev/null || true
fi
npm run build || fail "前端构建失败。"
exec npm run start:all
