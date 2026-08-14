#!/usr/bin/env python3
"""Create a read-only deposition plan for a material project change.

Classification is deliberately explicit: a tool can enumerate the governed
homes, but cannot reliably infer whether a change is domain semantics, a
reusable constraint, a method, or task-specific evidence.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import yaml


ROOT = Path(__file__).resolve().parents[2]
POLICY = ROOT / "05_control_evaluation/01_rules/policies/change_deposition_policy.yaml"


def load_policy(path: Path = POLICY) -> dict[str, Any]:
    value = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("change deposition policy must have a mapping root")
    return value


def plan_for(policy: dict[str, Any], classifications: list[str], summary: str = "") -> dict[str, Any]:
    routes = policy.get("classification_routes")
    if not isinstance(routes, dict):
        raise ValueError("change deposition policy lacks classification routes")
    chosen = list(dict.fromkeys(classifications))
    if not chosen:
        raise ValueError("at least one explicit classification is required")
    unknown = [item for item in chosen if item not in routes]
    if unknown:
        raise ValueError(f"unknown classification(s): {', '.join(unknown)}")
    return {
        "summary": summary.strip() or "TODO: describe the material behavior change",
        "classifications": chosen,
        "deposition_plan": [
            {
                "classification": item,
                "when": routes[item].get("when"),
                "authority": routes[item].get("authority"),
                "required_artifacts": routes[item].get("required_artifacts"),
            }
            for item in chosen
        ],
        "change_record_template": {
            "id": "CR-YYYY-MM-DD-short-description",
            "date": "YYYY-MM-DD",
            "summary": summary.strip() or "TODO: describe the material behavior change",
            "classifications": chosen,
            "authority_refs": ["TODO: source-of-truth asset(s)"],
            "execution_refs": ["TODO: generated projection or implementation"],
            "verification_refs": ["TODO: drift validator and regression test/replay"],
        },
        "boundary": "This plan does not authorize a Runtime-only implementation. Complete every selected route before activation.",
    }


def main() -> int:
    policy = load_policy()
    parser = argparse.ArgumentParser(description="Classify a material change before implementation.")
    parser.add_argument("--classification", "-c", action="append", choices=sorted((policy.get("classification_routes") or {}).keys()), help="Explicit deposition route; repeat for multi-route changes.")
    parser.add_argument("--summary", default="", help="Short statement of the behavior change.")
    parser.add_argument("--list", action="store_true", help="List governed routes and exit.")
    args = parser.parse_args()
    if args.list:
        print(json.dumps(policy.get("classification_routes"), ensure_ascii=False, indent=2))
        return 0
    try:
        print(json.dumps(plan_for(policy, args.classification or [], args.summary), ensure_ascii=False, indent=2))
    except ValueError as error:
        parser.error(str(error))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
