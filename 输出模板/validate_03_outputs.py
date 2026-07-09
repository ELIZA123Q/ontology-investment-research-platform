#!/usr/bin/env python3
"""Validate 03 data/evidence preparation and frozen snapshot outputs."""

from __future__ import annotations

import sys
from pathlib import Path

from quality_gate_utils import ALLOWED_04_OUTPUTS, output_rank, validate_admission, validate_allowed_04_output, validate_quality_status
from validator_utils import (
    assert_subset,
    assert_values,
    error_payload,
    fail,
    file_name,
    ok_payload,
    parse_markdown,
    parse_triplet,
    read_csv,
    read_csv_header,
    ref_set,
    require_body_sections,
    require_keys,
    require_schema_version,
    same_ref,
    split_refs,
)

from snapshot_layout_03 import SCHEMA_VERSION_03, SNAPSHOT_CSV_LAYOUT

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
    "02 交接基线",
    "数据与证据需求",
    "来源与取数方式",
    "处理与本体映射",
    "核心判断单元证据门槛",
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
    "search_status",
    "quality_status",
]

DISPLAY_VISUAL_ROLES = {"quant_chart", "ranking_table", "event_timeline", "supporting_table", "qualitative_table"}
DISPLAY_READINESS = {"ready", "partial", "missing"}
DISPLAY_DATA_TYPES = {"quantitative", "qualitative", "mixed"}
RANKING_SUPPORT = {"none", "weak", "medium", "strong"}
REPORT_GRADE_STATUSES = {"report_grade_ready", "usable_with_caveat", "not_report_grade"}
MATERIAL_READINESS_STATUSES = {"report_grade_ready", "usable_with_caveat", "partial", "missing", "not_applicable"}
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
ALLOWED_05_ARCHETYPES = {
    "event_commentary",
    "industry_dynamic_commentary",
    "industry_cycle_report",
    "company_earnings_commentary",
    "theme_deep_dive",
}
TARGET_05_QUALITIES = {"minimum_pass", "high_quality_pass", "return_required", "stop_with_gap_report"}
ALLOWED_05_OUTPUTS = {"full_report", "limited_report", "gap_report_only"}
EVIDENCE_ROLES = {
    "primary_support",
    "cross_validation",
    "counter_evidence",
    "blocking_condition",
    "proxy_indicator",
    "background_evidence",
}
REQUIREMENT_PURPOSES = {"support", "weaken", "block", "validate", "cross_validate", "counter", "background"}
QUALITY_LEVELS = {"Q1_background", "Q2_reasoning_usable", "Q3_directional_ready", "Q4_report_grade"}
SOURCE_TIERS = {
    "L1",
    "L2",
    "L3",
    "L4",
    "L5",
    "L6",
    "L7",
    "S1",
    "S2",
    "S3",
    "S4",
    "S5",
    "S6",
    "S7",
    "S8",
}
LOW_SOURCE_TIERS = {"L6", "L7", "S6", "S7", "S8"}
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


def _rel(logical_name: str) -> str:
    return SNAPSHOT_CSV_LAYOUT[logical_name]


def _csv_path(base: Path, logical_name: str) -> Path:
    return base / _rel(logical_name)


def _expected_header(logical_name: str) -> list[str]:
    return read_csv_header(_csv_path(TEMPLATE_DIR, logical_name))


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


def _validate_snapshot_refs(rows: dict[str, list[dict[str, str]]]) -> None:
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
    if manifest.get("snapshot_version") != SCHEMA_VERSION_03 or manifest.get("snapshot_schema_version") != SCHEMA_VERSION_03:
        fail(f"manifest snapshot_version 与 snapshot_schema_version 必须为 {SCHEMA_VERSION_03}")

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
    if int(manifest["coverage_unit_total"]) != coverage_total:
        fail("manifest.coverage_unit_total 必须等于 state_variable_coverage.csv 行数")
    if int(manifest["evidence_backed_unit_count"]) != counted:
        fail("manifest.evidence_backed_unit_count 必须等于 evidence_gate_status=counted 的覆盖单元数")

    for meta_label, meta in [("prep", prep_meta), ("summary", summary_meta)]:
        if int(meta["coverage_unit_total"]) != coverage_total:
            fail(f"{meta_label}.coverage_unit_total 与快照不一致")
        if int(meta["evidence_backed_unit_count"]) != counted:
            fail(f"{meta_label}.evidence_backed_unit_count 与快照不一致")

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
        if int(manifest.get(field, -1)) != expected:
            fail(f"manifest.{field} 必须为 {expected}")
        if field in summary_meta and int(summary_meta[field]) != expected:
            fail(f"summary.{field} 必须为 {expected}")


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
    validate_admission(prep_meta["admission"], str(prep_path))
    validate_admission(summary_meta["admission"], str(summary_path))
    validate_allowed_04_output(prep_meta["allowed_04_output"], str(prep_path))
    if prep_meta["target_05_archetype"] not in ALLOWED_05_ARCHETYPES:
        fail("preparation.target_05_archetype 非法")
    if prep_meta["target_05_quality"] not in TARGET_05_QUALITIES:
        fail("preparation.target_05_quality 非法")
    if prep_meta["allowed_05_output"] not in ALLOWED_05_OUTPUTS:
        fail("preparation.allowed_05_output 非法")
    require_body_sections(prep_body, REQUIRED_PREP_SECTIONS, str(prep_path))

    if not same_ref(prep_meta["snapshot_ref"], f"{snapshot_dir.name}/manifest.csv"):
        fail("preparation.snapshot_ref 必须指向快照目录 manifest.csv")
    if not same_ref(prep_meta["snapshot_summary_ref"], f"{snapshot_dir.name}/{file_name(summary_path)}"):
        fail("preparation.snapshot_summary_ref 必须指向快照摘要")

    _validate_headers(snapshot_dir)
    rows = _rows(snapshot_dir)
    _validate_counts(prep_meta, summary_meta, rows)
    _validate_snapshot_refs(rows)

    manifest = rows["manifest.csv"][0]
    if not same_ref(manifest["task_id"], prep_meta["task_id"]):
        fail("manifest.task_id 与 preparation.task_id 不一致")
    if not same_ref(manifest["execution_id"], prep_meta["execution_id"]):
        fail("manifest.execution_id 与 preparation.execution_id 不一致")
    assert_values([row.get("allowed_04_output", "") for row in rows["path_readiness.csv"]], ALLOWED_04_OUTPUTS, "path_readiness.allowed_04_output")

    return {
        "schema_version": SCHEMA_VERSION_03,
        "task_id": prep_meta["task_id"],
        "execution_id": prep_meta["execution_id"],
        "coverage_unit_total": int(manifest["coverage_unit_total"]),
        "evidence_backed_unit_count": int(manifest["evidence_backed_unit_count"]),
        "judgment_unit_total": int(manifest["judgment_unit_total"]),
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
