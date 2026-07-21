#!/usr/bin/env python3
"""03/04 运行实例图：业务对象权威源，CSV/审计列表仅为确定性投影。"""

from __future__ import annotations

import copy
import csv
import sys
from pathlib import Path
from typing import Any, Mapping

import yaml

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "runtime" / "adapters"))
sys.path.insert(0, str(ROOT / "governance" / "03_校验"))

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
    "method_applications": ("MethodApplication", "application_id"),
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
        "fallback_type": "Observation",
        "project_to_graph": False,
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
        model_root = ROOT / "ontology/01_通用/models"
        for filename in (
            "semantic.yaml",
            "state_event.yaml",
            "evidence.yaml",
            "judgment.yaml",
            "scenario.yaml",
            "semiconductor_extension.yaml",
        ):
            path = model_root / filename
            if not path.is_file():
                continue
            schema = yaml.safe_load(path.read_text(encoding="utf-8"))
            objects.update(schema.get("object_types", {}) or {})
            # scenario_types 是 catalog_only，不进入可写对象目录
            relations.update(schema.get("relation_types", {}) or {})
        from ontology_instance_graph import (  # local import avoids cycle at module load
            BUSINESS_PARAMETER_OBJECT_TYPES,
            BUSINESS_PARAMETER_RELATION_TYPES,
            TASK_VIEW_OBJECT_TYPES,
        )
        objects.update(BUSINESS_PARAMETER_OBJECT_TYPES)
        objects.update(TASK_VIEW_OBJECT_TYPES)
        relations.update(BUSINESS_PARAMETER_RELATION_TYPES)
        _FORMAL_OBJECT_TYPES = objects
        _FORMAL_RELATION_TYPES = relations
    return _FORMAL_OBJECT_TYPES, _FORMAL_RELATION_TYPES


def _stage03_graph_properties(
    logical_name: str,
    row: Mapping[str, Any],
    object_type: str,
) -> dict[str, Any]:
    """Project fixed CSV columns into required Ontology 3.0 object fields."""
    properties = dict(row)
    if object_type == "ManufacturingFacility":
        classification = str(row.get("classification", ""))
        properties.update({
            "facility_kind": "packaging" if "pack" in classification else "wafer_fab",
            "region_ref": str(row.get("scope") or "global"),
            "lifecycle_stage": "operating",
        })
    elif logical_name == "source_documents.csv":
        properties.update({
            "source_tier": "S2" if row.get("source_reliability") in {"high", "medium"} else "S3",
            "uri": str(row.get("location") or "https://example.invalid"),
        })
    elif logical_name == "evidence_claims.csv":
        created_at = str(row.get("created_at") or "1970-01-01T00:00:00Z")
        properties.update({"cutoff_at": created_at, "extracted_at": created_at})
    elif logical_name == "evidence_facts.csv":
        business_time = str(row.get("business_time") or row.get("created_at") or "1970-01-01T00:00:00Z")
        created_at = str(row.get("created_at") or business_time)
        properties.update({
            "subject_ref": str(row.get("about_instance_refs") or "unknown").split("|")[0],
            "time_basis": "observation_time",
            "scope_ref": "SCOPE-MEMORY-INDUSTRY",
            "observed_at": business_time,
            "valid_from": business_time,
            "published_at": created_at,
            "cutoff_at": created_at,
        })
    elif logical_name == "evidence_assessments.csv":
        usability = str(row.get("usability") or "usable_with_caveat")
        properties.update({
            "assessment": usability if usability in {
                "usable", "usable_with_caveat", "contested", "unusable",
            } else "usable_with_caveat",
            "directness": "direct" if float(row.get("directness_score") or 0) >= 3 else "indirect",
        })
    elif logical_name == "evidence_baskets.csv":
        basket_role = str(row.get("basket_role") or "")
        properties.update({
            "label": str(row.get("basket_type") or row.get("evidence_basket_id") or "evidence basket"),
            "role": (
                "counter" if "counter" in basket_role
                else "context" if "context" in basket_role
                else "support"
            ),
        })
    return properties


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

    claim_to_unit: dict[str, str] = {}
    claim_to_evidence = {
        str(item.get("claim_id")): list(item.get("source_evidence_refs") or item.get("evidence_refs") or [])
        for item in source.get("claim_register", []) or []
        if isinstance(item, dict) and item.get("claim_id")
    }
    for gate in source.get("judgment_unit_gate_results", []) or []:
        if not isinstance(gate, dict):
            continue
        unit_id = str(gate.get("judgment_unit_id", "")).strip()
        for claim_id in gate.get("effect_on_claims", []) or []:
            claim_to_unit[str(claim_id)] = unit_id

    objects: list[dict[str, Any]] = []
    relations: list[dict[str, Any]] = []
    for section, (object_type, id_field) in AUDIT_REASONING_LISTS.items():
        for index, raw in enumerate(_list(source.pop(section, []), section)):
            item = dict(_mapping(raw, f"{section}[{index}]"))
            instance_id = str(item.get(id_field, "")).strip()
            if not instance_id:
                raise InstanceGraphError(f"{section}[{index}].{id_field} 不得为空")
            if object_type == "RuleEvaluation":
                item["result"] = "pass" if item.get("status") in {"matched", "pass", "complete"} else "contested"
            elif object_type == "Judgment":
                level = str(item.get("level") or item.get("judgment_level") or "J0")
                application_id = f"MA-{instance_id}"
                item.update({
                    "level": level,
                    "scope_ref": str(item.get("scope_ref") or item.get("scope") or "unknown"),
                    "cutoff_at": str(item.get("cutoff_at") or item.get("time_horizon") or "1970-01-01T00:00:00Z"),
                    "decision_status": str(item.get("decision_status") or ("indeterminate" if level == "J0" else "supported")),
                    "conflict_status": str(item.get("conflict_status") or "none"),
                    "invalidation_conditions": list(item.get("invalidation_conditions") or []),
                    "conditions": (
                        item.get("conditions") if isinstance(item.get("conditions"), list)
                        else [item["conditions"]] if item.get("conditions") else []
                    ),
                    "judgment_unit_ref": str(
                        item.get("judgment_unit_ref")
                        or claim_to_unit.get(str(item.get("claim_id")), "unknown")
                    ),
                    "method_application_refs": [application_id],
                    "evidence_refs": claim_to_evidence.get(str(item.get("claim_id")), []),
                })
            elif object_type == "ReasoningTrace":
                item.update({
                    "created_at": str(item.get("created_at") or item.get("evaluated_at") or "1970-01-01T00:00:00Z"),
                    "node_refs": list(dict.fromkeys([
                        *(item.get("input_refs") or []),
                        *(item.get("rule_evaluation_refs") or []),
                        str(item.get("judgment_ref") or ""),
                        *(item.get("output_refs") or []),
                    ])),
                })
            objects.append(_instance(instance_id, object_type, item, section, index))

    judgments = {item["id"] for item in objects if item["type"] == "Judgment"}
    hypotheses = {item["id"] for item in objects if item["type"] == "Hypothesis"}
    rule_evaluations = {item["id"] for item in objects if item["type"] == "RuleEvaluation"}
    cutoff_at = str((source.get("metadata") or {}).get("judgment_as_of") or "1970-01-01T00:00:00Z")
    scope_ids: set[str] = set()
    for gate in source.get("judgment_unit_gate_results", []) or []:
        if not isinstance(gate, dict):
            continue
        unit_id = str(gate.get("judgment_unit_id", "")).strip()
        scope_ref = str(gate.get("scope_ref") or "unknown")
        if not unit_id:
            continue
        scope_ids.add(scope_ref)
        objects.append(_instance(unit_id, "JudgmentUnit", {
            "judgment_unit_id": unit_id,
            "statement": str(gate.get("statement") or unit_id),
            "judgment_type": str(gate.get("judgment_type") or "state_measurement"),
            "scope_ref": scope_ref,
        }, "upstream_judgment_units"))
        relations.append({
            "id": f"REL-{unit_id}-SCOPE",
            "type": "unitUsesScope",
            "sourceId": unit_id,
            "targetId": scope_ref,
            "properties": {},
        })
    for scope_ref in scope_ids:
        objects.append(_instance(scope_ref, "ResearchScope", {
            "label": scope_ref,
            "dimensions": {"source": "stage_02"},
        }, "upstream_scopes"))

    fact_ids = {
        str(ref)
        for item in objects
        if item["type"] == "Signal"
        for ref in item["properties"].get("evidence_refs", []) or []
        if str(ref)
    }
    default_scope = next(iter(scope_ids), "unknown")
    for fact_id in sorted(fact_ids):
        source_id = f"SD-UPSTREAM-{fact_id}"
        claim_id = f"CL-UPSTREAM-{fact_id}"
        objects.extend([
            _instance(source_id, "SourceDocument", {
                "title": f"04 上游冻结来源 {fact_id}",
                "uri": "https://example.invalid/formal-fixture",
                "published_at": cutoff_at,
                "source_tier": "S2",
            }, "upstream_sources"),
            _instance(claim_id, "EvidenceClaim", {
                "statement": f"04 上游冻结陈述 {fact_id}",
                "locator": fact_id,
                "extracted_at": cutoff_at,
                "cutoff_at": cutoff_at,
            }, "upstream_claims"),
            _instance(fact_id, "EvidenceFact", {
                "statement": f"04 上游冻结事实 {fact_id}",
                "subject_ref": "upstream",
                "time_basis": "observation_time",
                "scope_ref": default_scope,
                "observed_at": cutoff_at,
                "valid_from": cutoff_at,
                "published_at": cutoff_at,
                "cutoff_at": cutoff_at,
            }, "upstream_facts"),
        ])
        relations.extend([
            {"id": f"REL-{claim_id}-SOURCE", "type": "claimCitesSource", "sourceId": claim_id, "targetId": source_id, "properties": {}},
            {"id": f"REL-{fact_id}-CLAIM", "type": "factDerivedFromClaim", "sourceId": fact_id, "targetId": claim_id, "properties": {}},
        ])
    _, relation_types = _catalog()
    method_index = 0
    for item in objects:
        properties = item["properties"]
        if item["type"] == "Signal":
            hypothesis_refs = properties.get("target_hypothesis_refs") or []
            if hypothesis_refs:
                relations.extend([
                    {
                        "id": f"REL-{item['id']}-FACT",
                        "type": "signalGroundedByFact",
                        "sourceId": item["id"],
                        "targetId": str((properties.get("evidence_refs") or ["unknown"])[0]),
                        "properties": {"role": "support"},
                    },
                    {
                        "id": f"REL-{item['id']}-HYP",
                        "type": "signalEvaluatesHypothesis",
                        "sourceId": item["id"],
                        "targetId": str(hypothesis_refs[0]),
                        "properties": {},
                    },
                ])
        elif item["type"] == "Judgment":
            hypothesis_ref = str((properties.get("hypothesis_refs") or ["unknown"])[0])
            evaluation_ref = str((properties.get("rule_evaluation_refs") or ["unknown"])[0])
            unit_ref = str(properties.get("judgment_unit_ref") or "unknown")
            application_id = f"MA-{item['id']}"
            objects.append(_instance(application_id, "MethodApplication", {
                "application_id": application_id,
                "method_id": "kb04:A01",
                "method_version": "1.0.0",
                "capability_type": "adjudication",
                "target_question_refs": ["Q-01"],
                "target_judgment_unit_refs": [unit_ref],
                "target_ontology_object_refs": [],
                "status": "executed",
                "precondition_checks": [],
                "input_evidence_refs": [],
                "output_signal_refs": [],
                "output_judgment_refs": [str(properties.get("claim_id") or item["id"])],
                "execution_summary": "迁移正式回归夹具的裁决方法记录",
            }, "method_applications", method_index))
            method_index += 1
            relations.extend([
                {"id": f"REL-{item['id']}-HYP", "type": "judgmentBasedOnHypothesis", "sourceId": item["id"], "targetId": hypothesis_ref, "properties": {}},
                {"id": f"REL-{item['id']}-RULE", "type": "judgmentHasRuleEvaluation", "sourceId": item["id"], "targetId": evaluation_ref, "properties": {}},
                {"id": f"REL-{item['id']}-UNIT", "type": "judgmentResolvesUnit", "sourceId": item["id"], "targetId": unit_ref, "properties": {}},
                {"id": f"REL-{item['id']}-METHOD", "type": "runtimeJudgmentUsesMethodApplication", "sourceId": item["id"], "targetId": application_id, "properties": {}},
                {"id": f"REL-{application_id}-UNIT", "type": "runtimeMethodApplicationTargets", "sourceId": application_id, "targetId": unit_ref, "properties": {}},
            ])
        elif item["type"] == "ReasoningTrace":
            judgment_ref = str(properties.get("judgment_ref", "")).strip()
            node_ref = str((properties.get("rule_evaluation_refs") or [judgment_ref])[0])
            if judgment_ref in judgments and "reasoningTraceForJudgment" in relation_types:
                relations.extend([
                    {"id": f"REL-TRACE-{item['id']}", "type": "reasoningTraceForJudgment", "sourceId": item["id"], "targetId": judgment_ref, "properties": {}},
                    {"id": f"REL-TRACE-NODE-{item['id']}", "type": "traceIncludesNode", "sourceId": item["id"], "targetId": node_ref, "properties": {"sequence": 1}},
                ])

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
        # Operational planning/readiness tables remain deterministic projections,
        # but their retired 2.x record types must not re-enter the Ontology 3.0 graph.
        if spec.get("project_to_graph") is False:
            continue
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
            properties = _stage03_graph_properties(logical_name, row, object_type)
            item = _instance(instance_id, object_type, properties, logical_name, index)
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
