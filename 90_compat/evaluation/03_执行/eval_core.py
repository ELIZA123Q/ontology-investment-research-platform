#!/usr/bin/env python3
"""Shared validation, adapter and metric utilities for research-value eval runtime."""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import select
import subprocess
import time
from collections import Counter
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Iterable

import yaml


RUNTIME_ROOT = Path(__file__).resolve().parent
EVAL_ROOT = RUNTIME_ROOT.parent
REPO_ROOT = EVAL_ROOT.parents[1]  # 90_compat/evaluation → repo root
SUITE_PATH = RUNTIME_ROOT / "suite.yaml"
METRICS_PATH = RUNTIME_ROOT / "metrics.yaml"
PROMPTS_PATH = RUNTIME_ROOT / "prompts" / "prompts.yaml"
DEFECTS_PATH = RUNTIME_ROOT / "calibration" / "defects.yaml"
PROTOCOL_PATH = RUNTIME_ROOT / "protocol.yaml"

R_ORDER = {"R0": 0, "R1": 1, "R2": 2, "R3": 3}
C_ORDER = {"C0": 0, "C1": 1, "C2": 2, "C3": 3}
PERTURBATION_ACTIONS = (
    "maintain",
    "maintain_abstention",
    "downgrade",
    "weaken",
    "dispute",
    "abstain",
    "reopen",
    "reject_scope_substitution",
    "differentiate",
    "strengthen",
)
ROLE_RESPONSE_SCHEMAS: dict[str, dict[str, Any]] = {
    "calibration": {
        "type": "object",
        "properties": {
            "defect_detected": {"type": "boolean"},
            "detected_category": {"type": "string"},
            "located_at": {"type": "string"},
            "detected_severity": {"type": "string"},
            "normal_ranked_higher": {"type": "boolean"},
        },
        "required": ["defect_detected", "normal_ranked_higher"],
        "additionalProperties": True,
    },
    "calibration_clean": {
        "type": "object",
        "properties": {
            "false_kill": {"type": "boolean"},
            "clean_accepted": {"type": "boolean"},
        },
        "required": ["false_kill"],
        "additionalProperties": True,
    },
    "perturbation": {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": list(PERTURBATION_ACTIONS)},
            "sensitivity_passed": {"type": "boolean"},
            "rationale": {"type": "string"},
        },
        "required": ["action"],
        "additionalProperties": True,
    },
    "pairwise": {
        "type": "object",
        "properties": {
            "winner": {"type": "string"},
            "rationale": {"type": "string"},
            "cited_locations": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["winner", "rationale"],
        "additionalProperties": True,
    },
    "arbiter": {
        "type": "object",
        "properties": {
            "claim_r": {"type": "string"},
            "reason": {"type": "string"},
            "weakest_claim": {"type": "string"},
            "strongest_counterevidence": {"type": "string"},
            "major_disagreement": {"type": "string"},
            "hard_failures": {"type": "array", "items": {"type": "string"}},
            "no_new_argument_added": {"type": "boolean"},
        },
        "required": ["claim_r", "reason", "hard_failures"],
        "additionalProperties": True,
    },
    "downstream_scorer": {
        "type": "object",
        "properties": {
            "task_id": {"type": "string"},
            "context_id": {"type": "string"},
            "score": {"type": "number"},
            "critical_error": {"type": "boolean"},
            "error_count": {"type": "integer"},
            "misread_rate": {"type": "number"},
            "specific_evidence": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["score", "critical_error", "error_count"],
        "additionalProperties": True,
    },
    "claim_extractor": {
        "type": "object",
        "properties": {
            "claims": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "claim_id": {"type": "string"},
                        "statement": {"type": "string"},
                        "location": {"type": "string"},
                        "criticality": {"type": "string"},
                        "directly_answers_question": {"type": "boolean"},
                    },
                    "required": ["statement", "location"],
                },
            },
            "extraction_only": {"type": "boolean"},
        },
        "required": ["claims"],
        "additionalProperties": True,
    },
    "claim_reconciler": {
        "type": "object",
        "properties": {
            "claims": {"type": "array"},
            "disagreements": {"type": "array"},
            "uncovered_contract_claims": {"type": "array"},
        },
        "required": ["claims"],
        "additionalProperties": True,
    },
    "evidence_reviewer": {
        "type": "object",
        "properties": {
            "verdict": {"type": "string"},
            "fact_accuracy": {"type": "string"},
            "basket_complete": {"type": "boolean"},
            "cited_evidence_ids": {"type": "array", "items": {"type": "string"}},
            "material_limit": {"type": "string"},
            "severity": {"type": "string"},
        },
        "required": ["verdict", "fact_accuracy"],
        "additionalProperties": True,
    },
    "reasoning_reviewer": {
        "type": "object",
        "properties": {
            "verdict": {"type": "string"},
            "path_complete": {"type": "boolean"},
            "causal_overreach": {"type": "boolean"},
            "scope_overreach": {"type": "boolean"},
            "strength_within_ceiling": {"type": "boolean"},
            "located_step": {"type": "string"},
            "severity": {"type": "string"},
        },
        "required": ["verdict", "located_step"],
        "additionalProperties": True,
    },
    "adversarial_reviewer": {
        "type": "object",
        "properties": {
            "strongest_counterevidence": {"type": "string"},
            "competing_explanation": {"type": "string"},
            "single_point_dependency": {"type": "string"},
            "leave_one_out_result": {"type": "string"},
            "most_likely_falsifier": {"type": "string"},
        },
        "required": ["strongest_counterevidence", "competing_explanation"],
        "additionalProperties": True,
    },
    "downstream_core_restatement": {
        "type": "object",
        "properties": {
            "task_id": {"type": "string"},
            "answer": {"type": "string"},
            "used_new_information": {"type": "string"},
        },
        "required": ["answer"],
        "additionalProperties": True,
    },
    "downstream_tracking_plan": {
        "type": "object",
        "properties": {
            "task_id": {"type": "string"},
            "answer": {"type": "string"},
        },
        "required": ["answer"],
        "additionalProperties": True,
    },
    "downstream_information_update": {
        "type": "object",
        "properties": {
            "task_id": {"type": "string"},
            "answer": {"type": "string"},
            "used_new_information": {"type": "string"},
        },
        "required": ["answer"],
        "additionalProperties": True,
    },
    "downstream_research_questions": {
        "type": "object",
        "properties": {
            "task_id": {"type": "string"},
            "answer": {"type": "string"},
        },
        "required": ["answer"],
        "additionalProperties": True,
    },
    "question_only_generator": {
        "type": "object",
        "properties": {
            "artifact_text": {"type": "string"},
            "target_length_followed": {"type": "boolean"},
        },
        "required": ["artifact_text"],
        "additionalProperties": True,
    },
    "same_evidence_direct_generator": {
        "type": "object",
        "properties": {
            "artifact_text": {"type": "string"},
            "target_length_followed": {"type": "boolean"},
        },
        "required": ["artifact_text"],
        "additionalProperties": True,
    },
    "evidence_summary_generator": {
        "type": "object",
        "properties": {
            "artifact_text": {"type": "string"},
            "target_length_followed": {"type": "boolean"},
        },
        "required": ["artifact_text"],
        "additionalProperties": True,
    },
}
ROLE_OUTPUT_TOKEN_LIMITS: dict[str, int] = {
    # DeepSeek flash 会把 reasoning tokens 计入 completion；过低上限会产生已计费但无最终 JSON 的空响应。
    # 总成本由 --max-new-requests 控制，单次上限按既有成功日志留出形成最终结构化答案的空间。
    "calibration": 2048,
    "calibration_clean": 1024,
    "perturbation": 1600,
    "pairwise": 768,
    "claim_extractor": 1200,
    "claim_reconciler": 1600,
    "evidence_reviewer": 900,
    "reasoning_reviewer": 900,
    "adversarial_reviewer": 900,
    "arbiter": 768,
    "downstream_core_restatement": 1200,
    "downstream_tracking_plan": 1400,
    "downstream_information_update": 1000,
    "downstream_research_questions": 1400,
    "downstream_scorer": 768,
    "question_only_generator": 2400,
    "same_evidence_direct_generator": 2400,
    "evidence_summary_generator": 1800,
}
GENERATOR_ROLES = {
    "question_only_generator",
    "same_evidence_direct_generator",
    "evidence_summary_generator",
}
# 试点阈值：仅用于方案比较与运行阻断，非正式经验分界。
U_THRESHOLDS = {
    "core_restatement": 0.85,
    "tracking_plan": 0.80,
    "information_update": 0.75,
    "research_questions": 0.80,
}
U_THRESHOLD_STATUS = "pilot_threshold"
PRIMARY_PAIRWISE_BASELINES = ("same_evidence_direct", "evidence_summary")
OBJECTIVE_CHECK_KEYS = (
    "numeric_temporal_object_source_alignment",
    "minimum_evidence_exists",
    "no_post_cutoff_material",
    "no_prediction_as_fact",
)
SEALED_INDEPENDENCE_MODES = {"dual_route_independent", "pilot_manual"}
PERTURBATION_TYPES = {
    "delete_critical_evidence",
    "replace_scope",
    "inject_counterevidence",
    "shift_time",
}
BANNED_BLIND_PATTERNS = (
    "high_quality_pass",
    "PUBLISHABLE",
    "quality_status",
    "deterministic_check_status",
    "semantic_review_status",
    "source_01_ref",
    "source_02_logic_ref",
    "source_02_view_ref",
    "preparation_ref",
    "snapshot_ref",
    "audit_ref",
    "eval_note",
    "stage_status",
    "quality_gate_ref",
    "confidence:",
)


class EvalError(RuntimeError):
    """Raised for a contract or execution failure."""


def calibration_run_minimum(registry: dict[str, Any], intensity: str) -> str:
    """Return the minimum C grade required to continue past calibration."""
    if registry.get("run_mode") == "single_vendor" and intensity == "pilot_light":
        return "C1"
    return "C2"


def judges_share_model_id(registry: dict[str, Any]) -> bool:
    bindings = registry.get("role_bindings") or {}
    profiles = registry.get("profiles") or {}
    judge_names = list(bindings.get("judges") or [])
    if len(judge_names) != 2:
        return False
    judge_ids = [profiles[name]["model_id"] for name in judge_names if name in profiles]
    return len(judge_ids) == 2 and len(set(judge_ids)) == 1


def role_output_tokens(role: str, payload: dict[str, Any]) -> int:
    if role in GENERATOR_ROLES:
        target_length = int(payload.get("target_length") or 0)
        if target_length > 0:
            cap = ROLE_OUTPUT_TOKEN_LIMITS.get(role, 2400)
            return min(cap, max(900, int(target_length / 3.5) + 200))
    return ROLE_OUTPUT_TOKEN_LIMITS.get(role, 1200)


def parse_model_json(text: str) -> Any:
    stripped = text.strip()
    if stripped.startswith("```"):
        lines = stripped.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        stripped = "\n".join(lines).strip()
    return json.loads(stripped)


def uses_http_model_adapter(command: list[str]) -> bool:
    return any("http_model_adapter.py" in str(part) for part in command)


def normalize_role_result(row: dict[str, Any]) -> dict[str, Any]:
    """Map legacy pairwise-shaped calibration JSON into flat metric fields."""
    result = dict(row.get("result") or {})
    meta = row.get("request_metadata") or {}
    if meta.get("role") == "perturbation":
        nested = result.get("evaluation") if isinstance(result.get("evaluation"), dict) else {}
        raw_action = (
            result.get("action")
            or nested.get("action")
            or nested.get("result")
            or result.get("judgment")
            or result.get("decision")
            or result.get("verdict")
            or result.get("final_answer_type")
            or result.get("conclusion_impact")
            or result.get("final_judgment")
            or result.get("new_conclusion")
            or ""
        )
        result["action"] = normalize_perturbation_action(raw_action)
        return result
    if meta.get("role") != "calibration" or "defect_detected" in result or "candidate_1" not in result:
        return result
    order = meta.get("candidate_order") or ["normal", "variant"]
    variant_key = "candidate_2" if order[1] == "variant" else "candidate_1"
    normal_key = "candidate_1" if variant_key == "candidate_2" else "candidate_2"
    variant_result = result.get(variant_key) or {}
    normal_result = result.get(normal_key) or {}
    normalized = {
        "defect_detected": bool(variant_result.get("defect_detected")),
        "detected_category": variant_result.get("detected_category"),
        "located_at": variant_result.get("located_at"),
        "detected_severity": variant_result.get("detected_severity"),
        "normal_ranked_higher": result.get("normal_ranked_higher"),
    }
    if normalized["normal_ranked_higher"] is None:
        sorting = str(result.get("sorting_comparison", "")).lower()
        if "candidate_1" in sorting and "better" in sorting:
            normalized["normal_ranked_higher"] = order[0] == "normal"
        elif "candidate_2" in sorting and "better" in sorting:
            normalized["normal_ranked_higher"] = order[1] == "normal"
        else:
            normalized["normal_ranked_higher"] = not normal_result.get("defect_detected") and bool(
                variant_result.get("defect_detected")
            )
    return normalized


def normalize_perturbation_action(value: Any) -> str:
    """Normalize legacy Chinese/free-text actions to the frozen action vocabulary."""
    text = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    if text in PERTURBATION_ACTIONS:
        return text
    aliases = (
        (("维持暂不可判断", "维持弃答", "maintain_abstention"), "maintain_abstention"),
        (("拒绝口径替换", "拒绝范围替换", "reject_scope", "scope_substitution"), "reject_scope_substitution"),
        (("重新打开", "重开", "重新判断", "reopen"), "reopen"),
        (("转争议", "争议", "dispute", "contested"), "dispute"),
        (("区分", "分化", "differentiate"), "differentiate"),
        (("加强", "强化", "解决", "strengthen", "resolve"), "strengthen"),
        (("降级", "downgrade"), "downgrade"),
        (("削弱", "weaken"), "weaken"),
        (("弃答", "暂不可判断", "abstain"), "abstain"),
        (("维持", "maintain", "unchanged"), "maintain"),
    )
    for tokens, canonical in aliases:
        if any(token in text for token in tokens):
            return canonical
    return text


def purge_error_responses(response_log: Path) -> int:
    rows = read_jsonl(response_log)
    kept = [row for row in rows if row.get("status") != "error"]
    removed = len(rows) - len(kept)
    if removed:
        response_log.write_text(
            "".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in kept),
            encoding="utf-8",
        )
    return removed


def load_yaml(path: Path) -> dict[str, Any]:
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8-sig"))
    except Exception as exc:  # noqa: BLE001
        raise EvalError(f"{path} 无法解析: {exc}") from exc
    if not isinstance(data, dict):
        raise EvalError(f"{path} 根节点必须为映射")
    return data


def dump_yaml(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        yaml.safe_dump(data, allow_unicode=True, sort_keys=False, width=120),
        encoding="utf-8",
    )


def dump_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def sha256_text(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def stable_hash(value: Any) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def parse_date(value: Any, label: str) -> date:
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError as exc:
        raise EvalError(f"{label} 不是有效日期: {value}") from exc


def resolve_repo_path(value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else REPO_ROOT / path


def require(mapping: dict[str, Any], keys: Iterable[str], label: str) -> None:
    for key in keys:
        if key not in mapping or mapping[key] in (None, "", []):
            raise EvalError(f"{label} 缺少 {key}")


def validate_profiles(path: Path, require_official: bool = False) -> dict[str, Any]:
    registry = load_yaml(path)
    require(registry, ["run_mode", "profiles", "role_bindings"], str(path))
    profiles = registry["profiles"]
    bindings = registry["role_bindings"]
    if not isinstance(profiles, dict) or not isinstance(bindings, dict):
        raise EvalError("模型 profiles 与 role_bindings 必须为映射")
    require(bindings, ["producer", "judges", "downstream_models"], "role_bindings")
    judge_names = list(bindings["judges"])
    downstream_names = list(bindings["downstream_models"])
    if len(judge_names) != 2 or len(set(judge_names)) != 2:
        raise EvalError("必须配置两个不同的评测模型档案")
    if len(downstream_names) != 2 or len(set(downstream_names)) != 2:
        raise EvalError("必须配置两个不同的下游模型档案")
    bound_names = [bindings["producer"], *judge_names, *downstream_names]
    for name in bound_names:
        if name not in profiles:
            raise EvalError(f"role_bindings 引用未知模型档案 {name}")
        profile = profiles[name]
        require(profile, ["model_id", "provider_family", "command"], f"profiles.{name}")
        if not isinstance(profile["command"], list) or not profile["command"]:
            raise EvalError(f"profiles.{name}.command 必须为非空数组")
    producer_id = profiles[bindings["producer"]]["model_id"]
    judge_ids = [profiles[name]["model_id"] for name in judge_names]
    downstream_ids = [profiles[name]["model_id"] for name in downstream_names]
    run_mode = str(registry["run_mode"])
    if run_mode not in {"development", "single_vendor", "official"}:
        raise EvalError(f"未知 run_mode: {run_mode}")
    single_vendor = run_mode == "single_vendor"
    distinct_ids = {producer_id, *judge_ids, *downstream_ids}

    if single_vendor:
        # 允许全部角色共用同一 model_id（如全 flash 冒烟）；有 ≥2 个 id 时仍禁止生产兼任评测/下游。
        if len(distinct_ids) >= 2:
            if producer_id in judge_ids:
                raise EvalError("生产模型不得兼任评测模型")
            if producer_id in downstream_ids:
                raise EvalError("生产模型不得兼任下游任务执行模型")
        registry.setdefault("isolation_notes", [])
        if not registry.get("isolation_notes"):
            if len(distinct_ids) < 2:
                registry["isolation_notes"] = [
                    "单模型 pilot：全部角色共用同一 model_id；仅验证管线，不得外推区分能力或正式可靠率。",
                ]
            else:
                registry["isolation_notes"] = [
                    "单供应商 pilot：允许评测与下游复用同一 model_id；S/C 仅作区分能力参考，不得外推为正式跨模型可靠率。",
                ]
    else:
        if producer_id in judge_ids:
            raise EvalError("生产模型不得兼任评测模型")
        if producer_id in downstream_ids:
            raise EvalError("生产模型不得兼任下游任务执行模型")
        if len(set(judge_ids)) != 2:
            raise EvalError("两个评测档案必须使用不同 model_id")
        if len(set(downstream_ids)) != 2:
            raise EvalError("两个下游执行档案必须使用不同 model_id")
        if set(judge_ids) & set(downstream_ids):
            raise EvalError("下游任务执行模型不得给自己的任务产出评分")

    # 声明资格是冻结运行的一部分。尤其不能让“同一模型扮演所有角色”的冒烟结果
    # 因校准分数较高而被误写成研究增益证据。
    if run_mode == "official":
        registry["evaluation_scope"] = "formal_independent"
        registry["research_gain_claim_eligible"] = True
    elif single_vendor and len(distinct_ids) >= 2:
        registry["evaluation_scope"] = "single_vendor_comparative"
        registry["research_gain_claim_eligible"] = True
    elif single_vendor:
        registry["evaluation_scope"] = "pipeline_only"
        registry["research_gain_claim_eligible"] = False
    else:
        registry["evaluation_scope"] = "development_only"
        registry["research_gain_claim_eligible"] = False

    official = run_mode in {"official", "single_vendor"} or require_official
    if official:
        blob = yaml.safe_dump(registry, allow_unicode=True)
        if "replace-with" in blob or "mock-" in blob or "REPLACE_" in blob:
            raise EvalError("正式模型配置仍含占位符或 mock 模型")
    return registry


def validate_case(case_path: Path) -> dict[str, Any]:
    case = load_yaml(case_path)
    require(
        case,
        [
            "case_id",
            "stratum",
            "task_input",
            "system_artifact",
            "evidence_pack_ref",
            "adjudication_ref",
            "perturbation_ref",
            "experiment",
            "isolation",
        ],
        str(case_path),
    )
    if case["stratum"] not in {"report_value", "restraint"}:
        raise EvalError(f"{case['case_id']} stratum 非法")
    task = case["task_input"]
    require(task, ["question", "object", "scope", "information_cutoff", "terminal_artifact_type"], "task_input")
    cutoff = parse_date(task["information_cutoff"], f"{case['case_id']} information_cutoff")
    artifact = case["system_artifact"]
    require(artifact, ["stage", "path", "allowed_terminal_status"], "system_artifact")
    artifact_path = resolve_repo_path(str(artifact["path"]))
    if not artifact_path.is_file():
        raise EvalError(f"{case['case_id']} 系统产物不存在: {artifact_path}")
    if case["stratum"] == "restraint" and str(artifact["stage"]) == "05":
        raise EvalError(f"{case['case_id']} restraint 案例不得强制升为05")

    evidence_path = case_path.parent / str(case["evidence_pack_ref"])
    adjudication_path = case_path.parent / str(case["adjudication_ref"])
    perturbation_path = case_path.parent / str(case["perturbation_ref"])
    for path in (evidence_path, adjudication_path, perturbation_path):
        if not path.is_file():
            raise EvalError(f"{case['case_id']} 缺少文件: {path}")

    evidence_pack = load_yaml(evidence_path)
    if evidence_pack.get("case_id") != case["case_id"]:
        raise EvalError(f"{case['case_id']} evidence.case_id 不一致")
    if str(evidence_pack.get("information_cutoff")) != str(task["information_cutoff"]):
        raise EvalError(f"{case['case_id']} evidence信息截止日与公开任务不一致")
    evidence = evidence_pack.get("evidence")
    if not isinstance(evidence, list) or len(evidence) < 3:
        raise EvalError(f"{case['case_id']} 至少需要3条冻结证据")
    evidence_ids: set[str] = set()
    for item in evidence:
        require(
            item,
            [
                "evidence_id",
                "publisher",
                "title",
                "source_url",
                "published_at",
                "business_time",
                "independence_group",
                "source_type",
                "statement_nature",
                "locator",
                "excerpt",
                "content_hash",
                "supports",
                "limits",
            ],
            f"{case['case_id']}.evidence[]",
        )
        eid = str(item["evidence_id"])
        if eid in evidence_ids:
            raise EvalError(f"{case['case_id']} 重复 evidence_id: {eid}")
        evidence_ids.add(eid)
        if parse_date(item["published_at"], f"{eid}.published_at") > cutoff:
            raise EvalError(f"{case['case_id']} {eid} 晚于信息截止日")
        expected_hash = sha256_text(str(item["excerpt"]))
        if item["content_hash"] != expected_hash:
            raise EvalError(f"{case['case_id']} {eid} 摘录哈希不匹配")
        if not str(item["source_url"]).startswith(("https://", "http://")):
            raise EvalError(f"{case['case_id']} {eid} source_url 非网页地址")

    adjudication = load_yaml(adjudication_path)
    if adjudication.get("case_id") != case["case_id"] or not adjudication.get("not_a_reference_report"):
        raise EvalError(f"{case['case_id']} 密封裁决契约标识错误")
    provenance = adjudication.get("provenance")
    if not isinstance(provenance, dict):
        raise EvalError(f"{case['case_id']} 密封契约缺少 provenance")
    mode = provenance.get("independence_mode")
    if mode not in SEALED_INDEPENDENCE_MODES:
        raise EvalError(f"{case['case_id']} provenance.independence_mode 非法")
    if provenance.get("framework_rules_usage") != "boundary_check_only":
        raise EvalError(f"{case['case_id']} 体系规则只能作为边界检查，不得直接作答")
    if mode == "pilot_manual":
        if not provenance.get("limitation") or not provenance.get("dual_route_required_for_expansion"):
            raise EvalError(f"{case['case_id']} 试点人工密封契约必须声明局限并要求扩展时双轨独立")
    if mode == "dual_route_independent":
        for field in ("route_a", "route_b", "coordinator"):
            if field not in provenance:
                raise EvalError(f"{case['case_id']} 双轨密封契约缺少 provenance.{field}")
    objective = adjudication.get("objective_checks")
    if not isinstance(objective, dict) or set(OBJECTIVE_CHECK_KEYS) - set(objective):
        raise EvalError(f"{case['case_id']} 密封契约缺少完整 objective_checks")
    if any(objective.get(key) != "required" for key in OBJECTIVE_CHECK_KEYS):
        raise EvalError(f"{case['case_id']} objective_checks 必须全部标记为 required")
    claims = adjudication.get("core_claims")
    if not isinstance(claims, list) or not 3 <= len(claims) <= 7:
        raise EvalError(f"{case['case_id']} 核心判断必须为3—7条")
    if not any(item.get("criticality") == "primary" for item in claims):
        raise EvalError(f"{case['case_id']} 至少需要一条primary判断")
    for claim in claims:
        require(
            claim,
            ["claim_id", "statement", "criticality", "strength_ceiling", "minimum_evidence_basket"],
            f"{case['case_id']}.core_claims[]",
        )
        if claim["criticality"] not in {"primary", "supporting", "boundary"}:
            raise EvalError(f"{claim['claim_id']} criticality 非法")
        basket = claim["minimum_evidence_basket"]
        if not isinstance(basket, list) or not basket:
            raise EvalError(f"{claim['claim_id']} 最低证据组合不得为空")
        unknown = set(basket) - evidence_ids
        if unknown:
            raise EvalError(f"{claim['claim_id']} 引用未知证据: {sorted(unknown)}")
    require(
        adjudication,
        [
            "allowed_disagreements",
            "strongest_counterevidence",
            "prohibited_expressions",
            "update_scenarios",
            "downstream_required_units",
        ],
        f"{case['case_id']}.adjudication",
    )

    perturbations = load_yaml(perturbation_path)
    items = perturbations.get("items")
    if not isinstance(items, list) or len(items) < 4:
        raise EvalError(f"{case['case_id']} 至少需要四项扰动")
    observed_types = {str(item.get("type")) for item in items}
    if not PERTURBATION_TYPES <= observed_types:
        raise EvalError(f"{case['case_id']} 扰动类型不完整: {sorted(PERTURBATION_TYPES - observed_types)}")
    for item in items:
        actions = item.get("acceptable_actions")
        if not isinstance(actions, list) or not actions:
            raise EvalError(f"{item.get('perturbation_id')} 缺少 acceptable_actions")
        unknown_actions = set(map(str, actions)) - set(PERTURBATION_ACTIONS)
        if unknown_actions:
            raise EvalError(f"{item.get('perturbation_id')} 含未知标准动作: {sorted(unknown_actions)}")
        if item.get("expected_action") is not None:
            raise EvalError(f"{item.get('perturbation_id')} 不得继续使用自由字符串 expected_action")

    isolation = case["isolation"]
    forbidden = set(isolation.get("producer_forbidden") or [])
    visible = set(isolation.get("producer_visible") or [])
    required_forbidden = {
        "system_artifact",
        "reasoning_materials",
        "sealed/adjudication.yaml",
        "../../calibration/defects.yaml",
    }
    if visible != {"task_input", "evidence.yaml"}:
        raise EvalError(f"{case['case_id']} 生产者只能看到task_input与evidence.yaml")
    if not required_forbidden <= forbidden or forbidden & visible:
        raise EvalError(f"{case['case_id']} 生产者密封隔离无效")
    if not isolation.get("adjudication_open_after_artifact_freeze"):
        raise EvalError(f"{case['case_id']} 未声明产物冻结后才打开裁决契约")
    axes = set(case["experiment"].get("axes") or [])
    if axes != {"R", "U", "delta", "S", "C"}:
        raise EvalError(f"{case['case_id']} 评测轴必须为R/U/delta/S/C")
    return {
        "case": case,
        "case_path": case_path,
        "artifact_path": artifact_path,
        "evidence": evidence_pack,
        "adjudication": adjudication,
        "perturbations": perturbations,
    }


def apply_defect(text: str, item: dict[str, Any]) -> str:
    operation = item.get("operation")
    if operation == "replace":
        target = str(item.get("target", ""))
        if not target or target not in text:
            raise EvalError(f"{item.get('defect_id')} 找不到注入锚点")
        return text.replace(target, str(item.get("replacement", "")), 1)
    if operation == "append":
        return text + str(item.get("replacement", ""))
    raise EvalError(f"{item.get('defect_id')} 不支持的operation: {operation}")


def validate_suite(suite_path: Path = SUITE_PATH) -> list[dict[str, Any]]:
    suite = load_yaml(suite_path)
    require(
        suite,
        ["suite_id", "status", "primary_outcomes", "guardrails", "cases", "run_policy", "future_expert_review"],
        str(suite_path),
    )
    if suite["primary_outcomes"] != ["R", "U", "delta"] or suite["guardrails"] != ["S", "C"]:
        raise EvalError("suite 顶层指标必须为R/U/delta，护栏必须为S/C")
    if not suite["run_policy"].get("no_composite_score"):
        raise EvalError("禁止综合总分")
    policy = suite["run_policy"]
    if policy.get("judge_models") != 2 or policy.get("repetitions_per_judge") != 3:
        raise EvalError("正式协议必须为两个评测模型、每个角色三次运行")
    if policy.get("prompt_variants") != ["A", "B"]:
        raise EvalError("正式协议必须配置A/B两套等价提示表述")
    expert = suite["future_expert_review"]
    if expert.get("required_for_pilot") or expert.get("target_sample_rate") != [0.05, 0.10]:
        raise EvalError("专家盲审应预留5%—10%字段，但不得设为首版前置条件")
    cases: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in suite["cases"]:
        case_id = row.get("case_id")
        if case_id in seen:
            raise EvalError(f"重复 case_id: {case_id}")
        seen.add(case_id)
        case_info = validate_case(EVAL_ROOT / str(row["path"]))
        if case_info["case"]["case_id"] != case_id:
            raise EvalError(f"suite 与 case.yaml 的case_id不一致: {case_id}")
        if case_info["case"]["stratum"] != row.get("stratum"):
            raise EvalError(f"{case_id} stratum 与suite不一致")
        cases.append(case_info)
    if seen != {"RV-T01", "RV-T02", "RV-T07", "RV-T08"}:
        raise EvalError("校准试点必须固定为RV-T01/RV-T02/RV-T07/RV-T08")

    defects = load_yaml(DEFECTS_PATH).get("items")
    if not isinstance(defects, list) or len(defects) != 11:
        raise EvalError("缺陷校准集必须恰好包含11类变体")
    case_map = {item["case"]["case_id"]: item for item in cases}
    defect_types: set[str] = set()
    for item in defects:
        require(
            item,
            [
                "defect_id",
                "defect_type",
                "base_case",
                "severity",
                "expected_dimension",
                "operation",
                "expected_location",
                "normal_should_rank_above",
            ],
            "defects[]",
        )
        if "replacement" not in item:
            raise EvalError(f"{item['defect_id']} 缺少 replacement")
        defect_types.add(str(item["defect_type"]))
        base = case_map.get(item["base_case"])
        if not base:
            raise EvalError(f"{item['defect_id']} 引用未知案例")
        normal = base["artifact_path"].read_text(encoding="utf-8-sig")
        mutated = apply_defect(normal, item)
        if mutated == normal:
            raise EvalError(f"{item['defect_id']} 未改变产物")
    if len(defect_types) != 11:
        raise EvalError("十一个校准变体必须覆盖十一种不同缺陷")
    metrics = load_yaml(METRICS_PATH)
    if not metrics.get("no_composite_score"):
        raise EvalError("指标契约禁止综合总分")
    primary = metrics.get("primary_outcomes") or {}
    guardrails = metrics.get("guardrails") or {}
    if (primary.get("U") or {}).get("threshold_status") != "pilot_threshold":
        raise EvalError("U阈值必须标记为pilot_threshold")
    if (guardrails.get("C") or {}).get("threshold_status") != "pilot_threshold":
        raise EvalError("C阈值必须标记为pilot_threshold")
    delta_metrics = primary.get("delta") or {}
    if delta_metrics.get("primary_baselines") != list(PRIMARY_PAIRWISE_BASELINES):
        raise EvalError("delta主对比基线必须为same_evidence_direct与evidence_summary")
    if "question_only" not in (delta_metrics.get("weak_baselines") or []):
        raise EvalError("问题直答必须保留为弱基线")
    contexts = suite.get("contexts") or {}
    if "同证据直接生成" not in str(contexts.get("C", "")):
        raise EvalError("上下文C必须为同证据直接生成报告主对比基线")
    pairwise = suite.get("pairwise_baselines") or {}
    if set(pairwise) != set(PRIMARY_PAIRWISE_BASELINES):
        raise EvalError("suite pairwise_baselines必须仅含两个主对比基线")
    prompts = load_yaml(PROMPTS_PATH)
    if set((prompts.get("prompt_variants") or {}).keys()) != {"A", "B"}:
        raise EvalError("提示词注册表缺少A/B等价表述")
    roles = set((prompts.get("roles") or {}).keys())
    for required_role in (
        "question_only_generator",
        "same_evidence_direct_generator",
        "evidence_summary_generator",
        "sealed_route_proposer",
        "sealed_route_coordinator",
    ):
        if required_role not in roles:
            raise EvalError(f"提示词注册表缺少角色: {required_role}")
    load_yaml(PROTOCOL_PATH)
    return cases


def blind_text(text: str, *, strip_body_labels: bool = False) -> str:
    normalized = text.replace("\r\n", "\n")
    if normalized.startswith("---\n"):
        parts = normalized.split("---\n", 2)
        if len(parts) == 3:
            normalized = parts[2]
    kept: list[str] = []
    for line in normalized.splitlines():
        if any(pattern.lower() in line.lower() for pattern in BANNED_BLIND_PATTERNS):
            if strip_body_labels:
                continue
            raise EvalError("正文中发现无法安全删除的内部质量、阶段或置信标签")
        if re.search(r"<!--\s*(material|source-annotation)-refs:", line, re.I):
            continue
        kept.append(line.rstrip())
    result = "\n".join(kept).strip() + "\n"
    if any(pattern.lower() in result.lower() for pattern in BANNED_BLIND_PATTERNS):
        raise EvalError("盲化结果仍含内部质量或流程标签")
    return result


def blind_candidate(text: str) -> str:
    """Remove process metadata and normalize the visible candidate title."""

    result = blind_text(text)
    lines = result.splitlines()
    for index, line in enumerate(lines):
        if re.match(r"^#\s+", line):
            lines[index] = "# 候选研究产物"
            break
    normalized = "\n".join(lines).strip() + "\n"
    if any(pattern.lower() in normalized.lower() for pattern in BANNED_BLIND_PATTERNS):
        raise EvalError("候选盲化后仍含内部质量、阶段或置信标签")
    return normalized


def blind_data(value: Any) -> Any:
    """Recursively remove internal process fields from structured reasoning material."""

    if isinstance(value, dict):
        cleaned: dict[str, Any] = {}
        for key, item in value.items():
            key_text = str(key).lower()
            if any(pattern.rstrip(":").lower() in key_text for pattern in BANNED_BLIND_PATTERNS):
                continue
            cleaned[str(key)] = blind_data(item)
        return cleaned
    if isinstance(value, list):
        return [blind_data(item) for item in value]
    return value


def conservative_median(levels: Iterable[int]) -> int:
    values = sorted(int(value) for value in levels)
    if not values:
        raise EvalError("无法对空等级集合聚合")
    return values[(len(values) - 1) // 2]


def apply_r_hard_gate(level: str, hard_failures: Iterable[Any]) -> int:
    if level not in R_ORDER:
        raise EvalError(f"非法R等级: {level}")
    return R_ORDER["R0"] if any(str(item).strip() for item in hard_failures) else R_ORDER[level]


def wilson_interval(successes: float, total: int, z: float = 1.6448536269514722) -> tuple[float, float]:
    if total <= 0:
        return (0.0, 0.0)
    p = successes / total
    denominator = 1.0 + z * z / total
    center = (p + z * z / (2 * total)) / denominator
    margin = z * math.sqrt((p * (1 - p) + z * z / (4 * total)) / total) / denominator
    return (max(0.0, center - margin), min(1.0, center + margin))


def grade_u(task_scores: dict[str, float], critical_error: bool) -> str:
    if critical_error:
        return "U0"
    passed = sum(task_scores.get(task, 0.0) >= threshold for task, threshold in U_THRESHOLDS.items())
    return {0: "U0", 1: "U1", 2: "U1", 3: "U2", 4: "U3"}[passed]


def grade_s(r_exact: float, downstream_agreement: float, flip_rate: float, r_span: int) -> str:
    if r_span >= 3 or (r_exact < 0.55 and downstream_agreement < 0.60):
        return "S0"
    if r_exact >= 0.80 and downstream_agreement >= 0.80 and flip_rate <= 0.10 and r_span <= 1:
        return "S3"
    if r_exact >= 0.65 and downstream_agreement >= 0.70 and flip_rate <= 0.20 and r_span < 3:
        return "S2"
    return "S1"


def grade_c(
    recall: float,
    false_kill: float,
    ranking: float,
    location: float,
    sensitivity: float,
    severity: float = 1.0,
    consistency: float = 1.0,
) -> str:
    if (
        recall >= 0.90
        and false_kill <= 0.10
        and ranking >= 0.90
        and location >= 0.80
        and sensitivity >= 0.80
        and severity >= 0.80
        and consistency >= 0.80
    ):
        return "C3"
    if (
        recall >= 0.80
        and false_kill <= 0.20
        and ranking >= 0.80
        and location >= 0.70
        and sensitivity >= 0.70
        and severity >= 0.70
        and consistency >= 0.70
    ):
        return "C2"
    if recall >= 0.60 and sensitivity >= 0.60:
        return "C1"
    return "C0"


def agreement_rate(values: Iterable[Any]) -> float:
    items = list(values)
    if not items:
        return 0.0
    return max(Counter(items).values()) / len(items)


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as exc:
            raise EvalError(f"{path}:{number} 不是有效JSON: {exc}") from exc
        if not isinstance(row, dict):
            raise EvalError(f"{path}:{number} 必须为JSON对象")
        rows.append(row)
    return rows


def append_jsonl(path: Path, row: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")


@dataclass
class AdapterSession:
    """Synchronous streaming JSONL adapter with retry and timeout handling."""

    command: list[str]
    model_id: str
    cwd: Path = REPO_ROOT
    timeout_seconds: float = 30.0
    max_retries: int = 2
    process: subprocess.Popen[str] | None = None

    def _start(self) -> None:
        self.close()
        self.process = subprocess.Popen(
            self.command,
            cwd=self.cwd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )

    def _readline(self) -> str:
        if not self.process or not self.process.stdout:
            raise EvalError("适配器进程未启动")
        ready, _, _ = select.select([self.process.stdout], [], [], self.timeout_seconds)
        if not ready:
            raise TimeoutError(f"适配器在{self.timeout_seconds}秒内无响应")
        line = self.process.stdout.readline()
        if not line:
            stderr = ""
            if self.process.stderr:
                stderr = self.process.stderr.read()
            raise EvalError(f"适配器提前退出: {stderr.strip()}")
        return line

    def send(self, request: dict[str, Any]) -> dict[str, Any]:
        errors: list[str] = []
        for attempt in range(self.max_retries + 1):
            try:
                if not self.process or self.process.poll() is not None:
                    self._start()
                assert self.process and self.process.stdin
                self.process.stdin.write(json.dumps(request, ensure_ascii=False) + "\n")
                self.process.stdin.flush()
                raw = self._readline()
                response = json.loads(raw)
                if not isinstance(response, dict):
                    raise EvalError("适配器响应必须为JSON对象")
                required = load_yaml(PROTOCOL_PATH)["response_required"]
                missing = [key for key in required if key not in response]
                if missing:
                    raise EvalError(f"适配器响应缺字段: {missing}")
                if response["request_id"] != request["request_id"]:
                    raise EvalError("适配器响应request_id不匹配")
                if response["status"] not in {"ok", "error"}:
                    raise EvalError("适配器响应status非法")
                return response
            except Exception as exc:  # noqa: BLE001
                errors.append(f"attempt={attempt + 1}: {exc}")
                self.close()
        return {
            "request_id": request["request_id"],
            "status": "error",
            "model_id": self.model_id,
            "text": "",
            "result": {},
            "usage": {},
            "latency_ms": 0,
            "error": "; ".join(errors),
        }

    def close(self) -> None:
        if not self.process:
            return
        process = self.process
        try:
            if process.stdin:
                process.stdin.close()
            process.terminate()
            process.wait(timeout=1)
        except Exception:  # noqa: BLE001
            try:
                process.kill()
                process.wait(timeout=1)
            except Exception:  # noqa: BLE001
                pass
        finally:
            for stream in (process.stdin, process.stdout, process.stderr):
                if stream and not stream.closed:
                    stream.close()
            self.process = None


def make_request(
    *,
    role: str,
    profile_name: str,
    profile: dict[str, Any],
    case_id: str,
    payload: dict[str, Any],
    seed: int,
    prompt_variant: str,
    request_suffix: str,
    case_hash: str,
    response_schema: dict[str, Any] | None = None,
) -> dict[str, Any]:
    prompts = load_yaml(PROMPTS_PATH)
    role_prompt = prompts["roles"].get(role)
    if not role_prompt:
        raise EvalError(f"缺少角色提示词: {role}")
    variant_instruction = (prompts.get("prompt_variants") or {}).get(prompt_variant)
    if not variant_instruction:
        raise EvalError(f"缺少提示词等价表述: {prompt_variant}")
    request_id = "REQ-" + stable_hash(
        [case_id, role, profile_name, seed, prompt_variant, request_suffix, case_hash, stable_hash(payload)]
    )[:24]
    return {
        "request_id": request_id,
        "role": role,
        "model_profile": profile_name,
        "messages": [
            {"role": "system", "content": f"{role_prompt['system']}\n{variant_instruction}"},
            {
                "role": "user",
                "content": json.dumps(
                    {"prompt_variant": prompt_variant, "payload": payload},
                    ensure_ascii=False,
                    sort_keys=True,
                ),
            },
        ],
        "temperature": 0.2,
        "seed": seed,
        "max_output_tokens": role_output_tokens(role, payload),
        "response_schema": response_schema or ROLE_RESPONSE_SCHEMAS.get(role) or {"type": "object"},
        "prompt_version": prompts["prompt_version"],
        "case_hash": case_hash,
        "metadata": {
            "case_id": case_id,
            "role": role,
            "profile_name": profile_name,
            "model_id": profile["model_id"],
            "seed": seed,
            "prompt_variant": prompt_variant,
            "request_suffix": request_suffix,
        },
    }


def execute_request(
    request: dict[str, Any],
    session: AdapterSession,
    request_log: Path,
    response_log: Path,
    existing: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    request_id = request["request_id"]
    if request_id in existing:
        return existing[request_id]
    append_jsonl(request_log, request)
    started = time.monotonic()
    response = session.send(request)
    response["latency_ms"] = response.get("latency_ms") or int((time.monotonic() - started) * 1000)
    response["request_metadata"] = request["metadata"]
    append_jsonl(response_log, response)
    existing[request_id] = response
    return response


def close_sessions(sessions: dict[str, AdapterSession]) -> None:
    for session in sessions.values():
        session.close()
