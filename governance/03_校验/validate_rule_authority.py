#!/usr/bin/env python3
"""校验正式约束、研究方法、治理检查与运行控制的唯一权威归属。"""

from __future__ import annotations

import re
from collections import defaultdict
from pathlib import Path
from typing import Any

import yaml


ROOT = Path(__file__).resolve().parents[2]
REGISTRY = ROOT / "governance/02_合同/rule_authority_registry.yaml"
LEDGER = ROOT / "ontology/03_迁移/2x_to_3_ledger.yaml"
OPERATIONS = ROOT / "runtime/engine/runtime_operations.yaml"
MODEL_FILES = tuple((ROOT / "ontology/01_通用/models").glob("*.yaml"))
LEGACY_FILES = tuple(ROOT / "ontology/01_通用" / name for name in ("semantic.yaml", "evidence.yaml", "reasoning.yaml"))
SAMPLE_FILES = tuple((ROOT / "instances/02_V3样例").glob("*/04_judgment.yaml"))
CURRENT_TEMPLATES = (
    ROOT / "workflow/stages/02_结构/模板/02_任务本体视图模板.yaml",
    ROOT / "workflow/stages/04_判断/模板/04_推理审计模板.yaml",
)
METHOD_ID = re.compile(r"^(?:A|kb0[234]:A)[0-9]{2}$")
AUTHORITY_SECTIONS = (
    "formal_ontology_rules",
    "method_assets",
    "governance_rules",
    "runtime_rules",
)


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


def legacy_rule_ids() -> set[str]:
    output: set[str] = set()
    for path in LEGACY_FILES:
        output.update((load(path).get("rules") or {}).keys())
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
    ledger: dict[str, Any],
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
        for rule in (load(ROOT / "governance/03_校验/requirements_coverage.yaml").get("rules") or [])
        if isinstance(rule, dict)
    }
    missing_governance = sorted(requirement_ids - authority_ids.get("governance_rules", set()))
    if missing_governance:
        errors.append(f"requirements_coverage rules missing governance ownership: {missing_governance}")

    legacy_ids = legacy_rule_ids()
    explicit_migrations: dict[str, list[tuple[str, str, str | None]]] = defaultdict(list)
    for override_name, override in (ledger.get("overrides") or {}).items():
        if not isinstance(override, dict):
            continue
        classification = override.get("classification")
        for resource_id, replacement in (override.get("mapping") or {}).items():
            if resource_id in legacy_ids:
                explicit_migrations[resource_id].append((override_name, str(replacement), classification))
        for resource_id in override.get("ids") or []:
            if resource_id in legacy_ids:
                replacements = override.get("replaced_by") or []
                explicit_migrations[resource_id].append((override_name, str(replacements[0]) if replacements else "", classification))

    allowed_classifications = set(ledger.get("classification_values") or [])
    for rule_id in sorted(legacy_ids):
        migrations = explicit_migrations.get(rule_id, [])
        if len(migrations) != 1:
            errors.append(f"legacy rule {rule_id} requires exactly one explicit migration, found {len(migrations)}")
            continue
        _, replacement, classification = migrations[0]
        if classification not in allowed_classifications:
            errors.append(f"legacy rule {rule_id} invalid classification {classification}")
        if classification != "keep" and not replacement:
            errors.append(f"legacy rule {rule_id} missing replaced_by")

    if operations.get("schema_name") != "runtime_operation_registry" or operations.get("authority") != "runtime":
        errors.append("runtime operation registry authority mismatch")
    ref_contract = {
        "formal_rule_refs": authority_ids.get("formal_ontology_rules", set()),
        "method_refs": authority_ids.get("method_assets", set()),
        "governance_rule_refs": authority_ids.get("governance_rules", set()),
        "runtime_rule_refs": authority_ids.get("runtime_rules", set()),
    }
    for action_id, action in (operations.get("actions") or {}).items():
        if "rule_refs" in action:
            errors.append(f"runtime action {action_id} uses ambiguous rule_refs")
        for field, allowed_refs in ref_contract.items():
            refs = action.get(field)
            if not isinstance(refs, list):
                errors.append(f"runtime action {action_id} missing {field}")
                continue
            unresolved = sorted(set(map(str, refs)) - allowed_refs)
            if unresolved:
                errors.append(f"runtime action {action_id} unresolved {field}: {unresolved}")

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
    errors = validate_rule_authority(load(REGISTRY), load(LEDGER), load(OPERATIONS))
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        print(f"RULE_AUTHORITY_RETURN_REQUIRED: {len(errors)} error(s)")
        return 1
    print(
        "RULE_AUTHORITY_PASS: "
        f"formal={len(formal_rule_ids())}, legacy_migrated={len(legacy_rule_ids())}, "
        f"samples={len(SAMPLE_FILES)}; methods/governance/runtime uniquely separated."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
