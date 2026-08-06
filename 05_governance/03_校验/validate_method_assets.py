#!/usr/bin/env python3
"""校验统一方法资产合同、版本权威和跨库路由。"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import yaml


ROOT = Path(__file__).resolve().parents[2]
ASSET_PATH = ROOT / "90_compat/methods/00_登记/method_assets.yaml"
STRUCTURE_PATH = ROOT / "90_compat/methods/02_研究框架/registry.yaml"
EVIDENCE_PATH = ROOT / "90_compat/methods/03_取证/03_registry.yaml"
ROUTE_PATH = ROOT / "05_governance/02_合同/judgment_method_routes.yaml"

EXPECTED_VERSIONS = {
    "judgment_structure": "2.0.0",
    "evidence": "3.2.0",
    "adjudication": "1.0.0",
}
EXPECTED_REQUIRED_FIELDS = {
    "applicability",
    "preconditions",
    "inputs",
    "outputs",
    "not_applicable_when",
    "degrade_policy",
    "alternatives",
    "counter_examples",
}


def load(path: Path) -> dict[str, Any]:
    value = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path}: YAML root must be a mapping")
    return value


def _nonempty(value: Any) -> bool:
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, dict)):
        return bool(value)
    return value is not None


def build_method_catalog(
    assets: dict[str, Any],
    structure: dict[str, Any],
    evidence: dict[str, Any],
) -> tuple[dict[str, dict[str, Any]], list[str]]:
    errors: list[str] = []
    catalog: dict[str, dict[str, Any]] = {}
    groups = assets.get("groups") or {}

    def register(method_id: str, definition: dict[str, Any]) -> None:
        if method_id in catalog:
            errors.append(f"duplicate method id: {method_id}")
        catalog[method_id] = definition

    structure_group = groups.get("judgment_structure") or {}
    for section in ("frameworks", "industry_overlays"):
        for method_id, item in (structure.get(section) or {}).items():
            if not isinstance(item, dict):
                errors.append(f"{section}.{method_id} must be a mapping")
                continue
            register(method_id, {
                "method_id": method_id,
                "method_version": str(structure_group.get("version", "")),
                "capability_type": "judgment_structure",
                "source_ref": f"{structure_group.get('registry_ref')}#{section}.{method_id}",
                "file": structure_group.get("registry_ref"),
                "applicability": item.get("entry_requires"),
                "preconditions": item.get("entry_requires"),
                "inputs": item.get("entry_requires"),
                "outputs": list((item.get("output_gates") or {}).keys()),
                "not_applicable_when": ["entry_requirements_unmet"],
                "degrade_policy": "output_gate_failed_blocks_that_output; quality_gate_failed_caps_precision",
                "alternatives": list(item.get("downstream_unlocks") or [])
                    + list((item.get("boundary_handoffs") or {}).values()),
                "counter_examples": [
                    "attempt_output_without_gate",
                    "cross_framework_conclusion_without_handoff",
                ],
            })

    evidence_group = groups.get("evidence") or {}
    for local_id, item in (evidence.get("methods") or {}).items():
        if not isinstance(item, dict):
            errors.append(f"methods.{local_id} must be a mapping")
            continue
        method_id = f"kb03:{local_id}"
        contract = item.get("contract") or {}
        register(method_id, {
            "method_id": method_id,
            "method_version": str(evidence_group.get("version", "")),
            "capability_type": "evidence",
            "source_ref": f"{evidence_group.get('registry_ref')}#methods.{local_id}",
            "file": f"90_compat/methods/03_取证/{item.get('file', '')}",
            **{field: contract.get(field) for field in EXPECTED_REQUIRED_FIELDS},
        })

    adjudication_group = groups.get("adjudication") or {}
    for item in adjudication_group.get("methods") or []:
        if not isinstance(item, dict) or not item.get("id"):
            errors.append("adjudication method must have id")
            continue
        method_id = str(item["id"])
        register(method_id, {
            "method_id": method_id,
            "method_version": str(adjudication_group.get("version", "")),
            "capability_type": "adjudication",
            "source_ref": f"90_compat/methods/00_登记/method_assets.yaml#groups.adjudication.methods.{method_id}",
            "file": item.get("file"),
            **{field: item.get(field) for field in EXPECTED_REQUIRED_FIELDS},
        })
    return catalog, errors


def validate_method_assets_data(
    assets: dict[str, Any],
    structure: dict[str, Any],
    evidence: dict[str, Any],
    routes: dict[str, Any],
    *,
    root: Path = ROOT,
    check_files: bool = True,
) -> list[str]:
    errors: list[str] = []
    if str(assets.get("schema_version")) != "1.1.0":
        errors.append("method_assets schema_version must be 1.1.0")
    contract = assets.get("method_definition_contract") or {}
    if str(contract.get("schema_version")) != "1.0.0":
        errors.append("method definition contract must be 1.0.0")
    if set(contract.get("required_fields") or []) != EXPECTED_REQUIRED_FIELDS:
        errors.append("method definition contract required_fields is incomplete")

    groups = assets.get("groups") or {}
    for group_name, version in EXPECTED_VERSIONS.items():
        if str((groups.get(group_name) or {}).get("version")) != version:
            errors.append(f"{group_name} version must be {version}")
    if str(structure.get("schema_version")) != EXPECTED_VERSIONS["judgment_structure"]:
        errors.append("kb02 registry version must exactly match 2.0.0")
    if str(evidence.get("schema_version")) != EXPECTED_VERSIONS["evidence"]:
        errors.append("kb03 registry version must exactly match 3.2.0")

    catalog, catalog_errors = build_method_catalog(assets, structure, evidence)
    errors.extend(catalog_errors)
    expected_counts = {"judgment_structure": 23, "evidence": 9, "adjudication": 11}
    for capability, expected in expected_counts.items():
        actual = sum(item["capability_type"] == capability for item in catalog.values())
        if actual != expected:
            errors.append(f"{capability} method count must be {expected}, got {actual}")

    for method_id, item in catalog.items():
        for field in EXPECTED_REQUIRED_FIELDS | {
            "method_id", "method_version", "capability_type", "source_ref"
        }:
            if field == "alternatives":
                if field not in item or not isinstance(item.get(field), list):
                    errors.append(f"{method_id} missing method contract field {field}")
                continue
            if not _nonempty(item.get(field)):
                errors.append(f"{method_id} missing method contract field {field}")
        if check_files:
            file_ref = item.get("file")
            if not file_ref or not (root / str(file_ref)).is_file():
                errors.append(f"{method_id} source file does not resolve: {file_ref}")

    knowledge_versions = routes.get("knowledge_versions") or {}
    route_version_map = {
        "kb02": EXPECTED_VERSIONS["judgment_structure"],
        "kb03": EXPECTED_VERSIONS["evidence"],
        "kb04": EXPECTED_VERSIONS["adjudication"],
    }
    for key, expected in route_version_map.items():
        if str(knowledge_versions.get(key)) != expected:
            errors.append(f"route knowledge version {key} must be {expected}")

    global_optional = routes.get("global_optional_reasoning_methods") or []
    for method_id in global_optional:
        if method_id not in catalog:
            errors.append(f"global optional method is not registered: {method_id}")
        elif catalog[method_id]["capability_type"] != "adjudication":
            errors.append(f"global optional method must be adjudication: {method_id}")

    for judgment_type, route in (routes.get("routes") or {}).items():
        if not isinstance(route, dict):
            errors.append(f"route {judgment_type} must be a mapping")
            continue
        lists = {
            "allowed_kb03_methods": "evidence",
            "allowed_kb04_methods": "adjudication",
            "optional_auxiliary_methods": "adjudication",
        }
        for field, capability in lists.items():
            for method_id in route.get(field) or []:
                item = catalog.get(method_id)
                if not item:
                    errors.append(f"route {judgment_type} references unknown method {method_id}")
                elif item["capability_type"] != capability:
                    errors.append(
                        f"route {judgment_type} method {method_id} capability must be {capability}"
                    )
        defaults = (
            ("default_kb03_method", "allowed_kb03_methods"),
            ("default_kb04_method", "allowed_kb04_methods"),
        )
        for default_field, allowed_field in defaults:
            default = route.get(default_field)
            if default not in (route.get(allowed_field) or []):
                errors.append(f"route {judgment_type} {default_field} must be allowed")
    return errors


def main() -> int:
    errors = validate_method_assets_data(
        load(ASSET_PATH), load(STRUCTURE_PATH), load(EVIDENCE_PATH), load(ROUTE_PATH)
    )
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        print(f"METHOD_ASSETS_RETURN_REQUIRED: {len(errors)} error(s)")
        return 1
    print("METHOD_ASSETS_PASS: 43 methods; kb02=2.0.0, kb03=3.2.0, kb04=1.0.0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
