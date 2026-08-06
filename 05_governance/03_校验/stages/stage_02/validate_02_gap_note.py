#!/usr/bin/env python3
"""Validate optional 02 ontology-gap notes against the v1.1.0 contract."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "05_governance" / "03_校验"))
from repo_paths import ensure_run_path  # noqa: E402

ensure_run_path()

from quality_gate_utils import validate_stage_status  # noqa: E402
from status_derivation import PATH_READINESS_STATUSES  # noqa: E402
from validator_utils import (  # noqa: E402
    error_payload,
    fail,
    file_name,
    ok_payload,
    parse_markdown,
    parse_triplet,
    require_allowed,
    require_body_sections,
    require_boolish,
    require_keys,
    require_list,
    require_mapping,
    require_no_placeholders,
    require_non_empty,
    require_schema_version,
    same_ref,
)


SCHEMA_VERSION = "1.2.0"
REQUIRED_META = [
    "document_type",
    "schema_version",
    "task_id",
    "view_id",
    "logic_document",
    "source_view",
    "ontology_gap_scan_ref",
    "generated_at",
    "gap_scan_status",
    "trigger_rules",
    "gap_ids",
    "highest_severity",
    "coverage_summary",
    "blocks_evidence_preparation",
    "blocks_directional_reasoning",
    "candidate_used",
    "can_enter_03",
    "path_readiness_status",
    "affects_quality_status",
    "stage_status",
]

REQUIRED_SECTIONS = [
    "缺口摘要",
    "缺口扫描触发依据",
    "缺失判断能力清单",
    "为什么判断为本体缺口",
    "对下游 03、04、05 的影响",
    "本次临时处理方式",
    "是否允许进入 03 和 04",
    "需要本体维护者判断的问题",
    "质量检查",
]

GAP_SCAN_STATUSES = {"no_gap", "minor_gap", "major_gap", "blocking_gap"}
SEVERITIES = {"minor", "major", "blocking"}
AFFECTS_QUALITY = {"none", "minimum_pass_only", "return_required"}


def _validate_count(value: object, label: str) -> None:
    try:
        count = int(value)
    except (TypeError, ValueError):
        fail(f"{label} 必须为非负整数")
    if count < 0:
        fail(f"{label} 必须为非负整数")


def validate(
    gap_path: str | Path,
    *,
    logic_path: str | Path | None = None,
    view_path: str | Path | None = None,
) -> dict[str, object]:
    gap_path = Path(gap_path)
    parse_triplet(gap_path, "本体缺口说明", stage="02")
    meta, body = parse_markdown(gap_path)

    require_keys(meta, REQUIRED_META, str(gap_path))
    require_schema_version(meta["schema_version"], str(gap_path), expected=SCHEMA_VERSION)
    if meta["document_type"] != "ontology_gap_note":
        fail("document_type 必须为 ontology_gap_note")
    require_allowed(meta["gap_scan_status"], GAP_SCAN_STATUSES, "gap_scan_status")
    validate_stage_status(meta["stage_status"], "02 gap note")
    require_allowed(meta["highest_severity"], SEVERITIES, "highest_severity")
    require_allowed(meta["affects_quality_status"], AFFECTS_QUALITY, "affects_quality_status")
    require_allowed(meta["path_readiness_status"], PATH_READINESS_STATUSES, "path_readiness_status")

    for field in ["task_id", "view_id", "logic_document", "source_view", "ontology_gap_scan_ref"]:
        require_non_empty(meta[field], field)
    if not require_list(meta["trigger_rules"], "trigger_rules"):
        fail("trigger_rules 至少需要一项")
    gap_ids = require_list(meta["gap_ids"], "gap_ids")
    if not gap_ids:
        fail("gap_ids 至少需要一项")

    coverage = require_mapping(meta["coverage_summary"], "coverage_summary")
    count_fields = ["direct_cover_count", "upper_cover_count", "weak_cover_count", "missing_count"]
    require_keys(coverage, count_fields, "coverage_summary")
    for field in count_fields:
        _validate_count(coverage[field], f"coverage_summary.{field}")

    for field in ["blocks_evidence_preparation", "blocks_directional_reasoning", "candidate_used"]:
        require_boolish(meta[field], field)
    can_enter = meta["can_enter_03"]
    if can_enter not in {True, False, "conditional"}:
        fail("can_enter_03 必须为 true、false 或 conditional")
    if meta["highest_severity"] == "blocking" and can_enter is not False:
        fail("highest_severity=blocking 时 can_enter_03 必须为 false")

    require_body_sections(body, REQUIRED_SECTIONS, str(gap_path))
    require_no_placeholders(meta, str(gap_path) + " front matter")
    require_no_placeholders(body, str(gap_path) + " body")
    if logic_path is not None and not same_ref(meta["logic_document"], file_name(logic_path)):
        fail("logic_document 必须指向配对研究逻辑文件")
    if view_path is not None and not same_ref(meta["source_view"], file_name(view_path)):
        fail("source_view 必须指向配对本体视图文件")

    return {
        "schema_version": SCHEMA_VERSION,
        "document_type": meta["document_type"],
        "task_id": meta["task_id"],
        "view_id": meta["view_id"],
        "gap_count": len(gap_ids),
        "status": meta["status"],
    }


def main(argv: list[str]) -> int:
    if len(argv) not in {2, 4}:
        print("usage: validate_02_gap_note.py <本体缺口说明.md> [<研究逻辑.md> <本体视图.yaml>]")
        return 2
    try:
        logic_path = argv[2] if len(argv) == 4 else None
        view_path = argv[3] if len(argv) == 4 else None
        print(ok_payload(**validate(argv[1], logic_path=logic_path, view_path=view_path)))
        return 0
    except Exception as exc:
        print(error_payload(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
