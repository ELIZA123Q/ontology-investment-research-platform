#!/usr/bin/env python3
"""Validate 03 data/evidence preparation and frozen snapshot outputs."""

from __future__ import annotations

import sys
from pathlib import Path

from quality_gate_utils import ALLOWED_04_OUTPUTS, validate_admission, validate_allowed_04_output, validate_quality_status
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

REQUIRED_CSV_FILES = [
    path.name
    for path in sorted(TEMPLATE_DIR.glob("*.csv"))
    if path.name != "字段清单.csv"
]

DISPLAY_VISUAL_ROLES = {"quant_chart", "ranking_table", "event_timeline", "supporting_table", "qualitative_table"}
DISPLAY_READINESS = {"ready", "partial", "missing"}
DISPLAY_DATA_TYPES = {"quantitative", "qualitative", "mixed"}
RANKING_SUPPORT = {"none", "weak", "medium", "strong"}
REPORT_GRADE_STATUSES = {"report_grade_ready", "usable_with_caveat", "not_report_grade"}
MATERIAL_READINESS_STATUSES = {"report_grade_ready", "usable_with_caveat", "partial", "missing", "not_applicable"}
TABLE_ROLES = {"ranking", "evidence_summary", "source_note", "decision_signal", "gap_plan", "scenario", "object_mapping"}
PRIORITIES = {"high", "medium", "low"}
ALLOWED_05_ARCHETYPES = {
    "event_commentary",
    "industry_dynamic_commentary",
    "industry_cycle_report",
    "company_earnings_commentary",
    "theme_deep_dive",
}
TARGET_05_QUALITIES = {"minimum_pass", "high_quality_pass", "return_required", "stop_with_gap_report"}
ALLOWED_05_OUTPUTS = {"full_report", "limited_report", "gap_report_only"}


def _expected_header(file_name_: str) -> list[str]:
    return read_csv_header(TEMPLATE_DIR / file_name_)


def _validate_headers(snapshot_dir: Path) -> None:
    missing = [name for name in REQUIRED_CSV_FILES if not (snapshot_dir / name).exists()]
    if missing:
        fail("快照目录缺少 CSV: " + ", ".join(missing))
    for name in REQUIRED_CSV_FILES:
        actual = read_csv_header(snapshot_dir / name)
        expected = _expected_header(name)
        if actual != expected:
            fail(f"{name} 表头必须与模板一致")


def _rows(snapshot_dir: Path) -> dict[str, list[dict[str, str]]]:
    return {name: read_csv(snapshot_dir / name) for name in REQUIRED_CSV_FILES}


def _validate_snapshot_refs(rows: dict[str, list[dict[str, str]]]) -> None:
    source_runs = ref_set(rows["source_snapshot.csv"], "source_run_id", "source_snapshot.csv")
    source_ids = ref_set(rows["source_snapshot.csv"], "source_id", "source_snapshot.csv")
    inputs = ref_set(rows["reasoning_inputs.csv"], "input_id", "reasoning_inputs.csv")
    evidence = ref_set(rows["evidence_records.csv"], "evidence_id", "evidence_records.csv")
    coverage = ref_set(rows["state_variable_coverage.csv"], "coverage_id", "state_variable_coverage.csv")
    gaps = ref_set(rows["gaps_and_risks.csv"], "gap_id", "gaps_and_risks.csv", allow_empty=True)
    judgment_units = ref_set(rows["judgment_unit_readiness.csv"], "judgment_unit_id", "judgment_unit_readiness.csv")
    data_candidates = ref_set(rows["display_data_candidates.csv"], "data_candidate_id", "display_data_candidates.csv", allow_empty=True)

    for row in rows["evidence_records.csv"]:
        assert_subset(split_refs(row.get("source_run_id")), source_runs, f"{row.get('evidence_id')}.source_run_id")
        assert_subset(split_refs(row.get("grounds_input_ids")), inputs, f"{row.get('evidence_id')}.grounds_input_ids")
        assert_subset(split_refs(row.get("linked_judgment_unit_ids")), judgment_units, f"{row.get('evidence_id')}.linked_judgment_unit_ids")

    for row in rows["reasoning_inputs.csv"]:
        assert_subset(split_refs(row.get("source_run_refs")), source_runs, f"{row.get('input_id')}.source_run_refs")
        assert_subset(split_refs(row.get("evidence_refs")), evidence, f"{row.get('input_id')}.evidence_refs")
        assert_subset(split_refs(row.get("linked_judgment_unit_ids")), judgment_units, f"{row.get('input_id')}.linked_judgment_unit_ids")

    for file_, id_field in [
        ("state_variable_coverage.csv", "coverage_id"),
        ("path_readiness.csv", "node_id"),
        ("judgment_unit_readiness.csv", "judgment_unit_id"),
    ]:
        for row in rows[file_]:
            label = f"{file_}#{row.get(id_field)}"
            assert_subset(split_refs(row.get("linked_input_ids")), inputs, label + ".linked_input_ids")
            assert_subset(split_refs(row.get("linked_evidence_ids")), evidence, label + ".linked_evidence_ids")
            assert_subset(split_refs(row.get("linked_gap_ids")), gaps, label + ".linked_gap_ids")
            assert_subset(split_refs(row.get("linked_judgment_unit_ids")), judgment_units, label + ".linked_judgment_unit_ids")

    assert_subset(
        split_refs("|".join(row.get("linked_coverage_ids", "") for row in rows["judgment_unit_readiness.csv"])),
        coverage,
        "judgment_unit_readiness.linked_coverage_ids",
    )

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

    for row in rows["05_material_gaps.csv"]:
        label = f"05_material_gaps#{row.get('gap_id')}"
        assert_subset(split_refs(row.get("affected_judgment_unit_ids")), judgment_units, label + ".affected_judgment_unit_ids")
        if row.get("priority") and row.get("priority") not in PRIORITIES:
            fail(label + ".priority 必须为 high/medium/low")
        if not row.get("gap_description") or not row.get("impact_on_05"):
            fail(label + ".gap_description/impact_on_05 不得为空")

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


def _validate_counts(prep_meta: dict[str, object], summary_meta: dict[str, object], rows: dict[str, list[dict[str, str]]]) -> None:
    manifest_rows = rows["manifest.csv"]
    if len(manifest_rows) != 1:
        fail("manifest.csv 必须且只能有一行")
    manifest = manifest_rows[0]
    if manifest.get("snapshot_version") != "1.0.0" or manifest.get("snapshot_schema_version") != "1.0.0":
        fail("manifest snapshot_version 与 snapshot_schema_version 必须为 1.0.0")
    if manifest.get("display_data_candidates_ref") != "display_data_candidates.csv":
        fail("manifest.display_data_candidates_ref 必须为 display_data_candidates.csv")
    for field, expected in {
        "chart_data_package_ref": "chart_data_package.csv",
        "table_material_package_ref": "table_material_package.csv",
        "source_annotation_package_ref": "source_annotation_package.csv",
        "05_material_gaps_ref": "05_material_gaps.csv",
        "05_material_readiness_ref": "05_material_readiness.csv",
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

    unit_rows = rows["judgment_unit_readiness.csv"]
    counts = {value: 0 for value in ALLOWED_04_OUTPUTS}
    for row in unit_rows:
        output = row.get("allowed_04_output", "")
        validate_allowed_04_output(output, f"judgment_unit_readiness#{row.get('judgment_unit_id')}")
        counts[output] += 1
    count_fields = {
        "judgment_unit_total": len(unit_rows),
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
    require_schema_version(prep_meta["schema_version"], str(prep_path))
    require_schema_version(summary_meta["schema_version"], str(summary_path))
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
    assert_values([row.get("allowed_04_output", "") for row in rows["gaps_and_risks.csv"]], ALLOWED_04_OUTPUTS, "gaps_and_risks.allowed_04_output_after_gap")

    return {
        "schema_version": "1.0.0",
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
