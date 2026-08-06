#!/usr/bin/env python3
"""Validate the incremental update contract and both V3 exercises."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any

import yaml


ROOT = Path(__file__).resolve().parents[2]
CONTRACT_PATH = ROOT / "05_governance/02_合同/public_contract.yaml"


def load(path: Path) -> dict[str, Any]:
    value = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path}: YAML root must be a mapping")
    return value


def validate_contract_data(public: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    contract = public.get("incremental_update_contract") or {}
    if str(contract.get("schema_version")) != "1.1.0":
        errors.append("incremental update contract version must be 1.1.0")
    required = {
        "update_id", "new_evidence", "changed_roots", "direct_impacts",
        "propagation_edges", "affected_graph", "recompute_stages",
        "structural_checkpoint_required", "full_rerun_required", "expected_judgment_change",
    }
    if set(contract.get("required_fields") or []) != required:
        errors.append("incremental update required fields are incomplete")
    if set(contract.get("propagation_edge_required_fields") or []) != {"source_ref", "target_ref", "dependency_type"}:
        errors.append("propagation edge fields are incomplete")
    rules = "\n".join(contract.get("rules") or [])
    for phrase in ("可达闭包", "remains_current", "full_rerun_required", "共享上游对象"):
        if phrase not in rules:
            errors.append(f"incremental update contract missing rule: {phrase}")
    return errors


def load_run(run_dir: Path) -> dict[str, dict[str, Any]]:
    return {
        "structure": load(run_dir / "02_structure.yaml"),
        "evidence": load(run_dir / "03_evidence.yaml"),
        "judgment": load(run_dir / "04_judgment.yaml"),
        "expression": load(run_dir / "05_expression.yaml"),
        "update": load(run_dir / "incremental_update.yaml"),
    }


def main() -> int:
    errors = validate_contract_data(load(CONTRACT_PATH))
    from incremental_update import validate_incremental_update
    for run_dir in sorted((ROOT / "90_compat/instances/02_V3样例").iterdir()):
        if run_dir.is_dir():
            errors.extend(f"{run_dir.name}: {error}" for error in validate_incremental_update(load_run(run_dir)))
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        print(f"INCREMENTAL_UPDATE_CONTRACT_RETURN_REQUIRED: {len(errors)} error(s)")
        return 1
    print("INCREMENTAL_UPDATE_CONTRACT_PASS: direct impacts + reachable closure + local recompute")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
