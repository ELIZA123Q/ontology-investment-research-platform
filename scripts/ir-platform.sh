#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
SKILL_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
CLI="$SKILL_ROOT/.venv/bin/ir-platform"

if [[ ! -x "$CLI" ]]; then
  echo "尚未安装运行环境，请先执行 $SKILL_ROOT/scripts/bootstrap.sh" >&2
  exit 2
fi

# 刻意不切换当前目录：相对运行目录和输出路径应位于用户工作区。
exec "$CLI" "$@"
