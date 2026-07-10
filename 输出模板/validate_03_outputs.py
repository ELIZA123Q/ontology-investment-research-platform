#!/usr/bin/env python3
"""Validate 03 data/evidence preparation and frozen snapshot outputs."""

from __future__ import annotations

import sys
from pathlib import Path

from quality_gate_utils import (
    ALLOWED_04_OUTPUTS,
    validate_admission,
    validate_admission_search_consistency,
    validate_allowed_04_output,
    validate_core_ju_publish_baseline,
    validate_gate_review_fields,
    validate_quality_status,
    validate_researcher_body,
    validate_return_action,
    validate_return_routing_fields,
    validate_search_status,
    validate_upstream_quality_gate,
)
from validate_05_materials import validate_05_materials
from validator_utils import (
    assert_subset,
    assert_values,
    error_payload,
    fail,
    file_name,
    load_yaml_file,
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
    "source_registry_version",
    "recipe_library_version",
    "snapshot_ref",
    "snapshot_summary_ref",
    "preparation_status",
    "quality_status",
    "quality_gate_ref",
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
    "return_required",
    "return_stage",
]

REQUIRED_PREP_SECTIONS = [
    "本次范围",
    "研究基线",
    "需要哪些证据",
    "来源与取数方式",
    "数据如何处理与归类",
    "各结论的证据把握",
    "证据覆盖情况",
    "证据评估结论",
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


def _expected_header(file_name_: str) -> list[str]:
    return read_csv_header(TEMPLATE_DIR / file_name_)


def _validate_upstream_02(prep_meta: dict[str, object], prep_path: Path) -> None:
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


def _validate_return_actions(rows: dict[str, list[dict[str, str]]]) -> None:
    for row in rows["judgment_unit_readiness.csv"]:
        action = row.get("return_action", "none")
        validate_return_action(action, f"judgment_unit_readiness#{row.get('judgment_unit_id')}")
    for row in rows["gaps_and_risks.csv"]:
        action = row.get("return_action", "none")
        validate_return_action(action, f"gaps_and_risks#{row.get('gap_id')}")


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
    inputs = ref_set(rows["reasoning_inputs.csv"], "input_id", "reasoning_inputs.csv")
    evidence = ref_set(rows["evidence_records.csv"], "evidence_id", "evidence_records.csv")
    coverage = ref_set(rows["state_variable_coverage.csv"], "coverage_id", "state_variable_coverage.csv")
    gaps = ref_set(rows["gaps_and_risks.csv"], "gap_id", "gaps_and_risks.csv", allow_empty=True)
    judgment_units = ref_set(rows["judgment_unit_readiness.csv"], "judgment_unit_id", "judgment_unit_readiness.csv")

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


def _validate_counts(prep_meta: dict[str, object], summary_meta: dict[str, object], rows: dict[str, list[dict[str, str]]]) -> None:
    manifest_rows = rows["manifest.csv"]
    if len(manifest_rows) != 1:
        fail("manifest.csv 必须且只能有一行")
    manifest = manifest_rows[0]
    if manifest.get("snapshot_version") != "1.0.0" or manifest.get("snapshot_schema_version") != "1.0.0":
        fail("manifest snapshot_version 与 snapshot_schema_version 必须为 1.0.0")

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
    prep_triplet = parse_triplet(prep_path, "数据与证据准备", stage="03")
    dir_triplet = parse_triplet(snapshot_dir, "数据与证据快照", stage="03")
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
    validate_search_status(prep_meta["search_status"], str(prep_path))
    validate_search_status(summary_meta["search_status"], str(summary_path))
    validate_allowed_04_output(prep_meta["allowed_04_output"], str(prep_path))
    validate_return_routing_fields(prep_meta, str(prep_path), current_stage="03")
    require_body_sections(prep_body, REQUIRED_PREP_SECTIONS, str(prep_path))
    validate_researcher_body(prep_body, str(prep_path))

    _validate_upstream_02(prep_meta, prep_path)

    if not same_ref(prep_meta["snapshot_ref"], f"{snapshot_dir.name}/manifest.csv"):
        fail("preparation.snapshot_ref 必须指向快照目录 manifest.csv")
    if not same_ref(prep_meta["snapshot_summary_ref"], f"{snapshot_dir.name}/{file_name(summary_path)}"):
        fail("preparation.snapshot_summary_ref 必须指向快照摘要")

    _validate_headers(snapshot_dir)
    rows = _rows(snapshot_dir)
    _validate_counts(prep_meta, summary_meta, rows)
    _validate_snapshot_refs(rows)
    _validate_return_actions(rows)

    manifest = rows["manifest.csv"][0]
    validate_return_routing_fields(manifest, "manifest", current_stage="03")
    validate_admission_search_consistency(prep_meta, summary_meta, manifest)
    validate_gate_review_fields(manifest, "manifest")
    validate_core_ju_publish_baseline(
        rows["judgment_unit_readiness.csv"],
        admission=manifest["admission"],
        quality_status=manifest["quality_status"],
        label="manifest",
    )
    validate_core_ju_publish_baseline(
        rows["judgment_unit_readiness.csv"],
        admission=prep_meta["admission"],
        quality_status=prep_meta["quality_status"],
        label=str(prep_path),
    )
    validate_core_ju_publish_baseline(
        rows["judgment_unit_readiness.csv"],
        admission=summary_meta["admission"],
        quality_status=summary_meta["quality_status"],
        label=str(summary_path),
    )
    if not same_ref(manifest["task_id"], prep_meta["task_id"]):
        fail("manifest.task_id 与 preparation.task_id 不一致")
    if not same_ref(manifest["execution_id"], prep_meta["execution_id"]):
        fail("manifest.execution_id 与 preparation.execution_id 不一致")
    assert_values([row.get("allowed_04_output", "") for row in rows["path_readiness.csv"]], ALLOWED_04_OUTPUTS, "path_readiness.allowed_04_output")
    assert_values([row.get("allowed_04_output", "") for row in rows["gaps_and_risks.csv"]], ALLOWED_04_OUTPUTS, "gaps_and_risks.allowed_04_output_after_gap")

    material_summary = validate_05_materials(
        snapshot_dir,
        quality_status=manifest["quality_status"],
        label="05_material_readiness",
    )

    return {
        "schema_version": "1.0.0",
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
