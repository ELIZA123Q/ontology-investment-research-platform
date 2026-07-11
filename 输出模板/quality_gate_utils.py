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

# 03—05 之间的材料准入状态。这组值仍是现有 CSV/YAML 合同的
# 正式字段；J0—J4 表示判断强度，两者不可互相替代。
ALLOWED_04_OUTPUTS = {
    "full_reasoning_ready",
    "directional_only",
    "conditional_only",
    "insufficient",
    "blocked",
    "contested",
}
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

MATERIAL_REQUIRED_ACTIONS = {
    "none",
    "return_03",
    "continue_in_stage",
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


def canonical_hash(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def validate_quality_status(value: Any, label: str) -> None:
    if str(value) not in QUALITY_STATUSES:
        fail(f"{label}.quality_status 非法: {value}")


def validate_search_status(value: Any, label: str) -> None:
    if str(value) not in SEARCH_STATUSES:
        fail(f"{label}.search_status 非法: {value}")


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


def validate_gate_review_fields(meta: dict[str, Any], label: str) -> None:
    quality_status = meta.get("quality_status")
    deterministic = meta.get("deterministic_check_status")
    semantic = meta.get("semantic_review_status")
    if str(quality_status) == "high_quality_pass" and (deterministic is None or semantic is None):
        fail(f"{label} high_quality_pass 必须记录 deterministic_check_status 与 semantic_review_status")
    if deterministic is not None and semantic is not None:
        validate_gate_review_state(
            quality_status=quality_status,
            deterministic_check_status=deterministic,
            semantic_review_status=semantic,
            label=label,
        )


def validate_admission_search_rules(admission: Any, search_status: Any, label: str) -> None:
    validate_admission(admission, label)
    validate_search_status(search_status, label)
    if str(search_status) == "blocked_by_access" and str(admission) in PASSING_ADMISSIONS:
        fail(f"{label}: 来源受阻时不得给出通过准入")
    if str(search_status) == "in_progress" and str(admission) in PASSING_ADMISSIONS:
        fail(f"{label}: 检索未完成时不得冻结通过准入")


def validate_admission_search_consistency(
    prep_meta: dict[str, Any], summary_meta: dict[str, Any], manifest: dict[str, Any]
) -> None:
    admissions = {str(item.get("admission")) for item in (prep_meta, summary_meta, manifest)}
    searches = {str(item.get("search_status")) for item in (prep_meta, summary_meta, manifest)}
    if len(admissions) != 1:
        fail("03 准备说明、摘要与清单的 admission 必须一致")
    if len(searches) != 1:
        fail("03 准备说明、摘要与清单的 search_status 必须一致")
    validate_admission_search_rules(prep_meta.get("admission"), prep_meta.get("search_status"), "03 admission/search_status")


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
    }.get(str(value), -1)


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
