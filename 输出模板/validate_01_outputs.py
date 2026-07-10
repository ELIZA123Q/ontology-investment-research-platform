#!/usr/bin/env python3
"""Validate 01 accepted judgment-task outputs against the current contract."""

from __future__ import annotations

import re
import sys
from datetime import datetime
from pathlib import Path

from quality_gate_utils import (
    DELIVERY_ARCHETYPES,
    JUDGMENT_LANDINGS,
    OVERSCOPE_STATUSES,
    TASK_TYPES,
    validate_gate_review_state,
)
from validator_utils import (
    error_payload,
    fail,
    ok_payload,
    parse_markdown,
    parse_triplet,
    require_allowed,
    require_body_sections,
    require_bool,
    require_keys,
    require_list,
    require_mapping,
    require_no_forbidden_phrases,
    require_no_placeholders,
    require_non_empty,
    require_schema_version,
    require_string,
    as_version,
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
    "quality_gate_ref",
    "deterministic_check_status",
    "semantic_review_status",
    "return_required",
    "return_stage",
    "original_input",
    "normalized_question",
    "judgment_landing",
    "task_type",
    "delivery_archetype",
    "intended_use",
    "not_allowed_use",
    "scope_summary",
]

CURRENT_REQUIRED_META = ["user_confirmation", "main_judgment_axis", "overscope_check", "needs_split"]

CURRENT_SCHEMA_VERSION = "1.1.0"
LEGACY_SCHEMA_VERSION = "1.0.0"
INTERACTION_GATE_EFFECTIVE_AT = datetime.fromisoformat("2026-07-10T00:00:00+08:00")
REQUIRED_CONFIRMATION_TOPICS = {
    "core_object",
    "event_scope_and_time_window",
    "delivery_landing",
}

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

INTERACTION_REQUIRED_SECTIONS = ["用户交互确认", "主判断轴与范围收敛"]

REQUIRED_CONFIRMATION_TOPICS = {
    "core_object",
    "event_scope_and_time_window",
    "delivery_landing",
}


def _validate_user_confirmation(value: object, label: str) -> None:
    if not isinstance(value, dict):
        fail(f"{label}.user_confirmation 必须是对象")
    require_keys(
        value,
        ["status", "confirmed_at", "timezone", "required_question_count", "questions"],
        f"{label}.user_confirmation",
    )
    if value["status"] != "confirmed":
        fail(f"{label}.user_confirmation.status 必须为 confirmed")
    require_non_empty(value["confirmed_at"], "user_confirmation.confirmed_at")
    require_non_empty(value["timezone"], "user_confirmation.timezone")
    try:
        required_count = int(value["required_question_count"])
    except Exception:
        fail("user_confirmation.required_question_count 必须为整数")
    if required_count < 3:
        fail("user_confirmation.required_question_count 不得少于 3")
    questions = value["questions"]
    if not isinstance(questions, list) or len(questions) < 3:
        fail("user_confirmation.questions 至少需要 3 组真实问答")
    topics: set[str] = set()
    for index, item in enumerate(questions, 1):
        if not isinstance(item, dict):
            fail(f"user_confirmation.questions[{index}] 必须是对象")
        require_keys(item, ["topic", "question", "answer"], f"user_confirmation.questions[{index}]")
        require_non_empty(item["question"], f"user_confirmation.questions[{index}].question")
        require_non_empty(item["answer"], f"user_confirmation.questions[{index}].answer")
        topics.add(str(item["topic"]).strip())
    missing = sorted(REQUIRED_CONFIRMATION_TOPICS - topics)
    if missing:
        fail("user_confirmation 缺少必需确认主题: " + ", ".join(missing))

FORBIDDEN_STAGE_MARKERS = [
    "source_02_view_hash",
    "coverage_id",
    "evidence_readiness_assessments.csv",
    "allowed_04_output",
    "schema_name: task_ontology_view",
    "ontology_ref",
    "ontology_sources",
    "object_type",
    "relation_type",
    "StateVariable",
    "evidence_profile",
    "propagation_template",
    "inference_rule",
    "本体",
    "证据 profile",
    "传导模板",
    "推理规则",
]

VAGUE_PROBLEM_PHRASES = [
    "综合影响",
    "全面影响",
    "整体影响",
    "全链分析",
    "全面分析",
    "系统分析",
    "相关板块",
    "相关产业",
]

VAGUE_AXIS_EXACT = {
    "综合影响",
    "全面影响",
    "整体影响",
    "全链分析",
    "全面分析",
    "整体判断",
    "全链",
    "全产业链",
    "相关板块",
    "相关产业",
    "怎么看",
    "有什么影响",
}

MULTI_CHANNEL_PATTERNS = [
    re.compile(r"(情绪|风险偏好).*(实物流|供给|成本|业绩|估值|政策)"),
    re.compile(r"(实物流|供给|成本|业绩|估值|政策).*(情绪|风险偏好)"),
]

JUDGMENT_ACTION_MARKERS = {
    "状态定位": ("状态", "定位", "处于"),
    "趋势判断": ("趋势", "方向", "斜率", "持续"),
    "阶段切换": ("阶段", "切换", "见顶", "反转", "正常化"),
    "影响强弱": ("影响", "强弱", "显著", "冲击"),
    "路径成立性": ("路径", "传导", "机制", "成立"),
    "假设验证与更新": ("假设", "验证", "更新", "修正"),
}


def _reject_vague_axis_value(value: object, label: str) -> str:
    text = require_string(value, label)
    stripped = re.sub(r"\s+", "", text)
    if stripped in VAGUE_AXIS_EXACT:
        fail(f"{label} 过于空泛，不能作为主判断轴")
    if "全链" in stripped and label.endswith(".object"):
        fail(f"{label} 不能只写全链或全产业链，必须收敛到主对象或主环节")
    require_no_forbidden_phrases(stripped, VAGUE_PROBLEM_PHRASES, label)
    return text


def _validate_main_judgment_axis(axis: object) -> None:
    axis = require_mapping(axis, "main_judgment_axis")
    require_keys(
        axis,
        ["object", "judgment_action", "primary_channel", "key_question", "expected_05_landing", "non_core_axes"],
        "main_judgment_axis",
    )
    _reject_vague_axis_value(axis["object"], "main_judgment_axis.object")
    action = _reject_vague_axis_value(axis["judgment_action"], "main_judgment_axis.judgment_action")
    if action not in JUDGMENT_LANDINGS and not any(
        any(marker in action for marker in markers) for markers in JUDGMENT_ACTION_MARKERS.values()
    ):
        fail("main_judgment_axis.judgment_action 必须能映射到状态、趋势、阶段、影响、路径或假设更新之一")
    channel = _reject_vague_axis_value(axis["primary_channel"], "main_judgment_axis.primary_channel")
    for pattern in MULTI_CHANNEL_PATTERNS:
        if pattern.search(channel):
            fail("main_judgment_axis.primary_channel 同时包含情绪/实物流/政策/业绩等多条主线，必须收敛为一个主通道")
    key_question = _reject_vague_axis_value(axis["key_question"], "main_judgment_axis.key_question")
    if not any(marker in key_question for marker in ["是否", "处于", "在什么条件", "哪些信息", "何时", "多大程度"]):
        fail("main_judgment_axis.key_question 必须写成可验证、可反证的问题")
    _reject_vague_axis_value(axis["expected_05_landing"], "main_judgment_axis.expected_05_landing")
    non_core_axes = require_list(axis["non_core_axes"], "main_judgment_axis.non_core_axes", allow_empty=True)
    for index, item in enumerate(non_core_axes, 1):
        require_string(item, f"main_judgment_axis.non_core_axes[{index}]")


def _validate_overscope_check(value: object, *, ready_status: str, needs_split: object) -> None:
    check = require_mapping(value, "overscope_check")
    require_keys(
        check,
        [
            "status",
            "reason",
            "broadness_flags",
            "alternative_subquestions",
            "excluded_paths",
            "allowed_secondary_axes",
        ],
        "overscope_check",
    )
    status = require_allowed(check["status"], OVERSCOPE_STATUSES, "overscope_check.status")
    require_string(check["reason"], "overscope_check.reason", min_length=8)
    for field in ["broadness_flags", "alternative_subquestions", "excluded_paths", "allowed_secondary_axes"]:
        values = require_list(check[field], f"overscope_check.{field}", allow_empty=True)
        for index, item in enumerate(values, 1):
            require_string(item, f"overscope_check.{field}[{index}]")
    if ready_status == "ready_for_matching" and status != "pass":
        fail("ready_for_matching 的 01 产物必须 overscope_check.status=pass")
    if status == "pass" and "不适用" in {str(item) for item in check["broadness_flags"]}:
        fail("overscope_check.status=pass 时 broadness_flags 不得包含“不适用”")
    if require_bool(needs_split, "needs_split"):
        fail("needs_split=true 时不得生成 ready_for_matching 的投研需求说明")


def _validate_task_and_delivery(meta: dict[str, object]) -> None:
    require_allowed(meta["judgment_landing"], JUDGMENT_LANDINGS, "judgment_landing")
    task_type = require_mapping(meta["task_type"], "task_type")
    require_allowed(task_type.get("primary"), TASK_TYPES, "task_type.primary")
    for index, value in enumerate(require_list(task_type.get("secondary", []), "task_type.secondary", allow_empty=True), 1):
        require_allowed(value, TASK_TYPES, f"task_type.secondary[{index}]")

    archetype = require_mapping(meta["delivery_archetype"], "delivery_archetype")
    require_allowed(archetype.get("primary"), DELIVERY_ARCHETYPES, "delivery_archetype.primary")
    for list_field in ["secondary", "modules"]:
        values = require_list(archetype.get(list_field, []), f"delivery_archetype.{list_field}", allow_empty=True)
        if list_field == "secondary":
            for index, value in enumerate(values, 1):
                require_allowed(value, DELIVERY_ARCHETYPES, f"delivery_archetype.secondary[{index}]")


def _validate_schema_and_user_confirmation(meta: dict[str, object]) -> str:
    version = as_version(meta["schema_version"])
    if version not in {LEGACY_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION}:
        fail(f"schema_version 必须为 {CURRENT_SCHEMA_VERSION}；仅允许门禁生效前的 {LEGACY_SCHEMA_VERSION} 历史产物兼容")

    if version == LEGACY_SCHEMA_VERSION:
        try:
            generated_at = datetime.fromisoformat(str(meta["generated_at"]).replace("Z", "+00:00"))
        except ValueError as exc:
            fail(f"历史 01 generated_at 不是合法 ISO 8601: {exc}")
        if generated_at.tzinfo is None:
            fail("历史 01 generated_at 必须包含时区")
        if generated_at >= INTERACTION_GATE_EFFECTIVE_AT:
            fail(f"{INTERACTION_GATE_EFFECTIVE_AT.isoformat()} 起生成的 01 必须使用 schema_version={CURRENT_SCHEMA_VERSION} 并完成用户交互确认")
        return version

    require_keys(meta, ["user_confirmation"], "01 front matter")
    confirmation = require_mapping(meta["user_confirmation"], "user_confirmation")
    require_keys(
        confirmation,
        ["interaction_mode", "confirmation_status", "confirmed_at", "questions"],
        "user_confirmation",
    )
    if confirmation["interaction_mode"] != "user_dialogue":
        fail("user_confirmation.interaction_mode 必须为 user_dialogue，不得以系统推断或默认值替代")
    if confirmation["confirmation_status"] != "confirmed":
        fail("ready_for_matching 必须 user_confirmation.confirmation_status=confirmed")
    require_string(confirmation["confirmed_at"], "user_confirmation.confirmed_at")
    try:
        confirmed_at = datetime.fromisoformat(str(confirmation["confirmed_at"]).replace("Z", "+00:00"))
    except ValueError as exc:
        fail(f"user_confirmation.confirmed_at 不是合法 ISO 8601: {exc}")
    if confirmed_at.tzinfo is None:
        fail("user_confirmation.confirmed_at 必须包含时区")

    questions = require_list(confirmation["questions"], "user_confirmation.questions")
    if len(questions) < 3:
        fail("user_confirmation.questions 至少包含三项真实用户问答")
    seen_topics: set[str] = set()
    seen_ids: set[str] = set()
    for index, item in enumerate(questions, 1):
        question = require_mapping(item, f"user_confirmation.questions[{index}]")
        require_keys(question, ["question_id", "topic", "question", "answer"], f"user_confirmation.questions[{index}]")
        question_id = require_string(question["question_id"], f"user_confirmation.questions[{index}].question_id")
        topic = require_string(question["topic"], f"user_confirmation.questions[{index}].topic")
        require_string(question["question"], f"user_confirmation.questions[{index}].question", min_length=6)
        require_string(question["answer"], f"user_confirmation.questions[{index}].answer", min_length=2)
        if question_id in seen_ids:
            fail(f"user_confirmation.questions.question_id 重复: {question_id}")
        seen_ids.add(question_id)
        seen_topics.add(topic)
    missing_topics = REQUIRED_CONFIRMATION_TOPICS - seen_topics
    if missing_topics:
        fail(f"user_confirmation 缺少必需确认主题: {', '.join(sorted(missing_topics))}")
    return version


def validate(path: str | Path) -> dict[str, object]:
    path = Path(path)
    parse_triplet(path, "投研需求说明", "01")
    meta, body = parse_markdown(path)

    require_keys(meta, REQUIRED_META, str(path))
    schema_version = _validate_schema_and_user_confirmation(meta)
    if schema_version == CURRENT_SCHEMA_VERSION:
        require_keys(meta, CURRENT_REQUIRED_META, str(path))
    if meta["document_type"] != "judgment_task":
        fail("document_type 必须为 judgment_task")
    if meta["status"] != "ready_for_matching":
        fail("01 正式投研需求说明 status 必须为 ready_for_matching")
    validate_gate_review_state(
        quality_status=meta["quality_status"],
        deterministic_check_status=meta["deterministic_check_status"],
        semantic_review_status=meta["semantic_review_status"],
        label=str(path),
    )
    if meta["quality_status"] == "draft":
        fail("ready_for_matching 的正式 01 产物不得为 draft")
    if meta["return_required"] is not False:
        fail("ready_for_matching 的正式 01 产物 return_required 必须为 false")
    if meta.get("return_stage") not in {None, "null", ""}:
        fail("return_required=false 时 return_stage 应为空")
    require_non_empty(meta["normalized_question"], "normalized_question")
    require_non_empty(meta["scope_summary"], "scope_summary")
    require_no_forbidden_phrases(str(meta["normalized_question"]), VAGUE_PROBLEM_PHRASES, "normalized_question")
    if schema_version == CURRENT_SCHEMA_VERSION:
        _validate_task_and_delivery(meta)
    if not isinstance(meta["intended_use"], list) or not meta["intended_use"]:
        fail("intended_use 必须是非空列表")
    if not isinstance(meta["not_allowed_use"], list) or not meta["not_allowed_use"]:
        fail("not_allowed_use 必须是非空列表")
    if "trading_recommendation" not in meta["not_allowed_use"]:
        fail("not_allowed_use 必须包含 trading_recommendation")
    if schema_version == CURRENT_SCHEMA_VERSION:
        _validate_main_judgment_axis(meta["main_judgment_axis"])
        _validate_overscope_check(meta["overscope_check"], ready_status=str(meta["status"]), needs_split=meta["needs_split"])
    require_no_placeholders(meta, str(path) + " front matter")

    required_sections = list(REQUIRED_SECTIONS)
    if schema_version == CURRENT_SCHEMA_VERSION:
        required_sections.extend(INTERACTION_REQUIRED_SECTIONS)
    require_body_sections(body, required_sections, str(path))
    require_no_placeholders(body, str(path) + " body")
    required_phrases = ["支持、削弱、反证与竞争解释", "质量结论"]
    if schema_version == CURRENT_SCHEMA_VERSION:
        required_phrases.extend(["主判断轴", "范围过宽检查"])
    for required_phrase in required_phrases:
        if required_phrase not in body:
            fail(f"{path} 正文必须包含“{required_phrase}”")
    full_text = body + "\n" + str(meta)
    for marker in FORBIDDEN_STAGE_MARKERS:
        if marker in full_text:
            fail(f"01 只保存自然语言需求，不得写入本体或下游阶段字段: {marker}")

    return {
        "schema_version": schema_version,
        "document_type": meta["document_type"],
        "task_id": meta["task_id"],
        "status": meta["status"],
        "quality_status": meta["quality_status"],
        "overscope_status": meta.get("overscope_check", {}).get("status", "legacy_not_recorded"),
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
