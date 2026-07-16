#!/usr/bin/env python3
"""03/04 运行实例图：业务对象权威源，CSV/审计列表仅为确定性投影。"""

from __future__ import annotations

import copy
import csv
import sys
from pathlib import Path
from typing import Any, Mapping

import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "03_数据与证据"))
sys.path.insert(0, str(ROOT / "运行校验"))

from ontology_instance_graph import (  # noqa: E402
    GRAPH_SCHEMA_NAME,
    GRAPH_SCHEMA_VERSION,
    InstanceGraphError,
    _instance,
    _list,
    _mapping,
    canonical_json,
    validate_instance_graph,
)
from snapshot_layout_03 import snapshot_csv_path  # noqa: E402


# 04 审计中由正式推理本体承载的列表段。
AUDIT_REASONING_LISTS: dict[str, tuple[str, str]] = {
    "hypotheses": ("Hypothesis", "hypothesis_id"),
    "signals": ("Signal", "signal_id"),
    "rule_evaluations": ("RuleEvaluation", "rule_evaluation_id"),
    "judgments": ("Judgment", "judgment_id"),
    "reasoning_traces": ("ReasoningTrace", "trace_id"),
}

AUDIT_SCHEMA_VERSION = "4.0.0"
STAGE03_MANIFEST_SCHEMA_VERSION = "3.0.0"

# 03 快照中映射为正式本体实例的 CSV。
STAGE03_OBJECT_CSV: dict[str, dict[str, Any]] = {
    "semantic_instances.csv": {
        "id_field": "instance_id",
        "type_field": "instance_type",
        "fallback_type": "Organization",
    },
    "source_documents.csv": {"id_field": "source_document_id", "fixed_type": "SourceDocument"},
    "source_profiles.csv": {"id_field": "source_profile_id", "fixed_type": "SourceProfile"},
    "evidence_claims.csv": {"id_field": "claim_id", "fixed_type": "EvidenceClaim"},
    "evidence_facts.csv": {"id_field": "fact_id", "fixed_type": "EvidenceFact"},
    "evidence_assessments.csv": {"id_field": "assessment_id", "fixed_type": "EvidenceAssessment"},
    "evidence_readiness_assessments.csv": {
        "id_field": "assessment_id",
        "fixed_type": "EvidenceReadinessAssessment",
    },
    "evidence_baskets.csv": {"id_field": "evidence_basket_id", "fixed_type": "EvidenceBasket"},
    "acquisition_channels.csv": {"id_field": "acquisition_channel_id", "fixed_type": "AcquisitionChannel"},
    "proxy_indicators.csv": {"id_field": "proxy_indicator_id", "fixed_type": "ProxyIndicator"},
    "reasoning_inputs.csv": {
        "id_field": "input_id",
        "type_field": "input_type",
        "fallback_type": "Observation",
    },
}

STAGE03_RELATION_CSV: dict[str, dict[str, str]] = {
    "semantic_relations.csv": {
        "id_field": "relation_id",
        "type_field": "relation_type",
        "source_field": "source_instance_id",
        "target_field": "target_instance_id",
        "fallback_type": "dependsOn",
    },
    "evidence_relations.csv": {
        "id_field": "relation_id",
        "type_field": "relation_type",
        "source_field": "source_evidence_id",
        "target_field": "target_evidence_id",
        "fallback_type": "claimCitesSource",
    },
}

_FORMAL_OBJECT_TYPES: set[str] | None = None
_FORMAL_RELATION_TYPES: set[str] | None = None


def _catalog() -> tuple[set[str], set[str]]:
    global _FORMAL_OBJECT_TYPES, _FORMAL_RELATION_TYPES
    if _FORMAL_OBJECT_TYPES is None or _FORMAL_RELATION_TYPES is None:
        objects: set[str] = set()
        relations: set[str] = set()
        for root_name in ("一级通用本体规范", "二级半导体领域本体规范"):
            for filename in ("semantic.yaml", "evidence.yaml", "reasoning.yaml"):
                path = ROOT / root_name / filename
                if not path.is_file():
                    continue
                schema = yaml.safe_load(path.read_text(encoding="utf-8"))
                objects.update(schema.get("object_types", {}) or {})
                relations.update(schema.get("relation_types", {}) or {})
        _FORMAL_OBJECT_TYPES = objects
        _FORMAL_RELATION_TYPES = relations
    return _FORMAL_OBJECT_TYPES, _FORMAL_RELATION_TYPES


def _resolve_object_type(raw: str, fallback: str) -> str:
    objects, _ = _catalog()
    value = str(raw or "").strip()
    if value in objects:
        return value
    if fallback in objects:
        return fallback
    raise InstanceGraphError(f"无法解析对象类型: {raw}")


def _resolve_relation_type(raw: str, fallback: str) -> str:
    _, relations = _catalog()
    value = str(raw or "").strip()
    if value in relations:
        return value
    if fallback in relations:
        return fallback
    for candidate in ("dependsOn", "claimCitesSource", "evidenceGroundsReasoning"):
        if candidate in relations:
            return candidate
    raise InstanceGraphError(f"无法解析关系类型: {raw}")


def _read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    if not path.is_file():
        return [], []
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        fieldnames = list(reader.fieldnames or [])
        rows = [{key: (row.get(key) or "") for key in fieldnames} for row in reader]
    return fieldnames, rows


def compact_reasoning_audit(audit: Mapping[str, Any]) -> dict[str, Any]:
    """把 04 审计中的正式推理实例收成 business_instance_graph。"""
    source = copy.deepcopy(dict(audit))
    if "business_instance_graph" in source:
        validate_instance_graph(source["business_instance_graph"], check_relation_endpoints=False)
        duplicated = sorted(set(AUDIT_REASONING_LISTS) & set(source))
        if duplicated:
            raise InstanceGraphError(f"04 审计不得磁盘双写推理实例段: {duplicated}")
        source["schema_version"] = AUDIT_SCHEMA_VERSION
        return source

    objects: list[dict[str, Any]] = []
    relations: list[dict[str, Any]] = []
    for section, (object_type, id_field) in AUDIT_REASONING_LISTS.items():
        for index, raw in enumerate(_list(source.pop(section, []), section)):
            item = _mapping(raw, f"{section}[{index}]")
            instance_id = str(item.get(id_field, "")).strip()
            if not instance_id:
                raise InstanceGraphError(f"{section}[{index}].{id_field} 不得为空")
            objects.append(_instance(instance_id, object_type, item, section, index))

    judgments = {item["id"] for item in objects if item["type"] == "Judgment"}
    _, relation_types = _catalog()
    for item in objects:
        if item["type"] != "ReasoningTrace":
            continue
        judgment_ref = str(item["properties"].get("judgment_ref", "")).strip()
        if judgment_ref in judgments and "traceForJudgment" in relation_types:
            relations.append({
                "id": f"REL-TRACE-{item['id']}",
                "type": "traceForJudgment",
                "sourceId": item["id"],
                "targetId": judgment_ref,
                "properties": {},
            })

    result = {
        **source,
        "schema_version": AUDIT_SCHEMA_VERSION,
        "business_instance_graph": {
            "schema_name": GRAPH_SCHEMA_NAME,
            "schema_version": GRAPH_SCHEMA_VERSION,
            "authority": "business_parameters",
            "objects": objects,
            "relations": relations,
        },
    }
    validate_instance_graph(result["business_instance_graph"], check_relation_endpoints=False)
    return result


def project_reasoning_audit(document: Mapping[str, Any]) -> dict[str, Any]:
    """从 04 实例图恢复校验器消费的列表投影。"""
    raw = copy.deepcopy(dict(document))
    graph = validate_instance_graph(raw.pop("business_instance_graph"), check_relation_endpoints=False)
    grouped: dict[str, list[tuple[int, dict[str, Any]]]] = {section: [] for section in AUDIT_REASONING_LISTS}
    for item in graph["objects"]:
        section = str(item.get("projection", {}).get("section", ""))
        if section in grouped:
            grouped[section].append((int(item["projection"].get("index", 0)), copy.deepcopy(item["properties"])))
    for section in AUDIT_REASONING_LISTS:
        raw[section] = [props for _, props in sorted(grouped[section])]
    return raw


def compact_stage03_manifest(manifest: Mapping[str, Any], snapshot_dir: Path) -> dict[str, Any]:
    """把 03 正式本体运行实例收成清单内 business_instance_graph，并记录 CSV 投影指纹。"""
    source = copy.deepcopy(dict(manifest))
    objects: list[dict[str, Any]] = []
    relations: list[dict[str, Any]] = []
    projection_fingerprints: dict[str, str] = {}
    object_ids: set[str] = set()
    instance_types: dict[str, str] = {}

    for logical_name, spec in STAGE03_OBJECT_CSV.items():
        path = snapshot_csv_path(snapshot_dir, logical_name)
        fieldnames, rows = _read_csv(path)
        projection_fingerprints[logical_name] = canonical_json({"fields": fieldnames, "rows": rows})
        id_field = str(spec["id_field"])
        for index, row in enumerate(rows):
            instance_id = str(row.get(id_field, "")).strip()
            if not instance_id:
                continue
            if "fixed_type" in spec:
                object_type = str(spec["fixed_type"])
            else:
                object_type = _resolve_object_type(
                    row.get(str(spec["type_field"]), ""),
                    str(spec["fallback_type"]),
                )
            if instance_id in object_ids:
                instance_id = f"{logical_name}:{instance_id}"
            object_ids.add(instance_id)
            instance_types[instance_id] = object_type
            item = _instance(instance_id, object_type, row, logical_name, index)
            valid_from = row.get("valid_from") or row.get("validFrom")
            valid_to = row.get("valid_to") or row.get("validTo")
            if valid_from:
                item["validFrom"] = valid_from
            if valid_to:
                item["validTo"] = valid_to
            objects.append(item)

    for logical_name, spec in STAGE03_RELATION_CSV.items():
        path = snapshot_csv_path(snapshot_dir, logical_name)
        fieldnames, rows = _read_csv(path)
        projection_fingerprints[logical_name] = canonical_json({"fields": fieldnames, "rows": rows})
        for index, row in enumerate(rows):
            relation_id = str(row.get(spec["id_field"], "")).strip() or f"{logical_name}-{index + 1}"
            source_id = str(row.get(spec["source_field"], "")).strip()
            target_id = str(row.get(spec["target_field"], "")).strip()
            if not source_id or not target_id:
                continue
            if source_id not in object_ids or target_id not in object_ids:
                continue
            relation_type = _resolve_relation_type(row.get(spec["type_field"], ""), spec["fallback_type"])
            relations.append({
                "id": relation_id,
                "type": relation_type,
                "sourceId": source_id,
                "targetId": target_id,
                "properties": dict(row),
            })

    check_graph = {
        "schema_name": GRAPH_SCHEMA_NAME,
        "schema_version": GRAPH_SCHEMA_VERSION,
        "authority": "business_parameters",
        "objects": objects,
        "relations": relations,
    }
    validate_instance_graph(check_graph, check_relation_endpoints=False)
    source["business_instance_graph"] = {
        **check_graph,
        "projection_fingerprints": projection_fingerprints,
    }
    source["schema_version"] = STAGE03_MANIFEST_SCHEMA_VERSION
    return source


def assert_stage03_projections(manifest: Mapping[str, Any], snapshot_dir: Path) -> None:
    """手改权威 CSV 投影必须失败。"""
    graph = _mapping(manifest.get("business_instance_graph"), "business_instance_graph")
    fingerprints = _mapping(graph.get("projection_fingerprints"), "projection_fingerprints")
    for logical_name in list(STAGE03_OBJECT_CSV) + list(STAGE03_RELATION_CSV):
        path = snapshot_csv_path(snapshot_dir, logical_name)
        fieldnames, rows = _read_csv(path)
        actual = canonical_json({"fields": fieldnames, "rows": rows})
        expected = fingerprints.get(logical_name)
        if expected is None:
            raise InstanceGraphError(f"03 实例图缺少 {logical_name} 投影指纹")
        if actual != expected:
            raise InstanceGraphError(f"03 投影文件被手改或与实例图不一致: {logical_name}")


def write_yaml(path: Path, data: Mapping[str, Any]) -> None:
    path.write_text(
        yaml.safe_dump(dict(data), allow_unicode=True, sort_keys=False, width=140),
        encoding="utf-8",
    )
