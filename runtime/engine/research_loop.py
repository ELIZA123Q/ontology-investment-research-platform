#!/usr/bin/env python3
"""本体驱动的证据波次闭环控制器。

本模块不定义新的业务变量或推理参数。它只读取：

1. 02 冻结的任务本体视图；
2. 以正式本体 Object / Relation 引用表达的证据波次；
3. 由本体对象关系投影出的运行时依赖图。

输出是返工层级、对象级 stale 集合、待建立的阶段 attempt 和收敛判定。
CSV、Markdown、图表及本文件输出都只是正式本体和阶段产物的运行时投影。
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import shutil
import sys
from collections import defaultdict, deque
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable, Mapping

import yaml

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "governance" / "03_校验"))
sys.path.insert(0, str(ROOT / "runtime" / "adapters"))

from ontology_instance_graph import materialize_document
from research_contract import task_view_hash

EVIDENCE_WAVE_SCHEMA_VERSION = "1.0.0"
DEPENDENCY_PROJECTION_SCHEMA_VERSION = "1.0.0"
LOOP_PLAN_SCHEMA_VERSION = "1.0.0"
MANIFEST_SCHEMA_VERSION = "1.2.0"

STAGES = ("stage_01", "stage_02", "stage_03", "stage_04", "stage_05")
IMMEDIATE_UPSTREAM = {
    "stage_01": None,
    "stage_02": "stage_01",
    "stage_03": "stage_02",
    "stage_04": "stage_03",
    "stage_05": "stage_04",
}
CLASSIFICATIONS = {
    "task_contract_revision",
    "reasoning_structure_revision",
    "evidence_update",
    "presentation_revision",
    "no_semantic_delta",
}
CLASSIFICATION_PRIORITY = {
    "no_semantic_delta": 0,
    "presentation_revision": 1,
    "evidence_update": 2,
    "reasoning_structure_revision": 3,
    "task_contract_revision": 4,
}
CLASSIFICATION_STAGES = {
    "task_contract_revision": list(STAGES),
    "reasoning_structure_revision": list(STAGES[1:]),
    "evidence_update": list(STAGES[2:]),
    "presentation_revision": ["stage_05"],
    "no_semantic_delta": [],
}
RETURN_TO_STAGE = {
    "task_contract_revision": "stage_01",
    "reasoning_structure_revision": "stage_02",
    "evidence_update": "stage_03",
    "presentation_revision": "stage_05",
    "no_semantic_delta": None,
}

# 这些是控制路由，不是业务分类。它们只判断某个正式本体实例是否已经被 02 冻结结构容纳。
STRUCTURAL_OBJECT_TYPES = {"StateVariable", "Hypothesis", "Scenario"}
STRUCTURAL_RELATION_TYPES = {
    "variableInfluencesVariable",
    "hypothesisAbout",
    "hypothesisCompetesWith",
    "hypothesisContradicts",
    "scenarioIncludesHypothesis",
    "judgmentUnderScenario",
    "impactUnderScenario",
}
EVIDENCE_SIDE_OBJECT_TYPES = {
    "SourceDocument",
    "EvidenceClaim",
    "EvidenceFact",
    "EvidenceAssessment",
    "Observation",
    "Event",
    "Signal",
    "MarketExpectation",
    "ValidationRecord",
}
TASK_CONTRACT_PREFIXES = (
    "task_context.normalized_question",
    "task_context.judgment_landing",
    "task_context.task_type",
    "task_context.scope",
    "scope_graph.root_scope_ref",
    "decision_target",
)
PRESENTATION_PREFIXES = ("presentation.", "delivery.", "expression.", "stage_05.")

BINDING_FIELDS = {
    "state_variable_refs": "state_variable_refs",
    "hypothesis_refs": "hypothesis_refs",
    "path_refs": "path_refs",
    "judgment_unit_refs": "judgment_unit_refs",
    "evidence_requirement_refs": "evidence_requirement_refs",
    "scope_refs": "scope_refs",
    "competing_explanation_refs": "competing_explanation_refs",
    "relation_type_refs": "relation_type_refs",
    "object_type_refs": "object_type_refs",
}

OBJECT_LAYER = {
    "SourceDocument": 0,
    "EvidenceClaim": 0,
    "EvidenceFact": 0,
    "EvidenceAssessment": 0,
    "StateVariable": 1,
    "Observation": 1,
    "Event": 1,
    "Signal": 1,
    "MarketExpectation": 1,
    "Hypothesis": 2,
    "Scenario": 2,
    "RuleEvaluation": 3,
    "Judgment": 4,
    "ExpectationGap": 5,
    "AssetImpact": 5,
    "ReasoningTrace": 5,
    "ValidationRecord": 5,
    # ReportClaim 是 04/05 的发布投影，不是正式本体新增对象。
    "ReportClaim": 6,
}
HANDLED_CONFLICT_STATUSES = {"resolved", "contested", "blocked"}
SHA256_RE = re.compile(r"^sha256:[0-9a-f]{64}$")

OBJECT_STAGE_RULES = {
    "SourceDocument": {"stage_03"},
    "EvidenceClaim": {"stage_03"},
    "EvidenceFact": {"stage_03"},
    "EvidenceAssessment": {"stage_03"},
    "Observation": {"stage_03"},
    "Event": {"stage_03"},
    "Signal": {"stage_03"},
    "MarketExpectation": {"stage_03", "stage_04"},
    "StateVariable": {"stage_02"},
    "Hypothesis": {"stage_04"},
    "Scenario": {"stage_04"},
    "RuleEvaluation": {"stage_04"},
    "Judgment": {"stage_04"},
    "ExpectationGap": {"stage_04"},
    "AssetImpact": {"stage_04"},
    "ReasoningTrace": {"stage_04"},
    "ValidationRecord": {"stage_04"},
    "ReportClaim": {"stage_05"},
}


class ResearchLoopError(ValueError):
    """证据闭环输入或状态合同错误。"""


def _mapping(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ResearchLoopError(f"{label} 必须是对象")
    return dict(value)


def _list(value: Any, label: str) -> list[Any]:
    if not isinstance(value, list):
        raise ResearchLoopError(f"{label} 必须是列表")
    return list(value)


def _string_list(value: Any, label: str, *, allow_empty: bool = True) -> list[str]:
    items = _list(value, label)
    if any(item is None for item in items):
        raise ResearchLoopError(f"{label} 不得包含 null 引用")
    result = [str(item).strip() for item in items]
    if any(not item for item in result):
        raise ResearchLoopError(f"{label} 不得包含空引用")
    if not allow_empty and not result:
        raise ResearchLoopError(f"{label} 不得为空")
    if len(result) != len(set(result)):
        raise ResearchLoopError(f"{label} 不得包含重复引用")
    return result


def _ref_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _parse_datetime(value: Any, label: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ResearchLoopError(f"{label} 不得为空")
    try:
        datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ResearchLoopError(f"{label} 必须为 ISO 8601 时间") from exc
    return text


def load_yaml(path: str | Path) -> dict[str, Any]:
    file_path = Path(path)
    value = yaml.safe_load(file_path.read_text(encoding="utf-8"))
    return _mapping(value, str(file_path))


def canonical_sha256(value: Any) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(payload.encode("utf-8")).hexdigest()


def artifact_sha256(path: str | Path) -> str:
    artifact = Path(path)
    if artifact.is_file():
        digest = hashlib.sha256()
        with artifact.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return "sha256:" + digest.hexdigest()
    if not artifact.is_dir():
        raise ResearchLoopError(f"阶段 artifact 不存在: {artifact}")
    digest = hashlib.sha256()
    for child in sorted(item for item in artifact.rglob("*") if item.is_file()):
        relative = child.relative_to(artifact).as_posix()
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(artifact_sha256(child).encode("ascii"))
        digest.update(b"\n")
    return "sha256:" + digest.hexdigest()


def stage_artifact_hash(run_dir: str | Path, artifact_refs: Iterable[str]) -> str:
    root = Path(run_dir).resolve()
    payload: list[dict[str, str]] = []
    for raw_ref in sorted(set(str(item) for item in artifact_refs)):
        path = Path(raw_ref)
        path = path if path.is_absolute() else root / path
        try:
            relative = path.resolve().relative_to(root).as_posix()
        except ValueError as exc:
            raise ResearchLoopError(f"阶段 artifact 超出运行目录: {path}") from exc
        payload.append({"path": relative, "hash": artifact_sha256(path)})
    return canonical_sha256(payload)


def evidence_wave_hash(wave: Mapping[str, Any]) -> str:
    payload = {key: value for key, value in wave.items() if key != "wave_hash"}
    return canonical_sha256(payload)


def _ontology_catalog() -> tuple[set[str], set[str]]:
    object_types: set[str] = set()
    relation_types: set[str] = set()
    for filename in ("common.yaml", "semantic.yaml", "evidence.yaml", "reasoning.yaml"):
        path = ROOT / "ontology/01_通用" / filename
        schema = load_yaml(path)
        object_types.update(str(item) for item in schema.get("object_types", {}))
        relation_types.update(str(item) for item in schema.get("relation_types", {}))
    return object_types, relation_types


def _ontology_relation_definitions() -> dict[str, dict[str, Any]]:
    relations: dict[str, dict[str, Any]] = {}
    for filename in ("common.yaml", "semantic.yaml", "evidence.yaml", "reasoning.yaml"):
        schema = load_yaml(ROOT / "ontology/01_通用" / filename)
        for relation_id, definition in schema.get("relation_types", {}).items():
            if isinstance(definition, dict):
                relations[str(relation_id)] = dict(definition)
    return relations


def validate_evidence_wave(wave: Mapping[str, Any]) -> dict[str, Any]:
    value = _mapping(wave, "evidence_wave")
    if value.get("schema_name") != "ontology_evidence_wave":
        raise ResearchLoopError("evidence_wave.schema_name 必须为 ontology_evidence_wave")
    if str(value.get("schema_version")) != EVIDENCE_WAVE_SCHEMA_VERSION:
        raise ResearchLoopError(
            f"evidence_wave.schema_version 必须为 {EVIDENCE_WAVE_SCHEMA_VERSION}"
        )
    for field in ("wave_id", "task_id", "run_id"):
        if not str(value.get(field, "")).strip():
            raise ResearchLoopError(f"evidence_wave.{field} 不得为空")
    if value.get("wave_status") != "frozen":
        raise ResearchLoopError("证据循环只接受 wave_status=frozen 的批次，不按单条来源触发")
    _parse_datetime(value.get("frozen_at"), "evidence_wave.frozen_at")
    if not str(value.get("source_02_view_hash", "")).strip():
        raise ResearchLoopError("evidence_wave.source_02_view_hash 不得为空")

    _string_list(value.get("evidence_refs", []), "evidence_wave.evidence_refs")
    deltas = _list(value.get("ontology_deltas", []), "evidence_wave.ontology_deltas")
    task_deltas = _list(
        value.get("task_contract_deltas", []), "evidence_wave.task_contract_deltas"
    )
    presentation_deltas = _list(
        value.get("presentation_deltas", []), "evidence_wave.presentation_deltas"
    )
    if not value.get("evidence_refs") and not deltas and not task_deltas and not presentation_deltas:
        raise ResearchLoopError("冻结波次至少包含证据、正式本体 delta、任务合同变化或表达变化之一")

    object_types, relation_types = _ontology_catalog()
    delta_ids: set[str] = set()
    for index, raw in enumerate(deltas, 1):
        delta = _mapping(raw, f"evidence_wave.ontology_deltas[{index}]")
        delta_id = str(delta.get("delta_id", "")).strip()
        if not delta_id or delta_id in delta_ids:
            raise ResearchLoopError(f"ontology_deltas[{index}].delta_id 为空或重复")
        delta_ids.add(delta_id)
        operation = str(delta.get("operation", "")).strip()
        if operation not in {"instantiate", "revise", "relate", "retire"}:
            raise ResearchLoopError(f"{delta_id}.operation 非法: {operation or '<空>'}")
        resource_kind = str(delta.get("resource_kind", "")).strip()
        ontology_ref = str(delta.get("ontology_ref", "")).strip()
        if resource_kind == "object" and ontology_ref not in object_types:
            raise ResearchLoopError(f"{delta_id}.ontology_ref 不是一级正式本体 Object: {ontology_ref}")
        if resource_kind == "relation" and ontology_ref not in relation_types:
            raise ResearchLoopError(f"{delta_id}.ontology_ref 不是一级正式本体 Relation: {ontology_ref}")
        if resource_kind not in {"object", "relation"}:
            raise ResearchLoopError(f"{delta_id}.resource_kind 必须为 object 或 relation")
        if not _ref_text(delta.get("object_ref")):
            raise ResearchLoopError(f"{delta_id}.object_ref 不得为空")
        if operation in {"revise", "retire"} and not _ref_text(delta.get("prior_object_ref")):
            raise ResearchLoopError(f"{delta_id}.{operation} 必须提供 prior_object_ref")
        _string_list(delta.get("evidence_refs", []), f"{delta_id}.evidence_refs")
        _string_list(delta.get("affects_refs", []), f"{delta_id}.affects_refs")
        bindings = _mapping(delta.get("bindings", {}), f"{delta_id}.bindings")
        unknown_fields = sorted(set(bindings) - set(BINDING_FIELDS))
        if unknown_fields:
            raise ResearchLoopError(f"{delta_id}.bindings 含未知引用族: {unknown_fields}")
        for field in BINDING_FIELDS:
            _string_list(bindings.get(field, []), f"{delta_id}.bindings.{field}")

    change_ids: set[str] = set()
    for label, changes in (
        ("task_contract_deltas", task_deltas),
        ("presentation_deltas", presentation_deltas),
    ):
        for index, raw in enumerate(changes, 1):
            change = _mapping(raw, f"evidence_wave.{label}[{index}]")
            change_id = str(change.get("change_id", "")).strip()
            field_ref = str(change.get("field_ref", "")).strip()
            if not change_id or change_id in change_ids or not field_ref:
                raise ResearchLoopError(f"{label}[{index}] change_id/field_ref 为空或重复")
            change_ids.add(change_id)
            if label == "presentation_deltas" and not field_ref.startswith(PRESENTATION_PREFIXES):
                raise ResearchLoopError(
                    f"{change_id}.field_ref 不是 05 表达字段；语义变化不得伪装成 presentation_delta"
                )

    expected_hash = evidence_wave_hash(value)
    declared_hash = str(value.get("wave_hash", "")).strip()
    if declared_hash and declared_hash != expected_hash:
        raise ResearchLoopError("evidence_wave.wave_hash 与冻结内容不一致")
    value["wave_hash"] = expected_hash
    return value


def _add_strings(target: set[str], value: Any) -> None:
    if isinstance(value, str) and value.strip():
        target.add(value.strip())
    elif isinstance(value, list):
        for item in value:
            _add_strings(target, item)
    elif isinstance(value, dict):
        for item in value.values():
            if isinstance(item, (str, list)):
                _add_strings(target, item)


def task_view_reference_index(view: Mapping[str, Any]) -> dict[str, set[str]]:
    """提取 02 已冻结的结构引用；不从正文猜测业务参数。"""
    try:
        value = _mapping(materialize_document(view), "task_ontology_view")
    except ValueError as exc:
        raise ResearchLoopError(f"02 business_instance_graph 无法物化: {exc}") from exc
    if value.get("schema_name") != "task_ontology_view":
        raise ResearchLoopError("02 输入必须是 task_ontology_view")
    index = {field: set() for field in BINDING_FIELDS.values()}

    plan = _mapping(value.get("reasoning_plan", {}), "02.reasoning_plan")
    _add_strings(index["state_variable_refs"], plan.get("state_variable_refs", []))
    _add_strings(index["path_refs"], plan.get("path_refs", []))
    for slot in plan.get("hypothesis_slots", []) or []:
        if isinstance(slot, dict):
            _add_strings(index["hypothesis_refs"], slot.get("hypothesis_slot_id"))
            _add_strings(index["state_variable_refs"], slot.get("state_variable_refs", []))

    path_design = _mapping(value.get("path_design", {}), "02.path_design")
    for path in path_design.get("main_paths", []) or []:
        if isinstance(path, dict):
            _add_strings(index["path_refs"], path.get("path_id"))
    for item in path_design.get("competing_explanations", []) or []:
        if isinstance(item, dict):
            _add_strings(index["competing_explanation_refs"], item.get("explanation_id"))

    for unit in value.get("judgment_units", []) or []:
        if isinstance(unit, dict):
            _add_strings(index["judgment_unit_refs"], unit.get("judgment_unit_id"))
            _add_strings(index["path_refs"], unit.get("linked_paths", []))
    for requirement in value.get("evidence_requirements", []) or []:
        if isinstance(requirement, dict):
            _add_strings(
                index["evidence_requirement_refs"], requirement.get("evidence_requirement_id")
            )
            _add_strings(
                index["state_variable_refs"], requirement.get("linked_state_variables", [])
            )

    graph = _mapping(value.get("scope_graph", {}), "02.scope_graph")
    _add_strings(index["scope_refs"], graph.get("root_scope_ref"))
    for node in graph.get("nodes", []) or []:
        if isinstance(node, dict):
            _add_strings(index["scope_refs"], node.get("scope_ref"))

    semantic_scope = _mapping(value.get("semantic_scope", {}), "02.semantic_scope")
    _add_strings(index["object_type_refs"], semantic_scope.get("object_type_refs", []))
    bindings = _mapping(value.get("ontology_bindings", {}), "02.ontology_bindings")
    _add_strings(index["object_type_refs"], bindings.get("selected_objects", []))
    if str(value.get("schema_version")) == "2.2.0":
        # 2.2 的允许推理关系只以 reasoning_plan 的冻结列表为准。
        _add_strings(index["relation_type_refs"], plan.get("relation_type_refs", []))
    else:
        _add_strings(index["relation_type_refs"], semantic_scope.get("relation_type_refs", []))
        _add_strings(index["relation_type_refs"], bindings.get("selected_relations", []))
    for variable in bindings.get("selected_state_variables", []) or []:
        if isinstance(variable, dict):
            _add_strings(index["state_variable_refs"], variable.get("state_variable_id"))
            _add_strings(index["state_variable_refs"], variable.get("ontology_ref"))

    return index


def _higher_classification(left: str, right: str) -> str:
    return left if CLASSIFICATION_PRIORITY[left] >= CLASSIFICATION_PRIORITY[right] else right


def _delta_classification(
    delta: Mapping[str, Any],
    known: Mapping[str, set[str]],
) -> tuple[str, list[str]]:
    classification = "evidence_update"
    reasons: list[str] = []
    ontology_ref = str(delta["ontology_ref"])
    operation = str(delta["operation"])
    resource_kind = str(delta["resource_kind"])
    bindings = _mapping(delta.get("bindings", {}), f"{delta['delta_id']}.bindings")

    unknown: dict[str, list[str]] = {}
    for field, family in BINDING_FIELDS.items():
        refs = [str(item) for item in bindings.get(field, [])]
        missing = sorted(set(refs) - set(known[family]))
        if missing:
            unknown[field] = missing
    if unknown:
        classification = "reasoning_structure_revision"
        reasons.append(
            f"{delta['delta_id']} 引用了 02 未冻结的结构引用: "
            + "; ".join(f"{field}={refs}" for field, refs in sorted(unknown.items()))
        )

    if operation in {"revise", "retire"} and (
        ontology_ref in STRUCTURAL_OBJECT_TYPES or ontology_ref in STRUCTURAL_RELATION_TYPES
    ):
        classification = "reasoning_structure_revision"
        reasons.append(f"{delta['delta_id']} 修订或退役了结构资源 {ontology_ref}")

    if resource_kind == "object" and ontology_ref in STRUCTURAL_OBJECT_TYPES:
        classification = "reasoning_structure_revision"
        reasons.append(f"{delta['delta_id']} 新增或变更了结构对象 {ontology_ref}")

    if resource_kind == "relation" and ontology_ref in STRUCTURAL_RELATION_TYPES:
        selected = ontology_ref in known["relation_type_refs"]
        mapped_path = bool(bindings.get("path_refs") or bindings.get("hypothesis_refs"))
        if not selected or not mapped_path:
            classification = "reasoning_structure_revision"
            reasons.append(
                f"{delta['delta_id']} 形成了 02 未完整容纳的结构关系 {ontology_ref}"
            )

    if classification == "evidence_update":
        if resource_kind == "object" and ontology_ref in EVIDENCE_SIDE_OBJECT_TYPES:
            reasons.append(f"{delta['delta_id']} 是既有结构内的 {ontology_ref} 更新")
        else:
            reasons.append(f"{delta['delta_id']} 已映射到 02 冻结的本体结构")
    return classification, reasons


def classify_evidence_wave(
    view: Mapping[str, Any],
    wave: Mapping[str, Any],
    *,
    seen_wave_hashes: Iterable[str] = (),
) -> dict[str, Any]:
    value = validate_evidence_wave(wave)
    try:
        projected_view = _mapping(materialize_document(view), "task_ontology_view")
    except ValueError as exc:
        raise ResearchLoopError(f"02 business_instance_graph 无法物化: {exc}") from exc
    task_context = _mapping(projected_view.get("task_context", {}), "02.task_context")
    if str(value.get("task_id")) != str(task_context.get("task_id")):
        raise ResearchLoopError("evidence_wave.task_id 与当前 02 任务不一致")
    declared_view_hash = _ref_text(task_context.get("view_hash"))
    if declared_view_hash and not declared_view_hash.startswith("<"):
        if declared_view_hash != task_view_hash(projected_view):
            raise ResearchLoopError("02 task_context.view_hash 与当前视图内容不一致")
        if str(value.get("source_02_view_hash")) != declared_view_hash:
            raise ResearchLoopError("evidence_wave.source_02_view_hash 未绑定当前 02 view_hash")
    wave_hash = str(value["wave_hash"])
    if wave_hash in {str(item) for item in seen_wave_hashes}:
        return {
            "classification": "no_semantic_delta",
            "return_to_stage": None,
            "rerun_stages": [],
            "reasons": ["相同 wave_hash 已应用；重复来源批次不触发新的语义循环"],
            "unknown_bindings": {},
            "wave_hash": wave_hash,
        }

    known = task_view_reference_index(projected_view)
    classification = "no_semantic_delta"
    reasons: list[str] = []
    unknown_bindings: dict[str, dict[str, list[str]]] = {}

    task_deltas = value.get("task_contract_deltas", []) or []
    for change in task_deltas:
        field_ref = str(change["field_ref"])
        if field_ref.startswith(PRESENTATION_PREFIXES):
            candidate = "presentation_revision"
        elif field_ref.startswith(TASK_CONTRACT_PREFIXES):
            candidate = "task_contract_revision"
        else:
            candidate = "reasoning_structure_revision"
        classification = _higher_classification(classification, candidate)
        reasons.append(f"{change['change_id']} 改变 {field_ref}，返回 {RETURN_TO_STAGE[candidate]}")

    for delta in value.get("ontology_deltas", []) or []:
        candidate, delta_reasons = _delta_classification(delta, known)
        classification = _higher_classification(classification, candidate)
        reasons.extend(delta_reasons)
        bindings = _mapping(delta.get("bindings", {}), f"{delta['delta_id']}.bindings")
        missing_by_field: dict[str, list[str]] = {}
        for field, family in BINDING_FIELDS.items():
            missing = sorted(set(str(item) for item in bindings.get(field, [])) - known[family])
            if missing:
                missing_by_field[field] = missing
        if missing_by_field:
            unknown_bindings[str(delta["delta_id"])] = missing_by_field

    if value.get("evidence_refs") and classification == "no_semantic_delta":
        classification = "evidence_update"
        reasons.append("冻结批次含新证据，且未发现任务或推理结构变化")
    if value.get("presentation_deltas"):
        classification = _higher_classification(classification, "presentation_revision")
        reasons.extend(
            f"{item['change_id']} 仅改变表达投影 {item['field_ref']}"
            for item in value["presentation_deltas"]
        )

    if classification == "no_semantic_delta" and not reasons:
        reasons.append("冻结批次未产生新的证据或语义变化")
    return {
        "classification": classification,
        "return_to_stage": RETURN_TO_STAGE[classification],
        "rerun_stages": CLASSIFICATION_STAGES[classification],
        "reasons": reasons,
        "unknown_bindings": unknown_bindings,
        "wave_hash": wave_hash,
    }


def validate_dependency_projection(projection: Mapping[str, Any]) -> dict[str, Any]:
    value = _mapping(projection, "dependency_projection")
    if value.get("schema_name") != "ontology_dependency_projection":
        raise ResearchLoopError(
            "dependency_projection.schema_name 必须为 ontology_dependency_projection"
        )
    if str(value.get("schema_version")) != DEPENDENCY_PROJECTION_SCHEMA_VERSION:
        raise ResearchLoopError(
            "dependency_projection.schema_version 必须为 "
            + DEPENDENCY_PROJECTION_SCHEMA_VERSION
        )
    for field in ("task_id", "run_id"):
        if not str(value.get(field, "")).strip():
            raise ResearchLoopError(f"dependency_projection.{field} 不得为空")
    if not SHA256_RE.fullmatch(str(value.get("source_02_view_hash", "")).strip()):
        raise ResearchLoopError("dependency_projection.source_02_view_hash 必须为完整 sha256 哈希")
    object_types, relation_types = _ontology_catalog()
    relation_definitions = _ontology_relation_definitions()
    allowed_types = object_types | {"ReportClaim"}
    nodes = _list(value.get("nodes", []), "dependency_projection.nodes")
    edges = _list(value.get("edges", []), "dependency_projection.edges")
    node_index: dict[str, dict[str, Any]] = {}
    for index, raw in enumerate(nodes, 1):
        node = _mapping(raw, f"dependency_projection.nodes[{index}]")
        ref = str(node.get("object_ref", "")).strip()
        object_type = str(node.get("object_type_ref", "")).strip()
        stage = str(node.get("stage", "")).strip()
        if not ref or ref in node_index:
            raise ResearchLoopError(f"dependency_projection.nodes[{index}].object_ref 为空或重复")
        if object_type not in allowed_types:
            raise ResearchLoopError(f"{ref}.object_type_ref 不是正式本体对象或 ReportClaim 投影")
        if stage not in STAGES:
            raise ResearchLoopError(f"{ref}.stage 非法: {stage}")
        allowed_stages = OBJECT_STAGE_RULES.get(object_type, {"stage_02", "stage_03"})
        if stage not in allowed_stages:
            raise ResearchLoopError(
                f"{ref}.stage={stage} 与 {object_type} 的阶段归属不一致"
            )
        if not SHA256_RE.fullmatch(str(node.get("content_hash", "")).strip()):
            raise ResearchLoopError(f"{ref}.content_hash 必须为完整 sha256 哈希")
        if str(node.get("validity_status", "current")) not in {
            "current", "stale", "revalidation_required", "missing"
        }:
            raise ResearchLoopError(f"{ref}.validity_status 非法")
        if not isinstance(node.get("critical", False), bool):
            raise ResearchLoopError(f"{ref}.critical 必须为布尔值")
        node_index[ref] = node

    edge_ids: set[str] = set()
    for index, raw in enumerate(edges, 1):
        edge = _mapping(raw, f"dependency_projection.edges[{index}]")
        edge_id = str(edge.get("dependency_ref", "")).strip()
        upstream = str(edge.get("upstream_ref", "")).strip()
        downstream = str(edge.get("downstream_ref", "")).strip()
        basis = str(edge.get("basis_relation_ref", "")).strip()
        if not edge_id or edge_id in edge_ids:
            raise ResearchLoopError(f"dependency_projection.edges[{index}].dependency_ref 为空或重复")
        edge_ids.add(edge_id)
        if upstream not in node_index or downstream not in node_index:
            raise ResearchLoopError(f"{edge_id} 的上下游引用未在 nodes 中定义")
        if upstream == downstream:
            raise ResearchLoopError(f"{edge_id} 不得自环")
        if basis not in relation_types and basis != "stageProjection":
            raise ResearchLoopError(
                f"{edge_id}.basis_relation_ref 必须引用正式本体 Relation；ReportClaim 可使用 stageProjection"
            )
        up_type = str(node_index[upstream]["object_type_ref"])
        down_type = str(node_index[downstream]["object_type_ref"])
        if basis == "stageProjection":
            if down_type != "ReportClaim":
                raise ResearchLoopError(f"{edge_id} 只有指向 ReportClaim 时才可使用 stageProjection")
        else:
            definition = relation_definitions[basis]
            sources = set(str(item) for item in definition.get("source_types", []))
            targets = set(str(item) for item in definition.get("target_types", []))
            endpoints_match = (
                up_type in sources and down_type in targets
            ) or (
                down_type in sources and up_type in targets
            )
            if not endpoints_match:
                raise ResearchLoopError(
                    f"{edge_id} 的对象类型 {up_type}/{down_type} 不受正式关系 {basis} 连接"
                )
        if OBJECT_LAYER.get(down_type, 99) < OBJECT_LAYER.get(up_type, 99):
            raise ResearchLoopError(f"{edge_id} 的依赖方向逆于证据→判断→表达传播方向")
    return value


def wave_affected_refs(wave: Mapping[str, Any]) -> set[str]:
    value = validate_evidence_wave(wave)
    deltas = value.get("ontology_deltas", []) or []
    refs: set[str] = set()
    has_explicit_impact_mapping = any(delta.get("affects_refs") for delta in deltas)
    if not has_explicit_impact_mapping:
        refs.update(str(item) for item in value.get("evidence_refs", []))
    for delta in deltas:
        affects_refs = [str(item) for item in delta.get("affects_refs", [])]
        if affects_refs:
            # instantiate 产生的 object_ref/evidence_ref 尚不在旧投影中；显式
            # affects_refs 才是本轮失效传播的旧图入口。
            refs.update(affects_refs)
            prior_ref = _ref_text(delta.get("prior_object_ref"))
            if prior_ref:
                refs.add(prior_ref)
            if str(delta.get("operation")) != "instantiate":
                object_ref = _ref_text(delta.get("object_ref"))
                if object_ref:
                    refs.add(object_ref)
            continue
        for field in ("object_ref", "prior_object_ref"):
            ref = _ref_text(delta.get(field))
            if ref:
                refs.add(ref)
        refs.update(str(item) for item in delta.get("evidence_refs", []))
    return refs


def propagate_object_staleness(
    projection: Mapping[str, Any],
    changed_refs: Iterable[str],
) -> dict[str, Any]:
    value = validate_dependency_projection(projection)
    nodes = {
        str(item["object_ref"]): dict(item)
        for item in value.get("nodes", [])
        if isinstance(item, dict)
    }
    adjacency: dict[str, list[str]] = defaultdict(list)
    for edge in value.get("edges", []) or []:
        adjacency[str(edge["upstream_ref"])].append(str(edge["downstream_ref"]))

    triggers = sorted(set(str(item) for item in changed_refs if str(item).strip()))
    queue: deque[tuple[str, str]] = deque()
    invalidated_by: dict[str, set[str]] = defaultdict(set)
    unresolved = []
    for trigger in triggers:
        if trigger not in nodes:
            unresolved.append(trigger)
            continue
        queue.append((trigger, trigger))
    while queue:
        current, trigger = queue.popleft()
        if trigger in invalidated_by[current]:
            continue
        invalidated_by[current].add(trigger)
        for downstream in adjacency.get(current, []):
            queue.append((downstream, trigger))

    stale_objects: list[dict[str, Any]] = []
    for ref, trigger_refs in invalidated_by.items():
        node = nodes[ref]
        stale_objects.append({
            "object_ref": ref,
            "object_type_ref": str(node["object_type_ref"]),
            "stage": str(node["stage"]),
            "critical": bool(node.get("critical", False)),
            "prior_validity_status": str(node.get("validity_status", "current")),
            "validity_status": "stale",
            "invalidated_by_refs": sorted(trigger_refs),
        })
    stale_objects.sort(key=lambda item: (
        OBJECT_LAYER.get(str(item["object_type_ref"]), 99),
        STAGES.index(item["stage"]),
        item["object_ref"],
    ))
    return {
        "changed_refs": triggers,
        "unresolved_changed_refs": sorted(unresolved),
        "stale_objects": stale_objects,
        "stale_object_refs": [item["object_ref"] for item in stale_objects],
        "critical_stale_refs": [item["object_ref"] for item in stale_objects if item["critical"]],
        "affected_stages": [
            stage for stage in STAGES
            if any(item["stage"] == stage for item in stale_objects)
        ],
    }


def _affected_subsets(stale_objects: Iterable[Mapping[str, Any]]) -> dict[str, list[str]]:
    result: dict[str, list[str]] = defaultdict(list)
    for item in stale_objects:
        object_type = str(item.get("object_type_ref", ""))
        ref = str(item.get("object_ref", ""))
        if object_type == "Hypothesis":
            result["hypothesis_refs"].append(ref)
        elif object_type == "RuleEvaluation":
            result["rule_evaluation_refs"].append(ref)
        elif object_type == "Judgment":
            result["judgment_refs"].append(ref)
        elif object_type in {"ExpectationGap", "AssetImpact"}:
            result["pricing_reasoning_refs"].append(ref)
        elif object_type == "ReportClaim":
            result["report_claim_refs"].append(ref)
        elif object_type in {"Observation", "Event", "Signal", "MarketExpectation"}:
            result["reasoning_input_refs"].append(ref)
    return {key: sorted(set(values)) for key, values in sorted(result.items())}


def build_iteration_plan(
    view: Mapping[str, Any],
    wave: Mapping[str, Any],
    *,
    dependency_projection: Mapping[str, Any] | None = None,
    seen_wave_hashes: Iterable[str] = (),
) -> dict[str, Any]:
    validated_wave = validate_evidence_wave(wave)
    classification = classify_evidence_wave(
        view, validated_wave, seen_wave_hashes=seen_wave_hashes
    )
    stale = {
        "changed_refs": sorted(wave_affected_refs(validated_wave)),
        "unresolved_changed_refs": [],
        "stale_objects": [],
        "stale_object_refs": [],
        "critical_stale_refs": [],
        "affected_stages": [],
    }
    if dependency_projection is not None and classification["classification"] != "no_semantic_delta":
        projection = validate_dependency_projection(dependency_projection)
        if str(projection.get("source_02_view_hash")) != str(validated_wave["source_02_view_hash"]):
            raise ResearchLoopError("证据波次与对象依赖投影未绑定同一 02 view_hash")
        if str(projection.get("task_id")) != str(validated_wave.get("task_id")):
            raise ResearchLoopError("证据波次与对象依赖投影的 task_id 不一致")
        if str(projection.get("run_id")) != str(validated_wave.get("run_id")):
            raise ResearchLoopError("证据波次与对象依赖投影的 run_id 不一致")
        stale = propagate_object_staleness(projection, wave_affected_refs(validated_wave))

    classification_name = str(classification["classification"])
    affected_stages = set(stale["affected_stages"])
    if classification_name == "no_semantic_delta":
        required_stages = []
    elif classification_name == "presentation_revision":
        required_stages = ["stage_05"]
    elif classification_name == "task_contract_revision":
        required_stages = list(STAGES)
    elif classification_name == "reasoning_structure_revision":
        downstream = [stage for stage in STAGES[2:] if stage in affected_stages]
        required_stages = ["stage_02", *downstream]
        if dependency_projection is None or stale["unresolved_changed_refs"] or not downstream:
            required_stages = list(STAGES[1:])
    else:
        required_stages = ["stage_03"]
        required_stages.extend(stage for stage in STAGES[3:] if stage in affected_stages)
        if dependency_projection is None or stale["unresolved_changed_refs"]:
            required_stages = list(STAGES[2:])
    structurally_unscoped = bool(
        classification["classification"] in {
            "reasoning_structure_revision", "task_contract_revision"
        }
        and dependency_projection is not None
        and (not stale["stale_objects"] or bool(stale["unresolved_changed_refs"]))
    )
    plan = {
        "schema_name": "ontology_research_iteration_plan",
        "schema_version": LOOP_PLAN_SCHEMA_VERSION,
        "task_id": validated_wave["task_id"],
        "run_id": validated_wave["run_id"],
        "wave_id": validated_wave["wave_id"],
        "wave_hash": validated_wave["wave_hash"],
        "source_02_view_hash": validated_wave["source_02_view_hash"],
        "classification": classification["classification"],
        "classification_reasons": classification["reasons"],
        "return_to_stage": classification["return_to_stage"],
        "required_stage_attempts": required_stages,
        "stage_02_checkpoint": (
            "full_quality_gate_required"
            if classification["classification"] == "reasoning_structure_revision"
            else "not_required"
        ),
        "ontology_authority": {
            "source": "ontology/01_通用 + 02 task_ontology_view",
            "business_parameters_defined_here": False,
            "projection_only": True,
        },
        "unknown_02_bindings": classification["unknown_bindings"],
        "stale_propagation": stale,
        "affected_object_subsets": _affected_subsets(stale["stale_objects"]),
        "structural_impact_scope_unresolved": structurally_unscoped,
        "automatic_actions": [
            {
                "stage": stage,
                "action": "create_immutable_attempt",
                "supersedes_current_attempt": True,
            }
            for stage in required_stages
        ],
        "convergence_blockers": [
            *(["pending_structural_checkpoint"] if classification["classification"] == "reasoning_structure_revision" else []),
            *(["critical_stale_objects"] if stale["critical_stale_refs"] else []),
            *(["unresolved_changed_refs"] if stale["unresolved_changed_refs"] else []),
            *(["structural_impact_scope_unresolved"] if structurally_unscoped else []),
            *(["pending_stage_attempts"] if required_stages else []),
        ],
    }
    plan["plan_hash"] = canonical_sha256(plan)
    return plan


def convergence_status(loop_state: Mapping[str, Any]) -> dict[str, Any]:
    """按语义状态判定收敛；刻意不接受 max_iterations 一类次数上限。"""
    state = _mapping(loop_state, "loop_state")
    forbidden = sorted(set(state) & {"max_iterations", "max_loop_count", "iteration_limit"})
    if forbidden:
        raise ResearchLoopError("收敛不得由语义无关的循环次数上限决定: " + ", ".join(forbidden))

    pending_structural = _string_list(
        state.get("pending_structural_trigger_refs", []),
        "loop_state.pending_structural_trigger_refs",
    )
    critical_stale = _string_list(
        state.get("critical_stale_refs", []), "loop_state.critical_stale_refs"
    )
    pending_attempts = _string_list(
        state.get("pending_stage_attempts", []), "loop_state.pending_stage_attempts"
    )
    attempt_hashes = _mapping(state.get("attempt_hashes", {}), "loop_state.attempt_hashes")
    noncurrent_hashes: list[str] = []
    for stage, raw in attempt_hashes.items():
        if stage not in STAGES:
            raise ResearchLoopError(f"loop_state.attempt_hashes 含未知阶段: {stage}")
        item = _mapping(raw, f"loop_state.attempt_hashes.{stage}")
        declared = str(item.get("declared_hash", "")).strip()
        actual = str(item.get("actual_hash", "")).strip()
        if not declared or declared != actual:
            noncurrent_hashes.append(stage)

    unresolved_conflicts: list[str] = []
    for index, raw in enumerate(
        _list(state.get("conflicts", []), "loop_state.conflicts"), 1
    ):
        conflict = _mapping(raw, f"loop_state.conflicts[{index}]")
        ref = str(conflict.get("conflict_ref", f"conflict-{index}"))
        status = str(conflict.get("resolution_status", "")).strip()
        if status not in HANDLED_CONFLICT_STATUSES:
            unresolved_conflicts.append(ref)

    latest = _mapping(state.get("latest_wave", {}), "loop_state.latest_wave")
    key_judgment_changed = bool(latest.get("key_judgment_changed", False))
    key_path_changed = bool(latest.get("key_path_changed", False))
    impact_scope_unresolved = bool(state.get("structural_impact_scope_unresolved", False))

    checks = {
        "no_pending_structural_trigger": not pending_structural,
        "no_critical_stale_object": not critical_stale,
        "no_pending_stage_attempt": not pending_attempts,
        "all_attempt_hashes_current": not noncurrent_hashes,
        "all_conflicts_handled": not unresolved_conflicts,
        "latest_wave_did_not_change_key_judgment": not key_judgment_changed,
        "latest_wave_did_not_change_key_path": not key_path_changed,
        "structural_impact_scope_resolved": not impact_scope_unresolved,
    }
    blockers: list[str] = []
    if pending_structural:
        blockers.append("pending_structural_trigger_refs=" + ",".join(pending_structural))
    if critical_stale:
        blockers.append("critical_stale_refs=" + ",".join(critical_stale))
    if pending_attempts:
        blockers.append("pending_stage_attempts=" + ",".join(pending_attempts))
    if noncurrent_hashes:
        blockers.append("noncurrent_attempt_hashes=" + ",".join(noncurrent_hashes))
    if unresolved_conflicts:
        blockers.append("unresolved_conflicts=" + ",".join(unresolved_conflicts))
    if key_judgment_changed:
        blockers.append("latest_wave_changed_key_judgment")
    if key_path_changed:
        blockers.append("latest_wave_changed_key_path")
    if impact_scope_unresolved:
        blockers.append("structural_impact_scope_unresolved")
    return {
        "converged": all(checks.values()),
        "checks": checks,
        "blockers": blockers,
        "semantic_iteration_limit_used": False,
    }


def begin_manifest_attempts(
    manifest: Mapping[str, Any],
    plan: Mapping[str, Any],
    *,
    archive_records: Mapping[str, list[Mapping[str, Any]]] | None = None,
) -> dict[str, Any]:
    """在清单中建立 pending attempt；当前已提交 attempt 保持不变直至显式提交。"""
    result = copy.deepcopy(_mapping(manifest, "run_manifest"))
    if result.get("schema_name") != "controlled_research_run_manifest":
        raise ResearchLoopError("run_manifest.schema_name 非法")
    if str(result.get("schema_version")) != MANIFEST_SCHEMA_VERSION:
        raise ResearchLoopError(f"仅支持 run_manifest {MANIFEST_SCHEMA_VERSION}；旧格式 1.1.0 已删除")
    if str(result.get("task_id")) != str(plan.get("task_id")):
        raise ResearchLoopError("iteration_plan.task_id 与 run_manifest 不一致")
    if str(result.get("run_id")) != str(plan.get("run_id")):
        raise ResearchLoopError("iteration_plan.run_id 与 run_manifest 不一致")
    stages = _mapping(result.get("stages"), "run_manifest.stages")
    required = [str(item) for item in plan.get("required_stage_attempts", [])]
    archives = dict(archive_records or {})
    for stage in STAGES:
        if stage not in stages:
            raise ResearchLoopError(f"run_manifest 缺少阶段: {stage}")
        entry = _mapping(stages[stage], f"run_manifest.stages.{stage}")
        entry.setdefault("attempt_history", [])
        entry.setdefault("pending_attempt", None)
        stages[stage] = entry
    for stage in required:
        if stage not in STAGES or stage not in stages:
            raise ResearchLoopError(f"iteration_plan 包含未知阶段: {stage}")
        entry = _mapping(stages[stage], f"run_manifest.stages.{stage}")
        if entry.get("pending_attempt") is not None:
            raise ResearchLoopError(f"{stage} 已存在 pending_attempt，必须先提交或撤销")
        current_attempt = int(entry.get("attempt", 1))
        history = entry["attempt_history"]
        if not any(
            isinstance(item, dict) and int(item.get("attempt", -1)) == current_attempt
            for item in history
        ):
            history.append({
                "attempt": current_attempt,
                "supersedes_attempt": entry.get("supersedes_attempt"),
                "artifact": copy.deepcopy(entry.get("artifact", [])),
                "hash": str(entry.get("hash", "")),
                "source_hashes": copy.deepcopy(entry.get("source_hashes", {})),
                "stage_status": str(entry.get("stage_status", "")),
                "validity_status": str(entry.get("validity_status", "current")),
                "attempt_state": "committed",
                "archived_artifacts": copy.deepcopy(archives.get(stage, [])),
            })
        entry["pending_attempt"] = {
            "attempt": current_attempt + 1,
            "supersedes_attempt": current_attempt,
            "trigger_wave_ref": str(plan.get("wave_id")),
            "trigger_wave_hash": str(plan.get("wave_hash")),
            "classification": str(plan.get("classification")),
            "required_quality_gate": (
                "full_02_quality_gate"
                if stage == "stage_02" and plan.get("stage_02_checkpoint") == "full_quality_gate_required"
                else "stage_quality_gate"
            ),
            "artifact": copy.deepcopy(entry.get("artifact", [])),
            "stale_object_refs": [
                str(item) for item in plan.get("stale_propagation", {}).get("stale_object_refs", [])
                if any(
                    str(obj.get("object_ref")) == str(item) and str(obj.get("stage")) == stage
                    for obj in plan.get("stale_propagation", {}).get("stale_objects", [])
                )
            ],
            "attempt_state": "pending",
        }
        entry["validity_status"] = "revalidation_required"
        stages[stage] = entry
    result["stages"] = stages
    result["schema_version"] = MANIFEST_SCHEMA_VERSION
    result["reasoning_loop"] = {
        "mode": "ontology_evidence_wave",
        "latest_wave_ref": str(plan.get("wave_id")),
        "latest_wave_hash": str(plan.get("wave_hash")),
        "latest_plan_hash": str(plan.get("plan_hash")),
        "loop_state_ref": None,
        "loop_state_hash": None,
        "classification": str(plan.get("classification")),
        "pending_stage_attempts": required,
        "structural_checkpoint_required": plan.get("stage_02_checkpoint") == "full_quality_gate_required",
        "converged": False if required else True,
    }
    return result


def archive_current_attempts(
    manifest: Mapping[str, Any],
    run_dir: str | Path,
    stages_to_archive: Iterable[str],
) -> dict[str, list[dict[str, str]]]:
    """把即将被替代的阶段文件复制到隐藏 archive，防止同名产物覆盖历史 attempt。"""
    value = _mapping(manifest, "run_manifest")
    root = Path(run_dir).resolve()
    stages = _mapping(value.get("stages"), "run_manifest.stages")
    result: dict[str, list[dict[str, str]]] = {}
    for stage in stages_to_archive:
        if stage not in STAGES:
            raise ResearchLoopError(f"未知阶段: {stage}")
        entry = _mapping(stages.get(stage), f"run_manifest.stages.{stage}")
        attempt = int(entry.get("attempt", 1))
        archive_root = root / ".research_attempts" / stage / f"attempt-{attempt:04d}"
        if archive_root.exists():
            raise ResearchLoopError(f"历史 attempt archive 已存在，拒绝覆盖: {archive_root}")
        records: list[dict[str, str]] = []
        refs = [str(item) for item in entry.get("artifact", [])]
        if not refs:
            raise ResearchLoopError(f"{stage} 当前 attempt 没有可归档 artifact")
        for ref in refs:
            source = Path(ref)
            source = source if source.is_absolute() else root / source
            try:
                relative = source.resolve().relative_to(root)
            except ValueError as exc:
                raise ResearchLoopError(f"{stage} artifact 超出运行目录: {source}") from exc
            if not source.exists():
                raise ResearchLoopError(f"{stage} artifact 不存在: {source}")
            destination = archive_root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            if source.is_dir():
                shutil.copytree(source, destination)
            else:
                shutil.copy2(source, destination)
            records.append({
                "source_ref": relative.as_posix(),
                "archive_ref": destination.relative_to(root).as_posix(),
                "content_hash": artifact_sha256(destination),
            })
        result[stage] = records
    return result


def commit_manifest_attempts(
    manifest: Mapping[str, Any],
    run_dir: str | Path,
    *,
    stages_to_commit: Iterable[str] | None = None,
) -> dict[str, Any]:
    """把已完成的 pending attempt 提交为 current，并把旧 attempt 标为 superseded。"""
    result = copy.deepcopy(_mapping(manifest, "run_manifest"))
    if str(result.get("schema_version")) != MANIFEST_SCHEMA_VERSION:
        raise ResearchLoopError("提交 pending attempt 需要 run_manifest 1.2.0")
    stages = _mapping(result.get("stages"), "run_manifest.stages")
    loop = _mapping(result.get("reasoning_loop"), "run_manifest.reasoning_loop")
    pending_stages = [str(item) for item in loop.get("pending_stage_attempts", [])]
    if not pending_stages:
        raise ResearchLoopError("run_manifest 没有待提交的 stage attempt")
    selected = (
        [str(item) for item in stages_to_commit]
        if stages_to_commit is not None
        else list(pending_stages)
    )
    if not selected or not set(selected).issubset(pending_stages):
        raise ResearchLoopError("stages_to_commit 必须是非空 pending stage 子集")
    selected.sort(key=STAGES.index)
    for stage in selected:
        upstream = IMMEDIATE_UPSTREAM[stage]
        if upstream in pending_stages and upstream not in selected:
            raise ResearchLoopError(f"{stage} 的上游 {upstream} 仍是 pending，必须先提交上游")

    artifact_refs: dict[str, list[str]] = {}
    actual_hashes: dict[str, str] = {}
    for stage in STAGES:
        entry = _mapping(stages[stage], f"run_manifest.stages.{stage}")
        pending = entry.get("pending_attempt")
        refs = (
            [str(item) for item in pending.get("artifact", [])]
            if isinstance(pending, dict)
            else [str(item) for item in entry.get("artifact", [])]
        )
        artifact_refs[stage] = refs
        actual_hashes[stage] = stage_artifact_hash(run_dir, refs) if refs else ""

    for stage in selected:
        entry = _mapping(stages[stage], f"run_manifest.stages.{stage}")
        pending = _mapping(entry.get("pending_attempt"), f"{stage}.pending_attempt")
        old_attempt = int(entry.get("attempt", 1))
        if int(pending.get("supersedes_attempt", -1)) != old_attempt:
            raise ResearchLoopError(f"{stage}.pending_attempt 没有替代当前 attempt")
        archived = False
        for history_item in entry.get("attempt_history", []):
            if not isinstance(history_item, dict) or int(history_item.get("attempt", -1)) != old_attempt:
                continue
            history_item["attempt_state"] = "superseded"
            archived = bool(history_item.get("archived_artifacts"))
        if not archived:
            raise ResearchLoopError(f"{stage} 旧 attempt 尚未归档，禁止提交新 attempt")
        entry["attempt"] = int(pending["attempt"])
        entry["supersedes_attempt"] = old_attempt
        entry["artifact"] = artifact_refs[stage]
        entry["hash"] = actual_hashes[stage]
        upstream = IMMEDIATE_UPSTREAM[stage]
        entry["source_hashes"] = {upstream: actual_hashes[upstream]} if upstream else {}
        entry["validity_status"] = "current"
        entry["trigger_wave_refs"] = sorted(set(
            [str(item) for item in entry.get("trigger_wave_refs", [])]
            + [str(pending.get("trigger_wave_ref"))]
        ))
        entry["pending_attempt"] = None
        stages[stage] = entry

    loop["pending_stage_attempts"] = [
        stage for stage in pending_stages if stage not in selected
    ]
    if "stage_02" in selected:
        loop["structural_checkpoint_required"] = False
    loop["converged"] = False
    result["stages"] = stages
    result["reasoning_loop"] = loop
    return result


def _write_yaml(path: Path, value: Mapping[str, Any]) -> None:
    path.write_text(
        yaml.safe_dump(dict(value), allow_unicode=True, sort_keys=False, width=120),
        encoding="utf-8",
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Plan an ontology-driven 02—04 evidence loop.")
    parser.add_argument("--view", required=True, help="02 task_ontology_view YAML")
    parser.add_argument("--wave", required=True, help="冻结的 ontology_evidence_wave YAML")
    parser.add_argument("--dependency-projection", help="对象级依赖投影 YAML")
    parser.add_argument("--seen-wave-hash", action="append", default=[])
    parser.add_argument("--loop-state", help="可选收敛状态 YAML")
    parser.add_argument("--output", help="写入 iteration plan YAML；默认仅输出 JSON")
    parser.add_argument("--manifest", help="可选 run_manifest.yaml")
    parser.add_argument(
        "--apply-manifest",
        action="store_true",
        help="在清单建立 pending attempts；必须同时提供 --manifest",
    )
    args = parser.parse_args(argv)
    try:
        view = load_yaml(args.view)
        wave = load_yaml(args.wave)
        projection = load_yaml(args.dependency_projection) if args.dependency_projection else None
        plan = build_iteration_plan(
            view,
            wave,
            dependency_projection=projection,
            seen_wave_hashes=args.seen_wave_hash,
        )
        payload: dict[str, Any] = {"ok": True, "iteration_plan": plan}
        if args.loop_state:
            payload["convergence"] = convergence_status(load_yaml(args.loop_state))
        if args.output:
            _write_yaml(Path(args.output), plan)
            payload["output"] = str(Path(args.output))
        if args.apply_manifest:
            if not args.manifest:
                raise ResearchLoopError("--apply-manifest 必须同时提供 --manifest")
            manifest_path = Path(args.manifest)
            original = load_yaml(manifest_path)
            # 先做纯合同检查，再归档，避免输入错误留下半成品 archive。
            begin_manifest_attempts(original, plan)
            archives = archive_current_attempts(
                original,
                manifest_path.resolve().parent,
                plan.get("required_stage_attempts", []),
            )
            updated = begin_manifest_attempts(original, plan, archive_records=archives)
            if args.loop_state:
                state_path = Path(args.loop_state).resolve()
                state = load_yaml(state_path)
                convergence = convergence_status(state)
                try:
                    state_ref = state_path.relative_to(manifest_path.resolve().parent).as_posix()
                except ValueError:
                    state_ref = str(state_path)
                updated["reasoning_loop"]["loop_state_ref"] = state_ref
                updated["reasoning_loop"]["loop_state_hash"] = artifact_sha256(state_path)
                updated["reasoning_loop"]["converged"] = bool(convergence["converged"])
            _write_yaml(manifest_path, updated)
            payload["manifest"] = str(manifest_path)
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
