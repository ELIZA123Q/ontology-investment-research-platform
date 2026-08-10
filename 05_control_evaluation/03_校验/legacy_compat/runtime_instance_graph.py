#!/usr/bin/env python3
"""历史研究制品的实例图投影校验。

该模块属于 Governance legacy 兼容读取层，不参与 vNext Runtime 执行。它只负责让已冻结的
03/04 研究样例继续接受确定性校验，避免为保留历史回放而恢复旧 Runtime。
"""

from __future__ import annotations

import copy
import csv
import sys
from pathlib import Path
from typing import Any, Mapping


ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "05_control_evaluation/03_校验"))

from ontology_instance_graph import (  # noqa: E402
    InstanceGraphError,
    _mapping,
    canonical_json,
    validate_instance_graph,
)
from snapshot_layout_03 import snapshot_csv_path  # noqa: E402


AUDIT_REASONING_LISTS: dict[str, tuple[str, str]] = {
    "hypotheses": ("Hypothesis", "hypothesis_id"),
    "signals": ("Signal", "signal_id"),
    "rule_evaluations": ("RuleEvaluation", "rule_evaluation_id"),
    "judgments": ("Judgment", "judgment_id"),
    "reasoning_traces": ("ReasoningTrace", "trace_id"),
    "method_applications": ("MethodApplication", "application_id"),
}

STAGE03_OBJECT_CSV: dict[str, dict[str, Any]] = {
    "semantic_instances.csv": {"id_field": "instance_id", "type_field": "instance_type"},
    "source_documents.csv": {"id_field": "source_document_id", "fixed_type": "SourceDocument"},
    "source_profiles.csv": {"id_field": "source_profile_id", "fixed_type": "SourceProfile"},
    "evidence_claims.csv": {"id_field": "claim_id", "fixed_type": "EvidenceClaim"},
    "evidence_facts.csv": {"id_field": "fact_id", "fixed_type": "EvidenceFact"},
    "evidence_assessments.csv": {"id_field": "assessment_id", "fixed_type": "EvidenceAssessment"},
    "evidence_readiness_assessments.csv": {
        "id_field": "assessment_id",
        "fixed_type": "EvidenceReadinessAssessment",
        "project_to_graph": False,
    },
    "evidence_baskets.csv": {"id_field": "evidence_basket_id", "fixed_type": "EvidenceBasket"},
    "acquisition_channels.csv": {
        "id_field": "acquisition_channel_id",
        "fixed_type": "AcquisitionChannel",
        "project_to_graph": False,
    },
    "proxy_indicators.csv": {"id_field": "proxy_indicator_id", "fixed_type": "ProxyIndicator"},
    "reasoning_inputs.csv": {
        "id_field": "input_id",
        "type_field": "input_type",
        "project_to_graph": False,
    },
}

STAGE03_RELATION_CSV: dict[str, dict[str, str]] = {
    "semantic_relations.csv": {
        "id_field": "relation_id",
        "type_field": "relation_type",
        "source_field": "source_instance_id",
        "target_field": "target_instance_id",
    },
    "evidence_relations.csv": {
        "id_field": "relation_id",
        "type_field": "relation_type",
        "source_field": "source_evidence_id",
        "target_field": "target_evidence_id",
    },
}


def _read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    if not path.is_file():
        return [], []
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        fieldnames = list(reader.fieldnames or [])
        rows = [{key: (row.get(key) or "") for key in fieldnames} for row in reader]
    return fieldnames, rows


def project_reasoning_audit(document: Mapping[str, Any]) -> dict[str, Any]:
    """从冻结的 04 实例图恢复旧审计列表，只用于历史包校验。"""
    raw = copy.deepcopy(dict(document))
    graph = validate_instance_graph(raw.pop("business_instance_graph"), check_relation_endpoints=False)
    grouped: dict[str, list[tuple[int, dict[str, Any]]]] = {
        section: [] for section in AUDIT_REASONING_LISTS
    }
    for item in graph["objects"]:
        projection = item.get("projection") or {}
        section = str(projection.get("section", ""))
        if section in grouped:
            grouped[section].append(
                (int(projection.get("index", 0)), copy.deepcopy(item["properties"]))
            )
    for section in AUDIT_REASONING_LISTS:
        raw[section] = [properties for _, properties in sorted(grouped[section])]
    return raw


def assert_stage03_projections(manifest: Mapping[str, Any], snapshot_dir: Path) -> None:
    """确认冻结 CSV 与清单记录的投影指纹一致。"""
    graph = _mapping(manifest.get("business_instance_graph"), "business_instance_graph")
    fingerprints = _mapping(graph.get("projection_fingerprints"), "projection_fingerprints")
    logical_names = [*STAGE03_OBJECT_CSV, *STAGE03_RELATION_CSV]
    for logical_name in logical_names:
        path = snapshot_csv_path(snapshot_dir, logical_name)
        fieldnames, rows = _read_csv(path)
        actual = canonical_json({"fields": fieldnames, "rows": rows})
        expected = fingerprints.get(logical_name)
        if expected is None:
            raise InstanceGraphError(f"03 实例图缺少 {logical_name} 投影指纹")
        if actual != expected:
            raise InstanceGraphError(f"03 投影文件被手改或与实例图不一致: {logical_name}")

