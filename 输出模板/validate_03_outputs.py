#!/usr/bin/env python3
"""Validate 03 data/evidence preparation and frozen snapshot outputs."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from quality_gate_utils import (
    ALLOWED_04_OUTPUTS,
    CLAIM_MODES,
    DELIVERY_ARCHETYPES,
    EVIDENCE_ROLES,
    JUDGMENT_LABELS,
    JUDGMENT_LEVELS,
    JUDGMENT_STATUSES,
    PATH_STATUSES,
    MATERIAL_READINESS_STATUSES,
    QUALITY_LEVELS,
    REASONING_READINESS,
    REQUIREMENT_PURPOSES,
    SEARCH_STATUSES,
    SOURCE_TIERS,
    judgment_level_rank,
    output_rank,
    validate_admission,
    validate_allowed_04_output,
    validate_judgment_level,
    validate_admission_search_consistency,
    validate_core_ju_publish_baseline,
    validate_gate_review_fields,
    validate_quality_status,
    validate_return_action,
    validate_target_claim_level,
    validate_upstream_quality_gate,
)
from validate_05_materials import validate_05_materials
from validator_utils import (
    assert_subset,
    assert_values,
    error_payload,
    file_sha256,
    fail,
    file_name,
    load_yaml_file,
    ok_payload,
    parse_markdown,
    parse_triplet,
    read_csv,
    read_csv_header,
    ref_set,
    require_no_placeholders,
    require_body_sections,
    require_keys,
    require_schema_version,
    same_ref,
    split_refs,
)

from snapshot_layout_03 import SCHEMA_VERSION_03, SNAPSHOT_CSV_LAYOUT, snapshot_csv_path

REQUIRED_CSV_FILES: list[str] = list(SNAPSHOT_CSV_LAYOUT.keys())

TEMPLATE_DIR = Path(__file__).resolve().parent / "03_数据与证据快照模板"

REQUIRED_PREP_META = [
    "document_type",
    "schema_version",
    "task_id",
    "execution_id",
    "plan_id",
    "source_02_view_id",
    "source_02_logic_id",
    "source_02_view_ref",
    "source_02_logic_ref",
    "execution_date",
    "timezone",
    "data_cutoff",
    "resolved_anchor_date",
    "resolved_start",
    "resolved_end",
    "resolved_at",
    "resolved_objects",
    "target_05_archetype",
    "target_05_quality",
    "source_registry_version",
    "recipe_library_version",
    "snapshot_ref",
    "snapshot_summary_ref",
    "preparation_status",
    "quality_status",
    "quality_gate_ref",
    "deterministic_check_status",
    "semantic_review_status",
    "admission",
    "evidence_quality_level",
    "confidence_ceiling",
    "coverage_unit_total",
    "evidence_backed_unit_count",
    "evidence_coverage_rate",
    "required_coverage_rate",
    "critical_node_gate_status",
    "judgment_unit_gate_status",
    "search_status",
    "allowed_04_output",
    "allowed_05_output",
    "return_required",
    "return_stage",
]

REQUIRED_PREP_SECTIONS = [
    "本次范围",
    "研究基线",
    "数据与证据需求",
    "来源类型、最低证据组合与获取方式",
    "处理、归一与实例入库",
    "各结论的证据把握",
    "覆盖与路径就绪状态",
    "05 可展示数据支持",
    "准入结论",
    "快照文件索引",
    "03 质量门槛检查",
]

REQUIRED_SUMMARY_META = [
    "document_type",
    "schema_version",
    "task_id",
    "execution_id",
    "snapshot_version",
    "preparation_ref",
    "snapshot_directory",
    "admission",
    "evidence_quality_level",
    "confidence_ceiling",
    "coverage_unit_total",
    "evidence_backed_unit_count",
    "evidence_coverage_rate",
    "required_coverage_rate",
    "critical_node_gate_status",
    "judgment_unit_total",
    "highest_supported_judgment_level",
    "core_judgment_publish_floor_met",
    "search_status",
    "quality_status",
    "deterministic_check_status",
    "semantic_review_status",
]

DISPLAY_VISUAL_ROLES = {"quant_chart", "ranking_table", "event_timeline", "supporting_table", "qualitative_table"}
DISPLAY_READINESS = {"ready", "partial", "missing"}
DISPLAY_DATA_TYPES = {"quantitative", "qualitative", "mixed"}
RANKING_SUPPORT = {"none", "weak", "medium", "strong"}
REPORT_GRADE_STATUSES = {"report_grade_ready", "usable_with_caveat", "not_report_grade"}
TABLE_ROLES = {"ranking", "evidence_summary", "source_note", "decision_signal", "gap_plan", "scenario", "object_mapping"}
PRIORITIES = {"high", "medium", "low"}
GAP_TYPES = {
    "evidence",
    "coverage",
    "path",
    "source",
    "proxy",
    "conflict",
    "counter",
    "05_material",
    "display",
    "other",
}
ALLOWED_05_ARCHETYPES = DELIVERY_ARCHETYPES
TARGET_05_QUALITIES = {"minimum_pass", "high_quality_pass", "return_required", "stop_with_gap_report"}
ALLOWED_05_OUTPUTS = {"full_report", "limited_report", "gap_report_only"}
LOW_SOURCE_TIERS = {"S6", "S7", "S8"}
BASKET_STATUSES = {"met", "partial", "not_met", "missing", "contested", "blocked", "not_applicable"}
CHECK_STATUSES = {"met", "partial", "checked", "not_checked", "not_applicable", "missing", "blocked"}
CONFLICT_STATUSES = {
    "no_material_conflict",
    "minor_conflict",
    "material_conflict",
    "unresolved_conflict",
    "contested",
    "not_checked",
    "not_applicable",
}
PROXY_DEPENDENCY_STATUSES = {"none", "low", "moderate", "high", "proxy_only", "not_applicable"}
CONFIDENCE_LEVELS = {"high", "medium", "low"}
PREPARATION_STATUSES = {
    "planned",
    "in_progress",
    "complete",
    "failed",
    "returned",
}


def _float_value(value: object, label: str) -> float:
    try:
        return float(value)
    except Exception:
        fail(f"{label} 必须为数字")


def _int_value(value: object, label: str) -> int:
    try:
        return int(value)
    except Exception:
        fail(f"{label} 必须为整数")


def _rel(logical_name: str) -> str:
    return SNAPSHOT_CSV_LAYOUT[logical_name]


def _csv_path(base: Path, logical_name: str) -> Path:
    return snapshot_csv_path(base, logical_name)


def _expected_header(logical_name: str) -> list[str]:
    return read_csv_header(_csv_path(TEMPLATE_DIR, logical_name))


def _validate_upstream_02(prep_meta: dict[str, object], prep_path: Path) -> dict[str, object]:
    view_ref = str(prep_meta.get("source_02_view_ref", "")).strip()
    if not view_ref:
        fail("03 preparation 必须记录 source_02_view_ref")
    view_path = prep_path.parent / view_ref
    if not view_path.is_file():
        fail(f"03 preparation.source_02_view_ref 无法解析: {view_ref}")
    view = load_yaml_file(view_path)
    quality_control = view.get("quality_control")
    if not isinstance(quality_control, dict):
        fail(f"{view_path} 缺少 quality_control")
    validate_upstream_quality_gate(
        quality_control,
        upstream_label=str(view_path),
        downstream_label=str(prep_path),
        default_return_stage="02",
    )
    if str(view.get("schema_version")) != "2.0.0":
        fail(f"{view_path} schema_version 必须为 2.0.0")
    return view


def _validate_return_actions(rows: dict[str, list[dict[str, str]]]) -> None:
    readiness_rows = sorted(
        rows["judgment_unit_readiness.csv"],
        key=lambda item: 0 if item.get("maximum_judgment_level") == "J3" else 1,
    )
    for row in readiness_rows:
        action = row.get("return_action", "none")
        validate_return_action(action, f"judgment_unit_readiness#{row.get('judgment_unit_id')}")
    for row in rows["gaps_and_risks.csv"]:
        action = row.get("return_action", "none")
        validate_return_action(action, f"gaps_and_risks#{row.get('gap_id')}")


def _validate_headers(snapshot_dir: Path) -> None:
    missing = [name for name in REQUIRED_CSV_FILES if not _csv_path(snapshot_dir, name).exists()]
    if missing:
        fail("快照目录缺少 CSV: " + ", ".join(_rel(name) for name in missing))
    for name in REQUIRED_CSV_FILES:
        actual = read_csv_header(_csv_path(snapshot_dir, name))
        expected = _expected_header(name)
        if actual != expected:
            fail(f"{_rel(name)} 表头必须与模板一致")


def _rows(snapshot_dir: Path) -> dict[str, list[dict[str, str]]]:
    return {name: read_csv(_csv_path(snapshot_dir, name)) for name in REQUIRED_CSV_FILES}


def _judgment_unit_ids(assessments: list[dict[str, str]]) -> set[str]:
    return {row.get("target_judgment_unit_id", "").strip() for row in assessments if row.get("target_judgment_unit_id", "").strip()}


def _validate_normalized_evidence_graph(rows: dict[str, list[dict[str, str]]]) -> None:
    source_documents = ref_set(rows["source_documents.csv"], "source_document_id", "source_documents.csv")
    source_runs = ref_set(rows["source_snapshot.csv"], "source_run_id", "source_snapshot.csv")
    claims = ref_set(rows["evidence_claims.csv"], "claim_id", "evidence_claims.csv")
    facts = ref_set(rows["evidence_facts.csv"], "fact_id", "evidence_facts.csv")
    assessments = ref_set(rows["evidence_assessments.csv"], "assessment_id", "evidence_assessments.csv")
    judgment_units = ref_set(rows["judgment_unit_readiness.csv"], "judgment_unit_id", "judgment_unit_readiness.csv")
    for claim in rows["evidence_claims.csv"]:
        assert_subset(split_refs(claim.get("source_document_id")), source_documents, f"{claim.get('claim_id')}.source_document_id")
        assert_subset(split_refs(claim.get("source_run_refs")), source_runs, f"{claim.get('claim_id')}.source_run_refs")
    relation_rows = rows["evidence_relations.csv"]
    allowed_relations = {"claimCitesSource", "factSupportedByClaim", "assessmentEvaluatesEvidence", "conflictsWith", "supersedes", "invalidates"}
    assert_values([row.get("relation_type", "") for row in relation_rows], allowed_relations, "evidence_relations.relation_type")
    claim_source_links: set[str] = set()
    fact_claim_links: set[str] = set()
    assessment_links: dict[str, set[str]] = {item: set() for item in assessments}
    evidence_universe = claims | facts
    for relation in relation_rows:
        relation_type = relation.get("relation_type")
        source = str(relation.get("source_evidence_id", ""))
        target = str(relation.get("target_evidence_id", ""))
        if relation_type == "claimCitesSource":
            assert_subset([source], claims, f"{relation.get('relation_id')}.source")
            assert_subset([target], source_documents, f"{relation.get('relation_id')}.target")
            claim_source_links.add(source)
        elif relation_type == "factSupportedByClaim":
            assert_subset([source], facts, f"{relation.get('relation_id')}.source")
            assert_subset([target], claims, f"{relation.get('relation_id')}.target")
            fact_claim_links.add(source)
        elif relation_type == "assessmentEvaluatesEvidence":
            assert_subset([source], assessments, f"{relation.get('relation_id')}.source")
            assert_subset([target], evidence_universe | source_documents, f"{relation.get('relation_id')}.target")
            assessment_links[source].add(target)
        else:
            assert_subset([source, target], evidence_universe, f"{relation.get('relation_id')}.evidence_endpoints")
    if claims - claim_source_links:
        fail("所有 EvidenceClaim 都必须存在 claimCitesSource: " + ", ".join(sorted(claims - claim_source_links)))
    if facts - fact_claim_links:
        fail("所有 EvidenceFact 都必须存在 factSupportedByClaim: " + ", ".join(sorted(facts - fact_claim_links)))
    for assessment in rows["evidence_assessments.csv"]:
        aid = str(assessment.get("assessment_id", ""))
        targets = set(split_refs(assessment.get("evidence_refs")))
        assert_subset(targets, evidence_universe | source_documents, f"{aid}.evidence_refs")
        assert_subset(split_refs(assessment.get("linked_judgment_unit_ids")), judgment_units, f"{aid}.linked_judgment_unit_ids")
        if not targets or not targets.issubset(assessment_links.get(aid, set())):
            fail(f"{aid} 的 evidence_refs 必须逐项存在 assessmentEvaluatesEvidence")


def _validate_instance_manifest(
    prep_path: Path,
    snapshot_dir: Path,
    prep_triplet: tuple[str, str, str],
    prep_meta: dict[str, object],
    rows: dict[str, list[dict[str, str]]],
) -> None:
    topic, date, seq = prep_triplet
    path = prep_path.parent / f"03-{topic}语义域与证据域实例清单-{date}-{seq}.yaml"
    if not path.is_file():
        fail("03 缺少配对的语义域与证据域实例清单")
    manifest_triplet = parse_triplet(path, "语义域与证据域实例清单", stage="03")
    if manifest_triplet != prep_triplet:
        fail("03 语义域与证据域实例清单与准备文档的主题、日期或序号不一致")
    manifest = load_yaml_file(path)
    if manifest.get("document_type") != "cross_domain_runtime_instance_manifest":
        fail("03 语义域与证据域实例清单 document_type 必须为 cross_domain_runtime_instance_manifest")
    if manifest.get("document_type") == "cross_domain_runtime_instance_manifest":
        require_keys(
            manifest,
            [
                "document_type",
                "schema_version",
                "metadata",
                "ontology_versions",
                "manifest_role",
                "domain_instances",
                "operational_files",
                "cross_domain_constraints",
                "validation",
            ],
            str(path),
        )
        require_schema_version(manifest["schema_version"], str(path), expected="2.0.0")
        metadata = manifest["metadata"]
        require_keys(
            metadata,
            [
                "task_id",
                "execution_id",
                "source_02_view_ref",
                "source_02_view_version",
                "source_02_view_hash",
                "snapshot_ref",
                "frozen_at",
            ],
            "语义域与证据域实例清单.metadata",
        )
        for field in ["task_id", "execution_id"]:
            if not same_ref(metadata[field], prep_meta[field]):
                fail(f"语义域与证据域实例清单 metadata.{field} 与准备文档不一致")
        if not same_ref(metadata["source_02_view_ref"], prep_meta["source_02_view_ref"]):
            fail("语义域与证据域实例清单 source_02_view_ref 与准备文档不一致")
        snapshot_manifest = rows["manifest.csv"][0]
        if not same_ref(metadata["source_02_view_hash"], snapshot_manifest["source_02_view_hash"]):
            fail("语义域与证据域实例清单 source_02_view_hash 与快照 manifest 不一致")
        if not same_ref(metadata["snapshot_ref"], f"{snapshot_dir.name}/manifest.csv"):
            fail("语义域与证据域实例清单 snapshot_ref 必须指向配对快照")
        role = manifest["manifest_role"]
        if role.get("stage") != "03" or role.get("instance_only") is not True or role.get("formal_ontology_mutated") is not False:
            fail("语义域与证据域实例清单必须声明 stage=03、instance_only=true、formal_ontology_mutated=false")
        domains = manifest["domain_instances"]
        expected = {
            "semantic_domain": {
                "objects": _rel("semantic_instances.csv"),
                "relations": _rel("semantic_relations.csv"),
            },
            "evidence_domain": {
                "source_documents": _rel("source_documents.csv"),
                "claims": _rel("evidence_claims.csv"),
                "facts": _rel("evidence_facts.csv"),
                "relations": _rel("evidence_relations.csv"),
                "assessments": _rel("evidence_assessments.csv"),
            },
            "reasoning_domain": {"inputs": _rel("reasoning_inputs.csv")},
        }
        for domain_name, file_map in expected.items():
            domain = domains.get(domain_name)
            if not isinstance(domain, dict) or not isinstance(domain.get("files"), dict):
                fail(f"语义域与证据域实例清单缺少 {domain_name}.files")
            for key, relative_path in file_map.items():
                if not same_ref(domain["files"].get(key), f"{snapshot_dir.name}/{relative_path}"):
                    fail(f"语义域与证据域实例清单 {domain_name}.{key} 必须指向 {relative_path}")
        operations = manifest["operational_files"]
        if not same_ref(operations.get("source_retrievals"), f"{snapshot_dir.name}/{_rel('source_snapshot.csv')}"):
            fail("语义域与证据域实例清单 source_retrievals 必须指向 02_assets/source_snapshot.csv")
        if not same_ref(operations.get("evidence_records"), f"{snapshot_dir.name}/{_rel('evidence_records.csv')}"):
            fail("语义域与证据域实例清单 evidence_records 必须指向 02_assets/evidence_records.csv")
        for key in [
            "source_claim_fact_chain_complete",
            "assessment_targets_resolvable",
            "semantic_instances_runtime_only",
            "reasoning_inputs_frozen",
            "no_rule_evaluation_instances",
            "no_judgment_instances",
        ]:
            if manifest["cross_domain_constraints"].get(key) is not True:
                fail(f"语义域与证据域实例清单.cross_domain_constraints.{key} 必须为 true")
        if manifest["validation"].get("result") != "pass":
            fail("语义域与证据域实例清单.validation.result 必须为 pass")
        return


def _validate_ontology_instances(view: dict[str, object], rows: dict[str, list[dict[str, str]]]) -> None:
    semantic_scope = view["semantic_scope"]
    evidence_contract = view["evidence_contract"]
    allowed_object_types = set(split_refs(semantic_scope.get("object_type_refs")))
    allowed_relation_types = set(split_refs(semantic_scope.get("relation_type_refs")))
    allowed_profiles = set(split_refs(evidence_contract.get("evidence_profile_refs")))
    formal_evidence = load_yaml_file(Path(__file__).resolve().parent.parent / "一级通用本体规范" / "evidence.yaml")

    def enum_values(object_type: str, property_name: str) -> set[str]:
        values = formal_evidence["object_types"][object_type]["properties"][property_name].get("allowed_values", [])
        return {str(item) for item in values}

    assert_values([row.get("source_type", "") for row in rows["source_documents.csv"]], enum_values("SourceDocument", "sourceType"), "source_documents.source_type")
    assert_values([row.get("access_scope", "") for row in rows["source_documents.csv"]], enum_values("SourceDocument", "accessScope"), "source_documents.access_scope")
    assert_values([row.get("source_reliability", "") for row in rows["source_documents.csv"]], enum_values("SourceDocument", "sourceReliability"), "source_documents.source_reliability")
    assert_values([row.get("status", "") for row in rows["source_documents.csv"]], enum_values("SourceDocument", "status"), "source_documents.status")
    assert_values([row.get("claim_type", "") for row in rows["evidence_claims.csv"]], enum_values("EvidenceClaim", "claimType"), "evidence_claims.claim_type")
    assert_values([row.get("claim_confidence", "") for row in rows["evidence_claims.csv"]], enum_values("EvidenceClaim", "claimConfidence"), "evidence_claims.claim_confidence")
    assert_values([row.get("status", "") for row in rows["evidence_claims.csv"]], enum_values("EvidenceClaim", "status"), "evidence_claims.status")
    assert_values([row.get("fact_type", "") for row in rows["evidence_facts.csv"]], enum_values("EvidenceFact", "factType"), "evidence_facts.fact_type")
    assert_values([row.get("fact_confidence", "") for row in rows["evidence_facts.csv"]], enum_values("EvidenceFact", "factConfidence"), "evidence_facts.fact_confidence")
    assert_values([row.get("status", "") for row in rows["evidence_facts.csv"]], enum_values("EvidenceFact", "status"), "evidence_facts.status")
    assert_values([row.get("usability", "") for row in rows["evidence_assessments.csv"]], enum_values("EvidenceAssessment", "usability"), "evidence_assessments.usability")
    assert_values([row.get("quality_level", "") for row in rows["evidence_assessments.csv"]], enum_values("EvidenceAssessment", "qualityLevel"), "evidence_assessments.quality_level")
    score_fields = [
        "source_authority_score",
        "directness_score",
        "freshness_score",
        "scope_match_score",
        "independent_validation_score",
    ]
    for row in rows["evidence_assessments.csv"]:
        assessment_id = row.get("assessment_id", "")
        scores: list[int] = []
        for field in score_fields:
            try:
                score = int(row.get(field, ""))
            except (TypeError, ValueError):
                fail(f"{assessment_id}.{field} 必须为 1—5 的整数")
            if score < 1 or score > 5:
                fail(f"{assessment_id}.{field} 必须为 1—5")
            scores.append(score)
        total = sum(scores)
        try:
            recorded_total = int(row.get("reliability_score_total", ""))
        except (TypeError, ValueError):
            fail(f"{assessment_id}.reliability_score_total 必须为整数")
        if recorded_total != total:
            fail(f"{assessment_id}.reliability_score_total 必须等于五维分数之和 {total}")
        expected_band = "high" if total >= 22 else "medium" if total >= 17 else "low"
        band_rank = {"low": 0, "medium": 1, "high": 2}
        actual_band = row.get("reliability_band", "")
        if actual_band not in band_rank:
            fail(f"{assessment_id}.reliability_band 非法")
        if band_rank[actual_band] > band_rank[expected_band]:
            fail(f"{assessment_id}.reliability_band 不得高于五维分数上限 {expected_band}")
        for field in ["weakest_dimension", "reliability_basis"]:
            if not str(row.get(field, "")).strip():
                fail(f"{assessment_id}.{field} 不得为空")
        weakest = row.get("weakest_dimension", "")
        weakest_aliases = {
            "source_authority",
            "directness",
            "freshness",
            "scope_match",
            "independent_validation",
        }
        if weakest not in weakest_aliases:
            fail(f"{assessment_id}.weakest_dimension 必须指向五维之一")
        if band_rank[actual_band] < band_rank[expected_band] and not str(row.get("hard_limit", "")).strip():
            fail(f"{assessment_id} 可靠度低于分数建议档时必须填写 hard_limit")
    semantic_ids = ref_set(rows["semantic_instances.csv"], "instance_id", "semantic_instances.csv")
    instance_types: dict[str, str] = {}
    for row in rows["semantic_instances.csv"]:
        instance_id = row["instance_id"]
        instance_type = row["instance_type"]
        if instance_type not in allowed_object_types:
            fail(f"{instance_id}.instance_type 未由 02 semantic_scope 冻结: {instance_type}")
        if instance_type in {"Observation", "Event", "Hypothesis", "Signal", "RuleEvaluation", "Judgment", "ReasoningTrace"}:
            fail(f"03 semantic_instances 不得保存推理对象: {instance_type}")
        instance_types[instance_id] = instance_type
    for row in rows["semantic_relations.csv"]:
        relation_id = row["relation_id"]
        if row["relation_type"] not in allowed_relation_types:
            fail(f"{relation_id}.relation_type 未由 02 semantic_scope 冻结: {row['relation_type']}")
        assert_subset([row["source_instance_id"], row["target_instance_id"]], semantic_ids, f"{relation_id}.endpoints")
    for row in rows["reasoning_inputs.csv"]:
        target = row.get("target_instance_id", "")
        assert_subset([target], semantic_ids, f"{row.get('input_id')}.target_instance_id")
        if row.get("anchor_instance_type") != instance_types[target]:
            fail(f"{row.get('input_id')}.anchor_instance_type 与语义实例类型不一致")

    source_documents = ref_set(rows["source_documents.csv"], "source_document_id", "source_documents.csv")
    source_runs = ref_set(rows["source_snapshot.csv"], "source_run_id", "source_snapshot.csv")
    claims = ref_set(rows["evidence_claims.csv"], "claim_id", "evidence_claims.csv")
    facts = ref_set(rows["evidence_facts.csv"], "fact_id", "evidence_facts.csv")
    assessments = ref_set(rows["evidence_assessments.csv"], "assessment_id", "evidence_assessments.csv")
    judgment_units = ref_set(rows["judgment_unit_readiness.csv"], "judgment_unit_id", "judgment_unit_readiness.csv")
    for claim in rows["evidence_claims.csv"]:
        assert_subset(split_refs(claim.get("source_document_id")), source_documents, f"{claim.get('claim_id')}.source_document_id")
        assert_subset(split_refs(claim.get("source_run_refs")), source_runs, f"{claim.get('claim_id')}.source_run_refs")
        assert_subset(split_refs(claim.get("about_instance_refs")), semantic_ids, f"{claim.get('claim_id')}.about_instance_refs")
    for fact in rows["evidence_facts.csv"]:
        assert_subset(split_refs(fact.get("about_instance_refs")), semantic_ids, f"{fact.get('fact_id')}.about_instance_refs")
    allowed_evidence_relations = set(split_refs(evidence_contract.get("required_relation_types"))) | set(split_refs(evidence_contract.get("conflict_relation_types")))
    claim_source_links: set[str] = set()
    fact_claim_links: set[str] = set()
    assessment_links: dict[str, set[str]] = {item: set() for item in assessments}
    evidence_universe = claims | facts
    for relation in rows["evidence_relations.csv"]:
        relation_type = relation["relation_type"]
        source = relation["source_evidence_id"]
        target = relation["target_evidence_id"]
        if relation_type not in allowed_evidence_relations:
            fail(f"{relation.get('relation_id')}.relation_type 未由 02 evidence_contract 冻结")
        if relation_type == "claimCitesSource":
            assert_subset([source], claims, f"{relation.get('relation_id')}.source")
            assert_subset([target], source_documents, f"{relation.get('relation_id')}.target")
            claim_source_links.add(source)
        elif relation_type == "factSupportedByClaim":
            assert_subset([source], facts, f"{relation.get('relation_id')}.source")
            assert_subset([target], claims, f"{relation.get('relation_id')}.target")
            fact_claim_links.add(source)
        elif relation_type == "assessmentEvaluatesEvidence":
            assert_subset([source], assessments, f"{relation.get('relation_id')}.source")
            assert_subset([target], evidence_universe | source_documents, f"{relation.get('relation_id')}.target")
            if relation.get("relation_role") not in {"support", "counter", "conflict", "context"}:
                fail(f"{relation.get('relation_id')}.relation_role 不符合 assessmentEvaluatesEvidence")
            assessment_links[source].add(target)
        else:
            assert_subset([source, target], evidence_universe, f"{relation.get('relation_id')}.endpoints")
    if claims - claim_source_links:
        fail("所有 EvidenceClaim 都必须存在 claimCitesSource")
    if facts - fact_claim_links:
        fail("所有 EvidenceFact 都必须存在 factSupportedByClaim")
    for assessment in rows["evidence_assessments.csv"]:
        aid = assessment["assessment_id"]
        if assessment["profile_ref"] not in allowed_profiles:
            fail(f"{aid}.profile_ref 未由 02 evidence_contract 冻结")
        targets = set(split_refs(assessment.get("evidence_refs")))
        assert_subset(targets, evidence_universe | source_documents, f"{aid}.evidence_refs")
        assert_subset(split_refs(assessment.get("linked_judgment_unit_ids")), judgment_units, f"{aid}.linked_judgment_unit_ids")
        if not targets or not targets.issubset(assessment_links.get(aid, set())):
            fail(f"{aid}.evidence_refs 必须逐项存在 assessmentEvaluatesEvidence")


def _validate_snapshot_refs(snapshot_dir: Path, rows: dict[str, list[dict[str, str]]]) -> None:
    source_runs = ref_set(rows["source_snapshot.csv"], "source_run_id", "source_snapshot.csv")
    source_ids = ref_set(rows["source_snapshot.csv"], "source_id", "source_snapshot.csv")
    source_tier_by_id = {
        row.get("source_id", "").strip(): row.get("source_tier", "").strip()
        for row in rows["source_snapshot.csv"]
        if row.get("source_id")
    }
    inputs = ref_set(rows["reasoning_inputs.csv"], "input_id", "reasoning_inputs.csv")
    evidence = ref_set(rows["evidence_records.csv"], "evidence_id", "evidence_records.csv")
    coverage = ref_set(rows["state_variable_coverage.csv"], "coverage_id", "state_variable_coverage.csv")
    gaps = ref_set(rows["gaps_and_risks.csv"], "gap_id", "gaps_and_risks.csv", allow_empty=True)
    assessments = rows["evidence_readiness_assessments.csv"]
    judgment_units = _judgment_unit_ids(assessments)
    if not judgment_units:
        fail("evidence_readiness_assessments.csv 至少需要一行有效 target_judgment_unit_id")
    data_candidates = ref_set(rows["display_data_candidates.csv"], "data_candidate_id", "display_data_candidates.csv", allow_empty=True)
    requirements = ref_set(rows["evidence_requirements.csv"], "evidence_requirement_id", "evidence_requirements.csv", allow_empty=True)
    recipes = ref_set(rows["evidence_recipe_matches.csv"], "evidence_recipe_id", "evidence_recipe_matches.csv", allow_empty=True)
    baskets = ref_set(rows["evidence_baskets.csv"], "evidence_basket_id", "evidence_baskets.csv", allow_empty=True)
    source_profiles = ref_set(rows["source_profiles.csv"], "source_profile_id", "source_profiles.csv", allow_empty=True)
    channels = ref_set(rows["acquisition_channels.csv"], "acquisition_channel_id", "acquisition_channels.csv", allow_empty=True)
    proxies = ref_set(rows["proxy_indicators.csv"], "proxy_indicator_id", "proxy_indicators.csv", allow_empty=True)
    assessment_ids = ref_set(assessments, "assessment_id", "evidence_readiness_assessments.csv")

    for row in rows["evidence_requirements.csv"]:
        label = f"evidence_requirements#{row.get('evidence_requirement_id')}"
        assert_subset(split_refs(row.get("target_judgment_unit_id")), judgment_units, label + ".target_judgment_unit_id")
        if row.get("requirement_purpose") not in REQUIREMENT_PURPOSES:
            fail(label + ".requirement_purpose 非法")
        if row.get("evidence_role") not in EVIDENCE_ROLES:
            fail(label + ".evidence_role 非法")
        if row.get("minimum_quality_level") not in QUALITY_LEVELS:
            fail(label + ".minimum_quality_level 非法")
        if row.get("minimum_source_tier") not in SOURCE_TIERS:
            fail(label + ".minimum_source_tier 非法")
        min_sources = row.get("minimum_independent_source_count", "").strip()
        if min_sources and (not min_sources.isdigit() or int(min_sources) < 0):
            fail(label + ".minimum_independent_source_count 必须为空或非负整数")
        if row.get("allowed_proxy") not in {"true", "false", "yes", "no", "0", "1"}:
            fail(label + ".allowed_proxy 必须为布尔值文本")
        assert_subset(split_refs(row.get("mandatory_basket_ids")), baskets, label + ".mandatory_basket_ids")
        assert_subset(split_refs(row.get("counter_basket_ids")), baskets, label + ".counter_basket_ids")
        assert_subset(split_refs(row.get("preferred_source_profile_ids")), source_profiles, label + ".preferred_source_profile_ids")
        assert_subset(split_refs(row.get("allowed_acquisition_channel_ids")), channels, label + ".allowed_acquisition_channel_ids")
        validate_allowed_04_output(row.get("allowed_04_output_if_met"), label + ".allowed_04_output_if_met")
        validate_allowed_04_output(row.get("allowed_04_output_if_missing"), label + ".allowed_04_output_if_missing")
        if not row.get("stop_condition") or not row.get("missing_policy"):
            fail(label + ".stop_condition/missing_policy 不得为空")

    for row in rows["evidence_recipe_matches.csv"]:
        label = f"evidence_recipe_matches#{row.get('recipe_match_id')}"
        assert_subset(split_refs(row.get("target_judgment_unit_id")), judgment_units, label + ".target_judgment_unit_id")
        if not row.get("strategy_library_ref") or not row.get("minimum_pass_rule") or not row.get("downgrade_rule"):
            fail(label + ".strategy_library_ref/minimum_pass_rule/downgrade_rule 不得为空")
        if row.get("match_status") not in {"matched", "partial", "not_found", "not_applicable"}:
            fail(label + ".match_status 非法")

    for row in rows["evidence_baskets.csv"]:
        label = f"evidence_baskets#{row.get('evidence_basket_id')}"
        assert_subset(split_refs(row.get("target_judgment_unit_id")), judgment_units, label + ".target_judgment_unit_id")
        assert_subset(split_refs(row.get("target_requirement_ids")), requirements, label + ".target_requirement_ids")
        assert_subset(split_refs(row.get("required_source_profile_ids")), source_profiles, label + ".required_source_profile_ids")
        assert_subset(split_refs(row.get("actual_evidence_ids")), evidence, label + ".actual_evidence_ids")
        assert_subset(split_refs(row.get("actual_fact_ids")), evidence, label + ".actual_fact_ids")
        assert_subset(split_refs(row.get("actual_source_ids")), source_ids, label + ".actual_source_ids")
        if row.get("basket_role") not in EVIDENCE_ROLES:
            fail(label + ".basket_role 非法")
        if row.get("basket_status") not in BASKET_STATUSES:
            fail(label + ".basket_status 非法")
        if row.get("counter_check_status") not in CHECK_STATUSES:
            fail(label + ".counter_check_status 非法")
        if row.get("conflict_status") not in CONFLICT_STATUSES:
            fail(label + ".conflict_status 非法")
        if row.get("quality_level") not in QUALITY_LEVELS:
            fail(label + ".quality_level 非法")
        validate_allowed_04_output(row.get("allowed_04_output"), label + ".allowed_04_output")
        if row.get("basket_status") in {"partial", "not_met", "missing"} and output_rank(row.get("allowed_04_output", "")) > output_rank("conditional_only"):
            fail(label + ".allowed_04_output 在篮子未满足时不得高于 conditional_only")
        if row.get("basket_role") == "counter_evidence" and row.get("counter_check_status") in {"not_checked", "missing"}:
            fail(label + " 反证篮子必须记录 counter_check_status")

    for row in rows["source_profiles.csv"]:
        label = f"source_profiles#{row.get('source_profile_id')}"
        if row.get("source_tier") not in SOURCE_TIERS:
            fail(label + ".source_tier 非法")
        if not row.get("source_name") or not row.get("authority_type"):
            fail(label + ".source_name/authority_type 不得为空")
        if not row.get("allowed_claim_types") or not row.get("forbidden_use") or not row.get("common_limitations"):
            fail(label + ".allowed_claim_types/forbidden_use/common_limitations 不得为空")

    for row in rows["acquisition_channels.csv"]:
        label = f"acquisition_channels#{row.get('acquisition_channel_id')}"
        assert_subset(split_refs(row.get("supported_source_profile_ids")), source_profiles, label + ".supported_source_profile_ids")
        if not row.get("traceability_level") or not row.get("permission_requirement"):
            fail(label + ".traceability_level/permission_requirement 不得为空")

    for row in rows["proxy_indicators.csv"]:
        label = f"proxy_indicators#{row.get('proxy_indicator_id')}"
        assert_subset(split_refs(row.get("target_requirement_id")), requirements, label + ".target_requirement_id")
        assert_subset(split_refs(row.get("required_source_profile_ids")), source_profiles, label + ".required_source_profile_ids")
        if not row.get("proxy_logic") or not row.get("confidence_discount") or not row.get("required_disclosure"):
            fail(label + ".proxy_logic/confidence_discount/required_disclosure 不得为空")
        if not row.get("cannot_replace"):
            fail(label + ".cannot_replace 必须说明代理不能替代的直接证据")

    for row in rows["source_snapshot.csv"]:
        label = f"source_snapshot#{row.get('source_run_id')}"
        if not row.get("source_profile_id") or not row.get("acquisition_channel_id"):
            fail(label + ".source_profile_id/acquisition_channel_id 不得为空")
        assert_subset(split_refs(row.get("source_profile_id")), source_profiles, label + ".source_profile_id")
        assert_subset(split_refs(row.get("acquisition_channel_id")), channels, label + ".acquisition_channel_id")
        if row.get("source_tier") and row.get("source_tier") not in SOURCE_TIERS:
            fail(label + ".source_tier 非法")
        if not row.get("usage_restriction"):
            fail(label + ".usage_restriction 不得为空")
        retrieval_status = row.get("retrieval_status", "").strip()
        if retrieval_status in {"success", "partial", "retrieved"}:
            artifact_ref = row.get("raw_artifact_ref", "").strip()
            content_hash = row.get("content_hash", "").strip()
            if not artifact_ref or artifact_ref.startswith(("http://", "https://")):
                fail(label + ".raw_artifact_ref 必须指向快照目录内的原始材料或结构化取证包")
            artifact_path = (snapshot_dir / artifact_ref).resolve()
            try:
                artifact_path.relative_to(snapshot_dir.resolve())
            except ValueError:
                fail(label + ".raw_artifact_ref 不得指向快照目录外部")
            if not artifact_path.is_file():
                fail(label + ".raw_artifact_ref 指向的冻结材料不存在")
            if not content_hash.startswith("sha256:") or len(content_hash) != 71:
                fail(label + ".content_hash 必须为冻结证据包的 SHA-256")
            if content_hash != file_sha256(artifact_path):
                fail(label + ".content_hash 与冻结材料不一致")
            if artifact_path.suffix.lower() == ".json":
                try:
                    capture = json.loads(artifact_path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError) as exc:
                    fail(f"{label}.raw_artifact_ref JSON 无法解析: {exc}")
                if capture.get("capture_kind") == "structured_evidence_packet":
                    if capture.get("raw_content_included") is not False:
                        fail(label + ".structured_evidence_packet 必须明确 raw_content_included=false")
                    if capture.get("source_locator") != row.get("source_locator"):
                        fail(label + ".structured_evidence_packet.source_locator 与 source_snapshot 不一致")
                    claims = capture.get("evidence_claims")
                    records = capture.get("evidence_records")
                    captured_snapshot = capture.get("source_snapshot")
                    if not isinstance(captured_snapshot, dict) or captured_snapshot.get("source_run_id") != row.get("source_run_id"):
                        fail(label + ".structured_evidence_packet.source_snapshot 必须与 source_run_id 一致")
                    if not isinstance(claims, list) or not isinstance(records, list):
                        fail(label + ".structured_evidence_packet 的 evidence_claims/evidence_records 必须为数组")
                    if any(not str(item.get("locator", "")).strip() for item in claims if isinstance(item, dict)):
                        fail(label + ".structured_evidence_packet 中每条 evidence_claim 必须有 locator")

    for row in rows["evidence_records.csv"]:
        assert_subset(split_refs(row.get("source_run_id")), source_runs, f"{row.get('evidence_id')}.source_run_id")
        assert_subset(split_refs(row.get("source_id")), source_ids, f"{row.get('evidence_id')}.source_id")
        assert_subset(split_refs(row.get("requirement_id")), requirements, f"{row.get('evidence_id')}.requirement_id")
        assert_subset(split_refs(row.get("evidence_requirement_ids")), requirements, f"{row.get('evidence_id')}.evidence_requirement_ids")
        assert_subset(split_refs(row.get("evidence_basket_ids")), baskets, f"{row.get('evidence_id')}.evidence_basket_ids")
        assert_subset(split_refs(row.get("grounds_input_ids")), inputs, f"{row.get('evidence_id')}.grounds_input_ids")
        assert_subset(split_refs(row.get("linked_judgment_unit_ids")), judgment_units, f"{row.get('evidence_id')}.linked_judgment_unit_ids")
        if row.get("evidence_role") and row.get("evidence_role") not in EVIDENCE_ROLES:
            fail(f"{row.get('evidence_id')}.evidence_role 非法")
        assert_subset(split_refs(row.get("proxy_indicator_id")), proxies, f"{row.get('evidence_id')}.proxy_indicator_id")
        if row.get("proxy_indicator_id") and (not row.get("usage_limit") or not row.get("confidence_ceiling")):
            fail(f"{row.get('evidence_id')} 使用代理指标时必须记录 usage_limit 和 confidence_ceiling")
        if row.get("confidence_ceiling") and row.get("confidence_ceiling") not in CONFIDENCE_LEVELS:
            fail(f"{row.get('evidence_id')}.confidence_ceiling 非法")
        for source_id in split_refs(row.get("source_id")):
            tier = source_tier_by_id.get(source_id, "")
            if tier in LOW_SOURCE_TIERS and row.get("confidence_ceiling") == "high":
                fail(f"{row.get('evidence_id')} 使用低层级线索来源时 confidence_ceiling 不得为 high")
            if (
                tier in LOW_SOURCE_TIERS
                and row.get("evidence_role") in {"primary_support", "blocking_condition"}
                and row.get("statement_nature") in {"reported_fact", "data", "data_point", "financial_data"}
                and not row.get("usage_limit")
            ):
                fail(f"{row.get('evidence_id')} 使用低层级线索来源作为硬事实时必须记录 usage_limit 并降级使用")

    for row in assessments:
        label = f"evidence_readiness_assessments#{row.get('assessment_id')}"
        unit_id = row.get("target_judgment_unit_id", "").strip()
        if not unit_id:
            fail(label + ".target_judgment_unit_id 不得为空")
        assert_subset(split_refs(row.get("target_recipe_id")), recipes, label + ".target_recipe_id")
        assert_subset(split_refs(row.get("assessed_requirement_ids")), requirements, label + ".assessed_requirement_ids")
        assert_subset(split_refs(row.get("assessed_basket_ids")), baskets, label + ".assessed_basket_ids")
        assert_subset(split_refs(row.get("linked_input_ids")), inputs, label + ".linked_input_ids")
        assert_subset(split_refs(row.get("linked_evidence_ids")), evidence, label + ".linked_evidence_ids")
        assert_subset(split_refs(row.get("linked_gap_ids")), gaps, label + ".linked_gap_ids")
        assert_subset(split_refs(row.get("linked_coverage_ids")), coverage, label + ".linked_coverage_ids")
        for field in ["support_status", "cross_validation_status", "counter_status", "freshness_status", "traceability_status"]:
            if row.get(field) not in CHECK_STATUSES:
                fail(label + f".{field} 非法")
        if row.get("conflict_status") not in CONFLICT_STATUSES:
            fail(label + ".conflict_status 非法")
        if row.get("proxy_dependency_status") not in PROXY_DEPENDENCY_STATUSES:
            fail(label + ".proxy_dependency_status 非法")
        validate_allowed_04_output(row.get("overall_readiness_status"), label + ".overall_readiness_status")
        validate_allowed_04_output(row.get("allowed_04_output"), label + ".allowed_04_output")
        if row.get("confidence_ceiling") and row.get("confidence_ceiling") not in CONFIDENCE_LEVELS:
            fail(label + ".confidence_ceiling 非法")
        if row.get("support_status") in {"missing", "not_checked"} and output_rank(row.get("allowed_04_output", "")) > output_rank("insufficient"):
            fail(label + ".allowed_04_output 在支持证据缺失时不得高于 insufficient")
        if row.get("counter_status") in {"missing", "not_checked"} and output_rank(row.get("allowed_04_output", "")) >= output_rank("directional_only"):
            fail(label + ".allowed_04_output 在反证未查时不得达到方向性输出")
        if row.get("conflict_status") in {"material_conflict", "unresolved_conflict", "contested"} and row.get("allowed_04_output") != "contested":
            fail(label + ".allowed_04_output 在重大冲突未消解时必须为 contested")
        if row.get("proxy_dependency_status") in {"high", "proxy_only"} and row.get("allowed_04_output") == "full_reasoning_ready":
            fail(label + ".allowed_04_output 在高度依赖代理指标时不得为 full_reasoning_ready")
        if not row.get("assessment_reason"):
            fail(label + ".assessment_reason 不得为空")

    for row in rows["reasoning_inputs.csv"]:
        assert_subset(split_refs(row.get("source_run_refs")), source_runs, f"{row.get('input_id')}.source_run_refs")
        assert_subset(split_refs(row.get("evidence_refs")), evidence, f"{row.get('input_id')}.evidence_refs")
        assert_subset(split_refs(row.get("linked_judgment_unit_ids")), judgment_units, f"{row.get('input_id')}.linked_judgment_unit_ids")

    for file_, id_field in [
        ("state_variable_coverage.csv", "coverage_id"),
        ("path_readiness.csv", "node_id"),
    ]:
        for row in rows[file_]:
            label = f"{file_}#{row.get(id_field)}"
            assert_subset(split_refs(row.get("linked_input_ids")), inputs, label + ".linked_input_ids")
            assert_subset(split_refs(row.get("linked_evidence_ids")), evidence, label + ".linked_evidence_ids")
            assert_subset(split_refs(row.get("linked_gap_ids")), gaps, label + ".linked_gap_ids")
            assert_subset(split_refs(row.get("linked_judgment_unit_ids")), judgment_units, label + ".linked_judgment_unit_ids")

    for row in rows["gaps_and_risks.csv"]:
        label = f"gaps_and_risks#{row.get('gap_id')}"
        gap_type = row.get("gap_type", "").strip()
        if gap_type and gap_type not in GAP_TYPES:
            fail(label + ".gap_type 非法")
        assert_subset(split_refs(row.get("linked_judgment_unit_ids")), judgment_units, label + ".linked_judgment_unit_ids")
        assert_subset(split_refs(row.get("requirement_id")), requirements, label + ".requirement_id")
        if not row.get("description"):
            fail(label + ".description 不得为空")
        if gap_type == "05_material":
            if not row.get("impact_on_05"):
                fail(label + ".impact_on_05 在 gap_type=05_material 时不得为空")
            if row.get("priority") and row.get("priority") not in PRIORITIES:
                fail(label + ".priority 必须为 high/medium/low")
        if row.get("allowed_04_output_after_gap"):
            validate_allowed_04_output(row.get("allowed_04_output_after_gap"), label + ".allowed_04_output_after_gap")
        if row.get("maximum_judgment_level_after_gap"):
            validate_judgment_level(row.get("maximum_judgment_level_after_gap"), label + ".maximum_judgment_level_after_gap")

    for row in rows["display_data_candidates.csv"]:
        label = f"display_data_candidates#{row.get('data_candidate_id')}"
        assert_subset(split_refs(row.get("linked_judgment_unit_ids")), judgment_units, label + ".linked_judgment_unit_ids")
        assert_subset(split_refs(row.get("linked_input_ids")), inputs, label + ".linked_input_ids")
        assert_subset(split_refs(row.get("linked_evidence_ids")), evidence, label + ".linked_evidence_ids")
        assert_subset(split_refs(row.get("source_ids")), source_ids, label + ".source_ids")
        if row.get("data_status") not in {"ready", "partial", "missing"}:
            fail(label + ".data_status 必须为 ready/partial/missing")
        if row.get("visual_role") not in DISPLAY_VISUAL_ROLES:
            fail(label + ".visual_role 非法")
        if row.get("chart_readiness") not in DISPLAY_READINESS:
            fail(label + ".chart_readiness 必须为 ready/partial/missing")
        if row.get("quantitative_or_qualitative") not in DISPLAY_DATA_TYPES:
            fail(label + ".quantitative_or_qualitative 非法")
        if row.get("ranking_support") not in RANKING_SUPPORT:
            fail(label + ".ranking_support 非法")
        if row.get("report_grade_status") not in REPORT_GRADE_STATUSES:
            fail(label + ".report_grade_status 非法")
        time_points = row.get("time_points_count", "").strip()
        if time_points and not time_points.isdigit():
            fail(label + ".time_points_count 必须为空或非负整数")
        if row.get("report_grade_status") != "report_grade_ready" and not row.get("gap_to_report_grade"):
            fail(label + ".gap_to_report_grade 在未达到研报级展示时不得为空")

    chart_ids = ref_set(rows["chart_data_package.csv"], "figure_id", "chart_data_package.csv", allow_empty=True)
    for row in rows["chart_data_package.csv"]:
        label = f"chart_data_package#{row.get('figure_id')}"
        assert_subset(split_refs(row.get("data_candidate_ids")), data_candidates, label + ".data_candidate_ids")
        assert_subset(split_refs(row.get("source_ids")), source_ids, label + ".source_ids")
        if row.get("chart_readiness") not in DISPLAY_READINESS:
            fail(label + ".chart_readiness 必须为 ready/partial/missing")
        if row.get("report_grade_status") not in REPORT_GRADE_STATUSES:
            fail(label + ".report_grade_status 非法")
        if row.get("report_grade_status") != "report_grade_ready" and not row.get("gap_to_ready"):
            fail(label + ".gap_to_ready 在未达到研报级展示时不得为空")

    table_ids = ref_set(rows["table_material_package.csv"], "table_id", "table_material_package.csv", allow_empty=True)
    for row in rows["table_material_package.csv"]:
        label = f"table_material_package#{row.get('table_id')}"
        if row.get("table_role") not in TABLE_ROLES:
            fail(label + ".table_role 非法")
        assert_subset(split_refs(row.get("source_ids")), source_ids, label + ".source_ids")
        assert_subset(split_refs(row.get("linked_evidence_ids")), evidence, label + ".linked_evidence_ids")
        if row.get("readiness") not in DISPLAY_READINESS:
            fail(label + ".readiness 必须为 ready/partial/missing")
        if row.get("ranking_support") not in RANKING_SUPPORT:
            fail(label + ".ranking_support 非法")

    annotation_ids = ref_set(rows["source_annotation_package.csv"], "annotation_id", "source_annotation_package.csv", allow_empty=True)
    for row in rows["source_annotation_package.csv"]:
        label = f"source_annotation_package#{row.get('annotation_id')}"
        assert_subset(split_refs(row.get("source_id")), source_ids, label + ".source_id")
        assert_subset(split_refs(row.get("evidence_ids")), evidence, label + ".evidence_ids")
        if not row.get("citation_phrase"):
            fail(label + ".citation_phrase 不得为空")

    for row in rows["05_material_readiness.csv"]:
        label = f"05_material_readiness#{row.get('material_unit_id')}"
        if row.get("status") not in MATERIAL_READINESS_STATUSES:
            fail(label + ".status 非法")
        assert_subset(split_refs(row.get("linked_judgment_unit_ids")), judgment_units, label + ".linked_judgment_unit_ids")
        assert_subset(split_refs(row.get("linked_data_candidate_ids")), data_candidates, label + ".linked_data_candidate_ids")
        assert_subset(split_refs(row.get("linked_chart_ids")), chart_ids, label + ".linked_chart_ids")
        assert_subset(split_refs(row.get("linked_table_ids")), table_ids, label + ".linked_table_ids")
        assert_subset(split_refs(row.get("source_annotation_ids")), annotation_ids, label + ".source_annotation_ids")
        if not row.get("target_05_archetype") or not row.get("impact_on_05"):
            fail(label + ".target_05_archetype/impact_on_05 不得为空")

    _ = assessment_ids  # reserved for future cross-file checks


def _validate_counts(prep_meta: dict[str, object], summary_meta: dict[str, object], rows: dict[str, list[dict[str, str]]]) -> None:
    manifest_rows = rows["manifest.csv"]
    if len(manifest_rows) != 1:
        fail("manifest.csv 必须且只能有一行")
    manifest = manifest_rows[0]
    snapshot_version = str(manifest.get("snapshot_version"))
    schema_version = str(manifest.get("snapshot_schema_version"))
    if snapshot_version != schema_version or snapshot_version != SCHEMA_VERSION_03:
        fail(f"manifest snapshot_version 与 snapshot_schema_version 必须一致，且为 {SCHEMA_VERSION_03}")

    for field, expected in {
        "evidence_requirements_ref": _rel("evidence_requirements.csv"),
        "evidence_recipe_matches_ref": _rel("evidence_recipe_matches.csv"),
        "evidence_baskets_ref": _rel("evidence_baskets.csv"),
        "source_profiles_ref": _rel("source_profiles.csv"),
        "acquisition_channels_ref": _rel("acquisition_channels.csv"),
        "proxy_indicators_ref": _rel("proxy_indicators.csv"),
        "evidence_readiness_assessments_ref": _rel("evidence_readiness_assessments.csv"),
        "display_data_candidates_ref": _rel("display_data_candidates.csv"),
        "chart_data_package_ref": _rel("chart_data_package.csv"),
        "table_material_package_ref": _rel("table_material_package.csv"),
        "source_annotation_package_ref": _rel("source_annotation_package.csv"),
        "gaps_and_risks_ref": _rel("gaps_and_risks.csv"),
        "05_material_readiness_ref": _rel("05_material_readiness.csv"),
    }.items():
        if manifest.get(field) != expected:
            fail(f"manifest.{field} 必须为 {expected}")

    coverage_total = len(rows["state_variable_coverage.csv"])
    counted = sum(1 for row in rows["state_variable_coverage.csv"] if row.get("evidence_gate_status") == "counted")
    if _int_value(manifest["coverage_unit_total"], "manifest.coverage_unit_total") != coverage_total:
        fail("manifest.coverage_unit_total 必须等于 state_variable_coverage.csv 行数")
    if _int_value(manifest["evidence_backed_unit_count"], "manifest.evidence_backed_unit_count") != counted:
        fail("manifest.evidence_backed_unit_count 必须等于 evidence_gate_status=counted 的覆盖单元数")

    for meta_label, meta in [("prep", prep_meta), ("summary", summary_meta)]:
        if _int_value(meta["coverage_unit_total"], f"{meta_label}.coverage_unit_total") != coverage_total:
            fail(f"{meta_label}.coverage_unit_total 与快照不一致")
        if _int_value(meta["evidence_backed_unit_count"], f"{meta_label}.evidence_backed_unit_count") != counted:
            fail(f"{meta_label}.evidence_backed_unit_count 与快照不一致")
        expected_rate = 0.0 if coverage_total == 0 else counted / coverage_total
        actual_rate = _float_value(meta.get("evidence_coverage_rate", 0), f"{meta_label}.evidence_coverage_rate")
        if abs(actual_rate - expected_rate) > 0.005:
            fail(f"{meta_label}.evidence_coverage_rate 必须等于 evidence_backed_unit_count/coverage_unit_total")

    unit_rows = rows["evidence_readiness_assessments.csv"]
    # one assessment per judgment unit for package counts; if multiple, count distinct units by strictest? use distinct units
    by_unit: dict[str, str] = {}
    for row in unit_rows:
        unit_id = row.get("target_judgment_unit_id", "").strip()
        output = row.get("allowed_04_output", "")
        validate_allowed_04_output(output, f"evidence_readiness_assessments#{row.get('assessment_id')}")
        if not unit_id:
            continue
        if unit_id not in by_unit or output_rank(output) < output_rank(by_unit[unit_id]):
            by_unit[unit_id] = output
    counts = {value: 0 for value in ALLOWED_04_OUTPUTS}
    for output in by_unit.values():
        counts[output] += 1
    count_fields = {
        "judgment_unit_total": len(by_unit),
        "judgment_unit_full_reasoning_ready_count": counts["full_reasoning_ready"],
        "judgment_unit_directional_only_count": counts["directional_only"],
        "judgment_unit_conditional_only_count": counts["conditional_only"],
        "judgment_unit_insufficient_count": counts["insufficient"],
        "judgment_unit_blocked_count": counts["blocked"],
        "judgment_unit_contested_count": counts["contested"],
    }
    for field, expected in count_fields.items():
        if _int_value(manifest.get(field, -1), f"manifest.{field}") != expected:
            fail(f"manifest.{field} 必须为 {expected}")
        if field in summary_meta and _int_value(summary_meta[field], f"summary.{field}") != expected:
            fail(f"summary.{field} 必须为 {expected}")

    strength_rows = rows["judgment_unit_readiness.csv"]
    highest = max((row["maximum_judgment_level"] for row in strength_rows), key=judgment_level_rank)
    for label, meta in [("prep", prep_meta), ("summary", summary_meta), ("manifest", manifest)]:
        if str(meta.get("highest_supported_judgment_level")) != highest:
            fail(f"{label}.highest_supported_judgment_level 必须为 {highest}")
    floor_met = any(judgment_level_rank(row["maximum_judgment_level"]) >= judgment_level_rank("J2") for row in strength_rows)
    for label, meta in [("summary", summary_meta), ("manifest", manifest)]:
        value = str(meta.get("core_judgment_publish_floor_met", "")).lower() in {"true", "1", "yes"}
        if value != floor_met:
            fail(f"{label}.core_judgment_publish_floor_met 必须为 {str(floor_met).lower()}")


def _validate_judgment_strength(view: dict[str, object], rows: dict[str, list[dict[str, str]]]) -> None:
    view_units = {
        str(item["judgment_unit_id"]): item
        for item in view.get("judgment_units", [])
        if isinstance(item, dict) and item.get("judgment_unit_id")
    }
    path_rows = rows["path_readiness.csv"]
    evidence_rows = rows["evidence_records.csv"]

    for row in path_rows:
        label = f"path_readiness#{row.get('path_id')}#{row.get('node_id')}"
        if row.get("path_status") not in PATH_STATUSES:
            fail(f"{label}.path_status 非法")
        if row.get("reasoning_readiness") not in REASONING_READINESS:
            fail(f"{label}.reasoning_readiness 非法")
        if row.get("maximum_judgment_level") not in JUDGMENT_LEVELS:
            fail(f"{label}.maximum_judgment_level 非法")
        if row.get("path_status") == "blocked" and row.get("maximum_judgment_level") != "J0":
            fail(f"{label}: path_status=blocked 时 maximum_judgment_level 必须为 J0")

    for row in rows["judgment_unit_readiness.csv"]:
        ju_id = row.get("judgment_unit_id", "")
        label = f"judgment_unit_readiness#{ju_id}"
        if ju_id not in view_units:
            fail(f"{label} 未在 02 judgment_units 中定义")
        source_unit = view_units[ju_id]
        target_type = row.get("target_claim_type", "")
        level = row.get("maximum_judgment_level", "")
        validate_target_claim_level(target_type, level, label)
        if target_type != str(source_unit.get("target_claim_type")):
            fail(f"{label}.target_claim_type 必须继承 02")
        if row.get("maximum_judgment_label") != JUDGMENT_LABELS[level]:
            fail(f"{label}.maximum_judgment_label 必须为 {JUDGMENT_LABELS[level]}")
        if row.get("reasoning_readiness") not in REASONING_READINESS:
            fail(f"{label}.reasoning_readiness 非法")
        if row.get("claim_mode") not in CLAIM_MODES:
            fail(f"{label}.claim_mode 非法")
        if row.get("judgment_status") not in JUDGMENT_STATUSES:
            fail(f"{label}.judgment_status 非法")
        if row.get("claim_mode") == "conditional" and not split_refs(row.get("conditions")):
            fail(f"{label}: claim_mode=conditional 时 conditions 不得为空")
        if row.get("judgment_status") == "contested" and judgment_level_rank(level) > judgment_level_rank("J1"):
            fail(f"{label}: contested 的最高支持等级不得超过 J1")
        if row.get("reasoning_readiness") == "insufficient" and level != "J0":
            fail(f"{label}: reasoning_readiness=insufficient 时必须为 J0")
        if not str(row.get("strength_basis", "")).strip():
            fail(f"{label}.strength_basis 不得为空")

        linked_evidence = [
            item for item in evidence_rows
            if ju_id in split_refs(item.get("linked_judgment_unit_ids"))
        ]
        independent_groups = {
            item.get("independence_group_id", "").strip()
            for item in linked_evidence
            if item.get("independence_group_id", "").strip()
        }
        if int(row.get("independent_source_group_count", -1)) != len(independent_groups):
            fail(f"{label}.independent_source_group_count 必须由 evidence_records 去重得到 {len(independent_groups)}")
        evidence_baskets = set()
        for item in linked_evidence:
            evidence_baskets.update(split_refs(item.get("evidence_basket_ids")))
            requirement_id = str(item.get("requirement_id", ""))
            for basket in source_unit.get("mandatory_evidence_baskets", []):
                if requirement_id in split_refs(basket.get("evidence_requirement_refs")):
                    evidence_baskets.add(str(basket["basket_id"]))
        level_requirement = source_unit["level_requirements"][level]
        if level_requirement.get("applicable") is not True:
            fail(f"{label}: 02 未允许使用 {level}")
        if len(independent_groups) < int(level_requirement.get("minimum_independent_source_groups", 0)):
            fail(f"{label}: 独立来源组数未达到 02 对 {level} 的要求")
        required_baskets = set(split_refs(level_requirement.get("required_evidence_basket_refs")))
        baskets_met = level != "J0" and required_baskets.issubset(evidence_baskets)
        declared_baskets_met = str(row.get("mandatory_evidence_baskets_met", "")).lower() in {"true", "1", "yes"}
        if declared_baskets_met != baskets_met:
            fail(f"{label}.mandatory_evidence_baskets_met 与 evidence_records 不一致")

        linked_path_rows = [
            item for item in path_rows
            if ju_id in split_refs(item.get("linked_judgment_unit_ids"))
        ]
        if linked_path_rows and all(item.get("path_status") == "blocked" for item in linked_path_rows) and level != "J0":
            fail(f"{label}: 关联路径全部 blocked 时必须为 J0")

        support_roles = {"support", "primary_support", "corroborating_support"}
        direct_support = any(
            item.get("evidence_role") in support_roles and item.get("directness") == "direct"
            for item in linked_evidence
        )
        traceable_signal = any(item.get("traceability") not in {"", "untraceable"} for item in linked_evidence)
        counter_checked = row.get("counter_evidence_status") not in {"", "not_checked"}
        alternative_checked = row.get("alternative_explanation_status") not in {"", "not_checked", "compared_unresolved"}
        conflict_clear = row.get("conflict_status") not in {"", "unresolved", "unresolved_material", "material_conflict"}

        if level == "J4":
            primary_direct = any(
                item.get("evidence_role") in support_roles
                and item.get("directness") == "direct"
                and item.get("source_authority") in {"primary", "official", "official_primary"}
                for item in linked_evidence
            )
            if not (primary_direct and baskets_met and counter_checked and conflict_clear and row.get("scope_alignment") == "matched" and row.get("time_alignment") == "matched"):
                fail(f"{label}: J4 未满足一手直接证据、证据篮子、反证、冲突及范围时间要求")
        elif level == "J3":
            if not (baskets_met and len(independent_groups) >= 2 and counter_checked and alternative_checked and conflict_clear):
                fail(f"{label}: J3 未满足证据篮子、两组独立来源、反证、替代解释或冲突要求")
            if any(item.get("path_status") == "blocked" for item in linked_path_rows):
                fail(f"{label}: J3 的关联路径不得 blocked")
            if row.get("scope_alignment") != "matched" or row.get("time_alignment") != "matched":
                fail(f"{label}: J3 要求范围与时间匹配")
        elif level == "J2" and not (direct_support and counter_checked):
            fail(f"{label}: J2 至少需要一项直接支持且已检查反证")
        elif level == "J1" and not traceable_signal:
            fail(f"{label}: J1 至少需要一项可追溯初步信号")


def validate(prep_path: str | Path, snapshot_dir: str | Path) -> dict[str, object]:
    prep_path = Path(prep_path)
    snapshot_dir = Path(snapshot_dir)
    prep_triplet = parse_triplet(prep_path, "数据与证据准备", "03")
    dir_triplet = parse_triplet(snapshot_dir, "数据与证据快照", "03")
    if prep_triplet != dir_triplet:
        fail("03 准备文档与快照目录文件名核心主题、日期、序号必须一致")
    if not snapshot_dir.is_dir():
        fail(f"{snapshot_dir} 不是快照目录")

    summary_path = snapshot_dir / f"{snapshot_dir.name}.md"
    if not summary_path.exists():
        fail("快照目录缺少同名 Markdown 摘要")

    prep_meta, prep_body = parse_markdown(prep_path)
    summary_meta, _ = parse_markdown(summary_path)
    require_keys(prep_meta, REQUIRED_PREP_META, str(prep_path))
    require_keys(summary_meta, REQUIRED_SUMMARY_META, str(summary_path))
    require_schema_version(prep_meta["schema_version"], str(prep_path), expected=SCHEMA_VERSION_03)
    require_schema_version(summary_meta["schema_version"], str(summary_path), expected=SCHEMA_VERSION_03)
    if prep_meta["document_type"] != "data_evidence_preparation":
        fail("03 准备文档 document_type 必须为 data_evidence_preparation")
    if summary_meta["document_type"] != "data_evidence_snapshot_summary":
        fail("03 快照摘要 document_type 必须为 data_evidence_snapshot_summary")
    validate_quality_status(prep_meta["quality_status"], str(prep_path))
    validate_quality_status(summary_meta["quality_status"], str(summary_path))
    if prep_meta["quality_status"] in {"return_required", "stop_with_gap_report"}:
        fail("03 准备文档要求返工时不得通过单阶段校验")
    if summary_meta["quality_status"] in {"return_required", "stop_with_gap_report"}:
        fail("03 快照摘要要求返工时不得通过单阶段校验")
    validate_admission(prep_meta["admission"], str(prep_path))
    validate_admission(summary_meta["admission"], str(summary_path))
    validate_allowed_04_output(prep_meta["allowed_04_output"], str(prep_path))
    if prep_meta.get("preparation_status") not in PREPARATION_STATUSES:
        fail("preparation.preparation_status 非法")
    if prep_meta.get("search_status") not in SEARCH_STATUSES:
        fail("preparation.search_status 非法")
    if summary_meta.get("search_status") not in SEARCH_STATUSES:
        fail("summary.search_status 非法")
    if prep_meta["target_05_archetype"] not in ALLOWED_05_ARCHETYPES:
        fail("preparation.target_05_archetype 非法")
    if prep_meta["target_05_quality"] not in TARGET_05_QUALITIES:
        fail("preparation.target_05_quality 非法")
    if prep_meta["allowed_05_output"] not in ALLOWED_05_OUTPUTS:
        fail("preparation.allowed_05_output 非法")
    require_body_sections(prep_body, REQUIRED_PREP_SECTIONS, str(prep_path))
    require_no_placeholders(prep_meta, str(prep_path) + " front matter")
    require_no_placeholders(prep_body, str(prep_path) + " body")

    view = _validate_upstream_02(prep_meta, prep_path)

    admission = str(prep_meta["admission"])
    allowed_04_output = str(prep_meta["allowed_04_output"])
    coverage_rate = _float_value(prep_meta["evidence_coverage_rate"], "preparation.evidence_coverage_rate")
    required_coverage_rate = _float_value(prep_meta["required_coverage_rate"], "preparation.required_coverage_rate")
    search_status = str(prep_meta["search_status"])
    if (
        admission in {"normal_pass", "restricted_pass"}
        and coverage_rate < required_coverage_rate
        and search_status != "source_tiers_exhausted"
    ):
        fail("normal_pass/restricted_pass 低于 required_coverage_rate 时必须 search_status=source_tiers_exhausted")
    if admission in {"normal_pass", "restricted_pass"} and search_status == "in_progress":
        fail("search_status=in_progress 时不得冻结 normal_pass/restricted_pass")
    if admission == "failed" and output_rank(allowed_04_output) > output_rank("insufficient"):
        fail("admission=failed 时 allowed_04_output 不得高于 insufficient")
    if admission == "incomplete_pass" and output_rank(allowed_04_output) > output_rank("insufficient"):
        fail("admission=incomplete_pass 时 allowed_04_output 不得高于 insufficient")

    if not same_ref(prep_meta["snapshot_ref"], f"{snapshot_dir.name}/manifest.csv"):
        fail("preparation.snapshot_ref 必须指向快照目录 manifest.csv")
    if not same_ref(prep_meta["snapshot_summary_ref"], f"{snapshot_dir.name}/{file_name(summary_path)}"):
        fail("preparation.snapshot_summary_ref 必须指向快照摘要")

    _validate_headers(snapshot_dir)
    rows = _rows(snapshot_dir)
    _validate_instance_manifest(prep_path, snapshot_dir, prep_triplet, prep_meta, rows)
    _validate_ontology_instances(view, rows)
    _validate_normalized_evidence_graph(rows)
    _validate_counts(prep_meta, summary_meta, rows)
    _validate_snapshot_refs(snapshot_dir, rows)
    _validate_return_actions(rows)
    _validate_judgment_strength(view, rows)
    if admission in {"normal_pass", "restricted_pass", "incomplete_pass"}:
        for name in ["acquisition_log.csv", "semantic_instances.csv"]:
            if not rows[name]:
                fail(f"{name} 在 admission={admission} 时不得为空")

    manifest = rows["manifest.csv"][0]
    validate_admission_search_consistency(prep_meta, summary_meta, manifest)
    validate_gate_review_fields(manifest, "manifest")
    for label, meta in [("manifest", manifest), (str(prep_path), prep_meta), (str(summary_path), summary_meta)]:
        validate_core_ju_publish_baseline(
            rows["judgment_unit_readiness.csv"],
            admission=meta["admission"],
            quality_status=meta["quality_status"],
            label=label,
        )
    if not same_ref(manifest["task_id"], prep_meta["task_id"]):
        fail("manifest.task_id 与 preparation.task_id 不一致")
    if not same_ref(manifest["execution_id"], prep_meta["execution_id"]):
        fail("manifest.execution_id 与 preparation.execution_id 不一致")
    assert_values([row.get("maximum_judgment_level", "") for row in rows["path_readiness.csv"]], JUDGMENT_LEVELS, "path_readiness.maximum_judgment_level")
    assert_values([row.get("maximum_judgment_level_after_gap", "") for row in rows["gaps_and_risks.csv"]], JUDGMENT_LEVELS, "gaps_and_risks.maximum_judgment_level_after_gap")
    assert_values([row.get("coverage_constraint", "") for row in rows["state_variable_coverage.csv"]], {"none", "downgrade", "block"}, "state_variable_coverage.coverage_constraint")

    material_summary = validate_05_materials(
        snapshot_dir,
        quality_status=manifest["quality_status"],
        label="05_material_readiness",
    )

    return {
        "schema_version": SCHEMA_VERSION_03,
        "task_id": prep_meta["task_id"],
        "execution_id": prep_meta["execution_id"],
        "coverage_unit_total": int(manifest["coverage_unit_total"]),
        "evidence_backed_unit_count": int(manifest["evidence_backed_unit_count"]),
        "judgment_unit_total": int(manifest["judgment_unit_total"]),
        "material_readiness": material_summary,
    }


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print("usage: validate_03_outputs.py <数据与证据准备.md> <数据与证据快照目录>")
        return 2
    try:
        print(ok_payload(**validate(argv[1], argv[2])))
        return 0
    except Exception as exc:
        print(error_payload(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
