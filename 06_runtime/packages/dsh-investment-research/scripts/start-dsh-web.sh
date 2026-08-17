#!/bin/bash
set -euo pipefail

PACKAGE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME_DIR="$(cd "$PACKAGE_DIR/../.." && pwd)"

if [ -z "${VNEXT_DSH_GATEWAY_TOKEN:-}" ]; then
  echo "VNEXT_DSH_GATEWAY_TOKEN is required to start the DSH investment plugin." >&2
  exit 1
fi

export DSH_HOME="${DSH_HOME:-$RUNTIME_DIR/.data/dsh}"
mkdir -p "$DSH_HOME"
cd "$RUNTIME_DIR"
exec ./node_modules/.bin/dsh --profile web --patch "$PACKAGE_DIR/dsh/cordis.patch.yml" web --port "${VNEXT_DSH_PORT:-3080}"
