#!/usr/bin/env python3
"""Validate the source-document attestation authority and its Runtime chain."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


ROOT = Path(__file__).resolve().parents[2]
POLICY = ROOT / "05_control_evaluation/01_rules/policies/source_document_attestation_policy.yaml"
AUTHORITY = ROOT / "05_control_evaluation/01_rules/policies/rule_authority_registry.yaml"
PARAMETERS = ROOT / "05_control_evaluation/01_rules/policies/parameter_authority_matrix.yaml"
GENERATOR = ROOT / "06_runtime/scripts/generate-source-document-attestation-rules.py"
PROJECTION = ROOT / "06_runtime/src/tools/generated/source-document-attestation-rules.ts"
NORMALIZER = ROOT / "06_runtime/src/tools/source-document-attestation.ts"
ADAPTER = ROOT / "06_runtime/src/tools/source-result-adapter.ts"
VERIFIER = ROOT / "06_runtime/src/governance/provenance-verifier.ts"
STORE = ROOT / "06_runtime/src/semantic/provenance-store.ts"
PREPARER = ROOT / "06_runtime/scripts/prepare-public-document-material.ts"
FORMAL_ELIGIBILITY = ROOT / "06_runtime/src/evaluation/formal-case-eligibility.ts"


def load(path: Path) -> dict[str, Any]:
    value = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise AssertionError(f"{path.relative_to(ROOT)} must have a mapping root")
    return value


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    policy = load(POLICY)
    require(policy.get("schema_name") == "source_document_attestation_policy" and policy.get("schema_version") == "1.0.0", "source-document attestation policy schema mismatch")
    require(policy.get("status") == "active" and policy.get("authority") == "control_policy", "source-document attestation policy must be active control_policy")
    require(policy.get("rule_ids") == ["GOV-SOURCE-DOCUMENT-ATTESTATION-001"], "source-document attestation rule id drift")
    attestation = policy.get("attestation") or {}
    require(attestation.get("fields") == ["raw_content_hash", "byte_length", "mime_type"] and attestation.get("capture_body_relation") == "excerpt_or_normalized_metadata", "source-document attestation contract drift")
    projection = policy.get("runtime_projection") or {}
    for key, path in {"generated_projection": PROJECTION, "projection_generator": GENERATOR, "normalizer": NORMALIZER, "source_result_adapter": ADAPTER, "provenance_verifier": VERIFIER, "provenance_store": STORE, "local_preparer": PREPARER, "formal_case_eligibility": FORMAL_ELIGIBILITY}.items():
        require(projection.get(key) == str(path.relative_to(ROOT)) and path.is_file(), f"runtime_projection.{key} missing or mismatched")
    registry = load(AUTHORITY)
    rule = (registry.get("governance_rules") or {}).get("GOV-SOURCE-DOCUMENT-ATTESTATION-001") or {}
    require(rule.get("source_ref") == str(POLICY.relative_to(ROOT)) and rule.get("execution_mode") == "automated", "source-document attestation authority drift")
    require("GOV-SOURCE-DOCUMENT-ATTESTATION-001" in (registry.get("execution_coverage_required") or []), "source-document attestation lacks required execution coverage")
    row = next((item for item in load(PARAMETERS).get("parameters") or [] if item.get("id") == "source_document_attestation_rules"), None)
    require(isinstance(row, dict) and row.get("authority_kind") == "control_policy" and row.get("authority_ref") == str(POLICY.relative_to(ROOT)), "parameter authority must point to source-document attestation policy")
    generated = PROJECTION.read_text(encoding="utf-8")
    require("GENERATED FILE. DO NOT EDIT." in generated and "SOURCE_DOCUMENT_ATTESTATION_RULES" in generated, "source-document attestation projection is not generated")
    require('source-document-attestation-rules' in NORMALIZER.read_text(encoding="utf-8"), "attestation normalizer must consume generated policy")
    for consumer in (ADAPTER, VERIFIER):
        require('source-document-attestation' in consumer.read_text(encoding="utf-8"), f"{consumer.relative_to(ROOT)} must consume attestation normalizer")
    eligibility = FORMAL_ELIGIBILITY.read_text(encoding="utf-8")
    require('normalizeSourceDocumentAttestation' in eligibility and 'public_document_attestation' in eligibility, "formal-case eligibility must enforce public-document attestation")
    print("SOURCE_DOCUMENT_ATTESTATION_POLICY_PASS: public-document fingerprint, excerpt hash and Runtime provenance chain are governed separately.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AssertionError, yaml.YAMLError) as error:
        print(f"SOURCE_DOCUMENT_ATTESTATION_POLICY_RETURN_REQUIRED: {error}")
        raise SystemExit(1)
