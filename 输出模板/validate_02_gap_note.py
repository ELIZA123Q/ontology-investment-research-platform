#!/usr/bin/env python3
"""Validate optional 02 ontology gap notes against the v1.0.0 template contract."""

from __future__ import annotations

import sys
from pathlib import Path

from quality_gate_utils import validate_quality_status
from validator_utils import (
    error_payload,
    fail,
    file_name,
    ok_payload,
    parse_markdown,
    parse_triplet,
    require_body_sections,
    require_keys,
    require_non_empty,
    require_schema_version,
    same_ref,
)


REQUIRED_META = [
    "document_type",
    "schema_version",
    "task_id",
    "view_id",
    "logic_document",
    "source_view",
    "generated_at",
    "gap_ids",
    "highest_severity",
    "blocks_evidence_preparation",
    "blocks_directional_reasoning",
    "candidate_used",
    "affects_quality_status",
    "status",
]

REQUIRED_SECTIONS = [
    "缺口摘要",
    "缺失判断能力",
    "为什么判断为本体缺口",
    "对本次研究的影响与临时处理",
    "是否影响进入 03 和 04",
    "需要本体维护者进一步判断的问题",
    "质量检查",
]

SEVERITIES = {"low", "medium", "high", "blocking"}
GAP_STATUSES = {"open", "resolved", "deferred"}
AFFECTS_QUALITY = {"none", "minimum_pass_only", "return_required"}


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
    require_schema_version(meta["schema_version"], str(gap_path))
    if meta["document_type"] != "ontology_gap_note":
        fail("document_type 必须为 ontology_gap_note")
    if str(meta["status"]) not in GAP_STATUSES:
        fail("status 非法")
    if str(meta["highest_severity"]) not in SEVERITIES:
        fail("highest_severity 非法")
    if str(meta["affects_quality_status"]) not in AFFECTS_QUALITY:
        fail("affects_quality_status 非法")
    require_non_empty(meta["task_id"], "task_id")
    require_non_empty(meta["view_id"], "view_id")
    require_non_empty(meta["logic_document"], "logic_document")
    require_non_empty(meta["source_view"], "source_view")
    if not isinstance(meta["gap_ids"], list):
        fail("gap_ids 必须是数组")

    require_body_sections(body, REQUIRED_SECTIONS, str(gap_path))
    if logic_path is not None and not same_ref(meta["logic_document"], file_name(logic_path)):
        fail("logic_document 必须指向配对研究逻辑文件")
    if view_path is not None and not same_ref(meta["source_view"], file_name(view_path)):
        fail("source_view 必须指向配对本体视图文件")

    return {
        "schema_version": "1.0.0",
        "document_type": meta["document_type"],
        "task_id": meta["task_id"],
        "view_id": meta["view_id"],
        "gap_count": len(meta["gap_ids"]),
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
