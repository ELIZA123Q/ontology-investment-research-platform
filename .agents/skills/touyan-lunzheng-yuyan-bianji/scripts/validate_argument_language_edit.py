#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import yaml


VALID_STATUSES = {"clean", "edited", "needs_producer_revision", "block"}
VALID_VIOLATIONS = {
    "causal_overclaim",
    "expectation_without_baseline",
    "unsupported_certainty",
    "trading_advice",
    "target_price",
    "return_promise",
    "evidence_gap",
    "mixed_fact_judgment",
    "other",
}
VALID_SEVERITIES = {"high", "medium", "low"}
VALID_ACTIONS = {"remove", "downgrade", "producer_revision", "validation_block"}
HARD_VIOLATIONS = {"trading_advice", "target_price", "return_promise"}
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
    raise SystemExit(f"argument_language_edit invalid: {message}")


def _text(value: Any, field: str, *, allow_not_applicable: bool = False) -> str:
    if not isinstance(value, str) or not value.strip():
        _fail(f"{field} must be a non-empty string")
    if not allow_not_applicable and value.strip() == "not_applicable":
        _fail(f"{field} cannot be not_applicable")
    return value


def _optional_list(value: Any, field: str) -> list[Any]:
    if value is None:
        return []
    if not isinstance(value, list):
        _fail(f"{field} must be a list")
    return value


def _nonempty_list(value: Any, field: str) -> list[Any]:
    items = _optional_list(value, field)
    if not items:
        _fail(f"{field} must be a non-empty list")
    return items


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


def _has_replacement_or_edits(edit: dict[str, Any]) -> bool:
    replacement = edit.get("replacement_text")
    if isinstance(replacement, str) and replacement.strip() and replacement.strip() != "not_applicable":
        return True
    return bool(_optional_list(edit.get("paragraph_edits"), "paragraph_edits"))


def validate(payload: dict[str, Any]) -> None:
    if set(payload) != {"argument_language_edit"}:
        _fail("top level must contain only argument_language_edit")
    edit = payload["argument_language_edit"]
    if not isinstance(edit, dict):
        _fail("argument_language_edit must be an object")
    forbidden = _scan_forbidden(edit)
    if forbidden:
        _fail(f"prohibited output fields: {forbidden}")

    status = edit.get("edit_status")
    if status not in VALID_STATUSES:
        _fail("edit_status invalid")
    if edit.get("final_validation_required") is not True:
        _fail("final_validation_required must be true")

    paragraph_edits = _optional_list(edit.get("paragraph_edits"), "paragraph_edits")
    for index, item in enumerate(paragraph_edits):
        if not isinstance(item, dict):
            _fail(f"paragraph_edits[{index}] must be an object")
        for field in ("location", "original_text", "revised_text", "edit_reason"):
            _text(item.get(field), f"paragraph_edits[{index}].{field}")

    downgraded = _optional_list(edit.get("downgraded_claims"), "downgraded_claims")
    for index, item in enumerate(downgraded):
        if not isinstance(item, dict):
            _fail(f"downgraded_claims[{index}] must be an object")
        for field in ("location", "original_text", "revised_text", "reason"):
            _text(item.get(field), f"downgraded_claims[{index}].{field}")

    violation_types: set[str] = set()
    hard_actions: set[str] = set()
    violations = _optional_list(edit.get("boundary_violations"), "boundary_violations")
    for index, item in enumerate(violations):
        if not isinstance(item, dict):
            _fail(f"boundary_violations[{index}] must be an object")
        _text(item.get("location"), f"boundary_violations[{index}].location")
        violation = item.get("violation_type")
        if violation not in VALID_VIOLATIONS:
            _fail(f"boundary_violations[{index}].violation_type invalid")
        if item.get("severity") not in VALID_SEVERITIES:
            _fail(f"boundary_violations[{index}].severity invalid")
        action = item.get("required_action")
        if action not in VALID_ACTIONS:
            _fail(f"boundary_violations[{index}].required_action invalid")
        violation_types.add(violation)
        hard_actions.add(action)

    producer_revisions = _optional_list(edit.get("needs_producer_revision"), "needs_producer_revision")
    _optional_list(edit.get("protected_judgment_thresholds"), "protected_judgment_thresholds")

    if status in {"clean", "edited"} and not _has_replacement_or_edits(edit):
        _fail("clean/edited requires replacement_text or paragraph_edits")
    if status in {"needs_producer_revision", "block"} and not producer_revisions:
        _fail("needs_producer_revision/block requires needs_producer_revision")
    if status == "clean" and (violation_types & HARD_VIOLATIONS):
        _fail("hard boundary violations cannot be clean")
    if hard_actions & {"producer_revision", "validation_block"} and status not in {"needs_producer_revision", "block"}:
        _fail("producer_revision or validation_block action requires needs_producer_revision/block status")


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: validate_argument_language_edit.py OUTPUT.yaml", file=sys.stderr)
        return 2
    payload = yaml.safe_load(Path(sys.argv[1]).read_text(encoding="utf-8")) or {}
    if not isinstance(payload, dict):
        _fail("YAML root must be an object")
    validate(payload)
    print("argument_language_edit valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
