#!/usr/bin/env python3
"""01—05 可控研究链总校验入口：语义、路由、哈希、stale 与发布派生。"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import yaml

from _path_setup import ensure_run_path

ensure_run_path()

from research_contract import (  # noqa: E402
    canonical_sha256,
    claim_version_hash,
    current_versions,
    directional_conclusion_available,
    public_contract,
)
from semantic_review import validate_independent_semantic_review  # noqa: E402
from validate_publish import RunArtifacts, discover_artifacts, validate_publish  # noqa: E402
from validator_utils import artifact_sha256, load_yaml_file, parse_markdown  # noqa: E402


MANIFEST_NAME = "run_manifest.yaml"
MANIFEST_SCHEMA_VERSION = "1.1.0"
STAGES = ["stage_01", "stage_02", "stage_03", "stage_04", "stage_05"]
IMMEDIATE_UPSTREAM = {
    "stage_01": None,
    "stage_02": "stage_01",
    "stage_03": "stage_02",
    "stage_04": "stage_03",
    "stage_05": "stage_04",
}
VERSION_IMPACT = {
    "contract": STAGES,
    "ontology": STAGES[1:],
    "kb02": STAGES[1:],
    "kb03": STAGES[2:],
    "kb04": STAGES[3:],
    "stage_01_schema": STAGES,
    "stage_02_logic_schema": STAGES[1:],
    "stage_02_view_schema": STAGES[1:],
    "stage_03_schema": STAGES[2:],
    "stage_04_brief_schema": STAGES[3:],
    "stage_04_audit_schema": STAGES[3:],
    "stage_05_audit_schema": STAGES[4:],
    "semantic_review_schema": STAGES[4:],
}


def _relative(path: Path, run_dir: Path) -> str:
    return path.resolve().relative_to(run_dir.resolve()).as_posix()


def manifest_binding_hash(manifest: dict[str, Any]) -> str:
    """父子绑定只覆盖不可变身份、版本与已提交阶段哈希，排除校验结果回写。"""
    stages = {
        stage: {
            "artifact": entry.get("artifact"),
            "hash": entry.get("hash"),
            "source_hashes": entry.get("source_hashes"),
            "attempt": entry.get("attempt"),
            "supersedes_attempt": entry.get("supersedes_attempt"),
        }
        for stage, entry in (manifest.get("stages") or {}).items()
        if isinstance(entry, dict)
    }
    return canonical_sha256({
        "schema_name": manifest.get("schema_name"),
        "schema_version": manifest.get("schema_version"),
        "task_id": manifest.get("task_id"),
        "run_id": manifest.get("run_id"),
        "versions": manifest.get("versions"),
        "stages": stages,
    })


def _stage_paths(artifacts: RunArtifacts) -> dict[str, list[Path]]:
    stage_03_extra = sorted(artifacts.run_dir.glob("03-*语义域与证据域实例清单-*.yaml"))
    return {
        "stage_01": [path for path in [artifacts.requirement] if path],
        "stage_02": [path for path in [artifacts.logic, artifacts.view] if path],
        "stage_03": [path for path in [artifacts.preparation, artifacts.snapshot_dir, *stage_03_extra] if path],
        "stage_04": [path for path in [artifacts.report, artifacts.audit] if path],
        "stage_05": [path for path in [artifacts.delivery, artifacts.expression_audit] if path],
    }


def _stage_hash(paths: list[Path], run_dir: Path) -> str:
    payload = [
        {"path": _relative(path, run_dir), "hash": artifact_sha256(path)}
        for path in sorted(paths, key=lambda item: _relative(item, run_dir))
    ]
    return canonical_sha256(payload)


def _stage_status(stage: str, artifacts: RunArtifacts) -> str:
    if stage == "stage_01" and artifacts.requirement:
        return str(parse_markdown(artifacts.requirement)[0].get("stage_status", "complete"))
    if stage == "stage_02" and artifacts.view:
        view = load_yaml_file(artifacts.view)
        return str(view.get("quality_control", {}).get("stage_status", "not_started"))
    if stage == "stage_03" and artifacts.preparation:
        return str(parse_markdown(artifacts.preparation)[0].get("stage_status", "not_started"))
    if stage == "stage_04" and artifacts.audit:
        audit = load_yaml_file(artifacts.audit)
        return str(audit.get("metadata", {}).get("stage_status", "not_started"))
    if stage == "stage_05" and artifacts.expression_audit:
        audit = load_yaml_file(artifacts.expression_audit)
        return str(audit.get("metadata", {}).get("stage_status", "not_started"))
    return "not_started"


def _identity(artifacts: RunArtifacts) -> tuple[str, str]:
    if artifacts.requirement is None:
        raise ValueError("运行目录缺少 01 投研需求说明")
    task_id = str(parse_markdown(artifacts.requirement)[0].get("task_id", "")).strip()
    run_id = ""
    if artifacts.preparation:
        run_id = str(parse_markdown(artifacts.preparation)[0].get("execution_id", "")).strip()
    if not run_id and artifacts.report:
        run_id = str(parse_markdown(artifacts.report)[0].get("execution_id", "")).strip()
    if not task_id or not run_id:
        raise ValueError("无法从 01/03/04 产物解析 task_id 与 run_id")
    return task_id, run_id


def _parent_run_record(parent_manifest_path: str | Path | None, run_dir: Path) -> dict[str, str] | None:
    if parent_manifest_path is None:
        return None
    path = Path(parent_manifest_path).resolve()
    if not path.is_file():
        raise ValueError(f"父运行清单不存在: {path}")
    parent = load_yaml_file(path)
    if not isinstance(parent, dict) or not parent.get("run_id"):
        raise ValueError("父运行清单缺少 run_id")
    try:
        ref = path.relative_to(run_dir).as_posix()
    except ValueError:
        ref = str(path)
    return {
        "run_id": str(parent["run_id"]),
        "manifest_ref": ref,
        "manifest_hash": manifest_binding_hash(parent),
    }


def build_manifest(
    artifacts: RunArtifacts,
    *,
    parent_manifest_path: str | Path | None = None,
    run_mode: str = "production",
    producer_id: str = "producer",
) -> dict[str, Any]:
    contract = public_contract()
    paths_by_stage = _stage_paths(artifacts)
    task_id, run_id = _identity(artifacts)
    hashes = {
        stage: _stage_hash(paths, artifacts.run_dir) if paths else ""
        for stage, paths in paths_by_stage.items()
    }
    stages: dict[str, Any] = {}
    for stage in STAGES:
        upstream = IMMEDIATE_UPSTREAM[stage]
        stages[stage] = {
            "artifact": [_relative(path, artifacts.run_dir) for path in paths_by_stage[stage]],
            "hash": hashes[stage],
            "source_hashes": {upstream: hashes[upstream]} if upstream else {},
            "stage_status": _stage_status(stage, artifacts),
            "validity_status": "current" if paths_by_stage[stage] else "missing",
            "attempt": 1,
            "supersedes_attempt": None,
        }
    return {
        "schema_name": "controlled_research_run_manifest",
        "schema_version": MANIFEST_SCHEMA_VERSION,
        "task_id": task_id,
        "run_id": run_id,
        "parent_run": _parent_run_record(parent_manifest_path, artifacts.run_dir),
        "run_mode": run_mode,
        "producer_id": producer_id,
        "versions": current_versions(),
        "stages": stages,
        "validation_issues": [],
        "validation_summary": {
            "quality_pass": False,
            "publishable": False,
            "publish_status": "RETURN_REQUIRED",
            "judgment_level": None,
            "directional_conclusion_available": False,
            "contract_version": str(contract.get("schema_version", "")),
        },
    }


def _write_manifest(path: Path, manifest: dict[str, Any]) -> None:
    path.write_text(
        yaml.safe_dump(manifest, allow_unicode=True, sort_keys=False, width=120),
        encoding="utf-8",
    )


def initialize_manifest(
    run_dir: str | Path,
    *,
    parent_manifest_path: str | Path | None = None,
    run_mode: str = "production",
    producer_id: str = "producer",
) -> Path:
    artifacts = discover_artifacts(run_dir)
    path = artifacts.run_dir / MANIFEST_NAME
    if path.exists():
        raise ValueError(f"{path} 已存在；初始化不得覆盖既有哈希基线")
    _write_manifest(
        path,
        build_manifest(
            artifacts,
            parent_manifest_path=parent_manifest_path,
            run_mode=run_mode,
            producer_id=producer_id,
        ),
    )
    return path


def _mark_with_downstream(
    statuses: dict[str, str],
    start: str,
    status: str,
) -> None:
    start_index = STAGES.index(start)
    for stage in STAGES[start_index:]:
        if statuses.get(stage) == "stale":
            continue
        statuses[stage] = status


def _manifest_validation(
    manifest: dict[str, Any],
    artifacts: RunArtifacts,
) -> tuple[dict[str, str], list[dict[str, Any]], dict[str, str]]:
    if manifest.get("schema_name") != "controlled_research_run_manifest":
        raise ValueError("run_manifest.schema_name 非法")
    if str(manifest.get("schema_version")) != MANIFEST_SCHEMA_VERSION:
        raise ValueError(f"run_manifest.schema_version 必须为 {MANIFEST_SCHEMA_VERSION}")
    if str(manifest.get("run_mode", "")) not in {"production", "fixture"}:
        raise ValueError("run_manifest.run_mode 必须为 production 或 fixture")
    if not str(manifest.get("producer_id", "")).strip():
        raise ValueError("run_manifest.producer_id 不得为空")
    task_id, run_id = _identity(artifacts)
    if str(manifest.get("task_id")) != task_id or str(manifest.get("run_id")) != run_id:
        raise ValueError("run_manifest 的 task_id/run_id 与阶段产物不一致")
    stages = manifest.get("stages")
    if not isinstance(stages, dict) or set(stages) != set(STAGES):
        raise ValueError("run_manifest.stages 必须完整包含 stage_01—stage_05")

    parent_run = manifest.get("parent_run")
    if parent_run is not None:
        if not isinstance(parent_run, dict):
            raise ValueError("run_manifest.parent_run 必须为对象或 null")
        for field in ["run_id", "manifest_ref", "manifest_hash"]:
            if not str(parent_run.get(field, "")).strip():
                raise ValueError(f"run_manifest.parent_run.{field} 不得为空")
        parent_path = Path(str(parent_run["manifest_ref"]))
        if not parent_path.is_absolute():
            parent_path = artifacts.run_dir / parent_path
        if not parent_path.is_file():
            raise ValueError("run_manifest.parent_run.manifest_ref 无法解析")
        parent_manifest = load_yaml_file(parent_path)
        if manifest_binding_hash(parent_manifest) != str(parent_run["manifest_hash"]):
            raise ValueError("run_manifest.parent_run.manifest_hash 与真实父清单不一致")
        if str(parent_manifest.get("run_id", "")) != str(parent_run["run_id"]):
            raise ValueError("run_manifest.parent_run.run_id 与真实父清单不一致")

    current = current_versions()
    recorded_versions = manifest.get("versions", {})
    statuses = {stage: "current" for stage in STAGES}
    issues: list[dict[str, Any]] = []
    for version_name, current_value in current.items():
        recorded = str(recorded_versions.get(version_name, ""))
        if recorded == current_value:
            continue
        for stage in VERSION_IMPACT[version_name]:
            if statuses[stage] != "stale":
                statuses[stage] = "revalidation_required"
        issues.append({
            "issue_id": f"VERSION-{version_name}",
            "detected_at_stage": VERSION_IMPACT[version_name][0],
            "rule_id": f"version.{version_name}",
            "return_to_stage": VERSION_IMPACT[version_name][0],
            "reason": f"{version_name} 版本变化：记录={recorded or '<空>'}，当前={current_value}",
            "severity": "blocking",
        })

    paths_by_stage = _stage_paths(artifacts)
    actual_hashes: dict[str, str] = {}
    for stage in STAGES:
        entry = stages.get(stage)
        if not isinstance(entry, dict):
            raise ValueError(f"run_manifest.{stage} 必须是对象")
        paths = paths_by_stage[stage]
        if not paths:
            statuses[stage] = "missing"
            actual_hashes[stage] = ""
            continue
        actual = _stage_hash(paths, artifacts.run_dir)
        actual_hashes[stage] = actual
        if str(entry.get("hash", "")) != actual:
            _mark_with_downstream(statuses, stage, "stale")
            issues.append({
                "issue_id": f"STALE-{stage}",
                "detected_at_stage": stage,
                "rule_id": f"{stage}.artifact_hash",
                "return_to_stage": stage,
                "reason": f"{stage} 当前内容哈希与已提交哈希不一致",
                "severity": "blocking",
            })

    for stage in STAGES[1:]:
        upstream = IMMEDIATE_UPSTREAM[stage]
        entry = stages[stage]
        recorded_source = str((entry.get("source_hashes") or {}).get(upstream, ""))
        if recorded_source != actual_hashes.get(upstream, ""):
            _mark_with_downstream(statuses, stage, "stale")
            issues.append({
                "issue_id": f"SOURCE-{stage}",
                "detected_at_stage": stage,
                "rule_id": f"{stage}.source_hashes.{upstream}",
                "return_to_stage": stage,
                "reason": f"{stage} 记录的上游哈希与当前 {upstream} 不一致",
                "severity": "blocking",
            })
    return statuses, issues, actual_hashes


def _load_parent_artifacts(manifest: dict[str, Any], run_dir: Path) -> RunArtifacts | None:
    parent = manifest.get("parent_run")
    if parent is None:
        return None
    path = Path(str(parent["manifest_ref"]))
    if not path.is_absolute():
        path = run_dir / path
    return discover_artifacts(path.resolve().parent)


def _claim_index(audit: dict[str, Any]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for claim in audit.get("claim_register", []) or []:
        if not isinstance(claim, dict):
            continue
        key = str(claim.get("stable_claim_key", "")).strip()
        if not key or key in result:
            raise ValueError("claim_register.stable_claim_key 为空或重复")
        result[key] = claim
    return result


def _validate_incremental_updates(
    manifest: dict[str, Any],
    artifacts: RunArtifacts,
    audit: dict[str, Any],
) -> None:
    updates = audit.get("judgment_update_register")
    if not isinstance(updates, list):
        raise ValueError("04.judgment_update_register 必须是列表")
    parent_artifacts = _load_parent_artifacts(manifest, artifacts.run_dir)
    if parent_artifacts is None:
        if updates:
            raise ValueError("无 parent_run 的初始运行不得伪造 judgment_update_register")
        return
    if parent_artifacts.audit is None:
        raise ValueError("真实父运行缺少 04 推理审计")
    parent_audit = load_yaml_file(parent_artifacts.audit)
    current_claims = _claim_index(audit)
    parent_claims = _claim_index(parent_audit)
    by_key: dict[str, dict[str, Any]] = {}
    required_fields = {
        "update_id", "stable_claim_key", "prior_claim_hash", "current_claim_hash",
        "evidence_changes", "direct_impact_scope_refs", "update_action",
        "parent_reaggregated", "parent_claim_refs", "update_reason",
    }
    for index, item in enumerate(updates, 1):
        if not isinstance(item, dict) or not required_fields.issubset(item):
            raise ValueError(f"judgment_update_register[{index}] 缺少 v1.1 必填字段")
        key = str(item["stable_claim_key"]).strip()
        if not key or key in by_key:
            raise ValueError("judgment_update_register.stable_claim_key 为空或重复")
        if str(item["update_action"]) not in {"new", "maintain", "enhance", "weaken", "block", "revise", "retire"}:
            raise ValueError(f"judgment_update_register[{index}].update_action 非法")
        if not isinstance(item["evidence_changes"], list) or not isinstance(item["direct_impact_scope_refs"], list):
            raise ValueError(f"judgment_update_register[{index}] 证据变化与直接影响范围必须是列表")
        if not isinstance(item["parent_reaggregated"], bool):
            raise ValueError(f"judgment_update_register[{index}].parent_reaggregated 必须为布尔值")
        current = current_claims.get(key)
        previous = parent_claims.get(key)
        if current is None:
            raise ValueError(f"judgment_update_register[{index}] 当前稳定 Claim 不存在")
        expected_prior = claim_version_hash(previous) if previous is not None else None
        if item["prior_claim_hash"] != expected_prior:
            raise ValueError(f"judgment_update_register[{index}].prior_claim_hash 与真实父运行不一致")
        if str(item["current_claim_hash"]) != claim_version_hash(current):
            raise ValueError(f"judgment_update_register[{index}].current_claim_hash 与当前 Claim 不一致")
        if previous is None and item["update_action"] != "new":
            raise ValueError(f"新稳定 Claim {key} 的 update_action 必须为 new")
        if previous is not None and item["update_action"] == "new":
            raise ValueError(f"既有稳定 Claim {key} 不得标记为 new")
        if not str(item["update_reason"]).strip():
            raise ValueError(f"judgment_update_register[{index}].update_reason 不得为空")
        by_key[key] = item
    if set(by_key) != set(current_claims):
        raise ValueError("增量运行必须逐稳定 Claim 登记维持、削弱、改写或阻断")

    claim_id_to_key = {str(claim.get("claim_id")): key for key, claim in current_claims.items()}
    for result in audit.get("aggregation_results", []) or []:
        parent_claim = next(
            (claim for claim in current_claims.values() if claim.get("aggregation_result_ref") == result.get("aggregation_result_ref")),
            None,
        )
        if parent_claim is None:
            continue
        parent_key = str(parent_claim["stable_claim_key"])
        parent_update = by_key[parent_key]
        child_keys = {
            claim_id_to_key[claim_id]
            for claim_id in result.get("child_claim_refs", [])
            if claim_id in claim_id_to_key
        }
        changed_children = {
            key for key in child_keys if by_key[key]["update_action"] not in {"maintain"}
        }
        if parent_update["update_action"] == "revise":
            if parent_update["parent_reaggregated"] is not True:
                raise ValueError(f"父级 Claim {parent_key} revise 时必须重新聚合")
            if len(changed_children) < 2:
                raise ValueError("单个局部子项变化不得直接把父级动作写成 revise")


def _judgment_summary(artifacts: RunArtifacts) -> tuple[str | None, bool]:
    if not artifacts.audit:
        return None, False
    audit = load_yaml_file(artifacts.audit)
    overall = audit.get("overall_judgment", {}) if isinstance(audit, dict) else {}
    level = str(overall.get("judgment_level", "")).strip() or None
    return level, directional_conclusion_available(audit if isinstance(audit, dict) else {})


def derive_run_outcome(
    *,
    chain_publish_status: str,
    quality_pass: bool,
    validity_statuses: dict[str, str],
    audit: dict[str, Any],
    semantic_review_status: str = "missing",
) -> dict[str, Any]:
    """发布与判断方向分开派生；J0/J1 不会自动阻止高质量缺口报告发布。"""
    directional = directional_conclusion_available(audit)
    validity_blocked = any(status != "current" for status in validity_statuses.values())
    deterministic_pass = bool(chain_publish_status in {"PUBLISHABLE", "STAGE_READY"} and quality_pass and not validity_blocked)
    publishable = bool(deterministic_pass and semantic_review_status == "pass")
    if not deterministic_pass or semantic_review_status in {"fail", "needs_human", "invalid"}:
        publish_status = "RETURN_REQUIRED"
    elif semantic_review_status == "missing":
        publish_status = "STAGE_READY"
    else:
        publish_status = "PUBLISHABLE"
    overall = audit.get("overall_judgment", {}) if isinstance(audit, dict) else {}
    return {
        "quality_pass": quality_pass,
        "publishable": publishable,
        "publish_status": publish_status,
        "judgment_level": str(overall.get("judgment_level", "")).strip() or None,
        "directional_conclusion_available": directional,
    }


def validate_run(run_dir: str | Path, *, write_manifest: bool = True) -> dict[str, Any]:
    artifacts = discover_artifacts(run_dir)
    manifest_path = artifacts.run_dir / MANIFEST_NAME
    if not manifest_path.is_file():
        raise ValueError(f"缺少 {MANIFEST_NAME}；新 run 先执行 --initialize")
    manifest = load_yaml_file(manifest_path)
    if not isinstance(manifest, dict):
        raise ValueError("run_manifest 必须是 YAML 对象")

    statuses, manifest_issues, actual_hashes = _manifest_validation(manifest, artifacts)
    chain_result = validate_publish(artifacts, through="05")
    stage_pass = all(item.get("status") == "pass" for item in chain_result.get("stages", {}).values())
    quality_pass = stage_pass and all(
        item.get("quality_status") == "high_quality_pass"
        for item in chain_result.get("stages", {}).values()
    )
    audit = load_yaml_file(artifacts.audit) if artifacts.audit else {}
    _validate_incremental_updates(manifest, artifacts, audit if isinstance(audit, dict) else {})
    semantic_status = "missing"
    semantic_details: dict[str, Any] | None = None
    if artifacts.semantic_review is not None:
        try:
            semantic_details = validate_independent_semantic_review(
                artifacts.semantic_review,
                stage_hashes=actual_hashes,
                contract_version=current_versions()["contract"],
                run_mode=str(manifest.get("run_mode")),
                producer_id=str(manifest.get("producer_id")),
            )
            semantic_status = str(semantic_details["verdict"])
        except Exception as exc:
            semantic_status = "invalid"
            manifest_issues.append({
                "issue_id": "SEMANTIC-REVIEW",
                "detected_at_stage": "stage_05",
                "rule_id": "semantic_review.contract",
                "return_to_stage": "stage_05",
                "reason": str(exc),
                "severity": "blocking",
            })
    outcome = derive_run_outcome(
        chain_publish_status=str(chain_result.get("publish_status", "RETURN_REQUIRED")),
        quality_pass=quality_pass,
        validity_statuses=statuses,
        audit=audit if isinstance(audit, dict) else {},
        semantic_review_status=semantic_status,
    )
    publishable = bool(outcome["publishable"])
    judgment_level = outcome["judgment_level"]
    directional = bool(outcome["directional_conclusion_available"])

    validation_issues = list(manifest_issues)
    for index, item in enumerate(chain_result.get("rework_items", []), 1):
        validation_issues.append({
            "issue_id": f"CHAIN-{index:03d}",
            "detected_at_stage": item.get("affected_stage"),
            "rule_id": item.get("rule_id"),
            "return_to_stage": f"stage_{item.get('return_to')}",
            "reason": item.get("message"),
            "severity": "blocking",
        })

    manifest["validation_issues"] = validation_issues
    for stage, status in statuses.items():
        manifest["stages"][stage]["validity_status"] = status
        manifest["stages"][stage]["stage_status"] = _stage_status(stage, artifacts)
    manifest["validation_summary"] = {**outcome, "contract_version": current_versions()["contract"]}
    if write_manifest:
        _write_manifest(manifest_path, manifest)
    return {
        "ok": publishable,
        "task_id": manifest.get("task_id"),
        "run_id": manifest.get("run_id"),
        "quality_pass": quality_pass,
        "publishable": publishable,
        "publish_status": outcome["publish_status"],
        "semantic_review_status": semantic_status,
        "semantic_review": semantic_details,
        "judgment_level": judgment_level,
        "directional_conclusion_available": directional,
        "validity_statuses": statuses,
        "validation_issues": validation_issues,
        "chain_result": chain_result,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate the controlled 01—05 research chain.")
    parser.add_argument("run_path", help="包含 01—05 产物的运行目录")
    parser.add_argument("--initialize", action="store_true", help="为新 run 建立只读哈希基线")
    parser.add_argument("--parent-manifest", help="初始化时绑定真实父 run_manifest.yaml")
    parser.add_argument("--run-mode", choices=["production", "fixture"], default="production")
    parser.add_argument("--producer-id", default="producer")
    parser.add_argument("--no-write", action="store_true", help="只校验，不刷新 manifest 的状态和摘要")
    args = parser.parse_args(argv)
    try:
        if args.initialize:
            initialize_manifest(
                args.run_path,
                parent_manifest_path=args.parent_manifest,
                run_mode=args.run_mode,
                producer_id=args.producer_id,
            )
        result = validate_run(args.run_path, write_manifest=not args.no_write)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result["ok"] else 1
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
