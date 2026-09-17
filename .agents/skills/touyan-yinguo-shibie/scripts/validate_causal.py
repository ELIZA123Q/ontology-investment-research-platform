#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

import yaml

from ir_platform.causal import validate_causal_assessment, validate_causal_design


def main() -> int:
    parser = argparse.ArgumentParser(description="校验 CausalDesign 或 CausalAssessment YAML")
    parser.add_argument("path", type=Path)
    parser.add_argument("--design", type=Path, help="校验 CausalAssessment 时所用的 CausalDesign YAML")
    args = parser.parse_args()
    payload = yaml.safe_load(args.path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("输入必须是 YAML 对象")
    payload = payload.get("causal_design", payload.get("causal_assessment", payload))
    if args.design is None:
        validate_causal_design(payload)
    else:
        design_payload = yaml.safe_load(args.design.read_text(encoding="utf-8"))
        if not isinstance(design_payload, dict):
            raise ValueError("设计输入必须是 YAML 对象")
        design_payload = design_payload.get("causal_design", design_payload)
        validate_causal_assessment(payload, design=validate_causal_design(design_payload))
    print("causal contract valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
