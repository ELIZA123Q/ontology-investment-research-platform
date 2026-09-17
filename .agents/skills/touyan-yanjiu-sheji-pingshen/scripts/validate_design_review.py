#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import yaml


VALID_VERDICTS = {"pass", "needs_revision", "block"}
REQUIRED_PASS_ROLES = {"primary", "counter"}
SUPPORTING_ROLES = {"baseline", "mechanism", "cross_check"}
VALID_ROLES = REQUIRED_PASS_ROLES | SUPPORTING_ROLES
VALID_RISKS = {
    "reverse_causality",
    "common_cause",
    "definition_drift",
    "timing_mismatch",
    "sample_bias",
    "authorization",
    "other",
}
PROHIBITED_KEYS = {
    "buy",
    "sell",
    "trade_action",
    "position_size",
    "allocation",
    "target_price",
    "timing_signal",
    "return_promise",
    "order_execution",
}


def _fail(message: str) -> None:
    raise SystemExit(f"design_review invalid: {message}")


def _text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        _fail(f"{field} must be a non-empty string")
    return value


def _list(value: Any, field: str) -> list[Any]:
    if not isinstance(value, list) or not value:
        _fail(f"{field} must be a non-empty list")
    return value


def _scan_forbidden(value: Any, path: str = "") -> list[str]:
    if isinstance(value, dict):
        found: list[str] = []
        for key, nested in value.items():
            key_path = f"{path}.{key}" if path else str(key)
            if str(key) in PROHIBITED_KEYS:
                found.append(key_path)
            found.extend(_scan_forbidden(nested, key_path))
        return found
    if isinstance(value, list):
        found = []
        for index, nested in enumerate(value):
            found.extend(_scan_forbidden(nested, f"{path}[{index}]"))
        return found
    return []


def _validate_hypothesis(value: Any, field: str) -> None:
    if not isinstance(value, dict):
        _fail(f"{field} must be an object")
    _text(value.get("id"), f"{field}.id")
    _text(value.get("statement"), f"{field}.statement")
    _list(value.get("observable_predictions"), f"{field}.observable_predictions")


def _roles(evidence_plan: Any) -> set[str]:
    roles: set[str] = set()
    for index, item in enumerate(_list(evidence_plan, "evidence_plan")):
        if not isinstance(item, dict):
            _fail(f"evidence_plan[{index}] must be an object")
        role = item.get("role")
        if role not in VALID_ROLES:
            _fail(f"evidence_plan[{index}].role invalid")
        _text(item.get("evidence_question"), f"evidence_plan[{index}].evidence_question")
        _text(item.get("source_strategy"), f"evidence_plan[{index}].source_strategy")
        roles.add(role)
    return roles


def validate(payload: dict[str, Any]) -> None:
    if set(payload) != {"design_review"}:
        _fail("top level must contain only design_review")
    review = payload["design_review"]
    if not isinstance(review, dict):
        _fail("design_review must be an object")
    forbidden = _scan_forbidden(review)
    if forbidden:
        _fail(f"prohibited output fields: {forbidden}")

    verdict = review.get("verdict")
    if verdict not in VALID_VERDICTS:
        _fail("verdict invalid")
    if verdict in {"needs_revision", "block"}:
        _list(review.get("minimum_revision_items"), "minimum_revision_items")

    for field in ("research_question", "decision_use", "output_boundary", "information_cutoff"):
        _text(review.get(field), field)
    scope = review.get("object_scope")
    if not isinstance(scope, dict):
        _fail("object_scope must be an object")
    for field in ("subject", "geography", "time_window", "unit_of_analysis"):
        _text(scope.get(field), f"object_scope.{field}")

    _validate_hypothesis(review.get("main_hypothesis"), "main_hypothesis")
    competitors = _list(review.get("competing_hypotheses"), "competing_hypotheses")
    for index, competitor in enumerate(competitors):
        _validate_hypothesis(competitor, f"competing_hypotheses[{index}]")

    roles = _roles(review.get("evidence_plan"))
    _list(review.get("decisive_disconfirmers"), "decisive_disconfirmers")
    _list(review.get("stop_conditions"), "stop_conditions")

    for index, risk in enumerate(_list(review.get("key_risks"), "key_risks")):
        if not isinstance(risk, dict):
            _fail(f"key_risks[{index}] must be an object")
        if risk.get("risk_type") not in VALID_RISKS:
            _fail(f"key_risks[{index}].risk_type invalid")
        _text(risk.get("description"), f"key_risks[{index}].description")
        _text(risk.get("mitigation"), f"key_risks[{index}].mitigation")

    if verdict == "pass":
        if not REQUIRED_PASS_ROLES <= roles:
            _fail("pass requires primary and counter evidence roles")
        if not roles & SUPPORTING_ROLES:
            _fail("pass requires baseline, mechanism, or cross_check evidence")
        revisions = review.get("minimum_revision_items") or []
        if revisions:
            _fail("pass must not include minimum_revision_items")


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: validate_design_review.py OUTPUT.yaml", file=sys.stderr)
        return 2
    payload = yaml.safe_load(Path(sys.argv[1]).read_text(encoding="utf-8")) or {}
    if not isinstance(payload, dict):
        _fail("YAML root must be an object")
    validate(payload)
    print("design_review valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
