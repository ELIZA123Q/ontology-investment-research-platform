#!/usr/bin/env python3
"""Validate that signal payloads cannot bypass governed source capture."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


ROOT = Path(__file__).resolve().parents[2]
POLICY = ROOT / "05_control_evaluation/01_rules/policies/signal_evidence_admission_policy.yaml"
AUTHORITY = ROOT / "05_control_evaluation/01_rules/policies/rule_authority_registry.yaml"
PARAMETERS = ROOT / "05_control_evaluation/01_rules/policies/parameter_authority_matrix.yaml"
GENERATOR = ROOT / "06_runtime/scripts/generate-signal-evidence-admission-rules.py"
PROJECTION = ROOT / "06_runtime/src/tools/generated/signal-evidence-admission-rules.ts"
CONSUMER = ROOT / "06_runtime/src/tools/signal-evidence-admission.ts"


def load(path: Path) -> dict[str, Any]:
    value = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise AssertionError(f"{path.relative_to(ROOT)} must have a mapping root")
    return value


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def validate(policy: dict[str, Any], registry: dict[str, Any], parameters: dict[str, Any], generated: str, consumer: str) -> list[str]:
    errors: list[str] = []
    def check(condition: bool, message: str) -> None:
        if not condition:
            errors.append(message)
    check(policy.get("schema_name") == "signal_evidence_admission_policy" and policy.get("schema_version") == "1.0.0", "signal policy schema mismatch")
    check(policy.get("status") == "active" and policy.get("authority") == "control_policy", "signal policy must be active control_policy")
    check(policy.get("rule_ids") == ["GOV-SIGNAL-EVIDENCE-ADMISSION-001"], "signal policy rule ID drift")
    payload = policy.get("signal_payload") or {}
    check(payload.get("usable_as_evidence") is False, "signal payload must not be usable as evidence")
    check(set(payload.get("allowed_uses") or []) == {"discovery", "ranking", "researcher_notification", "capture_request"}, "signal allowed uses drift")
    check(set(payload.get("prohibited_promotions") or []) == {"source_snapshot", "evidence_fact", "judgment", "financial_observation"}, "signal prohibited promotions drift")
    capture = policy.get("capture_requirement") or {}
    expected_fields = {"source_uri", "title", "publisher_id", "published_at", "locator", "quote", "body", "permission_scope", "content_hash"}
    check(capture.get("required_before_evidence_evaluation") is True and set(capture.get("required_fields") or []) == expected_fields, "capture requirement drift")
    check(capture.get("quote_must_be_locatable_in_body") is True and capture.get("primary_link_behavior") == "primary_link_is_a_lead_not_a_captured_source", "signal capture boundary drift")
    workflow = policy.get("research_workflow") or {}
    check(workflow.get("use_in_research_action") == "create_or_reuse_evidence_only_task" and workflow.get("required_task_state") == "capture_required", "signal workflow drift")
    check("direct_evidence_ingestion_from_signal_payload" in (workflow.get("prohibited_next_actions") or []), "signal workflow must prohibit direct ingestion")
    governance = policy.get("governance") or {}
    expected_paths = {"source_of_truth": POLICY, "generated_projection": PROJECTION, "projection_generator": GENERATOR, "runtime_consumer": CONSUMER}
    for key, path in expected_paths.items():
        check(governance.get(key) == str(path.relative_to(ROOT)) and path.is_file(), f"governance.{key} path mismatch or missing")
    entry = (registry.get("governance_rules") or {}).get("GOV-SIGNAL-EVIDENCE-ADMISSION-001") or {}
    check(entry.get("source_ref") == str(POLICY.relative_to(ROOT)) and entry.get("execution_mode") == "automated" and entry.get("business_support_allowed") is False, "signal policy authority registration drift")
    check("GOV-SIGNAL-EVIDENCE-ADMISSION-001" in (registry.get("execution_coverage_required") or []), "signal policy must be in required coverage")
    parameter = next((row for row in (parameters.get("parameters") or []) if row.get("id") == "signal_evidence_admission_rules"), None)
    check(isinstance(parameter, dict) and parameter.get("authority_ref") == str(POLICY.relative_to(ROOT)), "signal policy parameter authority drift")
    check("GENERATED FILE. DO NOT EDIT." in generated and "SIGNAL_EVIDENCE_ADMISSION_RULES" in generated, "signal policy projection is not generated")
    check('from "@/src/tools/generated/signal-evidence-admission-rules"' in consumer and "createSignalCaptureRequest" in consumer, "runtime must consume signal policy projection")
    return errors


def main() -> int:
    errors = validate(
        load(POLICY), load(AUTHORITY), load(PARAMETERS),
        PROJECTION.read_text(encoding="utf-8"), CONSUMER.read_text(encoding="utf-8"),
    )
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        print(f"SIGNAL_EVIDENCE_ADMISSION_POLICY_RETURN_REQUIRED: {len(errors)} error(s)")
        return 1
    print("SIGNAL_EVIDENCE_ADMISSION_POLICY_PASS: signal=lead-only, capture=required, direct_ingestion=blocked, projection=checked.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AssertionError, yaml.YAMLError) as error:
        print(f"SIGNAL_EVIDENCE_ADMISSION_POLICY_RETURN_REQUIRED: {error}")
        raise SystemExit(1)
