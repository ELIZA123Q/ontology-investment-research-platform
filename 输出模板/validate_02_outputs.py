#!/usr/bin/env python3
"""Validate 02 research-logic and ontology-view outputs."""

from __future__ import annotations

import sys
from pathlib import Path

from quality_gate_utils import ALLOWED_04_OUTPUTS, validate_quality_status
from validator_utils import (
    assert_subset,
    assert_values,
    error_payload,
    fail,
    file_name,
    load_yaml_file,
    ok_payload,
    parse_markdown,
    parse_triplet,
    ref_set,
    require_body_sections,
    require_keys,
    require_non_empty,
    require_schema_version,
    same_ref,
    split_refs,
)


REQUIRED_LOGIC_META = [
    "document_type",
    "schema_version",
    "task_id",
    "logic_id",
    "generated_at",
    "source_document",
    "ontology_view_ref",
    "framework_library_ref",
    "framework_library_version",
    "stage_status",
    "quality_status",
    "judgment_spine",
]

REQUIRED_LOGIC_SECTIONS = [
    "研究问题与判断边界",
    "最小问题树与分析顺序",
    "主路径、反证和竞争解释",
    "对象分化与比较口径",
    "关键判断单元与最低验证条件",
    "本体承接与 03 交接",
    "进入 03 前质量检查",
]

REQUIRED_VIEW_TOP = [
    "schema_name",
    "schema_version",
    "task_context",
    "quality_control",
    "research_framework",
    "ontology_sources",
    "judgment_units",
    "path_design",
    "ontology_bindings",
    "instance_requirements",
    "evidence_requirements",
    "handoff_to_03",
    "validation",
]

SCHEMA_VERSION_02 = "1.1.0"
JUDGMENT_TYPES = {
    "industry_cycle_judgment",
    "policy_impact_judgment",
    "supply_chain_bottleneck_judgment",
    "company_earnings_elasticity_judgment",
    "valuation_rerating_judgment",
    "event_impact_judgment",
    "expectation_gap_judgment",
    "risk_monitoring_judgment",
}
EVIDENCE_ROLE_KEYS = {
    "primary_support",
    "cross_validation",
    "counter_evidence",
    "blocking_condition",
    "proxy_indicator",
    "background_evidence",
}
EVIDENCE_ROLE_STATUSES = {"required", "optional", "allowed_with_limit", "not_allowed", "not_applicable"}
EVIDENCE_ROLES = EVIDENCE_ROLE_KEYS
REQUIREMENT_PURPOSES = {"support", "weaken", "block", "validate", "cross_validate", "counter", "background"}
QUALITY_LEVELS = {"Q1_background", "Q2_reasoning_usable", "Q3_directional_ready", "Q4_report_grade"}
SOURCE_TIERS = {"L1", "L2", "L3", "L4", "L5", "L6", "L7", "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"}


def _validate_logic(logic_path: Path) -> tuple[dict[str, object], str]:
    meta, body = parse_markdown(logic_path)
    require_keys(meta, REQUIRED_LOGIC_META, str(logic_path))
    require_schema_version(meta["schema_version"], str(logic_path), expected=SCHEMA_VERSION_02)
    if meta["document_type"] != "research_logic":
        fail("02 研究逻辑 document_type 必须为 research_logic")
    if meta["stage_status"] != "aligned":
        fail("02 研究逻辑 stage_status 必须为 aligned")
    validate_quality_status(meta["quality_status"], str(logic_path))
    require_non_empty(meta["judgment_spine"], "judgment_spine")
    require_body_sections(body, REQUIRED_LOGIC_SECTIONS, str(logic_path))
    return meta, body


def _validate_view(view_path: Path) -> dict[str, object]:
    view = load_yaml_file(view_path)
    if not isinstance(view, dict):
        fail("02 本体视图必须是 YAML 对象")
    require_keys(view, REQUIRED_VIEW_TOP, str(view_path))
    require_schema_version(view["schema_version"], str(view_path), expected=SCHEMA_VERSION_02)
    if view["schema_name"] != "task_ontology_view":
        fail("02 本体视图 schema_name 必须为 task_ontology_view")

    task_context = view["task_context"]
    quality_control = view["quality_control"]
    research_framework = view["research_framework"]
    validation = view["validation"]
    for label, section in [
        ("task_context", task_context),
        ("quality_control", quality_control),
        ("research_framework", research_framework),
        ("validation", validation),
    ]:
        if not isinstance(section, dict):
            fail(f"{label} 必须是对象")

    require_keys(task_context, ["task_id", "view_id", "logic_id", "logic_document", "normalized_question", "scope"], "task_context")
    require_keys(quality_control, ["stage_status", "quality_status", "return_required"], "quality_control")
    if quality_control["stage_status"] != "aligned":
        fail("quality_control.stage_status 必须为 aligned")
    validate_quality_status(quality_control["quality_status"], "quality_control")

    checks = validation.get("checks")
    if not isinstance(checks, dict) or validation.get("result") != "pass":
        fail("validation.result 必须为 pass，validation.checks 必须存在")
    failed_checks = [key for key, value in checks.items() if value is not True]
    if failed_checks:
        fail("validation.checks 必须全部为 true: " + ", ".join(failed_checks))

    judgment_units = view["judgment_units"]
    if not isinstance(judgment_units, list) or not judgment_units:
        fail("judgment_units 至少需要一项")
    require_keys(research_framework, ["judgment_spine", "minimum_question_tree", "alignment_checks"], "research_framework")
    question_tree = research_framework["minimum_question_tree"]
    if not isinstance(question_tree, list) or not question_tree:
        fail("research_framework.minimum_question_tree 至少需要一项")
    question_ids = {str(item.get("question_id", "")).strip() for item in question_tree if isinstance(item, dict)}
    if not question_ids:
        fail("minimum_question_tree.question_id 不得为空")

    for index, unit in enumerate(judgment_units, 1):
        require_keys(
            unit,
            [
                "judgment_unit_id",
                "judgment_type",
                "statement",
                "linked_questions",
                "linked_paths",
                "required_evidence_roles",
                "required_evidence_categories",
                "required_counter_categories",
                "candidate_evidence_recipe_tags",
                "minimum_validation_conditions",
                "forbidden_shortcuts",
                "proxy_policy",
                "evidence_gap_policy",
                "minimum_verification_condition",
                "required_counter_checks",
                "downgrade_rule_if_not_met",
                "evidence_profile_refs",
            ],
            f"judgment_units[{index}]",
        )
        if str(unit["judgment_type"]) not in JUDGMENT_TYPES:
            fail(f"{unit['judgment_unit_id']}.judgment_type 非法")
        role_requirements = unit["required_evidence_roles"]
        if not isinstance(role_requirements, dict) or not role_requirements:
            fail(f"{unit['judgment_unit_id']}.required_evidence_roles 必须是非空对象")
        unknown_role_keys = sorted(set(role_requirements) - EVIDENCE_ROLE_KEYS)
        if unknown_role_keys:
            fail(f"{unit['judgment_unit_id']}.required_evidence_roles 存在非法角色: {', '.join(unknown_role_keys)}")
        invalid_role_statuses = sorted({str(value) for value in role_requirements.values() if str(value) not in EVIDENCE_ROLE_STATUSES})
        if invalid_role_statuses:
            fail(f"{unit['judgment_unit_id']}.required_evidence_roles 存在非法状态: {', '.join(invalid_role_statuses)}")
        for list_field in [
            "required_evidence_categories",
            "required_counter_categories",
            "candidate_evidence_recipe_tags",
            "minimum_validation_conditions",
            "forbidden_shortcuts",
        ]:
            if not isinstance(unit.get(list_field), list):
                fail(f"{unit['judgment_unit_id']}.{list_field} 必须是列表")
        assert_subset(split_refs(unit["linked_questions"]), question_ids, f"{unit['judgment_unit_id']}.linked_questions")
        assert_values([str(unit["downgrade_rule_if_not_met"])], ALLOWED_04_OUTPUTS, f"{unit['judgment_unit_id']}.downgrade_rule_if_not_met")

    judgment_unit_ids = ref_set(judgment_units, "judgment_unit_id", "judgment_units")

    path_design = view["path_design"]
    if not isinstance(path_design, dict) or not path_design.get("main_paths"):
        fail("path_design.main_paths 至少需要一项")
    path_ids: set[str] = set()
    node_ids: set[str] = set()
    for path in path_design["main_paths"]:
        require_keys(path, ["path_id", "name", "linked_judgment_units", "nodes"], "path_design.main_paths[]")
        path_ids.add(str(path["path_id"]))
        assert_subset(split_refs(path["linked_judgment_units"]), judgment_unit_ids, f"{path['path_id']}.linked_judgment_units")
        if not isinstance(path["nodes"], list) or not path["nodes"]:
            fail(f"{path['path_id']}.nodes 至少需要一项")
        for node in path["nodes"]:
            require_keys(node, ["node_id", "name", "role", "question"], f"{path['path_id']}.nodes[]")
            node_ids.add(str(node["node_id"]))

    for unit in judgment_units:
        assert_subset(split_refs(unit["linked_paths"]), path_ids, f"{unit['judgment_unit_id']}.linked_paths")

    evidence_requirements = view["evidence_requirements"]
    if not isinstance(evidence_requirements, list) or not evidence_requirements:
        fail("evidence_requirements 至少需要一项")
    for item in evidence_requirements:
        require_keys(
            item,
            [
                "evidence_requirement_id",
                "target_judgment_unit_id",
                "requirement_purpose",
                "evidence_role",
                "required_evidence_category",
                "required_content_domains",
                "required_object_scope",
                "required_time_scope",
                "required_grain",
                "minimum_quality_level",
                "minimum_source_tier",
                "minimum_independent_source_count",
                "mandatory_baskets",
                "counter_baskets",
                "allowed_proxy",
                "preferred_source_profiles",
                "allowed_acquisition_channels",
                "forbidden_sources",
                "required_freshness",
                "required_traceability",
                "required_comparability",
                "stop_condition",
                "missing_policy",
                "allowed_04_output_if_met",
                "allowed_04_output_if_missing",
            ],
            "evidence_requirements[]",
        )
        req_id = item["evidence_requirement_id"]
        assert_subset([str(item["target_judgment_unit_id"])], judgment_unit_ids, f"{req_id}.target_judgment_unit_id")
        if str(item["requirement_purpose"]) not in REQUIREMENT_PURPOSES:
            fail(f"{req_id}.requirement_purpose 非法")
        if str(item["evidence_role"]) not in EVIDENCE_ROLES:
            fail(f"{req_id}.evidence_role 非法")
        if str(item["minimum_quality_level"]) not in QUALITY_LEVELS:
            fail(f"{req_id}.minimum_quality_level 非法")
        if str(item["minimum_source_tier"]) not in SOURCE_TIERS:
            fail(f"{req_id}.minimum_source_tier 非法")
        try:
            if int(item["minimum_independent_source_count"]) < 0:
                fail(f"{req_id}.minimum_independent_source_count 必须为非负整数")
        except Exception:
            fail(f"{req_id}.minimum_independent_source_count 必须为非负整数")
        if not isinstance(item["allowed_proxy"], bool):
            fail(f"{req_id}.allowed_proxy 必须是布尔值")
        for list_field in [
            "required_content_domains",
            "mandatory_baskets",
            "counter_baskets",
            "preferred_source_profiles",
            "allowed_acquisition_channels",
            "forbidden_sources",
        ]:
            if not isinstance(item.get(list_field), list):
                fail(f"{req_id}.{list_field} 必须是列表")
        assert_values([str(item["allowed_04_output_if_met"]), str(item["allowed_04_output_if_missing"])], ALLOWED_04_OUTPUTS, f"{req_id}.allowed_04_output")

    return {
        "view": view,
        "judgment_unit_ids": judgment_unit_ids,
        "path_ids": path_ids,
        "node_ids": node_ids,
    }


def validate(logic_path: str | Path, view_path: str | Path) -> dict[str, object]:
    logic_path = Path(logic_path)
    view_path = Path(view_path)
    logic_triplet = parse_triplet(logic_path, "研究逻辑", "02")
    view_triplet = parse_triplet(view_path, "本体视图", "02")
    if logic_triplet != view_triplet:
        fail("02 研究逻辑与本体视图文件名核心主题、日期、序号必须一致")

    logic_meta, _ = _validate_logic(logic_path)
    view_result = _validate_view(view_path)
    view = view_result["view"]
    task_context = view["task_context"]

    if not same_ref(logic_meta["task_id"], task_context["task_id"]):
        fail("logic.task_id 与 view.task_context.task_id 不一致")
    if not same_ref(logic_meta["logic_id"], task_context["logic_id"]):
        fail("logic.logic_id 与 view.task_context.logic_id 不一致")
    if not same_ref(logic_meta["ontology_view_ref"], file_name(view_path)):
        fail("logic.ontology_view_ref 必须指向配对本体视图文件")
    if not same_ref(task_context["logic_document"], file_name(logic_path)):
        fail("view.task_context.logic_document 必须指向配对研究逻辑文件")

    return {
        "schema_version": SCHEMA_VERSION_02,
        "task_id": logic_meta["task_id"],
        "logic_id": logic_meta["logic_id"],
        "view_id": task_context["view_id"],
        "judgment_units": len(view_result["judgment_unit_ids"]),
        "paths": len(view_result["path_ids"]),
        "nodes": len(view_result["node_ids"]),
    }


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print("usage: validate_02_outputs.py <研究逻辑.md> <本体视图.yaml>")
        return 2
    try:
        print(ok_payload(**validate(argv[1], argv[2])))
        return 0
    except Exception as exc:
        print(error_payload(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
