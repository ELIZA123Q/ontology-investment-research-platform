#!/usr/bin/env python3
"""从既有 YAML、CSV 与推理审计生成三张离线交互式投研关系图。"""

from __future__ import annotations

import argparse
import csv
import html
import json
import re
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

import yaml


ROOT = Path(__file__).resolve().parent
VIEW_PATH = ROOT / "存储芯片周期本体视图-20260703-1.yaml"
AUDIT_PATH = ROOT / "存储芯片周期推理审计-20260703-1.yaml"
SNAPSHOT_DIR = ROOT / "存储芯片周期数据与证据快照-20260703-1"
VIS_PATH = ROOT / "vis-network.min.js"

OUTPUTS = {
    "er": ROOT / "存储芯片周期实体关系ER图-20260703-1.html",
    "ontology": ROOT / "存储芯片周期本体网络图-20260703-1.html",
    "reasoning": ROOT / "存储芯片周期推理路径图-20260703-1.html",
}

ENTITY_LABELS = {
    "Industry": "产业",
    "Segment": "产业链环节",
    "Product": "产品",
    "Application": "应用场景",
    "Company": "公司",
    "ManufacturingFacility": "制造设施",
    "ProcessStep": "工艺步骤（隐式依赖）",
}

ENTITY_STYLES = {
    "Industry": ("star", "#eef2ff", "#4f46e5"),
    "Segment": ("square", "#e0f2fe", "#0284c7"),
    "Product": ("box", "#dbeafe", "#2563eb"),
    "Application": ("hexagon", "#ecfeff", "#0891b2"),
    "Company": ("dot", "#f1f5f9", "#475569"),
    "ManufacturingFacility": ("diamond", "#ede9fe", "#7c3aed"),
    "ProcessStep": ("square", "#f8fafc", "#94a3b8"),
}

PATH_SHORT_NAMES = {
    "N-01": "终端需求",
    "N-02": "订单与库存",
    "N-03": "有效供给",
    "N-04": "价格阶段",
    "N-05": "新增供给",
    "N-06": "需求破坏",
    "N-07": "结束窗口",
}

EDGE_SEMANTICS = {
    ("N-01", "N-02"): ("support", "需求向订单传导"),
    ("N-02", "N-03"): ("support", "订单支撑产能压力"),
    ("N-03", "N-04"): ("support", "供给约束支撑价格压力"),
    ("N-03", "N-05"): ("condition", "紧张状态触发供给释放验证"),
    ("N-01", "N-06"): ("weaken", "需求分化形成削弱信号"),
    ("N-02", "N-06"): ("weaken", "取消与延迟拉货形成削弱信号"),
    ("N-04", "N-07"): ("weaken", "涨价斜率放缓但不等同结束"),
    ("N-05", "N-07"): ("condition", "合格有效供给是正常化条件"),
    ("N-06", "N-07"): ("block", "需求破坏可阻断延续路径"),
}

EDGE_STYLE = {
    "support": {"color": "#2563eb", "width": 3, "dashes": False},
    "weaken": {"color": "#d97706", "width": 2.5, "dashes": [8, 5]},
    "condition": {"color": "#0f766e", "width": 2.5, "dashes": [3, 4]},
    "block": {"color": "#dc2626", "width": 4, "dashes": False},
}


def load_csv(name: str) -> list[dict[str, str]]:
    path = SNAPSHOT_DIR / name
    with path.open(newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def split_refs(value: str | None) -> list[str]:
    return [item for item in (value or "").split("|") if item]


def nonempty(row: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in row.items() if value not in (None, "")}


def truncate(value: str, limit: int = 180) -> str:
    value = re.sub(r"\s+", " ", value or "").strip()
    return value if len(value) <= limit else value[: limit - 1] + "…"


def parse_coverage(value: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for part in split_refs(value):
        if "=" in part:
            key, raw = part.split("=", 1)
            result[key] = raw
    return result


def node(
    node_id: str,
    label: str,
    category: str,
    shape: str,
    background: str,
    border: str,
    details: dict[str, Any],
    *,
    x: int | None = None,
    y: int | None = None,
    level: int | None = None,
    border_width: int = 2,
    font_color: str = "#0f172a",
) -> dict[str, Any]:
    item: dict[str, Any] = {
        "id": node_id,
        "label": label,
        "category": category,
        "shape": shape,
        "color": {
            "background": background,
            "border": border,
            "highlight": {"background": background, "border": "#0f172a"},
            "hover": {"background": background, "border": "#0f172a"},
        },
        "borderWidth": border_width,
        "font": {"face": "Arial, PingFang SC, Microsoft YaHei, sans-serif", "size": 14, "color": font_color},
        "margin": 10,
        "details": details,
    }
    if x is not None:
        item["x"] = x
    if y is not None:
        item["y"] = y
    if level is not None:
        item["level"] = level
    return item


def edge(
    edge_id: str,
    source: str,
    target: str,
    label: str,
    category: str,
    details: dict[str, Any],
    *,
    color: str = "#94a3b8",
    width: float = 1.5,
    dashes: bool | list[int] = False,
    status: str = "",
    arrows: str = "to",
) -> dict[str, Any]:
    return {
        "id": edge_id,
        "from": source,
        "to": target,
        "label": label,
        "category": category,
        "status": status,
        "color": {"color": color, "highlight": "#0f172a", "hover": "#334155"},
        "width": width,
        "dashes": dashes,
        "arrows": arrows,
        "smooth": {"enabled": True, "type": "cubicBezier", "roundness": 0.35},
        "font": {"size": 10, "color": "#475569", "strokeWidth": 4, "strokeColor": "#ffffff", "align": "middle"},
        "details": details,
    }


def section(title: str, **payload: Any) -> dict[str, Any]:
    return {"title": title, **payload}


def load_inputs() -> dict[str, Any]:
    return {
        "view": yaml.safe_load(VIEW_PATH.read_text(encoding="utf-8")),
        "audit": yaml.safe_load(AUDIT_PATH.read_text(encoding="utf-8")),
        "instances": load_csv("semantic_instances.csv"),
        "relations": load_csv("semantic_relations.csv"),
        "path_readiness": load_csv("path_readiness.csv"),
        "reasoning_inputs": load_csv("reasoning_inputs.csv"),
        "evidence": load_csv("evidence_records.csv"),
        "coverage": load_csv("state_variable_coverage.csv"),
        "manifest": load_csv("manifest.csv"),
    }


def build_er_graph(data: dict[str, Any]) -> dict[str, Any]:
    view = data["view"]
    instances = data["instances"]
    relations = data["relations"]
    relation_defs = {item["id"]: item for item in view["semantic_view"]["relation_types"]}
    instance_ids = {item["instance_id"] for item in instances}

    if len(instances) != 13 or len(relations) != 17:
        raise ValueError(f"ER 口径异常：实例 {len(instances)}，关系 {len(relations)}")
    dangling = [
        item["relation_id"]
        for item in relations
        if item["source_instance_id"] not in instance_ids or item["target_instance_id"] not in instance_ids
    ]
    if dangling:
        raise ValueError(f"ER 存在悬空关系：{dangling}")

    nodes: list[dict[str, Any]] = []
    for item in instances:
        instance_type = item["instance_type"]
        shape, background, border = ENTITY_STYLES[instance_type]
        nodes.append(
            node(
                item["instance_id"],
                item["name"],
                instance_type,
                shape,
                background,
                border,
                {
                    "kind": "业务实体实例",
                    "subtitle": ENTITY_LABELS.get(instance_type, instance_type),
                    "badges": [item["verification_status"], instance_type],
                    "sections": [
                        section(
                            "实体信息",
                            keyValues={
                                "实例 ID": item["instance_id"],
                                "实体类型": f"{ENTITY_LABELS.get(instance_type, instance_type)} / {instance_type}",
                                "名称": item["name"],
                                "规范名称": item["canonical_name"],
                                "稳定标识": item["stable_identifier"],
                                "分类": item["classification"],
                                "范围": item["scope"],
                                "有效期起": item["valid_from"],
                                "有效期止": item["valid_to"] or "持续有效",
                                "核验状态": item["verification_status"],
                            },
                        ),
                        section(
                            "证据留痕",
                            keyValues={
                                "来源运行": split_refs(item["source_run_refs"]),
                                "证据记录": split_refs(item["evidence_refs"]),
                                "说明": item["notes"],
                            },
                        ),
                    ],
                },
            )
        )

    edges: list[dict[str, Any]] = []
    for item in relations:
        definition = relation_defs[item["relation_type"]]
        planned = item["verification_status"] == "planned"
        edges.append(
            edge(
                item["relation_id"],
                item["source_instance_id"],
                item["target_instance_id"],
                definition.get("name", item["relation_type"]),
                item["relation_type"],
                {
                    "kind": "实际业务关系",
                    "subtitle": definition.get("name", item["relation_type"]),
                    "badges": [item["verification_status"], item["relation_type"]],
                    "sections": [
                        section(
                            "关系信息",
                            keyValues={
                                "关系 ID": item["relation_id"],
                                "关系类型": item["relation_type"],
                                "定义": definition.get("description", ""),
                                "源实体": item["source_instance_id"],
                                "目标实体": item["target_instance_id"],
                                "关系范围": item["relation_scope"],
                                "核验状态": item["verification_status"],
                                "有效期起": item["valid_from"],
                                "有效期止": item["valid_to"] or "持续有效",
                            },
                        ),
                        section(
                            "证据留痕",
                            keyValues={
                                "来源运行": split_refs(item["source_run_refs"]),
                                "证据记录": split_refs(item["evidence_refs"]),
                                "说明": item["notes"],
                            },
                        ),
                    ],
                },
                color="#d97706" if planned else "#64748b",
                width=2.5 if planned else 1.8,
                dashes=[8, 5] if planned else False,
                status=item["verification_status"],
            )
        )

    entity_types = [key for key in ENTITY_LABELS if key != "ProcessStep" and any(n["category"] == key for n in nodes)]
    relation_types = [item["id"] for item in view["semantic_view"]["relation_types"]]
    verified = sum(item["verification_status"] == "verified" for item in relations)
    planned = sum(item["verification_status"] == "planned" for item in relations)

    return {
        "meta": {
            "type": "er",
            "title": "存储芯片周期实体关系 ER 图",
            "subtitle": "业务实体实例口径 · 数据截止 2026-07-03",
            "scopeNote": "仅展示本次任务实际使用的 13 个业务实体和 17 条关系；孤立产业节点如实保留，不推断缺失关系。",
            "stats": [f"{len(nodes)} 个实体", f"{len(edges)} 条关系", f"{verified} verified", f"{planned} planned"],
            "initialSelection": "INST-P-DRAM",
        },
        "nodes": nodes,
        "edges": edges,
        "filterSections": [
            {
                "title": "实体类型",
                "items": [
                    {"id": f"node-{value}", "label": ENTITY_LABELS[value], "target": "nodeCategory", "value": value, "default": True}
                    for value in entity_types
                ],
            },
            {
                "title": "关系状态",
                "items": [
                    {"id": "status-verified", "label": "verified · 已核验", "target": "edgeStatus", "value": "verified", "default": True},
                    {"id": "status-planned", "label": "planned · 计划关系", "target": "edgeStatus", "value": "planned", "default": True},
                ],
            },
            {
                "title": "关系类型",
                "collapsed": True,
                "items": [
                    {
                        "id": f"edge-{value}",
                        "label": relation_defs[value].get("name", value),
                        "target": "edgeCategory",
                        "value": value,
                        "default": True,
                    }
                    for value in relation_types
                ],
            },
        ],
        "legend": [
            *[
                {
                    "label": ENTITY_LABELS[value],
                    "shape": ENTITY_STYLES[value][0],
                    "fill": ENTITY_STYLES[value][1],
                    "stroke": ENTITY_STYLES[value][2],
                    "filterId": f"node-{value}",
                }
                for value in entity_types
            ],
            {"label": "verified 关系", "line": "solid", "stroke": "#64748b", "filterId": "status-verified"},
            {"label": "planned 关系", "line": "dashed", "stroke": "#d97706", "filterId": "status-planned"},
        ],
        "highlights": [],
        "resources": {},
        "networkOptions": {
            "layout": {"improvedLayout": True},
            "physics": {
                "enabled": True,
                "solver": "forceAtlas2Based",
                "forceAtlas2Based": {
                    "gravitationalConstant": -95,
                    "centralGravity": 0.012,
                    "springLength": 175,
                    "springConstant": 0.04,
                    "damping": 0.55,
                    "avoidOverlap": 1,
                },
                "stabilization": {"enabled": True, "iterations": 260, "fit": True},
            },
        },
    }


def ontology_positions(category: str, index: int) -> tuple[int, int]:
    columns = {
        "object": (-720, -360, 145),
        "relation": (-430, -290, 145),
        "event": (-150, -220, 150),
        "state": (170, -500, 100),
        "evidence": (520, -350, 130),
        "counter": (760, -210, 190),
        "rule": (1010, -380, 135),
        "scenario": (1240, -150, 170),
        "implicit": (-100, 600, 150),
    }
    x, start_y, step = columns[category]
    return x, start_y + index * step


def build_ontology_graph(data: dict[str, Any]) -> dict[str, Any]:
    view = data["view"]
    semantic = view["semantic_view"]
    reasoning = view["reasoning_view"]
    evidence_view = view["evidence_view"]
    bindings = view["instance_requirements"]["evidence_bindings"]
    state_bindings = {
        item["requirement_id"]: item["state_variable_ref"]
        for item in view["instance_requirements"]["state_bindings"]
    }

    object_ids = {item["id"] for item in semantic["object_types"]}
    state_ids = {item["id"] for item in reasoning["state_variables"]}
    implicit_objects = {
        anchor
        for item in reasoning["state_variables"]
        for anchor in item.get("allowed_anchor_types", [])
        if anchor not in object_ids
    }
    implicit_states = {
        state_id
        for item in reasoning["propagation_templates"]
        for state_id in item.get("source_variables", []) + item.get("target_variables", [])
        if state_id not in state_ids
    }
    if implicit_objects != {"ProcessStep"} or implicit_states != {"technology_maturity", "adoption_penetration"}:
        raise ValueError(f"隐式依赖口径异常：对象={implicit_objects}，变量={implicit_states}")

    evidence_ids = {
        item["requirement_id"] for item in evidence_view["evidence_requirements"]
    } | {item["requirement_id"] for item in evidence_view["counter_evidence_requirements"]}
    catalogs = {
        "object_types": object_ids,
        "relation_types": {item["id"] for item in semantic["relation_types"]},
        "event_types": {item["id"] for item in reasoning["event_types"]},
        "state_variables": state_ids,
        "propagation_templates": {item["id"] for item in reasoning["propagation_templates"]},
        "rules": {item["id"] for item in reasoning["rules"]},
    }
    reference_errors: list[str] = []
    for relation in semantic["relation_types"]:
        for ref in relation.get("source_types", []) + relation.get("target_types", []):
            if ref not in object_ids:
                reference_errors.append(f"relation:{relation['id']} -> object:{ref}")
    for event_item in reasoning["event_types"]:
        for ref in event_item.get("applicable_object_types", []):
            if ref not in object_ids:
                reference_errors.append(f"event:{event_item['id']} -> object:{ref}")
        for ref in event_item.get("evidence_requirements", []):
            if ref not in evidence_ids:
                reference_errors.append(f"event:{event_item['id']} -> evidence:{ref}")
    for state_item in reasoning["state_variables"]:
        for ref in state_item.get("allowed_anchor_types", []):
            if ref not in object_ids | implicit_objects:
                reference_errors.append(f"state:{state_item['id']} -> anchor:{ref}")
    for template in reasoning["propagation_templates"]:
        for ref in template.get("source_variables", []) + template.get("target_variables", []):
            if ref not in state_ids | implicit_states:
                reference_errors.append(f"propagation:{template['id']} -> state:{ref}")
        for ref in template.get("evidence_requirements", []):
            if ref not in evidence_ids:
                reference_errors.append(f"propagation:{template['id']} -> evidence:{ref}")
    for path in view["candidate_paths"]:
        for path_node in path["nodes"]:
            for ref_type, refs in path_node.get("ontology_refs", {}).items():
                catalog = catalogs.get(ref_type)
                if catalog is None:
                    reference_errors.append(f"path:{path_node['node_id']} -> unknown_catalog:{ref_type}")
                    continue
                for ref in refs:
                    if ref not in catalog:
                        reference_errors.append(f"path:{path_node['node_id']} -> {ref_type}:{ref}")
            for ref in path_node.get("evidence_requirements", []):
                if ref not in evidence_ids:
                    reference_errors.append(f"path:{path_node['node_id']} -> evidence:{ref}")
    if reference_errors:
        raise ValueError(f"本体引用无法解析：{reference_errors}")

    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []

    def add_ontology_node(
        raw: dict[str, Any], category: str, item_id: str, label: str, index: int, shape: str, bg: str, border: str, kind: str
    ) -> None:
        x, y = ontology_positions(category, index)
        detail_rows = {
            "ID": item_id,
            "名称": label,
            **{
                key: value
                for key, value in raw.items()
                if key not in {"id", "name", "requirement_id"} and value not in (None, "", [])
            },
        }
        nodes.append(
            node(
                f"{category}:{item_id}",
                label,
                category,
                shape,
                bg,
                border,
                {
                    "kind": kind,
                    "subtitle": category,
                    "badges": [category, item_id],
                    "sections": [section("定义与引用", keyValues=detail_rows)],
                },
                x=x,
                y=y,
            )
        )

    for index, item in enumerate(semantic["object_types"]):
        add_ontology_node(item, "object", item["id"], item.get("name", item["id"]), index, "ellipse", "#dbeafe", "#2563eb", "对象类型")
    for index, item in enumerate(semantic["relation_types"]):
        add_ontology_node(item, "relation", item["id"], item.get("name", item["id"]), index, "diamond", "#e0f2fe", "#0284c7", "关系类型")
    for index, item in enumerate(reasoning["event_types"]):
        add_ontology_node(item, "event", item["id"], item.get("name", item["id"]), index, "triangle", "#f3e8ff", "#9333ea", "事件类型")
    for index, item in enumerate(reasoning["state_variables"]):
        add_ontology_node(item, "state", item["id"], item.get("name", item["id"]), index, "database", "#ccfbf1", "#0f766e", "状态变量")
    for index, item in enumerate(evidence_view["evidence_requirements"]):
        item_id = item["requirement_id"]
        add_ontology_node(item, "evidence", item_id, item.get("purpose", item_id), index, "box", "#fef3c7", "#d97706", "证据要求")
    for index, item in enumerate(evidence_view["counter_evidence_requirements"]):
        item_id = item["requirement_id"]
        add_ontology_node(item, "counter", item_id, item.get("name", item.get("condition", item_id)), index, "box", "#fee2e2", "#dc2626", "反证要求")
    for index, item in enumerate(reasoning["rules"]):
        add_ontology_node(item, "rule", item["id"], item.get("name", item["id"]), index, "hexagon", "#f1f5f9", "#475569", "推理规则（默认隐藏）")
    for index, item in enumerate(reasoning["scenario_templates"]):
        add_ontology_node(item, "scenario", item["id"], item.get("name", item["id"]), index, "star", "#ede9fe", "#7c3aed", "情景模板（默认隐藏）")

    implicit_items = [
        ("ProcessStep", "工艺步骤", "implicit_object", "未在本次 semantic_view 中显式选择，但被 yield_maturity.allowed_anchor_types 引用。"),
        ("technology_maturity", "技术成熟度", "implicit_state", "未在本次 state_variables 中显式选择，但被 advanced_packaging_to_inputs.source_variables 引用。"),
        ("adoption_penetration", "采用渗透率", "implicit_state", "未在本次 state_variables 中显式选择，但被 advanced_packaging_to_inputs.source_variables 引用。"),
    ]
    for index, (item_id, label, implicit_type, note) in enumerate(implicit_items):
        x, y = ontology_positions("implicit", index)
        nodes.append(
            node(
                f"implicit:{item_id}",
                label,
                "implicit",
                "square" if implicit_type == "implicit_object" else "database",
                "#f8fafc",
                "#94a3b8",
                {
                    "kind": "隐式依赖（默认隐藏）",
                    "subtitle": implicit_type,
                    "badges": ["implicit", "partial"],
                    "sections": [section("引用说明", keyValues={"ID": item_id, "说明": note, "处理": "保留为隐式依赖，不补写完整定义"})],
                },
                x=x,
                y=y,
            )
        )

    edge_counter = 0

    def add_edge(source: str, target: str, label: str, category: str, detail: dict[str, Any], **style: Any) -> None:
        nonlocal edge_counter
        edge_counter += 1
        edges.append(edge(f"ONT-E-{edge_counter:03d}", source, target, label, category, detail, **style))

    for relation in semantic["relation_types"]:
        relation_node = f"relation:{relation['id']}"
        for source in relation.get("source_types", []):
            add_edge(
                f"object:{source}",
                relation_node,
                "源类型",
                "semantic",
                {"kind": "关系定义域", "subtitle": relation.get("name", relation["id"]), "badges": ["semantic"], "sections": [section("引用", keyValues={"源类型": source, "关系": relation["id"]})]},
                color="#60a5fa",
            )
        for target in relation.get("target_types", []):
            add_edge(
                relation_node,
                f"object:{target}",
                "目标类型",
                "semantic",
                {"kind": "关系值域", "subtitle": relation.get("name", relation["id"]), "badges": ["semantic"], "sections": [section("引用", keyValues={"关系": relation["id"], "目标类型": target})]},
                color="#60a5fa",
            )

    for event_item in reasoning["event_types"]:
        for target in event_item.get("applicable_object_types", []):
            add_edge(
                f"event:{event_item['id']}",
                f"object:{target}",
                "适用于",
                "applicability",
                {"kind": "事件适用范围", "subtitle": event_item.get("name", event_item["id"]), "badges": ["event"], "sections": [section("引用", keyValues={"事件": event_item["id"], "对象类型": target})]},
                color="#c084fc",
                dashes=[4, 4],
            )

    for state_item in reasoning["state_variables"]:
        for target in state_item.get("allowed_anchor_types", []):
            target_id = f"object:{target}" if target in object_ids else f"implicit:{target}"
            add_edge(
                f"state:{state_item['id']}",
                target_id,
                "可锚定",
                "anchor",
                {"kind": "状态变量锚点约束", "subtitle": state_item.get("name", state_item["id"]), "badges": ["anchor"], "sections": [section("引用", keyValues={"状态变量": state_item["id"], "允许锚点": target})]},
                color="#94a3b8",
                dashes=[2, 5],
            )

    for template in reasoning["propagation_templates"]:
        for source in template.get("source_variables", []):
            source_id = f"state:{source}" if source in state_ids else f"implicit:{source}"
            for target in template.get("target_variables", []):
                target_id = f"state:{target}" if target in state_ids else f"implicit:{target}"
                add_edge(
                    source_id,
                    target_id,
                    template.get("name", template["id"]),
                    "propagation",
                    {
                        "kind": "传导模板（主干边）",
                        "subtitle": template.get("name", template["id"]),
                        "badges": ["propagation", template["id"]],
                        "sections": [
                            section(
                                "传导约束",
                                keyValues={
                                    "模板 ID": template["id"],
                                    "说明": template.get("description", ""),
                                    "成立条件": template.get("conditions", []),
                                    "削弱条件": template.get("weaken_conditions", []),
                                    "阻断条件": template.get("block_conditions", []),
                                    "证据要求": template.get("evidence_requirements", []),
                                    "路径节点": template.get("used_by_path_nodes", []),
                                },
                            )
                        ],
                    },
                    color="#0f766e",
                    width=3,
                )

    seen_bindings: set[tuple[str, str]] = set()
    for binding in bindings:
        requirement = binding["evidence_requirement_ref"]
        if requirement not in evidence_ids:
            raise ValueError(f"证据绑定引用不存在：{requirement}")
        source_category = "evidence" if requirement.startswith("ER-") else "counter"
        for state_binding_ref in binding["bind_to"].get("state_binding_requirement_refs", []):
            if state_binding_ref not in state_bindings:
                raise ValueError(f"状态绑定引用不存在：{state_binding_ref}")
            target = state_bindings[state_binding_ref]
            pair = (requirement, target)
            if pair in seen_bindings:
                continue
            seen_bindings.add(pair)
            counter = source_category == "counter"
            add_edge(
                f"{source_category}:{requirement}",
                f"state:{target}",
                "反证约束" if counter else "证据支撑",
                "counterEvidence" if counter else "evidenceBinding",
                {
                    "kind": "证据绑定",
                    "subtitle": requirement,
                    "badges": ["counter" if counter else "evidence"],
                    "sections": [section("绑定", keyValues={"证据要求": requirement, "状态绑定": state_binding_ref, "状态变量": target})],
                },
                color="#dc2626" if counter else "#d97706",
                width=2 if counter else 1.6,
                dashes=[7, 5] if counter else [2, 4],
            )

    expected_default = (
        len(semantic["object_types"])
        + len(semantic["relation_types"])
        + len(reasoning["event_types"])
        + len(reasoning["state_variables"])
        + len(evidence_view["evidence_requirements"])
        + len(evidence_view["counter_evidence_requirements"])
    )
    if expected_default != 35:
        raise ValueError(f"本体默认层口径异常：{expected_default}")

    return {
        "meta": {
            "type": "ontology",
            "title": "存储芯片周期本体网络图",
            "subtitle": f"任务本体视图 {view['task_context']['view_id']} · 数据截止 2026-07-03",
            "scopeNote": "默认显示 35 个显式本体节点；规则、情景与 3 个隐式依赖默认隐藏。传导模板以主干边呈现，缺失定义不作推断补齐。",
            "stats": ["6 类对象", "5 类关系", "4 类事件", "11 个状态变量", "9 类证据 / 反证"],
            "initialSelection": "state:product_price_pressure",
        },
        "nodes": nodes,
        "edges": edges,
        "filterSections": [
            {
                "title": "默认本体层",
                "items": [
                    {"id": "ont-object", "label": "对象类型 · 6", "target": "nodeCategory", "value": "object", "default": True},
                    {"id": "ont-relation", "label": "关系类型 · 5", "target": "nodeCategory", "value": "relation", "default": True},
                    {"id": "ont-event", "label": "事件类型 · 4", "target": "nodeCategory", "value": "event", "default": True},
                    {"id": "ont-state", "label": "状态变量 · 11", "target": "nodeCategory", "value": "state", "default": True},
                    {"id": "ont-evidence", "label": "证据要求 · 6", "target": "nodeCategory", "value": "evidence", "default": True},
                    {"id": "ont-counter", "label": "反证要求 · 3", "target": "nodeCategory", "value": "counter", "default": True},
                ],
            },
            {
                "title": "扩展层（默认隐藏）",
                "items": [
                    {"id": "ont-rule", "label": "推理规则 · 6", "target": "nodeCategory", "value": "rule", "default": False},
                    {"id": "ont-scenario", "label": "情景模板 · 3", "target": "nodeCategory", "value": "scenario", "default": False},
                    {"id": "ont-implicit", "label": "隐式依赖 · 3", "target": "nodeCategory", "value": "implicit", "default": False},
                ],
            },
        ],
        "legend": [
            {"label": "对象类型", "shape": "ellipse", "fill": "#dbeafe", "stroke": "#2563eb", "filterId": "ont-object"},
            {"label": "关系类型", "shape": "diamond", "fill": "#e0f2fe", "stroke": "#0284c7", "filterId": "ont-relation"},
            {"label": "事件类型", "shape": "triangle", "fill": "#f3e8ff", "stroke": "#9333ea", "filterId": "ont-event"},
            {"label": "状态变量", "shape": "database", "fill": "#ccfbf1", "stroke": "#0f766e", "filterId": "ont-state"},
            {"label": "证据要求", "shape": "box", "fill": "#fef3c7", "stroke": "#d97706", "filterId": "ont-evidence"},
            {"label": "反证要求", "shape": "box", "fill": "#fee2e2", "stroke": "#dc2626", "filterId": "ont-counter"},
            {"label": "传导模板主干", "line": "solid", "stroke": "#0f766e"},
            {"label": "证据 / 反证绑定", "line": "dashed", "stroke": "#d97706"},
        ],
        "highlights": [],
        "resources": {},
        "networkOptions": {
            "layout": {"improvedLayout": False},
            "physics": {"enabled": False},
        },
    }


def audit_conclusions(audit: dict[str, Any]) -> dict[str, dict[str, str]]:
    conclusions: dict[str, dict[str, str]] = {}
    for item in audit["path_results"]:
        node_id = item["node_id"]
        conclusions[node_id] = {
            "name": item["node_name"],
            "status": item["status"],
            "inputs": f"{len(item['input_refs'])} 条推理输入 / {len(item['evidence_refs'])} 条证据",
            "logic": " / ".join([*item["template_refs"], *item["rule_refs"]]),
            "impact": item["downstream_effect"],
        }
    if set(conclusions) != set(PATH_SHORT_NAMES):
        raise ValueError(f"推理审计路径结果解析异常：{sorted(conclusions)}")
    return conclusions


def build_reasoning_graph(data: dict[str, Any]) -> dict[str, Any]:
    view = data["view"]
    audit = data["audit"]
    readiness = data["path_readiness"]
    reasoning_inputs = data["reasoning_inputs"]
    evidence_records = data["evidence"]
    coverage_rows = data["coverage"]
    manifest = data["manifest"][0]
    conclusions = audit_conclusions(audit)

    if len(readiness) != 7:
        raise ValueError(f"推理路径节点口径异常：{len(readiness)}")
    if len(reasoning_inputs) != 50 or len(evidence_records) != 48:
        raise ValueError(f"推理资源口径异常：输入 {len(reasoning_inputs)}，证据 {len(evidence_records)}")
    counted = [row for row in coverage_rows if row["evidence_gate_status"] == "counted"]
    blocked = [row for row in coverage_rows if row["evidence_gate_status"] != "counted"]
    if len(coverage_rows) != 48 or len(counted) != 46 or len(blocked) != 2:
        raise ValueError(f"覆盖单元口径异常：total={len(coverage_rows)}, counted={len(counted)}, blocked={len(blocked)}")

    readiness_by_node = {row["node_id"]: row for row in readiness}
    input_ids = {row["input_id"] for row in reasoning_inputs}
    evidence_ids = {row["evidence_id"] for row in evidence_records}
    linked_input_ids = {item for row in readiness for item in split_refs(row["linked_input_ids"])}
    linked_evidence_ids = {item for row in readiness for item in split_refs(row["linked_evidence_ids"])}
    path_nodes: dict[str, dict[str, Any]] = {}
    dependency_pairs: list[tuple[str, str, str]] = []
    for path in view["candidate_paths"]:
        for raw_node in path["nodes"]:
            node_id = raw_node["node_id"]
            path_nodes.setdefault(node_id, {**raw_node, "path_id": path["path_id"], "path_name": path["name"]})
            for dependency in raw_node.get("depends_on", []):
                dependency_pairs.append((dependency, node_id, path["path_id"]))
    if len(path_nodes) != 7 or len(dependency_pairs) != 9:
        raise ValueError(f"候选路径口径异常：节点 {len(path_nodes)}，依赖边 {len(dependency_pairs)}")

    # path_readiness 的显式列表遗漏 RI-16 / EV-12；依据二者共同绑定的
    # yield_maturity，将其补充归属到引用该状态变量的路径节点。保留显式与
    # 补充映射的区分，不回写源 CSV。
    supplemental_inputs: dict[str, list[str]] = defaultdict(list)
    supplemental_evidence: dict[str, list[str]] = defaultdict(list)
    for item in reasoning_inputs:
        if item["input_id"] in linked_input_ids:
            continue
        state_refs = {item["primary_state_variable_id"], *split_refs(item["supports_state_variable_ids"])}
        for node_id, raw_node in path_nodes.items():
            if state_refs & set(raw_node.get("ontology_refs", {}).get("state_variables", [])):
                supplemental_inputs[node_id].append(item["input_id"])
    for item in evidence_records:
        if item["evidence_id"] in linked_evidence_ids:
            continue
        state_refs = set(split_refs(item["state_variable_ids"]))
        for node_id, raw_node in path_nodes.items():
            if state_refs & set(raw_node.get("ontology_refs", {}).get("state_variables", [])):
                supplemental_evidence[node_id].append(item["evidence_id"])

    mapped_inputs = linked_input_ids | {item for values in supplemental_inputs.values() for item in values}
    mapped_evidence = linked_evidence_ids | {item for values in supplemental_evidence.values() for item in values}
    if mapped_inputs != input_ids or mapped_evidence != evidence_ids:
        raise ValueError(
            "路径资源补充归属后仍未完整映射："
            f"inputs {len(mapped_inputs)}/{len(input_ids)}, evidence {len(mapped_evidence)}/{len(evidence_ids)}"
        )

    node_levels = {"N-01": 0, "N-02": 1, "N-03": 2, "N-06": 2, "N-04": 3, "N-05": 3, "N-07": 4}
    nodes: list[dict[str, Any]] = []
    for node_id in PATH_SHORT_NAMES:
        raw_node = path_nodes[node_id]
        row = readiness_by_node[node_id]
        conclusion = conclusions[node_id]
        coverage = parse_coverage(row["variable_coverage_summary"])
        total = coverage.get("total", "?")
        backed = coverage.get("evidence_backed", "?")
        admission = row["admission"]
        path_id = row["path_id"]
        bg = "#dbeafe" if path_id == "P-01" else "#ede9fe"
        border = "#2563eb" if path_id == "P-01" else "#7c3aed"
        if admission == "incomplete_pass":
            border = "#d97706"
        node_blocked = [item["coverage_id"] for item in blocked if node_id in split_refs(item["used_by_path_nodes"])]
        node_inputs = [*split_refs(row["linked_input_ids"]), *supplemental_inputs[node_id]]
        node_evidence = [*split_refs(row["linked_evidence_ids"]), *supplemental_evidence[node_id]]
        details = {
            "kind": "推理路径节点",
            "subtitle": f"{path_id} · {raw_node['path_name']}",
            "badges": [admission, row["readiness_status"], conclusion["status"]],
            "sections": [
                section(
                    "路径判断",
                    keyValues={
                        "节点": node_id,
                        "问题": row["node_question"],
                        "路径": f"{path_id} · {row['path_name']}",
                        "关键性": row["criticality"],
                        "覆盖率": row["variable_coverage_summary"],
                        "准入": admission,
                        "就绪状态": row["readiness_status"],
                        "实例状态": row["instance_status"],
                        "证据状态": row["evidence_status"],
                        "反证状态": row["counter_evidence_status"],
                        "范围对齐": row["scope_alignment"],
                        "时间对齐": row["time_alignment"],
                    },
                ),
                section(
                    "结论摘要",
                    keyValues={
                        "04 路径状态": conclusion["status"],
                        "主要输入": conclusion["inputs"],
                        "规则 / 模板": conclusion["logic"],
                        "对后续影响": conclusion["impact"],
                        "降级原因": row["downgrade_reason"] or "无额外降级",
                        "说明": row["notes"],
                    },
                ),
                section(
                    "映射引用",
                    keyValues={
                        "状态变量": split_refs(row["state_variable_ids"]),
                        "需求 / 证据要求": split_refs(row["requirement_ids"]),
                        "业务实例": split_refs(row["linked_instance_ids"]),
                        "业务关系": split_refs(row["linked_relation_ids"]),
                        "补充归属输入": supplemental_inputs[node_id],
                        "补充归属证据": supplemental_evidence[node_id],
                        "补充映射规则": "按记录自身 state_variable_ids 与路径节点 ontology_refs.state_variables 的交集归属；不修改源 CSV。" if supplemental_inputs[node_id] or supplemental_evidence[node_id] else "无",
                    },
                ),
            ],
            "datasets": [
                {
                    "title": "推理输入",
                    "resource": "reasoningInputs",
                    "ids": node_inputs,
                    "idField": "input_id",
                    "summaryFields": ["normalized_value", "raw_value", "direction", "verification_status", "notes"],
                },
                {
                    "title": "证据记录",
                    "resource": "evidenceRecords",
                    "ids": node_evidence,
                    "idField": "evidence_id",
                    "summaryFields": ["normalized_fact", "claim_text", "evidence_role", "quality_status", "source_id", "notes"],
                },
                {
                    "title": "阻断 / 未计入覆盖单元",
                    "resource": "coverageUnits",
                    "ids": node_blocked,
                    "idField": "coverage_id",
                    "summaryFields": ["state_variable_name", "anchor_instance_id", "evidence_gate_status", "evidence_gate_reason", "profile_gap_reasons", "notes"],
                },
            ],
        }
        nodes.append(
            node(
                node_id,
                f"{node_id}  {PATH_SHORT_NAMES[node_id]}\n{backed}/{total} · {admission}",
                path_id,
                "box",
                bg,
                border,
                details,
                level=node_levels[node_id],
                border_width=3,
            )
        )

    edges: list[dict[str, Any]] = []
    for index, (source, target, path_id) in enumerate(dependency_pairs, 1):
        semantic, explanation = EDGE_SEMANTICS[(source, target)]
        style = EDGE_STYLE[semantic]
        edges.append(
            edge(
                f"PATH-E-{index:02d}",
                source,
                target,
                explanation,
                semantic,
                {
                    "kind": "路径依赖边",
                    "subtitle": explanation,
                    "badges": [semantic, path_id],
                    "sections": [
                        section(
                            "依赖语义",
                            keyValues={
                                "源节点": source,
                                "目标节点": target,
                                "语义": {"support": "支持", "weaken": "削弱", "condition": "条件", "block": "阻断"}[semantic],
                                "说明": explanation,
                                "边界": "表示本次推理的依赖与约束，不表示确定因果关系。",
                            },
                        )
                    ],
                },
                color=style["color"],
                width=style["width"],
                dashes=style["dashes"],
            )
        )

    overall = audit["overall_judgment"]
    claim_by_id = {item["claim_id"]: item for item in audit["claim_register"]}
    if overall["conclusion_level"] != "observation" or overall["confidence"] != "medium":
        raise ValueError("推理审计整体等级异常")
    for claim_id, phrase in (("C-03", "2026H2"), ("C-04", "2027H2—2028")):
        if claim_id not in claim_by_id or phrase not in claim_by_id[claim_id]["statement"]:
            raise ValueError(f"推理审计缺少高亮观点：{claim_id} / {phrase}")

    return {
        "meta": {
            "type": "reasoning",
            "title": "存储芯片周期推理路径图",
            "subtitle": "P-01 当前周期位置 · P-02 周期结束条件与时间窗口 · 数据截止 2026-07-03",
            "scopeNote": "路径边表示支持、削弱、条件或阻断关系；整体结论等级仅作审计约束，不压平具体观点强度。",
            "stats": ["7 个路径节点", "9 条依赖边", "50 条推理输入", "48 条证据", "46 counted / 2 blocked"],
            "initialSelection": "N-07",
        },
        "nodes": nodes,
        "edges": edges,
        "filterSections": [
            {
                "title": "推理路径",
                "items": [
                    {"id": "path-p01", "label": "P-01 当前周期位置", "target": "nodeCategory", "value": "P-01", "default": True},
                    {"id": "path-p02", "label": "P-02 结束条件与窗口", "target": "nodeCategory", "value": "P-02", "default": True},
                ],
            },
            {
                "title": "路径边语义",
                "items": [
                    {"id": "sem-support", "label": "支持", "target": "edgeCategory", "value": "support", "default": True},
                    {"id": "sem-weaken", "label": "削弱", "target": "edgeCategory", "value": "weaken", "default": True},
                    {"id": "sem-condition", "label": "条件", "target": "edgeCategory", "value": "condition", "default": True},
                    {"id": "sem-block", "label": "阻断", "target": "edgeCategory", "value": "block", "default": True},
                ],
            },
        ],
        "legend": [
            {"label": "P-01 当前周期位置", "shape": "box", "fill": "#dbeafe", "stroke": "#2563eb", "filterId": "path-p01"},
            {"label": "P-02 结束条件与窗口", "shape": "box", "fill": "#ede9fe", "stroke": "#7c3aed", "filterId": "path-p02"},
            {"label": "支持", "line": "solid", "stroke": "#2563eb", "filterId": "sem-support"},
            {"label": "削弱", "line": "dashed", "stroke": "#d97706", "filterId": "sem-weaken"},
            {"label": "条件", "line": "dotted", "stroke": "#0f766e", "filterId": "sem-condition"},
            {"label": "阻断", "line": "solid", "stroke": "#dc2626", "filterId": "sem-block"},
        ],
        "highlights": [
            {"tone": "amber", "label": "价格阶段", "value": claim_by_id["C-03"]["statement"]},
            {"tone": "teal", "label": "正常化窗口", "value": claim_by_id["C-04"]["statement"]},
            {"tone": "blue", "label": "审计级别", "value": f"{overall['conclusion_level']} / {overall['confidence']}"},
        ],
        "resources": {
            "reasoningInputs": {row["input_id"]: nonempty(row) for row in reasoning_inputs},
            "evidenceRecords": {row["evidence_id"]: nonempty(row) for row in evidence_records},
            "coverageUnits": {row["coverage_id"]: nonempty(row) for row in blocked},
        },
        "networkOptions": {
            "layout": {
                "improvedLayout": False,
                "hierarchical": {
                    "enabled": True,
                    "direction": "LR",
                    "sortMethod": "directed",
                    "levelSeparation": 260,
                    "nodeSpacing": 165,
                    "treeSpacing": 210,
                    "blockShifting": True,
                    "edgeMinimization": True,
                    "parentCentralization": True,
                },
            },
            "physics": {"enabled": False},
        },
        "audit": {
            "coverageTotal": int(manifest["coverage_unit_total"]),
            "coverageCounted": int(manifest["evidence_backed_unit_count"]),
            "admission": manifest["admission"],
            "confidence": manifest["confidence_ceiling"],
        },
    }


HTML_TEMPLATE = r'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <title>__TITLE__</title>
  <script src="./vis-network.min.js"></script>
  <style>
    :root {
      --bg: #f8fafc;
      --surface: #ffffff;
      --surface-muted: #f8fafc;
      --text: #0f172a;
      --muted: #64748b;
      --border: #e2e8f0;
      --border-strong: #cbd5e1;
      --accent: #2563eb;
      --accent-soft: #eff6ff;
      --focus: #1d4ed8;
      --danger: #dc2626;
      --radius: 8px;
      --left-width: 252px;
      --right-width: 344px;
    }

    * { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; }
    body {
      min-width: 320px;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", Arial, sans-serif;
      font-size: 14px;
      overflow: hidden;
    }
    button, input { font: inherit; }
    button:focus-visible, input:focus-visible, summary:focus-visible {
      outline: 2px solid var(--focus);
      outline-offset: 2px;
    }

    .app { height: 100%; display: flex; flex-direction: column; }
    .topbar {
      flex: 0 0 auto;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 24px;
      padding: 17px 22px 15px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
    }
    .heading { min-width: 0; }
    h1 { margin: 0; font-size: 20px; line-height: 1.3; letter-spacing: -0.01em; font-weight: 700; }
    .subtitle { margin-top: 5px; color: var(--muted); font-size: 13px; line-height: 1.45; }
    .stats { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px 14px; max-width: 560px; color: #475569; font-size: 12px; line-height: 1.6; }
    .stat { white-space: nowrap; }
    .stat::before { content: ""; display: inline-block; width: 5px; height: 5px; margin: 0 7px 2px 0; border-radius: 50%; background: #94a3b8; }

    .insight-bar {
      flex: 0 0 auto;
      display: none;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 1px;
      background: var(--border);
      border-bottom: 1px solid var(--border);
    }
    .insight { padding: 10px 18px; background: var(--surface); min-width: 0; }
    .insight-label { display: block; margin-bottom: 2px; color: var(--muted); font-size: 11px; font-weight: 650; letter-spacing: .04em; }
    .insight-value { display: block; font-size: 14px; font-weight: 700; line-height: 1.35; }
    .insight[data-tone="amber"] { box-shadow: inset 3px 0 #d97706; }
    .insight[data-tone="teal"] { box-shadow: inset 3px 0 #0f766e; }
    .insight[data-tone="blue"] { box-shadow: inset 3px 0 #2563eb; }

    .scope-note {
      flex: 0 0 auto;
      padding: 8px 22px;
      color: #475569;
      background: #f8fafc;
      border-bottom: 1px solid var(--border);
      font-size: 12px;
      line-height: 1.45;
    }
    .workspace {
      flex: 1 1 auto;
      min-height: 0;
      display: grid;
      grid-template-columns: var(--left-width) minmax(0, 1fr) var(--right-width);
    }
    .sidebar, .inspector { min-height: 0; background: var(--surface); overflow-y: auto; }
    .sidebar { border-right: 1px solid var(--border); padding: 15px 14px 18px; }
    .inspector { border-left: 1px solid var(--border); }
    .canvas-wrap { position: relative; min-width: 0; min-height: 0; overflow: hidden; background: var(--bg); }
    #network { position: absolute; inset: 0; }
    .canvas-grain {
      position: absolute;
      inset: 0;
      pointer-events: none;
      opacity: .42;
      background-image: radial-gradient(#cbd5e1 0.7px, transparent 0.7px);
      background-size: 20px 20px;
    }

    .search-wrap { position: relative; margin-bottom: 10px; }
    .search-icon { position: absolute; left: 10px; top: 10px; width: 15px; height: 15px; color: #64748b; pointer-events: none; }
    #search { width: 100%; height: 36px; padding: 7px 32px 7px 32px; border: 1px solid var(--border-strong); border-radius: var(--radius); background: #fff; color: var(--text); font-size: 13px; }
    #search::placeholder { color: #94a3b8; }
    #clear-search { position: absolute; right: 4px; top: 4px; display: none; width: 28px; height: 28px; padding: 0; border: 0; background: transparent; color: #64748b; cursor: pointer; border-radius: 6px; }
    #clear-search:hover { background: #f1f5f9; color: var(--text); }
    .search-results { display: none; position: absolute; z-index: 8; top: 40px; left: 0; right: 0; max-height: 260px; overflow-y: auto; padding: 5px; background: #fff; border: 1px solid var(--border-strong); border-radius: var(--radius); box-shadow: 0 12px 26px rgba(15, 23, 42, .12); }
    .search-results.open { display: block; }
    .search-result { display: block; width: 100%; padding: 8px 9px; border: 0; border-radius: 6px; background: transparent; text-align: left; cursor: pointer; }
    .search-result:hover, .search-result.active { background: var(--accent-soft); }
    .result-label { display: block; color: var(--text); font-size: 12px; font-weight: 650; }
    .result-meta { display: block; margin-top: 2px; color: var(--muted); font-size: 10px; }
    .search-empty { padding: 10px; color: var(--muted); font-size: 12px; }

    .button-row { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-bottom: 17px; }
    .control-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 34px; padding: 7px 9px; border: 1px solid var(--border-strong); border-radius: var(--radius); background: #fff; color: #334155; font-size: 12px; font-weight: 650; cursor: pointer; }
    .control-btn:hover { border-color: #94a3b8; background: #f8fafc; color: var(--text); }
    .control-btn svg { width: 14px; height: 14px; }
    .panel-title { margin: 17px 0 8px; color: #334155; font-size: 12px; font-weight: 750; letter-spacing: .04em; }
    .panel-title:first-of-type { margin-top: 0; }
    .filter-section { border-top: 1px solid var(--border); padding-top: 1px; }
    .filter-section summary { margin: 0 -2px; padding: 11px 2px 7px; color: #334155; font-size: 12px; font-weight: 750; cursor: pointer; list-style: none; }
    .filter-section summary::-webkit-details-marker { display: none; }
    .filter-section summary::after { content: ""; float: right; width: 6px; height: 6px; margin: 3px 3px 0 0; border-right: 1.5px solid #64748b; border-bottom: 1.5px solid #64748b; transform: rotate(45deg); transition: transform .16s ease; }
    .filter-section:not([open]) summary::after { margin-top: 6px; transform: rotate(-45deg); }
    .filter-list { display: grid; gap: 2px; padding-bottom: 8px; }
    .filter-label { display: flex; align-items: center; gap: 8px; min-height: 29px; padding: 4px 5px; border-radius: 6px; color: #475569; font-size: 12px; cursor: pointer; }
    .filter-label:hover { background: #f8fafc; color: var(--text); }
    .filter-label input { width: 14px; height: 14px; margin: 0; accent-color: var(--accent); }

    .legend { display: grid; gap: 4px; }
    .legend-item { display: flex; align-items: center; gap: 8px; min-height: 27px; padding: 3px 5px; border: 0; border-radius: 6px; background: transparent; color: #475569; font-size: 11px; text-align: left; }
    button.legend-item { width: 100%; cursor: pointer; }
    button.legend-item:hover { background: #f8fafc; color: var(--text); }
    .legend-item.off { opacity: .42; }
    .legend-symbol { position: relative; flex: 0 0 18px; width: 18px; height: 15px; }
    .legend-symbol.node-shape { border: 2px solid var(--symbol-stroke); background: var(--symbol-fill); border-radius: 4px; }
    .legend-symbol[data-shape="ellipse"] { border-radius: 50%; }
    .legend-symbol[data-shape="dot"] { width: 14px; height: 14px; margin: 0 2px; border-radius: 50%; }
    .legend-symbol[data-shape="diamond"] { width: 13px; height: 13px; margin: 1px 2px; transform: rotate(45deg); border-radius: 2px; }
    .legend-symbol[data-shape="triangle"] { width: 0; height: 0; border: 0; border-left: 8px solid transparent; border-right: 8px solid transparent; border-bottom: 15px solid var(--symbol-stroke); background: transparent; }
    .legend-symbol[data-shape="star"] { border-radius: 50%; box-shadow: inset 0 0 0 3px var(--symbol-fill); }
    .legend-symbol[data-shape="database"] { border-radius: 50% 50% 35% 35%; }
    .legend-symbol.edge-line::before { content: ""; position: absolute; left: 0; right: 0; top: 7px; border-top: 2px solid var(--symbol-stroke); }
    .legend-symbol.edge-line[data-line="dashed"]::before { border-top-style: dashed; }
    .legend-symbol.edge-line[data-line="dotted"]::before { border-top-style: dotted; }
    .legend-symbol.edge-line::after { content: ""; position: absolute; right: 0; top: 4px; width: 5px; height: 5px; border-top: 2px solid var(--symbol-stroke); border-right: 2px solid var(--symbol-stroke); transform: rotate(45deg); }

    .visible-count { margin-top: 14px; padding: 10px; border: 1px solid var(--border); border-radius: var(--radius); background: #f8fafc; color: var(--muted); font-size: 11px; line-height: 1.55; }
    .visible-count strong { color: #334155; font-weight: 700; }
    .canvas-status { position: absolute; z-index: 2; left: 12px; bottom: 10px; max-width: calc(100% - 24px); padding: 6px 9px; border: 1px solid rgba(203, 213, 225, .9); border-radius: 6px; background: rgba(255, 255, 255, .9); color: #64748b; font-size: 10px; line-height: 1.4; pointer-events: none; backdrop-filter: blur(6px); }
    .error-banner { display: none; position: absolute; z-index: 12; top: 14px; left: 50%; transform: translateX(-50%); width: min(560px, calc(100% - 28px)); padding: 11px 13px; border: 1px solid #fecaca; border-radius: var(--radius); background: #fef2f2; color: #991b1b; font-size: 12px; line-height: 1.5; }

    .inspector-head { position: sticky; z-index: 3; top: 0; padding: 15px 16px 13px; background: rgba(255,255,255,.96); border-bottom: 1px solid var(--border); backdrop-filter: blur(7px); }
    .inspector-kicker { color: var(--muted); font-size: 10px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
    #detail-title { margin: 4px 0 0; font-size: 17px; line-height: 1.35; word-break: break-word; }
    #detail-subtitle { margin-top: 4px; color: var(--muted); font-size: 11px; line-height: 1.45; word-break: break-word; }
    #detail-badges { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 9px; }
    .badge { display: inline-flex; align-items: center; min-height: 21px; padding: 3px 7px; border: 1px solid var(--border); border-radius: 999px; background: #f8fafc; color: #475569; font-size: 10px; font-weight: 650; }
    .badge[data-tone="danger"] { border-color: #fecaca; background: #fef2f2; color: #b91c1c; }
    .badge[data-tone="warn"] { border-color: #fde68a; background: #fffbeb; color: #a16207; }
    .badge[data-tone="good"] { border-color: #bbf7d0; background: #f0fdf4; color: #15803d; }
    .detail-body { padding: 2px 16px 24px; }
    .empty-state { padding: 28px 4px; color: var(--muted); font-size: 12px; line-height: 1.7; }
    .detail-section { padding: 15px 0 13px; border-bottom: 1px solid var(--border); }
    .detail-section h3 { margin: 0 0 10px; color: #334155; font-size: 12px; font-weight: 750; }
    .kv { display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 7px 10px; margin: 0; }
    .kv dt { color: var(--muted); font-size: 11px; line-height: 1.55; }
    .kv dd { margin: 0; color: #1e293b; font-size: 11px; line-height: 1.55; word-break: break-word; white-space: pre-wrap; }
    .list-value { display: flex; flex-wrap: wrap; gap: 4px; }
    .mini-token { display: inline-block; padding: 2px 5px; border-radius: 4px; background: #f1f5f9; color: #475569; font-size: 10px; }
    .dataset { border-bottom: 1px solid var(--border); }
    .dataset summary { padding: 13px 0; color: #334155; font-size: 12px; font-weight: 750; cursor: pointer; list-style: none; }
    .dataset summary::-webkit-details-marker { display: none; }
    .dataset summary::after { content: "+"; float: right; color: #64748b; font-size: 15px; font-weight: 400; }
    .dataset[open] summary::after { content: "−"; }
    .record-list { display: grid; gap: 7px; padding: 0 0 13px; }
    .record { padding: 9px 10px; border: 1px solid var(--border); border-radius: 6px; background: #f8fafc; }
    .record-id { display: block; margin-bottom: 5px; color: #334155; font-size: 10px; font-weight: 750; }
    .record-line { margin-top: 4px; color: #475569; font-size: 10px; line-height: 1.5; word-break: break-word; }
    .record-line strong { color: #64748b; font-weight: 650; }
    .record-empty { padding: 0 0 13px; color: var(--muted); font-size: 11px; }

    @media (max-width: 1120px) {
      :root { --left-width: 224px; --right-width: 306px; }
      .topbar { gap: 15px; padding-inline: 17px; }
      .stats { max-width: 410px; }
    }
    @media (max-width: 820px) {
      body { overflow: auto; }
      .app { height: auto; min-height: 100%; }
      .topbar { display: block; }
      .stats { justify-content: flex-start; max-width: none; margin-top: 10px; }
      .insight-bar { grid-template-columns: 1fr; }
      .workspace { display: grid; grid-template-columns: 1fr; }
      .sidebar, .inspector { overflow: visible; border: 0; }
      .sidebar { border-bottom: 1px solid var(--border); }
      .canvas-wrap { min-height: 68vh; }
      .inspector { border-top: 1px solid var(--border); }
      .filter-sections { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 0 12px; }
      .legend { grid-template-columns: repeat(2, minmax(0,1fr)); }
      .inspector-head { position: static; }
    }
    @media (prefers-reduced-motion: reduce) {
      * { scroll-behavior: auto !important; transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
    }
  </style>
</head>
<body>
  <div class="app">
    <header class="topbar">
      <div class="heading">
        <h1 id="app-title"></h1>
        <div class="subtitle" id="app-subtitle"></div>
      </div>
      <div class="stats" id="stats" aria-label="图谱统计"></div>
    </header>
    <section class="insight-bar" id="insight-bar" aria-label="核心结论"></section>
    <div class="scope-note" id="scope-note"></div>
    <main class="workspace">
      <aside class="sidebar" aria-label="图谱控制">
        <div class="search-wrap">
          <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg>
          <input id="search" type="search" autocomplete="off" placeholder="搜索节点或关系" aria-label="搜索节点或关系">
          <button id="clear-search" aria-label="清除搜索">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m7 7 10 10M17 7 7 17"></path></svg>
          </button>
          <div class="search-results" id="search-results" role="listbox"></div>
        </div>
        <div class="button-row">
          <button class="control-btn" id="fit-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"></path></svg>
            适配画布
          </button>
          <button class="control-btn" id="reset-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 4v6h6M20 20v-6h-6"></path><path d="M5.1 15a8 8 0 0 0 13.5 2M18.9 9A8 8 0 0 0 5.4 7"></path></svg>
            重置筛选
          </button>
        </div>
        <div class="filter-sections" id="filter-sections"></div>
        <div class="panel-title">图例</div>
        <div class="legend" id="legend"></div>
        <div class="visible-count" id="visible-count"></div>
      </aside>
      <section class="canvas-wrap" aria-label="交互关系图画布">
        <div class="canvas-grain"></div>
        <div id="network"></div>
        <div class="error-banner" id="error-banner"></div>
        <div class="canvas-status">滚轮缩放 · 拖动画布 · 点击节点或连线查看详情</div>
      </section>
      <aside class="inspector" aria-label="对象详情">
        <div class="inspector-head">
          <div class="inspector-kicker" id="detail-kicker">对象详情</div>
          <h2 id="detail-title">请选择节点或连线</h2>
          <div id="detail-subtitle">详情将显示在这里</div>
          <div id="detail-badges"></div>
        </div>
        <div class="detail-body" id="detail-body">
          <div class="empty-state">点击画布中的节点或连线，查看定义、状态、证据引用与使用边界。</div>
        </div>
      </aside>
    </main>
  </div>
  <script id="graph-data" type="application/json">__GRAPH_JSON__</script>
  <script>
    (() => {
      'use strict';
      const CONFIG = JSON.parse(document.getElementById('graph-data').textContent);
      const byId = (id) => document.getElementById(id);
      const allFilters = CONFIG.filterSections.flatMap(section => section.items);
      const filterState = new Map(allFilters.map(item => [item.id, item.default !== false]));
      const nodeMap = new Map(CONFIG.nodes.map(item => [String(item.id), item]));
      const edgeMap = new Map(CONFIG.edges.map(item => [String(item.id), item]));
      let network = null;
      let currentSearchResults = [];

      function escapeHtml(value) {
        return String(value ?? '')
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#039;');
      }

      function badgeTone(value) {
        const text = String(value).toLowerCase();
        if (/(blocked|not_counted|reject|失败|阻断)/.test(text)) return 'danger';
        if (/(partial|planned|incomplete|limit|medium|观察|条件)/.test(text)) return 'warn';
        if (/(verified|ready|counted|complete|met)/.test(text)) return 'good';
        return '';
      }

      function showError(message) {
        const banner = byId('error-banner');
        banner.textContent = message;
        banner.style.display = 'block';
      }

      function renderHeader() {
        document.title = CONFIG.meta.title;
        byId('app-title').textContent = CONFIG.meta.title;
        byId('app-subtitle').textContent = CONFIG.meta.subtitle;
        byId('scope-note').textContent = CONFIG.meta.scopeNote;
        byId('stats').innerHTML = CONFIG.meta.stats.map(item => `<span class="stat">${escapeHtml(item)}</span>`).join('');
        if (CONFIG.highlights?.length) {
          const bar = byId('insight-bar');
          bar.style.display = 'grid';
          bar.innerHTML = CONFIG.highlights.map(item => `
            <div class="insight" data-tone="${escapeHtml(item.tone)}">
              <span class="insight-label">${escapeHtml(item.label)}</span>
              <span class="insight-value">${escapeHtml(item.value)}</span>
            </div>`).join('');
        }
      }

      function filterEnabled(target, value) {
        const matches = allFilters.filter(item => item.target === target && item.value === value);
        return matches.length === 0 || matches.some(item => filterState.get(item.id));
      }

      function graphData() {
        const visibleNodes = CONFIG.nodes.filter(item => filterEnabled('nodeCategory', item.category));
        const visibleIds = new Set(visibleNodes.map(item => String(item.id)));
        const visibleEdges = CONFIG.edges.filter(item =>
          visibleIds.has(String(item.from)) &&
          visibleIds.has(String(item.to)) &&
          filterEnabled('edgeCategory', item.category) &&
          filterEnabled('edgeStatus', item.status)
        );
        return { nodes: visibleNodes, edges: visibleEdges };
      }

      function refreshCounts(data = graphData()) {
        byId('visible-count').innerHTML = `当前显示 <strong>${data.nodes.length}</strong> / ${CONFIG.nodes.length} 个节点<br>` +
          `<strong>${data.edges.length}</strong> / ${CONFIG.edges.length} 条连线`;
      }

      function renderFilters() {
        byId('filter-sections').innerHTML = CONFIG.filterSections.map((section, index) => `
          <details class="filter-section" ${section.collapsed ? '' : 'open'}>
            <summary>${escapeHtml(section.title)}</summary>
            <div class="filter-list">
              ${section.items.map(item => `
                <label class="filter-label">
                  <input type="checkbox" data-filter-id="${escapeHtml(item.id)}" ${filterState.get(item.id) ? 'checked' : ''}>
                  <span>${escapeHtml(item.label)}</span>
                </label>`).join('')}
            </div>
          </details>`).join('');
        document.querySelectorAll('[data-filter-id]').forEach(input => {
          input.addEventListener('change', event => {
            const id = event.currentTarget.dataset.filterId;
            filterState.set(id, event.currentTarget.checked);
            applyFilters(true);
          });
        });
      }

      function legendSymbol(item) {
        if (item.line) {
          return `<span class="legend-symbol edge-line" data-line="${escapeHtml(item.line)}" style="--symbol-stroke:${escapeHtml(item.stroke)}"></span>`;
        }
        return `<span class="legend-symbol node-shape" data-shape="${escapeHtml(item.shape)}" style="--symbol-fill:${escapeHtml(item.fill)};--symbol-stroke:${escapeHtml(item.stroke)}"></span>`;
      }

      function renderLegend() {
        byId('legend').innerHTML = CONFIG.legend.map(item => {
          const tag = item.filterId ? 'button' : 'div';
          const off = item.filterId && !filterState.get(item.filterId) ? ' off' : '';
          const attrs = item.filterId ? `type="button" data-legend-filter="${escapeHtml(item.filterId)}"` : '';
          return `<${tag} class="legend-item${off}" ${attrs}>${legendSymbol(item)}<span>${escapeHtml(item.label)}</span></${tag}>`;
        }).join('');
        document.querySelectorAll('[data-legend-filter]').forEach(button => {
          button.addEventListener('click', event => {
            const id = event.currentTarget.dataset.legendFilter;
            filterState.set(id, !filterState.get(id));
            const input = document.querySelector(`[data-filter-id="${CSS.escape(id)}"]`);
            if (input) input.checked = filterState.get(id);
            applyFilters(true);
          });
        });
      }

      function applyFilters(fit = false) {
        if (!network) return;
        const data = graphData();
        network.setData(data);
        renderLegend();
        refreshCounts(data);
        clearSearchResults();
        if (fit) window.setTimeout(() => network.fit({ animation: { duration: 350, easingFunction: 'easeInOutQuad' } }), 30);
      }

      function formatValue(value) {
        if (Array.isArray(value)) {
          if (!value.length) return '<span class="muted">—</span>';
          return `<span class="list-value">${value.map(item => `<span class="mini-token">${escapeHtml(item)}</span>`).join('')}</span>`;
        }
        if (value && typeof value === 'object') {
          return escapeHtml(JSON.stringify(value, null, 2));
        }
        const text = String(value ?? '').trim();
        return text ? escapeHtml(text) : '—';
      }

      function renderSections(sections) {
        return (sections || []).map(section => {
          const rows = Object.entries(section.keyValues || {}).map(([key, value]) => `
            <dt>${escapeHtml(key)}</dt><dd>${formatValue(value)}</dd>`).join('');
          return `<section class="detail-section"><h3>${escapeHtml(section.title)}</h3><dl class="kv">${rows}</dl></section>`;
        }).join('');
      }

      function renderDataset(dataset) {
        const resource = CONFIG.resources?.[dataset.resource] || {};
        const records = dataset.ids.map(id => resource[id]).filter(Boolean);
        const body = records.length ? `<div class="record-list">${records.map(record => {
          const recordId = record[dataset.idField] || 'record';
          const lines = dataset.summaryFields
            .filter(field => record[field])
            .map(field => `<div class="record-line"><strong>${escapeHtml(field)}</strong> ${escapeHtml(record[field])}</div>`)
            .join('');
          return `<article class="record"><span class="record-id">${escapeHtml(recordId)}</span>${lines}</article>`;
        }).join('')}</div>` : '<div class="record-empty">本节点没有该类记录。</div>';
        return `<details class="dataset"><summary>${escapeHtml(dataset.title)} · ${records.length}</summary>${body}</details>`;
      }

      function renderDetails(entity, entityType) {
        const detail = entity.details || {};
        byId('detail-kicker').textContent = entityType === 'edge' ? '连线详情' : '对象详情';
        byId('detail-title').textContent = entity.label || detail.subtitle || entity.id;
        byId('detail-subtitle').textContent = detail.kind || entity.id;
        byId('detail-badges').innerHTML = (detail.badges || []).map(value => `<span class="badge" data-tone="${badgeTone(value)}">${escapeHtml(value)}</span>`).join('');
        byId('detail-body').innerHTML = renderSections(detail.sections) + (detail.datasets || []).map(renderDataset).join('');
      }

      function selectEntity(kind, id, focus = false) {
        const map = kind === 'node' ? nodeMap : edgeMap;
        const entity = map.get(String(id));
        if (!entity || !network) return;
        renderDetails(entity, kind);
        if (kind === 'node') {
          network.selectNodes([id]);
          if (focus) network.focus(id, { scale: 1.0, animation: { duration: 450, easingFunction: 'easeInOutQuad' } });
        } else {
          network.selectEdges([id]);
        }
      }

      function searchHaystack(kind, item) {
        return [kind, item.id, item.label, item.category, item.status, JSON.stringify(item.details || {})].join(' ').toLowerCase();
      }

      function clearSearchResults() {
        currentSearchResults = [];
        byId('search-results').classList.remove('open');
        byId('search-results').innerHTML = '';
      }

      function runSearch() {
        const query = byId('search').value.trim().toLowerCase();
        byId('clear-search').style.display = query ? 'block' : 'none';
        if (!query) return clearSearchResults();
        const data = graphData();
        const nodeIds = new Set(data.nodes.map(item => String(item.id)));
        const edgeIds = new Set(data.edges.map(item => String(item.id)));
        const matches = [
          ...CONFIG.nodes.filter(item => nodeIds.has(String(item.id))).map(item => ({ kind: 'node', item })),
          ...CONFIG.edges.filter(item => edgeIds.has(String(item.id))).map(item => ({ kind: 'edge', item })),
        ].filter(entry => searchHaystack(entry.kind, entry.item).includes(query)).slice(0, 20);
        currentSearchResults = matches;
        const results = byId('search-results');
        results.innerHTML = matches.length ? matches.map((entry, index) => `
          <button class="search-result${index === 0 ? ' active' : ''}" role="option" data-search-kind="${entry.kind}" data-search-id="${escapeHtml(entry.item.id)}">
            <span class="result-label">${escapeHtml(entry.item.label || entry.item.id)}</span>
            <span class="result-meta">${entry.kind === 'node' ? '节点' : '连线'} · ${escapeHtml(entry.item.id)} · ${escapeHtml(entry.item.category || entry.item.status || '')}</span>
          </button>`).join('') : '<div class="search-empty">当前筛选范围内没有匹配结果</div>';
        results.classList.add('open');
        results.querySelectorAll('[data-search-id]').forEach(button => {
          button.addEventListener('click', event => {
            const target = event.currentTarget;
            selectEntity(target.dataset.searchKind, target.dataset.searchId, true);
            clearSearchResults();
          });
        });
      }

      function resetAll() {
        allFilters.forEach(item => filterState.set(item.id, item.default !== false));
        byId('search').value = '';
        byId('clear-search').style.display = 'none';
        renderFilters();
        applyFilters(true);
        const initial = CONFIG.meta.initialSelection;
        if (initial && nodeMap.has(String(initial))) window.setTimeout(() => selectEntity('node', initial, false), 90);
      }

      function initNetwork() {
        if (typeof vis === 'undefined' || !vis.Network) {
          showError('图形库加载失败：请确认 vis-network.min.js 与本 HTML 位于同一目录。');
          return;
        }
        const options = {
          autoResize: true,
          interaction: {
            hover: true,
            tooltipDelay: 160,
            hideEdgesOnDrag: false,
            hideEdgesOnZoom: false,
            keyboard: { enabled: true, bindToWindow: false },
            multiselect: false,
            navigationButtons: false,
          },
          nodes: { chosen: true, shadow: false },
          edges: { chosen: true, selectionWidth: 1.6, hoverWidth: 0.7 },
          ...CONFIG.networkOptions,
        };
        const data = graphData();
        network = new vis.Network(byId('network'), data, options);
        refreshCounts(data);
        network.once('afterDrawing', () => {
          network.fit({ animation: false });
          const initial = CONFIG.meta.initialSelection;
          if (initial && nodeMap.has(String(initial))) selectEntity('node', initial, false);
        });
        if (CONFIG.networkOptions?.physics?.enabled) {
          network.once('stabilizationIterationsDone', () => network.fit({ animation: { duration: 420, easingFunction: 'easeInOutQuad' } }));
        }
        network.on('click', params => {
          if (params.nodes.length) return selectEntity('node', params.nodes[0]);
          if (params.edges.length) return selectEntity('edge', params.edges[0]);
        });
      }

      renderHeader();
      renderFilters();
      renderLegend();
      initNetwork();

      byId('fit-btn').addEventListener('click', () => network?.fit({ animation: { duration: 400, easingFunction: 'easeInOutQuad' } }));
      byId('reset-btn').addEventListener('click', resetAll);
      byId('search').addEventListener('input', runSearch);
      byId('search').addEventListener('focus', runSearch);
      byId('search').addEventListener('keydown', event => {
        if (event.key === 'Enter' && currentSearchResults.length) {
          event.preventDefault();
          const first = currentSearchResults[0];
          selectEntity(first.kind, first.item.id, true);
          clearSearchResults();
        }
        if (event.key === 'Escape') clearSearchResults();
      });
      byId('clear-search').addEventListener('click', () => {
        byId('search').value = '';
        byId('search').focus();
        runSearch();
      });
      document.addEventListener('click', event => {
        if (!event.target.closest('.search-wrap')) clearSearchResults();
      });
    })();
  </script>
</body>
</html>
'''


def render_html(config: dict[str, Any]) -> str:
    graph_json = json.dumps(config, ensure_ascii=False, separators=(",", ":"))
    graph_json = graph_json.replace("</", "<\\/")
    return (
        HTML_TEMPLATE.replace("__TITLE__", html.escape(config["meta"]["title"]))
        .replace("__GRAPH_JSON__", graph_json)
    )


def validate_html(path: Path, expected_nodes: int, expected_edges: int) -> dict[str, int]:
    text = path.read_text(encoding="utf-8")
    if '<script src="./vis-network.min.js"></script>' not in text:
        raise ValueError(f"{path.name}: 未引用本地 vis-network.min.js")
    external_assets = re.findall(r'<(?:script|link)[^>]+(?:src|href)=["\']https?://', text, flags=re.I)
    if external_assets:
        raise ValueError(f"{path.name}: 存在外部资源依赖")
    match = re.search(r'<script id="graph-data" type="application/json">(.*?)</script>', text, flags=re.S)
    if not match:
        raise ValueError(f"{path.name}: 找不到嵌入图谱 JSON")
    embedded = json.loads(match.group(1).replace("<\\/", "</"))
    if len(embedded["nodes"]) != expected_nodes or len(embedded["edges"]) != expected_edges:
        raise ValueError(
            f"{path.name}: 嵌入数量异常 nodes={len(embedded['nodes'])}, edges={len(embedded['edges'])}"
        )
    if "存储芯片" not in text or "搜索节点或关系" not in text:
        raise ValueError(f"{path.name}: 中文内容或交互控件缺失")

    html_ids = re.findall(r'\bid="([^"]+)"', text)
    duplicate_ids = sorted({item for item in html_ids if html_ids.count(item) > 1})
    if duplicate_ids:
        raise ValueError(f"{path.name}: HTML id 重复：{duplicate_ids}")
    required_interactions = [
        "network.on('click'",
        "network.fit(",
        "data-filter-id",
        "data-legend-filter",
        "addEventListener('input', runSearch)",
        "addEventListener('click', resetAll)",
        "renderDetails(",
    ]
    missing_interactions = [item for item in required_interactions if item not in text]
    if missing_interactions:
        raise ValueError(f"{path.name}: 交互契约缺失：{missing_interactions}")
    forbidden_runtime_network = ["fetch(", "XMLHttpRequest", "new WebSocket", "<iframe"]
    found_forbidden = [item for item in forbidden_runtime_network if item in text]
    if found_forbidden:
        raise ValueError(f"{path.name}: 存在运行时网络依赖：{found_forbidden}")

    node_ids = {str(item["id"]) for item in embedded["nodes"]}
    dangling_edges = [
        item["id"]
        for item in embedded["edges"]
        if str(item["from"]) not in node_ids or str(item["to"]) not in node_ids
    ]
    if dangling_edges:
        raise ValueError(f"{path.name}: 存在悬空边：{dangling_edges}")

    filter_items = [item for group in embedded["filterSections"] for item in group["items"]]
    defaults = {item["id"]: item.get("default", True) for item in filter_items}

    def default_enabled(target: str, value: str) -> bool:
        matched = [item for item in filter_items if item["target"] == target and item["value"] == value]
        return not matched or any(defaults[item["id"]] for item in matched)

    default_nodes = [item for item in embedded["nodes"] if default_enabled("nodeCategory", item["category"])]
    default_node_ids = {str(item["id"]) for item in default_nodes}
    default_edges = [
        item
        for item in embedded["edges"]
        if str(item["from"]) in default_node_ids
        and str(item["to"]) in default_node_ids
        and default_enabled("edgeCategory", item["category"])
        and default_enabled("edgeStatus", item.get("status", ""))
    ]

    graph_type = embedded["meta"]["type"]
    if graph_type == "er":
        statuses = {item["status"] for item in embedded["edges"]}
        if len(default_nodes) != 13 or len(default_edges) != 17 or statuses != {"verified", "planned"}:
            raise ValueError(f"{path.name}: ER 默认视图或状态口径异常")
    elif graph_type == "ontology":
        category_counts = {
            category: sum(item["category"] == category for item in embedded["nodes"])
            for category in {item["category"] for item in embedded["nodes"]}
        }
        expected_categories = {
            "object": 6,
            "relation": 5,
            "event": 4,
            "state": 11,
            "evidence": 6,
            "counter": 3,
            "rule": 6,
            "scenario": 3,
            "implicit": 3,
        }
        if category_counts != expected_categories or len(default_nodes) != 35:
            raise ValueError(
                f"{path.name}: 本体层口径异常 categories={category_counts}, default={len(default_nodes)}"
            )
    elif graph_type == "reasoning":
        resources = embedded["resources"]
        if (
            len(default_nodes) != 7
            or len(default_edges) != 9
            or len(resources["reasoningInputs"]) != 50
            or len(resources["evidenceRecords"]) != 48
            or len(resources["coverageUnits"]) != 2
        ):
            raise ValueError(f"{path.name}: 推理图资源口径异常")
        mapped_inputs: set[str] = set()
        mapped_evidence: set[str] = set()
        for item in embedded["nodes"]:
            for dataset in item.get("details", {}).get("datasets", []):
                if dataset["resource"] == "reasoningInputs":
                    mapped_inputs.update(dataset["ids"])
                elif dataset["resource"] == "evidenceRecords":
                    mapped_evidence.update(dataset["ids"])
        if mapped_inputs != set(resources["reasoningInputs"]) or mapped_evidence != set(resources["evidenceRecords"]):
            raise ValueError(f"{path.name}: 点击详情未完整映射 50 条输入或 48 条证据")
        edge_categories = {item["category"] for item in embedded["edges"]}
        if edge_categories != {"support", "weaken", "condition", "block"}:
            raise ValueError(f"{path.name}: 路径边视觉语义不完整：{edge_categories}")
    return {"nodes": len(embedded["nodes"]), "edges": len(embedded["edges"])}


def build_all() -> dict[str, dict[str, Any]]:
    if not VIS_PATH.exists():
        raise FileNotFoundError(f"缺少本地图形库：{VIS_PATH}")
    data = load_inputs()
    graphs = {
        "er": build_er_graph(data),
        "ontology": build_ontology_graph(data),
        "reasoning": build_reasoning_graph(data),
    }
    for key, config in graphs.items():
        OUTPUTS[key].write_text(render_html(config), encoding="utf-8")
    return graphs


def validate_all(graphs: dict[str, dict[str, Any]]) -> None:
    expected = {
        "er": (13, 17),
        "ontology": (47, len(graphs["ontology"]["edges"])),
        "reasoning": (7, 9),
    }
    for key, path in OUTPUTS.items():
        result = validate_html(path, *expected[key])
        print(f"PASS {path.name}: {result['nodes']} nodes / {result['edges']} edges / local vis")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--validate-only", action="store_true", help="只校验已有 HTML，不重写文件")
    args = parser.parse_args()

    if args.validate_only:
        data = load_inputs()
        graphs = {
            "er": build_er_graph(data),
            "ontology": build_ontology_graph(data),
            "reasoning": build_reasoning_graph(data),
        }
    else:
        graphs = build_all()
    validate_all(graphs)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
