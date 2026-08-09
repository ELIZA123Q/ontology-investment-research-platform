#!/usr/bin/env python3
"""Validate the Ontology 4.0 platform registry and kinetic contracts."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


ROOT = Path(__file__).resolve().parent
REGISTRY = ROOT / "platform_registry.yaml"
FORBIDDEN_ACTION_TERMS = ("trade", "order", "position", "rating", "targetprice", "交易", "下单", "仓位", "评级", "目标价")


def load(path: Path) -> dict[str, Any]:
    value = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path}: root must be a mapping")
    return value


def validate() -> list[str]:
    errors: list[str] = []
    registry = load(REGISTRY)
    meta = load(ROOT / str(registry.get("meta_schema")))
    if registry.get("schema_version") != "4.0.0" or meta.get("platform_version") != "4.0.0":
        errors.append("platform registry and meta schema must declare Ontology 4.0.0")

    semantic_paths = [ROOT / str(item) for item in registry.get("semantic_models") or []]
    operational_paths = [ROOT / str(item) for item in registry.get("operational_models") or []]
    all_models = [load(path) for path in semantic_paths + operational_paths]
    objects = {key for model in all_models for key in (model.get("object_types") or {})}
    relations = {key for model in all_models for key in (model.get("relation_types") or {})}
    objects.add("ontology_object")

    for model in [load(path) for path in operational_paths]:
        if model.get("schema_version") != "4.0.0":
            errors.append(f"{model.get('schema_name')}: operational model must be 4.0.0")
        for relation_id, relation in (model.get("relation_types") or {}).items():
            for side in ("source_types", "target_types"):
                for ref in relation.get(side) or []:
                    if ref not in objects:
                        errors.append(f"{relation_id}.{side}: unresolved object type {ref}")
            inverse = relation.get("inverse_of")
            if inverse not in relations:
                errors.append(f"{relation_id}: unresolved inverse {inverse}")

    kinetic = registry.get("kinetic_models") or {}
    action_doc = load(ROOT / str(kinetic.get("actions")))
    function_doc = load(ROOT / str(kinetic.get("functions")))
    policy_doc = load(ROOT / str(kinetic.get("policies")))
    trigger_doc = load(ROOT / str(kinetic.get("triggers")))
    actions = action_doc.get("actions") or {}
    functions = function_doc.get("functions") or {}
    policies = policy_doc.get("policies") or {}
    triggers = trigger_doc.get("triggers") or {}

    required_actions = set((meta.get("action_type_contract") or {}).get("required") or [])
    required_functions = set((meta.get("function_type_contract") or {}).get("required") or [])
    allowed_actors = set((meta.get("action_type_contract") or {}).get("actor_values") or [])
    allowed_approval = set((meta.get("action_type_contract") or {}).get("approval_modes") or [])
    handlers: set[str] = set()
    for action_id, action in actions.items():
        missing = required_actions - set(action)
        if missing:
            errors.append(f"{action_id}: missing action fields {sorted(missing)}")
        normalized = action_id.lower().replace("_", "")
        if any(term in normalized for term in FORBIDDEN_ACTION_TERMS):
            errors.append(f"{action_id}: investment execution action is forbidden")
        if not set(action.get("allowed_actors") or []).issubset(allowed_actors):
            errors.append(f"{action_id}: invalid allowed actor")
        if (action.get("approval_policy") or {}).get("mode") not in allowed_approval:
            errors.append(f"{action_id}: invalid approval mode")
        for ref in action.get("target_types") or []:
            if ref not in objects:
                errors.append(f"{action_id}: unresolved target type {ref}")
        for ref in (action.get("reads") or []) + (action.get("writes") or []):
            if ref not in objects and ref not in relations:
                errors.append(f"{action_id}: unresolved read/write type {ref}")
        function_ref = action.get("function_ref")
        if function_ref is not None and function_ref not in functions:
            errors.append(f"{action_id}: unresolved function {function_ref}")
        handler = action.get("handler")
        if handler in handlers:
            errors.append(f"{action_id}: duplicate handler {handler}")
        handlers.add(str(handler))

    for function_id, function in functions.items():
        missing = required_functions - set(function)
        if missing:
            errors.append(f"{function_id}: missing function fields {sorted(missing)}")
        if function.get("side_effects") is not False:
            errors.append(f"{function_id}: Ontology Function must be side-effect free")
        for ref in function.get("reads") or []:
            if ref not in objects:
                errors.append(f"{function_id}: unresolved read type {ref}")

    for trigger_id, trigger in triggers.items():
        if trigger.get("action_ref") not in actions:
            errors.append(f"{trigger_id}: unresolved action_ref {trigger.get('action_ref')}")
    for action_id in (policies.get("HighRiskResearcherApproval") or {}).get("applies_to") or []:
        if action_id not in actions:
            errors.append(f"HighRiskResearcherApproval: unresolved action {action_id}")

    return errors


def main() -> int:
    errors = validate()
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        print(f"ONTOLOGY_V4_INVALID: {len(errors)} error(s)")
        return 1
    print("ONTOLOGY_V4_VALID")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

