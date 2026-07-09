#!/usr/bin/env python3
"""Validate 04 reasoning report and audit outputs."""

from __future__ import annotations

import sys
import re
from pathlib import Path

from quality_gate_utils import ALLOWED_04_OUTPUTS, output_rank, validate_allowed_04_output, validate_quality_status
from snapshot_layout_03 import SNAPSHOT_CSV_LAYOUT
from validator_utils import (
    assert_subset,
    error_payload,
    fail,
    file_name,
    load_yaml_file,
    ok_payload,
    parse_markdown,
    parse_triplet,
    read_csv,
    require_body_sections,
    require_keys,
    require_schema_version,
    same_ref,
    split_refs,
)


def _snapshot_csv(snapshot_dir: Path, logical_name: str) -> list[dict[str, str]]:
    return read_csv(snapshot_dir / SNAPSHOT_CSV_LAYOUT[logical_name])


REQUIRED_REPORT_META = [
    "document_type",
    "schema_version",
    "task_id",
    "execution_id",
    "source_01_ref",
    "source_02_logic_ref",
    "source_02_view_ref",
    "preparation_ref",
    "snapshot_ref",
    "audit_ref",
    "judgment_as_of",
    "report_status",
    "quality_status",
    "conclusion_level",
    "confidence",
    "scope",
]

REQUIRED_REPORT_SECTIONS = [
    "一页摘要",
    "核心落点：当前怎么看—为什么—下一步看什么",
    "主导机制",
    "对象分化",
    "演进路线",
    "改判闸门",
    "可执行跟踪",
    "证据边界与审计索引",
    "04 质量门槛检查",
]

REQUIRED_AUDIT_TOP = [
    "document_type",
    "schema_version",
    "metadata",
    "input_integrity",
    "evidence_admission",
    "judgment_unit_gate_results",
    "overall_judgment",
    "claim_register",
    "uncertainty_register",
    "change_gate_register",
    "tracking_register",
    "handoff_to_05",
    "ontology_context",
    "path_results",
    "state_variable_results",
    "data_logic",
    "report_quality_check",
    "compliance_check",
]

REPORT_STATUSES = {"draft", "complete", "published"}
HANDOFF_EXPRESSION_STRENGTHS = {
    "strong_directional",
    "medium_directional",
    "observation",
    "hypothesis",
}
DATA_STATUSES = {"ready", "partial", "missing"}
ALLOWED_05_ARCHETYPES = {
    "event_commentary",
    "industry_dynamic_commentary",
    "industry_cycle_report",
    "company_earnings_commentary",
    "theme_deep_dive",
}
TARGET_05_QUALITIES = {"minimum_pass", "high_quality_pass", "return_required", "stop_with_gap_report"}
HANDOFF_STATUSES = {"ready", "usable_with_caveat", "not_ready"}
OUTPUT_CEILINGS = {"full_report", "limited_report", "gap_report_only"}
REPORT_GRADE_STATUSES = {"report_grade_ready", "usable_with_caveat", "not_report_grade"}
CONCLUSION_LEVELS = {
    "confirmed",
    "directional",
    "conditional",
    "insufficient_evidence",
    "blocked",
    "contested",
}


def _validate_report(report_path: Path) -> tuple[dict[str, object], str]:
    meta, body = parse_markdown(report_path)
    require_keys(meta, REQUIRED_REPORT_META, str(report_path))
    require_schema_version(meta["schema_version"], str(report_path))
    if meta["document_type"] != "reasoning_report":
        fail("04 报告 document_type 必须为 reasoning_report")
    if meta["report_status"] not in REPORT_STATUSES:
        fail("report_status 非法")
    validate_quality_status(meta["quality_status"], str(report_path))
    if meta["conclusion_level"] not in CONCLUSION_LEVELS:
        fail("conclusion_level 非法")
    if not isinstance(meta.get("scope"), dict):
        fail("scope 必须是对象")
    require_body_sections(body, REQUIRED_REPORT_SECTIONS, str(report_path))
    forbidden = ["目标价", "收益率预测", "仓位建议", "买入评级", "卖出评级", "交易建议"]
    for marker in forbidden:
        for match in re.finditer(re.escape(marker), body):
            context = body[max(0, match.start() - 30) : match.end() + 12]
            if "不构成" in context or "不得" in context or "不输出" in context:
                continue
            fail(f"04 正文不得包含投资建议或评级用语: {marker}")
    return meta, body


def _validate_audit(audit_path: Path) -> dict[str, object]:
    audit = load_yaml_file(audit_path)
    if not isinstance(audit, dict):
        fail("04 审计文件必须是 YAML 对象")
    require_keys(audit, REQUIRED_AUDIT_TOP, str(audit_path))
    require_schema_version(audit["schema_version"], str(audit_path))
    if audit["document_type"] != "reasoning_audit":
        fail("04 审计 document_type 必须为 reasoning_audit")
    metadata = audit["metadata"]
    require_keys(metadata, ["task_id", "execution_id", "report_ref", "snapshot_ref", "audit_status", "quality_status"], "audit.metadata")
    validate_quality_status(metadata["quality_status"], "audit.metadata")
    if metadata["audit_status"] not in REPORT_STATUSES:
        fail("audit.metadata.audit_status 非法")
    return audit


def _snapshot_rows(snapshot_dir: Path) -> tuple[dict[str, str], dict[str, dict[str, str]], dict[str, dict[str, str]], dict[str, set[str]]]:
    manifest_rows = _snapshot_csv(snapshot_dir, "manifest.csv")
    if len(manifest_rows) != 1:
        fail("manifest.csv 必须且只能有一行")
    readiness_rows = _snapshot_csv(snapshot_dir, "evidence_readiness_assessments.csv")
    readiness_by_id = {row["assessment_id"]: row for row in readiness_rows if row.get("assessment_id")}
    if not readiness_by_id:
        fail("evidence_readiness_assessments.csv 至少需要一行")
    judgment_by_id: dict[str, dict[str, str]] = {}
    for assessment_id, row in readiness_by_id.items():
        unit_id = row.get("target_judgment_unit_id", "").strip()
        if not unit_id:
            fail(f"evidence_readiness_assessments#{assessment_id}.target_judgment_unit_id 不得为空")
        validate_allowed_04_output(row.get("allowed_04_output"), f"evidence_readiness_assessments#{assessment_id}")
        existing = judgment_by_id.get(unit_id)
        if existing is None or output_rank(row.get("allowed_04_output", "")) < output_rank(existing.get("allowed_04_output", "")):
            judgment_by_id[unit_id] = row
    if not judgment_by_id:
        fail("evidence_readiness_assessments.csv 至少需要一行有效 target_judgment_unit_id")
    evidence_rows = _snapshot_csv(snapshot_dir, "evidence_records.csv")
    display_rows = _snapshot_csv(snapshot_dir, "display_data_candidates.csv")
    source_rows = _snapshot_csv(snapshot_dir, "source_snapshot.csv")
    chart_rows = _snapshot_csv(snapshot_dir, "chart_data_package.csv")
    table_rows = _snapshot_csv(snapshot_dir, "table_material_package.csv")
    source_annotation_rows = _snapshot_csv(snapshot_dir, "source_annotation_package.csv")
    snapshot_sets = {
        "evidence_ids": {row["evidence_id"] for row in evidence_rows if row.get("evidence_id")},
        "data_candidate_ids": {row["data_candidate_id"] for row in display_rows if row.get("data_candidate_id")},
        "source_ids": {row["source_id"] for row in source_rows if row.get("source_id")},
        "chart_ids": {row["figure_id"] for row in chart_rows if row.get("figure_id")},
        "table_ids": {row["table_id"] for row in table_rows if row.get("table_id")},
        "source_annotation_ids": {row["annotation_id"] for row in source_annotation_rows if row.get("annotation_id")},
        "readiness_assessment_ids": set(readiness_by_id),
    }
    return manifest_rows[0], judgment_by_id, readiness_by_id, snapshot_sets


def _validate_claims(
    audit: dict[str, object],
    judgment_by_id: dict[str, dict[str, str]],
    readiness_by_id: dict[str, dict[str, str]],
) -> None:
    claims = audit["claim_register"]
    if not isinstance(claims, list) or not claims:
        fail("claim_register 至少需要一项")
    judgment_ids = set(judgment_by_id)
    claim_ids = set()
    for claim in claims:
        require_keys(
            claim,
            [
                "claim_id",
                "report_section",
                "reader_label",
                "statement",
                "linked_judgment_unit",
                "readiness_assessment_refs",
                "allowed_04_output",
                "conclusion_level",
                "confidence",
                "overreach_check",
            ],
            "claim_register[]",
        )
        claim_ids.add(str(claim["claim_id"]))
        validate_allowed_04_output(claim["allowed_04_output"], f"claim_register#{claim['claim_id']}")
        linked_units = split_refs(claim.get("linked_judgment_unit"))
        assert_subset(linked_units, judgment_ids, f"claim_register#{claim['claim_id']}.linked_judgment_unit")
        assessment_refs = split_refs(claim.get("readiness_assessment_refs"))
        if not assessment_refs:
            fail(f"claim_register#{claim['claim_id']}.readiness_assessment_refs 不得为空")
        assert_subset(assessment_refs, set(readiness_by_id), f"claim_register#{claim['claim_id']}.readiness_assessment_refs")
        for unit_id in linked_units:
            source_output = judgment_by_id[unit_id]["allowed_04_output"]
            if output_rank(str(claim["allowed_04_output"])) > output_rank(source_output):
                fail(f"{claim['claim_id']} 超过 03 使用上限: {unit_id}={source_output}")
        for assessment_id in assessment_refs:
            assessment = readiness_by_id[assessment_id]
            assessment_unit = assessment.get("target_judgment_unit_id", "")
            if assessment_unit not in linked_units:
                fail(f"{claim['claim_id']} 引用的 readiness assessment 不属于 linked_judgment_unit: {assessment_id}")
            assessment_output = assessment.get("allowed_04_output", "")
            if output_rank(str(claim["allowed_04_output"])) > output_rank(assessment_output):
                fail(f"{claim['claim_id']} 超过 readiness assessment 使用上限: {assessment_id}={assessment_output}")
        checks = claim["overreach_check"]
        if not isinstance(checks, dict):
            fail(f"{claim['claim_id']}.overreach_check 必须是对象")
        for key in ["within_03_use_limit", "evidence_label_consistent", "no_unfrozen_fact_used"]:
            if checks.get(key) is not True:
                fail(f"{claim['claim_id']}.overreach_check.{key} 必须为 true")

    for register, ref_field in [
        ("uncertainty_register", "affects_claim_refs"),
        ("change_gate_register", "linked_claim_refs"),
    ]:
        for row in audit.get(register, []):
            assert_subset(split_refs(row.get(ref_field)), claim_ids, f"{register}.{ref_field}")


def _validate_quality_and_compliance(audit: dict[str, object]) -> None:
    quality = audit["report_quality_check"]
    compliance = audit["compliance_check"]
    for key in [
        "answer_first",
        "claims_within_03_use_limits",
        "claim_labels_match_evidence_strength",
        "change_gates_observable",
        "no_internal_ids_in_main_text",
        "no_investment_advice",
        "audit_report_consistent",
    ]:
        if quality.get(key) is not True:
            fail(f"report_quality_check.{key} 必须为 true")
    if quality.get("result") != "pass":
        fail("report_quality_check.result 必须为 pass")
    for key in [
        "no_rating_target_price_return_forecast_or_position_advice",
        "no_new_unfrozen_evidence",
        "no_scope_drift",
        "citations_or_evidence_refs_complete",
        "publishable",
    ]:
        if compliance.get(key) is not True:
            fail(f"compliance_check.{key} 必须为 true")


def _validate_handoff(audit: dict[str, object], judgment_by_id: dict[str, dict[str, str]], snapshot_sets: dict[str, set[str]]) -> None:
    handoff = audit["handoff_to_05"]
    if not isinstance(handoff, dict):
        fail("handoff_to_05 必须是对象")
    require_keys(
        handoff,
        [
            "target_05_archetype",
            "target_05_quality",
            "handoff_status",
            "output_ceiling",
            "formal_report_allowed",
            "report_title_candidates",
            "subtitle_candidates",
            "core_thesis_sentence",
            "one_page_summary_points",
            "section_plan",
            "approved_core_claims",
            "market_common_view",
            "differentiated_view",
            "why_now",
            "misread_risks",
            "narrative_spine",
            "evidence_progression",
            "object_strength_ranking",
            "front_section_caveats",
            "restricted_claims",
            "prohibited_claims",
            "required_caveats",
            "chart_candidates",
            "chart_package",
            "table_candidates",
            "table_package",
            "decision_gates",
            "tracking_items",
            "tracking_dashboard",
            "expression_rules",
            "confidence_ceiling",
        ],
        "handoff_to_05",
    )
    if str(handoff["target_05_archetype"]) not in ALLOWED_05_ARCHETYPES:
        fail("handoff_to_05.target_05_archetype 非法")
    if str(handoff["target_05_quality"]) not in TARGET_05_QUALITIES:
        fail("handoff_to_05.target_05_quality 非法")
    if str(handoff["handoff_status"]) not in HANDOFF_STATUSES:
        fail("handoff_to_05.handoff_status 非法")
    if str(handoff["output_ceiling"]) not in OUTPUT_CEILINGS:
        fail("handoff_to_05.output_ceiling 非法")
    if not isinstance(handoff["formal_report_allowed"], bool):
        fail("handoff_to_05.formal_report_allowed 必须是布尔值")
    if str(handoff["confidence_ceiling"]) not in {"high", "medium", "low"}:
        fail("handoff_to_05.confidence_ceiling 非法")
    for field in ["market_common_view", "differentiated_view", "why_now", "narrative_spine", "core_thesis_sentence"]:
        if not str(handoff.get(field, "")).strip():
            fail(f"handoff_to_05.{field} 不得为空")
    for field in [
        "report_title_candidates",
        "subtitle_candidates",
        "section_plan",
        "misread_risks",
        "evidence_progression",
        "object_strength_ranking",
        "front_section_caveats",
    ]:
        if not isinstance(handoff.get(field), list) or not handoff[field]:
            fail(f"handoff_to_05.{field} 必须是非空列表")

    claim_ids = {str(row.get("claim_id", "")).strip() for row in audit["claim_register"]}
    judgment_ids = set(judgment_by_id)
    for row in handoff["report_title_candidates"]:
        require_keys(row, ["title", "title_style", "linked_claim_ids"], "handoff_to_05.report_title_candidates[]")
        if not str(row.get("title", "")).strip():
            fail("handoff_to_05.report_title_candidates[].title 不得为空")
        assert_subset(split_refs(row.get("linked_claim_ids")), claim_ids, "handoff_to_05.report_title_candidates.linked_claim_ids")
    summary_points = handoff["one_page_summary_points"]
    if not isinstance(summary_points, dict):
        fail("handoff_to_05.one_page_summary_points 必须是对象")
    for key in [
        "current_view",
        "market_difference",
        "dominant_mechanism",
        "strongest_and_weakest_objects",
        "next_1_2_quarter_validation",
        "decision_gates",
    ]:
        if not str(summary_points.get(key, "")).strip():
            fail(f"handoff_to_05.one_page_summary_points.{key} 不得为空")
    for row in handoff["section_plan"]:
        require_keys(
            row,
            [
                "section_title",
                "section_function",
                "section_thesis",
                "approved_claim_ids",
                "evidence_ids",
                "chart_ids",
                "table_ids",
                "required_caveats",
                "prohibited_expressions",
            ],
            "handoff_to_05.section_plan[]",
        )
        for key in ["section_title", "section_function", "section_thesis"]:
            if not str(row.get(key, "")).strip():
                fail(f"handoff_to_05.section_plan[].{key} 不得为空")
        assert_subset(split_refs(row.get("approved_claim_ids")), claim_ids, "handoff_to_05.section_plan.approved_claim_ids")
        assert_subset(split_refs(row.get("evidence_ids")), snapshot_sets["evidence_ids"], "handoff_to_05.section_plan.evidence_ids")
        assert_subset(split_refs(row.get("chart_ids")), snapshot_sets["chart_ids"], "handoff_to_05.section_plan.chart_ids")
        assert_subset(split_refs(row.get("table_ids")), snapshot_sets["table_ids"], "handoff_to_05.section_plan.table_ids")
    for row in handoff["evidence_progression"]:
        require_keys(row, ["step", "evidence_summary", "supports_claim_ids"], "handoff_to_05.evidence_progression[]")
        if not str(row.get("step", "")).strip() or not str(row.get("evidence_summary", "")).strip():
            fail("handoff_to_05.evidence_progression[].step/evidence_summary 不得为空")
        assert_subset(split_refs(row.get("supports_claim_ids")), claim_ids, "handoff_to_05.evidence_progression.supports_claim_ids")
    ranks = []
    for row in handoff["object_strength_ranking"]:
        require_keys(row, ["rank", "object", "strength_label", "rationale", "linked_claim_ids"], "handoff_to_05.object_strength_ranking[]")
        try:
            ranks.append(int(row["rank"]))
        except Exception:
            fail("handoff_to_05.object_strength_ranking[].rank 必须是整数")
        for key in ["object", "strength_label", "rationale"]:
            if not str(row.get(key, "")).strip():
                fail(f"handoff_to_05.object_strength_ranking[].{key} 不得为空")
        assert_subset(split_refs(row.get("linked_claim_ids")), claim_ids, "handoff_to_05.object_strength_ranking.linked_claim_ids")
    if len(ranks) >= 2 and sorted(ranks) != list(range(1, len(ranks) + 1)):
        fail("handoff_to_05.object_strength_ranking.rank 必须从 1 连续排序")
    for row in handoff["front_section_caveats"]:
        require_keys(row, ["section", "caveat"], "handoff_to_05.front_section_caveats[]")
        if not str(row.get("section", "")).strip() or not str(row.get("caveat", "")).strip():
            fail("handoff_to_05.front_section_caveats[].section/caveat 不得为空")
    for row in handoff["approved_core_claims"]:
        require_keys(
            row,
            [
                "claim_id",
                "claim_text",
                "expression_strength",
                "confidence",
                "source_judgment_units",
                "readiness_assessment_refs",
                "evidence_anchors",
                "required_caveats",
            ],
            "handoff_to_05.approved_core_claims[]",
        )
        if str(row["claim_id"]) not in claim_ids:
            fail(f"handoff_to_05.approved_core_claims 引用了不存在的 claim_id: {row['claim_id']}")
        if str(row["expression_strength"]) not in HANDOFF_EXPRESSION_STRENGTHS:
            fail(f"handoff_to_05.approved_core_claims#{row['claim_id']}.expression_strength 非法")
        if str(row["confidence"]) not in {"high", "medium", "low"}:
            fail(f"handoff_to_05.approved_core_claims#{row['claim_id']}.confidence 非法")
        assert_subset(split_refs(row.get("source_judgment_units")), judgment_ids, f"handoff_to_05.approved_core_claims#{row['claim_id']}.source_judgment_units")
        assert_subset(split_refs(row.get("readiness_assessment_refs")), snapshot_sets["readiness_assessment_ids"], f"handoff_to_05.approved_core_claims#{row['claim_id']}.readiness_assessment_refs")

    for register in ["restricted_claims", "prohibited_claims"]:
        if not isinstance(handoff[register], list):
            fail(f"handoff_to_05.{register} 必须是列表")
    for register in ["chart_candidates", "table_candidates"]:
        for row in handoff[register]:
            require_keys(row, ["intended_message", "source_evidence_ids", "data_status", "usage_limit"], f"handoff_to_05.{register}[]")
            if str(row["data_status"]) not in DATA_STATUSES:
                fail(f"handoff_to_05.{register}.data_status 非法")
            if register == "chart_candidates":
                assert_subset(split_refs(row.get("source_data_candidate_ids")), snapshot_sets["data_candidate_ids"], "handoff_to_05.chart_candidates.source_data_candidate_ids")
            if register == "table_candidates":
                assert_subset(split_refs(row.get("source_data_candidate_ids")), snapshot_sets["data_candidate_ids"], "handoff_to_05.table_candidates.source_data_candidate_ids")
            assert_subset(split_refs(row.get("source_evidence_ids")), snapshot_sets["evidence_ids"], f"handoff_to_05.{register}.source_evidence_ids")

    for row in handoff["chart_package"]:
        require_keys(
            row,
            ["figure_id", "suggested_title", "chart_role", "intended_message", "data_candidate_ids", "source_ids", "report_grade_status", "usage_limit"],
            "handoff_to_05.chart_package[]",
        )
        if str(row["figure_id"]) not in snapshot_sets["chart_ids"]:
            fail(f"handoff_to_05.chart_package 引用了不存在的 figure_id: {row['figure_id']}")
        if str(row["report_grade_status"]) not in REPORT_GRADE_STATUSES:
            fail("handoff_to_05.chart_package.report_grade_status 非法")
        assert_subset(split_refs(row.get("data_candidate_ids")), snapshot_sets["data_candidate_ids"], "handoff_to_05.chart_package.data_candidate_ids")
        assert_subset(split_refs(row.get("source_ids")), snapshot_sets["source_ids"], "handoff_to_05.chart_package.source_ids")

    for row in handoff["table_package"]:
        require_keys(
            row,
            ["table_id", "suggested_title", "table_role", "intended_message", "row_objects", "source_data_candidate_ids", "source_evidence_ids", "readiness", "usage_limit"],
            "handoff_to_05.table_package[]",
        )
        if str(row["table_id"]) not in snapshot_sets["table_ids"]:
            fail(f"handoff_to_05.table_package 引用了不存在的 table_id: {row['table_id']}")
        if str(row["readiness"]) not in DATA_STATUSES:
            fail("handoff_to_05.table_package.readiness 非法")
        assert_subset(split_refs(row.get("source_data_candidate_ids")), snapshot_sets["data_candidate_ids"], "handoff_to_05.table_package.source_data_candidate_ids")
        assert_subset(split_refs(row.get("source_evidence_ids")), snapshot_sets["evidence_ids"], "handoff_to_05.table_package.source_evidence_ids")

    for row in handoff["tracking_items"]:
        if row.get("related_claim_id"):
            assert_subset(split_refs(row.get("related_claim_id")), claim_ids, "handoff_to_05.tracking_items.related_claim_id")
    for row in handoff["tracking_dashboard"]:
        require_keys(row, ["tracking_item", "object", "indicator", "source", "frequency", "related_claim_id", "trigger_implication"], "handoff_to_05.tracking_dashboard[]")
        if row.get("related_claim_id"):
            assert_subset(split_refs(row.get("related_claim_id")), claim_ids, "handoff_to_05.tracking_dashboard.related_claim_id")
    if not isinstance(handoff["expression_rules"], dict):
        fail("handoff_to_05.expression_rules 必须是对象")
    require_keys(handoff["expression_rules"], ["must_use", "must_avoid", "front_section_style"], "handoff_to_05.expression_rules")


def validate(report_path: str | Path, audit_path: str | Path, snapshot_dir: str | Path) -> dict[str, object]:
    report_path = Path(report_path)
    audit_path = Path(audit_path)
    snapshot_dir = Path(snapshot_dir)
    report_triplet = parse_triplet(report_path, "推理报告", "04")
    audit_triplet = parse_triplet(audit_path, "推理审计", "04")
    snapshot_triplet = parse_triplet(snapshot_dir, "数据与证据快照", "03")
    if report_triplet != audit_triplet or report_triplet != snapshot_triplet:
        fail("04 报告、审计与 03 快照文件名核心主题、日期、序号必须一致")

    report_meta, _ = _validate_report(report_path)
    audit = _validate_audit(audit_path)
    metadata = audit["metadata"]
    manifest, judgment_by_id, readiness_by_id, snapshot_sets = _snapshot_rows(snapshot_dir)

    if not same_ref(report_meta["audit_ref"], file_name(audit_path)):
        fail("report.audit_ref 必须指向配对审计 YAML")
    if not same_ref(metadata["report_ref"], file_name(report_path)):
        fail("audit.metadata.report_ref 必须指向配对报告")
    if not same_ref(report_meta["snapshot_ref"], f"{snapshot_dir.name}/manifest.csv"):
        fail("report.snapshot_ref 必须指向 03 快照 manifest.csv")
    if not same_ref(metadata["snapshot_ref"], f"{snapshot_dir.name}/manifest.csv"):
        fail("audit.metadata.snapshot_ref 必须指向 03 快照 manifest.csv")
    for field in ["task_id", "execution_id"]:
        if not same_ref(report_meta[field], metadata[field]) or not same_ref(report_meta[field], manifest[field]):
            fail(f"{field} 在 report/audit/manifest 中必须一致")

    evidence_admission = audit["evidence_admission"]
    for field in ["admission", "coverage_unit_total", "evidence_backed_unit_count", "confidence_ceiling"]:
        if field in evidence_admission and not same_ref(evidence_admission[field], manifest[field]):
            fail(f"audit.evidence_admission.{field} 必须与 manifest 一致")

    _validate_claims(audit, judgment_by_id, readiness_by_id)
    _validate_quality_and_compliance(audit)
    _validate_handoff(audit, judgment_by_id, snapshot_sets)

    return {
        "schema_version": "1.0.0",
        "task_id": report_meta["task_id"],
        "execution_id": report_meta["execution_id"],
        "claims": len(audit["claim_register"]),
    }


def main(argv: list[str]) -> int:
    if len(argv) != 4:
        print("usage: validate_04_outputs.py <推理报告.md> <推理审计.yaml> <数据与证据快照目录>")
        return 2
    try:
        print(ok_payload(**validate(argv[1], argv[2], argv[3])))
        return 0
    except Exception as exc:
        print(error_payload(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
