#!/usr/bin/env python3
"""Validate 01 accepted judgment-task outputs against the current contract."""

from __future__ import annotations

import re
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "05_governance" / "03_校验"))
from repo_paths import ensure_run_path  # noqa: E402

ensure_run_path()

from quality_gate_utils import (  # noqa: E402
    DELIVERY_ARCHETYPES,
    JUDGMENT_LANDINGS,
    OVERSCOPE_STATUSES,
    TASK_TYPES,
    validate_gate_review_state,
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
    require_bool,
    require_keys,
    require_list,
    require_mapping,
    require_no_forbidden_phrases,
    require_no_placeholders,
    require_non_empty,
    require_string,
    as_version,
)
from status_derivation import reject_manual_derived_fields


REQUIRED_META = [
    "document_type",
    "schema_version",
    "task_id",
    "requirement_version",
    "generated_at",
    "stage_status",
    "task_disposition",
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

SHARED_REQUIRED_META = [
    "main_judgment_axis",
    "research_value_gate",
    "overscope_check",
    "needs_split",
]

CURRENT_SCHEMA_VERSION = "1.5.0"
LEGACY_SCHEMA_VERSIONS = {"1.1.0", "1.2.0", "1.3.0", "1.4.0"}
SUPPORTED_SCHEMA_VERSIONS = LEGACY_SCHEMA_VERSIONS | {CURRENT_SCHEMA_VERSION}
MODERN_SCHEMA_VERSIONS = {"1.4.0", CURRENT_SCHEMA_VERSION}
INPUT_RESOLUTION_MODES = {"direct_extract", "inherited_context", "user_clarified"}
REQUIRED_CONFIRMATION_TOPICS = {
    "core_object",
    "event_scope_and_time_window",
    "delivery_landing",
}

REQUIRED_SECTIONS = [
    "研究目标、核心问题与最终要回答的问题",
    "研究对象与判断起点",
    "研究价值检查",
    "研究范围与边界",
    "关键歧义校验",
    "核心观察维度",
    "初步线索：支持、削弱、反证与竞争解释",
    "下游交接说明",
    "01 质量门槛检查",
]

SHARED_ADDITIONAL_SECTIONS = ["核心研究主线与范围收敛"]
LEGACY_INPUT_SECTION = "用户交互确认"
CURRENT_INPUT_SECTION = "输入解析与系统理解"
LEGACY_PREMISE_SECTION = "必要假设"
CURRENT_PREMISE_SECTION = "前提与假设"

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
    "证据画像",
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
        fail(f"{label} 过于空泛，不能作为核心研究主线")
    if "全链" in stripped and label.endswith(".object"):
        fail(f"{label} 不能只写全链或全产业链，必须收敛到主对象或主环节")
    require_no_forbidden_phrases(stripped, VAGUE_PROBLEM_PHRASES, label)
    return text


def _validate_main_judgment_axis(axis: object, *, schema_version: str) -> None:
    axis = require_mapping(axis, "main_judgment_axis")
    required_keys = [
        "object",
        "judgment_action",
        "primary_channel",
        "key_question",
        "expected_05_landing",
        "non_core_axes",
    ]
    if schema_version in MODERN_SCHEMA_VERSIONS:
        required_keys.insert(1, "comparison_scope")
    require_keys(axis, required_keys, "main_judgment_axis")
    _reject_vague_axis_value(axis["object"], "main_judgment_axis.object")
    if schema_version in MODERN_SCHEMA_VERSIONS:
        comparison = require_string(axis["comparison_scope"], "main_judgment_axis.comparison_scope", min_length=2)
        if re.sub(r"\s+", "", comparison) in {"待定", "TBD", "N/A", "无"}:
            fail("main_judgment_axis.comparison_scope 须写清比较对象，或显式写「无比较」")
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


def _validate_time_scope(value: object) -> None:
    scope = require_mapping(value, "time_scope")
    require_keys(scope, ["lookback", "as_of", "forward"], "time_scope")
    for field in ["lookback", "as_of", "forward"]:
        require_string(scope[field], f"time_scope.{field}", min_length=2)


def _validate_delivery_depth(value: object) -> None:
    depth = require_mapping(value, "delivery_depth")
    require_keys(depth, ["conclusion_granularity", "minimum_delivery"], "delivery_depth")
    for field in ["conclusion_granularity", "minimum_delivery"]:
        require_string(depth[field], f"delivery_depth.{field}", min_length=4)


def _validate_task_scope_contract(value: object) -> None:
    contract = require_mapping(value, "task_scope_contract")
    require_keys(
        contract,
        [
            "root_scope_ref",
            "required_split_scope_refs",
            "comparison_policy",
            "prohibited_aggregation_outcomes",
        ],
        "task_scope_contract",
    )
    require_string(contract["root_scope_ref"], "task_scope_contract.root_scope_ref")
    splits = require_list(contract["required_split_scope_refs"], "task_scope_contract.required_split_scope_refs")
    for index, item in enumerate(splits, 1):
        require_string(item, f"task_scope_contract.required_split_scope_refs[{index}]")
    require_allowed(
        contract["comparison_policy"],
        {"allow_unified_if_supported", "differentiated_allowed", "differentiated_required"},
        "task_scope_contract.comparison_policy",
    )
    prohibited = require_list(
        contract["prohibited_aggregation_outcomes"],
        "task_scope_contract.prohibited_aggregation_outcomes",
        allow_empty=True,
    )
    for index, item in enumerate(prohibited, 1):
        require_allowed(
            item,
            {"synchronized", "dominant", "differentiated", "insufficient"},
            f"task_scope_contract.prohibited_aggregation_outcomes[{index}]",
        )


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
    if ready_status == "complete" and status != "pass":
        fail("stage_status=complete 的 01 产物必须 overscope_check.status=pass")
    if status == "pass" and "不适用" in {str(item) for item in check["broadness_flags"]}:
        fail("overscope_check.status=pass 时 broadness_flags 不得包含“不适用”")
    if require_bool(needs_split, "needs_split"):
        fail("needs_split=true 时不得生成 stage_status=complete 的投研需求说明")


def _validate_research_value_gate(value: object, *, ready_status: str) -> None:
    gate = require_mapping(value, "research_value_gate")
    require_keys(
        gate,
        [
            "status",
            "value_level",
            "disagreement_or_unknown",
            "changing_variable",
            "asset_or_decision_impact_path",
            "decision_use",
            "why_now",
            "incremental_question",
            "low_value_reason",
        ],
        "research_value_gate",
    )
    status = require_allowed(
        gate["status"],
        {"pass", "needs_clarification", "low_value"},
        "research_value_gate.status",
    )
    level = require_allowed(
        gate["value_level"],
        {"high", "medium", "low"},
        "research_value_gate.value_level",
    )
    for field in [
        "disagreement_or_unknown",
        "changing_variable",
        "asset_or_decision_impact_path",
        "decision_use",
        "why_now",
        "incremental_question",
    ]:
        require_string(gate[field], f"research_value_gate.{field}", min_length=4)
    if not isinstance(gate["low_value_reason"], str):
        fail("research_value_gate.low_value_reason 必须是字符串")
    if ready_status == "complete" and (status != "pass" or level == "low"):
        fail("stage_status=complete 必须通过研究价值检查，且 value_level 不得为 low")


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


def _require_iso8601_with_timezone(value: object, label: str) -> None:
    require_string(value, label)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as exc:
        fail(f"{label} 不是合法 ISO 8601: {exc}")
    if parsed.tzinfo is None:
        fail(f"{label} 必须包含时区")


def _validate_legacy_user_confirmation(meta: dict[str, object]) -> None:
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
        fail("stage_status=complete 必须 user_confirmation.confirmation_status=confirmed")
    _require_iso8601_with_timezone(confirmation["confirmed_at"], "user_confirmation.confirmed_at")

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


def _validate_input_resolution(meta: dict[str, object]) -> None:
    require_keys(meta, ["input_resolution"], "01 front matter")
    resolution = require_mapping(meta["input_resolution"], "input_resolution")
    require_keys(
        resolution,
        [
            "mode",
            "status",
            "source_refs",
            "system_understanding",
            "rollback_assumptions",
            "clarifications",
            "unresolved_structural_ambiguities",
        ],
        "input_resolution",
    )
    mode = require_allowed(resolution["mode"], INPUT_RESOLUTION_MODES, "input_resolution.mode")
    if resolution["status"] != "resolved":
        fail("stage_status=complete 必须 input_resolution.status=resolved")

    source_refs = require_list(resolution["source_refs"], "input_resolution.source_refs")
    for index, source_ref in enumerate(source_refs, 1):
        require_string(source_ref, f"input_resolution.source_refs[{index}]", min_length=3)

    understanding = require_mapping(resolution["system_understanding"], "input_resolution.system_understanding")
    understanding_fields = [
        "core_object",
        "judgment_action",
        "time_window",
        "scope_boundary",
        "delivery_landing",
    ]
    require_keys(understanding, understanding_fields, "input_resolution.system_understanding")
    for field in understanding_fields:
        require_string(understanding[field], f"input_resolution.system_understanding.{field}", min_length=2)

    assumptions = require_list(
        resolution["rollback_assumptions"],
        "input_resolution.rollback_assumptions",
        allow_empty=True,
    )
    for index, value in enumerate(assumptions, 1):
        assumption = require_mapping(value, f"input_resolution.rollback_assumptions[{index}]")
        require_keys(assumption, ["assumption", "basis", "rollback_trigger"], f"input_resolution.rollback_assumptions[{index}]")
        for field in ["assumption", "basis", "rollback_trigger"]:
            require_string(assumption[field], f"input_resolution.rollback_assumptions[{index}].{field}", min_length=2)

    clarifications = require_list(
        resolution["clarifications"],
        "input_resolution.clarifications",
        allow_empty=True,
    )
    if mode == "user_clarified" and not clarifications:
        fail("input_resolution.mode=user_clarified 时必须记录至少一条真实澄清")
    if mode != "user_clarified" and clarifications:
        fail("未通过本轮用户澄清完成解析时，input_resolution.clarifications 必须为空")
    seen_ids: set[str] = set()
    for index, value in enumerate(clarifications, 1):
        clarification = require_mapping(value, f"input_resolution.clarifications[{index}]")
        require_keys(
            clarification,
            ["question_id", "topic", "question", "answer", "answered_at"],
            f"input_resolution.clarifications[{index}]",
        )
        question_id = require_string(
            clarification["question_id"],
            f"input_resolution.clarifications[{index}].question_id",
        )
        if question_id in seen_ids:
            fail(f"input_resolution.clarifications.question_id 重复: {question_id}")
        seen_ids.add(question_id)
        require_string(clarification["topic"], f"input_resolution.clarifications[{index}].topic", min_length=2)
        require_string(clarification["question"], f"input_resolution.clarifications[{index}].question", min_length=6)
        require_string(clarification["answer"], f"input_resolution.clarifications[{index}].answer", min_length=2)
        _require_iso8601_with_timezone(
            clarification["answered_at"],
            f"input_resolution.clarifications[{index}].answered_at",
        )

    unresolved = require_list(
        resolution["unresolved_structural_ambiguities"],
        "input_resolution.unresolved_structural_ambiguities",
        allow_empty=True,
    )
    if unresolved:
        fail("stage_status=complete 的 input_resolution.unresolved_structural_ambiguities 必须为空")


def _validate_schema_and_input_resolution(meta: dict[str, object]) -> str:
    version = as_version(meta["schema_version"])
    if version not in SUPPORTED_SCHEMA_VERSIONS:
        fail(
            f"schema_version 必须为 {CURRENT_SCHEMA_VERSION}；"
            f"历史文件可使用 {', '.join(sorted(LEGACY_SCHEMA_VERSIONS))}"
        )
    if version == "1.1.0":
        _validate_legacy_user_confirmation(meta)
    else:
        _validate_input_resolution(meta)
    return version


def validate(path: str | Path) -> dict[str, object]:
    path = Path(path)
    parse_triplet(path, "投研需求说明", "01")
    meta, body = parse_markdown(path)
    try:
        reject_manual_derived_fields(meta, "01")
    except ValueError as exc:
        fail(str(exc))

    require_keys(meta, REQUIRED_META, str(path))
    schema_version = _validate_schema_and_input_resolution(meta)
    require_keys(meta, SHARED_REQUIRED_META, str(path))
    if meta["document_type"] != "judgment_task":
        fail("document_type 必须为 judgment_task")
    if meta["stage_status"] != "complete":
        fail("01 正式投研需求说明 stage_status 必须为 complete")
    validate_stage_status(meta["stage_status"], str(path))
    if meta["task_disposition"] != "accepted":
        fail("01 正式投研需求说明 task_disposition 必须为 accepted")
    validate_task_disposition(meta["task_disposition"], str(path))
    validate_gate_review_state(
        quality_status=meta["quality_status"],
        deterministic_check_status=meta["deterministic_check_status"],
        semantic_review_status=meta["semantic_review_status"],
        label=str(path),
    )
    if meta["quality_status"] == "draft":
        fail("stage_status=complete 的正式 01 产物不得为 draft")
    if meta["return_required"] is not False:
        fail("stage_status=complete 的正式 01 产物 return_required 必须为 false")
    if meta.get("return_stage") not in {None, "null", ""}:
        fail("return_required=false 时 return_stage 应为空")
    require_non_empty(meta["normalized_question"], "normalized_question")
    require_non_empty(meta["scope_summary"], "scope_summary")
    require_no_forbidden_phrases(str(meta["normalized_question"]), VAGUE_PROBLEM_PHRASES, "normalized_question")
    _validate_task_and_delivery(meta)
    if not isinstance(meta["intended_use"], list) or not meta["intended_use"]:
        fail("intended_use 必须是非空列表")
    if not isinstance(meta["not_allowed_use"], list) or not meta["not_allowed_use"]:
        fail("not_allowed_use 必须是非空列表")
    if "trading_recommendation" not in meta["not_allowed_use"]:
        fail("not_allowed_use 必须包含 trading_recommendation")
    _validate_main_judgment_axis(meta["main_judgment_axis"], schema_version=schema_version)
    if schema_version in MODERN_SCHEMA_VERSIONS:
        require_keys(meta, ["time_scope", "delivery_depth"], str(path))
        _validate_time_scope(meta["time_scope"])
        _validate_delivery_depth(meta["delivery_depth"])
    if schema_version == CURRENT_SCHEMA_VERSION:
        require_keys(meta, ["task_scope_contract"], str(path))
        _validate_task_scope_contract(meta["task_scope_contract"])
    _validate_research_value_gate(meta["research_value_gate"], ready_status=str(meta["stage_status"]))
    _validate_overscope_check(meta["overscope_check"], ready_status=str(meta["stage_status"]), needs_split=meta["needs_split"])
    require_no_placeholders(meta, str(path) + " front matter")

    required_sections = list(REQUIRED_SECTIONS)
    required_sections.extend(SHARED_ADDITIONAL_SECTIONS)
    required_sections.append(LEGACY_INPUT_SECTION if schema_version == "1.1.0" else CURRENT_INPUT_SECTION)
    required_sections.append(
        CURRENT_PREMISE_SECTION if schema_version in MODERN_SCHEMA_VERSIONS else LEGACY_PREMISE_SECTION
    )
    require_body_sections(body, required_sections, str(path))
    require_no_placeholders(body, str(path) + " body")
    required_phrases = ["支持、削弱、反证与竞争解释", "质量结论"]
    required_phrases.extend(["核心研究主线", "范围过宽检查"])
    required_phrases.append("研究价值检查")
    if schema_version in MODERN_SCHEMA_VERSIONS:
        required_phrases.extend(["已知事实", "用户假设", "待验证假设", "结论粒度", "最低交付要求"])
    for required_phrase in required_phrases:
        if required_phrase not in body:
            fail(f"{path} 正文必须包含“{required_phrase}”")
    full_text = body + "\n" + str(meta)
    for marker in FORBIDDEN_STAGE_MARKERS:
        if marker in full_text:
            fail(f"01 只保存自然语言需求，不得写入本体或下游阶段字段: {marker}")

    result = {
        "schema_version": schema_version,
        "document_type": meta["document_type"],
        "task_id": meta["task_id"],
        "stage_status": meta["stage_status"],
        "task_disposition": meta["task_disposition"],
        "quality_status": meta["quality_status"],
        "overscope_status": meta["overscope_check"]["status"],
    }
    if schema_version != "1.1.0":
        result["input_resolution_mode"] = meta["input_resolution"]["mode"]
    return result


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
