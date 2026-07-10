#!/usr/bin/env python3
"""Validate 01 judgment-task outputs against the v1.0.0 template contract."""

from __future__ import annotations

import sys
from pathlib import Path

from quality_gate_utils import validate_gate_review_fields, validate_quality_status, validate_researcher_body, validate_return_routing_fields
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
    "quality_gate_ref",
    "deterministic_check_status",
    "semantic_review_status",
    "return_required",
    "return_stage",
    "user_confirmation",
    "original_input",
    "normalized_question",
    "judgment_landing",
    "task_type",
    "scope_summary",
]

REQUIRED_SECTIONS = [
    "研究需求确认",
    "研究目标与核心问题",
    "研究对象",
    "研究范围与边界",
    "已澄清的问题",
    "重点看什么",
    "初步线索：支持、削弱与反面情形",
    "工作假设",
    "研究边界提醒",
    "01 质量门槛检查",
]

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
    "judgment_unit_readiness.csv",
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


def validate(path: str | Path) -> dict[str, object]:
    path = Path(path)
    parse_triplet(path, "投研需求说明", stage="01")
    meta, body = parse_markdown(path)

    require_keys(meta, REQUIRED_META, str(path))
    require_schema_version(meta["schema_version"], str(path))
    if meta["document_type"] != "judgment_task":
        fail("document_type 必须为 judgment_task")
    if meta["status"] != "ready_for_matching":
        fail("01 正式投研需求说明 status 必须为 ready_for_matching")
    validate_quality_status(meta["quality_status"], str(path))
    validate_gate_review_fields(meta, str(path))
    validate_return_routing_fields(meta, str(path), current_stage="01")
    require_non_empty(meta["normalized_question"], "normalized_question")
    require_non_empty(meta["scope_summary"], "scope_summary")
    if not isinstance(meta["task_type"], dict) or not meta["task_type"].get("primary"):
        fail("task_type.primary 不得为空")
    _validate_user_confirmation(meta["user_confirmation"], str(path))

    require_body_sections(body, REQUIRED_SECTIONS, str(path))
    validate_researcher_body(body, str(path))
    full_text = path.read_text(encoding="utf-8-sig")
    for marker in FORBIDDEN_STAGE_MARKERS:
        if marker in full_text:
            fail(f"01 只保存自然语言需求，不得写入本体或下游阶段字段: {marker}")

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
