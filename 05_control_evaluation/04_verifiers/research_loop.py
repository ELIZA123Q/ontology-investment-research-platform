#!/usr/bin/env python3
"""冻结 01—05 研究包的循环合同校验器。

这是历史制品回放所需的确定性校验，不是 vNext 的执行循环。当前执行权威位于
``06_runtime/src/runtime``；本模块只保留旧正式包仍需验证的三个纯函数。
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Mapping

import yaml


ROOT = Path(__file__).resolve().parents[2]
EVIDENCE_WAVE_SCHEMA_VERSION = "1.0.0"
DEPENDENCY_PROJECTION_SCHEMA_VERSION = "1.0.0"
STAGES = ("stage_01", "stage_02", "stage_03", "stage_04", "stage_05")
CLASSIFICATIONS = {
    "task_contract_revision",
    "reasoning_structure_revision",
    "evidence_update",
    "presentation_revision",
    "no_semantic_delta",
}
HANDLED_CONFLICT_STATUSES = {"resolved", "contested", "blocked"}
SHA256_RE = re.compile(r"^sha256:[0-9a-f]{64}$")

OBJECT_LAYER = {
    "SourceDocument": 0, "EvidenceClaim": 0, "EvidenceFact": 0,
    "EvidenceAssessment": 0, "StateVariable": 1, "Observation": 1,
    "Event": 1, "Signal": 1, "MarketExpectation": 1, "Hypothesis": 2,
    "Scenario": 2, "RuleEvaluation": 3, "Judgment": 4,
    "ExpectationGap": 5, "AssetImpact": 5, "ReasoningTrace": 5,
    "ValidationRecord": 5, "ReportClaim": 6,
}
OBJECT_STAGE_RULES = {
    "SourceDocument": {"stage_03"}, "EvidenceClaim": {"stage_03"},
    "EvidenceFact": {"stage_03"}, "EvidenceAssessment": {"stage_03"},
    "Observation": {"stage_03"}, "Event": {"stage_03"},
    "Signal": {"stage_03"}, "MarketExpectation": {"stage_03", "stage_04"},
    "StateVariable": {"stage_02"}, "Hypothesis": {"stage_04"},
    "Scenario": {"stage_04"}, "RuleEvaluation": {"stage_04"},
    "Judgment": {"stage_04"}, "ExpectationGap": {"stage_04"},
    "AssetImpact": {"stage_04"}, "ReasoningTrace": {"stage_04"},
    "ValidationRecord": {"stage_04"}, "ReportClaim": {"stage_05"},
}
BINDING_FIELDS = {
    "state_variable_refs", "hypothesis_refs", "path_refs", "judgment_unit_refs",
    "evidence_requirement_refs", "scope_refs", "competing_explanation_refs",
    "relation_type_refs", "object_type_refs",
}
PRESENTATION_PREFIXES = ("presentation.", "delivery.", "expression.", "stage_05.")
MODEL_FILES = (
    "semantic.yaml", "state_event.yaml", "evidence.yaml", "judgment.yaml",
    "operational.yaml",
)
EXTENSION_FILE = "domains/semiconductor/ontology_extension.yaml"


class ResearchLoopError(ValueError):
    pass


def _mapping(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ResearchLoopError(f"{label} 必须是对象")
    return dict(value)


def _list(value: Any, label: str) -> list[Any]:
    if not isinstance(value, list):
        raise ResearchLoopError(f"{label} 必须是列表")
    return list(value)


def _string_list(value: Any, label: str) -> list[str]:
    result = [str(item).strip() for item in _list(value, label)]
    if any(not item for item in result) or len(result) != len(set(result)):
        raise ResearchLoopError(f"{label} 不得包含空值或重复引用")
    return result


def _parse_datetime(value: Any, label: str) -> None:
    text = str(value or "").strip()
    try:
        datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ResearchLoopError(f"{label} 必须为 ISO 8601 时间") from exc


def _catalog() -> tuple[set[str], set[str], dict[str, dict[str, Any]]]:
    objects: set[str] = set()
    relations: set[str] = set()
    definitions: dict[str, dict[str, Any]] = {}
    ontology_root = ROOT / "01_semantic_knowledge/01_ontology"
    paths = [ontology_root / "models" / filename for filename in MODEL_FILES]
    paths.append(ontology_root / EXTENSION_FILE)
    for path in paths:
        document = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        objects.update(map(str, (document.get("object_types") or {}).keys()))
        relations.update(map(str, (document.get("relation_types") or {}).keys()))
        definitions.update({str(key): dict(value) for key, value in (document.get("relation_types") or {}).items() if isinstance(value, dict)})
    return objects, relations, definitions


def _canonical_sha256(value: Any) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(payload.encode("utf-8")).hexdigest()


def validate_evidence_wave(wave: Mapping[str, Any]) -> dict[str, Any]:
    value = _mapping(wave, "evidence_wave")
    if value.get("schema_name") != "ontology_evidence_wave":
        raise ResearchLoopError("evidence_wave.schema_name 必须为 ontology_evidence_wave")
    if str(value.get("schema_version")) != EVIDENCE_WAVE_SCHEMA_VERSION:
        raise ResearchLoopError("evidence_wave.schema_version 非法")
    for field in ("wave_id", "task_id", "run_id"):
        if not str(value.get(field, "")).strip():
            raise ResearchLoopError(f"evidence_wave.{field} 不得为空")
    if value.get("wave_status") != "frozen":
        raise ResearchLoopError("证据循环只接受 wave_status=frozen 的批次")
    _parse_datetime(value.get("frozen_at"), "evidence_wave.frozen_at")
    if not str(value.get("source_02_view_hash", "")).strip():
        raise ResearchLoopError("evidence_wave.source_02_view_hash 不得为空")
    _string_list(value.get("evidence_refs", []), "evidence_wave.evidence_refs")
    deltas = _list(value.get("ontology_deltas", []), "evidence_wave.ontology_deltas")
    task_deltas = _list(value.get("task_contract_deltas", []), "evidence_wave.task_contract_deltas")
    presentation_deltas = _list(value.get("presentation_deltas", []), "evidence_wave.presentation_deltas")
    if not value.get("evidence_refs") and not deltas and not task_deltas and not presentation_deltas:
        raise ResearchLoopError("冻结波次不得为空")
    object_types, relation_types, _ = _catalog()
    seen: set[str] = set()
    for index, raw in enumerate(deltas, 1):
        delta = _mapping(raw, f"ontology_deltas[{index}]")
        delta_id = str(delta.get("delta_id", "")).strip()
        if not delta_id or delta_id in seen:
            raise ResearchLoopError("ontology delta ID 为空或重复")
        seen.add(delta_id)
        operation = str(delta.get("operation", ""))
        if operation not in {"instantiate", "revise", "relate", "retire"}:
            raise ResearchLoopError(f"{delta_id}.operation 非法")
        resource_kind = str(delta.get("resource_kind", ""))
        ontology_ref = str(delta.get("ontology_ref", ""))
        if resource_kind == "object" and ontology_ref not in object_types:
            raise ResearchLoopError(f"{delta_id}.ontology_ref 不是正式 Object")
        if resource_kind == "relation" and ontology_ref not in relation_types:
            raise ResearchLoopError(f"{delta_id}.ontology_ref 不是正式 Relation")
        if resource_kind not in {"object", "relation"}:
            raise ResearchLoopError(f"{delta_id}.resource_kind 非法")
        if not str(delta.get("object_ref", "")).strip():
            raise ResearchLoopError(f"{delta_id}.object_ref 不得为空")
        if operation in {"revise", "retire"} and not str(delta.get("prior_object_ref", "")).strip():
            raise ResearchLoopError(f"{delta_id} 缺少 prior_object_ref")
        _string_list(delta.get("evidence_refs", []), f"{delta_id}.evidence_refs")
        _string_list(delta.get("affects_refs", []), f"{delta_id}.affects_refs")
        bindings = _mapping(delta.get("bindings", {}), f"{delta_id}.bindings")
        unknown = sorted(set(bindings) - BINDING_FIELDS)
        if unknown:
            raise ResearchLoopError(f"{delta_id}.bindings 含未知引用族: {unknown}")
        for field in BINDING_FIELDS:
            _string_list(bindings.get(field, []), f"{delta_id}.bindings.{field}")
    change_ids: set[str] = set()
    for label, changes in (("task_contract_deltas", task_deltas), ("presentation_deltas", presentation_deltas)):
        for raw in changes:
            change = _mapping(raw, label)
            change_id = str(change.get("change_id", "")).strip()
            field_ref = str(change.get("field_ref", "")).strip()
            if not change_id or change_id in change_ids or not field_ref:
                raise ResearchLoopError(f"{label} change_id/field_ref 为空或重复")
            change_ids.add(change_id)
            if label == "presentation_deltas" and not field_ref.startswith(PRESENTATION_PREFIXES):
                raise ResearchLoopError("语义变化不得伪装为 presentation_delta")
    declared = str(value.get("wave_hash", "")).strip()
    expected = _canonical_sha256({key: item for key, item in value.items() if key != "wave_hash"})
    if declared and declared != expected:
        raise ResearchLoopError("evidence_wave.wave_hash 与冻结内容不一致")
    value["wave_hash"] = expected
    return value


def validate_dependency_projection(projection: Mapping[str, Any]) -> dict[str, Any]:
    value = _mapping(projection, "dependency_projection")
    if value.get("schema_name") != "ontology_dependency_projection":
        raise ResearchLoopError("dependency_projection.schema_name 非法")
    if str(value.get("schema_version")) != DEPENDENCY_PROJECTION_SCHEMA_VERSION:
        raise ResearchLoopError("dependency_projection.schema_version 非法")
    for field in ("task_id", "run_id"):
        if not str(value.get(field, "")).strip():
            raise ResearchLoopError(f"dependency_projection.{field} 不得为空")
    if not SHA256_RE.fullmatch(str(value.get("source_02_view_hash", "")).strip()):
        raise ResearchLoopError("dependency_projection.source_02_view_hash 必须为完整 sha256 哈希")
    object_types, relation_types, definitions = _catalog()
    nodes = _list(value.get("nodes", []), "dependency_projection.nodes")
    edges = _list(value.get("edges", []), "dependency_projection.edges")
    node_index: dict[str, dict[str, Any]] = {}
    for index, raw in enumerate(nodes, 1):
        node = _mapping(raw, f"nodes[{index}]")
        ref = str(node.get("object_ref", "")).strip()
        object_type = str(node.get("object_type_ref", "")).strip()
        stage = str(node.get("stage", "")).strip()
        if not ref or ref in node_index:
            raise ResearchLoopError("dependency node 引用为空或重复")
        if object_type not in object_types | {"ReportClaim"}:
            raise ResearchLoopError(f"{ref}.object_type_ref 非法")
        if stage not in STAGES or stage not in OBJECT_STAGE_RULES.get(object_type, {"stage_02", "stage_03"}):
            raise ResearchLoopError(f"{ref}.stage 与对象归属不一致")
        if not SHA256_RE.fullmatch(str(node.get("content_hash", "")).strip()):
            raise ResearchLoopError(f"{ref}.content_hash 非法")
        if str(node.get("validity_status", "current")) not in {"current", "stale", "revalidation_required", "missing"}:
            raise ResearchLoopError(f"{ref}.validity_status 非法")
        if not isinstance(node.get("critical", False), bool):
            raise ResearchLoopError(f"{ref}.critical 必须为布尔值")
        node_index[ref] = node
    edge_ids: set[str] = set()
    for index, raw in enumerate(edges, 1):
        edge = _mapping(raw, f"edges[{index}]")
        edge_id = str(edge.get("dependency_ref", "")).strip()
        upstream = str(edge.get("upstream_ref", "")).strip()
        downstream = str(edge.get("downstream_ref", "")).strip()
        basis = str(edge.get("basis_relation_ref", "")).strip()
        if not edge_id or edge_id in edge_ids or upstream not in node_index or downstream not in node_index or upstream == downstream:
            raise ResearchLoopError("dependency edge 标识或端点非法")
        edge_ids.add(edge_id)
        up_type = str(node_index[upstream]["object_type_ref"])
        down_type = str(node_index[downstream]["object_type_ref"])
        if basis == "stageProjection":
            if down_type != "ReportClaim":
                raise ResearchLoopError("stageProjection 只能指向 ReportClaim")
        elif basis in relation_types:
            definition = definitions[basis]
            sources = set(map(str, definition.get("source_types", [])))
            targets = set(map(str, definition.get("target_types", [])))
            if not ((up_type in sources and down_type in targets) or (down_type in sources and up_type in targets)):
                raise ResearchLoopError(f"{edge_id} 端点不受 {basis} 连接")
        else:
            raise ResearchLoopError(f"{edge_id}.basis_relation_ref 非法")
        if OBJECT_LAYER.get(down_type, 99) < OBJECT_LAYER.get(up_type, 99):
            raise ResearchLoopError(f"{edge_id} 依赖方向逆向")
    return value


def convergence_status(loop_state: Mapping[str, Any]) -> dict[str, Any]:
    state = _mapping(loop_state, "loop_state")
    forbidden = sorted(set(state) & {"max_iterations", "max_loop_count", "iteration_limit"})
    if forbidden:
        raise ResearchLoopError("收敛不得由循环次数上限决定")
    pending_structural = _string_list(state.get("pending_structural_trigger_refs", []), "pending_structural_trigger_refs")
    critical_stale = _string_list(state.get("critical_stale_refs", []), "critical_stale_refs")
    pending_attempts = _string_list(state.get("pending_stage_attempts", []), "pending_stage_attempts")
    noncurrent_hashes: list[str] = []
    for stage, raw in _mapping(state.get("attempt_hashes", {}), "attempt_hashes").items():
        if stage not in STAGES:
            raise ResearchLoopError(f"未知阶段: {stage}")
        item = _mapping(raw, f"attempt_hashes.{stage}")
        if not item.get("declared_hash") or item.get("declared_hash") != item.get("actual_hash"):
            noncurrent_hashes.append(stage)
    unresolved_conflicts: list[str] = []
    for index, raw in enumerate(_list(state.get("conflicts", []), "conflicts"), 1):
        item = _mapping(raw, f"conflicts[{index}]")
        if str(item.get("resolution_status", "")) not in HANDLED_CONFLICT_STATUSES:
            unresolved_conflicts.append(str(item.get("conflict_ref", f"conflict-{index}")))
    latest = _mapping(state.get("latest_wave", {}), "latest_wave")
    changed_judgment = bool(latest.get("key_judgment_changed", False))
    changed_path = bool(latest.get("key_path_changed", False))
    unresolved_scope = bool(state.get("structural_impact_scope_unresolved", False))
    checks = {
        "no_pending_structural_trigger": not pending_structural,
        "no_critical_stale_object": not critical_stale,
        "no_pending_stage_attempt": not pending_attempts,
        "all_attempt_hashes_current": not noncurrent_hashes,
        "all_conflicts_handled": not unresolved_conflicts,
        "latest_wave_did_not_change_key_judgment": not changed_judgment,
        "latest_wave_did_not_change_key_path": not changed_path,
        "structural_impact_scope_resolved": not unresolved_scope,
    }
    blockers = [
        *( ["pending_structural_trigger_refs=" + ",".join(pending_structural)] if pending_structural else []),
        *( ["critical_stale_refs=" + ",".join(critical_stale)] if critical_stale else []),
        *( ["pending_stage_attempts=" + ",".join(pending_attempts)] if pending_attempts else []),
        *( ["noncurrent_attempt_hashes=" + ",".join(noncurrent_hashes)] if noncurrent_hashes else []),
        *( ["unresolved_conflicts=" + ",".join(unresolved_conflicts)] if unresolved_conflicts else []),
        *( ["latest_wave_changed_key_judgment"] if changed_judgment else []),
        *( ["latest_wave_changed_key_path"] if changed_path else []),
        *( ["structural_impact_scope_unresolved"] if unresolved_scope else []),
    ]
    return {"converged": all(checks.values()), "checks": checks, "blockers": blockers, "semantic_iteration_limit_used": False}

