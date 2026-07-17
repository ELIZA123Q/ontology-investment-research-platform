#!/usr/bin/env python3
"""Validate Ontology Meta-schema 1.0, the five core models and extensions.

The validator deliberately validates semantics rather than only counting keys.  It
is also imported by the governance negative-test suite, so keep validation pure:
no file writes and no mutation of the supplied bundle.
"""

from __future__ import annotations

import datetime as dt
import re
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

import yaml


ROOT = Path(__file__).resolve().parents[2]
CORE_DIR = Path(__file__).resolve().parent
MODEL_DIR = CORE_DIR / "models"
MODEL_FILES = ("semantic.yaml", "state_event.yaml", "evidence.yaml", "judgment.yaml", "scenario.yaml")
EXTENSION = MODEL_DIR / "semiconductor_extension.yaml"
PUBLIC_CONTRACT = ROOT / "governance/02_合同/public_contract.yaml"
MIGRATION_LEDGER = ROOT / "ontology/03_迁移/2x_to_3_ledger.yaml"
PSEUDO_TYPES = {
    "core_object",
    "stable_rule",
    "reasoning_object",
    "relation_instance",
    "evidence_reasoning_relation",
    "validation_result",
    "ResearchScenario",
}
SEMVER_RE = re.compile(r"^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$")
ID_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]*$")
POSITIVE_RESULTS = {"pass", "allow", "valid", "success"}
NEGATIVE_RESULTS = {"reject", "fail", "invalid", "block", "downgrade_or_reject"}


class _UniqueKeyLoader(yaml.SafeLoader):
    """Safe YAML loader that rejects duplicate mapping keys."""


def _construct_unique_mapping(loader: _UniqueKeyLoader, node: yaml.MappingNode, deep: bool = False) -> dict[Any, Any]:
    loader.flatten_mapping(node)
    mapping: dict[Any, Any] = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in mapping:
            raise ValueError(f"duplicate YAML key {key!r} at line {key_node.start_mark.line + 1}")
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping


_UniqueKeyLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,
    _construct_unique_mapping,
)


def load_yaml(path: Path) -> dict[str, Any]:
    value = yaml.load(path.read_text(encoding="utf-8"), Loader=_UniqueKeyLoader)
    if not isinstance(value, dict):
        raise ValueError(f"{path}: YAML root must be a mapping")
    return value


def _resources(schema: dict[str, Any]) -> list[tuple[str, str, dict[str, Any]]]:
    output: list[tuple[str, str, dict[str, Any]]] = []
    for section in ("object_types", "relation_types", "rules", "scenario_types", "evidence_constraints"):
        values = schema.get(section) or {}
        if not isinstance(values, dict):
            continue
        for resource_id, value in values.items():
            if isinstance(value, dict):
                output.append((section, resource_id, value))
    return output


def _nonempty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _as_date(value: Any) -> dt.date | None:
    if isinstance(value, dt.datetime):
        return value.date()
    if isinstance(value, dt.date):
        return value
    if isinstance(value, str):
        try:
            return dt.date.fromisoformat(value)
        except ValueError:
            return None
    return None


def _list_of_nonempty_strings(value: Any, *, allow_empty: bool) -> bool:
    return (
        isinstance(value, list)
        and (allow_empty or bool(value))
        and all(_nonempty_string(item) for item in value)
    )


def _iter_refs(value: Any) -> Iterable[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from _iter_refs(item)


def validate_bundle(
    models: dict[str, dict[str, Any]],
    extension: dict[str, Any],
    meta: dict[str, Any],
    public_contract: dict[str, Any] | None = None,
) -> list[str]:
    errors: list[str] = []

    common = meta.get("common_metadata") or {}
    object_contract = meta.get("object_type_contract") or {}
    relation_contract = meta.get("relation_type_contract") or {}
    rule_contract = meta.get("rule_contract") or {}
    scenario_contract = meta.get("scenario_contract") or {}
    required_metadata = set(common.get("required") or [])
    allowed_status = set(common.get("status_values") or [])
    allowed_models = set(common.get("model_values") or [])
    forbidden_sections = set(meta.get("forbidden_top_level_sections") or [])
    object_required = set(object_contract.get("required") or [])
    attribute_required = set(object_contract.get("attribute_required") or [])
    allowed_types = set(object_contract.get("scalar_types") or []) | set(object_contract.get("compound_types") or [])
    cardinalities = set(object_contract.get("cardinalities") or [])
    value_roles = set(object_contract.get("value_roles") or [])
    constraint_required = set(object_contract.get("constraints_required") or [])
    allowed_directions = set(relation_contract.get("directions") or [])
    invalidation_policies = set(relation_contract.get("invalidation_policies") or [])
    allowed_rule_classes = set(rule_contract.get("allowed_rule_classes") or [])
    method_id_pattern = re.compile(rule_contract.get("forbidden_method_ids_pattern") or r"a^")
    declared_namespaces = set((meta.get("namespaces") or {}).keys())

    schemas = {**models, "semiconductor": extension}
    inventories: dict[str, dict[str, dict[str, Any]]] = {}
    resource_locations: dict[str, list[tuple[str, str, str, dict[str, Any]]]] = defaultdict(list)
    namespaced_locations: dict[tuple[str, str], list[tuple[str, str]]] = defaultdict(list)
    core_ids: set[str] = set()
    core_object_ids: set[str] = set()

    for name, schema in schemas.items():
        if not isinstance(schema, dict):
            errors.append(f"{name}: schema must be a mapping")
            continue
        if schema.get("schema_version") != "3.0.0":
            errors.append(f"{name}: schema_version must be 3.0.0")
        if schema.get("meta_schema_version") != "1.0.0":
            errors.append(f"{name}: meta_schema_version must be 1.0.0")
        if schema.get("namespace") not in declared_namespaces:
            errors.append(f"{name}: unknown schema namespace {schema.get('namespace')!r}")
        leaked = sorted(forbidden_sections & set(schema))
        if leaked:
            errors.append(f"{name}: forbidden formal-ontology sections: {leaked}")
        for section in ("object_types", "relation_types", "rules", "scenario_types", "evidence_constraints"):
            if section in schema and not isinstance(schema[section], dict):
                errors.append(f"{name}: {section} must be a mapping")
            elif isinstance(schema.get(section), dict):
                for resource_id, resource in schema[section].items():
                    if not isinstance(resource, dict):
                        errors.append(f"{name}:{section}.{resource_id} must be a mapping")

        inventories[name] = {}
        for section, resource_id, resource in _resources(schema):
            inventories[name].setdefault(section, {})[resource_id] = resource
            metadata = resource.get("metadata")
            namespace = metadata.get("namespace") if isinstance(metadata, dict) else ""
            resource_locations[resource_id].append((name, section, namespace, resource))
            if isinstance(namespace, str):
                namespaced_locations[(namespace, resource_id)].append((name, section))
            if name != "semiconductor":
                core_ids.add(resource_id)
                if section == "object_types":
                    core_object_ids.add(resource_id)

    for (namespace, resource_id), locations in namespaced_locations.items():
        if len(locations) > 1:
            errors.append(f"global duplicate namespace+id {namespace}:{resource_id} at {locations}")

    all_objects: dict[str, dict[str, Any]] = {}
    all_relations: dict[str, dict[str, Any]] = {}
    for name, schema in schemas.items():
        for resource_id, resource in (schema.get("object_types") or {}).items():
            if resource_id in all_objects:
                errors.append(f"{name}: duplicate object ID {resource_id}")
            else:
                all_objects[resource_id] = resource
        for resource_id, resource in (schema.get("relation_types") or {}).items():
            if resource_id in all_relations:
                errors.append(f"{name}: duplicate relation ID {resource_id}")
            else:
                all_relations[resource_id] = resource

    def resolves_resource(ref: Any) -> bool:
        if not _nonempty_string(ref):
            return False
        if ref in resource_locations:
            return True
        if ":" in ref:
            namespace, resource_id = ref.rsplit(":", 1)
            return (namespace, resource_id) in namespaced_locations
        return False

    def ancestors(object_id: str) -> set[str]:
        found: set[str] = set()
        pending = [object_id]
        while pending:
            current = pending.pop()
            if current in found:
                continue
            found.add(current)
            resource = all_objects.get(current) or {}
            for key in ("extends", "projects_to"):
                parent = resource.get(key)
                if isinstance(parent, str) and parent not in found:
                    pending.append(parent)
        return found

    def endpoint_compatible(children: Any, parents: Any) -> bool:
        return (
            isinstance(children, list)
            and bool(children)
            and isinstance(parents, list)
            and bool(parents)
            and all(any(parent in ancestors(child) for parent in parents) for child in children)
        )

    # Reject inheritance/projection loops explicitly.  The ancestors helper is
    # cycle-safe, but a cycle would otherwise look like a valid transitive path.
    inheritance_state: dict[str, int] = {}

    def visit_inheritance(object_id: str, trail: list[str]) -> None:
        state = inheritance_state.get(object_id, 0)
        if state == 1:
            cycle_start = trail.index(object_id) if object_id in trail else 0
            errors.append(f"object inheritance cycle: {' -> '.join(trail[cycle_start:] + [object_id])}")
            return
        if state == 2:
            return
        inheritance_state[object_id] = 1
        resource = all_objects.get(object_id) or {}
        for key in ("extends", "projects_to"):
            parent = resource.get(key)
            if isinstance(parent, str) and parent in all_objects:
                visit_inheritance(parent, trail + [object_id])
        inheritance_state[object_id] = 2

    for object_id in all_objects:
        visit_inheritance(object_id, [])

    def validate_attribute(path: str, attribute: Any) -> None:
        if not isinstance(attribute, dict):
            errors.append(f"{path} must be a mapping")
            return
        missing = sorted(attribute_required - set(attribute))
        if missing:
            errors.append(f"{path} missing {missing}")
        attr_type = attribute.get("type")
        if attr_type not in allowed_types:
            errors.append(f"{path} invalid attribute type {attr_type!r}")
        if type(attribute.get("required")) is not bool:
            errors.append(f"{path} required must be boolean")
        if attribute.get("cardinality") not in cardinalities:
            errors.append(f"{path} invalid cardinality")
        if attribute.get("value_role") not in value_roles:
            errors.append(f"{path} invalid value_role {attribute.get('value_role')!r}")
        if not _nonempty_string(attribute.get("nullable_semantics")):
            errors.append(f"{path} nullable_semantics must be non-empty")
        if not _nonempty_string(attribute.get("description")):
            errors.append(f"{path} description must be non-empty")
        if attr_type == "enum" and not _list_of_nonempty_strings(attribute.get("allowed_values"), allow_empty=False):
            errors.append(f"{path} enum missing non-empty allowed_values")
        if attr_type == "object_ref":
            target = attribute.get("reference_target")
            if target not in set(all_objects) | PSEUDO_TYPES:
                errors.append(f"{path} unresolved reference_target {target!r}")

    for name, schema in schemas.items():
        schema_namespace = schema.get("namespace")
        for section, resource_id, resource in _resources(schema):
            path = f"{name}:{section}.{resource_id}"
            if not _nonempty_string(resource_id) or not ID_RE.fullmatch(resource_id):
                errors.append(f"{path} invalid stable ID")
            metadata = resource.get("metadata")
            if not isinstance(metadata, dict):
                errors.append(f"{path} missing metadata")
                continue
            missing = sorted(required_metadata - set(metadata))
            if missing:
                errors.append(f"{path} metadata missing {missing}")
            if metadata.get("id") != resource_id:
                errors.append(f"{path} metadata.id mismatch")
            if metadata.get("namespace") != schema_namespace or metadata.get("namespace") not in declared_namespaces:
                errors.append(f"{path} invalid metadata namespace {metadata.get('namespace')!r}")
            for key in ("id", "namespace", "label_zh", "label_en", "definition", "source"):
                if not _nonempty_string(metadata.get(key)):
                    errors.append(f"{path} metadata.{key} must be non-empty string")
            if not _list_of_nonempty_strings(metadata.get("aliases"), allow_empty=True):
                errors.append(f"{path} metadata.aliases must be a string list")
            if not _list_of_nonempty_strings(metadata.get("examples"), allow_empty=False):
                errors.append(f"{path} metadata.examples must be non-empty string list")
            if not _list_of_nonempty_strings(metadata.get("counter_examples"), allow_empty=False):
                errors.append(f"{path} metadata.counter_examples must be non-empty string list")
            if metadata.get("status") not in allowed_status:
                errors.append(f"{path} invalid status")
            if metadata.get("model") not in allowed_models:
                errors.append(f"{path} invalid model")
            version = metadata.get("version")
            if not isinstance(version, str) or not SEMVER_RE.fullmatch(version):
                errors.append(f"{path} metadata.version must be SemVer")
            valid_from = _as_date(metadata.get("valid_from"))
            valid_to_value = metadata.get("valid_to")
            valid_to = None if valid_to_value is None else _as_date(valid_to_value)
            if valid_from is None:
                errors.append(f"{path} metadata.valid_from must be ISO date")
            if valid_to_value is not None and valid_to is None:
                errors.append(f"{path} metadata.valid_to must be null or ISO date")
            if valid_from is not None and valid_to is not None and valid_from > valid_to:
                errors.append(f"{path} metadata valid_from must not exceed valid_to")
            replaced_by = metadata.get("replaced_by")
            if not _list_of_nonempty_strings(replaced_by, allow_empty=True):
                errors.append(f"{path} metadata.replaced_by must be a string list")
                replaced_by = []
            if metadata.get("status") == "deprecated":
                if not replaced_by:
                    errors.append(f"{path} deprecated without replaced_by")
                for replacement in replaced_by:
                    if not resolves_resource(replacement):
                        errors.append(f"{path} unresolved replaced_by {replacement}")
                    elif replacement == resource_id or replacement.endswith(f":{resource_id}"):
                        errors.append(f"{path} replaced_by cannot reference itself")
            elif replaced_by:
                errors.append(f"{path} non-deprecated resource must not set replaced_by")

            if section == "object_types":
                missing_object = sorted(object_required - set(resource))
                if missing_object:
                    errors.append(f"{name}:{resource_id} object missing {missing_object}")
                attributes = resource.get("attributes")
                if not isinstance(attributes, dict) or not attributes:
                    errors.append(f"{name}:{resource_id} attributes must be non-empty mapping")
                    attributes = {}
                for attribute_name, attribute in attributes.items():
                    validate_attribute(f"{name}:{resource_id}.{attribute_name}", attribute)
                for key in ("primary_key", "title_property"):
                    value = resource.get(key)
                    if not _nonempty_string(value):
                        errors.append(f"{name}:{resource_id} {key} must be non-empty string")
                    elif value != "id" and value not in attributes:
                        errors.append(f"{name}:{resource_id} {key} references unknown attribute {value}")
                constraints = resource.get("constraints")
                if not isinstance(constraints, dict):
                    errors.append(f"{name}:{resource_id} missing object constraints")
                    constraints = {}
                missing_constraints = sorted(constraint_required - set(constraints))
                if missing_constraints:
                    errors.append(f"{name}:{resource_id} constraints missing {missing_constraints}")
                unique = constraints.get("unique")
                if not isinstance(unique, list):
                    errors.append(f"{name}:{resource_id} constraints.unique must be a list")
                else:
                    for ref in _iter_refs(unique):
                        if ref not in attributes:
                            errors.append(f"{name}:{resource_id} constraints.unique unknown attribute {ref}")
                mutually_exclusive = constraints.get("mutually_exclusive")
                if not isinstance(mutually_exclusive, list):
                    errors.append(f"{name}:{resource_id} constraints.mutually_exclusive must be a list")
                else:
                    for ref in _iter_refs(mutually_exclusive):
                        if ref not in attributes:
                            errors.append(f"{name}:{resource_id} constraints.mutually_exclusive unknown attribute {ref}")
                if not _nonempty_string(constraints.get("lifecycle")):
                    errors.append(f"{name}:{resource_id} constraints.lifecycle must be non-empty")
                for inheritance_key in ("extends", "projects_to"):
                    parent = resource.get(inheritance_key)
                    if parent is not None and parent not in all_objects:
                        errors.append(f"{name}:{resource_id} unresolved {inheritance_key} {parent}")

            if section == "relation_types":
                missing_relation = sorted(set(relation_contract.get("required") or []) - set(resource))
                if missing_relation:
                    errors.append(f"{name}:{resource_id} relation missing {missing_relation}")
                for side in ("source_types", "target_types"):
                    endpoints = resource.get(side)
                    if not _list_of_nonempty_strings(endpoints, allow_empty=False):
                        errors.append(f"{name}:{resource_id} {side} must be non-empty string list")
                        endpoints = []
                    for endpoint in endpoints:
                        if endpoint not in all_objects:
                            errors.append(f"{name}:{resource_id} dangling endpoint {endpoint}")
                for side in ("source_cardinality", "target_cardinality"):
                    if resource.get(side) not in cardinalities:
                        errors.append(f"{name}:{resource_id} invalid {side} {resource.get(side)!r}")
                if resource.get("direction") not in allowed_directions:
                    errors.append(f"{name}:{resource_id} invalid direction {resource.get('direction')!r}")
                for key in ("symmetric", "transitive", "evidence_required", "temporal"):
                    if type(resource.get(key)) is not bool:
                        errors.append(f"{name}:{resource_id} {key} must be boolean")
                if resource.get("invalidation_policy") not in invalidation_policies:
                    errors.append(f"{name}:{resource_id} invalid invalidation_policy")
                attributes = resource.get("attributes")
                if not isinstance(attributes, dict):
                    errors.append(f"{name}:{resource_id} relation attributes must be mapping")
                else:
                    for attribute_name, attribute in attributes.items():
                        validate_attribute(f"{name}:{resource_id}.attributes.{attribute_name}", attribute)
                inverse_id = resource.get("inverse_of")
                inverse = all_relations.get(inverse_id)
                if inverse is None:
                    errors.append(f"{name}:{resource_id} unresolved inverse {inverse_id}")
                else:
                    if inverse.get("inverse_of") != resource_id:
                        errors.append(f"{name}:{resource_id} inverse {inverse_id} is not reciprocal")
                    if set(resource.get("source_types") or []) != set(inverse.get("target_types") or []):
                        errors.append(f"{name}:{resource_id} inverse {inverse_id} target/source endpoints are not mirrored")
                    if set(resource.get("target_types") or []) != set(inverse.get("source_types") or []):
                        errors.append(f"{name}:{resource_id} inverse {inverse_id} source/target endpoints are not mirrored")
                    if resource.get("source_cardinality") != inverse.get("target_cardinality"):
                        errors.append(f"{name}:{resource_id} inverse {inverse_id} source cardinality is not mirrored")
                    if resource.get("target_cardinality") != inverse.get("source_cardinality"):
                        errors.append(f"{name}:{resource_id} inverse {inverse_id} target cardinality is not mirrored")
                if resource.get("symmetric") is True:
                    if resource.get("direction") != "undirected" or inverse_id != resource_id:
                        errors.append(f"{name}:{resource_id} symmetric relation must be undirected and self-inverse")

            if section in ("rules", "evidence_constraints"):
                missing_rule = sorted(set(rule_contract.get("required") or []) - set(resource))
                if missing_rule:
                    errors.append(f"{name}:{resource_id} rule missing {missing_rule}")
                if resource.get("rule_class") not in allowed_rule_classes:
                    errors.append(f"{name}:{resource_id} invalid rule_class")
                if method_id_pattern.match(resource_id):
                    errors.append(f"{name}:{resource_id} method ID leaked into formal rules")
                for key in ("applies_to", "input_types", "output_types"):
                    refs = resource.get(key)
                    if not _list_of_nonempty_strings(refs, allow_empty=False):
                        errors.append(f"{name}:{resource_id} rule {key} must be non-empty string list")
                        refs = []
                    for ref in refs:
                        if ref not in set(all_objects) | PSEUDO_TYPES:
                            errors.append(f"{name}:{resource_id} unresolved rule type {ref}")
                if not _list_of_nonempty_strings(resource.get("preconditions"), allow_empty=False):
                    errors.append(f"{name}:{resource_id} rule preconditions must be non-empty")
                if not _nonempty_string(resource.get("condition")):
                    errors.append(f"{name}:{resource_id} rule condition must be non-empty")
                if not _list_of_nonempty_strings(resource.get("counter_conditions"), allow_empty=False):
                    errors.append(f"{name}:{resource_id} rule counter_conditions must be non-empty")
                for key in ("failure_result", "priority"):
                    if not _nonempty_string(resource.get(key)):
                        errors.append(f"{name}:{resource_id} rule {key} must be non-empty")
                cases = resource.get("test_cases")
                if not isinstance(cases, list) or len(cases) < 2:
                    errors.append(f"{name}:{resource_id} rule requires at least positive and negative test_cases")
                    cases = []
                seen_positive = False
                seen_negative = False
                for index, case in enumerate(cases, 1):
                    case_path = f"{name}:{resource_id} test_cases[{index}]"
                    if not isinstance(case, dict):
                        errors.append(f"{case_path} must be mapping")
                        continue
                    if not _nonempty_string(case.get("id")):
                        errors.append(f"{case_path} id must be non-empty")
                    if not isinstance(case.get("input"), dict) or not case.get("input"):
                        errors.append(f"{case_path} requires concrete non-empty input")
                    expected = case.get("expected")
                    if not _nonempty_string(expected):
                        errors.append(f"{case_path} expected must be non-empty")
                    else:
                        normalized = expected.lower()
                        seen_positive |= normalized in POSITIVE_RESULTS
                        seen_negative |= normalized in NEGATIVE_RESULTS
                if cases and not seen_positive:
                    errors.append(f"{name}:{resource_id} rule test_cases missing positive expected result")
                if cases and not seen_negative:
                    errors.append(f"{name}:{resource_id} rule test_cases missing negative expected result")

        for scenario_id, scenario in (schema.get("scenario_types") or {}).items():
            missing_scenario = sorted(set(scenario_contract.get("required") or []) - set(scenario))
            if missing_scenario:
                errors.append(f"{name}:{scenario_id} scenario missing {missing_scenario}")
            for key in set(scenario_contract.get("required") or []) - {"metadata"}:
                if not _list_of_nonempty_strings(scenario.get(key), allow_empty=False):
                    errors.append(f"{name}:{scenario_id} scenario {key} must be non-empty string list")
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

    # A fact may support a signal, hypothesis or judgment unit, never a final
    # Judgment directly.  This is structural and cannot be waived by a rule.
    for relation_id, relation in all_relations.items():
        sources = relation.get("source_types") or []
        targets = relation.get("target_types") or []
        if any("EvidenceFact" in ancestors(source) for source in sources if source in all_objects) and any(
            "Judgment" in ancestors(target) for target in targets if target in all_objects
        ):
            errors.append(f"{relation_id}: forbidden direct EvidenceFact->Judgment relation")

    extension_resources = _resources(extension)
    for section, resource_id, resource in extension_resources:
        if resource_id in core_ids:
            errors.append(f"semiconductor:{resource_id} redefines core ID")
        if section == "object_types":
            projections = [resource.get(key) for key in ("extends", "projects_to") if resource.get(key)]
            if not projections or not (ancestors(resource_id) & core_object_ids):
                errors.append(f"semiconductor:{resource_id} must transitively extend/project to core object")
        if section == "relation_types":
            if "subproperty_of" not in resource:
                errors.append(f"semiconductor:{resource_id} must declare subproperty_of")
            parent_id = resource.get("subproperty_of")
            if parent_id is None:
                if not _nonempty_string(resource.get("subproperty_rationale")):
                    errors.append(f"semiconductor:{resource_id} independent relation must explain subproperty_rationale")
            else:
                parent = all_relations.get(parent_id)
                if parent_id not in core_ids or parent is None:
                    errors.append(f"semiconductor:{resource_id} unresolved core subproperty_of {parent_id}")
                elif not endpoint_compatible(resource.get("source_types"), parent.get("source_types")) or not endpoint_compatible(
                    resource.get("target_types"), parent.get("target_types")
                ):
                    errors.append(f"semiconductor:{resource_id} subproperty endpoints incompatible with {parent_id}")

    event_taxonomy = extension.get("event_taxonomy")
    if not isinstance(event_taxonomy, dict):
        errors.append("semiconductor:event_taxonomy must be a mapping")
    else:
        if event_taxonomy.get("extends_object") != "Event":
            errors.append("semiconductor:event_taxonomy must declare extends_object: Event")
        if event_taxonomy.get("extends_attribute") != "event_type":
            errors.append("semiconductor:event_taxonomy must declare extends_attribute: event_type")
        allowed_extensions = event_taxonomy.get("allowed_extensions")
        taxonomy = event_taxonomy.get("event_type_taxonomy")
        if not _list_of_nonempty_strings(allowed_extensions, allow_empty=False):
            errors.append("semiconductor:event_taxonomy.allowed_extensions must be non-empty string list")
            allowed_extensions = []
        if len(allowed_extensions) != len(set(allowed_extensions)):
            errors.append("semiconductor:event_taxonomy.allowed_extensions contains duplicate event ID")
        for event_id in allowed_extensions:
            if not ID_RE.fullmatch(event_id):
                errors.append(f"semiconductor:event_taxonomy invalid event ID {event_id!r}")
        if not isinstance(taxonomy, dict) or not taxonomy or not all(
            _nonempty_string(key) and _nonempty_string(value) for key, value in taxonomy.items()
        ):
            errors.append("semiconductor:event_taxonomy.event_type_taxonomy must map event IDs to labels")
            taxonomy = {}
        if set(allowed_extensions) != set(taxonomy):
            errors.append("semiconductor:event_taxonomy allowed_extensions and taxonomy keys must match")
        event_type = ((all_objects.get("Event") or {}).get("attributes") or {}).get("event_type") or {}
        if event_type.get("type") != "enum" or not _list_of_nonempty_strings(event_type.get("allowed_values"), allow_empty=False):
            errors.append("semiconductor:event_taxonomy cannot extend non-enum Event.event_type")
        elif set(allowed_extensions) & set(event_type.get("allowed_values") or []):
            errors.append("semiconductor:event_taxonomy extension IDs must not duplicate core Event.event_type values")

    contract = public_contract or load_yaml(PUBLIC_CONTRACT)
    propagation = contract.get("object_validity_propagation") or {}
    formal_contract_types = set(propagation.get("formal_object_types") or [])
    runtime_projection_types = set(propagation.get("runtime_projection_types") or [])
    missing_formal_types = sorted(formal_contract_types - set(all_objects))
    if missing_formal_types:
        errors.append(f"public_contract unresolved formal object types {missing_formal_types}")
    leaked_runtime_types = sorted(runtime_projection_types & set(all_objects))
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
                    errors.append(f"public_contract dependency_order[{index}] unresolved object type {object_type}")

    return errors


def load_default_bundle() -> tuple[dict[str, dict[str, Any]], dict[str, Any], dict[str, Any]]:
    models = {name.removesuffix(".yaml"): load_yaml(MODEL_DIR / name) for name in MODEL_FILES}
    return models, load_yaml(EXTENSION), load_yaml(CORE_DIR / "meta_schema.yaml")


def validate_migration_ledger(
    ledger: dict[str, Any],
    models: dict[str, dict[str, Any]],
    extension: dict[str, Any],
) -> list[str]:
    """Validate the direct-to-latest retirement ledger kept after legacy files are removed."""
    errors: list[str] = []
    expected_header = {
        "status": "completed",
        "migration_mode": "direct-to-latest",
        "source_status": "removed_after_migration",
        "target_ontology_version": "3.0.0",
    }
    for field, expected in expected_header.items():
        if ledger.get(field) != expected:
            errors.append(f"migration ledger {field} must be {expected!r}")

    if ledger.get("generated_from") != ["embedded_inventory"]:
        errors.append("migration ledger must use embedded_inventory after source retirement")
    baseline = ledger.get("current_baseline") or []
    if not isinstance(baseline, list) or not baseline:
        errors.append("migration ledger current_baseline must be non-empty")
    else:
        for relative in baseline:
            if not isinstance(relative, str) or not (ROOT / relative).exists():
                errors.append(f"migration ledger unresolved current_baseline {relative!r}")

    allowed = {"keep", "merge", "move-to-methods", "move-to-runtime", "deprecate"}
    if set(ledger.get("classification_values") or []) != allowed:
        errors.append("migration ledger classification_values mismatch")
    defaults = ledger.get("default_classification") or {}
    section_map = {
        "object_types": "object_types",
        "relation_types": "relation_types",
        "action_types": "action_types",
        "functions": "functions",
        "logic_flows": "logic_flows",
        "rules": "rules",
    }
    inventory = ledger.get("inventory") or {}
    expected_counts = ledger.get("expected_counts") or {}
    for section in section_map:
        entry = defaults.get(section) if isinstance(defaults, dict) else None
        if not isinstance(entry, dict) or entry.get("classification") not in allowed:
            errors.append(f"migration ledger default {section} missing valid classification")
        elif entry.get("classification") != "keep" and not entry.get("replaced_by"):
            errors.append(f"migration ledger default {section} missing replaced_by")
        actual = sum(
            len(source.get(section) or [])
            for source in inventory.values()
            if isinstance(source, dict)
        ) if isinstance(inventory, dict) else 0
        if expected_counts.get(section) != actual:
            errors.append(f"migration ledger {section} count {actual} != {expected_counts.get(section)}")

    formal_objects = set(extension.get("object_types") or {})
    formal_relations = set(extension.get("relation_types") or {})
    for model in models.values():
        formal_objects.update(model.get("object_types") or {})
        formal_relations.update(model.get("relation_types") or {})
    overrides = ledger.get("overrides") or {}
    keep_objects = (overrides.get("keep_objects") or {}).get("ids") or []
    for object_id in keep_objects:
        if object_id not in formal_objects:
            errors.append(f"migration ledger kept object does not resolve: {object_id}")
    for old_id, replacement in ((overrides.get("merged_objects") or {}).get("mapping") or {}).items():
        if not _nonempty_string(old_id) or replacement not in formal_objects:
            errors.append(f"migration ledger merged object replacement unresolved: {old_id}->{replacement}")
    for old_id, replacement in ((overrides.get("keep_relations") or {}).get("mapping") or {}).items():
        if not _nonempty_string(old_id) or replacement not in formal_relations:
            errors.append(f"migration ledger kept relation replacement unresolved: {old_id}->{replacement}")

    retirement = ledger.get("retirement_policy") or {}
    for field in ("legacy_samples_retained", "legacy_publish_compatible", "legacy_source_files_retained"):
        if retirement.get(field) is not False:
            errors.append(f"migration ledger retirement_policy.{field} must be false")
    if (ROOT / "instances/01_正式样例").exists():
        errors.append("legacy sample directory must be removed after direct-to-latest migration")
    return errors


def main() -> int:
    models, extension, meta = load_default_bundle()
    errors = validate_bundle(models, extension, meta)
    if not MIGRATION_LEDGER.exists():
        errors.append("migration ledger is missing")
    else:
        errors.extend(validate_migration_ledger(load_yaml(MIGRATION_LEDGER), models, extension))
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        print(f"ONTOLOGY_V3_RETURN_REQUIRED: {len(errors)} error(s)")
        return 1
    object_count = sum(len(model.get("object_types") or {}) for model in models.values()) + len(extension.get("object_types") or {})
    relation_count = sum(len(model.get("relation_types") or {}) for model in models.values()) + len(extension.get("relation_types") or {})
    print(f"ONTOLOGY_V3_PASS: five models + semiconductor extension; objects={object_count}, relations={relation_count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
