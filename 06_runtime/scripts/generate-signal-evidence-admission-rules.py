#!/usr/bin/env python3
"""Generate the read-only Runtime projection of the signal evidence-admission policy."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import yaml


RUNTIME = Path(__file__).resolve().parents[1]
ROOT = RUNTIME.parent
SOURCE = ROOT / "05_control_evaluation/01_rules/policies/signal_evidence_admission_policy.yaml"
TARGET = RUNTIME / "src/tools/generated/signal-evidence-admission-rules.ts"


def validate(policy: object) -> dict[str, object]:
    if not isinstance(policy, dict):
        raise ValueError("policy root must be a mapping")
    required = {"schema_name", "schema_version", "status", "authority", "rule_ids", "signal_payload", "capture_requirement", "research_workflow", "governance"}
    missing = sorted(required - set(policy))
    if missing:
        raise ValueError(f"policy missing fields: {missing}")
    if policy.get("schema_name") != "signal_evidence_admission_policy" or policy.get("schema_version") != "1.0.0":
        raise ValueError("unexpected signal evidence-admission policy schema")
    if policy.get("status") != "active" or policy.get("authority") != "control_policy":
        raise ValueError("signal evidence-admission policy must be active control policy")
    return policy


def render(policy: dict[str, object]) -> str:
    payload = json.dumps(policy, ensure_ascii=False, indent=2, sort_keys=True)
    return "\n".join([
        "// GENERATED FILE. DO NOT EDIT.",
        "// Source: 05_control_evaluation/01_rules/policies/signal_evidence_admission_policy.yaml",
        "// Regenerate: python3 scripts/generate-signal-evidence-admission-rules.py",
        "",
        f"export const SIGNAL_EVIDENCE_ADMISSION_RULES = {payload} as const;",
        "",
    ])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    expected = render(validate(yaml.safe_load(SOURCE.read_text(encoding="utf-8"))))
    if args.check:
        if not TARGET.exists() or TARGET.read_text(encoding="utf-8") != expected:
            print(f"signal evidence-admission projection drift: regenerate {TARGET.relative_to(ROOT)}")
            return 1
        print(f"checked {TARGET.relative_to(ROOT)}")
        return 0
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(expected, encoding="utf-8")
    print(f"generated {TARGET.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
