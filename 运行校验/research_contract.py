#!/usr/bin/env python3
"""可控研究链的跨阶段合同、范围、聚合与增量语义校验。"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any, Iterable, Mapping

from ontology_instance_graph import materialize_document
from validator_utils import load_yaml_file, split_refs


ROOT = Path(__file__).resolve().parent.parent
PUBLIC_CONTRACT_PATH = ROOT / "00_全局" / "contracts" / "public_contract.yaml"
ROUTE_REGISTRY_PATH = ROOT / "00_全局" / "contracts" / "judgment_method_routes.yaml"
ONTOLOGY_CONTRACT_PATH = ROOT / "一级通用本体规范" / "common.yaml"
ONTOLOGY_REASONING_PATH = ROOT / "一级通用本体规范" / "reasoning.yaml"
KB02_REGISTRY_PATH = ROOT / "知识库_02框架" / "00_framework_dependency_registry.yaml"
KB03_REGISTRY_PATH = ROOT / "知识库_03取证" / "03_registry.yaml"

SCOPE_DIMENSIONS = {"object", "geography", "customer", "metric", "time"}


class ContractError(ValueError):
    """跨阶段公共合同错误。"""


def _mapping(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ContractError(f"{label} 必须是对象")
    return value


def _task_view_projection(view: Mapping[str, Any]) -> dict[str, Any]:
    """统一从 02 业务实例图物化消费投影。

    磁盘上的 ``business_instance_graph`` 是业务参数权威源；这里返回的
    平铺结构只是为现有跨阶段合同提供的确定性投影。
    """
    try:
        return _mapping(materialize_document(view), "02.task_ontology_view")
    except ValueError as exc:
        raise ContractError(f"02.business_instance_graph 无法物化: {exc}") from exc


def public_contract() -> dict[str, Any]:
    contract = _mapping(load_yaml_file(PUBLIC_CONTRACT_PATH), "public_contract")
    refs = _mapping(contract.get("business_authority_refs", {}), "business_authority_refs")
    for field, raw_ref in refs.items():
        file_ref, pointer = str(raw_ref).split("#", 1)
        node: Any = load_yaml_file(ROOT / file_ref)
        for part in pointer.split("."):
            if part == "@keys":
                node = list(node)
            else:
                node = _mapping(node, f"{raw_ref}:{part}").get(part)
        if not isinstance(node, list):
            raise ContractError(f"{raw_ref} 必须解析为列表")
        contract[str(field)] = list(node)
    return contract


def route_registry() -> dict[str, Any]:
    registry = _mapping(load_yaml_file(ROUTE_REGISTRY_PATH), "judgment_method_routes")
    routes = registry.get("routes")
    if not isinstance(routes, dict) or not routes:
        raise ContractError("judgment_method_routes.routes 不得为空")
    contract_types = set(public_contract().get("judgment_types", []))
    if set(routes) != contract_types:
        missing = sorted(contract_types - set(routes))
        extra = sorted(set(routes) - contract_types)
        raise ContractError(f"公共判断类型与路由表不一致；缺少={missing}，多余={extra}")
    return registry


LEGACY_VERSION_SETS: dict[str, dict[str, str]] = {}  # 已清零；旧合同版本不再提供 fallback。


def current_versions(contract_version: str | None = None) -> dict[str, str]:
    """返回当前公共合同版本集合。

    不再提供 1.1.0 等 legacy 版本集作为 fallback；若调用方显式请求已删除的
    legacy 合同版本，直接报错。其他未知/过期 contract_version 仍返回当前
    版本集，由 validate_run 通过 recorded vs current 对比触发 revalidation。
    """
    requested = str(contract_version or "").strip()
    if requested == "1.1.0":
        raise ContractError("已删除 legacy 版本集；run_manifest 不得再声明 contract=1.1.0")
    contract = public_contract()
    routes = route_registry()
    ontology = _mapping(load_yaml_file(ONTOLOGY_CONTRACT_PATH), "ontology_common")
    ontology_reasoning = _mapping(
        load_yaml_file(ONTOLOGY_REASONING_PATH), "ontology_reasoning"
    )
    kb02 = _mapping(load_yaml_file(KB02_REGISTRY_PATH), "kb02_registry")
    kb03 = _mapping(load_yaml_file(KB03_REGISTRY_PATH), "kb03_registry")
    knowledge_versions = _mapping(routes.get("knowledge_versions"), "knowledge_versions")
    return {
        "contract": str(contract.get("schema_version", "")),
        "ontology": str(ontology.get("schema_version", "")),
        "ontology_reasoning": str(ontology_reasoning.get("schema_version", "")),
        "kb02": str(kb02.get("schema_version", knowledge_versions.get("kb02", ""))),
        "kb03": str(kb03.get("schema_version", knowledge_versions.get("kb03", ""))),
        "kb04": str(knowledge_versions.get("kb04", "")),
        "stage_01_schema": "1.5.0",
        "stage_02_logic_schema": "1.2.0",
        "stage_02_view_schema": "2.2.0",
        "stage_03_schema": "1.4.0",
        "stage_04_brief_schema": "3.0.0",
        "stage_04_audit_schema": "4.0.0",
        "stage_05_audit_schema": "2.6.0",
        "semantic_review_schema": "1.0.0",
    }


def claim_version_hash(claim: Mapping[str, Any]) -> str:
    """稳定 Claim 版本哈希；排除仅用于审计展示的自证字段。"""
    ignored = {"strength_consistency_check", "overreach_check"}
    return canonical_sha256({key: value for key, value in claim.items() if key not in ignored})


def task_view_hash(view: Mapping[str, Any]) -> str:
    """02 task_ontology_view 内容哈希；排除自证字段和纯审计生成时间。"""
    payload = dict(_task_view_projection(view))
    context = dict(payload.get("task_context", {}))
    context.pop("view_hash", None)
    context.pop("generated_at", None)
    payload["task_context"] = context
    return canonical_sha256(payload)


def canonical_sha256(value: Any) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _string_list(value: Any, label: str, *, allow_empty: bool = False) -> list[str]:
    if not isinstance(value, list):
        raise ContractError(f"{label} 必须是列表")
    result = [str(item).strip() for item in value]
    if any(not item for item in result) or (not allow_empty and not result):
        raise ContractError(f"{label} 不得包含空值" if result else f"{label} 不得为空")
    return result


def validate_scope_graph(view: Mapping[str, Any]) -> dict[str, dict[str, Any]]:
    """校验 02 冻结的通用范围图并返回 scope_ref 索引。"""
    view = _task_view_projection(view)
    graph = _mapping(view.get("scope_graph"), "02.scope_graph")
    root_ref = str(graph.get("root_scope_ref", "")).strip()
    nodes = graph.get("nodes")
    if not root_ref or not isinstance(nodes, list) or not nodes:
        raise ContractError("02.scope_graph 必须提供 root_scope_ref 与非空 nodes")
    result: dict[str, dict[str, Any]] = {}
    for index, raw in enumerate(nodes, 1):
        node = _mapping(raw, f"02.scope_graph.nodes[{index}]")
        scope_ref = str(node.get("scope_ref", "")).strip()
        label = str(node.get("label", "")).strip()
        if not scope_ref or not label or scope_ref in result:
            raise ContractError(f"02.scope_graph.nodes[{index}] scope_ref/label 非法或重复")
        dimensions = _mapping(node.get("dimensions"), f"{scope_ref}.dimensions")
        unknown = sorted(set(dimensions) - SCOPE_DIMENSIONS)
        if unknown:
            raise ContractError(f"{scope_ref}.dimensions 含未知维度: {unknown}")
        for dimension, values in dimensions.items():
            _string_list(values, f"{scope_ref}.dimensions.{dimension}")
        parent = node.get("parent_scope_ref")
        if parent is not None and not str(parent).strip():
            raise ContractError(f"{scope_ref}.parent_scope_ref 只能为 null 或非空引用")
        result[scope_ref] = dict(node)
    if root_ref not in result:
        raise ContractError("02.scope_graph.root_scope_ref 未在 nodes 中定义")
    if result[root_ref].get("parent_scope_ref") is not None:
        raise ContractError("02.scope_graph 根节点 parent_scope_ref 必须为 null")
    for scope_ref, node in result.items():
        parent = node.get("parent_scope_ref")
        if scope_ref != root_ref and str(parent or "") not in result:
            raise ContractError(f"{scope_ref}.parent_scope_ref 未在范围图中定义")
        seen: set[str] = set()
        cursor: str | None = scope_ref
        while cursor is not None:
            if cursor in seen:
                raise ContractError(f"02.scope_graph 存在环: {scope_ref}")
            seen.add(cursor)
            raw_parent = result[cursor].get("parent_scope_ref")
            cursor = str(raw_parent) if raw_parent is not None else None
    return result


def _ancestors(scope_ref: str, graph: Mapping[str, Mapping[str, Any]]) -> set[str]:
    if scope_ref not in graph:
        raise ContractError(f"范围引用未定义: {scope_ref}")
    result: set[str] = set()
    cursor: str | None = scope_ref
    while cursor is not None:
        result.add(cursor)
        parent = graph[cursor].get("parent_scope_ref")
        cursor = str(parent) if parent is not None else None
    return result


def derive_scope_relation(
    source_scope_ref: str,
    target_scope_ref: str,
    graph: Mapping[str, Mapping[str, Any]],
) -> str:
    """返回 source 相对 target 的范围关系。"""
    if source_scope_ref == target_scope_ref:
        return "same"
    if target_scope_ref in _ancestors(source_scope_ref, graph):
        return "narrower"
    if source_scope_ref in _ancestors(target_scope_ref, graph):
        return "broader"
    left = graph[source_scope_ref].get("dimensions", {})
    right = graph[target_scope_ref].get("dimensions", {})
    shared = set(left) & set(right)
    if any(set(left[key]) & set(right[key]) for key in shared):
        return "overlap"
    return "incomparable"


def validate_claim_scope(value: Any, graph: Mapping[str, Mapping[str, Any]], label: str) -> dict[str, Any]:
    scope = _mapping(value, label)
    scope_ref = str(scope.get("scope_ref", "")).strip()
    if scope_ref not in graph:
        raise ContractError(f"{label}.scope_ref 未在 02.scope_graph 定义: {scope_ref or '<空>'}")
    _string_list(scope.get("exclusions"), f"{label}.exclusions", allow_empty=True)
    if not str(scope.get("time_basis", "")).strip():
        raise ContractError(f"{label}.time_basis 不得为空")
    return dict(scope)


def derive_aggregation_outcome(
    child_state_codes: Iterable[str],
    *,
    dominant_indexes: set[int] | None = None,
    insufficient_indexes: set[int] | None = None,
) -> str:
    """按 02 预定义主导项和完整子项状态确定父级聚合结果。"""
    states = [str(item).strip() for item in child_state_codes]
    if not states or any(not item for item in states):
        raise ContractError("聚合必须提供完整且非空的 child_state_codes")
    if insufficient_indexes:
        return "insufficient"
    if len(set(states)) == 1:
        return "synchronized"
    dominant_indexes = dominant_indexes or set()
    if dominant_indexes:
        dominant_states = {states[index] for index in dominant_indexes}
        if len(dominant_states) == 1:
            return "dominant"
    return "differentiated"


def validate_aggregation_contracts(
    view: Mapping[str, Any],
    units: Mapping[str, Mapping[str, Any]],
) -> dict[str, dict[str, Any]]:
    view = _task_view_projection(view)
    contracts = view.get("aggregation_contracts")
    if not isinstance(contracts, list):
        raise ContractError("02.aggregation_contracts 必须是列表")
    result: dict[str, dict[str, Any]] = {}
    for index, raw in enumerate(contracts, 1):
        item = _mapping(raw, f"02.aggregation_contracts[{index}]")
        contract_ref = str(item.get("aggregation_contract_ref", "")).strip()
        parent = str(item.get("parent_judgment_unit_ref", "")).strip()
        children = _string_list(item.get("required_child_judgment_unit_refs"), f"{contract_ref}.required_child_judgment_unit_refs")
        dominant = _string_list(item.get("dominant_child_judgment_unit_refs"), f"{contract_ref}.dominant_child_judgment_unit_refs", allow_empty=True)
        if not contract_ref or contract_ref in result or parent not in units:
            raise ContractError(f"02.aggregation_contracts[{index}] ID 或 parent 非法")
        if parent in children or not set(children).issubset(units):
            raise ContractError(f"{contract_ref} 子项引用非法")
        if not set(dominant).issubset(children):
            raise ContractError(f"{contract_ref} 主导子项必须属于必要子项")
        result[contract_ref] = dict(item)
    return result


def judgment_unit_hash(unit: Mapping[str, Any]) -> str:
    """对完整 JU 语义对象计算稳定哈希；排除哈希字段本身。"""
    payload = {key: value for key, value in unit.items() if key not in {"content_hash", "source_02_hash"}}
    return canonical_sha256(payload)


def validate_judgment_units(view: Mapping[str, Any], *, require_hash: bool = True) -> dict[str, dict[str, Any]]:
    view = _task_view_projection(view)
    contract = public_contract()
    allowed_types = set(str(item) for item in contract.get("judgment_types", []))
    legacy = _mapping(contract.get("legacy_judgment_type_migration", {}), "legacy_judgment_type_migration")
    units = view.get("judgment_units")
    if not isinstance(units, list) or not units:
        raise ContractError("02.judgment_units 至少需要一项")
    result: dict[str, dict[str, Any]] = {}
    graph = validate_scope_graph(view)
    stable_keys: set[str] = set()
    for index, raw in enumerate(units, 1):
        unit = _mapping(raw, f"02.judgment_units[{index}]")
        ju_id = str(unit.get("judgment_unit_id", "")).strip()
        if not re.fullmatch(r"JU-\d+", ju_id):
            raise ContractError(f"02.judgment_units[{index}].judgment_unit_id 非法: {ju_id}")
        if ju_id in result:
            raise ContractError(f"02.judgment_units 重复定义 {ju_id}")
        stable_key = str(unit.get("stable_claim_key", "")).strip()
        scope_ref = str(unit.get("claim_scope_ref", "")).strip()
        role = str(unit.get("aggregation_role", "")).strip()
        if not stable_key or stable_key in stable_keys:
            raise ContractError(f"{ju_id}.stable_claim_key 不得为空或重复")
        stable_keys.add(stable_key)
        if scope_ref not in graph:
            raise ContractError(f"{ju_id}.claim_scope_ref 未在 02.scope_graph 定义")
        if role not in {"leaf", "parent"}:
            raise ContractError(f"{ju_id}.aggregation_role 必须为 leaf 或 parent")
        if role == "leaf" and unit.get("aggregation_contract_ref") not in {None, ""}:
            raise ContractError(f"{ju_id} 是 leaf，不得绑定 aggregation_contract_ref")
        if role == "parent" and not str(unit.get("aggregation_contract_ref", "")).strip():
            raise ContractError(f"{ju_id} 是 parent，必须绑定 aggregation_contract_ref")
        judgment_type = str(unit.get("judgment_type", "")).strip()
        if judgment_type not in allowed_types:
            migration = legacy.get(judgment_type, "unknown")
            if migration is None:
                raise ContractError(f"{ju_id}.judgment_type={judgment_type} 语义不唯一，必须返回 02 重新拆分")
            if migration != "unknown":
                raise ContractError(f"{ju_id}.judgment_type={judgment_type} 已废弃，应迁移为 {migration}")
            raise ContractError(f"{ju_id}.judgment_type 非法: {judgment_type}")
        expected_hash = judgment_unit_hash(unit)
        declared_hash = str(unit.get("content_hash", "")).strip()
        if require_hash and declared_hash != expected_hash:
            raise ContractError(f"{ju_id}.content_hash 与当前 02 JU 内容不一致")
        result[ju_id] = dict(unit)
    contracts = validate_aggregation_contracts(view, result)
    for ju_id, unit in result.items():
        contract_ref = str(unit.get("aggregation_contract_ref", "")).strip()
        if unit.get("aggregation_role") == "parent":
            if contract_ref not in contracts:
                raise ContractError(f"{ju_id}.aggregation_contract_ref 未定义")
            if str(contracts[contract_ref].get("parent_judgment_unit_ref")) != ju_id:
                raise ContractError(f"{ju_id} 与 {contract_ref}.parent_judgment_unit_ref 不一致")
    return result


def normalize_method_ref(value: Any, expected_namespace: str, label: str) -> str:
    text = str(value or "").strip()
    if not re.fullmatch(r"kb(?:03|04):A(?:0\d|10)", text):
        raise ContractError(f"{label} 必须使用带命名空间的方法引用，例如 {expected_namespace}:A04；实际为 {text or '<空>'}")
    namespace = text.split(":", 1)[0]
    if namespace != expected_namespace:
        raise ContractError(f"{label} 命名空间错误：期望 {expected_namespace}，实际 {namespace}")
    return text


def local_method_id(method_ref: str) -> str:
    return method_ref.split(":", 1)[1]


def _subject_refs(value: Any) -> list[str]:
    refs = split_refs(value)
    return [str(ref).strip() for ref in refs if str(ref).strip()]


def validate_evidence_routes(
    view: Mapping[str, Any],
    recipe_rows: Iterable[Mapping[str, Any]],
) -> dict[str, str]:
    view = _task_view_projection(view)
    units = validate_judgment_units(view)
    routes = _mapping(route_registry().get("routes"), "routes")
    matched: dict[str, str] = {}
    for row in recipe_rows:
        status = str(row.get("match_status", "")).strip()
        if status in {"not_found", "not_applicable"}:
            continue
        refs = _subject_refs(row.get("target_judgment_unit_id"))
        label = f"03.evidence_recipe_matches#{row.get('recipe_match_id', '?')}"
        if len(refs) != 1:
            raise ContractError(f"{label}.target_judgment_unit_id 必须且只能引用一个 02 JU")
        ju_id = refs[0]
        if ju_id not in units:
            raise ContractError(f"{label} 引用了 02 不存在的 {ju_id}")
        if ju_id in matched:
            raise ContractError(f"03 为 {ju_id} 重复登记主取证方法")
        unit = units[ju_id]
        actual_type = str(row.get("judgment_type", "")).strip()
        expected_type = str(unit["judgment_type"])
        if actual_type != expected_type:
            raise ContractError(f"{label}.judgment_type 漂移：02={expected_type}，03={actual_type}")
        if str(row.get("source_02_hash", "")).strip() != str(unit.get("content_hash", "")):
            raise ContractError(f"{label}.source_02_hash 未继承 {ju_id}.content_hash")
        method = normalize_method_ref(row.get("library_recipe_id"), "kb03", f"{label}.library_recipe_id")
        route = _mapping(routes.get(expected_type), f"routes.{expected_type}")
        allowed = set(str(item) for item in route.get("allowed_kb03_methods", []))
        if method not in allowed:
            raise ContractError(f"{label}: {expected_type} 不允许调用 {method}；允许={sorted(allowed)}")
        default = str(route.get("default_kb03_method", ""))
        if method != default and not str(row.get("notes", "")).strip():
            raise ContractError(f"{label}: 偏离默认方法 {default} 时必须在 notes 说明理由")
        matched[ju_id] = method
    missing = sorted(set(units) - set(matched))
    if missing:
        raise ContractError("03 未逐一覆盖 02 JU: " + ", ".join(missing))
    return matched


def _binding_methods(binding: Mapping[str, Any], label: str) -> list[str]:
    methods = _subject_refs(binding.get("method_ids"))
    if not methods:
        raise ContractError(f"{label}.method_ids 不得为空")
    return [normalize_method_ref(item, "kb04", f"{label}.method_ids") for item in methods]


def _validate_j4_claim(
    claim: Mapping[str, Any],
    linked_units: list[str],
    units: Mapping[str, Mapping[str, Any]],
    gate_by_ju: Mapping[str, Mapping[str, Any]],
) -> None:
    claim_id = str(claim.get("claim_id", "?"))
    review = claim.get("j4_upgrade_review")
    if not isinstance(review, dict):
        raise ContractError(f"04.claim_register#{claim_id} 达到 J4 时必须提供 j4_upgrade_review")
    required_true = [
        "q4_evidence",
        "method_gate_passed",
        "alternatives_discriminated",
        "no_decisive_counterevidence",
        "scope_time_invalidation_explicit",
        "semantic_review_passed",
    ]
    failed = [field for field in required_true if review.get(field) is not True]
    if failed:
        raise ContractError(f"04.claim_register#{claim_id}.j4_upgrade_review 未通过: {', '.join(failed)}")
    chains = _subject_refs(review.get("independent_evidence_chain_refs"))
    if len(set(chains)) < 2:
        raise ContractError(f"04.claim_register#{claim_id} 达到 J4 至少需要两条实质独立证据链")
    for ju_id in linked_units:
        gate = gate_by_ju[ju_id]
        if str(gate.get("evidence_grade", "")) != "Q4":
            raise ContractError(f"04.claim_register#{claim_id} 达到 J4，但 {ju_id} 不是 Q4")
        if str(gate.get("counterevidence_result", "")) not in {"cleared", "not_applicable"}:
            raise ContractError(f"04.claim_register#{claim_id} 达到 J4，但 {ju_id} 存在未清除反证")
        level_req = _mapping(units[ju_id].get("level_requirements"), f"{ju_id}.level_requirements")
        j4 = _mapping(level_req.get("J4"), f"{ju_id}.level_requirements.J4")
        if j4.get("applicable") is not True:
            raise ContractError(f"04.claim_register#{claim_id} 达到 J4，但 {ju_id} 未开放 J4")
        try:
            independent_groups = int(j4.get("minimum_independent_source_groups", 0))
        except (TypeError, ValueError):
            independent_groups = 0
        if independent_groups < 2:
            raise ContractError(f"{ju_id}.level_requirements.J4 至少要求两组独立来源")


def validate_reasoning_routes(view: Mapping[str, Any], audit: Mapping[str, Any]) -> dict[str, list[str]]:
    view = _task_view_projection(view)
    units = validate_judgment_units(view)
    routes = _mapping(route_registry().get("routes"), "routes")
    global_aux = set(str(item) for item in route_registry().get("global_optional_reasoning_methods", []))

    gate_rows = audit.get("judgment_unit_gate_results")
    if not isinstance(gate_rows, list) or not gate_rows:
        raise ContractError("04.judgment_unit_gate_results 至少需要一项")
    gate_by_ju: dict[str, dict[str, Any]] = {}
    for index, raw in enumerate(gate_rows, 1):
        gate = _mapping(raw, f"04.judgment_unit_gate_results[{index}]")
        ju_id = str(gate.get("judgment_unit_id", "")).strip()
        if ju_id not in units:
            raise ContractError(f"04.judgment_unit_gate_results 引用了 02 不存在的 {ju_id}")
        if ju_id in gate_by_ju:
            raise ContractError(f"04.judgment_unit_gate_results 重复引用 {ju_id}")
        expected_type = str(units[ju_id]["judgment_type"])
        if str(gate.get("judgment_type", "")).strip() != expected_type:
            raise ContractError(f"04 {ju_id}.judgment_type 未继承 02：期望 {expected_type}")
        if str(gate.get("source_02_hash", "")).strip() != str(units[ju_id].get("content_hash", "")):
            raise ContractError(f"04 {ju_id}.source_02_hash 未继承 02 content_hash")
        gate_by_ju[ju_id] = gate
    missing_gates = sorted(set(units) - set(gate_by_ju))
    if missing_gates:
        raise ContractError("04 未逐一继承 02 JU: " + ", ".join(missing_gates))

    claims = {
        str(item.get("claim_id")): item
        for item in audit.get("claim_register", [])
        if isinstance(item, dict) and item.get("claim_id")
    }
    usage = _mapping(audit.get("method_library_usage"), "04.method_library_usage")
    declared_methods = {
        normalize_method_ref(item, "kb04", "04.method_library_usage.methods_used")
        for item in _subject_refs(usage.get("methods_used"))
    }
    bindings = usage.get("claim_bindings")
    if not isinstance(bindings, list) or not bindings:
        raise ContractError("04.method_library_usage.claim_bindings 至少需要一项")
    result: dict[str, list[str]] = {}
    for index, raw in enumerate(bindings, 1):
        binding = _mapping(raw, f"04.method_library_usage.claim_bindings[{index}]")
        claim_id = str(binding.get("claim_id", "")).strip()
        if claim_id not in claims:
            raise ContractError(f"04 method binding 引用了不存在的 {claim_id}")
        methods = _binding_methods(binding, f"04.method_library_usage.claim_bindings#{claim_id}")
        if not set(methods).issubset(declared_methods):
            raise ContractError(f"04 {claim_id} 使用的方法必须先列入 methods_used")
        if not str(binding.get("reason", "")).strip():
            raise ContractError(f"04 {claim_id} 的方法选择必须填写 reason")
        linked_units = _subject_refs(claims[claim_id].get("linked_judgment_unit"))
        if not linked_units or not set(linked_units).issubset(units):
            raise ContractError(f"04 {claim_id}.linked_judgment_unit 非法")
        allowed_primary: set[str] | None = None
        allowed_all: set[str] | None = None
        for ju_id in linked_units:
            route = _mapping(routes.get(units[ju_id]["judgment_type"]), f"routes.{units[ju_id]['judgment_type']}")
            primary = set(str(item) for item in route.get("allowed_kb04_methods", []))
            auxiliary = set(str(item) for item in route.get("optional_auxiliary_methods", [])) | global_aux
            allowed_primary = primary if allowed_primary is None else allowed_primary & primary
            permitted = primary | auxiliary
            allowed_all = permitted if allowed_all is None else allowed_all & permitted
        assert allowed_primary is not None and allowed_all is not None
        invalid = sorted(set(methods) - allowed_all)
        if invalid:
            raise ContractError(f"04 {claim_id} 的方法与 JU 类型不兼容: {invalid}；允许={sorted(allowed_all)}")
        level = str(claims[claim_id].get("judgment_level", ""))
        if level != "J0" and not (set(methods) & allowed_primary):
            raise ContractError(f"04 {claim_id} 缺少与 JU 类型兼容的主推理方法")
        if level == "J4":
            _validate_j4_claim(claims[claim_id], linked_units, units, gate_by_ju)
        result[claim_id] = methods
    missing_claims = sorted(set(claims) - set(result))
    if missing_claims:
        raise ContractError("04 方法绑定未覆盖全部 Claim: " + ", ".join(missing_claims))
    return result


def directional_conclusion_available(audit: Mapping[str, Any]) -> bool:
    for claim in audit.get("claim_register", []) or []:
        if not isinstance(claim, dict):
            continue
        level = str(claim.get("judgment_level", ""))
        if level in {"J2", "J3", "J4"}:
            return True
    return False


def validate_knowledge_call(record: Mapping[str, Any]) -> None:
    required = {
        "call_id", "stage", "subject_ref", "knowledge_ref", "knowledge_version",
        "selection_mode", "status", "reason", "derived_requirements",
    }
    missing = sorted(required - set(record))
    if missing:
        raise ContractError("knowledge_call 缺少字段: " + ", ".join(missing))
    if record.get("selection_mode") not in {"deterministic", "reviewed"}:
        raise ContractError("knowledge_call.selection_mode 非法")
    if record.get("status") not in {"selected", "not_applicable", "blocked", "review_required"}:
        raise ContractError("knowledge_call.status 非法")
    if not isinstance(record.get("derived_requirements"), list):
        raise ContractError("knowledge_call.derived_requirements 必须是列表")
