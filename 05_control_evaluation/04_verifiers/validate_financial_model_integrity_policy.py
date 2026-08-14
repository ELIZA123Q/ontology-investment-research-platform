#!/usr/bin/env python3
"""Validate the governed financial-model policy and its Runtime execution chain."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


ROOT = Path(__file__).resolve().parents[2]
POLICY = ROOT / "05_control_evaluation/01_rules/policies/financial_model_integrity_policy.yaml"
AUTHORITY = ROOT / "05_control_evaluation/01_rules/policies/rule_authority_registry.yaml"
PARAMETERS = ROOT / "05_control_evaluation/01_rules/policies/parameter_authority_matrix.yaml"
GENERATOR = ROOT / "06_runtime/scripts/generate-financial-model-rules.py"
PROJECTION = ROOT / "06_runtime/src/research/generated/financial-model-rules.ts"
EXECUTOR = ROOT / "06_runtime/src/research/deterministic-financial-model.ts"
VALIDATOR = ROOT / "06_runtime/src/research/financial-model-contract.ts"


def load(path: Path) -> dict[str, Any]:
    value = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise AssertionError(f"{path.relative_to(ROOT)} must have a mapping root")
    return value


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def nonempty_strings(values: object, label: str) -> list[str]:
    require(isinstance(values, list) and values, f"{label} must be a non-empty list")
    normalized = [str(value).strip() for value in values]
    require(all(normalized), f"{label} contains an empty value")
    require(len(normalized) == len(set(normalized)), f"{label} contains duplicates")
    return normalized


def main() -> int:
    policy = load(POLICY)
    require(policy.get("schema_name") == "financial_model_integrity_policy", "financial policy schema_name mismatch")
    require(policy.get("schema_version") == "1.0.0", "financial policy schema_version mismatch")
    require(policy.get("status") == "active" and policy.get("authority") == "control_policy", "financial policy must be active control_policy")
    rule_ids = nonempty_strings(policy.get("rule_ids"), "rule_ids")
    require(set(nonempty_strings(policy.get("model_scopes"), "model_scopes")) == {"historical_earnings_update", "forecast_model"}, "financial policy model_scopes drift")

    units = policy.get("unit_normalization") or {}
    monetary = units.get("monetary") if isinstance(units, dict) else None
    require(isinstance(monetary, dict), "monetary unit policy missing")
    require(monetary.get("canonical_currency") == "CNY" and monetary.get("canonical_unit") == "元", "canonical CNY/元 policy required")
    supported = monetary.get("supported") or {}
    require(isinstance(supported, dict) and isinstance(supported.get("CNY"), dict), "CNY unit map missing")
    expected_units = {"元": 1, "千元": 1000, "万元": 10000, "百万元": 1000000, "亿元": 100000000}
    require({key: supported["CNY"].get(key) for key in expected_units} == expected_units, "CNY unit conversion map drift")
    require(units.get("mixed_currency_behavior") == "block_without_frozen_fx_rate", "mixed-currency must block without frozen FX")
    require(units.get("unsupported_unit_behavior") == "block", "unsupported unit must block")

    aliases = policy.get("metric_aliases")
    require(isinstance(aliases, dict) and aliases, "metric aliases missing")
    alias_values = [alias for values in aliases.values() if isinstance(values, list) for alias in values]
    require(len(alias_values) == len(set(alias_values)), "metric aliases must not map one raw metric to multiple canonical metrics")

    outputs = policy.get("derived_outputs") or {}
    require(isinstance(outputs, dict), "derived outputs missing")
    output_ids: list[str] = []
    for category in ("growth", "ratios", "differences"):
        definitions = outputs.get(category)
        require(isinstance(definitions, list) and definitions, f"derived_outputs.{category} missing")
        for definition in definitions:
            require(isinstance(definition, dict), f"derived_outputs.{category} definition malformed")
            output_ids.append(str(definition.get("id", "")).strip())
            require(str(definition.get("formula", "")).strip(), f"derived output {definition.get('id')} lacks formula")
            require(str(definition.get("unit", "")).strip(), f"derived output {definition.get('id')} lacks unit")
    require(all(output_ids) and len(output_ids) == len(set(output_ids)), "derived output ids must be unique and non-empty")

    reconciliations = policy.get("reconciliations")
    require(isinstance(reconciliations, list) and reconciliations, "reconciliations missing")
    reconciliation_ids: list[str] = []
    for rule in reconciliations:
        require(isinstance(rule, dict), "reconciliation definition malformed")
        reconciliation_ids.append(str(rule.get("id", "")).strip())
        inputs = rule.get("inputs")
        tolerance = rule.get("tolerance")
        require(isinstance(inputs, list) and inputs, f"reconciliation {rule.get('id')} inputs missing")
        require(isinstance(tolerance, dict) and isinstance(tolerance.get("absolute"), (int, float)) and isinstance(tolerance.get("relative"), (int, float)), f"reconciliation {rule.get('id')} tolerance malformed")
        require(rule.get("missing_behavior") == "not_testable" and rule.get("failure_behavior") == "block_model", f"reconciliation {rule.get('id')} behavior must be explicit")
    require(set(reconciliation_ids) == {"balance_sheet_equation", "cash_flow_rollforward"}, "required reconciliation set drift")

    gate = policy.get("valuation_gate") or {}
    require(gate.get("required_model_scope") == "forecast_model", "valuation must require forecast model scope")
    require(gate.get("required_output_scenario") == "base", "valuation must require base output")
    require(set(gate.get("required_fields") or []) == {"methods", "assumptions", "sensitivities"}, "valuation required fields drift")
    require(gate.get("missing_behavior") == "blocked", "valuation missing behavior must be blocked")

    governance = policy.get("governance") or {}
    expected_paths = {"source_of_truth": POLICY, "generated_projection": PROJECTION, "projection_generator": GENERATOR, "validator": VALIDATOR, "executor": EXECUTOR}
    for key, path in expected_paths.items():
        require(governance.get(key) == str(path.relative_to(ROOT)), f"governance.{key} must resolve to {path.relative_to(ROOT)}")
        require(path.is_file(), f"governance.{key} path is missing")
    for ref in governance.get("tests") or []:
        require((ROOT / str(ref)).is_file(), f"financial policy test ref is missing: {ref}")

    registry = load(AUTHORITY)
    declared = registry.get("governance_rules") or {}
    for rule_id in rule_ids:
        item = declared.get(rule_id) or {}
        require(item.get("source_ref") == str(POLICY.relative_to(ROOT)), f"{rule_id} must be registered to the financial policy")
        require(item.get("execution_mode") == "automated", f"{rule_id} must have automated execution")
        require(item.get("business_support_allowed") is False, f"{rule_id} must not directly support business conclusions")
        for ref in [*(item.get("validator_refs") or []), *(item.get("test_refs") or [])]:
            require((ROOT / str(ref)).is_file(), f"{rule_id} has unresolved execution ref {ref}")
    require(set(rule_ids) <= set(registry.get("execution_coverage_required") or []), "financial rule must be required execution coverage")

    parameter_rows = load(PARAMETERS).get("parameters") or []
    parameter = next((row for row in parameter_rows if row.get("id") == "financial_model_integrity_rules"), None)
    require(isinstance(parameter, dict) and parameter.get("authority_kind") == "control_policy" and parameter.get("authority_ref") == str(POLICY.relative_to(ROOT)), "parameter authority must point to financial policy")

    generated = PROJECTION.read_text(encoding="utf-8")
    executor = EXECUTOR.read_text(encoding="utf-8")
    validator = VALIDATOR.read_text(encoding="utf-8")
    require("GENERATED FILE. DO NOT EDIT." in generated and "FINANCIAL_MODEL_RULES" in generated, "financial rule projection is not generated")
    require('from "@/src/research/generated/financial-model-rules"' in executor and "FINANCIAL_MODEL_RULES" in executor, "financial executor must consume generated rule projection")
    require('from "@/src/research/generated/financial-model-rules"' in validator and "valuation_gate" in validator, "financial validator must consume governed valuation gate")
    leaked = [literal for literal in ("const MONEY_FACTORS", "const METRIC_ALIASES", "0.000001") if literal in executor]
    require(not leaked, f"runtime retains financial policy literals: {leaked}")

    print(f"FINANCIAL_MODEL_INTEGRITY_POLICY_PASS: rules={len(rule_ids)}, outputs={len(output_ids)}, reconciliations={len(reconciliation_ids)}, projection=checked.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AssertionError, yaml.YAMLError) as error:
        print(f"FINANCIAL_MODEL_INTEGRITY_POLICY_RETURN_REQUIRED: {error}")
        raise SystemExit(1)
