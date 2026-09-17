#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import yaml


REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from ir_platform.evidence_handoff import validate_evidence_handoff  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="校验通用投研证据交接文件")
    parser.add_argument("path", type=Path)
    args = parser.parse_args()
    payload = yaml.safe_load(args.path.read_text(encoding="utf-8"))
    validated = validate_evidence_handoff(payload)
    handoff = validated.evidence_handoff
    print(json.dumps({
        "status": "valid",
        "tasks": len(handoff.task_refs),
        "sources": len(handoff.sources),
        "claims": len(handoff.claims),
        "gaps": len(handoff.gaps),
        "completeness": handoff.completeness,
    }, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
