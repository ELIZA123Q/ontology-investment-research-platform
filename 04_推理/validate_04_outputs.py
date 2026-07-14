#!/usr/bin/env python3
"""Validate 04 judgment brief and reasoning audit outputs."""

from __future__ import annotations

import sys
import re
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT / "运行校验"))
sys.path.insert(0, str(_ROOT / "03_数据与证据"))
from _path_setup import ensure_run_path  # noqa: E402

ensure_run_path()

from quality_gate_utils import (  # noqa: E402
    JUDGMENT_LEVELS,
    judgment_level_rank,
    validate_gate_review_fields,
    validate_quality_status,
    validate_stage_status,
    validate_target_claim_level,
)
from status_derivation import (  # noqa: E402
    canonical_path_result_status,
    derive_constraint,
    effective_path_readiness_status,
    normalize_counterevidence_result,
    reject_manual_derived_fields,
)
from snapshot_layout_03 import snapshot_csv_path  # noqa: E402
from validator_utils import (  # noqa: E402
    assert_subset,
    error_payload,
    fail,
    file_name,
    load_yaml_file,
    ok_payload,
    parse_markdown,
    parse_triplet,
    read_csv,
    ref_set,
    require_body_sections,
    require_keys,
    require_schema_version,
    require_trace_id,
    same_ref,
    split_refs,
)


REQUIRED_REPORT_META = [
    "document_type",
    "schema_version",
    "task_id",
    "execution_id",
    "source_01_ref",
    "source_02_logic_ref",
    "source_02_view_ref",
    "preparation_ref",
    "snapshot_ref",
    "audit_ref",
    "judgment_as_of",
    "stage_status",
    "quality_status",
    "quality_gate_ref",
    "primary_claim_id",
    "judgment_level",
    "confidence",
    "scope",
]

REQUIRED_REPORT_SECTIONS = [
    "一句话结论",
    "关键判断单元结果",
    "已确认状态变化",
    "主路径与最强竞争解释",
    "对象分化",
    "投资命题是否成立",
    "改判信号",
    "允许 05 表达什么",
]

FORBIDDEN_FORMAL_REPORT_SECTIONS = [
    "一页摘要",
    "核心逻辑",
    "行业所处阶段",
    "关键跟踪指标",
    "投资要点",
    "核心结论概览",
    "市场认知差 / Research Edge",
    "主要资料来源",
    "04 质量门槛检查",
]

MIN_BRIEF_NONSPACE_CHARS = 1200
MAX_BRIEF_NONSPACE_CHARS = 3600

FORBIDDEN_RESEARCHER_BODY_TERMS = [
    "改判闸门",
    "什么会改判",
    "证据门禁",
    "包级准入",
    "使用上限",
    "完整推理门槛",
    "方向判断门槛",
    "方向性推理门槛",
    "快照冻结",
    "语义实例",
    "状态变量",
    "路径节点",
    "本体视图",
    "倾向判断：",
    "条件判断：",
    "已确认：",
    "暂不可判断：",
    "被削弱",
    "被阻断",
    "核心落点",
    "主导机制",
    "演进路线",
    "可执行跟踪",
]

REQUIRED_AUDIT_TOP = [
    "document_type",
    "schema_version",
    "metadata",
    "input_integrity",
    "evidence_context",
    "judgment_unit_gate_results",
    "overall_judgment",
    "investment_thesis_verdict",
    "claim_register",
    "uncertainty_register",
    "change_gate_register",
    "tracking_register",
    "review_plan",
    "ontology_context",
    "path_results",
    "state_variable_results",
    "data_logic",
    "handoff_to_05",
    "brief_quality_check",
    "compliance_check",
]

INVESTMENT_INTERPRETATIONS = {
    "fundamental_trend_improving",
    "marginal_improvement",
    "high_level_divergence",
    "thesis_weakening",
    "observation_stage",
}
def _validate_report(report_path: Path) -> tuple[dict[str, object], str]:
    meta, body = parse_markdown(report_path)
    require_keys(meta, REQUIRED_REPORT_META, str(report_path))
    require_schema_version(meta["schema_version"], str(report_path), expected="3.0.0")
    if str(meta["schema_version"]) != "3.0.0":
        fail("04 判断简报 schema_version 必须为 3.0.0")
    if meta["document_type"] != "judgment_brief":
        fail("04 判断简报 document_type 必须为 judgment_brief")
    validate_stage_status(meta["stage_status"], str(report_path))
    validate_quality_status(meta["quality_status"], str(report_path))
    validate_gate_review_fields(meta, str(report_path))
    if str(meta["judgment_level"]) not in JUDGMENT_LEVELS:
        fail("judgment_level 非法")
    if not isinstance(meta.get("scope"), dict):
        fail("scope 必须是对象")
    require_body_sections(body, REQUIRED_REPORT_SECTIONS, str(report_path))
    for section in FORBIDDEN_FORMAL_REPORT_SECTIONS:
        if re.search(rf"^##\s+(?:\d+\.\s*)?{re.escape(section)}\s*$", body, re.MULTILINE):
            fail(f"04 判断简报不得承担正式研报章节: {section}")
    brief_chars = len(re.sub(r"\s+", "", body))
    if brief_chars < MIN_BRIEF_NONSPACE_CHARS or brief_chars > MAX_BRIEF_NONSPACE_CHARS:
        fail(
            f"04 判断简报须控制在 2—4 页执行代理范围 "
            f"{MIN_BRIEF_NONSPACE_CHARS}—{MAX_BRIEF_NONSPACE_CHARS} 个非空白字符，当前 {brief_chars}"
        )
    researcher_body = body
    for term in FORBIDDEN_RESEARCHER_BODY_TERMS:
        if term in researcher_body:
            fail(f"04 判断简报不得包含系统术语: {term}")
    # 04 简报必须显式出现“判断单元”和“竞争解释”两类业务功能，
    # 因而使用本文件更严格且与简报结构相容的术语清单，不复用通用正文禁词表。
    if "**结论：**" not in body:
        fail("04 判断简报必须以加粗的一句话结论定稿")
    forbidden = ["目标价", "收益率预测", "仓位建议", "买入评级", "卖出评级"]
    for marker in forbidden:
        for match in re.finditer(re.escape(marker), body):
            context = body[max(0, match.start() - 30) : match.end() + 12]
            if "不构成" in context or "不得" in context or "不输出" in context or "禁止" in context:
                continue
            fail(f"04 判断简报不得包含投资建议或评级用语: {marker}")
    return meta, body


def _validate_audit(audit_path: Path) -> dict[str, object]:
    audit = load_yaml_file(audit_path)
    if not isinstance(audit, dict):
        fail("04 审计文件必须是 YAML 对象")
    require_keys(audit, REQUIRED_AUDIT_TOP, str(audit_path))
    require_schema_version(audit["schema_version"], str(audit_path), expected="3.0.0")
    if str(audit["schema_version"]) != "3.0.0":
        fail("04 审计 schema_version 必须为 3.0.0")
    if audit["document_type"] != "reasoning_audit":
        fail("04 审计 document_type 必须为 reasoning_audit")
    metadata = audit["metadata"]
    require_keys(metadata, ["task_id", "execution_id", "brief_ref", "snapshot_ref", "stage_status", "quality_status"], "audit.metadata")
    validate_quality_status(metadata["quality_status"], "audit.metadata")
    validate_gate_review_fields(metadata, "audit.metadata")
    validate_stage_status(metadata["stage_status"], "audit.metadata")
    return audit


def _snapshot_rows(snapshot_dir: Path) -> tuple[dict[str, str], dict[str, object]]:
    manifest_rows = read_csv(snapshot_csv_path(snapshot_dir, "manifest.csv"))
    if len(manifest_rows) != 1:
        fail("manifest.csv 必须且只能有一行")
    assessments = read_csv(snapshot_csv_path(snapshot_dir, "evidence_readiness_assessments.csv"))
    paths = read_csv(snapshot_csv_path(snapshot_dir, "path_readiness.csv"))
    constraints: dict[str, object] = {}
    for row in assessments:
        unit_id = row.get("target_judgment_unit_id", "").strip()
        if not unit_id:
            fail("evidence_readiness_assessments.target_judgment_unit_id 不得为空")
        linked_paths = set(split_refs(row.get("linked_path_ids")))
        linked_nodes = set(split_refs(row.get("linked_node_ids")))
        applicable_paths = [
            item for item in paths
            if (not linked_paths or item.get("path_id") in linked_paths)
            and (not linked_nodes or item.get("node_id") in linked_nodes)
            and unit_id in split_refs(item.get("linked_judgment_unit_ids"))
        ]
        try:
            constraints[unit_id] = derive_constraint(
                row.get("evidence_grade") or row.get("source_quality_status"),
                normalize_counterevidence_result(
                    row.get("counterevidence_result") or row.get("counter_status")
                ),
                effective_path_readiness_status(
                    item.get("path_readiness_status") for item in applicable_paths
                ),
            )
        except ValueError as exc:
            fail(f"evidence_readiness_assessments#{row.get('assessment_id')}: {exc}")
    if not constraints:
        fail("evidence_readiness_assessments.csv 至少需要一行")
    return manifest_rows[0], constraints


def _validate_claims(audit: dict[str, object], constraints_by_id: dict[str, object]) -> None:
    path_results = audit["path_results"]
    if not isinstance(path_results, list):
        fail("path_results 必须为列表")
    for index, result in enumerate(path_results, 1):
        if not isinstance(result, dict):
            fail(f"path_results[{index}] 必须为对象")
        require_keys(result, ["path_id", "node_id", "path_result_status"], f"path_results[{index}]")
        if "path_status" in result:
            fail(f"path_results[{index}] 不得使用废弃字段 path_status，应填写 path_result_status")
        try:
            canonical_path_result_status(result["path_result_status"])
        except ValueError:
            fail(f"path_results[{index}].path_result_status 非法")
        if "status" in result or "reasoning_readiness" in result or "path_readiness_status" in result:
            fail(f"path_results[{index}] 不得把准备态或其它并行路径状态写入推理结果")
        try:
            reject_manual_derived_fields(result, f"path_results[{index}]")
        except ValueError as exc:
            fail(str(exc))

    claims = audit["claim_register"]
    if not isinstance(claims, list) or not claims:
        fail("claim_register 至少需要一项")
    judgment_ids = set(constraints_by_id)
    claim_ids = set()
    for claim in claims:
        require_keys(
            claim,
            [
                "claim_id",
                "report_section",
                "reader_label",
                "statement",
                "linked_judgment_unit",
                "target_claim_type",
                "judgment_level",
                "conditions",
                "confidence",
                "downgrade_reason",
                "strength_consistency_check",
                "overreach_check",
            ],
            "claim_register[]",
        )
        claim_ids.add(str(claim["claim_id"]))
        claim_label = f"claim_register#{claim['claim_id']}"
        require_trace_id(claim["claim_id"], "C", claim_label + ".claim_id")
        if str(claim["claim_id"]).startswith("CL-"):
            fail(f"{claim_label}.claim_id 不得使用 CL- 前缀；结论用 C-，CL- 仅用于 01 澄清问题")
        validate_target_claim_level(claim["target_claim_type"], claim["judgment_level"], claim_label)
        linked_units = split_refs(claim.get("linked_judgment_unit"))
        assert_subset(linked_units, judgment_ids, f"claim_register#{claim['claim_id']}.linked_judgment_unit")
        if not linked_units:
            fail(f"{claim_label}.linked_judgment_unit 不得为空")
        for unit_id in linked_units:
            require_trace_id(unit_id, "JU", f"{claim_label}.linked_judgment_unit")
        source_limits = []
        for unit_id in linked_units:
            source_level = constraints_by_id[unit_id].maximum_judgment_level
            source_limits.append(source_level)
            if judgment_level_rank(str(claim["judgment_level"])) > judgment_level_rank(source_level):
                fail(f"{claim['claim_id']} 超过 03 判断上限: {unit_id}={source_level}")
        expected_source_level = min(
            source_limits,
            key=judgment_level_rank,
        )
        if judgment_level_rank(str(claim["judgment_level"])) < judgment_level_rank(expected_source_level) and not str(claim.get("downgrade_reason", "")).strip():
            fail(f"{claim_label}: 主动降级必须填写 downgrade_reason")
        if claim.get("strength_consistency_check") is not True:
            fail(f"{claim_label}.strength_consistency_check 必须为 true")
        checks = claim["overreach_check"]
        if not isinstance(checks, dict):
            fail(f"{claim['claim_id']}.overreach_check 必须是对象")
        for key in ["within_03_judgment_limit", "evidence_label_consistent", "conditions_preserved", "scope_not_expanded", "no_unfrozen_fact_used"]:
            if checks.get(key) is not True:
                fail(f"{claim['claim_id']}.overreach_check.{key} 必须为 true")

    handoff = audit["handoff_to_05"]
    if not isinstance(handoff, dict):
        fail("handoff_to_05 必须是对象")
    require_keys(
        handoff,
        [
            "target_05_archetype",
            "target_05_quality",
            "handoff_status",
            "output_ceiling",
            "formal_report_allowed",
            "approved_core_claims",
            "restricted_claims",
            "prohibited_claims",
            "required_caveats",
            "decision_gates",
            "expression_rules",
            "confidence_ceiling",
        ],
        "handoff_to_05",
    )
    forbidden_writing_plan_keys = {
        "report_title_candidates",
        "subtitle_candidates",
        "core_thesis_sentence",
        "one_page_summary_points",
        "section_plan",
        "market_common_view",
        "differentiated_view",
        "research_edge",
        "why_now",
        "misread_risks",
        "narrative_spine",
        "evidence_progression",
        "object_strength_ranking",
        "front_section_caveats",
        "chart_candidates",
        "chart_package",
        "table_candidates",
        "table_package",
        "tracking_items",
        "tracking_dashboard",
    }
    leaked_keys = sorted(forbidden_writing_plan_keys.intersection(handoff))
    if leaked_keys:
        fail(f"04 handoff_to_05 不得预写 05 表达结构或图表方案: {', '.join(leaked_keys)}")
    if not isinstance(handoff["formal_report_allowed"], bool):
        fail("handoff_to_05.formal_report_allowed 必须为布尔值")

    claim_by_id = {str(item["claim_id"]): item for item in claims}
    approved = handoff["approved_core_claims"]
    if handoff["formal_report_allowed"] is True and (not isinstance(approved, list) or not approved):
        fail("允许形成正式研报时 approved_core_claims 至少需要一项")
    permission_claim_ids: set[str] = set()
    for index, item in enumerate(approved, 1):
        require_keys(
            item,
            [
                "claim_id",
                "permitted_role",
                "judgment_level",
                "scope",
                "conditions",
                "confidence",
                "required_caveats",
            ],
            f"handoff_to_05.approved_core_claims[{index}]",
        )
        claim_id = str(item["claim_id"])
        assert_subset([claim_id], claim_ids, f"handoff_to_05.approved_core_claims[{index}].claim_id")
        source_claim = claim_by_id[claim_id]
        if item["permitted_role"] not in {"core_thesis", "supporting_thesis"}:
            fail(f"handoff_to_05.approved_core_claims[{index}].permitted_role 非法")
        if str(item["judgment_level"]) != str(source_claim["judgment_level"]):
            fail(f"handoff_to_05.approved_core_claims[{index}].judgment_level 必须继承 04")
        if set(split_refs(item["conditions"])) != set(split_refs(source_claim.get("conditions"))):
            fail(f"handoff_to_05.approved_core_claims[{index}].conditions 必须继承 04")
        permission_claim_ids.add(claim_id)

    restricted = handoff["restricted_claims"]
    if not isinstance(restricted, list):
        fail("handoff_to_05.restricted_claims 必须是列表")
    for index, item in enumerate(restricted, 1):
        require_keys(
            item,
            [
                "claim_id",
                "permitted_role",
                "required_conditions",
                "required_scope",
                "reason",
            ],
            f"handoff_to_05.restricted_claims[{index}]",
        )
        claim_id = str(item["claim_id"])
        assert_subset([claim_id], claim_ids, f"handoff_to_05.restricted_claims[{index}].claim_id")
        if item["permitted_role"] not in {"supporting_thesis", "risk", "observation", "scenario_condition"}:
            fail(f"handoff_to_05.restricted_claims[{index}].permitted_role 非法")
        permission_claim_ids.add(claim_id)

    prohibited = handoff["prohibited_claims"]
    if not isinstance(prohibited, list):
        fail("handoff_to_05.prohibited_claims 必须是列表")
    for index, item in enumerate(prohibited, 1):
        require_keys(item, ["claim_id_or_topic", "reason"], f"handoff_to_05.prohibited_claims[{index}]")
        if not str(item["claim_id_or_topic"]).strip() or not str(item["reason"]).strip():
            fail(f"handoff_to_05.prohibited_claims[{index}] 不得为空")

    rules = handoff["expression_rules"]
    require_keys(rules, ["must_preserve", "must_avoid"], "handoff_to_05.expression_rules")
    required_preservations = {"判断方向", "判断等级", "范围", "条件"}
    if not required_preservations.issubset(set(split_refs(rules["must_preserve"]))):
        fail("handoff_to_05.expression_rules.must_preserve 必须包含方向、等级、范围、条件和状态")

    for register, ref_field in [
        ("uncertainty_register", "affects_claim_refs"),
        ("change_gate_register", "linked_claim_refs"),
    ]:
        rows = audit.get(register, [])
        if register == "change_gate_register":
            if not isinstance(rows, list) or not rows:
                fail("change_gate_register 至少需要一项改判条件")
            for index, row in enumerate(rows, 1):
                if not isinstance(row, dict):
                    fail(f"change_gate_register[{index}] 必须是对象")
                require_trace_id(row.get("gate_id"), "RC", f"change_gate_register[{index}].gate_id")
                if not split_refs(row.get("linked_claim_refs")):
                    fail(f"change_gate_register[{index}].linked_claim_refs 不得为空")
        for row in rows or []:
            assert_subset(split_refs(row.get(ref_field)), claim_ids, f"{register}.{ref_field}")

    updates = audit.get("judgment_update_register")
    if updates is not None:
        if not isinstance(updates, list) or not updates:
            fail("judgment_update_register 存在时至少需要一项")
        claim_by_id = {str(item["claim_id"]): item for item in claims}
        for index, item in enumerate(updates, 1):
            require_keys(
                item,
                [
                    "update_id", "claim_id", "prior_judgment_level", "prior_confidence",
                    "evidence_changes", "affected_structure", "current_judgment_level",
                    "current_confidence", "update_action", "update_reason",
                    "next_upgrade_signals",
                    "next_downgrade_or_block_signals",
                ],
                f"judgment_update_register[{index}]",
            )
            claim_id = str(item["claim_id"])
            assert_subset([claim_id], claim_ids, f"judgment_update_register[{index}].claim_id")
            for field in ["prior_judgment_level", "current_judgment_level"]:
                if str(item[field]) not in JUDGMENT_LEVELS:
                    fail(f"judgment_update_register[{index}].{field} 非法")
            if item["update_action"] not in {"maintain", "enhance", "weaken", "block", "revise"}:
                fail(f"judgment_update_register[{index}].update_action 非法")
            if not str(item["update_reason"]).strip():
                fail(f"judgment_update_register[{index}].update_reason 不得为空")
            if str(item["current_judgment_level"]) != str(claim_by_id[claim_id]["judgment_level"]):
                fail(f"judgment_update_register[{index}] 当前等级必须与 {claim_id} 一致")

    verdict = audit.get("investment_thesis_verdict")
    if verdict is not None:
        require_keys(
            verdict,
            [
                "applicable", "applicability_reason", "source_claim_refs", "source_a08_claim_refs",
                "source_a09_claim_refs", "target_asset", "time_window", "gate_results",
                "priced_in_assessment", "base_case", "upside_case", "downside_case",
                "catalyst_or_validation_signals", "strongest_counterevidence", "verdict",
                "judgment_level", "confidence", "verdict_reason", "invalidation_conditions",
                "handoff_to_05",
            ],
            "investment_thesis_verdict",
        )
        if not isinstance(verdict["applicable"], bool):
            fail("investment_thesis_verdict.applicable 必须为布尔值")
        for field in ["source_claim_refs", "source_a08_claim_refs", "source_a09_claim_refs"]:
            assert_subset(split_refs(verdict[field]), claim_ids, f"investment_thesis_verdict.{field}")
        if verdict["verdict"] not in {"formed", "conditional", "watch", "not_formed", "blocked", "not_applicable"}:
            fail("investment_thesis_verdict.verdict 非法")
        if str(verdict["judgment_level"]) not in JUDGMENT_LEVELS:
            fail("investment_thesis_verdict.judgment_level 非法")
        if judgment_level_rank(str(verdict["judgment_level"])) > judgment_level_rank("J3"):
            fail("A10 投资命题裁决不得达到 J4")
        if verdict["priced_in_assessment"] not in {"unpriced", "partially_priced", "priced", "unknown", "not_applicable"}:
            fail("investment_thesis_verdict.priced_in_assessment 非法")
        if verdict["handoff_to_05"] not in {"investment_spine_allowed", "conditional_expression_only", "tracking_only", "prohibited", "not_applicable"}:
            fail("investment_thesis_verdict.handoff_to_05 非法")
        if verdict["applicable"] is False:
            if verdict["verdict"] != "not_applicable" or verdict["handoff_to_05"] != "not_applicable":
                fail("A10 不适用时 verdict 与 handoff_to_05 必须均为 not_applicable")
            if not str(verdict["applicability_reason"]).strip():
                fail("A10 不适用时必须说明 applicability_reason")
        else:
            if not split_refs(verdict["source_claim_refs"]):
                fail("A10 适用时 source_claim_refs 不得为空")
            for field in ["target_asset", "time_window", "verdict_reason"]:
                if not str(verdict[field]).strip():
                    fail(f"A10 适用时 {field} 不得为空")
            gates = verdict["gate_results"]
            if not isinstance(gates, dict):
                fail("investment_thesis_verdict.gate_results 必须是对象")
            gate_fields = ["research_validity", "expectation_comparability", "pricing_not_fully_reflected", "payoff_risk_asymmetry", "validation_window"]
            for field in gate_fields:
                if gates.get(field) not in {"pass", "conditional", "fail", "not_assessed"}:
                    fail(f"investment_thesis_verdict.gate_results.{field} 非法")
            if verdict["verdict"] == "formed" and any(gates[field] != "pass" for field in gate_fields):
                fail("A10 裁决为 formed 时五道裁决门必须全部 pass")
            if verdict["verdict"] == "formed" and verdict["handoff_to_05"] != "investment_spine_allowed":
                fail("A10 裁决为 formed 时 handoff_to_05 必须为 investment_spine_allowed")

    overall = audit["overall_judgment"]
    require_keys(
        overall,
        ["investment_interpretation", "interpretation_basis"],
        "overall_judgment",
    )
    if overall["investment_interpretation"] not in INVESTMENT_INTERPRETATIONS:
        fail("overall_judgment.investment_interpretation 非法")
    if not str(overall["interpretation_basis"]).strip():
        fail("overall_judgment.interpretation_basis 不得为空")
    review_plan = audit["review_plan"]
    if not isinstance(review_plan, list) or not review_plan:
        fail("review_plan 至少需要一项")
    for index, item in enumerate(review_plan, 1):
        require_keys(
            item,
            [
                "review_id",
                "source_claim_id",
                "judgment_as_of",
                "prediction_horizon",
                "expected_signals",
                "change_thresholds",
                "review_due_at",
                "review_status",
            ],
            f"review_plan[{index}]",
        )
        assert_subset(split_refs(item["source_claim_id"]), claim_ids, f"review_plan[{index}].source_claim_id")
        if not split_refs(item["expected_signals"]):
            fail(f"review_plan[{index}].expected_signals 不得为空")
        if not split_refs(item["change_thresholds"]):
            fail(f"review_plan[{index}].change_thresholds 不得为空")
        if item["review_status"] not in {"scheduled", "due", "completed", "cancelled"}:
            fail(f"review_plan[{index}].review_status 非法")


def _validate_quality_and_compliance(audit: dict[str, object]) -> None:
    quality = audit["brief_quality_check"]
    compliance = audit["compliance_check"]
    for key in [
        "answer_first",
        "length_within_2_4_page_proxy",
        "required_decision_functions_present",
        "no_formal_report_structure",
        "claims_within_03_use_limits",
        "claim_labels_match_evidence_strength",
        "object_differentiation_clear",
        "change_gates_observable",
        "expression_permission_explicit",
        "no_internal_ids_in_main_text",
        "no_investment_advice",
        "audit_brief_consistent",
    ]:
        if quality.get(key) is not True:
            fail(f"brief_quality_check.{key} 必须为 true")
    if quality.get("result") != "pass":
        fail("brief_quality_check.result 必须为 pass")
    for key in [
        "no_rating_target_price_return_forecast_or_position_advice",
        "no_new_unfrozen_evidence",
        "no_scope_drift",
        "citations_or_evidence_refs_complete",
    ]:
        if compliance.get(key) is not True:
            fail(f"compliance_check.{key} 必须为 true")


def _id_set(items: object, field: str, label: str) -> set[str]:
    if not isinstance(items, list) or not items:
        fail(f"{label} 至少需要一项")
    output: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            fail(f"{label}[] 必须是对象")
        value = str(item.get(field, "")).strip()
        if not value or value in output:
            fail(f"{label}.{field} 为空或重复: {value}")
        output.add(value)
    return output


def _validate_reasoning_instances(audit: dict[str, object], audit_path: Path, snapshot_dir: Path) -> None:
    metadata = audit["metadata"]
    view_ref = str(metadata.get("source_02_view_ref", "")).strip()
    view_path = audit_path.parent / view_ref
    if not view_path.is_file():
        fail(f"04 source_02_view_ref 无法解析: {view_ref}")
    view = load_yaml_file(view_path)
    require_schema_version(view.get("schema_version"), str(view_path), expected="2.0.0")
    reasoning_plan = view.get("reasoning_plan")
    semantic_scope = view.get("semantic_scope")
    evidence_contract = view.get("evidence_contract")
    if not all(isinstance(item, dict) for item in [reasoning_plan, semantic_scope, evidence_contract]):
        fail("04 使用的 02 视图必须包含三域任务合同")
    if reasoning_plan.get("frozen") is not True:
        fail("04 只能使用 02 已冻结的 reasoning_plan")

    inputs = ref_set(read_csv(snapshot_csv_path(snapshot_dir, "reasoning_inputs.csv")), "input_id", "reasoning_inputs.csv")
    evidence = ref_set(read_csv(snapshot_csv_path(snapshot_dir, "evidence_facts.csv")), "fact_id", "evidence_facts.csv")
    claims = _id_set(audit["claim_register"], "claim_id", "claim_register")
    hypotheses = _id_set(audit["hypotheses"], "hypothesis_id", "hypotheses")
    signals = _id_set(audit["signals"], "signal_id", "signals")
    evaluations = _id_set(audit["rule_evaluations"], "rule_evaluation_id", "rule_evaluations")
    judgments = _id_set(audit["judgments"], "judgment_id", "judgments")
    traces = _id_set(audit["reasoning_traces"], "trace_id", "reasoning_traces")
    del traces

    planned_slots = {str(item.get("hypothesis_slot_id")) for item in reasoning_plan.get("hypothesis_slots", [])}
    planned_variables = set(split_refs(reasoning_plan.get("state_variable_refs")))
    planned_rules = set(split_refs(reasoning_plan.get("inference_rule_refs")))
    for item in audit["hypotheses"]:
        require_keys(item, ["hypothesis_id", "source_slot_ref", "statement", "state_variable_refs", "direction", "time_horizon", "falsification_conditions", "signal_refs", "evaluation_status"], "hypotheses[]")
        assert_subset([str(item["source_slot_ref"])], planned_slots, f"{item['hypothesis_id']}.source_slot_ref")
        assert_subset(split_refs(item["state_variable_refs"]), planned_variables, f"{item['hypothesis_id']}.state_variable_refs")
        assert_subset(split_refs(item["signal_refs"]), signals, f"{item['hypothesis_id']}.signal_refs")
        if not split_refs(item["falsification_conditions"]):
            fail(f"{item['hypothesis_id']}.falsification_conditions 不得为空")
    for item in audit["signals"]:
        require_keys(item, ["signal_id", "statement", "role", "strength", "observed_at", "target_hypothesis_refs", "input_refs", "evidence_refs"], "signals[]")
        if item["role"] not in {"support", "catalyst", "track", "weaken", "block"}:
            fail(f"{item['signal_id']}.role 非法")
        assert_subset(split_refs(item["target_hypothesis_refs"]), hypotheses, f"{item['signal_id']}.target_hypothesis_refs")
        assert_subset(split_refs(item["input_refs"]), inputs, f"{item['signal_id']}.input_refs")
        assert_subset(split_refs(item["evidence_refs"]), evidence, f"{item['signal_id']}.evidence_refs")
    for item in audit["rule_evaluations"]:
        require_keys(item, ["rule_evaluation_id", "rule_ref", "rule_version", "evaluated_at", "input_refs", "evidence_refs", "target_refs", "condition_results", "status", "result_summary", "output_refs"], "rule_evaluations[]")
        assert_subset([str(item["rule_ref"])], planned_rules, f"{item['rule_evaluation_id']}.rule_ref")
        assert_subset(split_refs(item["input_refs"]), inputs, f"{item['rule_evaluation_id']}.input_refs")
        assert_subset(split_refs(item["evidence_refs"]), evidence, f"{item['rule_evaluation_id']}.evidence_refs")
        assert_subset(split_refs(item["target_refs"]), hypotheses | judgments, f"{item['rule_evaluation_id']}.target_refs")
        assert_subset(split_refs(item["output_refs"]), hypotheses | judgments, f"{item['rule_evaluation_id']}.output_refs")
        if item["status"] not in {"matched", "not_matched", "blocked", "error"}:
            fail(f"{item['rule_evaluation_id']}.status 非法")
        if not split_refs(item["condition_results"]):
            fail(f"{item['rule_evaluation_id']}.condition_results 不得为空")

    claim_by_id = {
        str(item["claim_id"]): item
        for item in audit["claim_register"]
        if isinstance(item, dict) and item.get("claim_id")
    }
    judgment_by_claim: dict[str, str] = {}
    for item in audit["judgments"]:
        require_keys(item, ["judgment_id", "claim_id", "statement", "hypothesis_refs", "rule_evaluation_refs", "target_claim_type", "judgment_level", "conditions", "scope", "time_horizon", "confidence", "uncertainty_refs"], "judgments[]")
        assert_subset([str(item["claim_id"])], claims, f"{item['judgment_id']}.claim_id")
        assert_subset(split_refs(item["hypothesis_refs"]), hypotheses, f"{item['judgment_id']}.hypothesis_refs")
        assert_subset(split_refs(item["rule_evaluation_refs"]), evaluations, f"{item['judgment_id']}.rule_evaluation_refs")
        if item["judgment_level"] not in {"J0", "J1", "J2", "J3", "J4"}:
            fail(f"{item['judgment_id']}.judgment_level 非法")
        source_claim = claim_by_id[str(item["claim_id"])]
        for judgment_field, claim_field in [
            ("target_claim_type", "target_claim_type"),
            ("judgment_level", "judgment_level"),
        ]:
            if str(item[judgment_field]) != str(source_claim[claim_field]):
                fail(
                    f"{item['judgment_id']}.{judgment_field} "
                    f"必须与 claim_register#{item['claim_id']}.{claim_field} 一致"
                )
        if set(split_refs(item.get("conditions"))) != set(split_refs(source_claim.get("conditions"))):
            fail(f"{item['judgment_id']}.conditions 必须与 claim_register 一致")
        judgment_by_claim[str(item["claim_id"])] = str(item["judgment_id"])
    if set(judgment_by_claim) != claims:
        fail("每条 claim_register 观点必须且只能由一个 Judgment 承接")

    traced_judgments: set[str] = set()
    for item in audit["reasoning_traces"]:
        require_keys(item, ["trace_id", "judgment_ref", "evaluated_at", "input_refs", "rule_evaluation_refs", "steps", "rule_refs", "output_refs", "status"], "reasoning_traces[]")
        judgment_ref = str(item["judgment_ref"])
        assert_subset([judgment_ref], judgments, f"{item['trace_id']}.judgment_ref")
        assert_subset(split_refs(item["input_refs"]), inputs, f"{item['trace_id']}.input_refs")
        assert_subset(split_refs(item["rule_evaluation_refs"]), evaluations, f"{item['trace_id']}.rule_evaluation_refs")
        assert_subset(split_refs(item["rule_refs"]), planned_rules, f"{item['trace_id']}.rule_refs")
        if item["status"] != "complete" or not split_refs(item["steps"]):
            fail(f"{item['trace_id']} 必须是 complete 且包含公开推理步骤")
        traced_judgments.add(judgment_ref)
    if traced_judgments != judgments:
        fail("每个 Judgment 都必须有完整 ReasoningTrace")

    context = audit["ontology_context"]
    assert_subset(split_refs(context.get("object_type_refs")), set(split_refs(semantic_scope.get("object_type_refs"))), "ontology_context.object_type_refs")
    assert_subset(split_refs(context.get("relation_type_refs")), set(split_refs(semantic_scope.get("relation_type_refs"))), "ontology_context.relation_type_refs")
    assert_subset(split_refs(context.get("event_refs")), set(split_refs(semantic_scope.get("event_type_refs"))), "ontology_context.event_refs")
    assert_subset(split_refs(context.get("propagation_template_refs")), set(split_refs(reasoning_plan.get("propagation_template_refs"))), "ontology_context.propagation_template_refs")
    assert_subset(split_refs(context.get("rule_refs")), planned_rules, "ontology_context.rule_refs")
    for key in ["task_id_consistent", "execution_id_consistent", "scope_consistent", "source_refs_resolvable", "no_unfrozen_evidence_used", "no_new_path_or_rule_created"]:
        if audit["input_integrity"].get(key) is not True:
            fail(f"input_integrity.{key} 必须为 true")


def validate(report_path: str | Path, audit_path: str | Path, snapshot_dir: str | Path) -> dict[str, object]:
    report_path = Path(report_path)
    audit_path = Path(audit_path)
    snapshot_dir = Path(snapshot_dir)
    report_triplet = parse_triplet(report_path, "判断简报", stage="04")
    audit_triplet = parse_triplet(audit_path, "推理审计", stage="04")
    snapshot_triplet = parse_triplet(snapshot_dir, "数据与证据快照", stage="03")
    if report_triplet != audit_triplet or report_triplet != snapshot_triplet:
        fail("04 判断简报、审计与 03 快照文件名核心主题、日期、序号必须一致")

    report_meta, _ = _validate_report(report_path)
    audit = _validate_audit(audit_path)
    try:
        reject_manual_derived_fields(report_meta, "04.brief")
        reject_manual_derived_fields(audit, "04.audit")
    except ValueError as exc:
        fail(str(exc))
    metadata = audit["metadata"]
    manifest, constraints_by_id = _snapshot_rows(snapshot_dir)

    if not same_ref(report_meta["audit_ref"], file_name(audit_path)):
        fail("report.audit_ref 必须指向配对审计 YAML")
    if not same_ref(metadata["brief_ref"], file_name(report_path)):
        fail("audit.metadata.brief_ref 必须指向配对判断简报")
    if not same_ref(report_meta["snapshot_ref"], f"{snapshot_dir.name}/manifest.csv"):
        fail("brief.snapshot_ref 必须指向 03 快照 manifest.csv")
    if not same_ref(metadata["snapshot_ref"], f"{snapshot_dir.name}/manifest.csv"):
        fail("audit.metadata.snapshot_ref 必须指向 03 快照 manifest.csv")
    for field in ["task_id", "execution_id"]:
        if not same_ref(report_meta[field], metadata[field]) or not same_ref(report_meta[field], manifest[field]):
            fail(f"{field} 在 brief/audit/manifest 中必须一致")
    if report_meta["stage_status"] != metadata["stage_status"]:
        fail("04 判断简报与审计的 stage_status 必须一致")
    if manifest.get("stage_status") != "complete":
        fail("04 只能读取 stage_status=complete 的 03 快照")

    evidence_context = audit["evidence_context"]
    for field in ["stage_status", "coverage_unit_total", "evidence_backed_unit_count", "confidence_ceiling"]:
        if field in evidence_context and not same_ref(evidence_context[field], manifest[field]):
            fail(f"audit.evidence_context.{field} 必须与 manifest 一致")

    _validate_claims(audit, constraints_by_id)
    reasoning_instance_fields = {
        "hypotheses",
        "signals",
        "rule_evaluations",
        "judgments",
        "reasoning_traces",
    }
    present_reasoning_fields = reasoning_instance_fields.intersection(audit)
    if present_reasoning_fields and present_reasoning_fields != reasoning_instance_fields:
        fail("04 推理实例字段必须成组出现，不得只提供部分字段")
    if present_reasoning_fields:
        _validate_reasoning_instances(audit, audit_path, snapshot_dir)
    claims_by_id = {str(item["claim_id"]): item for item in audit["claim_register"]}
    primary_claim_id = str(report_meta["primary_claim_id"])
    if primary_claim_id not in claims_by_id:
        fail("brief.primary_claim_id 必须指向 claim_register")
    if str(report_meta["judgment_level"]) != str(claims_by_id[primary_claim_id]["judgment_level"]):
        fail("brief.judgment_level 必须等于主观点 judgment_level")
    overall = audit["overall_judgment"]
    if str(overall.get("primary_claim_id")) != primary_claim_id or str(overall.get("judgment_level")) != str(report_meta["judgment_level"]):
        fail("audit.overall_judgment 必须与判断简报主观点一致")
    _validate_quality_and_compliance(audit)

    return {
        "schema_version": "3.0.0",
        "task_id": report_meta["task_id"],
        "execution_id": report_meta["execution_id"],
        "claims": len(audit["claim_register"]),
    }


def main(argv: list[str]) -> int:
    if len(argv) != 4:
        print("usage: validate_04_outputs.py <判断简报.md> <推理审计.yaml> <数据与证据快照目录>")
        return 2
    try:
        print(ok_payload(**validate(argv[1], argv[2], argv[3])))
        return 0
    except Exception as exc:
        print(error_payload(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
