#!/usr/bin/env python3
"""Validate the governed model-data egress policy and its Runtime enforcement chain."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


ROOT = Path(__file__).resolve().parents[2]
POLICY = ROOT / "05_control_evaluation/01_rules/policies/model_data_egress_policy.yaml"
AUTHORITY = ROOT / "05_control_evaluation/01_rules/policies/rule_authority_registry.yaml"
PARAMETERS = ROOT / "05_control_evaluation/01_rules/policies/parameter_authority_matrix.yaml"
GENERATOR = ROOT / "06_runtime/scripts/generate-model-data-egress-rules.py"
PROJECTION = ROOT / "06_runtime/src/providers/generated/model-data-egress-rules.ts"
RESOLVER = ROOT / "06_runtime/src/providers/model-data-policy.ts"
ENFORCER = ROOT / "06_runtime/src/providers/model-gateway.ts"
PLANNER = ROOT / "06_runtime/src/runtime/model-planner.ts"


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
    require(policy.get("schema_name") == "model_data_egress_policy" and policy.get("schema_version") == "1.0.0", "model data egress policy schema mismatch")
    require(policy.get("status") == "active" and policy.get("authority") == "control_policy", "model data egress policy must be active control_policy")
    rule_ids = policy.get("rule_ids")
    require(rule_ids == ["GOV-MODEL-DATA-EGRESS-001"], "model data egress rule ID drift")

    mappings = policy.get("source_permission_mapping")
    expected_mappings = {
        "public_research_use": "public",
        "authorized_research_use": "private_authorized",
        "user_supplied": "private_authorized",
        "restricted": "restricted_no_egress",
        "missing_permission_scope": "restricted_no_egress",
    }
    require(isinstance(mappings, dict) and {key: mappings.get(key) for key in expected_mappings} == expected_mappings, "source permission mapping drift")

    aggregation = policy.get("aggregation")
    require(isinstance(aggregation, dict), "aggregation is missing")
    require(aggregation.get("input_scope") == "all_supplied_source_references", "all supplied source references must aggregate")
    require(aggregation.get("precedence") == ["restricted_no_egress", "private_authorized", "public"], "egress precedence drift")
    require(aggregation.get("required_source_missing_behavior") == "restricted_no_egress", "missing required source must be restricted")
    require(aggregation.get("no_source_behavior") == "private_authorized", "empty context must default private_authorized")

    policies = policy.get("policies")
    require(isinstance(policies, dict), "policy map missing")
    restricted = policies.get("restricted_no_egress")
    require(isinstance(restricted, dict) and restricted.get("external_provider_allowed") is False and restricted.get("allowed_provider_deployments") == ["local"], "restricted policy must be local-only")
    for policy_id in ("public", "private_authorized"):
        item = policies.get(policy_id)
        require(isinstance(item, dict) and item.get("external_provider_allowed") is True, f"{policy_id} must be explicitly configured")

    governance = policy.get("governance")
    require(isinstance(governance, dict), "governance refs missing")
    expected_paths = {"source_of_truth": POLICY, "generated_projection": PROJECTION, "projection_generator": GENERATOR, "policy_resolver": RESOLVER, "gateway_enforcer": ENFORCER}
    for key, path in expected_paths.items():
        require(governance.get(key) == str(path.relative_to(ROOT)) and path.is_file(), f"governance.{key} path mismatch or missing")
    for ref in governance.get("tests") or []:
        require((ROOT / str(ref)).is_file(), f"model data egress test ref missing: {ref}")

    registry = load(AUTHORITY)
    declared = (registry.get("governance_rules") or {}).get(rule_ids[0]) or {}
    require(declared.get("source_ref") == str(POLICY.relative_to(ROOT)), "egress rule authority must point at policy")
    require(declared.get("execution_mode") == "automated" and declared.get("business_support_allowed") is False, "egress rule must be automated governance control")
    require(rule_ids[0] in (registry.get("execution_coverage_required") or []), "egress rule must be required execution coverage")

    rows = load(PARAMETERS).get("parameters") or []
    row = next((item for item in rows if item.get("id") == "model_data_egress_rules"), None)
    require(isinstance(row, dict) and row.get("authority_kind") == "control_policy" and row.get("authority_ref") == str(POLICY.relative_to(ROOT)), "parameter authority must point to model data egress policy")

    generated = PROJECTION.read_text(encoding="utf-8")
    resolver = RESOLVER.read_text(encoding="utf-8")
    enforcer = ENFORCER.read_text(encoding="utf-8")
    planner = PLANNER.read_text(encoding="utf-8")
    require("GENERATED FILE. DO NOT EDIT." in generated and "MODEL_DATA_EGRESS_RULES" in generated, "egress projection is not generated")
    require('from "@/src/providers/generated/model-data-egress-rules"' in resolver and "source_permission_mapping" in resolver, "policy resolver must consume generated mapping")
    require('from "@/src/providers/generated/model-data-egress-rules"' in enforcer and "external_provider_allowed" in enforcer, "gateway must consume generated enforcement policy")
    require('from "@/src/providers/model-data-policy"' in planner and "deriveModelDataPolicy([])" in planner, "planner must derive no-evidence policy from governed default")
    leaked = [literal for literal in ('sourceScope === "restricted"', 'sourceScope === "authorized_research_use"', 'this.provider.id !== "local"', 'allowed_provider_ids', 'dataPolicy: "private_authorized"') if literal in resolver or literal in enforcer or literal in planner]
    require(not leaked, f"runtime retains model egress policy literals: {leaked}")

    print("MODEL_DATA_EGRESS_POLICY_PASS: mapping=5, aggregation=strictest, restricted=local-only, projection=checked.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AssertionError, yaml.YAMLError) as error:
        print(f"MODEL_DATA_EGRESS_POLICY_RETURN_REQUIRED: {error}")
        raise SystemExit(1)
