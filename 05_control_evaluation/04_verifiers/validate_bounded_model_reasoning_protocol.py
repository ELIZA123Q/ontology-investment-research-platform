#!/usr/bin/env python3
"""Validate the Skill-owned bounded-model reasoning protocol and Runtime projection."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


ROOT = Path(__file__).resolve().parents[2]
PROTOCOL = ROOT / "03_agent_capability/02_skills/judgment_reasoning/references/bounded-model-reasoning-protocol.yaml"
SKILL = ROOT / "03_agent_capability/02_skills/judgment_reasoning/SKILL.md"
GENERATOR = ROOT / "06_runtime/scripts/generate-bounded-model-reasoning-protocol.py"
PROJECTION = ROOT / "06_runtime/src/research/generated/bounded-model-reasoning-protocol.ts"
CONSUMER = ROOT / "06_runtime/src/research/model-reasoning.ts"
TEST = ROOT / "06_runtime/tests/model-reasoning.test.ts"


def load(path: Path) -> dict[str, Any]:
    value = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise AssertionError(f"{path.relative_to(ROOT)} must have a mapping root")
    return value


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    protocol = load(PROTOCOL)
    require(protocol.get("schema_name") == "bounded_model_reasoning_protocol" and protocol.get("schema_version") == "1.0.0", "bounded-model reasoning protocol schema mismatch")
    require(protocol.get("status") == "active" and protocol.get("authority") == "reusable_research_method", "protocol authority/status mismatch")
    require(protocol.get("allowed_targets") == ["hypothesis", "judgment", "independent_review"], "protocol targets drift")
    require(len(protocol.get("hard_rules") or []) >= 6, "protocol hard rules are incomplete")
    require(bool((protocol.get("deterministic_output_screen") or {}).get("prohibited_investment_terms")), "protocol output screen is incomplete")
    output = protocol.get("output_contract") or {}
    require(output.get("candidate_only") is True and output.get("judgment", {}).get("formal_commit_owner") == "Runtime_and_researcher_approval", "candidate-only boundary drift")
    projection = protocol.get("runtime_projection") or {}
    for key, path in {"generated_projection": PROJECTION, "projection_generator": GENERATOR, "consumer": CONSUMER}.items():
        require(projection.get(key) == str(path.relative_to(ROOT)) and path.is_file(), f"runtime_projection.{key} missing or mismatched")
    require(PROTOCOL.name in SKILL.read_text(encoding="utf-8"), "judgment-reasoning Skill must list bounded model protocol resource")
    generated = PROJECTION.read_text(encoding="utf-8")
    consumer = CONSUMER.read_text(encoding="utf-8")
    require("GENERATED FILE. DO NOT EDIT." in generated and "BOUNDED_MODEL_REASONING_PROTOCOL" in generated, "protocol projection is not generated")
    require('from "@/src/research/generated/bounded-model-reasoning-protocol"' in consumer, "Runtime must consume generated protocol")
    for leaked in ('"EvidenceFact verification is already decided and must not be changed."', '"Do not output ratings, target prices, trades, positions or guaranteed returns."', '"买入", "卖出", "增持", "减持", "目标价", "保证收益", "稳赚"', 'maxOutputTokens: 2400', 'promptVersion: "bounded-research-reasoning/1.0.0"'):
        require(leaked not in consumer, f"Runtime retains Skill-owned protocol literal: {leaked}")
    require(TEST.is_file(), "bounded-model reasoning replay test is missing")
    print("BOUNDED_MODEL_REASONING_PROTOCOL_PASS: Skill-owned protocol, generated Runtime projection and candidate-only replay are aligned.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AssertionError, yaml.YAMLError) as error:
        print(f"BOUNDED_MODEL_REASONING_PROTOCOL_RETURN_REQUIRED: {error}")
        raise SystemExit(1)
