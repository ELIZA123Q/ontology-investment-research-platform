#!/usr/bin/env python3
"""Validate Ontology Meta-schema 1.0, core five-model bundle and domain extensions."""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Any

import yaml


ROOT = Path(__file__).resolve().parents[2]
CORE_DIR = Path(__file__).resolve().parent
MODEL_DIR = CORE_DIR / "models"
MODEL_FILES = ("semantic.yaml", "state_event.yaml", "evidence.yaml", "judgment.yaml", "scenario.yaml")
EXTENSION = ROOT / "ontology/01_通用/models/semiconductor_extension.yaml"
LEDGER = ROOT / "ontology/03_迁移/2x_to_3_ledger.yaml"
PUBLIC_CONTRACT = ROOT / "governance/02_合同/public_contract.yaml"
LEGACY_FILES = tuple(CORE_DIR / name for name in ("semantic.yaml", "evidence.yaml", "reasoning.yaml"))
PSEUDO_TYPES = {
    "core_object",
    "stable_rule",
    "reasoning_object",
    "relation_instance",
    "evidence_reasoning_relation",
    "validation_result",
    "relation_instance",
    "ResearchScenario",
}


def load_yaml(path: Path) -> dict[str, Any]:
    value = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path}: YAML root must be a mapping")
    return value


def _resources(schema: dict[str, Any]) -> list[tuple[str, str, dict[str, Any]]]:
    output: list[tuple[str, str, dict[str, Any]]] = []
    for section in ("object_types", "relation_types", "rules", "scenario_types", "evidence_constraints"):
        for resource_id, value in (schema.get(section) or {}).items():
            if isinstance(value, dict):
                output.append((section, resource_id, value))
    return output


def _resolve_inventory_classification(ledger: dict[str, Any], section: str, resource_id: str) -> dict[str, Any]:
    overrides = ledger.get("overrides", {})
    for override in overrides.values():
        if resource_id in (override.get("ids") or []):
            return override
        if resource_id in (override.get("mapping") or {}):
            return {
                "classification": override.get("classification"),
                "replaced_by": [override["mapping"][resource_id]],
            }
    return ledger.get("default_classification", {}).get(section, {})


def validate_bundle(
    models: dict[str, dict[str, Any]],
    extension: dict[str, Any],
    meta: dict[str, Any],
    ledger: dict[str, Any],
    legacy: dict[str, dict[str, Any]],
    public_contract: dict[str, Any] | None = None,
) -> list[str]:
    errors: list[str] = []
    required_metadata = set(meta["common_metadata"]["required"])
    allowed_status = set(meta["common_metadata"]["status_values"])
    allowed_models = set(meta["common_metadata"]["model_values"])
    forbidden_sections = set(meta["forbidden_top_level_sections"])
    attribute_required = set(meta["object_type_contract"]["attribute_required"])
    cardinalities = set(meta["object_type_contract"]["cardinalities"])
    allowed_rule_classes = set(meta["rule_contract"]["allowed_rule_classes"])
    method_id_pattern = re.compile(meta["rule_contract"]["forbidden_method_ids_pattern"])

    schemas = {**models, "semiconductor": extension}
    core_objects: set[str] = set()
    core_relations: dict[str, dict[str, Any]] = {}
    all_objects: set[str] = set()
    all_relations: dict[str, dict[str, Any]] = {}
    all_rules: set[str] = set()

    for name, schema in schemas.items():
        if schema.get("schema_version") != "3.0.0":
            errors.append(f"{name}: schema_version must be 3.0.0")
        if schema.get("meta_schema_version") != "1.0.0":
            errors.append(f"{name}: meta_schema_version must be 1.0.0")
        leaked = sorted(forbidden_sections & set(schema))
        if leaked:
            errors.append(f"{name}: forbidden formal-ontology sections: {leaked}")
        objects = schema.get("object_types") or {}
        relations = schema.get("relation_types") or {}
        all_objects.update(objects)
        all_relations.update(relations)
        all_rules.update((schema.get("rules") or {}).keys())
        all_rules.update((schema.get("evidence_constraints") or {}).keys())
        if name != "semiconductor":
            duplicate_objects = core_objects & set(objects)
            duplicate_relations = set(core_relations) & set(relations)
            if duplicate_objects or duplicate_relations:
                errors.append(f"{name}: duplicate core IDs objects={sorted(duplicate_objects)} relations={sorted(duplicate_relations)}")
            core_objects.update(objects)
            core_relations.update(relations)

    for name, schema in schemas.items():
        for section, resource_id, resource in _resources(schema):
            metadata = resource.get("metadata")
            if not isinstance(metadata, dict):
                errors.append(f"{name}:{section}.{resource_id} missing metadata")
                continue
            missing = sorted(required_metadata - set(metadata))
            if missing:
                errors.append(f"{name}:{section}.{resource_id} metadata missing {missing}")
            if metadata.get("id") != resource_id:
                errors.append(f"{name}:{section}.{resource_id} metadata.id mismatch")
            if metadata.get("status") not in allowed_status:
                errors.append(f"{name}:{section}.{resource_id} invalid status")
            if metadata.get("model") not in allowed_models:
                errors.append(f"{name}:{section}.{resource_id} invalid model")
            if metadata.get("status") == "deprecated" and not metadata.get("replaced_by"):
                errors.append(f"{name}:{section}.{resource_id} deprecated without replaced_by")
            if metadata.get("status") == "active" and metadata.get("replaced_by"):
                errors.append(f"{name}:{section}.{resource_id} active resource must not set replaced_by")
            if not metadata.get("examples") or not metadata.get("counter_examples"):
                errors.append(f"{name}:{section}.{resource_id} requires examples and counter_examples")

            if section == "object_types":
                for attribute_name, attribute in (resource.get("attributes") or {}).items():
                    if not isinstance(attribute, dict):
                        errors.append(f"{name}:{resource_id}.{attribute_name} must be a mapping")
                        continue
                    missing_attribute = sorted(attribute_required - set(attribute))
                    if missing_attribute:
                        errors.append(f"{name}:{resource_id}.{attribute_name} missing {missing_attribute}")
                    if attribute.get("cardinality") not in cardinalities:
                        errors.append(f"{name}:{resource_id}.{attribute_name} invalid cardinality")
                    if attribute.get("type") == "enum" and not attribute.get("allowed_values"):
                        errors.append(f"{name}:{resource_id}.{attribute_name} enum missing allowed_values")
                if not isinstance(resource.get("constraints"), dict):
                    errors.append(f"{name}:{resource_id} missing object constraints")

            if section == "relation_types":
                required_relation = set(meta["relation_type_contract"]["required"])
                missing_relation = sorted(required_relation - set(resource))
                if missing_relation:
                    errors.append(f"{name}:{resource_id} relation missing {missing_relation}")
                for endpoint in [*(resource.get("source_types") or []), *(resource.get("target_types") or [])]:
                    if endpoint not in all_objects:
                        errors.append(f"{name}:{resource_id} dangling endpoint {endpoint}")
                inverse = resource.get("inverse_of")
                if inverse not in all_relations:
                    errors.append(f"{name}:{resource_id} unresolved inverse {inverse}")
                elif all_relations[inverse].get("inverse_of") != resource_id:
                    errors.append(f"{name}:{resource_id} inverse {inverse} is not reciprocal")

            if section in ("rules", "evidence_constraints"):
                required_rule = set(meta["rule_contract"]["required"])
                missing_rule = sorted(required_rule - set(resource))
                if missing_rule:
                    errors.append(f"{name}:{resource_id} rule missing {missing_rule}")
                if resource.get("rule_class") not in allowed_rule_classes:
                    errors.append(f"{name}:{resource_id} invalid rule_class")
                if method_id_pattern.match(resource_id):
                    errors.append(f"{name}:{resource_id} method ID leaked into formal rules")
                for ref in [*(resource.get("applies_to") or []), *(resource.get("input_types") or []), *(resource.get("output_types") or [])]:
                    if ref not in all_objects | PSEUDO_TYPES:
                        errors.append(f"{name}:{resource_id} unresolved rule type {ref}")

        for scenario_id, scenario in (schema.get("scenario_types") or {}).items():
            required_scenario = set(meta["scenario_contract"]["required"])
            missing_scenario = sorted(required_scenario - set(scenario))
            if missing_scenario:
                errors.append(f"{name}:{scenario_id} scenario missing {missing_scenario}")
            for ref in scenario.get("required_object_types", []):
                if ref not in all_objects:
                    errors.append(f"{name}:{scenario_id} unresolved scenario object {ref}")
            for ref in scenario.get("required_relation_types", []):
                if ref not in all_relations:
                    errors.append(f"{name}:{scenario_id} unresolved scenario relation {ref}")
            for key in ("required_state_types", "required_evidence_types", "required_judgment_types"):
                for ref in scenario.get(key, []):
                    if ref not in all_objects:
                        errors.append(f"{name}:{scenario_id} unresolved scenario type {ref}")

    extension_objects = extension.get("object_types") or {}
    extension_relations = extension.get("relation_types") or {}
    for resource_id, resource in extension_objects.items():
        if resource_id in core_objects:
            errors.append(f"semiconductor:{resource_id} redefines core object")
        target = resource.get("extends") or resource.get("projects_to")
        if target not in core_objects:
            errors.append(f"semiconductor:{resource_id} must extend/project to core object")
    for relation_id, relation in extension_relations.items():
        if relation_id in core_relations:
            errors.append(f"semiconductor:{relation_id} redefines core relation")
        parent = relation.get("subproperty_of")
        if parent is not None and parent not in core_relations:
            errors.append(f"semiconductor:{relation_id} unresolved subproperty_of {parent}")

    contract = public_contract or load_yaml(PUBLIC_CONTRACT)
    propagation = contract.get("object_validity_propagation") or {}
    formal_contract_types = set(propagation.get("formal_object_types") or [])
    runtime_projection_types = set(propagation.get("runtime_projection_types") or [])
    missing_formal_types = sorted(formal_contract_types - all_objects)
    if missing_formal_types:
        errors.append(f"public_contract unresolved formal object types {missing_formal_types}")
    leaked_runtime_types = sorted(runtime_projection_types & all_objects)
    if leaked_runtime_types:
        errors.append(f"public_contract runtime projection leaked into formal ontology {leaked_runtime_types}")
    declared_propagation_types = formal_contract_types | runtime_projection_types
    for index, edge in enumerate(propagation.get("dependency_order") or [], 1):
        if not isinstance(edge, list) or len(edge) != 2:
            errors.append(f"public_contract dependency_order[{index}] must contain two endpoints")
            continue
        for endpoint in edge:
            for object_type in str(endpoint).split("_or_"):
                if object_type not in declared_propagation_types:
                    errors.append(
                        f"public_contract dependency_order[{index}] unresolved object type {object_type}"
                    )

    if ledger.get("target_ontology_version") != "3.0.0":
        errors.append("migration ledger target must be 3.0.0")
    actual_counts = {section: 0 for section in ledger.get("expected_counts", {})}
    for filename, sections in ledger.get("inventory", {}).items():
        for section, resource_ids in sections.items():
            actual_counts[section] = actual_counts.get(section, 0) + len(resource_ids)
            legacy_ids = set((legacy.get(filename, {}).get(section) or {}).keys())
            if set(resource_ids) != legacy_ids:
                errors.append(f"migration inventory drift: {filename}:{section}")
            for resource_id in resource_ids:
                resolved = _resolve_inventory_classification(ledger, section, resource_id)
                classification = resolved.get("classification")
                if classification not in ledger.get("classification_values", []):
                    errors.append(f"migration unclassified: {filename}:{section}.{resource_id}")
                if classification in {"merge", "deprecate", "move-to-methods", "move-to-runtime"} and not resolved.get("replaced_by"):
                    errors.append(f"migration missing replaced_by: {filename}:{section}.{resource_id}")
    if actual_counts != ledger.get("expected_counts"):
        errors.append(f"migration count mismatch expected={ledger.get('expected_counts')} actual={actual_counts}")
    return errors


def load_default_bundle() -> tuple[dict[str, dict[str, Any]], dict[str, Any], dict[str, Any], dict[str, Any], dict[str, dict[str, Any]]]:
    models = {name.removesuffix(".yaml"): load_yaml(MODEL_DIR / name) for name in MODEL_FILES}
    legacy = {path.name: load_yaml(path) for path in LEGACY_FILES}
    return models, load_yaml(EXTENSION), load_yaml(CORE_DIR / "meta_schema.yaml"), load_yaml(LEDGER), legacy


def main() -> int:
    errors = validate_bundle(*load_default_bundle())
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        print(f"ONTOLOGY_V3_RETURN_REQUIRED: {len(errors)} error(s)")
        return 1
    models, extension, _, ledger, _ = load_default_bundle()
    object_count = sum(len(model.get("object_types") or {}) for model in models.values()) + len(extension.get("object_types") or {})
    relation_count = sum(len(model.get("relation_types") or {}) for model in models.values()) + len(extension.get("relation_types") or {})
    print(f"ONTOLOGY_V3_PASS: five models + semiconductor extension; objects={object_count}, relations={relation_count}, migrated={sum(ledger['expected_counts'].values())}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
