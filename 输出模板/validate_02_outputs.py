#!/usr/bin/env python3
"""Validate 02 research-logic and ontology-view outputs."""

from __future__ import annotations

import sys
from pathlib import Path

from quality_gate_utils import (
    J4_ELIGIBLE_CLAIM_TYPES,
    JUDGMENT_LEVELS,
    SOURCE_AUTHORITY_LEVELS,
    TARGET_CLAIM_TYPES,
    validate_gate_review_fields,
    validate_quality_status,
    validate_researcher_body,
    validate_return_routing_fields,
)
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
    "semantic_scope",
    "evidence_contract",
    "reasoning_plan",
    "judgment_units",
    "path_design",
    "ontology_bindings",
    "instance_requirements",
    "evidence_requirements",
    "handoff_to_03",
    "validation",
]


WORKSPACE = Path(__file__).resolve().parent.parent


def _ontology_catalog(view: dict[str, object]) -> tuple[dict[str, set[str]], set[str]]:
    catalog = {key: set() for key in ["objects", "relations", "events", "profiles", "variables", "templates", "rules"]}
    source_files: set[str] = set()
    sources = view.get("ontology_sources")
    if not isinstance(sources, dict):
        fail("ontology_sources 必须是对象")
    for source_name, source in sources.items():
        if not isinstance(source, dict):
            fail(f"ontology_sources.{source_name} 必须是对象")
        files = source.get("files")
        if not isinstance(files, list) or not files:
            fail(f"ontology_sources.{source_name}.files 不得为空")
        for file_ref in files:
            relative = str(file_ref)
            path = WORKSPACE / relative
            if not path.is_file():
                fail(f"正式本体文件无法解析: {relative}")
            source_files.add(relative)
            data = load_yaml_file(path)
            if not isinstance(data, dict):
                fail(f"正式本体文件必须是 YAML 对象: {relative}")
            for section, target in [
                ("object_types", "objects"),
                ("relation_types", "relations"),
                ("event_type_taxonomy", "events"),
                ("evidence_profiles", "profiles"),
                ("state_variables", "variables"),
                ("propagation_templates", "templates"),
                ("rules", "rules"),
            ]:
                values = data.get(section, {})
                if isinstance(values, dict):
                    catalog[target].update(str(key) for key in values)
    return catalog, source_files


def _validate_ontology_pointer(ref: object, source_files: set[str], label: str) -> None:
    text = str(ref).strip()
    if "#" not in text:
        fail(f"{label} 必须使用 <正式本体文件>#<资源路径>")
    file_ref, pointer = text.split("#", 1)
    if file_ref not in source_files:
        fail(f"{label} 引用了未冻结的正式本体文件: {file_ref}")
    node: object = load_yaml_file(WORKSPACE / file_ref)
    for part in pointer.split("."):
        if not isinstance(node, dict) or part not in node:
            fail(f"{label} 无法解析: {text}")
        node = node[part]


def _validate_cross_domain_contract(view: dict[str, object]) -> None:
    catalog, source_files = _ontology_catalog(view)
    semantic = view["semantic_scope"]
    evidence = view["evidence_contract"]
    reasoning = view["reasoning_plan"]
    for label, section in [("semantic_scope", semantic), ("evidence_contract", evidence), ("reasoning_plan", reasoning)]:
        if not isinstance(section, dict):
            fail(f"{label} 必须是对象")
    for field, target in [("object_type_refs", "objects"), ("relation_type_refs", "relations"), ("event_type_refs", "events")]:
        refs = split_refs(semantic.get(field))
        if not refs:
            fail(f"semantic_scope.{field} 不得为空")
        assert_subset(refs, catalog[target], f"semantic_scope.{field}")
    profiles = split_refs(evidence.get("evidence_profile_refs"))
    if not profiles:
        fail("evidence_contract.evidence_profile_refs 不得为空")
    assert_subset(profiles, catalog["profiles"], "evidence_contract.evidence_profile_refs")
    assert_subset(split_refs(evidence.get("runtime_object_types")), catalog["objects"], "evidence_contract.runtime_object_types")
    assert_subset(split_refs(evidence.get("required_relation_types")) + split_refs(evidence.get("conflict_relation_types")), catalog["relations"], "evidence_contract.relation_types")
    if evidence.get("frozen") is not True or reasoning.get("frozen") is not True:
        fail("evidence_contract 与 reasoning_plan 必须在 02 冻结")

    bindings = view.get("ontology_bindings")
    if not isinstance(bindings, dict):
        fail("ontology_bindings 必须是对象")
    selected_variables = bindings.get("selected_state_variables")
    if not isinstance(selected_variables, list) or not selected_variables:
        fail("ontology_bindings.selected_state_variables 不得为空")
    task_variable_ids = ref_set(selected_variables, "state_variable_id", "selected_state_variables")
    assert_subset(split_refs(reasoning.get("state_variable_refs")), task_variable_ids, "reasoning_plan.state_variable_refs")
    assert_subset(split_refs(reasoning.get("propagation_template_refs")), catalog["templates"], "reasoning_plan.propagation_template_refs")
    assert_subset(split_refs(reasoning.get("inference_rule_refs")), catalog["rules"], "reasoning_plan.inference_rule_refs")
    assert_subset(split_refs(reasoning.get("runtime_object_types")), catalog["objects"], "reasoning_plan.runtime_object_types")
    for variable in selected_variables:
        _validate_ontology_pointer(variable.get("ontology_ref"), source_files, f"{variable.get('state_variable_id')}.ontology_ref")
    slots = reasoning.get("hypothesis_slots")
    if not isinstance(slots, list) or not slots:
        fail("reasoning_plan.hypothesis_slots 至少需要一项")
    for slot in slots:
        require_keys(slot, ["hypothesis_slot_id", "statement", "state_variable_refs", "falsification_conditions"], "reasoning_plan.hypothesis_slots[]")
        assert_subset(split_refs(slot["state_variable_refs"]), task_variable_ids, f"{slot['hypothesis_slot_id']}.state_variable_refs")
        if not split_refs(slot["falsification_conditions"]):
            fail(f"{slot['hypothesis_slot_id']}.falsification_conditions 不得为空")


def _validate_logic(logic_path: Path) -> tuple[dict[str, object], str]:
    meta, body = parse_markdown(logic_path)
    require_keys(meta, REQUIRED_LOGIC_META, str(logic_path))
    require_schema_version(meta["schema_version"], str(logic_path), expected="2.0.0")
    if str(meta["schema_version"]) != "2.0.0":
        fail("02 研究逻辑 schema_version 必须为 2.0.0")
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
    require_schema_version(view["schema_version"], str(view_path), expected="2.0.0")
    if str(view["schema_version"]) != "2.0.0":
        fail("02 本体视图 schema_version 必须为 2.0.0")
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
    _validate_cross_domain_contract(view)

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
                "target_claim_type",
                "linked_questions",
                "linked_paths",
                "required_evidence_roles",
                "mandatory_evidence_baskets",
                "counter_evidence_requirement_refs",
                "alternative_explanation_refs",
                "required_path_condition_refs",
                "level_requirements",
                "stop_condition",
                "evidence_profile_refs",
            ],
            f"judgment_units[{index}]",
        )
        assert_subset(split_refs(unit["linked_questions"]), question_ids, f"{unit['judgment_unit_id']}.linked_questions")
        target_claim_type = str(unit["target_claim_type"])
        if target_claim_type not in TARGET_CLAIM_TYPES:
            fail(f"{unit['judgment_unit_id']}.target_claim_type 非法: {target_claim_type}")
        baskets = unit["mandatory_evidence_baskets"]
        if not isinstance(baskets, list) or not baskets:
            fail(f"{unit['judgment_unit_id']}.mandatory_evidence_baskets 至少需要一项")
        basket_ids = set()
        for basket in baskets:
            require_keys(basket, ["basket_id", "role", "evidence_requirement_refs", "required_for_levels"], f"{unit['judgment_unit_id']}.mandatory_evidence_baskets[]")
            basket_ids.add(str(basket["basket_id"]))
            levels = split_refs(basket["required_for_levels"])
            if not levels or not set(levels).issubset(JUDGMENT_LEVELS):
                fail(f"{unit['judgment_unit_id']}#{basket['basket_id']}.required_for_levels 非法")
        level_requirements = unit["level_requirements"]
        if not isinstance(level_requirements, dict) or set(level_requirements) != JUDGMENT_LEVELS:
            fail(f"{unit['judgment_unit_id']}.level_requirements 必须完整包含 J0—J4")
        for level, requirement in level_requirements.items():
            if not isinstance(requirement, dict):
                fail(f"{unit['judgment_unit_id']}.level_requirements.{level} 必须是对象")
            require_keys(requirement, ["applicable", "required_evidence_basket_refs", "minimum_source_authority", "minimum_independent_source_groups", "counter_evidence_check", "alternative_explanation_check", "required_conditions"], f"{unit['judgment_unit_id']}.level_requirements.{level}")
            if requirement["applicable"] is not True and requirement["applicable"] is not False:
                fail(f"{unit['judgment_unit_id']}.level_requirements.{level}.applicable 必须是布尔值")
            if str(requirement["minimum_source_authority"]) not in SOURCE_AUTHORITY_LEVELS:
                fail(f"{unit['judgment_unit_id']}.level_requirements.{level}.minimum_source_authority 非法")
            try:
                int(requirement["minimum_independent_source_groups"])
            except (TypeError, ValueError):
                fail(f"{unit['judgment_unit_id']}.level_requirements.{level}.minimum_independent_source_groups 必须为整数")
            assert_subset(split_refs(requirement["required_evidence_basket_refs"]), basket_ids, f"{unit['judgment_unit_id']}.level_requirements.{level}.required_evidence_basket_refs")
        if target_claim_type not in J4_ELIGIBLE_CLAIM_TYPES and level_requirements["J4"]["applicable"] is not False:
            fail(f"{unit['judgment_unit_id']}: {target_claim_type} 的 J4 必须标记 applicable=false")
        require_non_empty(unit["stop_condition"], f"{unit['judgment_unit_id']}.stop_condition")

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
        if "maximum_judgment_level_if_missing" in item:
            assert_values([str(item["maximum_judgment_level_if_missing"])], JUDGMENT_LEVELS, f"{item['evidence_requirement_id']}.maximum_judgment_level_if_missing")

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
        "schema_version": "2.0.0",
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
