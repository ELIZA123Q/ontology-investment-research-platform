#!/usr/bin/env python3
"""Validate 01 out-of-scope rejection notices against the v1.0.0 contract."""

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
    "generated_at",
    "status",
    "status_reason",
    "quality_status",
    "original_input",
    "out_of_scope_category",
    "can_be_rewritten",
    "recommended_route",
]

REQUIRED_SECTIONS = [
    "原始输入",
    "不予受理原因",
    "可行改写方向",
    "建议转交流程",
    "质量检查",
]


def validate(path: str | Path) -> dict[str, object]:
    path = Path(path)
    parse_triplet(path, "不予受理说明")
    meta, body = parse_markdown(path)

    require_keys(meta, REQUIRED_META, str(path))
    require_schema_version(meta["schema_version"], str(path))
    if meta["document_type"] != "judgment_task_rejection":
        fail("document_type 必须为 judgment_task_rejection")
    if meta["status"] != "out_of_scope":
        fail("不予受理说明 status 必须为 out_of_scope")
    validate_quality_status(meta["quality_status"], str(path))
    require_non_empty(meta["status_reason"], "status_reason")
    require_non_empty(meta["recommended_route"], "recommended_route")
    require_body_sections(body, REQUIRED_SECTIONS, str(path))

    return {
        "schema_version": "1.0.0",
        "document_type": meta["document_type"],
        "status": meta["status"],
    }


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: validate_01_rejection.py <不予受理说明.md>")
        return 2
    try:
        print(ok_payload(**validate(argv[1])))
        return 0
    except Exception as exc:
        print(error_payload(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
