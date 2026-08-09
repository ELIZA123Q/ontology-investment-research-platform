#!/usr/bin/env python3
"""校验正式约束、研究方法、治理检查与运行控制的唯一权威归属。"""

from __future__ import annotations

import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
from repo_paths import stage_yaml_template

ROOT = Path(__file__).resolve().parents[2]
REGISTRY = ROOT / "05_governance/02_合同/rule_authority_registry.yaml"
OPERATIONS = ROOT / "01_semantic/01_ontology/kinetics/action_types.yaml"
KINETIC_POLICIES = ROOT / "01_semantic/01_ontology/kinetics/policies.yaml"
MODEL_FILES = tuple((ROOT / "01_semantic/01_ontology/models").glob("*.yaml"))
SAMPLE_FILES = tuple((ROOT / "04_execution/03_workspace/02_V3样例").glob("*/04_judgment.yaml"))
CURRENT_TEMPLATES = (
    stage_yaml_template("02"),
    stage_yaml_template("04"),
)
METHOD_ID = re.compile(r"^(?:A|kb0[234]:A)[0-9]{2}$")
AUTHORITY_SECTIONS = (
    "formal_ontology_rules",
    "method_assets",
    "governance_rules",
    "runtime_rules",
)
EXECUTION_SURFACES = {
    "runtime_semantic_execution",
    "runtime_graph_contract",
    "unimplemented",
}


def load(path: Path) -> dict[str, Any]:
    value = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path}: YAML root must be a mapping")
    return value


def formal_rule_ids() -> set[str]:
    output: set[str] = set()
    for path in MODEL_FILES:
        schema = load(path)
        output.update((schema.get("rules") or {}).keys())
        output.update((schema.get("evidence_constraints") or {}).keys())
    return output


def sample_rule_refs() -> list[tuple[str, str]]:
    refs: list[tuple[str, str]] = []
    for path in SAMPLE_FILES:
        document = load(path)
        for evaluation in document.get("rule_evaluations") or []:
            if isinstance(evaluation, dict):
                refs.append((str(path.relative_to(ROOT)), str(evaluation.get("rule_ref") or "")))
    return refs


def nested_keys(value: object) -> set[str]:
    keys: set[str] = set()
    if isinstance(value, dict):
        for key, child in value.items():
            keys.add(str(key))
            keys.update(nested_keys(child))
    elif isinstance(value, list):
        for child in value:
            keys.update(nested_keys(child))
    return keys


def validate_rule_authority(
    registry: dict[str, Any],
    operations: dict[str, Any],
    judgment_rule_refs: list[tuple[str, str]] | None = None,
) -> list[str]:
    errors: list[str] = []
    if registry.get("schema_name") != "investment_research_rule_authority_registry":
        errors.append("rule registry schema_name mismatch")

    authority_ids: dict[str, set[str]] = {}
    ownership: dict[str, list[str]] = defaultdict(list)
    for section in AUTHORITY_SECTIONS:
        values = registry.get(section)
        if not isinstance(values, dict):
            errors.append(f"rule registry missing {section}")
            values = {}
        authority_ids[section] = set(values)
        for resource_id, resource in values.items():
            ownership[resource_id].append(section)
            if not isinstance(resource, dict) or not resource.get("source_ref"):
                errors.append(f"{section}.{resource_id} missing source_ref")
                continue
            source_path = ROOT / str(resource["source_ref"]).split("#", 1)[0]
            if not source_path.exists():
                errors.append(f"{section}.{resource_id} unresolved source_ref {resource['source_ref']}")

    for resource_id, sections in ownership.items():
        if len(sections) != 1:
            errors.append(f"rule authority duplicate {resource_id}: {sections}")

    actual_formal = formal_rule_ids()
    declared_formal = authority_ids.get("formal_ontology_rules", set())
    if actual_formal != declared_formal:
        errors.append(
            f"formal rule registry drift missing={sorted(actual_formal - declared_formal)} "
            f"extra={sorted(declared_formal - actual_formal)}"
        )
    leaked_methods = sorted(rule_id for rule_id in actual_formal if METHOD_ID.match(rule_id))
    if leaked_methods:
        errors.append(f"method IDs leaked into formal ontology: {leaked_methods}")

    for rule_id, resource in (registry.get("formal_ontology_rules") or {}).items():
        if not isinstance(resource, dict):
            continue
        surface = resource.get("execution_surface")
        if surface not in EXECUTION_SURFACES:
            errors.append(f"formal_ontology_rules.{rule_id} missing or invalid execution_surface")
        if not isinstance(resource.get("blocking"), bool):
            errors.append(f"formal_ontology_rules.{rule_id} missing boolean blocking")
        if surface == "runtime_semantic_execution" and resource.get("blocking") is not True:
            errors.append(f"formal_ontology_rules.{rule_id} runtime_semantic_execution must be blocking")

    for section in ("governance_rules", "runtime_rules"):
        for resource_id, resource in (registry.get(section) or {}).items():
            if resource.get("business_support_allowed") is not False:
                errors.append(f"{section}.{resource_id} must forbid business support")

    for retired_id, retired in (registry.get("retired_rule_ids") or {}).items():
        replacement = retired.get("replaced_by") if isinstance(retired, dict) else None
        if not replacement or replacement not in authority_ids.get("governance_rules", set()):
            errors.append(f"retired rule {retired_id} has unresolved governance replacement {replacement}")
        if retired_id in ownership:
            errors.append(f"retired rule {retired_id} still has active authority")

    requirement_ids = {
        str(rule.get("rule_id"))
        for rule in (load(ROOT / "05_governance/03_校验/requirements_coverage.yaml").get("rules") or [])
        if isinstance(rule, dict)
    }
    missing_governance = sorted(requirement_ids - authority_ids.get("governance_rules", set()))
    if missing_governance:
        errors.append(f"requirements_coverage rules missing governance ownership: {missing_governance}")

    if operations.get("schema_name") != "ontology_action_catalog" or operations.get("schema_version") != "4.0.0":
        errors.append("Ontology 4.0 action catalog authority mismatch")
    for action_id, action in (operations.get("actions") or {}).items():
        if "rule_refs" in action:
            errors.append(f"ontology action {action_id} uses ambiguous rule_refs")
        if action.get("submission_policy") != "FormalWritesViaActionsOnly":
            errors.append(f"ontology action {action_id} must use FormalWritesViaActionsOnly")
    policies = load(KINETIC_POLICIES).get("policies") or {}
    high_risk = set((policies.get("HighRiskResearcherApproval") or {}).get("applies_to") or [])
    missing_actions = sorted(high_risk - set(operations.get("actions") or {}))
    if missing_actions:
        errors.append(f"HighRiskResearcherApproval unresolved actions: {missing_actions}")
    if high_risk and "GOV-ACTION-APPROVAL-001" not in authority_ids.get("governance_rules", set()):
        errors.append("HighRiskResearcherApproval missing governance authority GOV-ACTION-APPROVAL-001")

    for path in CURRENT_TEMPLATES:
        ambiguous = sorted(nested_keys(load(path)) & {"rule_refs", "inference_rule_refs"})
        if ambiguous:
            errors.append(f"{path.relative_to(ROOT)} contains ambiguous rule fields {ambiguous}")

    for source, rule_ref in judgment_rule_refs if judgment_rule_refs is not None else sample_rule_refs():
        if rule_ref not in actual_formal:
            owner = ownership.get(rule_ref, ["unregistered"])
            errors.append(f"{source}: commercial RuleEvaluation uses non-formal rule {rule_ref} owner={owner}")
    return errors


def main() -> int:
    errors = validate_rule_authority(load(REGISTRY), load(OPERATIONS))
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        print(f"RULE_AUTHORITY_RETURN_REQUIRED: {len(errors)} error(s)")
        return 1
    print(
        "RULE_AUTHORITY_PASS: "
        f"formal={len(formal_rule_ids())}, "
        f"samples={len(SAMPLE_FILES)}; 03_capabilities/05_method_libraries/05_governance/runtime uniquely separated."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
