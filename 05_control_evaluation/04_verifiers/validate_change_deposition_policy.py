#!/usr/bin/env python3
"""Validate that material changes have a governed home and traceable execution evidence."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


ROOT = Path(__file__).resolve().parents[2]
POLICY = ROOT / "05_control_evaluation/01_rules/policies/change_deposition_policy.yaml"
AUTHORITY = ROOT / "05_control_evaluation/01_rules/policies/rule_authority_registry.yaml"
RECORDS = ROOT / "05_control_evaluation/01_rules/change_records"
EXPECTED_CLASSIFICATIONS = {
    "stable_domain_semantics",
    "reusable_deterministic_constraint",
    "reusable_research_method",
    "source_or_task_specific_evidence",
    "evaluation_knowledge",
    "execution_mechanics",
}


def load(path: Path) -> dict[str, Any]:
    value = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise AssertionError(f"{path.relative_to(ROOT)} must have a mapping root")
    return value


def validate(policy: dict[str, Any], authority: dict[str, Any], records: list[tuple[Path, dict[str, Any]]]) -> list[str]:
    errors: list[str] = []
    if policy.get("schema_name") != "governed_change_deposition_policy" or policy.get("schema_version") != "1.0.0":
        errors.append("change deposition policy schema mismatch")
    if policy.get("status") != "active" or policy.get("authority") != "control_policy":
        errors.append("change deposition policy must be active control_policy")
    routes = policy.get("classification_routes")
    if not isinstance(routes, dict) or set(routes) != EXPECTED_CLASSIFICATIONS:
        errors.append("classification routes drift")
    else:
        for route, value in routes.items():
            if not isinstance(value, dict) or not str(value.get("when", "")).strip() or not str(value.get("authority", "")).strip():
                errors.append(f"classification route {route} lacks when or authority")
            required = value.get("required_artifacts") if isinstance(value, dict) else None
            if not isinstance(required, list) or not required:
                errors.append(f"classification route {route} lacks required artifacts")
    record_policy = policy.get("change_record")
    required_fields = ["id", "date", "summary", "classifications", "authority_refs", "execution_refs", "verification_refs"]
    if not isinstance(record_policy, dict) or record_policy.get("required_for") != "所有实质行为修改" or record_policy.get("immutable_history") is not True:
        errors.append("change record policy is incomplete")
    elif record_policy.get("required_fields") != required_fields or set(record_policy.get("allowed_classifications") or []) != EXPECTED_CLASSIFICATIONS:
        errors.append("change record field contract drift")
    declared = (authority.get("governance_rules") or {}).get("GOV-CHANGE-DEPOSITION-001") or {}
    if declared.get("source_ref") != str(POLICY.relative_to(ROOT)) or declared.get("execution_mode") != "automated":
        errors.append("change deposition rule authority or execution mode drift")
    if "GOV-CHANGE-DEPOSITION-001" not in (authority.get("execution_coverage_required") or []):
        errors.append("change deposition rule lacks required execution coverage")
    if not records:
        errors.append("at least one material change record is required")
    known_ids: set[str] = set()
    for path, record in records:
        prefix = path.relative_to(ROOT)
        missing = [field for field in required_fields if not record.get(field)]
        if missing:
            errors.append(f"{prefix} missing fields {missing}")
            continue
        record_id = str(record["id"])
        if record_id in known_ids:
            errors.append(f"duplicate change record id {record_id}")
        known_ids.add(record_id)
        classifications = record.get("classifications")
        if not isinstance(classifications, list) or not classifications or not set(classifications) <= EXPECTED_CLASSIFICATIONS:
            errors.append(f"{prefix} has invalid classifications")
        for field in ("authority_refs", "execution_refs", "verification_refs"):
            refs = record.get(field)
            if not isinstance(refs, list) or not refs:
                errors.append(f"{prefix} {field} must be non-empty list")
                continue
            for ref in refs:
                if not (ROOT / str(ref)).is_file():
                    errors.append(f"{prefix} unresolved {field} ref {ref}")
    return errors


def main() -> int:
    records = [(path, load(path)) for path in sorted(RECORDS.glob("*.yaml"))]
    errors = validate(load(POLICY), load(AUTHORITY), records)
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        print(f"CHANGE_DEPOSITION_POLICY_RETURN_REQUIRED: {len(errors)} error(s)")
        return 1
    print(f"CHANGE_DEPOSITION_POLICY_PASS: records={len(records)}, classifications={len(EXPECTED_CLASSIFICATIONS)}, authority/execution traceable.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AssertionError, yaml.YAMLError) as error:
        print(f"CHANGE_DEPOSITION_POLICY_RETURN_REQUIRED: {error}")
        raise SystemExit(1)
