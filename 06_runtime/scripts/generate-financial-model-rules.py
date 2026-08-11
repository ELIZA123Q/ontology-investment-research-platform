#!/usr/bin/env python3
"""Generate the Runtime read-only projection of the governed financial model policy."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import yaml


RUNTIME = Path(__file__).resolve().parents[1]
ROOT = RUNTIME.parent
SOURCE = ROOT / "05_control_evaluation/01_rules/policies/financial_model_integrity_policy.yaml"
TARGET = RUNTIME / "src/research/generated/financial-model-rules.ts"


def render(policy: dict[str, object]) -> str:
    payload = json.dumps(policy, ensure_ascii=False, indent=2, sort_keys=True)
    return "\n".join([
        "// GENERATED FILE. DO NOT EDIT.",
        "// Source: 05_control_evaluation/01_rules/policies/financial_model_integrity_policy.yaml",
        "// Regenerate: python3 scripts/generate-financial-model-rules.py",
        "",
        f"export const FINANCIAL_MODEL_RULES = {payload} as const;",
        "",
    ])


def validate(policy: object) -> dict[str, object]:
    if not isinstance(policy, dict):
        raise ValueError("policy root must be a mapping")
    required = {"schema_name", "schema_version", "unit_normalization", "metric_aliases", "derived_outputs", "reconciliations", "valuation_gate", "governance"}
    missing = sorted(required - set(policy))
    if missing:
        raise ValueError(f"policy missing fields: {missing}")
    if policy.get("schema_name") != "financial_model_integrity_policy":
        raise ValueError("unexpected schema_name")
    if policy.get("schema_version") != "1.0.0":
        raise ValueError("unexpected schema_version")
    if not isinstance(policy.get("reconciliations"), list) or len(policy["reconciliations"]) < 2:
        raise ValueError("at least two reconciliation rules are required")
    return policy


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    policy = validate(yaml.safe_load(SOURCE.read_text(encoding="utf-8")))
    expected = render(policy)
    if args.check:
        if not TARGET.exists() or TARGET.read_text(encoding="utf-8") != expected:
            print(f"financial model rule projection drift: regenerate {TARGET.relative_to(ROOT)}")
            return 1
        print(f"checked {TARGET.relative_to(ROOT)} ({len(policy['reconciliations'])} reconciliations)")
        return 0
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(expected, encoding="utf-8")
    print(f"generated {TARGET.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
