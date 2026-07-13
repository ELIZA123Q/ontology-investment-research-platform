#!/usr/bin/env python3
"""Validate 02 research-logic and ontology-view outputs."""

from __future__ import annotations

import sys
from pathlib import Path

from quality_gate_utils import (
    EVIDENCE_ROLES,
    J4_ELIGIBLE_CLAIM_TYPES,
    JUDGMENT_LEVELS,
    SOURCE_AUTHORITY_LEVELS,
    TARGET_CLAIM_TYPES,
    validate_gate_review_fields,
    validate_quality_status,
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
    require_all_true,
    require_allowed,
    require_body_sections,
    require_keys,
    require_list,
    require_mapping,
    require_no_placeholders,
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
    "ontology_gap_scan_status",
    "can_enter_03",
    "framework_usage_ref",
    "quality_review_ref",
    "judgment_spine",
]

REQUIRED_LOGIC_SECTIONS = [
    "研究问题与判断边界",
    "最小问题树与分析顺序",
    "主路径、反证和竞争解释",
    "对象分化与比较口径",
    "关键判断单元、优先级与最低验证条件",
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

LOGIC_SCHEMA_VERSION_02 = "1.1.0"
VIEW_SCHEMA_VERSION_02 = "2.0.0"
ONTOLOGY_GAP_SCAN_STATUSES = {"no_gap", "minor_gap", "major_gap", "blocking_gap"}
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
EVIDENCE_ROLE_KEYS = EVIDENCE_ROLES
EVIDENCE_ROLE_STATUSES = {"required", "optional", "allowed_with_limit", "not_allowed", "not_applicable"}
STAGE_STATUSES = {"aligned", "needs_revision", "returned_to_01"}
QUESTION_RELATIONS = {"precondition", "parallel", "competing", "outcome", "stop_node"}
QUESTION_FAILURE_ACTIONS = {"stop", "downgrade", "switch_path", "switch_to_competing_explanation", "return_to_01_or_02"}
PATH_NODE_ROLES = {"start", "precondition", "transmission", "outcome", "validation", "stop"}
PATH_FAILURE_ACTIONS = {"stop", "downgrade", "switch_path"}
DECISION_RELEVANCE = {"core", "supporting", "monitoring"}
PRIORITY_TIERS = {"critical", "important", "supporting", "background"}
DECISION_ROLES = {
    "direction_driver",
    "strength_driver",
    "differentiation_explainer",
    "mechanism_validator",
    "background_context",
}
CRITICAL_FAILURE_EFFECTS = {"recalculate_overall", "downgrade_overall", "no_overall_effect"}
PROXY_POLICIES = {"not_allowed", "allowed_but_must_discount_confidence", "required_when_direct_data_unavailable"}
GAP_SEVERITIES = {"none", "minor", "major", "blocking"}
FRAMEWORK_LAYERS = {"mechanism", "company_realization", "market_pricing"}
FRAMEWORK_GATE_STATUSES = {"passed", "provisional", "failed", "not_applicable"}
FRAMEWORK_OUTPUT_FIELDS = [
    "framework_id",
    "framework_layer",
    "gate_status",
    "prerequisite_judgment_refs",
    "judgment_types",
    "candidate_claims",
    "state_variable_candidates",
    "signal_candidates",
    "evidence_requirements",
    "falsification_conditions",
    "scenarios",
    "output_objects",
    "downstream_unlocks",
    "unresolved_gaps",
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
    if str(meta.get("schema_version")) != LOGIC_SCHEMA_VERSION_02:
        fail(f"{logic_path}.schema_version 必须为 {LOGIC_SCHEMA_VERSION_02}")
    if meta["document_type"] != "research_logic":
        fail("02 研究逻辑 document_type 必须为 research_logic")
    require_allowed(meta["stage_status"], STAGE_STATUSES, "02 研究逻辑 stage_status")
    if meta["stage_status"] != "aligned":
        fail("02 研究逻辑 stage_status 必须为 aligned")
    validate_quality_status(meta["quality_status"], str(logic_path))
    if meta["quality_status"] in {"draft", "return_required", "stop_with_gap_report"}:
        fail("02 aligned 研究逻辑 quality_status 不得为 draft/return_required/stop_with_gap_report")
    require_non_empty(meta["judgment_spine"], "judgment_spine")
    require_allowed(meta["ontology_gap_scan_status"], ONTOLOGY_GAP_SCAN_STATUSES, "ontology_gap_scan_status")
    if meta["can_enter_03"] is not True and meta["can_enter_03"] is not False:
        fail("can_enter_03 必须为布尔值")
    require_non_empty(meta["framework_usage_ref"], "framework_usage_ref")
    require_non_empty(meta["quality_review_ref"], "quality_review_ref")
    require_no_placeholders(meta, str(logic_path) + " front matter")
    require_body_sections(body, REQUIRED_LOGIC_SECTIONS, str(logic_path))
    require_no_placeholders(body, str(logic_path) + " body")
    return meta, body


def _validate_framework_execution(research_framework: dict[str, object]) -> None:
    library_reference = research_framework.get("library_reference")
    if not isinstance(library_reference, dict):
        return
    if not str(library_reference.get("library_version", "")).startswith("2."):
        return

    execution = require_mapping(
        research_framework.get("framework_execution"),
        "research_framework.framework_execution",
    )
    require_keys(
        execution,
        ["dependency_protocol_ref", "registry_ref", "calls", "weakest_prerequisite_status", "valuation_gate"],
        "research_framework.framework_execution",
    )
    calls = require_list(execution["calls"], "research_framework.framework_execution.calls")
    if not calls:
        fail("research_framework.framework_execution.calls 至少需要一项")
    seen: set[str] = set()
    weakest_status = str(execution["weakest_prerequisite_status"])
    require_allowed(weakest_status, FRAMEWORK_GATE_STATUSES, "framework_execution.weakest_prerequisite_status")
    for index, raw_call in enumerate(calls, 1):
        call = require_mapping(raw_call, f"framework_execution.calls[{index}]")
        require_keys(call, FRAMEWORK_OUTPUT_FIELDS, f"framework_execution.calls[{index}]")
        framework_id = str(call["framework_id"])
        if not framework_id.startswith(("BF-", "IF-")):
            fail(f"framework_execution.calls[{index}].framework_id 必须是 BF- 基础框架或 IF- 行业主框架")
        seen.add(framework_id)
        require_allowed(call["framework_layer"], FRAMEWORK_LAYERS, f"{framework_id}.framework_layer")
        require_allowed(call["gate_status"], FRAMEWORK_GATE_STATUSES, f"{framework_id}.gate_status")
        for field in FRAMEWORK_OUTPUT_FIELDS[3:]:
            if not isinstance(call[field], list):
                fail(f"{framework_id}.{field} 必须是列表；允许为空但不得省略")
        if call["gate_status"] in {"passed", "provisional"} and not call["candidate_claims"]:
            fail(f"{framework_id} 已放行时 candidate_claims 不得为空")

    valuation = require_mapping(execution["valuation_gate"], "framework_execution.valuation_gate")
    require_keys(
        valuation,
        [
            "applicable",
            "status",
            "upstream_industry_or_mechanism_judgment_ref",
            "earnings_bridge_framework_ref",
            "forecast_framework_ref",
            "expectation_gap_framework_ref",
            "changed_valuation_inputs",
            "unresolved_gaps",
        ],
        "framework_execution.valuation_gate",
    )
    if "BF-VA-01" in seen or valuation["applicable"] is True:
        require_allowed(valuation["status"], FRAMEWORK_GATE_STATUSES, "valuation_gate.status")
        expected_refs = {
            "earnings_bridge_framework_ref": "BF-EE-01",
            "forecast_framework_ref": "BF-FS-01",
            "expectation_gap_framework_ref": "BF-EG-01",
        }
        if not valuation.get("upstream_industry_or_mechanism_judgment_ref"):
            fail("BF-VA-01 缺少产业/机制判断前置")
        for field, expected in expected_refs.items():
            if valuation.get(field) != expected or expected not in seen:
                fail(f"BF-VA-01 门禁要求已调用 {expected}，且 valuation_gate.{field} 必须引用它")
        changed_inputs = split_refs(valuation.get("changed_valuation_inputs"))
        if not changed_inputs:
            fail("BF-VA-01 门禁要求 changed_valuation_inputs 至少有一项")
        if valuation["status"] == "passed" and weakest_status != "passed":
            fail("最弱前置未 passed 时 valuation_gate 不得为 passed")


def _validate_view(view_path: Path) -> dict[str, object]:
    view = load_yaml_file(view_path)
    if not isinstance(view, dict):
        fail("02 本体视图必须是 YAML 对象")
    require_keys(view, REQUIRED_VIEW_TOP, str(view_path))
    require_schema_version(view["schema_version"], str(view_path), expected=VIEW_SCHEMA_VERSION_02)
    if view["schema_name"] != "task_ontology_view":
        fail("02 本体视图 schema_name 必须为 task_ontology_view")

    task_context = require_mapping(view["task_context"], "task_context")
    quality_control = require_mapping(view["quality_control"], "quality_control")
    research_framework = require_mapping(view["research_framework"], "research_framework")
    validation = require_mapping(view["validation"], "validation")

    require_keys(task_context, ["task_id", "view_id", "logic_id", "logic_document", "normalized_question", "scope"], "task_context")
    require_keys(
        quality_control,
        [
            "stage_status",
            "quality_status",
            "deterministic_check_status",
            "semantic_review_status",
            "return_required",
            "return_stage",
        ],
        "quality_control",
    )
    require_allowed(quality_control["stage_status"], STAGE_STATUSES, "quality_control.stage_status")
    if quality_control["stage_status"] != "aligned":
        fail("quality_control.stage_status 必须为 aligned")
    validate_quality_status(quality_control["quality_status"], "quality_control")
    if quality_control["quality_status"] in {"draft", "return_required", "stop_with_gap_report"}:
        fail("quality_control aligned 时 quality_status 不得为 draft/return_required/stop_with_gap_report")
    validate_gate_review_fields(quality_control, "quality_control")
    validate_return_routing_fields(quality_control, "quality_control", current_stage="02")
    if quality_control.get("return_required") is not False:
        fail("quality_control.return_required 必须为 false")

    _validate_cross_domain_contract(view)

    checks = validation.get("checks")
    if not isinstance(checks, dict) or validation.get("result") != "pass":
        fail("validation.result 必须为 pass，validation.checks 必须存在")
    require_all_true(checks, "validation.checks")

    judgment_units = view["judgment_units"]
    if not isinstance(judgment_units, list) or not judgment_units:
        fail("judgment_units 至少需要一项")
    require_keys(research_framework, ["judgment_spine", "minimum_question_tree", "alignment_checks"], "research_framework")
    _validate_framework_execution(research_framework)
    spine = require_mapping(research_framework["judgment_spine"], "research_framework.judgment_spine")
    require_non_empty(spine.get("statement"), "research_framework.judgment_spine.statement")
    require_all_true(require_mapping(research_framework["alignment_checks"], "research_framework.alignment_checks"), "research_framework.alignment_checks")
    question_tree = research_framework["minimum_question_tree"]
    if not isinstance(question_tree, list) or not question_tree:
        fail("research_framework.minimum_question_tree 至少需要一项")
    question_ids: set[str] = set()
    for index, item in enumerate(question_tree, 1):
        item = require_mapping(item, f"research_framework.minimum_question_tree[{index}]")
        require_keys(item, ["question_id", "question", "relation_to_overall", "sequence", "failure_action"], f"minimum_question_tree[{index}]")
        question_id = str(item.get("question_id", "")).strip()
        require_non_empty(question_id, f"minimum_question_tree[{index}].question_id")
        question_ids.add(question_id)
        require_non_empty(item.get("question"), f"{question_id}.question")
        require_allowed(item.get("relation_to_overall"), QUESTION_RELATIONS, f"{question_id}.relation_to_overall")
        require_allowed(item.get("failure_action"), QUESTION_FAILURE_ACTIONS, f"{question_id}.failure_action")
    if not question_ids:
        fail("minimum_question_tree.question_id 不得为空")

    for index, unit in enumerate(judgment_units, 1):
        require_keys(
            unit,
            [
                "judgment_unit_id",
                "research_question_ref",
                "candidate_claim",
                "statement",
                "judgment_type",
                "priority_tier",
                "decision_weight",
                "decision_role",
                "priority_rationale",
                "critical_failure_effect",
                "target_claim_type",
                "linked_questions",
                "linked_paths",
                "required_evidence_roles",
                "evidence_profile_refs",
                "mandatory_evidence_baskets",
                "level_requirements",
                "stop_condition",
            ],
            f"judgment_units[{index}]",
        )
        require_non_empty(unit["research_question_ref"], f"{unit['judgment_unit_id']}.research_question_ref")
        require_non_empty(unit["candidate_claim"], f"{unit['judgment_unit_id']}.candidate_claim")
        require_allowed(unit["priority_tier"], PRIORITY_TIERS, f"{unit['judgment_unit_id']}.priority_tier")
        try:
            weight = int(unit["decision_weight"])
        except (TypeError, ValueError):
            fail(f"{unit['judgment_unit_id']}.decision_weight 必须为 1—5 的整数")
        if weight < 1 or weight > 5:
            fail(f"{unit['judgment_unit_id']}.decision_weight 必须为 1—5")
        require_allowed(unit["decision_role"], DECISION_ROLES, f"{unit['judgment_unit_id']}.decision_role")
        require_non_empty(unit["priority_rationale"], f"{unit['judgment_unit_id']}.priority_rationale")
        require_allowed(
            unit["critical_failure_effect"],
            CRITICAL_FAILURE_EFFECTS,
            f"{unit['judgment_unit_id']}.critical_failure_effect",
        )
        if "judgment_type" in unit and str(unit["judgment_type"]) not in JUDGMENT_TYPES:
            fail(f"{unit['judgment_unit_id']}.judgment_type 非法")
        if "decision_relevance" in unit:
            require_allowed(unit.get("decision_relevance"), DECISION_RELEVANCE, f"{unit['judgment_unit_id']}.decision_relevance")
        if "expected_04_output_type" in unit:
            assert_values([str(unit.get("expected_04_output_type", ""))], ALLOWED_04_OUTPUTS, f"{unit['judgment_unit_id']}.expected_04_output_type")
        if "proxy_policy" in unit:
            require_allowed(unit.get("proxy_policy"), PROXY_POLICIES, f"{unit['judgment_unit_id']}.proxy_policy")
        role_requirements = unit["required_evidence_roles"]
        if not isinstance(role_requirements, (dict, list)) or not role_requirements:
            fail(f"{unit['judgment_unit_id']}.required_evidence_roles 必须记录支持、反证与替代解释要求")
        profiles = split_refs(unit.get("evidence_profile_refs"))
        if not profiles:
            fail(f"{unit['judgment_unit_id']}.evidence_profile_refs 不得为空")
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

    critical_units = [unit for unit in judgment_units if unit.get("priority_tier") == "critical"]
    if not critical_units:
        fail("judgment_units 至少需要一个 critical 单元")
    if len(critical_units) > 3:
        fail("critical 判断单元不得超过 3 个")
    if len(judgment_units) > 1 and len({int(unit["decision_weight"]) for unit in judgment_units}) == 1:
        fail("多个判断单元的 decision_weight 不得全部相同")

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
            require_keys(node, ["node_id", "name", "role", "question", "failure_action"], f"{path['path_id']}.nodes[]")
            require_allowed(node.get("role"), PATH_NODE_ROLES, f"{path['path_id']}.{node.get('node_id')}.role")
            require_allowed(node.get("failure_action"), PATH_FAILURE_ACTIONS, f"{path['path_id']}.{node.get('node_id')}.failure_action")
            node_ids.add(str(node["node_id"]))

    for unit in judgment_units:
        assert_subset(split_refs(unit["linked_paths"]), path_ids, f"{unit['judgment_unit_id']}.linked_paths")
        assert_subset(split_refs(unit.get("target_path_node_ids")), node_ids, f"{unit['judgment_unit_id']}.target_path_node_ids")

    for field, id_field in [
        ("weakening_conditions", "condition_id"),
        ("blocking_conditions", "condition_id"),
        ("competing_explanations", "explanation_id"),
    ]:
        items = require_list(path_design.get(field), f"path_design.{field}")
        for item in items:
            item = require_mapping(item, f"path_design.{field}[]")
            require_non_empty(item.get(id_field), f"path_design.{field}.{id_field}")
            require_non_empty(item.get("statement"), f"path_design.{field}.{item.get(id_field)}.statement")

    evidence_requirements = view["evidence_requirements"]
    if not isinstance(evidence_requirements, list) or not evidence_requirements:
        fail("evidence_requirements 至少需要一项")
    for item in evidence_requirements:
        require_keys(
            item,
            ["evidence_requirement_id", "linked_judgment_units", "evidence_profile", "minimum_standard"],
            "evidence_requirements[]",
        )
        req_id = item["evidence_requirement_id"]
        assert_subset(split_refs(item["linked_judgment_units"]), judgment_unit_ids, f"{req_id}.linked_judgment_units")
        require_non_empty(item.get("evidence_profile"), f"{req_id}.evidence_profile")
        require_non_empty(item.get("minimum_standard"), f"{req_id}.minimum_standard")
        if "maximum_judgment_level_if_missing" in item:
            assert_values([str(item["maximum_judgment_level_if_missing"])], JUDGMENT_LEVELS, f"{req_id}.maximum_judgment_level_if_missing")

    instance_requirements = require_list(view["instance_requirements"], "instance_requirements")
    for index, item in enumerate(instance_requirements, 1):
        item = require_mapping(item, f"instance_requirements[{index}]")
        require_keys(item, ["requirement_id", "target", "purpose", "linked_path_nodes", "linked_judgment_units", "minimum_fields", "scope_constraints"], f"instance_requirements[{index}]")
        requirement_id = str(item["requirement_id"]).strip()
        require_non_empty(requirement_id, f"instance_requirements[{index}].requirement_id")
        require_non_empty(item.get("target"), f"{requirement_id}.target")
        require_non_empty(item.get("purpose"), f"{requirement_id}.purpose")
        assert_subset(split_refs(item.get("linked_path_nodes")), node_ids, f"{requirement_id}.linked_path_nodes")
        assert_subset(split_refs(item.get("linked_judgment_units")), judgment_unit_ids, f"{requirement_id}.linked_judgment_units")
        require_list(item.get("minimum_fields"), f"{requirement_id}.minimum_fields", allow_empty=True)

    ontology_bindings = require_mapping(view["ontology_bindings"], "ontology_bindings")
    selected_state_variables = require_list(ontology_bindings.get("selected_state_variables", []), "ontology_bindings.selected_state_variables", allow_empty=True)
    for index, item in enumerate(selected_state_variables, 1):
        item = require_mapping(item, f"ontology_bindings.selected_state_variables[{index}]")
        require_keys(item, ["state_variable_id", "name", "linked_judgment_units", "linked_path_nodes"], f"selected_state_variables[{index}]")
        require_non_empty(item.get("state_variable_id"), f"selected_state_variables[{index}].state_variable_id")
        require_non_empty(item.get("name"), f"selected_state_variables[{index}].name")
        assert_subset(split_refs(item.get("linked_judgment_units")), judgment_unit_ids, f"{item.get('state_variable_id')}.linked_judgment_units")
        assert_subset(split_refs(item.get("linked_path_nodes")), node_ids, f"{item.get('state_variable_id')}.linked_path_nodes")

    handoff = require_mapping(view["handoff_to_03"], "handoff_to_03")
    require_keys(handoff, ["required_files", "required_csv_or_snapshot_outputs", "special_limits"], "handoff_to_03")
    require_list(handoff["required_files"], "handoff_to_03.required_files")
    require_list(handoff["required_csv_or_snapshot_outputs"], "handoff_to_03.required_csv_or_snapshot_outputs")
    require_list(handoff["special_limits"], "handoff_to_03.special_limits", allow_empty=True)

    candidate_structures = require_mapping(view.get("candidate_structures", {}), "candidate_structures")
    if candidate_structures.get("used") is True:
        for field in ["items", "usage_boundary", "effect_on_03", "effect_on_04"]:
            require_non_empty(candidate_structures.get(field), f"candidate_structures.{field}")
    ontology_gaps = require_mapping(view.get("ontology_gaps", {}), "ontology_gaps")
    if "highest_severity" in ontology_gaps:
        require_allowed(ontology_gaps["highest_severity"], GAP_SEVERITIES, "ontology_gaps.highest_severity")

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
    gap_status = str(logic_meta["ontology_gap_scan_status"])
    ontology_gaps = require_mapping(view.get("ontology_gaps", {}), "ontology_gaps")
    has_gap = ontology_gaps.get("has_gap") is True
    if gap_status == "no_gap" and has_gap:
        fail("logic.ontology_gap_scan_status=no_gap 与 view.ontology_gaps.has_gap=true 不一致")
    if gap_status != "no_gap" and not has_gap:
        fail("logic.ontology_gap_scan_status 记录缺口时 view.ontology_gaps.has_gap 必须为 true")
    if logic_meta["can_enter_03"] is not True:
        fail("aligned 的 02 交付到 03 时 can_enter_03 必须为 true")

    return {
        "schema_version": VIEW_SCHEMA_VERSION_02,
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
