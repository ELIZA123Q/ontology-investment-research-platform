#!/usr/bin/env python3
"""Validate 04 reasoning report and audit outputs."""

from __future__ import annotations

import sys
import re
from pathlib import Path

from quality_gate_utils import (
    CLAIM_MODES,
    JUDGMENT_LEVELS,
    JUDGMENT_STATUSES,
    TARGET_CLAIM_TYPES,
    judgment_level_rank,
    validate_gate_review_fields,
    validate_quality_status,
    validate_researcher_body,
    validate_target_claim_level,
)
from validator_utils import (
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
    "report_status",
    "quality_status",
    "quality_gate_ref",
    "primary_claim_id",
    "judgment_level",
    "confidence",
    "scope",
]

REQUIRED_REPORT_SECTIONS = [
    "一页摘要",
    "核心判断",
    "核心逻辑",
    "细分赛道与公司差异",
    "行业所处阶段",
    "关键跟踪指标",
    "判断依据与局限",
    "04 质量门槛检查",
]

FORBIDDEN_RESEARCHER_BODY_TERMS = [
    "改判闸门",
    "改判信号",
    "什么会改判",
    "证据门禁",
    "包级准入",
    "使用上限",
    "完整推理门槛",
    "方向判断门槛",
    "方向性推理门槛",
    "快照冻结",
    "语义实例",
    "判断单元",
    "状态变量",
    "路径节点",
    "本体视图",
    "倾向判断：",
    "条件判断：",
    "已确认：",
    "暂不可判断：",
    "被削弱",
    "被阻断",
    "竞争解释",
    "核心落点",
    "主导机制",
    "对象分化",
    "演进路线",
    "可执行跟踪",
]

REQUIRED_AUDIT_TOP = [
    "document_type",
    "schema_version",
    "metadata",
    "input_integrity",
    "evidence_admission",
    "judgment_unit_gate_results",
    "overall_judgment",
    "claim_register",
    "uncertainty_register",
    "change_gate_register",
    "tracking_register",
    "ontology_context",
    "path_results",
    "state_variable_results",
    "data_logic",
    "report_quality_check",
    "compliance_check",
]

REPORT_STATUSES = {"draft", "complete", "published"}
def _validate_report(report_path: Path) -> tuple[dict[str, object], str]:
    meta, body = parse_markdown(report_path)
    require_keys(meta, REQUIRED_REPORT_META, str(report_path))
    require_schema_version(meta["schema_version"], str(report_path), expected="2.0.0")
    if str(meta["schema_version"]) != "2.0.0":
        fail("04 报告 schema_version 必须为 2.0.0")
    if meta["document_type"] != "reasoning_report":
        fail("04 报告 document_type 必须为 reasoning_report")
    if meta["report_status"] not in REPORT_STATUSES:
        fail("report_status 非法")
    validate_quality_status(meta["quality_status"], str(report_path))
    validate_gate_review_fields(meta, str(report_path))
    if str(meta["judgment_level"]) not in JUDGMENT_LEVELS:
        fail("judgment_level 非法")
    if not isinstance(meta.get("scope"), dict):
        fail("scope 必须是对象")
    require_body_sections(body, REQUIRED_REPORT_SECTIONS, str(report_path))
    researcher_body = body
    for marker in ("## 7.", "## 7 "):
        idx = body.find(marker)
        if idx != -1:
            researcher_body = body[:idx]
            break
    for term in FORBIDDEN_RESEARCHER_BODY_TERMS:
        if term in researcher_body:
            fail(f"04 研究员正文（§1—§6）不得包含系统术语: {term}")
    validate_researcher_body(body, str(report_path))
    forbidden = ["目标价", "收益率预测", "仓位建议", "买入评级", "卖出评级"]
    for marker in forbidden:
        for match in re.finditer(re.escape(marker), body):
            context = body[max(0, match.start() - 30) : match.end() + 12]
            if "不构成" in context or "不得" in context or "不输出" in context:
                continue
            fail(f"04 正文不得包含投资建议或评级用语: {marker}")
    return meta, body


def _validate_audit(audit_path: Path) -> dict[str, object]:
    audit = load_yaml_file(audit_path)
    if not isinstance(audit, dict):
        fail("04 审计文件必须是 YAML 对象")
    require_keys(audit, REQUIRED_AUDIT_TOP, str(audit_path))
    require_schema_version(audit["schema_version"], str(audit_path), expected="2.0.0")
    if str(audit["schema_version"]) != "2.0.0":
        fail("04 审计 schema_version 必须为 2.0.0")
    if audit["document_type"] != "reasoning_audit":
        fail("04 审计 document_type 必须为 reasoning_audit")
    metadata = audit["metadata"]
    require_keys(metadata, ["task_id", "execution_id", "report_ref", "snapshot_ref", "audit_status", "quality_status"], "audit.metadata")
    validate_quality_status(metadata["quality_status"], "audit.metadata")
    validate_gate_review_fields(metadata, "audit.metadata")
    if metadata["audit_status"] not in REPORT_STATUSES:
        fail("audit.metadata.audit_status 非法")
    return audit


def _snapshot_rows(snapshot_dir: Path) -> tuple[dict[str, str], dict[str, dict[str, str]]]:
    manifest_rows = read_csv(snapshot_dir / "manifest.csv")
    if len(manifest_rows) != 1:
        fail("manifest.csv 必须且只能有一行")
    judgments = read_csv(snapshot_dir / "judgment_unit_readiness.csv")
    judgment_by_id = {row["judgment_unit_id"]: row for row in judgments}
    if not judgment_by_id:
        fail("judgment_unit_readiness.csv 至少需要一行")
    for unit_id, row in judgment_by_id.items():
        if row.get("maximum_judgment_level") not in JUDGMENT_LEVELS:
            fail(f"judgment_unit_readiness#{unit_id}.maximum_judgment_level 非法")
    return manifest_rows[0], judgment_by_id


def _validate_claims(audit: dict[str, object], judgment_by_id: dict[str, dict[str, str]]) -> None:
    claims = audit["claim_register"]
    if not isinstance(claims, list) or not claims:
        fail("claim_register 至少需要一项")
    judgment_ids = set(judgment_by_id)
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
                "source_maximum_judgment_level",
                "actual_judgment_level",
                "claim_mode",
                "conditions",
                "judgment_status",
                "confidence",
                "downgrade_reason",
                "strength_consistency_check",
                "overreach_check",
            ],
            "claim_register[]",
        )
        claim_ids.add(str(claim["claim_id"]))
        claim_label = f"claim_register#{claim['claim_id']}"
        validate_target_claim_level(claim["target_claim_type"], claim["actual_judgment_level"], claim_label)
        if str(claim["source_maximum_judgment_level"]) not in JUDGMENT_LEVELS:
            fail(f"{claim_label}.source_maximum_judgment_level 非法")
        if str(claim["claim_mode"]) not in CLAIM_MODES:
            fail(f"{claim_label}.claim_mode 非法")
        if str(claim["judgment_status"]) not in JUDGMENT_STATUSES:
            fail(f"{claim_label}.judgment_status 非法")
        if claim["claim_mode"] == "conditional" and not split_refs(claim.get("conditions")):
            fail(f"{claim_label}: conditional 必须保留 conditions")
        if claim["judgment_status"] == "contested" and judgment_level_rank(str(claim["actual_judgment_level"])) > judgment_level_rank("J1"):
            fail(f"{claim_label}: contested 不得超过 J1")
        linked_units = split_refs(claim.get("linked_judgment_unit"))
        assert_subset(linked_units, judgment_ids, f"claim_register#{claim['claim_id']}.linked_judgment_unit")
        for unit_id in linked_units:
            source_level = judgment_by_id[unit_id]["maximum_judgment_level"]
            if judgment_level_rank(str(claim["actual_judgment_level"])) > judgment_level_rank(source_level):
                fail(f"{claim['claim_id']} 超过 03 判断上限: {unit_id}={source_level}")
            if str(claim["target_claim_type"]) != str(judgment_by_id[unit_id]["target_claim_type"]):
                fail(f"{claim['claim_id']}.target_claim_type 必须继承 03 {unit_id}")
        expected_source_level = min(
            (judgment_by_id[unit_id]["maximum_judgment_level"] for unit_id in linked_units),
            key=judgment_level_rank,
        )
        if str(claim["source_maximum_judgment_level"]) != expected_source_level:
            fail(f"{claim_label}.source_maximum_judgment_level 必须为 {expected_source_level}")
        if judgment_level_rank(str(claim["actual_judgment_level"])) < judgment_level_rank(expected_source_level) and not str(claim.get("downgrade_reason", "")).strip():
            fail(f"{claim_label}: 主动降级必须填写 downgrade_reason")
        if claim.get("strength_consistency_check") is not True:
            fail(f"{claim_label}.strength_consistency_check 必须为 true")
        checks = claim["overreach_check"]
        if not isinstance(checks, dict):
            fail(f"{claim['claim_id']}.overreach_check 必须是对象")
        for key in ["within_03_judgment_limit", "evidence_label_consistent", "conditions_preserved", "scope_not_expanded", "no_unfrozen_fact_used"]:
            if checks.get(key) is not True:
                fail(f"{claim['claim_id']}.overreach_check.{key} 必须为 true")

    for register, ref_field in [
        ("uncertainty_register", "affects_claim_refs"),
        ("change_gate_register", "linked_claim_refs"),
    ]:
        for row in audit.get(register, []):
            assert_subset(split_refs(row.get(ref_field)), claim_ids, f"{register}.{ref_field}")


def _validate_quality_and_compliance(audit: dict[str, object]) -> None:
    quality = audit["report_quality_check"]
    compliance = audit["compliance_check"]
    for key in [
        "answer_first",
        "one_page_summary_under_500_chars",
        "core_landing_has_three_layers",
        "claims_within_03_use_limits",
        "claim_labels_match_evidence_strength",
        "object_differentiation_clear",
        "change_gates_observable",
        "no_internal_ids_in_main_text",
        "no_investment_advice",
        "audit_report_consistent",
    ]:
        if quality.get(key) is not True:
            fail(f"report_quality_check.{key} 必须为 true")
    if quality.get("result") != "pass":
        fail("report_quality_check.result 必须为 pass")
    for key in [
        "no_rating_target_price_return_forecast_or_position_advice",
        "no_new_unfrozen_evidence",
        "no_scope_drift",
        "citations_or_evidence_refs_complete",
        "publishable",
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

    inputs = ref_set(read_csv(snapshot_dir / "reasoning_inputs.csv"), "input_id", "reasoning_inputs.csv")
    evidence = ref_set(read_csv(snapshot_dir / "evidence_facts.csv"), "fact_id", "evidence_facts.csv")
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
        require_keys(item, ["judgment_id", "claim_id", "statement", "hypothesis_refs", "rule_evaluation_refs", "target_claim_type", "judgment_level", "judgment_status", "claim_mode", "conditions", "scope", "time_horizon", "confidence", "uncertainty_refs"], "judgments[]")
        assert_subset([str(item["claim_id"])], claims, f"{item['judgment_id']}.claim_id")
        assert_subset(split_refs(item["hypothesis_refs"]), hypotheses, f"{item['judgment_id']}.hypothesis_refs")
        assert_subset(split_refs(item["rule_evaluation_refs"]), evaluations, f"{item['judgment_id']}.rule_evaluation_refs")
        if item["judgment_level"] not in {"J0", "J1", "J2", "J3", "J4"}:
            fail(f"{item['judgment_id']}.judgment_level 非法")
        if item["judgment_status"] not in {"normal", "weakened", "contested"}:
            fail(f"{item['judgment_id']}.judgment_status 非法")
        if item["claim_mode"] not in {"unconditional", "conditional"}:
            fail(f"{item['judgment_id']}.claim_mode 非法")
        source_claim = claim_by_id[str(item["claim_id"])]
        for judgment_field, claim_field in [
            ("target_claim_type", "target_claim_type"),
            ("judgment_level", "actual_judgment_level"),
            ("judgment_status", "judgment_status"),
            ("claim_mode", "claim_mode"),
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
    report_triplet = parse_triplet(report_path, "推理报告", stage="04")
    audit_triplet = parse_triplet(audit_path, "推理审计", stage="04")
    snapshot_triplet = parse_triplet(snapshot_dir, "数据与证据快照", stage="03")
    if report_triplet != audit_triplet or report_triplet != snapshot_triplet:
        fail("04 报告、审计与 03 快照文件名核心主题、日期、序号必须一致")

    report_meta, _ = _validate_report(report_path)
    audit = _validate_audit(audit_path)
    metadata = audit["metadata"]
    manifest, judgment_by_id = _snapshot_rows(snapshot_dir)

    if not same_ref(report_meta["audit_ref"], file_name(audit_path)):
        fail("report.audit_ref 必须指向配对审计 YAML")
    if not same_ref(metadata["report_ref"], file_name(report_path)):
        fail("audit.metadata.report_ref 必须指向配对报告")
    if not same_ref(report_meta["snapshot_ref"], f"{snapshot_dir.name}/manifest.csv"):
        fail("report.snapshot_ref 必须指向 03 快照 manifest.csv")
    if not same_ref(metadata["snapshot_ref"], f"{snapshot_dir.name}/manifest.csv"):
        fail("audit.metadata.snapshot_ref 必须指向 03 快照 manifest.csv")
    for field in ["task_id", "execution_id"]:
        if not same_ref(report_meta[field], metadata[field]) or not same_ref(report_meta[field], manifest[field]):
            fail(f"{field} 在 report/audit/manifest 中必须一致")

    evidence_admission = audit["evidence_admission"]
    for field in ["admission", "coverage_unit_total", "evidence_backed_unit_count", "confidence_ceiling"]:
        if field in evidence_admission and not same_ref(evidence_admission[field], manifest[field]):
            fail(f"audit.evidence_admission.{field} 必须与 manifest 一致")

    _validate_claims(audit, judgment_by_id)
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
        fail("report.primary_claim_id 必须指向 claim_register")
    if str(report_meta["judgment_level"]) != str(claims_by_id[primary_claim_id]["actual_judgment_level"]):
        fail("report.judgment_level 必须等于主观点 actual_judgment_level")
    overall = audit["overall_judgment"]
    if str(overall.get("primary_claim_id")) != primary_claim_id or str(overall.get("judgment_level")) != str(report_meta["judgment_level"]):
        fail("audit.overall_judgment 必须与报告主观点一致")
    _validate_quality_and_compliance(audit)

    return {
        "schema_version": "2.0.0",
        "task_id": report_meta["task_id"],
        "execution_id": report_meta["execution_id"],
        "claims": len(audit["claim_register"]),
    }


def main(argv: list[str]) -> int:
    if len(argv) != 4:
        print("usage: validate_04_outputs.py <推理报告.md> <推理审计.yaml> <数据与证据快照目录>")
        return 2
    try:
        print(ok_payload(**validate(argv[1], argv[2], argv[3])))
        return 0
    except Exception as exc:
        print(error_payload(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
