#!/usr/bin/env python3
"""Validation helpers for the prospective researcher-experience cohort."""

from __future__ import annotations

import re
import json
import sqlite3
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Any

import yaml


ROOT = Path(__file__).resolve().parent
DEFAULT_COHORT_PATH = ROOT.parent / "07_研究员体验基线" / "cohort.yaml"
ALLOWED_STATUSES = {"planned", "enrolled", "running", "completed", "excluded"}
ALLOWED_SCENARIOS = {
    "normal_success",
    "conflict_stop",
    "insufficient_stop",
    "incremental_rejudgment",
    "source_invalidation",
}
ALLOWED_TERMINALS = {"directional", "correct_stop"}
ALLOWED_ONTOLOGY_VALUE_HYPOTHESES = {
    "semantic_alignment",
    "evidence_threshold",
    "competing_explanation",
    "causal_boundary",
    "stage_scope_guard",
    "incremental_invalidation",
    "source_provenance",
    "cross_run_comparability",
    "forecast_boundary",
}
REQUIRED_ONTOLOGY_RUNTIME_MEASUREMENTS = {
    "traceable_claim_ratio",
    "judgment_method_trace_ratio",
    "rule_evaluation_count",
    "method_finalization_ratio",
}
REQUIRED_ONTOLOGY_OUTCOME_DIMENSIONS = {
    "无来源主张控制",
    "反证与竞争解释",
    "结论边界",
    "可复盘性",
}


class ExperienceCohortError(ValueError):
    """Raised when the prospective cohort contract is invalid."""


def load_cohort(path: Path = DEFAULT_COHORT_PATH) -> dict[str, Any]:
    data = yaml.safe_load(path.read_text(encoding="utf-8-sig"))
    if not isinstance(data, dict):
        raise ExperienceCohortError("cohort.yaml 必须是对象")
    return data


def _required_string(owner: dict[str, Any], key: str, label: str) -> str:
    value = owner.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ExperienceCohortError(f"{label}.{key} 必须是非空字符串")
    return value.strip()


def _parse_date(value: Any, label: str) -> str:
    text = str(value or "")
    try:
        date.fromisoformat(text)
    except ValueError as error:
        raise ExperienceCohortError(f"{label} 必须是 YYYY-MM-DD 日期") from error
    return text


def validate_cohort(cohort: dict[str, Any]) -> dict[str, Any]:
    if cohort.get("document_type") != "researcher_experience_baseline_cohort":
        raise ExperienceCohortError("document_type 不正确")
    if str(cohort.get("schema_version")) != "1.0.0":
        raise ExperienceCohortError("schema_version 必须为 1.0.0")
    if cohort.get("domain") != "semiconductor":
        raise ExperienceCohortError("首轮主队列只能是 semiconductor")
    _required_string(cohort, "cohort_id", "cohort")
    _required_string(cohort, "decision_supported", "cohort")

    measurement = cohort.get("measurement_contract")
    if not isinstance(measurement, dict):
        raise ExperienceCohortError("缺少 measurement_contract")
    if measurement.get("version") != "research-experience-metrics-v1":
        raise ExperienceCohortError("体验指标版本必须为 research-experience-metrics-v1")
    for key, expected in {
        "prospective_only": True,
        "run_created_event_required": True,
        "historical_backfill_allowed": False,
    }.items():
        if measurement.get(key) is not expected:
            raise ExperienceCohortError(f"measurement_contract.{key} 必须为 {str(expected).lower()}")
    target_gate = measurement.get("target_setting_after_completed_cases")
    if not isinstance(target_gate, int) or target_gate < 8:
        raise ExperienceCohortError("目标设置门槛不得少于 8 个完成案例")

    comparison = cohort.get("comparison_contract")
    if not isinstance(comparison, dict):
        raise ExperienceCohortError("缺少 comparison_contract")
    required_comparison = {
        "primary_baseline_arm": "same_evidence_direct",
        "paired_by_case": True,
        "same_evidence_snapshot": True,
        "same_information_cutoff": True,
        "same_producer_model_family": True,
        "same_generation_budget": True,
        "blind_arm_labels_for_quality_review": True,
    }
    for key, expected in required_comparison.items():
        if comparison.get(key) != expected:
            raise ExperienceCohortError(f"comparison_contract.{key} 必须为 {expected}")

    ontology_value = cohort.get("ontology_value_contract")
    if not isinstance(ontology_value, dict):
        raise ExperienceCohortError("缺少 ontology_value_contract")
    if ontology_value.get("comparison_target") != "ontology_constrained_workflow_contribution":
        raise ExperienceCohortError("ontology_value_contract.comparison_target 不正确")
    if ontology_value.get("pure_ontology_causal_claim_allowed") is not False:
        raise ExperienceCohortError("不得把完整工作流差异声明为纯本体因果效应")
    _required_string(ontology_value, "reason", "ontology_value_contract")
    if set(ontology_value.get("required_runtime_measurements") or []) != REQUIRED_ONTOLOGY_RUNTIME_MEASUREMENTS:
        raise ExperienceCohortError("本体运行测量项不完整")
    if set(ontology_value.get("outcome_dimensions") or []) != REQUIRED_ONTOLOGY_OUTCOME_DIMENSIONS:
        raise ExperienceCohortError("本体敏感的盲评结果维度不完整")
    ontology_coverage = ontology_value.get("coverage_requirements")
    if not isinstance(ontology_coverage, dict) or set(ontology_coverage) != ALLOWED_ONTOLOGY_VALUE_HYPOTHESES:
        raise ExperienceCohortError("本体价值覆盖要求不完整")

    policy = cohort.get("primary_case_policy")
    if not isinstance(policy, dict):
        raise ExperienceCohortError("缺少 primary_case_policy")
    minimum = policy.get("minimum_cases")
    maximum = policy.get("maximum_cases")
    if not isinstance(minimum, int) or not isinstance(maximum, int) or minimum < 8 or maximum > 12 or minimum > maximum:
        raise ExperienceCohortError("主队列必须限定在 8—12 个案例")
    if policy.get("required_domain") != "semiconductor":
        raise ExperienceCohortError("primary_case_policy.required_domain 必须为 semiconductor")
    if set(policy.get("allowed_statuses") or []) != ALLOWED_STATUSES:
        raise ExperienceCohortError("primary_case_policy.allowed_statuses 与合同不一致")
    exclusions = set(policy.get("exclusions") or [])
    required_exclusions = {
        "archive_or_ui_test",
        "duplicated_question_or_run",
        "synthetic_only",
        "missing_run_created_event",
        "evidence_snapshot_not_frozen",
        "arm_inputs_not_comparable",
    }
    if not required_exclusions.issubset(exclusions):
        raise ExperienceCohortError("主队列排除规则不完整")

    cases = cohort.get("primary_cases")
    if not isinstance(cases, list) or not minimum <= len(cases) <= maximum:
        raise ExperienceCohortError(f"primary_cases 数量必须在 {minimum}—{maximum} 之间")

    case_ids: set[str] = set()
    questions: set[str] = set()
    run_ids: set[str] = set()
    status_counts: Counter[str] = Counter()
    scenario_counts: Counter[str] = Counter()
    ontology_hypothesis_counts: Counter[str] = Counter()
    for index, item in enumerate(cases, start=1):
        label = f"primary_cases[{index}]"
        if not isinstance(item, dict):
            raise ExperienceCohortError(f"{label} 必须是对象")
        case_id = _required_string(item, "case_id", label)
        if not re.fullmatch(r"RXB-S\d{2}", case_id):
            raise ExperienceCohortError(f"{case_id} 不符合 RXB-Sxx 编号")
        if case_id in case_ids:
            raise ExperienceCohortError(f"重复 case_id: {case_id}")
        case_ids.add(case_id)

        status = item.get("status")
        if status not in ALLOWED_STATUSES:
            raise ExperienceCohortError(f"{case_id}.status 非法")
        status_counts[str(status)] += 1
        question = " ".join(_required_string(item, "question", case_id).split())
        if question in questions:
            raise ExperienceCohortError(f"重复研究问题: {case_id}")
        questions.add(question)
        _required_string(item, "decision_context", case_id)
        if item.get("real_task_origin") != "research_backlog":
            raise ExperienceCohortError(f"{case_id} 不是已声明的真实研究 backlog")
        _required_string(item, "task_family", case_id)
        ontology_hypotheses = item.get("ontology_value_hypotheses")
        if (
            not isinstance(ontology_hypotheses, list)
            or not ontology_hypotheses
            or not set(ontology_hypotheses).issubset(ALLOWED_ONTOLOGY_VALUE_HYPOTHESES)
        ):
            raise ExperienceCohortError(f"{case_id}.ontology_value_hypotheses 缺失或包含未知值")
        ontology_hypothesis_counts.update(str(value) for value in set(ontology_hypotheses))
        _parse_date(item.get("information_cutoff"), f"{case_id}.information_cutoff")

        scenarios = item.get("scenarios")
        if not isinstance(scenarios, list) or not scenarios or not set(scenarios).issubset(ALLOWED_SCENARIOS):
            raise ExperienceCohortError(f"{case_id}.scenarios 缺失或包含未知场景")
        scenario_counts.update(str(value) for value in set(scenarios))
        terminals = item.get("allowed_terminals")
        if not isinstance(terminals, list) or not terminals or not set(terminals).issubset(ALLOWED_TERMINALS):
            raise ExperienceCohortError(f"{case_id}.allowed_terminals 非法")
        if item.get("evidence_snapshot_required") is not True or item.get("paired_baseline_required") is not True:
            raise ExperienceCohortError(f"{case_id} 必须冻结证据并配对同证据基线")

        run_id = item.get("run_id")
        if status == "planned" and run_id not in (None, ""):
            raise ExperienceCohortError(f"{case_id} 尚未 enrolled，不应提前绑定 run_id")
        if status in {"enrolled", "running", "completed"} and not isinstance(run_id, str):
            raise ExperienceCohortError(f"{case_id} 状态为 {status} 时必须绑定 run_id")
        if isinstance(run_id, str):
            if run_id in run_ids:
                raise ExperienceCohortError(f"重复 run_id: {run_id}")
            run_ids.add(run_id)

    coverage = policy.get("coverage_requirements")
    if not isinstance(coverage, dict):
        raise ExperienceCohortError("缺少 coverage_requirements")
    for scenario in ALLOWED_SCENARIOS:
        required = coverage.get(scenario)
        if not isinstance(required, int) or required < 1:
            raise ExperienceCohortError(f"coverage_requirements.{scenario} 必须为正整数")
        if scenario_counts[scenario] < required:
            raise ExperienceCohortError(
                f"场景 {scenario} 覆盖不足：{scenario_counts[scenario]}/{required}"
            )

    for hypothesis in ALLOWED_ONTOLOGY_VALUE_HYPOTHESES:
        required = ontology_coverage.get(hypothesis)
        if not isinstance(required, int) or required < 1:
            raise ExperienceCohortError(f"ontology coverage {hypothesis} 必须为正整数")
        if ontology_hypothesis_counts[hypothesis] < required:
            raise ExperienceCohortError(
                f"本体价值假设 {hypothesis} 覆盖不足："
                f"{ontology_hypothesis_counts[hypothesis]}/{required}"
            )

    anchors = cohort.get("historical_anchors")
    if not isinstance(anchors, list) or not anchors:
        raise ExperienceCohortError("至少需要一个历史锚点说明前瞻边界")
    for anchor in anchors:
        if not isinstance(anchor, dict) or anchor.get("quantitative_cohort_eligible") is not False:
            raise ExperienceCohortError("历史锚点不得进入前瞻定量分母")
        if anchor.get("measurement_status") != "partial":
            raise ExperienceCohortError("历史锚点必须明确为 partial")
        _required_string(anchor, "run_id", "historical_anchor")
        _required_string(anchor, "reason", "historical_anchor")

    completed = status_counts["completed"]
    if completed < target_gate and (measurement.get("targets_frozen") is True or measurement.get("targets")):
        raise ExperienceCohortError("少于目标设置门槛时不得冻结任何体验目标")

    return {
        "case_count": len(cases),
        "completed_count": completed,
        "target_gate": target_gate,
        "baseline_ready": completed >= target_gate,
        "status_counts": dict(status_counts),
        "scenario_counts": dict(scenario_counts),
        "ontology_hypothesis_counts": dict(ontology_hypothesis_counts),
    }


def validate_database_bindings(cohort: dict[str, Any], db_path: Path) -> dict[str, int]:
    if not db_path.exists():
        raise ExperienceCohortError(f"数据库不存在: {db_path}")
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    try:
        event_table = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='research_experience_events'"
        ).fetchone()
        if not event_table:
            raise ExperienceCohortError("数据库尚未迁移 research_experience_events")
        event_rows = connection.execute(
            """SELECT e.payload_json, r.id AS run_id, r.question, r.domain, r.status, r.current_stage
               FROM research_experience_events e
               JOIN research_runs r ON r.id=e.run_id
               WHERE e.event_type='run_created'
               ORDER BY e.occurred_at"""
        ).fetchall()
        enrollment_by_case: dict[str, sqlite3.Row] = {}
        expected_cohort_id = str(cohort.get("cohort_id"))
        for row in event_rows:
            try:
                payload = json.loads(row["payload_json"] or "{}")
            except json.JSONDecodeError as error:
                raise ExperienceCohortError(f"run_created 事件 payload 不是 JSON: {row['run_id']}") from error
            if payload.get("experience_cohort_id") != expected_cohort_id:
                continue
            case_id = str(payload.get("experience_case_id") or "")
            if not case_id:
                raise ExperienceCohortError(f"体验队列创建事件缺少 case_id: {row['run_id']}")
            if case_id in enrollment_by_case:
                raise ExperienceCohortError(f"体验案例重复登记: {case_id}")
            enrollment_by_case[case_id] = row

        known_case_ids = {str(item.get("case_id")) for item in cohort.get("primary_cases", [])}
        unknown = set(enrollment_by_case) - known_case_ids
        if unknown:
            raise ExperienceCohortError(f"数据库含未知体验案例: {sorted(unknown)}")

        bound = 0
        completed = 0
        for item in cohort.get("primary_cases", []):
            row = enrollment_by_case.get(str(item.get("case_id")))
            declared_run_id = item.get("run_id")
            if declared_run_id and (not row or row["run_id"] != declared_run_id):
                raise ExperienceCohortError(f"{item['case_id']} 的静态 run_id 与事件台账不一致")
            if not row:
                continue
            bound += 1
            if row["domain"] != "semiconductor":
                raise ExperienceCohortError(f"{item['case_id']} 绑定了非半导体 run")
            if " ".join(str(row["question"]).split()) != " ".join(str(item["question"]).split()):
                raise ExperienceCohortError(f"{item['case_id']} 的冻结问题与 run 不一致")
            created = connection.execute(
                "SELECT COUNT(*) FROM research_experience_events WHERE run_id=? AND event_type='run_created'",
                (row["run_id"],),
            ).fetchone()[0]
            if created != 1:
                raise ExperienceCohortError(f"{item['case_id']} 必须且只能有一个 run_created 事件")
            if row["status"] == "complete" and int(row["current_stage"]) >= 5:
                completed += 1
        return {"bound_count": bound, "completed_count": completed}
    finally:
        connection.close()
