#!/usr/bin/env python3
"""从 v1 权威文件生成 v2 的语义本体、运行合同与研究规则。

该脚本只读取 v1 文件并生成新的权威目录，不修改旧文件。输出采用稳定键顺序，
用于首次迁移和审查迁移内容；完成 v2 切换后，正常维护不再依赖本脚本。
"""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any

import yaml


ROOT = Path(__file__).resolve().parents[1]


def load(relative: str) -> dict[str, Any]:
    return yaml.safe_load((ROOT / relative).read_text(encoding="utf-8")) or {}


def dump(relative: str, data: dict[str, Any]) -> None:
    target = ROOT / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        "# 本文件由迁移工具生成；v2 启用后为对应域的机器权威。\n"
        + yaml.safe_dump(data, allow_unicode=True, sort_keys=False, width=120),
        encoding="utf-8",
    )


def semantic_common(source: dict[str, Any]) -> dict[str, Any]:
    keys = (
        "namespace",
        "object_type_inheritance",
        "data_types",
        "shared_object_properties",
        "shared_relation_properties",
        "common_enums",
    )
    data_types = deepcopy(source["data_types"])
    data_types["compound"] = [
        item for item in data_types.get("compound", [])
        if item not in {"reasoning_ref", "evidence_ref"}
    ]
    return {
        "schema_name": "investment_research_semantic_common",
        "schema_version": "3.0.0",
        "status": "active",
        "description": "严格语义本体公共合同；只定义命名空间、类型、继承、关系和语义约束。",
        **{key: source[key] for key in keys if key not in {"data_types", "common_enums"}},
        "data_types": data_types,
        "common_enums": {"cardinality": source["common_enums"]["cardinality"]},
        "ontology_boundary": {
            "allowed_sections": [
                "object_types",
                "relation_types",
                "object_type_extensions",
                "relation_type_extensions",
                "controlled_vocabularies",
                "semantic_constraints",
                "semantic_instances",
            ],
            "forbidden_resource_kinds": ["action_types", "functions", "logic_flows", "rules"],
            "forbidden_runtime_types": [
                "SourceDocument", "EvidenceClaim", "EvidenceFact", "EvidenceAssessment",
                "EvidenceReadinessAssessment", "ResearchPlan", "ResearchScope", "ResearchQuestion",
                "JudgmentUnit", "Observation", "Event", "Hypothesis", "Signal", "Judgment",
                "MarketExpectation", "ExpectationGap", "AssetImpact", "Scenario", "RuleEvaluation",
                "ReasoningTrace", "ValidationRecord",
            ],
        },
    }


def add_research_metric(semantic: dict[str, Any]) -> None:
    semantic.setdefault("object_types", {})["ResearchMetric"] = {
        "id": "ResearchMetric",
        "name": "研究指标定义",
        "description": "可跨研究任务复用的状态或指标语义定义；具体读数、方向、证据与判断属于运行记录。",
        "primary_key": "id",
        "title_property": "name",
        "validity": True,
        "properties": {
            "name": {"type": "string", "required": True, "description": "指标名称。"},
            "category": {"type": "string", "required": True, "description": "稳定指标类别。"},
            "definition": {"type": "string", "required": True, "description": "不含时点读数的稳定定义。"},
            "variableKind": {"type": "string", "required": False, "description": "定量、定性或派生指标。"},
            "anchorTypes": {"type": "array", "required": True, "description": "允许锚定的稳定语义对象类型。"},
        },
    }
    semantic.setdefault("relation_types", {})["metricAnchoredOn"] = {
        "id": "metricAnchoredOn",
        "name": "研究指标锚定于",
        "description": "研究指标定义适用于某类稳定语义对象。",
        "source_types": ["ResearchMetric"],
        "target_types": [
            "Organization", "Company", "Industry", "Segment", "Product", "Material",
            "ProcessStep", "Region", "Application", "PolicyInstrument", "Asset",
            "FinancialInstrument",
        ],
        "direction": "directed",
        "cardinality": "many_to_many",
        "evidence_required": False,
        "properties": {},
    }


def main() -> None:
    common = load("一级通用本体规范/common.yaml")
    if common.get("authority_targets"):
        raise SystemExit("v2 权威已启用；本脚本仅用于从 b5aaf57 的 v1 文件执行一次性迁移")
    semantic = load("一级通用本体规范/semantic.yaml")
    evidence = load("一级通用本体规范/evidence.yaml")
    reasoning = load("一级通用本体规范/reasoning.yaml")
    sc_common = load("二级半导体领域本体规范/common.yaml")
    sc_semantic = load("二级半导体领域本体规范/semantic.yaml")
    sc_evidence = load("二级半导体领域本体规范/evidence.yaml")
    sc_reasoning = load("二级半导体领域本体规范/reasoning.yaml")
    instances = load("二级半导体领域本体规范/business_instances.yaml")["business_instance_graph"]

    semantic_v2 = {
        "schema_name": "investment_research_semantic_ontology",
        "schema_version": "3.0.0",
        "status": "active",
        "depends_on": ["common.yaml"],
        "description": "跨行业投研严格语义本体；不包含证据、任务、推理、动作或运行状态。",
        "object_types": semantic["object_types"],
        "relation_types": semantic["relation_types"],
    }
    add_research_metric(semantic_v2)
    dump("语义本体/一级通用/common.yaml", semantic_common(common))
    dump("语义本体/一级通用/semantic.yaml", semantic_v2)
    dump(
        "研究运行合同/common.yaml",
        {
            "schema_name": "research_runtime_common",
            "schema_version": "1.0.0",
            "status": "active",
            "description": "研究运行对象、规则资源及跨层引用的公共合同；不是语义本体。",
            **{
                key: common[key]
                for key in (
                    "resource_contracts", "axiom_checks", "reference_direction",
                    "layer_model", "object_role_families", "cross_layer_constraints",
                    "modeling_granularity",
                )
            },
            "runtime_enums": {
                key: value for key, value in common["common_enums"].items()
                if key != "cardinality"
            },
        },
    )

    sc_common_v2 = {
        "schema_name": "semiconductor_semantic_common",
        "schema_version": "3.0.0",
        "status": "active",
        "description": "半导体严格语义本体公共声明。",
        "depends_on": ["../一级通用/common.yaml", "../一级通用/semantic.yaml"],
        "namespace": sc_common["namespace"],
        "extension_governance": sc_common["extension_governance"],
        "domain_scope": sc_common["domain_scope"],
        "naming_conventions": sc_common["naming_conventions"],
        "controlled_vocabulary_contract": sc_common["controlled_vocabulary_contract"],
    }
    sc_semantic_v2 = {
        **{key: value for key, value in sc_semantic.items() if key not in {"schema_version", "depends_on"}},
        "schema_version": "3.0.0",
        "depends_on": ["common.yaml", "../../一级通用/semantic.yaml"],
    }
    metrics = []
    metric_runtime_bindings = []
    runtime_objects = []
    for item in instances["objects"]:
        if item["type"] != "StateVariable":
            runtime_objects.append(item)
            continue
        props = item["properties"]
        metrics.append({
            "id": item["id"],
            "type": "ResearchMetric",
            "properties": {
                "name": props["name"],
                "category": props["category"],
                "definition": props["definition"],
                "variableKind": props.get("variable_kind"),
                "anchorTypes": props.get("anchors", []),
            },
        })
        metric_runtime_bindings.append({
            "metric_ref": item["id"],
            "properties": {
                key: value for key, value in props.items()
                if key not in {"name", "category", "definition", "variable_kind", "anchors"}
            },
        })
    dump("语义本体/二级半导体/common.yaml", sc_common_v2)
    dump("语义本体/二级半导体/semantic.yaml", sc_semantic_v2)
    dump(
        "语义本体/二级半导体/research_metrics.yaml",
        {
            "schema_name": "semiconductor_research_metric_catalog",
            "schema_version": "1.0.0",
            "status": "active",
            "depends_on": ["../一级通用/semantic.yaml", "semantic.yaml"],
            "semantic_instances": metrics,
        },
    )

    for name, source in (("evidence", evidence), ("reasoning", reasoning)):
        dump(
            f"研究运行合同/{name}.yaml",
            {
                "schema_name": f"research_runtime_{name}",
                "schema_version": "1.0.0",
                "status": "active",
                "description": f"{name} 应用数据模型与运行关系；不是语义本体。",
                "object_types": source["object_types"],
                "relation_types": source["relation_types"],
            },
        )
        dump(
            f"研究规则/{name}.yaml",
            {
                "schema_name": f"research_{name}_execution_rules",
                "schema_version": "1.0.0",
                "status": "active",
                "description": f"{name} 动作、函数、流程与确定性规则；不是语义本体。",
                "action_types": source["action_types"],
                "functions": source["functions"],
                "logic_flows": source["logic_flows"],
                "rules": source["rules"],
            },
        )
    dump(
        "研究规则/semantic_governance.yaml",
        {
            "schema_name": "semantic_governance_execution_rules",
            "schema_version": "1.0.0",
            "status": "active",
            "description": "语义对象维护动作、函数、流程与准入规则；不属于本体。",
            "action_types": semantic["action_types"],
            "functions": semantic["functions"],
            "logic_flows": semantic["logic_flows"],
            "rules": semantic["rules"],
        },
    )
    dump(
        "研究规则/二级半导体/evidence_policy.yaml",
        {**sc_evidence, "schema_version": "1.0.0", "status": "active"},
    )
    dump(
        "研究规则/二级半导体/reasoning_policy.yaml",
        {**sc_reasoning, "schema_version": "1.0.0", "status": "active"},
    )
    dump(
        "研究规则/二级半导体/research_config.yaml",
        {
            "schema_name": "semiconductor_research_runtime_config",
            "schema_version": "1.0.0",
            "status": "active",
            "runtime_objects": runtime_objects,
            "runtime_relations": instances["relations"],
            "metric_runtime_bindings": metric_runtime_bindings,
        },
    )


if __name__ == "__main__":
    main()
