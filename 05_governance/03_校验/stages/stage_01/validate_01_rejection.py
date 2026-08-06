#!/usr/bin/env python3
"""Validate 01 out-of-scope / split-required rejection notices."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "05_governance" / "03_校验"))
from repo_paths import ensure_run_path  # noqa: E402

ensure_run_path()

from quality_gate_utils import (  # noqa: E402
    REJECTION_CATEGORIES,
    REJECTION_ROUTES,
    validate_quality_status,
    validate_stage_status,
    validate_task_disposition,
)
from validator_utils import (
    error_payload,
    fail,
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
    require_string,
)


REQUIRED_META = [
    "document_type",
    "schema_version",
    "generated_at",
    "stage_status",
    "task_disposition",
    "status_reason",
    "quality_status",
    "quality_gate_ref",
    "original_input",
    "out_of_scope_category",
    "can_be_rewritten",
    "recommended_route",
    "overscope_or_split_handling",
]

REQUIRED_SECTIONS = [
    "原始输入",
    "不予受理原因",
    "可行改写方向",
    "范围过大或需要拆题时的处理",
    "建议转交流程",
    "质量检查",
]

REJECTION_DISPOSITIONS = {"out_of_scope", "split_required"}
CURRENT_SCHEMA_VERSION = "1.1.0"


def _validate_overscope_or_split(meta: dict[str, object]) -> None:
    handling = require_mapping(meta["overscope_or_split_handling"], "overscope_or_split_handling")
    require_keys(handling, ["is_overscope", "reason", "recommended_main_axes"], "overscope_or_split_handling")
    is_overscope = require_boolish(handling["is_overscope"], "overscope_or_split_handling.is_overscope")
    axes = require_list(handling["recommended_main_axes"], "overscope_or_split_handling.recommended_main_axes", allow_empty=True)
    if is_overscope or meta["out_of_scope_category"] == "范围过大" or meta["task_disposition"] == "split_required":
        require_string(handling["reason"], "overscope_or_split_handling.reason", min_length=8)
        if not axes:
            fail("范围过大或需要拆题的不予受理说明必须给出 recommended_main_axes")
    for index, axis in enumerate(axes, 1):
        require_string(axis, f"overscope_or_split_handling.recommended_main_axes[{index}]", min_length=8)


def validate(path: str | Path) -> dict[str, object]:
    path = Path(path)
    parse_triplet(path, "不予受理说明", "01")
    meta, body = parse_markdown(path)

    require_keys(meta, REQUIRED_META, str(path))
    require_schema_version(meta["schema_version"], str(path), expected=CURRENT_SCHEMA_VERSION)
    if meta["document_type"] != "judgment_task":
        fail("不予受理说明 document_type 必须沿用 judgment_task")
    if meta["stage_status"] != "complete":
        fail("不予受理说明 stage_status 必须为 complete（处置已完成，不等于进入 02）")
    validate_stage_status(meta["stage_status"], str(path))
    require_allowed(meta["task_disposition"], REJECTION_DISPOSITIONS, "task_disposition")
    validate_task_disposition(meta["task_disposition"], str(path))
    validate_quality_status(meta["quality_status"], str(path))
    if meta["quality_status"] == "minimum_pass":
        fail("不予受理说明 quality_status 不使用 minimum_pass")
    require_non_empty(meta["status_reason"], "status_reason")
    require_allowed(meta["out_of_scope_category"], REJECTION_CATEGORIES, "out_of_scope_category")
    require_boolish(meta["can_be_rewritten"], "can_be_rewritten")
    require_allowed(meta["recommended_route"], REJECTION_ROUTES, "recommended_route")
    require_non_empty(meta["recommended_route"], "recommended_route")
    _validate_overscope_or_split(meta)
    require_no_placeholders(meta, str(path) + " front matter")
    require_body_sections(body, REQUIRED_SECTIONS, str(path))
    require_no_placeholders(body, str(path) + " body")
    for required_phrase in ["是否可验证、可被反面证据推翻", "是否有明确对象和范围", "可拆出的研究问题", "质量结论"]:
        if required_phrase not in body:
            fail(f"{path} 正文必须说明“{required_phrase}”")

    return {
        "schema_version": str(meta["schema_version"]),
        "document_type": meta["document_type"],
        "stage_status": meta["stage_status"],
        "task_disposition": meta["task_disposition"],
        "quality_status": meta["quality_status"],
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
