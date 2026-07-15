#!/usr/bin/env python3
"""Deterministic streaming JSONL adapter used only for protocol and pipeline tests."""

from __future__ import annotations

import argparse
import json
import sys
import time
from typing import Any


MOCK_CLAIMS = {
    "RV-T01": [
        ("价格与订单仍支持稀缺定价强化", "primary"),
        ("HBM、通用DRAM与NAND必须分产品判断", "primary"),
        ("2027H2附近只是供给验证窗口而非结束日", "boundary"),
    ],
    "RV-T02": [
        ("管制持续但并非所有海外设备归零", "primary"),
        ("国产替代主逻辑不变但商业兑现按类别分化", "primary"),
        ("复购、跨线复制和再认证决定近端兑现", "primary"),
    ],
    "RV-T07": [
        ("DDR4价格与采购存在改善信号", "primary"),
        ("库存回补与抢运构成竞争解释", "primary"),
        ("可持续景气改善尚未确认，应保留争议", "primary"),
    ],
    "RV-T08": [
        ("统一周期结束月份暂不可判断", "primary"),
        ("三类产品和应用节奏不同步", "primary"),
        ("供给节点只是验证窗口而非结束日", "boundary"),
    ],
}


def payload_from(request: dict[str, Any]) -> dict[str, Any]:
    messages = request.get("messages") or []
    if not messages:
        return {}
    raw = json.loads(messages[-1].get("content") or "{}")
    return raw.get("payload") or {}


def mock_artifact(case_id: str, kind: str, target_length: int) -> str:
    claims = MOCK_CLAIMS[case_id]
    heading = "普通问题直答稿" if kind == "direct" else "同证据条件摘要稿"
    body = [f"# {heading}", ""]
    for index, (statement, _) in enumerate(claims, 1):
        body.append(f"## 判断{index}\n\n{statement}。本段为确定性mock输出，仅用于验证协议，不代表真实研究判断。")
    text = "\n\n".join(body) + "\n"
    filler = "证据、边界、反证与跟踪条件应分别记录。"
    while len(text) < max(target_length, 600):
        text += filler
    return text


def build_result(request: dict[str, Any], profile: str) -> dict[str, Any]:
    role = request["role"]
    meta = request.get("metadata") or {}
    case_id = meta.get("case_id")
    seed = int(request.get("seed") or 11)
    payload = payload_from(request)

    if role in {"direct_generator", "evidence_summary_generator"}:
        kind = "direct" if role == "direct_generator" else "summary"
        text = mock_artifact(case_id, kind, int(payload.get("target_length") or 900))
        return {"artifact_text": text, "target_length_followed": True}

    if role == "claim_extractor":
        claims = [
            {
                "claim_id": f"{case_id}-M{index}",
                "statement": statement,
                "location": f"mock-section-{index}",
                "criticality": criticality,
                "directly_answers_question": criticality == "primary",
            }
            for index, (statement, criticality) in enumerate(MOCK_CLAIMS[case_id], 1)
        ]
        return {"claims": claims, "extraction_only": True}

    if role == "claim_reconciler":
        extracts = payload.get("extractor_results") or []
        contracts = payload.get("sealed_claim_contract") or []
        for item in extracts:
            claims = item.get("claims") if isinstance(item, dict) else None
            if claims:
                reconciled = []
                for index, claim in enumerate(claims[:7]):
                    enriched = dict(claim)
                    if index < len(contracts):
                        contract = contracts[index]
                        enriched.update(
                            {
                                "contract_claim_id": contract.get("claim_id"),
                                "criticality": contract.get("criticality"),
                                "minimum_evidence_basket": contract.get("minimum_evidence_basket"),
                                "strength_ceiling": contract.get("strength_ceiling"),
                            }
                        )
                    reconciled.append(enriched)
                return {
                    "claims": reconciled,
                    "disagreements": [],
                    "uncovered_contract_claims": [
                        contract.get("claim_id") for contract in contracts[len(reconciled):]
                    ],
                }
        return {"claims": []}

    if role == "evidence_reviewer":
        evidence = payload.get("evidence") or []
        return {
            "verdict": "supported_with_limits",
            "fact_accuracy": "pass",
            "basket_complete": len(evidence) >= 3,
            "cited_evidence_ids": [item.get("evidence_id") for item in evidence[:2]],
            "material_limit": "范围或预测口径仍需保留",
            "severity": "minor",
        }

    if role == "reasoning_reviewer":
        return {
            "verdict": "supported_with_limits",
            "path_complete": True,
            "causal_overreach": False,
            "scope_overreach": False,
            "strength_within_ceiling": True,
            "located_step": "mock-reasoning-step",
            "severity": "minor",
        }

    if role == "adversarial_reviewer":
        return {
            "strongest_counterevidence": "库存、需求或执行条件可能使当前方向降级",
            "competing_explanation": "短期补库、单一公司样本或未来计划可能放大表象",
            "single_point_dependency": "关键价格或执行证据",
            "leave_one_out_result": "删除关键证据后应至少降级一级",
            "most_likely_falsifier": "连续两个观察期出现反向共振",
        }

    if role == "arbiter":
        base = 3 if case_id == "RV-T08" else 2
        if profile == "judge_b" and seed == 33 and case_id in {"RV-T01", "RV-T02"}:
            base = 3
        return {
            "claim_r": f"R{base}",
            "reason": "三份独立审阅支持该等级，仍保留范围与更新条件",
            "weakest_claim": meta.get("claim_id") or "mock-claim",
            "strongest_counterevidence": "库存、需求或执行条件反向变化",
            "major_disagreement": "远期供给与需求强度",
            "hard_failures": [],
            "no_new_argument_added": True,
        }

    if role in {
        "downstream_core_restatement",
        "downstream_tracking_plan",
        "downstream_information_update",
        "downstream_research_questions",
    }:
        task = meta.get("task_id", role.removeprefix("downstream_"))
        return {
            "task_id": task,
            "answer": f"mock下游任务产出：{task}",
            "used_new_information": payload.get("new_information_scenario"),
            "self_score": None,
        }

    if role == "downstream_scorer":
        context_id = meta.get("context_id", "A")
        task = meta.get("task_id")
        base_scores = {"A": 0.56, "B": 0.70, "C": 0.72, "D": 0.89, "E": 0.93}
        adjustment = {
            "core_restatement": 0.02,
            "tracking_plan": 0.00,
            "information_update": -0.04,
            "research_questions": -0.02,
        }[task]
        variation = 0.01 if (profile.endswith("b") and seed == 22) else 0.0
        score = max(0.0, min(1.0, base_scores[context_id] + adjustment + variation))
        total_errors = max(0, round((1.0 - score) * 5))
        return {
            "task_id": task,
            "context_id": context_id,
            "score": round(score, 4),
            "critical_error": False,
            "error_count": total_errors,
            "error_counts": {
                "fact": total_errors,
                "reasoning": max(0, total_errors - 1),
                "extrapolation": max(0, total_errors - 1),
            },
            "misread_rate": 0.0 if context_id in {"D", "E"} else round((1.0 - score) / 4, 4),
            "specific_evidence": ["mock-unit-1", "mock-unit-2"],
        }

    if role == "pairwise":
        baseline = meta.get("baseline")
        judge_index = 0 if profile == "judge_a" else 1
        run_index = judge_index * 3 + [11, 22, 33].index(seed)
        if baseline == "direct_report":
            normalized = ["D", "D", "D", "D", "tie", "baseline"][run_index]
        else:
            normalized = ["D", "D", "D", "D", "tie", "baseline"][run_index]
        order = meta.get("candidate_order") or ["D", "baseline"]
        if normalized == "tie":
            winner = "tie"
        else:
            winner = "candidate_1" if order[0] == normalized else "candidate_2"
        return {
            "winner": winner,
            "rationale": "mock按可靠性、增量、跟踪和边界进行成对比较",
            "cited_locations": ["mock-section-1"],
        }

    if role == "calibration":
        return {
            "defect_detected": True,
            "detected_category": meta.get("defect_type"),
            "located_at": meta.get("expected_location"),
            "detected_severity": meta.get("severity"),
            "location_correct": True,
            "severity_correct": True,
            "normal_ranked_higher": True,
        }

    if role == "calibration_clean":
        return {"false_kill": False, "clean_accepted": True}

    if role == "perturbation":
        return {
            "action": meta.get("expected_action"),
            "sensitivity_passed": True,
            "rationale": "mock扰动按预设单调性变化",
        }

    return {"acknowledged": True}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", required=True)
    args = parser.parse_args()
    model_id = f"mock-{args.profile}-v1"
    for line in sys.stdin:
        started = time.monotonic()
        try:
            request = json.loads(line)
            result = build_result(request, args.profile)
            response = {
                "request_id": request["request_id"],
                "status": "ok",
                "model_id": model_id,
                "text": json.dumps(result, ensure_ascii=False),
                "result": result,
                "usage": {"input_tokens": 1, "output_tokens": 1},
                "latency_ms": int((time.monotonic() - started) * 1000),
                "error": "",
            }
        except Exception as exc:  # noqa: BLE001
            response = {
                "request_id": "unknown",
                "status": "error",
                "model_id": model_id,
                "text": "",
                "result": {},
                "usage": {},
                "latency_ms": int((time.monotonic() - started) * 1000),
                "error": str(exc),
            }
        sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
