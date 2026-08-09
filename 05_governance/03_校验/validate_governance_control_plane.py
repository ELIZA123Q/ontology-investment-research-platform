#!/usr/bin/env python3
"""校验本体演进治理本体的模型闭包、Action 生命周期、实例图和双平面边界。"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import yaml


ROOT = Path(__file__).resolve().parents[2]
GOVERNANCE_ONTOLOGY_ROOT = ROOT / "05_governance/05_元治理本体"
META_SCHEMA = GOVERNANCE_ONTOLOGY_ROOT / "meta_schema.yaml"
GOVERNANCE_MODEL_REGISTRY = GOVERNANCE_ONTOLOGY_ROOT / "model_registry.yaml"
GOVERNANCE_INSTANCE_GRAPH = GOVERNANCE_ONTOLOGY_ROOT / "instances/governance_instance_graph.yaml"
FORMAL_MODEL_REGISTRY = ROOT / "01_semantic/01_ontology/model_registry.yaml"

SECTIONS = (
    "shared_property_types",
    "interface_types",
    "object_types",
    "relation_types",
    "action_types",
    "rules",
)
REQUIRED_METADATA = {"id", "namespace", "label_zh", "label_en", "definition", "model", "version", "status"}
REQUIRED_ASSETS = {
    "governance.meta_ontology",
    "ontology.model_registry",
    "ontology.semantic_models",
    "ontology.semiconductor_parameters",
    "governance.public_contract",
    "governance.rule_authority",
    "governance.parameter_authority",
    "governance.ontology_consumers",
    "governance.data_mapping_profiles",
    "methods.registry",
    "runtime.operation_registry",
}
EXPECTED_TRANSITIONS = {
    "proposed": {"impact_assessed", "rejected"},
    "impact_assessed": {"approved", "rejected"},
    "approved": {"implemented", "rejected"},
    "implemented": {"validated"},
    "validated": {"released"},
    "released": set(),
    "rejected": set(),
}
REQUIRED_RELEASE_RULES = {
    "target_resolves",
    "proposal_baseline_current",
    "required_approvals_satisfied",
    "all_required_checks_pass",
    "breaking_change_migration_complete",
    "release_fingerprint_current",
}
SEMVER = re.compile(r"^\d+\.\d+\.\d+$")


def load(path: Path) -> dict[str, Any]:
    value = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path}: YAML root must be a mapping")
    return value


def load_governance_models(
    registry: dict[str, Any],
    *,
    governance_root: Path = GOVERNANCE_ONTOLOGY_ROOT,
) -> list[dict[str, Any]]:
    return [load(governance_root / str(raw_path)) for raw_path in registry.get("model_files") or []]


def formal_element_ids(
    model_registry: dict[str, Any],
    *,
    registry_path: Path = FORMAL_MODEL_REGISTRY,
) -> set[str]:
    ids: set[str] = set()
    for raw_path in model_registry.get("model_files") or []:
        document = load(registry_path.parent / str(raw_path))
        for section in ("object_types", "relation_types", "rules", "scenario_types", "evidence_constraints"):
            ids.update(map(str, (document.get(section) or {}).keys()))
    return ids


def _collect(models: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    collected = {section: {} for section in SECTIONS}
    for document in models:
        for section in SECTIONS:
            for element_id, definition in (document.get(section) or {}).items():
                collected[section][str(element_id)] = definition
    return collected


def _metadata_errors(section: str, elements: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    for element_id, definition in elements.items():
        metadata = definition.get("metadata") if isinstance(definition, dict) else None
        if not isinstance(metadata, dict):
            errors.append(f"{section}.{element_id} metadata must be a mapping")
            continue
        missing = sorted(REQUIRED_METADATA - set(metadata))
        if missing:
            errors.append(f"{section}.{element_id} metadata missing {missing}")
        if str(metadata.get("id") or "") != element_id:
            errors.append(f"{section}.{element_id} metadata.id mismatch")
        if not str(metadata.get("namespace") or "").startswith("gov."):
            errors.append(f"{section}.{element_id} namespace must start with gov.")
        if not SEMVER.match(str(metadata.get("version") or "")):
            errors.append(f"{section}.{element_id} metadata.version must be semantic x.y.z")
        if metadata.get("status") not in {"draft", "active", "deprecated"}:
            errors.append(f"{section}.{element_id} metadata.status invalid")
    return errors


def validate_governance_control_plane(
    meta_schema: dict[str, Any],
    registry: dict[str, Any],
    models: list[dict[str, Any]],
    instance_graph: dict[str, Any],
    formal_registry: dict[str, Any],
    *,
    root: Path = ROOT,
    known_formal_ids: set[str] | None = None,
) -> list[str]:
    errors: list[str] = []
    if meta_schema.get("schema_name") != "ontology_governance_meta_schema" or meta_schema.get("status") != "active":
        errors.append("governance meta schema name/status mismatch")
    boundary = meta_schema.get("boundary") or {}
    for field in (
        "formal_registration_allowed",
        "business_instance_projection_allowed",
        "commercial_rule_evaluation_allowed",
    ):
        if boundary.get(field) is not False:
            errors.append(f"governance boundary {field} must be false")

    if registry.get("schema_name") != "ontology_governance_model_registry" or registry.get("status") != "active":
        errors.append("governance model registry name/status mismatch")
    registered_files = list(map(str, registry.get("model_files") or []))
    if len(registered_files) != len(set(registered_files)):
        errors.append("governance model registry has duplicate model_files")
    for relative in registered_files:
        if not (GOVERNANCE_ONTOLOGY_ROOT / relative).is_file():
            errors.append(f"governance model file does not exist: {relative}")
    if len(models) != len(registered_files):
        errors.append("loaded governance model count does not match registry")

    collected = _collect(models)
    seen: dict[str, str] = {}
    for section, elements in collected.items():
        errors.extend(_metadata_errors(section, elements))
        for element_id in elements:
            if element_id in seen:
                errors.append(f"governance id duplicated across sections: {element_id}")
            seen[element_id] = section

    interfaces = collected["interface_types"]
    objects = collected["object_types"]
    relations = collected["relation_types"]
    actions = collected["action_types"]
    rules = collected["rules"]
    roles: set[str] = set()
    approval_policies: set[str] = set()
    validation_profiles: set[str] = set()
    for document in models:
        roles.update(map(str, (document.get("roles") or {}).keys()))
        approval_policies.update(map(str, (document.get("approval_policies") or {}).keys()))
        validation_profiles.update(map(str, (document.get("validation_profiles") or {}).keys()))

    for object_id, definition in objects.items():
        for interface_id in map(str, definition.get("implements") or []):
            if interface_id not in interfaces:
                errors.append(f"object {object_id} implements unresolved interface {interface_id}")
                continue
            missing_properties = sorted(
                set(map(str, interfaces[interface_id].get("required_properties") or []))
                - set(map(str, (definition.get("attributes") or {}).keys()))
            )
            if missing_properties:
                errors.append(f"object {object_id} misses interface {interface_id} properties {missing_properties}")
        primary_key = str(definition.get("primary_key") or "")
        title_property = str(definition.get("title_property") or "")
        attributes = definition.get("attributes") or {}
        if primary_key not in attributes:
            errors.append(f"object {object_id} primary_key does not resolve")
        if title_property not in attributes:
            errors.append(f"object {object_id} title_property does not resolve")
        for attribute_id, attribute in attributes.items():
            if not isinstance(attribute, dict):
                errors.append(f"object {object_id}.{attribute_id} must be a mapping")
                continue
            missing = {"type", "required", "cardinality", "value_role", "description"} - set(attribute)
            if missing:
                errors.append(f"object {object_id}.{attribute_id} missing {sorted(missing)}")
            if attribute.get("type") == "object_ref":
                target = str(attribute.get("reference_target") or "")
                if target not in objects:
                    errors.append(f"object {object_id}.{attribute_id} unresolved reference_target {target}")

    for relation_id, definition in relations.items():
        inverse_id = str(definition.get("inverse_of") or "")
        if inverse_id not in relations:
            errors.append(f"relation {relation_id} unresolved inverse {inverse_id}")
        elif str(relations[inverse_id].get("inverse_of") or "") != relation_id:
            errors.append(f"relation {relation_id} inverse {inverse_id} is not reciprocal")
        for endpoint in ("source_types", "target_types"):
            for type_id in map(str, definition.get(endpoint) or []):
                if type_id not in objects and type_id not in interfaces:
                    errors.append(f"relation {relation_id} unresolved {endpoint} type {type_id}")

    proposal = objects.get("ChangeProposal") or {}
    proposal_status = (proposal.get("attributes") or {}).get("status") or {}
    statuses = set(map(str, proposal_status.get("allowed_values") or []))
    if statuses != set(EXPECTED_TRANSITIONS):
        errors.append(f"ChangeProposal statuses drift: {sorted(statuses)}")

    transitions = {status: set() for status in statuses}
    for action_id, action in actions.items():
        if str(action.get("applies_to") or "") not in objects:
            errors.append(f"action {action_id} applies_to unresolved object")
        permission = action.get("permission") or {}
        unresolved_roles = sorted(set(map(str, permission.get("roles") or [])) - roles)
        if unresolved_roles:
            errors.append(f"action {action_id} has unresolved roles {unresolved_roles}")
        for criterion in action.get("submission_criteria") or []:
            rule_ref = str((criterion or {}).get("rule_ref") or "")
            if rule_ref not in rules:
                errors.append(f"action {action_id} has unresolved rule {rule_ref}")
        transition = action.get("state_transition") or {}
        object_type = str(transition.get("object_type") or "")
        property_id = str(transition.get("property") or "")
        if object_type not in objects:
            errors.append(f"action {action_id} state transition object unresolved")
        elif property_id not in (objects[object_type].get("attributes") or {}):
            errors.append(f"action {action_id} state transition property unresolved")
        from_values = set(map(str, transition.get("from") or []))
        to_value = str(transition.get("to") or "")
        allowed = set(map(str, ((objects.get(object_type) or {}).get("attributes") or {}).get(property_id, {}).get("allowed_values") or []))
        for from_value in from_values - {"none"}:
            if from_value not in allowed:
                errors.append(f"action {action_id} has invalid from state {from_value}")
        if to_value not in allowed | {"same", "dynamic"}:
            errors.append(f"action {action_id} has invalid to state {to_value}")
        if object_type == "ChangeProposal" and to_value in statuses and action_id != "RebaseOntologyProposal":
            for from_value in from_values & statuses:
                if from_value != to_value:
                    transitions[from_value].add(to_value)
        writes = action.get("writes") or {}
        for object_id in map(str, (writes.get("creates") or []) + (writes.get("updates") or [])):
            if object_id not in objects:
                errors.append(f"action {action_id} writes unresolved object {object_id}")
        for relation_id in map(str, writes.get("links") or []):
            if relation_id not in relations:
                errors.append(f"action {action_id} writes unresolved relation {relation_id}")
        action_log = action.get("action_log") or {}
        if action_log.get("object_type") != "GovernanceActionLog" or action_log.get("immutable") is not True:
            errors.append(f"action {action_id} must write immutable GovernanceActionLog")
        if not SEMVER.match(str(action_log.get("version") or "")):
            errors.append(f"action {action_id} action_log version invalid")
    if transitions != EXPECTED_TRANSITIONS:
        errors.append(f"ChangeProposal action transition graph drift: {transitions}")

    release_action = actions.get("ReleaseOntologyBaseline") or {}
    release_rules = {
        str(item.get("rule_ref"))
        for item in release_action.get("submission_criteria") or []
        if isinstance(item, dict)
    }
    if release_rules != REQUIRED_RELEASE_RULES:
        errors.append(
            "release action criteria drift "
            f"missing={sorted(REQUIRED_RELEASE_RULES - release_rules)} "
            f"extra={sorted(release_rules - REQUIRED_RELEASE_RULES)}"
        )

    formal_files = list(map(str, formal_registry.get("model_files") or []))
    if any("governance" in path.lower() or "治理" in path for path in formal_files):
        errors.append("formal ontology model registry must not register governance models")
    formal_ids = known_formal_ids if known_formal_ids is not None else formal_element_ids(formal_registry)
    leaked_ids = sorted(set(seen) & formal_ids)
    if leaked_ids:
        errors.append(f"governance ids leaked into formal ontology: {leaked_ids}")

    if instance_graph.get("schema_name") != "ontology_governance_instance_graph" or instance_graph.get("status") != "active":
        errors.append("governance instance graph name/status mismatch")
    if instance_graph.get("ontology_ref") != "05_governance/05_元治理本体/model_registry.yaml":
        errors.append("governance instance graph ontology_ref mismatch")
    instance_objects: dict[str, dict[str, Any]] = {}
    for index, item in enumerate(instance_graph.get("objects") or []):
        if not isinstance(item, dict):
            errors.append(f"instance objects[{index}] must be a mapping")
            continue
        instance_id = str(item.get("id") or "")
        object_type = str(item.get("type") or "")
        if not instance_id or instance_id in instance_objects:
            errors.append(f"instance object has empty or duplicate id {instance_id}")
        if object_type not in objects:
            errors.append(f"instance {instance_id} unresolved type {object_type}")
        instance_objects[instance_id] = item
        if object_type == "GovernedAsset":
            properties = item.get("properties") or {}
            authority_ref = str(properties.get("authority_ref") or "")
            if not authority_ref or not (root / authority_ref).exists():
                errors.append(f"asset {instance_id} authority_ref does not exist: {authority_ref}")
            if str(properties.get("owner_role") or "") not in roles:
                errors.append(f"asset {instance_id} unresolved owner_role")
            if str(properties.get("validation_profile") or "") not in validation_profiles:
                errors.append(f"asset {instance_id} unresolved validation_profile")
    asset_ids = {
        instance_id
        for instance_id, item in instance_objects.items()
        if item.get("type") == "GovernedAsset"
    }
    if not REQUIRED_ASSETS.issubset(asset_ids):
        errors.append(f"governance instance graph missing required assets: {sorted(REQUIRED_ASSETS - asset_ids)}")

    relation_ids: set[str] = set()
    for index, item in enumerate(instance_graph.get("relations") or []):
        if not isinstance(item, dict):
            errors.append(f"instance relations[{index}] must be a mapping")
            continue
        relation_instance_id = str(item.get("id") or "")
        relation_type = str(item.get("type") or "")
        source_id = str(item.get("source_id") or "")
        target_id = str(item.get("target_id") or "")
        if not relation_instance_id or relation_instance_id in relation_ids:
            errors.append(f"instance relation has empty or duplicate id {relation_instance_id}")
        relation_ids.add(relation_instance_id)
        if relation_type not in relations:
            errors.append(f"instance relation {relation_instance_id} unresolved type {relation_type}")
            continue
        if source_id not in instance_objects or target_id not in instance_objects:
            errors.append(f"instance relation {relation_instance_id} endpoint does not resolve")
            continue
        source_type = str(instance_objects[source_id].get("type") or "")
        target_type = str(instance_objects[target_id].get("type") or "")
        if source_type not in set(map(str, relations[relation_type].get("source_types") or [])):
            errors.append(f"instance relation {relation_instance_id} source type mismatch")
        if target_type not in set(map(str, relations[relation_type].get("target_types") or [])):
            errors.append(f"instance relation {relation_instance_id} target type mismatch")
    return errors


def main() -> int:
    meta_schema = load(META_SCHEMA)
    registry = load(GOVERNANCE_MODEL_REGISTRY)
    formal_registry = load(FORMAL_MODEL_REGISTRY)
    errors = validate_governance_control_plane(
        meta_schema,
        registry,
        load_governance_models(registry),
        load(GOVERNANCE_INSTANCE_GRAPH),
        formal_registry,
    )
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        print(f"GOVERNANCE_ONTOLOGY_RETURN_REQUIRED: {len(errors)} error(s)")
        return 1
    print(
        "GOVERNANCE_ONTOLOGY_PASS: model registry, interfaces, objects, relations, "
        "actions, rules, instances and formal-ontology isolation are consistent."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
