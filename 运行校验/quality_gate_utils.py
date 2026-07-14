#!/usr/bin/env python3
"""Quality-gate helpers shared by the output-template validators."""

from __future__ import annotations

from typing import Any

from status_derivation import (
    EVIDENCE_GRADES,
    JUDGMENT_LEVELS,
    STAGE_STATUSES,
    TASK_DISPOSITIONS,
    canonical_evidence_grade,
)
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
DRAFTABLE_DOCUMENT_STATUSES = {"draft", "complete", "published"}

SEARCH_STATUSES = {
    "threshold_met",
    "source_tiers_exhausted",
    "in_progress",
    "blocked_by_access",
}

EVIDENCE_ROLES = {
    "primary_support",
    "cross_validation",
    "counter_evidence",
    "blocking_condition",
    "proxy_indicator",
    "background_evidence",
}
REQUIREMENT_PURPOSES = {"support", "weaken", "block", "validate", "cross_validate", "counter", "background"}
QUALITY_LEVELS = EVIDENCE_GRADES
SOURCE_TIERS = {"S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"}

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

DELIVERY_READINESS_STATUSES = {"ready", "partially_ready", "not_ready"}

DELIVERY_DIMENSION_STATUSES = {"ready", "partial", "missing", "not_applicable"}

DELIVERY_REQUIRED_ACTIONS = {
    "none",
    "return_03",
    "continue_in_stage",
    "adjust_report_type",
    "downgrade_delivery",
}

UPSTREAM_BLOCKING_QUALITY = {"draft", "return_required", "stop_with_gap_report"}

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

def is_nullish(value: Any) -> bool:
    if value is None:
        return True
    return str(value).strip().lower() in {"", "null", "none", "~"}


def normalize_return_required(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"true", "1", "yes"}


def stage_sort_key(stage: str) -> int:
    return {"01": 0, "02": 1, "03": 2, "04": 3, "05": 4}.get(stage, 9)


def validate_return_action(value: Any, label: str) -> None:
    text = str(value).strip()
    if not text or text in RETURN_ACTIONS:
        return
    fail(f"{label}.return_action 非法: {value}")


def validate_return_routing_fields(
    meta: dict[str, Any], label: str, *, current_stage: str
) -> str | None:
    if "return_required" not in meta:
        fail(f"{label} 必须记录 return_required")
    required = normalize_return_required(meta.get("return_required"))
    return_stage = meta.get("return_stage")
    if required:
        if is_nullish(return_stage):
            fail(f"{label}: return_required=true 时必须填写 return_stage")
        stage_text = str(return_stage).strip()
        if stage_text not in RETURN_STAGES:
            fail(f"{label}.return_stage 非法: {return_stage}")
        if stage_text == current_stage:
            fail(f"{label}: return_stage 不得等于当前阶段 {current_stage}")
        return stage_text
    if not is_nullish(return_stage):
        fail(f"{label}: return_required=false 时 return_stage 必须为 null")
    return None


def validate_upstream_quality_gate(
    upstream_meta: dict[str, Any],
    *,
    upstream_label: str,
    downstream_label: str,
    default_return_stage: str,
) -> None:
    quality_status = str(upstream_meta.get("quality_status", ""))
    if quality_status in UPSTREAM_BLOCKING_QUALITY or normalize_return_required(upstream_meta.get("return_required")):
        return_stage = upstream_meta.get("return_stage") or default_return_stage
        fail(f"{downstream_label} 不得在上游 {upstream_label} 未通过时继续；应退回 {return_stage}")


def validate_quality_status(value: Any, label: str) -> None:
    if str(value) not in QUALITY_STATUSES:
        fail(f"{label}.quality_status 非法: {value}")


def validate_stage_status(value: Any, label: str) -> None:
    if str(value) not in STAGE_STATUSES:
        fail(f"{label}.stage_status 非法: {value}")


def validate_task_disposition(value: Any, label: str) -> None:
    if str(value) not in TASK_DISPOSITIONS:
        fail(f"{label}.task_disposition 非法: {value}")


def validate_evidence_grade(value: Any, label: str) -> str:
    try:
        return canonical_evidence_grade(value)
    except ValueError as exc:
        fail(f"{label}: {exc}")


def validate_search_status(value: Any, label: str) -> None:
    if str(value) not in SEARCH_STATUSES:
        fail(f"{label}.search_status 非法: {value}")


def validate_gate_review_state(
    *,
    quality_status: Any,
    deterministic_check_status: Any,
    semantic_review_status: Any = None,
    label: str,
) -> None:
    validate_quality_status(quality_status, label)
    if str(deterministic_check_status) not in DETERMINISTIC_CHECK_STATUSES:
        fail(f"{label}.deterministic_check_status 非法: {deterministic_check_status}")
    if semantic_review_status is not None and str(semantic_review_status) not in SEMANTIC_REVIEW_STATUSES:
        fail(f"{label}.semantic_review_status 非法: {semantic_review_status}")
    if str(quality_status) == "high_quality_pass":
        if str(deterministic_check_status) != "checked":
            fail(f"{label} high_quality_pass 必须 deterministic_check_status=checked")


def validate_gate_review_fields(meta: dict[str, Any], label: str) -> None:
    quality_status = meta.get("quality_status")
    deterministic = meta.get("deterministic_check_status")
    semantic = meta.get("semantic_review_status")
    if str(quality_status) == "high_quality_pass" and deterministic is None:
        fail(f"{label} high_quality_pass 必须记录 deterministic_check_status")
    if deterministic is not None:
        validate_gate_review_state(
            quality_status=quality_status,
            deterministic_check_status=deterministic,
            semantic_review_status=semantic,
            label=label,
        )


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
