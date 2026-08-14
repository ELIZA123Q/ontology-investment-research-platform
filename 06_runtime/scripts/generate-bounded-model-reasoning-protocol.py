#!/usr/bin/env python3
"""Generate the read-only Runtime projection of the bounded-model reasoning protocol."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import yaml


RUNTIME = Path(__file__).resolve().parents[1]
ROOT = RUNTIME.parent
SOURCE = ROOT / "03_agent_capability/02_skills/judgment_reasoning/references/bounded-model-reasoning-protocol.yaml"
TARGET = RUNTIME / "src/research/generated/bounded-model-reasoning-protocol.ts"


def validate(protocol: object) -> dict[str, object]:
    if not isinstance(protocol, dict):
        raise ValueError("protocol root must be a mapping")
    required = {"schema_name", "schema_version", "status", "authority", "protocol_id", "protocol_version", "allowed_targets", "input_contract", "output_contract", "hard_rules", "deterministic_output_screen", "target_instructions", "runtime_projection", "governance"}
    missing = sorted(required - set(protocol))
    if missing:
        raise ValueError(f"protocol missing fields: {missing}")
    if protocol.get("schema_name") != "bounded_model_reasoning_protocol" or protocol.get("schema_version") != "1.0.0":
        raise ValueError("unexpected bounded-model reasoning protocol schema")
    if protocol.get("status") != "active" or protocol.get("authority") != "reusable_research_method":
        raise ValueError("bounded-model reasoning protocol must be active reusable_research_method")
    if protocol.get("allowed_targets") != ["hypothesis", "judgment", "independent_review"]:
        raise ValueError("bounded-model reasoning targets drift")
    hard_rules = protocol.get("hard_rules")
    if not isinstance(hard_rules, list) or len(hard_rules) < 6 or not all(isinstance(item, str) and item.strip() for item in hard_rules):
        raise ValueError("bounded-model reasoning hard rules are incomplete")
    screen = protocol.get("deterministic_output_screen")
    if not isinstance(screen, dict) or not isinstance(screen.get("prohibited_investment_terms"), list) or not screen["prohibited_investment_terms"]:
        raise ValueError("bounded-model reasoning output screen is incomplete")
    projection = protocol.get("runtime_projection")
    if not isinstance(projection, dict) or not str(projection.get("system_instruction", "")).strip() or int(projection.get("max_output_tokens", 0)) < 1:
        raise ValueError("bounded-model reasoning runtime projection is incomplete")
    return protocol


def render(protocol: dict[str, object]) -> str:
    payload = json.dumps(protocol, ensure_ascii=False, indent=2, sort_keys=True)
    return "\n".join([
        "// GENERATED FILE. DO NOT EDIT.",
        "// Source: 03_agent_capability/02_skills/judgment_reasoning/references/bounded-model-reasoning-protocol.yaml",
        "// Regenerate: python3 scripts/generate-bounded-model-reasoning-protocol.py",
        "",
        f"export const BOUNDED_MODEL_REASONING_PROTOCOL = {payload} as const;",
        "",
    ])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    expected = render(validate(yaml.safe_load(SOURCE.read_text(encoding="utf-8"))))
    if args.check:
        if not TARGET.exists() or TARGET.read_text(encoding="utf-8") != expected:
            print(f"bounded-model reasoning protocol projection drift: regenerate {TARGET.relative_to(ROOT)}")
            return 1
        print(f"checked {TARGET.relative_to(ROOT)}")
        return 0
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(expected, encoding="utf-8")
    print(f"generated {TARGET.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
