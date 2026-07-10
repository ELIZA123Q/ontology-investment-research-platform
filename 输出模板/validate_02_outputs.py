#!/usr/bin/env python3
"""Validate 02 research-logic and ontology-view outputs."""

from __future__ import annotations

import sys
from pathlib import Path

from quality_gate_utils import ALLOWED_04_OUTPUTS, validate_gate_review_fields, validate_quality_status, validate_researcher_body, validate_return_routing_fields
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
    "quality_gate_ref",
    "judgment_spine",
]

REQUIRED_LOGIC_SECTIONS = [
    "研究问题与边界",
    "问题拆解与分析顺序",
    "主逻辑与其他可能",
    "细分差异与比较口径",
    "关键结论与证据要求",
    "证据准备说明",
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


def _validate_logic(logic_path: Path) -> tuple[dict[str, object], str]:
    meta, body = parse_markdown(logic_path)
    require_keys(meta, REQUIRED_LOGIC_META, str(logic_path))
    require_schema_version(meta["schema_version"], str(logic_path))
    if meta["document_type"] != "research_logic":
        fail("02 研究逻辑 document_type 必须为 research_logic")
    if meta["stage_status"] != "aligned":
        fail("02 研究逻辑 stage_status 必须为 aligned")
    validate_quality_status(meta["quality_status"], str(logic_path))
    require_non_empty(meta["judgment_spine"], "judgment_spine")
    require_body_sections(body, REQUIRED_LOGIC_SECTIONS, str(logic_path))
    validate_researcher_body(body, str(logic_path))
    return meta, body


def _validate_view(view_path: Path) -> dict[str, object]:
    view = load_yaml_file(view_path)
    if not isinstance(view, dict):
        fail("02 本体视图必须是 YAML 对象")
    require_keys(view, REQUIRED_VIEW_TOP, str(view_path))
    require_schema_version(view["schema_version"], str(view_path))
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
    require_keys(quality_control, ["stage_status", "quality_status", "quality_gate_ref", "return_required", "return_stage", "deterministic_check_status", "semantic_review_status"], "quality_control")
    if quality_control["stage_status"] != "aligned":
        fail("quality_control.stage_status 必须为 aligned")
    validate_gate_review_fields(quality_control, "quality_control")
    validate_return_routing_fields(quality_control, "quality_control", current_stage="02")

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
                "statement",
                "linked_questions",
                "linked_paths",
                "minimum_verification_condition",
                "required_counter_checks",
                "downgrade_rule_if_not_met",
                "evidence_profile_refs",
            ],
            f"judgment_units[{index}]",
        )
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
        require_keys(item, ["evidence_requirement_id", "linked_judgment_units", "evidence_profile", "minimum_standard"], "evidence_requirements[]")
        assert_subset(split_refs(item["linked_judgment_units"]), judgment_unit_ids, f"{item['evidence_requirement_id']}.linked_judgment_units")
        if "downgrade_if_missing" in item:
            assert_values([str(item["downgrade_if_missing"])], ALLOWED_04_OUTPUTS, f"{item['evidence_requirement_id']}.downgrade_if_missing")

    if checks.get("state_variable_chain_complete") is True:
        ontology_bindings = view.get("ontology_bindings")
        if not isinstance(ontology_bindings, dict):
            fail("state_variable_chain_complete=true 时 ontology_bindings 必须是对象")
        selected_state_variables = ontology_bindings.get("selected_state_variables")
        if not isinstance(selected_state_variables, list) or not selected_state_variables:
            fail("state_variable_chain_complete=true 时 selected_state_variables 不得为空")
        for index, item in enumerate(selected_state_variables, 1):
            if not isinstance(item, dict):
                fail(f"selected_state_variables[{index}] 必须是对象")
            var_id = str(item.get("state_variable_id", "")).strip() or f"index-{index}"
            label = f"selected_state_variables#{var_id}"
            require_non_empty(item.get("state_variable_id"), f"{label}.state_variable_id")
            require_non_empty(item.get("name"), f"{label}.name")
            for field in [
                "linked_judgment_units",
                "linked_path_nodes",
                "state_binding_refs",
                "observation_requirement_refs",
                "evidence_profile_refs",
            ]:
                if not split_refs(item.get(field)):
                    fail(f"{label}.{field} 在 state_variable_chain_complete=true 时不得为空")

    return {
        "view": view,
        "judgment_unit_ids": judgment_unit_ids,
        "path_ids": path_ids,
        "node_ids": node_ids,
    }


def validate(logic_path: str | Path, view_path: str | Path) -> dict[str, object]:
    logic_path = Path(logic_path)
    view_path = Path(view_path)
    logic_triplet = parse_triplet(logic_path, "研究逻辑", stage="02")
    view_triplet = parse_triplet(view_path, "本体视图", stage="02")
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
        "schema_version": "1.0.0",
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
