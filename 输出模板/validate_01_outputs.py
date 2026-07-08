#!/usr/bin/env python3
"""Validate 01 judgment-task outputs against the v1.0.0 template contract."""

from __future__ import annotations

import sys
from pathlib import Path

from quality_gate_utils import validate_quality_status
from validator_utils import (
    error_payload,
    fail,
    ok_payload,
    parse_markdown,
    parse_triplet,
    require_body_sections,
    require_keys,
    require_non_empty,
    require_schema_version,
)


REQUIRED_META = [
    "document_type",
    "schema_version",
    "task_id",
    "requirement_version",
    "generated_at",
    "status",
    "status_reason",
    "quality_status",
    "original_input",
    "normalized_question",
    "judgment_landing",
    "task_type",
    "scope_summary",
]

REQUIRED_SECTIONS = [
    "研究目标、核心问题与判断落点",
    "研究对象与判断起点",
    "研究范围与边界",
    "关键歧义校验",
    "核心观察维度",
    "初步线索：支持、削弱、反证与竞争解释",
    "必要假设",
    "下游交接说明",
    "01 质量门槛检查",
]

FORBIDDEN_STAGE_MARKERS = [
    "source_02_view_hash",
    "coverage_id",
    "judgment_unit_readiness.csv",
    "allowed_04_output",
    "schema_name: task_ontology_view",
]


def validate(path: str | Path) -> dict[str, object]:
    path = Path(path)
    parse_triplet(path, "投研需求说明")
    meta, body = parse_markdown(path)

    require_keys(meta, REQUIRED_META, str(path))
    require_schema_version(meta["schema_version"], str(path))
    if meta["document_type"] != "judgment_task":
        fail("document_type 必须为 judgment_task")
    if meta["status"] != "ready_for_matching":
        fail("01 正式投研需求说明 status 必须为 ready_for_matching")
    validate_quality_status(meta["quality_status"], str(path))
    require_non_empty(meta["normalized_question"], "normalized_question")
    require_non_empty(meta["scope_summary"], "scope_summary")
    if not isinstance(meta["task_type"], dict) or not meta["task_type"].get("primary"):
        fail("task_type.primary 不得为空")

    require_body_sections(body, REQUIRED_SECTIONS, str(path))
    for marker in FORBIDDEN_STAGE_MARKERS:
        if marker in body:
            fail(f"01 不得提前写入下游阶段字段或产物引用: {marker}")

    return {
        "schema_version": "1.0.0",
        "document_type": meta["document_type"],
        "task_id": meta["task_id"],
        "status": meta["status"],
    }


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: validate_01_outputs.py <投研需求说明.md>")
        return 2
    try:
        print(ok_payload(**validate(argv[1])))
        return 0
    except Exception as exc:
        print(error_payload(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
