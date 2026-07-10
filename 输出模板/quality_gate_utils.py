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

DETERMINISTIC_CHECK_STATUSES = {"not_checked", "checked", "failed"}
SEMANTIC_REVIEW_STATUSES = {"not_reviewed", "reviewed", "failed"}

SEARCH_STATUSES = {
    "threshold_met",
    "source_tiers_exhausted",
    "in_progress",
    "blocked_by_access",
}

PASSING_ADMISSIONS = {"normal_pass", "restricted_pass"}


ADMISSIONS = {
    "normal_pass",
    "restricted_pass",
    "incomplete_pass",
    "failed",
}


JUDGMENT_LEVELS = {"J0", "J1", "J2", "J3", "J4"}
JUDGMENT_LABELS = {
    "J0": "暂不可判断",
    "J1": "观察",
    "J2": "方向判断",
    "J3": "高概率",
    "J4": "确认",
}
REASONING_READINESS = {"full_reasoning_ready", "restricted_reasoning_ready", "insufficient"}
CLAIM_MODES = {"unconditional", "conditional"}
JUDGMENT_STATUSES = {"normal", "weakened", "contested"}
PATH_STATUSES = {"active", "blocked"}
TARGET_CLAIM_TYPES = {
    "historical_fact",
    "current_state",
    "causal_inference",
    "directional_outlook",
    "forecast",
    "conditional_scenario",
}
J4_ELIGIBLE_CLAIM_TYPES = {"historical_fact", "current_state"}
SOURCE_AUTHORITY_LEVELS = {
    "primary",
    "authoritative_secondary",
    "informed_secondary",
    "indirect",
    "unknown",
}

CORE_JU_PUBLISH_FLOOR = "J2"

RETURN_STAGES = ("01", "02", "03", "04", "05")

RETURN_ACTIONS = {
    "none",
    "continue_in_stage",
    "return_01",
    "return_02",
    "return_03",
    "return_04",
    "return_05",
    "stop_with_gap_report",
}

MATERIAL_READINESS_STATUSES = {
    "report_grade_ready",
    "draft_ready",
    "insufficient",
    "blocked",
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


def validate_judgment_level(value: Any, label: str) -> None:
    if str(value) not in JUDGMENT_LEVELS:
        fail(f"{label}.judgment_level 非法: {value}")


def judgment_level_rank(value: str) -> int:
    return {"J0": 0, "J1": 1, "J2": 2, "J3": 3, "J4": 4}.get(value, -1)


def validate_target_claim_level(target_claim_type: Any, level: Any, label: str) -> None:
    target = str(target_claim_type)
    if target not in TARGET_CLAIM_TYPES:
        fail(f"{label}.target_claim_type 非法: {target_claim_type}")
    validate_judgment_level(level, label)
    if str(level) == "J4" and target not in J4_ELIGIBLE_CLAIM_TYPES:
        fail(f"{label}: {target} 属于推断或前瞻主张，不得达到 J4")


def validate_orthogonal_states(
    *,
    reasoning_readiness: Any,
    claim_mode: Any,
    judgment_status: Any,
    label: str,
) -> None:
    if str(reasoning_readiness) not in REASONING_READINESS:
        fail(f"{label}.reasoning_readiness 非法: {reasoning_readiness}")
    if str(claim_mode) not in CLAIM_MODES:
        fail(f"{label}.claim_mode 非法: {claim_mode}")
    if str(judgment_status) not in JUDGMENT_STATUSES:
        fail(f"{label}.judgment_status 非法: {judgment_status}")


RESEARCHER_BODY_MARKERS = [
    "judgment_unit_id",
    "question_id |",
    "state_variable_id",
    "requirement_id |",
    "path_readiness",
    "maximum_judgment_level",
    "actual_judgment_level",
    "expression_judgment_level",
    "二元开关",
    "定向且可执行",
    "定向可执行",
    "逻辑失效条件",
    "反面证据要求",
    "路径就绪",
    "包级准入",
    "判断单元",
    "状态变量",
    "路径节点",
    "竞争解释",
    "改判闸门",
    "可执行跟踪",
]

RESEARCHER_BODY_STOP_MARKERS = (
    "质量门槛检查",
    "进入 03 前质量检查",
    "进入 04 前质量检查",
)


def researcher_body_text(body: str) -> str:
    text = body
    for marker in RESEARCHER_BODY_STOP_MARKERS:
        idx = text.find(marker)
        if idx != -1:
            text = text[:idx]
    return text


def validate_researcher_body(body: str, label: str) -> None:
    """Ensure markdown narrative reads like researcher deliverables, not machine dumps."""
    narrative = researcher_body_text(body)
    for marker in RESEARCHER_BODY_MARKERS:
        if marker in narrative:
            fail(f"{label} 正文不得包含机器字段或内部术语: {marker}")


def meets_core_ju_publish_floor(value: str) -> bool:
    return judgment_level_rank(value) >= judgment_level_rank(CORE_JU_PUBLISH_FLOOR)


def validate_core_ju_publish_baseline(
    judgment_unit_rows: list[dict[str, str]],
    *,
    admission: Any,
    quality_status: Any,
    label: str,
) -> None:
    if str(quality_status) != "high_quality_pass":
        return
    if not judgment_unit_rows:
        fail(f"{label}: judgment_unit_readiness.csv 为空，无法校验核心判断单元发布底线")

    levels: list[str] = []
    for row in judgment_unit_rows:
        ju_id = row.get("judgment_unit_id", "")
        level = str(row.get("maximum_judgment_level", ""))
        validate_judgment_level(level, f"{label} judgment_unit_readiness#{ju_id}")
        levels.append(level)

    admission_text = str(admission)
    if admission_text not in PASSING_ADMISSIONS:
        return

    if not any(meets_core_ju_publish_floor(level) for level in levels):
        fail(
            f"{label}: quality_status=high_quality_pass 且 admission={admission_text} 时，"
            "至少 1 个核心判断单元 maximum_judgment_level 必须达到 J2 及以上"
        )
