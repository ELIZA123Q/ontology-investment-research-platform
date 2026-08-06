"""Detect which research package layout a run directory uses.

Routing authority is 05_governance/02_合同/package_kinds.yaml#routing_rules.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[2]
PACKAGE_KINDS_PATH = ROOT / "05_governance/02_合同/package_kinds.yaml"

KIND_FORMAL = "formal_pack"
KIND_AUDIT = "research_audit_pack"
KIND_DELIVERY = "formal_delivery_pack"
KIND_KNOWLEDGE_BASELINE = "knowledge_baseline"
KIND_KNOWLEDGE_TASK = "knowledge_task_slice"
KIND_V3 = "semantic_fixture"
KIND_WORKBENCH = "workbench_export"
KIND_UNKNOWN = "unknown"

VALIDATORS = {
    KIND_FORMAL: "05_governance/03_校验/validate_run.py",
    KIND_AUDIT: "05_governance/03_校验/validate_run.py",
    KIND_DELIVERY: "07_runtime/engine/release_set.ts",
    KIND_KNOWLEDGE_BASELINE: "07_runtime/engine/knowledge_package.ts",
    KIND_KNOWLEDGE_TASK: "07_runtime/engine/knowledge_package.ts",
    KIND_V3: "05_governance/03_校验/validate_v3_samples.py",
    KIND_WORKBENCH: "05_governance/03_校验/validate_workbench_package.py",
}


def _load_manifest(run_dir: Path) -> dict[str, Any] | None:
    path = run_dir / "run_manifest.yaml"
    if not path.is_file():
        return None
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    return data if isinstance(data, dict) else None


def _load_routing_rules() -> list[dict[str, Any]]:
    data = yaml.safe_load(PACKAGE_KINDS_PATH.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        return []
    rules = data.get("routing_rules") or []
    return [rule for rule in rules if isinstance(rule, dict)]


def _files_all_present(run_dir: Path, names: list[str]) -> bool:
    return all((run_dir / name).is_file() for name in names)


def _match_rule(rule: dict[str, Any], run_dir: Path, manifest: dict[str, Any]) -> str | None:
    package_kinds = rule.get("if_manifest_package_kind_in")
    if package_kinds is not None:
        current = str(manifest.get("package_kind") or "")
        return current if current in {str(item) for item in package_kinds} else None

    kind = str(rule.get("then") or "")
    if kind not in {KIND_FORMAL, KIND_AUDIT, KIND_DELIVERY, KIND_KNOWLEDGE_BASELINE, KIND_KNOWLEDGE_TASK, KIND_V3, KIND_WORKBENCH}:
        return None

    schema_name = rule.get("if_manifest_schema_name")
    if schema_name is not None:
        return kind if str(manifest.get("schema_name") or "") == str(schema_name) else None

    glob_pattern = rule.get("if_glob")
    if glob_pattern is not None:
        return kind if any(run_dir.glob(str(glob_pattern))) else None

    files_all = rule.get("if_files_all")
    if files_all is not None:
        if not isinstance(files_all, list) or not _files_all_present(run_dir, [str(name) for name in files_all]):
            return None
        run_mode = rule.get("and_manifest_run_mode")
        if run_mode is not None and str(manifest.get("run_mode") or "") != str(run_mode):
            return None
        return kind

    return None


def detect_package_kind(run_dir: str | Path) -> str:
    run_dir = Path(run_dir).resolve()
    if not run_dir.is_dir():
        return KIND_UNKNOWN

    manifest = _load_manifest(run_dir) or {}
    for rule in _load_routing_rules():
        matched = _match_rule(rule, run_dir, manifest)
        if matched:
            return matched
    return KIND_UNKNOWN


def redirect_message(kind: str, run_dir: Path) -> str:
    validator = VALIDATORS.get(kind, "")
    return (
        f"{run_dir} 是 {kind} 包，不能用当前校验入口处理。"
        f"请改用: python3 {validator} {run_dir}"
    )
