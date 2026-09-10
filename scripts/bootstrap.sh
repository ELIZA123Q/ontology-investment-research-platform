#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
SKILL_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"

if ! command -v uv >/dev/null 2>&1; then
  echo "缺少 uv。请先按 https://docs.astral.sh/uv/getting-started/installation/ 安装 uv。" >&2
  exit 2
fi

cd "$SKILL_ROOT"
uv sync --frozen
"$SKILL_ROOT/.venv/bin/python" "$SKILL_ROOT/scripts/doctor.py"
