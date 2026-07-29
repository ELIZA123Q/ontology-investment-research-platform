#!/usr/bin/env python3
"""校验本体元治理控制面边界、资产权威和变更发布生命周期。"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import yaml


ROOT = Path(__file__).resolve().parents[2]
CONTRACT = ROOT / "governance/02_合同/governance_control_contract.yaml"
ASSET_REGISTRY = ROOT / "governance/02_合同/governed_asset_registry.yaml"
CONSUMER_REGISTRY = ROOT / "governance/02_合同/ontology_consumer_registry.yaml"
MODEL_REGISTRY = ROOT / "ontology/01_通用/model_registry.yaml"
PUBLIC_CONTRACT = ROOT / "governance/02_合同/public_contract.yaml"

REQUIRED_ASSETS = {
    "governance.control_contract",
    "governance.asset_registry",
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
REQUIRED_RELEASE_GATES = {
    "target_resolves",
    "impact_assessment_frozen",
    "required_checks_pass",
    "breaking_change_has_migration",
    "release_fingerprint_bound",
    "governance_cannot_support_judgment",
}
REQUIRED_CHANGE_PATH = [
    "proposed",
    "impact_assessed",
    "approved",
    "implemented",
    "validated",
    "released",
]
SEMVER = re.compile(r"^\d+\.\d+\.\d+$")


def load(path: Path) -> dict[str, Any]:
    value = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path}: YAML root must be a mapping")
    return value


def formal_element_ids(model_registry: dict[str, Any]) -> set[str]:
    ids: set[str] = set()
    for raw_path in model_registry.get("model_files") or []:
        path = MODEL_REGISTRY.parent / str(raw_path)
        document = load(path)
        for section in ("object_types", "relation_types", "rules", "scenario_types", "evidence_constraints"):
            ids.update(map(str, (document.get(section) or {}).keys()))
    return ids


def _has_path(transitions: dict[str, list[str]], expected: list[str]) -> bool:
    return all(right in transitions.get(left, []) for left, right in zip(expected, expected[1:]))


def validate_governance_control_plane(
    contract: dict[str, Any],
    asset_registry: dict[str, Any],
    consumer_registry: dict[str, Any],
    model_registry: dict[str, Any],
    public_contract: dict[str, Any],
    *,
    root: Path = ROOT,
    known_formal_ids: set[str] | None = None,
) -> list[str]:
    errors: list[str] = []
    if contract.get("schema_name") != "ontology_governance_control_contract":
        errors.append("governance control contract schema_name mismatch")
    if contract.get("status") != "active":
        errors.append("governance control contract must be active")
    if contract.get("decision") != "control_plane_not_formal_ontology_domain":
        errors.append("governance control plane decision must reject a fourth formal ontology domain")

    boundary = contract.get("boundary") or {}
    if boundary.get("control_plane_root") != "governance":
        errors.append("governance control plane must stay under governance/")
    for field in (
        "formal_ontology_model_registered",
        "business_instance_projection_allowed",
        "commercial_rule_evaluation_allowed",
        "workflow_or_permission_semantics_in_formal_ontology_allowed",
    ):
        if boundary.get(field) is not False:
            errors.append(f"governance boundary {field} must be false")

    registered_models = list(map(str, model_registry.get("model_files") or []))
    if any("governance" in path.lower() or "治理" in path for path in registered_models):
        errors.append("formal ontology model registry must not register governance models")
    formal_ids = known_formal_ids if known_formal_ids is not None else formal_element_ids(model_registry)
    leaked_governance_objects = sorted(set(map(str, (contract.get("governance_object_types") or {}).keys())) & formal_ids)
    if leaked_governance_objects:
        errors.append(f"governance object types leaked into formal ontology: {leaked_governance_objects}")

    candidate_review = contract.get("candidate_review") or {}
    candidate_statuses = list(map(str, candidate_review.get("statuses") or []))
    if candidate_statuses != ["pending", "expert_confirmed", "promoted", "rejected"]:
        errors.append("candidate review statuses must preserve the legacy-compatible four-state contract")
    promoted_semantics = str(candidate_review.get("promoted_semantics") or "")
    if "不表示" not in promoted_semantics or "ChangeProposal" not in promoted_semantics:
        errors.append("promoted must explicitly mean change proposal accepted, not formally released")

    change_request = contract.get("change_request") or {}
    statuses = list(map(str, change_request.get("statuses") or []))
    transitions = {
        str(status): list(map(str, targets or []))
        for status, targets in (change_request.get("transitions") or {}).items()
    }
    if set(transitions) != set(statuses):
        errors.append("change request transitions must cover every status exactly once")
    for status, targets in transitions.items():
        unresolved = sorted(set(targets) - set(statuses))
        if unresolved:
            errors.append(f"change request {status} has unresolved transitions: {unresolved}")
        if status in targets:
            errors.append(f"change request {status} must not self-transition")
    if change_request.get("initial_status") != "proposed":
        errors.append("change request initial status must be proposed")
    if set(map(str, change_request.get("terminal_statuses") or [])) != {"released", "rejected"}:
        errors.append("change request terminal statuses must be released/rejected")
    if transitions.get("released") or transitions.get("rejected"):
        errors.append("released/rejected change requests must be terminal")
    if not _has_path(transitions, REQUIRED_CHANGE_PATH):
        errors.append("change request lifecycle must not skip impact, approval, implementation or validation")
    if change_request.get("history_policy") != "append_only":
        errors.append("change request history must be append_only")
    if change_request.get("historical_result_policy") != "impact_only_no_silent_rewrite":
        errors.append("ontology changes must not silently rewrite historical research results")

    release_gate_ids = {
        str(item.get("id"))
        for item in contract.get("release_gates") or []
        if isinstance(item, dict)
    }
    if release_gate_ids != REQUIRED_RELEASE_GATES:
        errors.append(
            "release gates drift "
            f"missing={sorted(REQUIRED_RELEASE_GATES - release_gate_ids)} "
            f"extra={sorted(release_gate_ids - REQUIRED_RELEASE_GATES)}"
        )

    if asset_registry.get("schema_name") != "governed_asset_registry" or asset_registry.get("status") != "active":
        errors.append("governed asset registry schema_name/status mismatch")
    roles = set(map(str, (asset_registry.get("owner_roles") or {}).keys()))
    profiles = asset_registry.get("validation_profiles") or {}
    consumer_ids = {
        str(item.get("id"))
        for item in consumer_registry.get("consumers") or []
        if isinstance(item, dict)
    }
    asset_ids: set[str] = set()
    authority_refs: set[str] = set()
    for index, asset in enumerate(asset_registry.get("assets") or []):
        label = f"assets[{index}]"
        if not isinstance(asset, dict):
            errors.append(f"{label} must be a mapping")
            continue
        asset_id = str(asset.get("id") or "")
        if not asset_id or asset_id in asset_ids:
            errors.append(f"{label} has empty or duplicate id {asset_id}")
        asset_ids.add(asset_id)
        owner_role = str(asset.get("owner_role") or "")
        if owner_role not in roles:
            errors.append(f"{asset_id} has unresolved owner_role {owner_role}")
        authority_ref = str(asset.get("authority_ref") or "")
        if not authority_ref or authority_ref in authority_refs:
            errors.append(f"{asset_id} has empty or duplicate authority_ref {authority_ref}")
        authority_refs.add(authority_ref)
        if authority_ref and not (root / authority_ref).exists():
            errors.append(f"{asset_id} authority_ref does not exist: {authority_ref}")
        if str(asset.get("status") or "") not in {"active", "deprecated"}:
            errors.append(f"{asset_id} has invalid status")
        if not SEMVER.match(str(asset.get("version") or "")):
            errors.append(f"{asset_id} version must be semantic x.y.z")
        profile = str(asset.get("validation_profile") or "")
        if profile not in profiles:
            errors.append(f"{asset_id} has unresolved validation_profile {profile}")
        unresolved_consumers = sorted(set(map(str, asset.get("consumers") or [])) - consumer_ids)
        if unresolved_consumers:
            errors.append(f"{asset_id} has unresolved consumers {unresolved_consumers}")

    if not REQUIRED_ASSETS.issubset(asset_ids):
        errors.append(f"governed asset registry missing required assets: {sorted(REQUIRED_ASSETS - asset_ids)}")
    for profile_id, profile in profiles.items():
        if not isinstance(profile, dict) or not profile.get("required_checks"):
            errors.append(f"validation profile {profile_id} must declare required_checks")

    notes = "\n".join(map(str, (public_contract.get("ownership") or {}).get("notes") or []))
    if "不新建治理域本体" not in notes:
        errors.append("public contract must preserve the no-governance-domain boundary")
    return errors


def main() -> int:
    errors = validate_governance_control_plane(
        load(CONTRACT),
        load(ASSET_REGISTRY),
        load(CONSUMER_REGISTRY),
        load(MODEL_REGISTRY),
        load(PUBLIC_CONTRACT),
    )
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        print(f"GOVERNANCE_CONTROL_PLANE_RETURN_REQUIRED: {len(errors)} error(s)")
        return 1
    print(
        "GOVERNANCE_CONTROL_PLANE_PASS: control-plane boundary, governed assets, "
        "candidate/change lifecycle and release gates are consistent."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
