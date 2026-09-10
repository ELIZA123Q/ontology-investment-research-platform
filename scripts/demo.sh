#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
SKILL_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
PYTHON="$SKILL_ROOT/.venv/bin/python"

if [[ ! -x "$PYTHON" ]]; then
  echo "尚未安装运行环境，请先执行 $SKILL_ROOT/scripts/bootstrap.sh" >&2
  exit 2
fi

exec "$PYTHON" "$SKILL_ROOT/scripts/run_demo.py"
