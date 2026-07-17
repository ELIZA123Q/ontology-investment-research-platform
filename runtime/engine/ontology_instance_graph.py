#!/usr/bin/env python3
"""业务本体实例图合同、02 任务视图压缩与确定性投影。

磁盘上的 02 产物只保存 ``business_instance_graph``。阶段校验器通过
``materialize_document`` 在内存中恢复各阶段熟悉的业务视图；恢复结果是
投影，不是第二权威源。
"""

from __future__ import annotations

import copy
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable, Mapping

import yaml


GRAPH_SCHEMA_NAME = "ontology_business_instance_graph"
GRAPH_SCHEMA_VERSION = "1.0.0"
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "governance" / "03_校验"))
STRICT_TASK_TYPES = {
    "ResearchPlan", "ResearchScope", "JudgmentUnit", "ResearchPath", "PathNode",
    "InstanceRequirement", "AggregationContract", "PathCondition", "CompetingExplanation",
}

# 业务参数图与任务视图使用的运行时/领域登记类型（已从 L1 正式本体迁出，仍可出现在 business_instance_graph）。
BUSINESS_PARAMETER_OBJECT_TYPES = {
    "EvidenceProfile",
    "EvidenceRecipe",
    "SourceProfile",
    "ProxyIndicator",
    "PropagationTemplate",
    "ScenarioTemplate",
    "BusinessScenarioTag",
    "JudgmentLevelCriterionTemplate",
}
TASK_VIEW_OBJECT_TYPES = {
    "ResearchPlan",
    "ResearchFrameworkSelection",
    "SemanticScopeSelection",
    "EvidenceContract",
    "ReasoningPlan",
    "OntologyBindingSet",
    "OntologyCandidateSet",
    "OntologyGapSet",
    "JudgmentUnit",
    "InstanceRequirement",
    "EvidenceRequirement",
    "ResearchScope",
    "ResearchPath",
    "PathNode",
    "PathCondition",
    "CompetingExplanation",
    "AggregationContract",
    "JudgmentLevelCriterion",
    "EvidenceBasketRequirement",
    "CandidateClaim",
    "EvidenceBasket",
}
BUSINESS_PARAMETER_RELATION_TYPES = {
    "propagationTemplateUsesSourceVariable",
    "propagationTemplateProducesVariable",
    "stateVariableUsesEvidenceProfile",
    "scenarioTemplateConstrainsVariable",
    "propagationTemplateUsesEvidenceProfile",
    "researchPlanContainsResource",
    "pathContainsNode",
    "judgmentUnitHasCandidateClaim",
    "judgmentUnitUsesCriterion",
    "judgmentUnitRequiresEvidence",
    "scopeNarrowerThan",
}

SECTION_TYPES = {
    "task_context": "ResearchPlan",
    "research_framework": "ResearchFrameworkSelection",
    "semantic_scope": "SemanticScopeSelection",
    "evidence_contract": "EvidenceContract",
    "reasoning_plan": "ReasoningPlan",
    "ontology_bindings": "OntologyBindingSet",
    "candidate_structures": "OntologyCandidateSet",
    "ontology_gaps": "OntologyGapSet",
}

# 执行状态、版本来源、阶段交接和校验结果属于运行合同，不进入业务本体。
OUTER_SECTIONS = {"quality_control", "ontology_sources", "handoff_to_03", "validation", "iteration_contract"}

LIST_TYPES = {
    "judgment_units": ("JudgmentUnit", "judgment_unit_id"),
    "instance_requirements": ("InstanceRequirement", "requirement_id"),
    "evidence_requirements": ("EvidenceRequirement", "evidence_requirement_id"),
    "aggregation_contracts": ("AggregationContract", "aggregation_contract_ref"),
}

NESTED_JU_SECTIONS = {
    "candidate_claims": "CandidateClaim",
    "judgment_level_criteria": "JudgmentLevelCriterion",
    "evidence_basket_requirements": "EvidenceBasketRequirement",
}

BASKET_ROLE_MAP = {
    "support": "primary_support",
    "primary_support": "primary_support",
    "cross_validation": "cross_validation",
    "counter": "counter_evidence",
    "counter_evidence": "counter_evidence",
    "blocking_condition": "blocking_condition",
    "proxy": "proxy_indicator",
    "proxy_indicator": "proxy_indicator",
    "background": "background_evidence",
    "background_evidence": "background_evidence",
}

PATH_LIST_TYPES = {
    "weakening_conditions": ("PathCondition", "condition_id"),
    "blocking_conditions": ("PathCondition", "condition_id"),
    "competing_explanations": ("CompetingExplanation", "explanation_id"),
}


class InstanceGraphError(ValueError):
    """业务实例图不满足通用合同。"""


def _mapping(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise InstanceGraphError(f"{label} 必须是对象")
    return dict(value)


def _list(value: Any, label: str) -> list[Any]:
    if not isinstance(value, list):
        raise InstanceGraphError(f"{label} 必须是列表")
    return list(value)


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _instance(
    instance_id: str,
    object_type: str,
    properties: Mapping[str, Any],
    section: str,
    index: int = 0,
    *,
    group: str | None = None,
) -> dict[str, Any]:
    projection = {"section": section, "index": index}
    if group is not None:
        projection["group"] = group
    return {
        "id": instance_id,
        "type": object_type,
        "properties": copy.deepcopy(dict(properties)),
        "projection": projection,
    }


def _basket_role(raw: Any) -> str:
    value = str(raw or "primary_support").strip()
    return BASKET_ROLE_MAP.get(value, "primary_support")


def _load_criterion_templates() -> dict[str, dict[str, Any]]:
    """Load reusable JudgmentLevelCriterionTemplate instances from domain authority."""
    path = ROOT / "ontology/02_领域/semiconductor" / "business_instances.yaml"
    document = yaml.safe_load(path.read_text(encoding="utf-8"))
    graph = document.get("business_instance_graph") or {}
    templates: dict[str, dict[str, Any]] = {}
    for item in graph.get("objects") or []:
        if item.get("type") != "JudgmentLevelCriterionTemplate":
            continue
        templates[str(item.get("id"))] = dict(item.get("properties") or {})
    return templates


def _materialize_criterion_from_template(
    *,
    ju_id: str,
    level: str,
    template_id: str,
    template_props: Mapping[str, Any],
    basket_refs: list[Any] | None = None,
    overrides: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    merged = {
        "judgment_level": level,
        "applicable": bool(template_props.get("applicable")),
        "minimum_source_authority": template_props.get("minimum_source_authority") or "unknown",
        "minimum_independent_source_groups": int(template_props.get("minimum_independent_source_groups") or 0),
        "counter_evidence_check": template_props.get("counter_evidence_check") or "optional",
        "alternative_explanation_check": template_props.get("alternative_explanation_check") or "optional",
        "required_conditions": list(template_props.get("required_conditions") or []),
        "required_evidence_basket_refs": list(basket_refs or []),
        "judgment_unit_id": ju_id,
        "template_id": template_id,
    }
    if overrides:
        for key, value in overrides.items():
            if key in {"judgment_unit_id", "judgment_level", "template_id"}:
                continue
            merged[key] = copy.deepcopy(value)
    return merged


def expand_judgment_nested_parameters(graph: Mapping[str, Any]) -> dict[str, Any]:
    """把 JU 内嵌候选命题、等级条件与篮子需求拆成正式对象与关系。"""
    value = copy.deepcopy(dict(graph))
    objects = list(value.get("objects") or [])
    relations = list(value.get("relations") or [])
    existing_ids = {str(item.get("id")) for item in objects}
    existing_rel_ids = {str(item.get("id")) for item in relations}
    templates = _load_criterion_templates()

    def add_object(item: dict[str, Any]) -> None:
        if item["id"] in existing_ids:
            return
        objects.append(item)
        existing_ids.add(item["id"])

    def add_relation(item: dict[str, Any]) -> None:
        if item["id"] in existing_rel_ids:
            return
        relations.append(item)
        existing_rel_ids.add(item["id"])

    for item in list(objects):
        if item.get("type") != "JudgmentUnit":
            continue
        props = _mapping(item.get("properties"), f"{item.get('id')}.properties")
        ju_id = str(props.get("judgment_unit_id") or item.get("id")).strip()
        claim_text = str(props.get("candidate_claim", "")).strip()
        if claim_text:
            claim_id = f"CC-{ju_id}"
            add_object(_instance(
                claim_id,
                "CandidateClaim",
                {
                    "statement": claim_text,
                    "target_claim_type": props.get("target_claim_type") or "current_state",
                    "stable_claim_key": props.get("stable_claim_key") or ju_id,
                    "scope_ref": props.get("claim_scope_ref") or "",
                    "judgment_unit_id": ju_id,
                },
                "candidate_claims",
                0,
                group=ju_id,
            ))
            add_relation({
                "id": f"REL-{ju_id}-CLAIM",
                "type": "judgmentUnitHasCandidateClaim",
                "sourceId": item["id"],
                "targetId": claim_id,
                "properties": {},
            })

        bindings = props.get("criterion_template_bindings")
        materialized_levels: set[str] = set()
        if isinstance(bindings, list) and bindings:
            for index, raw_binding in enumerate(bindings):
                binding = _mapping(raw_binding, f"{ju_id}.criterion_template_bindings[{index}]")
                level = str(binding.get("judgment_level") or "").strip()
                template_id = str(binding.get("template_id") or "").strip()
                if not template_id:
                    ref = str(binding.get("template_ref") or "").strip()
                    template_id = ref.rsplit(".", 1)[-1] if ref else ""
                if not level or not template_id:
                    raise InstanceGraphError(
                        f"{ju_id}.criterion_template_bindings[{index}] 缺少 judgment_level/template_id"
                    )
                template_props = templates.get(template_id)
                if template_props is None:
                    raise InstanceGraphError(
                        f"{ju_id} 引用未知 JudgmentLevelCriterionTemplate: {template_id}"
                    )
                criterion_id = f"{ju_id}-{level}"
                add_object(_instance(
                    criterion_id,
                    "JudgmentLevelCriterion",
                    _materialize_criterion_from_template(
                        ju_id=ju_id,
                        level=level,
                        template_id=template_id,
                        template_props=template_props,
                        basket_refs=list(binding.get("required_evidence_basket_refs") or []),
                        overrides=_mapping(binding.get("overrides") or {}, f"{ju_id}.overrides"),
                    ),
                    "judgment_level_criteria",
                    index,
                    group=ju_id,
                ))
                add_relation({
                    "id": f"REL-{ju_id}-CRIT-{level}",
                    "type": "judgmentUnitUsesCriterion",
                    "sourceId": item["id"],
                    "targetId": criterion_id,
                    "properties": {"judgment_level": level, "template_id": template_id},
                })
                # Keep template binding on the criterion properties; do not add
                # cross-graph template relations into the task instance graph.
                materialized_levels.add(level)
            # Keep bindings on the JU for lossless disk round-trip.
            props["criterion_template_bindings"] = copy.deepcopy(bindings)

        # Also honor template relations already present on disk (without bindings list).
        for relation in list(relations):
            if relation.get("type") != "judgmentUnitUsesCriterionTemplate":
                continue
            if relation.get("sourceId") != item["id"]:
                continue
            rel_props = dict(relation.get("properties") or {})
            level = str(rel_props.get("judgment_level") or "").strip()
            template_id = str(relation.get("targetId") or "").strip()
            if not level or level in materialized_levels:
                continue
            template_props = templates.get(template_id)
            if template_props is None:
                raise InstanceGraphError(
                    f"{ju_id} 关系引用未知 JudgmentLevelCriterionTemplate: {template_id}"
                )
            # Ensure template stub exists so endpoint checks can pass after expand.
            add_object(_instance(
                template_id,
                "JudgmentLevelCriterionTemplate",
                template_props,
                "judgment_level_criterion_templates",
                0,
            ))
            criterion_id = f"{ju_id}-{level}"
            add_object(_instance(
                criterion_id,
                "JudgmentLevelCriterion",
                _materialize_criterion_from_template(
                    ju_id=ju_id,
                    level=level,
                    template_id=template_id,
                    template_props=template_props,
                    basket_refs=list(rel_props.get("required_evidence_basket_refs") or []),
                    overrides=_mapping(rel_props.get("overrides") or {}, f"{ju_id}.rel.overrides"),
                ),
                "judgment_level_criteria",
                len(materialized_levels),
                group=ju_id,
            ))
            add_relation({
                "id": f"REL-{ju_id}-CRIT-{level}",
                "type": "judgmentUnitUsesCriterion",
                "sourceId": item["id"],
                "targetId": criterion_id,
                "properties": {"judgment_level": level, "template_id": template_id},
            })
            materialized_levels.add(level)

        level_requirements = props.pop("level_requirements", None)
        if isinstance(level_requirements, dict):
            for index, (level, raw_req) in enumerate(sorted(level_requirements.items())):
                if str(level) in materialized_levels:
                    continue
                req = _mapping(raw_req, f"{ju_id}.level_requirements.{level}")
                criterion_id = f"{ju_id}-{level}"
                add_object(_instance(
                    criterion_id,
                    "JudgmentLevelCriterion",
                    {
                        "judgment_level": level,
                        "applicable": bool(req.get("applicable")),
                        "minimum_source_authority": req.get("minimum_source_authority") or "unknown",
                        "minimum_independent_source_groups": int(req.get("minimum_independent_source_groups") or 0),
                        "counter_evidence_check": req.get("counter_evidence_check") or "optional",
                        "alternative_explanation_check": req.get("alternative_explanation_check") or "optional",
                        "required_conditions": list(req.get("required_conditions") or []),
                        "required_evidence_basket_refs": list(req.get("required_evidence_basket_refs") or []),
                        "judgment_unit_id": ju_id,
                    },
                    "judgment_level_criteria",
                    index,
                    group=ju_id,
                ))
                add_relation({
                    "id": f"REL-{ju_id}-CRIT-{level}",
                    "type": "judgmentUnitUsesCriterion",
                    "sourceId": item["id"],
                    "targetId": criterion_id,
                    "properties": {"judgment_level": level},
                })

        baskets = props.pop("mandatory_evidence_baskets", None)
        if isinstance(baskets, list):
            for index, raw_basket in enumerate(baskets):
                basket = _mapping(raw_basket, f"{ju_id}.mandatory_evidence_baskets[{index}]")
                basket_id = str(basket.get("basket_id") or f"EBR-{ju_id}-{index + 1}").strip()
                add_object(_instance(
                    basket_id,
                    "EvidenceBasketRequirement",
                    {
                        "basket_type": str(basket.get("basket_type") or "judgment_unit_support"),
                        "target_judgment_unit_id": ju_id,
                        "basket_role": _basket_role(basket.get("role") or basket.get("basket_role")),
                        "role": basket.get("role") or basket.get("basket_role") or "support",
                        "minimum_source_tier": str(basket.get("minimum_source_tier") or "S3"),
                        "minimum_independent_source_count": int(basket.get("minimum_independent_source_count") or 1),
                        "allowed_proxy": bool(basket.get("allowed_proxy", False)),
                        "evidence_requirement_refs": list(basket.get("evidence_requirement_refs") or []),
                        "required_for_levels": list(basket.get("required_for_levels") or []),
                    },
                    "evidence_basket_requirements",
                    index,
                    group=ju_id,
                ))
                add_relation({
                    "id": f"REL-{ju_id}-EBR-{basket_id}",
                    "type": "judgmentUnitRequiresEvidence",
                    "sourceId": item["id"],
                    "targetId": basket_id,
                    "properties": {},
                })

        item["properties"] = props

    plan_ids = [obj["id"] for obj in objects if obj.get("type") == "ResearchPlan"]
    if plan_ids:
        plan_id = plan_ids[0]
        contained = {
            relation["targetId"]
            for relation in relations
            if relation.get("type") == "researchPlanContainsResource"
        }
        for item in objects:
            if item["id"] == plan_id or item["id"] in contained:
                continue
            if item.get("type") not in {
                "CandidateClaim", "JudgmentLevelCriterion", "EvidenceBasketRequirement",
            }:
                continue
            add_relation({
                "id": f"REL-PLAN-CONTAINS-{item['id']}",
                "type": "researchPlanContainsResource",
                "sourceId": plan_id,
                "targetId": item["id"],
                "properties": {},
            })

    # Cross-graph template relations are resolved via bindings; keep task graph local-only.
    relations = [
        relation
        for relation in relations
        if relation.get("type") != "judgmentUnitUsesCriterionTemplate"
    ]

    value["objects"] = objects
    value["relations"] = relations
    return value


def _fold_judgment_nested_parameters(
    judgment_units: list[dict[str, Any]],
    grouped: Mapping[tuple[str, str | None], list[tuple[int, dict[str, Any], str]]],
) -> list[dict[str, Any]]:
    """投影时把正式实例折回校验器熟悉的 JU 嵌套字段。"""
    folded: list[dict[str, Any]] = []
    for unit in judgment_units:
        item = copy.deepcopy(unit)
        ju_id = str(item.get("judgment_unit_id") or "").strip()
        claim_entries = sorted(grouped.get(("candidate_claims", ju_id), []))
        if claim_entries and not item.get("candidate_claim"):
            item["candidate_claim"] = claim_entries[0][1].get("statement", "")
        criteria = [props for _, props, _ in sorted(grouped.get(("judgment_level_criteria", ju_id), []))]
        if criteria:
            level_requirements = {}
            bindings: list[dict[str, Any]] = []
            all_templated = True
            for props in criteria:
                level = str(props.get("judgment_level", "")).strip()
                if not level:
                    continue
                level_requirements[level] = {
                    "applicable": props.get("applicable"),
                    "required_evidence_basket_refs": list(props.get("required_evidence_basket_refs") or []),
                    "minimum_source_authority": props.get("minimum_source_authority"),
                    "minimum_independent_source_groups": props.get("minimum_independent_source_groups"),
                    "counter_evidence_check": props.get("counter_evidence_check"),
                    "alternative_explanation_check": props.get("alternative_explanation_check"),
                    "required_conditions": list(props.get("required_conditions") or []),
                }
                template_id = str(props.get("template_id") or "").strip()
                if not template_id:
                    all_templated = False
                    continue
                binding: dict[str, Any] = {
                    "judgment_level": level,
                    "template_id": template_id,
                    "template_ref": (
                        "ontology/02_领域/semiconductor/business_instances.yaml"
                        f"#business_instance_graph.objects.{template_id}"
                    ),
                }
                basket_refs = list(props.get("required_evidence_basket_refs") or [])
                if basket_refs:
                    binding["required_evidence_basket_refs"] = basket_refs
                templates = _load_criterion_templates()
                template_props = templates.get(template_id) or {}
                overrides = {}
                for key in (
                    "applicable",
                    "minimum_source_authority",
                    "minimum_independent_source_groups",
                    "counter_evidence_check",
                    "alternative_explanation_check",
                    "required_conditions",
                ):
                    if key in props and props.get(key) != template_props.get(key):
                        overrides[key] = copy.deepcopy(props.get(key))
                if overrides:
                    binding["overrides"] = overrides
                bindings.append(binding)
            item["level_requirements"] = level_requirements
            if all_templated and bindings:
                item["criterion_template_bindings"] = bindings
        basket_entries = sorted(grouped.get(("evidence_basket_requirements", ju_id), []))
        if basket_entries:
            item["mandatory_evidence_baskets"] = []
            for _, props, object_id in basket_entries:
                item["mandatory_evidence_baskets"].append({
                    "basket_id": object_id,
                    "basket_type": props.get("basket_type"),
                    "role": props.get("role") or props.get("basket_role"),
                    "evidence_requirement_refs": list(props.get("evidence_requirement_refs") or []),
                    "required_for_levels": list(props.get("required_for_levels") or []),
                    "minimum_source_tier": props.get("minimum_source_tier"),
                    "minimum_independent_source_count": props.get("minimum_independent_source_count"),
                    "allowed_proxy": props.get("allowed_proxy"),
                })
        folded.append(item)
    return folded


def compress_criterion_templates_for_disk(graph: Mapping[str, Any]) -> dict[str, Any]:
    """磁盘只保留模板绑定；运行时再物化 JudgmentLevelCriterion。"""
    value = copy.deepcopy(dict(graph))
    objects = list(value.get("objects") or [])
    relations = list(value.get("relations") or [])
    criteria = [item for item in objects if item.get("type") == "JudgmentLevelCriterion"]
    if not criteria:
        value["objects"] = objects
        value["relations"] = relations
        return value

    by_ju: dict[str, list[dict[str, Any]]] = {}
    for item in criteria:
        props = dict(item.get("properties") or {})
        ju_id = str(props.get("judgment_unit_id") or "").strip()
        if not ju_id or not props.get("template_id"):
            # Keep legacy explicit criteria that are not template-backed.
            continue
        by_ju.setdefault(ju_id, []).append(item)

    removable_ids = {item["id"] for items in by_ju.values() for item in items}
    if not removable_ids:
        value["objects"] = objects
        value["relations"] = relations
        return value

    templates = _load_criterion_templates()
    ju_objects = {
        str((item.get("properties") or {}).get("judgment_unit_id") or item.get("id")): item
        for item in objects
        if item.get("type") == "JudgmentUnit"
    }
    for ju_id, items in by_ju.items():
        ju = ju_objects.get(ju_id)
        if not ju:
            continue
        bindings: list[dict[str, Any]] = []
        for item in sorted(
            items,
            key=lambda raw: str((raw.get("properties") or {}).get("judgment_level") or ""),
        ):
            props = dict(item.get("properties") or {})
            level = str(props.get("judgment_level") or "").strip()
            template_id = str(props.get("template_id") or "").strip()
            template_props = templates.get(template_id) or {}
            binding: dict[str, Any] = {
                "judgment_level": level,
                "template_id": template_id,
                "template_ref": (
                    "ontology/02_领域/semiconductor/business_instances.yaml"
                    f"#business_instance_graph.objects.{template_id}"
                ),
            }
            basket_refs = list(props.get("required_evidence_basket_refs") or [])
            if basket_refs:
                binding["required_evidence_basket_refs"] = basket_refs
            overrides = {}
            for key in (
                "applicable",
                "minimum_source_authority",
                "minimum_independent_source_groups",
                "counter_evidence_check",
                "alternative_explanation_check",
                "required_conditions",
            ):
                if key in props and props.get(key) != template_props.get(key):
                    overrides[key] = copy.deepcopy(props.get(key))
            if overrides:
                binding["overrides"] = overrides
            bindings.append(binding)
        ju_props = dict(ju.get("properties") or {})
        ju_props["criterion_template_bindings"] = bindings
        ju_props.pop("level_requirements", None)
        ju["properties"] = ju_props

    objects = [item for item in objects if item.get("id") not in removable_ids]
    relations = [
        relation
        for relation in relations
        if relation.get("sourceId") not in removable_ids
        and relation.get("targetId") not in removable_ids
        and relation.get("type") != "judgmentUnitUsesCriterion"
    ]
    value["objects"] = objects
    value["relations"] = relations
    return value


def compact_task_view(view: Mapping[str, Any]) -> dict[str, Any]:
    """把传统 02 任务视图转换成只有实例图的磁盘合同。"""
    source = copy.deepcopy(dict(view))
    if "business_instance_graph" in source:
        graph = expand_judgment_nested_parameters(source["business_instance_graph"])
        validate_instance_graph(graph)
        source["business_instance_graph"] = compress_criterion_templates_for_disk(graph)
        return source

    schema_name = str(source.pop("schema_name", "task_ontology_view"))
    schema_version = str(source.pop("schema_version", ""))
    outer = {section: source.pop(section) for section in OUTER_SECTIONS if section in source}
    objects: list[dict[str, Any]] = []
    relations: list[dict[str, Any]] = []

    for section, object_type in SECTION_TYPES.items():
        if section in source:
            objects.append(
                _instance(
                    f"SECTION-{section.upper()}",
                    object_type,
                    _mapping(source.pop(section), section),
                    section,
                )
            )

    for section, (object_type, id_field) in LIST_TYPES.items():
        for index, raw in enumerate(_list(source.pop(section, []), section)):
            item = _mapping(raw, f"{section}[{index}]")
            instance_id = str(item.get(id_field, "")).strip()
            if not instance_id:
                raise InstanceGraphError(f"{section}[{index}].{id_field} 不得为空")
            objects.append(_instance(instance_id, object_type, item, section, index))

    if "scope_graph" in source:
        graph = _mapping(source.pop("scope_graph"), "scope_graph")
        root_ref = graph.get("root_scope_ref")
        for index, raw in enumerate(_list(graph.get("nodes", []), "scope_graph.nodes")):
            item = _mapping(raw, f"scope_graph.nodes[{index}]")
            scope_ref = str(item.get("scope_ref", "")).strip()
            if not scope_ref:
                raise InstanceGraphError("scope_graph.nodes.scope_ref 不得为空")
            item["root_scope_ref"] = root_ref
            objects.append(_instance(scope_ref, "ResearchScope", item, "scope_graph", index))
            parent = item.get("parent_scope_ref")
            if parent:
                relations.append({
                    "id": f"REL-SCOPE-{scope_ref}-PARENT",
                    "type": "scopeNarrowerThan",
                    "sourceId": scope_ref,
                    "targetId": str(parent),
                    "properties": {},
                })

    if "path_design" in source:
        design = _mapping(source.pop("path_design"), "path_design")
        for index, raw in enumerate(_list(design.get("main_paths", []), "path_design.main_paths")):
            path = _mapping(raw, f"path_design.main_paths[{index}]")
            path_id = str(path.get("path_id", "")).strip()
            nodes = _list(path.pop("nodes", []), f"{path_id}.nodes")
            objects.append(_instance(path_id, "ResearchPath", path, "path_design", index, group="main_paths"))
            for node_index, raw_node in enumerate(nodes):
                node = _mapping(raw_node, f"{path_id}.nodes[{node_index}]")
                node_id = str(node.get("node_id", "")).strip()
                objects.append(_instance(node_id, "PathNode", node, "path_design", node_index, group=path_id))
                relations.append({
                    "id": f"REL-{path_id}-{node_id}",
                    "type": "pathContainsNode",
                    "sourceId": path_id,
                    "targetId": node_id,
                    "properties": {"sequence": node_index + 1},
                })
        for group, (object_type, id_field) in PATH_LIST_TYPES.items():
            for index, raw in enumerate(_list(design.get(group, []), f"path_design.{group}")):
                item = _mapping(raw, f"path_design.{group}[{index}]")
                instance_id = str(item.get(id_field, "")).strip()
                objects.append(_instance(instance_id, object_type, item, "path_design", index, group=group))

    if source:
        unknown = ", ".join(sorted(source))
        raise InstanceGraphError(f"02 任务视图存在未归属业务参数: {unknown}")

    plan_ids = [item["id"] for item in objects if item["type"] == "ResearchPlan"]
    plan_id = plan_ids[0] if plan_ids else "SECTION-TASK_CONTEXT"
    contained = {relation["targetId"] for relation in relations if relation["type"] == "researchPlanContainsResource"}
    for item in objects:
        if item["id"] == plan_id or item["id"] in contained:
            continue
        relations.append({
            "id": f"REL-PLAN-CONTAINS-{item['id']}",
            "type": "researchPlanContainsResource",
            "sourceId": plan_id,
            "targetId": item["id"],
            "properties": {},
        })

    result = {
        "schema_name": schema_name,
        "schema_version": schema_version,
        **outer,
        "business_instance_graph": compress_criterion_templates_for_disk(
            expand_judgment_nested_parameters({
                "schema_name": GRAPH_SCHEMA_NAME,
                "schema_version": GRAPH_SCHEMA_VERSION,
                "authority": "business_parameters",
                "objects": objects,
                "relations": relations,
            })
        ),
    }
    validate_instance_graph(result["business_instance_graph"])
    return result


_MODEL_FILES = (
    "semantic.yaml",
    "state_event.yaml",
    "evidence.yaml",
    "judgment.yaml",
    "scenario.yaml",
    "semiconductor_extension.yaml",
)


def _schema_fields(definition: Mapping[str, Any]) -> dict[str, Any]:
    fields = definition.get("attributes") or definition.get("properties") or {}
    return fields if isinstance(fields, dict) else {}


def _load_ontology_catalog(*, include_domain: bool = True) -> tuple[set[str], set[str], dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    del include_domain  # 领域扩展已并入 models/semiconductor_extension.yaml
    object_types: set[str] = set()
    relation_types: set[str] = set()
    object_definitions: dict[str, dict[str, Any]] = {}
    relation_definitions: dict[str, dict[str, Any]] = {}
    model_root = ROOT / "ontology/01_通用/models"
    for filename in _MODEL_FILES:
        path = model_root / filename
        if not path.is_file():
            continue
        schema = yaml.safe_load(path.read_text(encoding="utf-8"))
        object_definitions.update(schema.get("object_types", {}) or {})
        object_definitions.update(schema.get("scenario_types", {}) or {})
        relation_definitions.update(schema.get("relation_types", {}) or {})
        object_types.update(str(item) for item in (schema.get("object_types", {}) or {}))
        object_types.update(str(item) for item in (schema.get("scenario_types", {}) or {}))
        relation_types.update(str(item) for item in (schema.get("relation_types", {}) or {}))
    return object_types, relation_types, object_definitions, relation_definitions


def validate_instance_graph(
    graph: Any,
    *,
    include_domain: bool = True,
    check_relation_endpoints: bool = True,
) -> dict[str, Any]:
    value = _mapping(graph, "business_instance_graph")
    if value.get("schema_name") != GRAPH_SCHEMA_NAME:
        raise InstanceGraphError(f"business_instance_graph.schema_name 必须为 {GRAPH_SCHEMA_NAME}")
    if str(value.get("schema_version")) != GRAPH_SCHEMA_VERSION:
        raise InstanceGraphError(f"business_instance_graph.schema_version 必须为 {GRAPH_SCHEMA_VERSION}")
    if value.get("authority") != "business_parameters":
        raise InstanceGraphError("business_instance_graph.authority 必须为 business_parameters")
    objects = _list(value.get("objects"), "business_instance_graph.objects")
    relations = _list(value.get("relations"), "business_instance_graph.relations")
    object_types, relation_types, object_definitions, relation_definitions = _load_ontology_catalog(
        include_domain=include_domain
    )
    allowed_object_types = object_types | BUSINESS_PARAMETER_OBJECT_TYPES | TASK_VIEW_OBJECT_TYPES
    allowed_relation_types = relation_types | BUSINESS_PARAMETER_RELATION_TYPES
    # Company 可满足以 Organization 为值域的关系。
    type_aliases = {"Company": {"Organization", "Company"}}
    ids: set[str] = set()
    instance_types: dict[str, str] = {}
    for index, raw in enumerate(objects):
        item = _mapping(raw, f"objects[{index}]")
        instance_id = str(item.get("id", "")).strip()
        object_type = str(item.get("type", "")).strip()
        if not instance_id or not object_type or instance_id in ids:
            raise InstanceGraphError(f"objects[{index}] id/type 为空或 id 重复")
        if object_type not in allowed_object_types:
            raise InstanceGraphError(f"{instance_id}.type 不是正式本体或已登记业务参数对象: {object_type}")
        ids.add(instance_id)
        instance_types[instance_id] = object_type
        properties = _mapping(item.get("properties"), f"{instance_id}.properties")
        if (
            object_type in STRICT_TASK_TYPES
            and object_type in object_definitions
            and "properties" in object_definitions[object_type]
        ):
            for property_name, definition in _schema_fields(object_definitions[object_type]).items():
                if definition.get("required") and property_name not in properties:
                    raise InstanceGraphError(f"{instance_id}.properties 缺少必填属性 {property_name}")
                if property_name not in properties:
                    continue
                raw_value = properties[property_name]
                if raw_value is None and not definition.get("required"):
                    continue
                if isinstance(raw_value, str) and raw_value.startswith("<") and raw_value.endswith(">"):
                    continue
                property_type = definition.get("type")
                valid = {
                    "string": isinstance(raw_value, str),
                    "integer": isinstance(raw_value, int) and not isinstance(raw_value, bool),
                    "number": isinstance(raw_value, (int, float)) and not isinstance(raw_value, bool),
                    "boolean": isinstance(raw_value, bool),
                    "array": isinstance(raw_value, list),
                    "object": isinstance(raw_value, dict),
                    "enum": isinstance(raw_value, str) and raw_value in definition.get("allowed_values", []),
                }.get(str(property_type), True)
                if not valid:
                    raise InstanceGraphError(f"{instance_id}.{property_name} 不符合 {property_type}")
        projection = _mapping(item.get("projection"), f"{instance_id}.projection")
        if not str(projection.get("section", "")).strip():
            raise InstanceGraphError(f"{instance_id}.projection.section 不得为空")
        if "validFrom" in item and item["validFrom"] in (None, ""):
            raise InstanceGraphError(f"{instance_id}.validFrom 不得为空字符串")
        if "validTo" in item and item["validTo"] in (None, ""):
            raise InstanceGraphError(f"{instance_id}.validTo 不得为空字符串")
    relation_ids: set[str] = set()
    for index, raw in enumerate(relations):
        item = _mapping(raw, f"relations[{index}]")
        relation_id = str(item.get("id", "")).strip()
        if not relation_id or relation_id in relation_ids:
            raise InstanceGraphError(f"relations[{index}].id 为空或重复")
        relation_ids.add(relation_id)
        relation_type = str(item.get("type", ""))
        if relation_type not in allowed_relation_types:
            raise InstanceGraphError(f"{relation_id}.type 不是正式本体或已登记业务参数关系")
        if str(item.get("sourceId", "")) not in ids or str(item.get("targetId", "")) not in ids:
            raise InstanceGraphError(f"{relation_id} 存在悬空端点")
        if relation_type in relation_definitions and check_relation_endpoints:
            definition = relation_definitions[relation_type]
            source_type = instance_types[str(item["sourceId"])]
            target_type = instance_types[str(item["targetId"])]
            allowed_source = set(definition.get("source_types", []))
            allowed_target = set(definition.get("target_types", []))
            source_ok = bool(type_aliases.get(source_type, {source_type}) & allowed_source) or source_type in allowed_source
            target_ok = bool(type_aliases.get(target_type, {target_type}) & allowed_target) or target_type in allowed_target
            if not source_ok:
                raise InstanceGraphError(f"{relation_id}.sourceId 类型不符合关系定义域")
            if not target_ok:
                raise InstanceGraphError(f"{relation_id}.targetId 类型不符合关系值域")
        _mapping(item.get("properties"), f"{relation_id}.properties")
    return value


def project_task_view(document: Mapping[str, Any]) -> dict[str, Any]:
    """从实例图确定性恢复阶段消费视图。"""
    raw = copy.deepcopy(dict(document))
    graph = validate_instance_graph(expand_judgment_nested_parameters(raw.pop("business_instance_graph")))
    result = dict(raw)
    grouped: dict[tuple[str, str | None], list[tuple[int, dict[str, Any], str]]] = defaultdict(list)
    for item in graph["objects"]:
        projection = item["projection"]
        grouped[(projection["section"], projection.get("group"))].append(
            (int(projection.get("index", 0)), copy.deepcopy(item["properties"]), item["id"])
        )

    for section in SECTION_TYPES:
        entries = grouped.get((section, None), [])
        if entries:
            result[section] = sorted(entries)[0][1]
    for section in LIST_TYPES:
        result[section] = [item for _, item, _ in sorted(grouped.get((section, None), []))]
    if "judgment_units" in result:
        result["judgment_units"] = _fold_judgment_nested_parameters(result["judgment_units"], grouped)

    scope_entries = sorted(grouped.get(("scope_graph", None), []))
    if scope_entries:
        nodes = []
        root_ref = None
        for _, item, _ in scope_entries:
            item_root_ref = item.pop("root_scope_ref", None)
            root_ref = root_ref or item_root_ref
            nodes.append(item)
        result["scope_graph"] = {"root_scope_ref": root_ref, "nodes": nodes}

    main_paths = []
    for _, path, path_id in sorted(grouped.get(("path_design", "main_paths"), [])):
        path["nodes"] = [item for _, item, _ in sorted(grouped.get(("path_design", path_id), []))]
        main_paths.append(path)
    if main_paths or any(("path_design", group) in grouped for group in PATH_LIST_TYPES):
        path_design = {"main_paths": main_paths}
        for group in PATH_LIST_TYPES:
            path_design[group] = [item for _, item, _ in sorted(grouped.get(("path_design", group), []))]
        result["path_design"] = path_design
    return result


def materialize_document(value: Any) -> Any:
    if isinstance(value, dict) and value.get("schema_name") == "task_ontology_view" and "business_instance_graph" in value:
        return project_task_view(value)
    if isinstance(value, dict) and value.get("document_type") == "reasoning_audit" and "business_instance_graph" in value:
        from runtime_instance_graph import project_reasoning_audit

        return project_reasoning_audit(value)
    return value


def project_downstream_stage_views(document: Mapping[str, Any]) -> dict[str, Any]:
    """从 02 实例图确定性生成 03/04 所需上游视图摘要。"""
    from research_contract import task_view_hash

    source = _mapping(document, "task_ontology_view")
    graph = validate_instance_graph(
        expand_judgment_nested_parameters(copy.deepcopy(source["business_instance_graph"]))
    )
    judgment_unit_ids: list[str] = []
    candidate_claim_ids: list[str] = []
    criterion_ids: list[str] = []
    basket_requirement_ids: list[str] = []
    ju_summaries: list[dict[str, Any]] = []
    for item in graph["objects"]:
        object_type = str(item.get("type"))
        instance_id = str(item.get("id"))
        props = _mapping(item.get("properties"), f"{instance_id}.properties")
        if object_type == "JudgmentUnit":
            judgment_unit_ids.append(instance_id)
            ju_summaries.append({
                "judgment_unit_id": instance_id,
                "judgment_type": props.get("judgment_type"),
                "candidate_claim": props.get("candidate_claim"),
                "content_hash": props.get("content_hash"),
            })
        elif object_type == "CandidateClaim":
            candidate_claim_ids.append(instance_id)
        elif object_type == "JudgmentLevelCriterion":
            criterion_ids.append(instance_id)
        elif object_type == "EvidenceBasketRequirement":
            basket_requirement_ids.append(instance_id)
    view = {
        "schema_name": "stage_downstream_views_from_02",
        "schema_version": "1.0.0",
        "source_02_view_hash": task_view_hash(source),
        "judgment_unit_ids": sorted(judgment_unit_ids),
        "candidate_claim_ids": sorted(candidate_claim_ids),
        "judgment_level_criterion_ids": sorted(criterion_ids),
        "evidence_basket_requirement_ids": sorted(basket_requirement_ids),
        "judgment_units": sorted(ju_summaries, key=lambda item: str(item["judgment_unit_id"])),
    }
    return view


def compact_file(path: str | Path) -> None:
    target = Path(path)
    value = yaml.safe_load(target.read_text(encoding="utf-8-sig"))
    compacted = compact_task_view(_mapping(value, str(target)))
    target.write_text(
        yaml.safe_dump(compacted, allow_unicode=True, sort_keys=False, width=140),
        encoding="utf-8",
    )


def compact_files(paths: Iterable[str | Path]) -> None:
    for path in paths:
        compact_file(path)
