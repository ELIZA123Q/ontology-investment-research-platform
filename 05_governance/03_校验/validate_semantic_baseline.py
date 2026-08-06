#!/usr/bin/env python3
"""正式发布包语义基线校验：本体指纹、阶段解析集合与实例图绑定。"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any

import yaml

from repo_paths import ensure_run_path

ensure_run_path()

from validator_utils import artifact_sha256, load_yaml_file


ROOT = Path(__file__).resolve().parents[2]
STAGES = ["stage_01", "stage_02", "stage_03", "stage_04", "stage_05"]
GRAPH_STAGES = ["stage_02", "stage_03", "stage_04"]
MODEL_REGISTRY_PATH = ROOT / "01_semantic/01_ontology/model_registry.yaml"
SHA256_RE = re.compile(r"^sha256:[a-f0-9]{64}$")
RAW_SHA256_RE = re.compile(r"^[a-f0-9]{64}$")


def current_ontology_identity() -> tuple[str, list[str]]:
    digest = hashlib.sha256()
    versions: set[str] = set()
    registry = yaml.safe_load(MODEL_REGISTRY_PATH.read_text(encoding="utf-8"))
    if (
        not isinstance(registry, dict)
        or registry.get("schema_name") != "ontology_model_registry"
        or registry.get("status") != "active"
        or not isinstance(registry.get("model_files"), list)
    ):
        raise ValueError("正式本体模型注册表非法")
    model_files = [f"01_semantic/01_ontology/{item}" for item in registry["model_files"]]
    for relative in model_files:
        raw = (ROOT / relative).read_bytes()
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(raw)
        digest.update(b"\0")
        document = yaml.safe_load(raw.decode("utf-8"))
        if not isinstance(document, dict):
            raise ValueError(f"正式本体模型不是 YAML 对象: {relative}")
        version = str(document.get("schema_version", "")).strip()
        if version:
            versions.add(version)
    return "sha256:" + digest.hexdigest(), sorted(versions)


def _sorted_strings(value: Any, label: str) -> list[str]:
    if not isinstance(value, list) or any(not isinstance(item, str) or not item.strip() for item in value):
        raise ValueError(f"{label} 必须为非空字符串组成的列表")
    actual = [item.strip() for item in value]
    if actual != sorted(set(actual)):
        raise ValueError(f"{label} 必须去重并按字典序排序")
    return actual


def _validate_stage_context(
    raw: Any,
    stage: str,
    *,
    expected_fingerprint: str,
    expected_versions: list[str],
    require_complete: bool,
) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError(f"semantic_baseline.stage_contexts.{stage} 必须是对象")
    if str(raw.get("schema_version", "")) != "1.0.0":
        raise ValueError(f"{stage}.semantic_context.schema_version 必须为 1.0.0")
    if str(raw.get("stage", "")) != stage:
        raise ValueError(f"{stage}.semantic_context.stage 与阶段不一致")
    fingerprint = str(raw.get("ontology_fingerprint", ""))
    if not SHA256_RE.fullmatch(fingerprint) or fingerprint != expected_fingerprint:
        raise ValueError(f"{stage}.ontology_fingerprint 与当前正式本体不一致")
    if _sorted_strings(raw.get("ontology_versions"), f"{stage}.ontology_versions") != expected_versions:
        raise ValueError(f"{stage}.ontology_versions 与当前正式本体模型版本集合不一致")

    _sorted_strings(raw.get("declared_object_ids"), f"{stage}.declared_object_ids")
    referenced = _sorted_strings(raw.get("referenced_semantic_ids"), f"{stage}.referenced_semantic_ids")
    resolved = _sorted_strings(raw.get("resolved_semantic_ids"), f"{stage}.resolved_semantic_ids")
    task_local = _sorted_strings(raw.get("task_local_ids"), f"{stage}.task_local_ids")
    unresolved = _sorted_strings(raw.get("unresolved_semantic_ids"), f"{stage}.unresolved_semantic_ids")
    referenced_set = set(referenced)
    resolved_set = set(resolved)
    unresolved_set = set(unresolved)
    if not resolved_set.issubset(referenced_set) or not unresolved_set.issubset(referenced_set):
        raise ValueError(f"{stage} 已解析/未解析集合必须是引用集合的子集")
    if resolved_set & unresolved_set or resolved_set | unresolved_set != referenced_set:
        raise ValueError(f"{stage} 引用集合必须由已解析与未解析集合无交集地完整划分")
    if any(item not in resolved_set or not item.startswith("task_local:") for item in task_local):
        raise ValueError(f"{stage}.task_local_ids 必须是已解析的 task_local:* 引用")
    coverage = round(len(resolved) / len(referenced), 6) if referenced else 1
    if raw.get("reference_coverage") != coverage:
        raise ValueError(f"{stage}.reference_coverage 与解析集合不一致")
    expected_status = "not_applicable" if not referenced else ("partial" if unresolved else "complete")
    if str(raw.get("resolution_status", "")) != expected_status:
        raise ValueError(f"{stage}.resolution_status 与解析集合不一致")
    if require_complete and unresolved:
        raise ValueError(f"{stage} 尚有未解析语义引用: {', '.join(unresolved)}")
    return raw


def validate_semantic_baseline(run_dir: str | Path, manifest: dict[str, Any]) -> dict[str, Any]:
    run_path = Path(run_dir).resolve()
    run_mode = str(manifest.get("run_mode", ""))
    binding = manifest.get("semantic_baseline")
    if not isinstance(binding, dict):
        if run_mode == "fixture":
            return {"status": "legacy_fixture", "required": False}
        raise ValueError("生产正式包 run_manifest 缺少 semantic_baseline 绑定")

    baseline_ref = str(binding.get("artifact", ""))
    graph_ref = str(binding.get("instance_graph_artifact", ""))
    if baseline_ref != "semantic_context.yaml" or graph_ref != "business_instance_graph.yaml":
        raise ValueError("semantic_baseline 必须使用规范文件名 semantic_context.yaml / business_instance_graph.yaml")
    baseline_path = run_path / baseline_ref
    graph_path = run_path / graph_ref
    if not baseline_path.is_file() or not graph_path.is_file():
        raise ValueError("semantic_baseline 绑定的语义基线或实例图文件不存在")
    if artifact_sha256(baseline_path) != str(binding.get("hash", "")):
        raise ValueError("semantic_context.yaml 内容哈希与 run_manifest 不一致")
    if artifact_sha256(graph_path) != str(binding.get("instance_graph_hash", "")):
        raise ValueError("business_instance_graph.yaml 内容哈希与 run_manifest 不一致")

    baseline = load_yaml_file(baseline_path)
    if not isinstance(baseline, dict):
        raise ValueError("semantic_context.yaml 必须是 YAML 对象")
    if baseline.get("schema_name") != "controlled_research_semantic_baseline":
        raise ValueError("semantic_context.yaml.schema_name 非法")
    if str(baseline.get("schema_version", "")) != "1.0.0":
        raise ValueError("semantic_context.yaml.schema_version 必须为 1.0.0")
    if run_mode == "production" and baseline.get("resolution_policy") != "production_complete":
        raise ValueError("生产正式包语义基线必须声明 resolution_policy=production_complete")

    current_fingerprint, current_versions = current_ontology_identity()
    if str(baseline.get("ontology_fingerprint", "")) != current_fingerprint:
        raise ValueError("语义基线使用的本体内容指纹不是当前正式本体")
    if str(binding.get("ontology_fingerprint", "")) != current_fingerprint:
        raise ValueError("run_manifest 与 semantic_context.yaml 的本体指纹不一致")
    if _sorted_strings(baseline.get("ontology_versions"), "semantic_baseline.ontology_versions") != current_versions:
        raise ValueError("语义基线的本体模型版本集合不是当前版本")

    contexts = baseline.get("stage_contexts")
    if not isinstance(contexts, dict) or set(contexts) != set(STAGES):
        raise ValueError("semantic_baseline.stage_contexts 必须完整包含 stage_01—stage_05")
    for stage in STAGES:
        _validate_stage_context(
            contexts[stage],
            stage,
            expected_fingerprint=current_fingerprint,
            expected_versions=current_versions,
            require_complete=run_mode == "production",
        )

    graph_payload = load_yaml_file(graph_path)
    if not isinstance(graph_payload, dict) or graph_payload.get("authority_contract") != "ontology_authority_graph_v1":
        raise ValueError("正式实例图必须声明 authority_contract=ontology_authority_graph_v1")
    graph = graph_payload.get("business_instance_graph")
    if not isinstance(graph, dict) or graph.get("schema_name") != "ontology_business_instance_graph":
        raise ValueError("business_instance_graph.yaml 缺少正式 business_instance_graph")
    fingerprints = graph.get("projection_fingerprints")
    baseline_graph = baseline.get("instance_graph")
    if not isinstance(fingerprints, dict) or not isinstance(baseline_graph, dict):
        raise ValueError("正式实例图或语义基线缺少投影指纹")
    recorded_fingerprints = baseline_graph.get("projection_fingerprints")
    if not isinstance(recorded_fingerprints, dict):
        raise ValueError("semantic_baseline.instance_graph.projection_fingerprints 必须是对象")
    for stage in GRAPH_STAGES:
        actual = str(fingerprints.get(stage, ""))
        if not RAW_SHA256_RE.fullmatch(actual) or str(recorded_fingerprints.get(stage, "")) != actual:
            raise ValueError(f"正式实例图与语义基线的 {stage} 投影指纹不一致")
    if baseline_graph.get("artifact") != graph_ref:
        raise ValueError("semantic_baseline.instance_graph.artifact 与 run_manifest 不一致")
    if baseline_graph.get("authority_contract") != "ontology_authority_graph_v1":
        raise ValueError("semantic_baseline.instance_graph.authority_contract 非法")

    return {
        "status": "pass",
        "required": run_mode == "production",
        "ontology_fingerprint": current_fingerprint,
        "stage_reference_coverage": {
            stage: contexts[stage]["reference_coverage"] for stage in STAGES
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate a formal pack semantic baseline.")
    parser.add_argument("run_path")
    args = parser.parse_args(argv)
    run_path = Path(args.run_path).resolve()
    manifest = load_yaml_file(run_path / "run_manifest.yaml")
    if not isinstance(manifest, dict):
        raise ValueError("run_manifest.yaml 必须是 YAML 对象")
    print(json.dumps(validate_semantic_baseline(run_path, manifest), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
