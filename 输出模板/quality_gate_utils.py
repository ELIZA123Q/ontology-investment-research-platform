#!/usr/bin/env python3
"""Quality-gate helpers shared by the output-template validators."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from validator_utils import fail


QUALITY_STATUSES = {
    "draft",
    "minimum_pass",
    "high_quality_pass",
    "return_required",
    "stop_with_gap_report",
}


ADMISSIONS = {
    "normal_pass",
    "restricted_pass",
    "incomplete_pass",
    "failed",
}


ALLOWED_04_OUTPUTS = {
    "full_reasoning_ready",
    "directional_only",
    "conditional_only",
    "insufficient",
    "blocked",
    "contested",
}

JUDGMENT_LANDINGS = {
    "状态定位",
    "趋势判断",
    "阶段切换",
    "影响强弱",
    "路径成立性",
    "假设验证与更新",
}

TASK_TYPES = {
    "状态与趋势判断",
    "事件或变化影响判断",
    "传导路径判断",
    "假设验证与更新判断",
}

DELIVERY_ARCHETYPES = {
    "event_commentary",
    "industry_dynamic_commentary",
    "industry_cycle_report",
    "company_earnings_commentary",
    "theme_deep_dive",
}

OVERSCOPE_STATUSES = {
    "pass",
    "needs_clarification",
    "split_required",
    "out_of_scope",
}

REJECTION_CATEGORIES = {
    "纯事实查询",
    "文本处理",
    "直接投资建议",
    "范围过大",
    "非投研判断",
    "未授权信息",
    "其他",
}

REJECTION_ROUTES = {
    "数据检索",
    "资料整理",
    "文本处理",
    "继续澄清",
    "拆分为多个投研判断任务",
    "改写为投研判断任务",
    "拒绝",
}

DETERMINISTIC_CHECK_STATUSES = {"not_checked", "checked", "failed"}
SEMANTIC_REVIEW_STATUSES = {"not_reviewed", "reviewed", "failed"}


def canonical_hash(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def validate_quality_status(value: Any, label: str) -> None:
    if str(value) not in QUALITY_STATUSES:
        fail(f"{label}.quality_status 非法: {value}")


def validate_gate_review_state(
    *,
    quality_status: Any,
    deterministic_check_status: Any,
    semantic_review_status: Any,
    label: str,
) -> None:
    validate_quality_status(quality_status, label)
    if str(deterministic_check_status) not in DETERMINISTIC_CHECK_STATUSES:
        fail(f"{label}.deterministic_check_status 非法: {deterministic_check_status}")
    if str(semantic_review_status) not in SEMANTIC_REVIEW_STATUSES:
        fail(f"{label}.semantic_review_status 非法: {semantic_review_status}")
    if str(quality_status) == "high_quality_pass":
        if str(deterministic_check_status) != "checked":
            fail(f"{label} high_quality_pass 必须 deterministic_check_status=checked")
        if str(semantic_review_status) != "reviewed":
            fail(f"{label} high_quality_pass 必须 semantic_review_status=reviewed")


def validate_admission(value: Any, label: str) -> None:
    if str(value) not in ADMISSIONS:
        fail(f"{label}.admission 非法: {value}")


def validate_allowed_04_output(value: Any, label: str) -> None:
    if str(value) not in ALLOWED_04_OUTPUTS:
        fail(f"{label}.allowed_04_output 非法: {value}")


def output_rank(value: str) -> int:
    return {
        "blocked": 0,
        "insufficient": 1,
        "contested": 1,
        "conditional_only": 2,
        "directional_only": 3,
        "full_reasoning_ready": 4,
    }.get(value, -1)
