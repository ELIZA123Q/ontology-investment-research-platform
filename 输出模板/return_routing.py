#!/usr/bin/env python3
"""Cross-stage return routing helpers for publish validation."""

from __future__ import annotations

import re
from typing import Any

from quality_gate_utils import RETURN_STAGES, normalize_return_required, stage_sort_key


ERROR_ROUTE_RULES: list[tuple[re.Pattern[str], str, str]] = [
    (re.compile(r"01|需求|对象|范围|歧义|投研需求", re.I), "01", "requirement_gap"),
    (
        re.compile(
            r"02|判断脊柱|问题树|路径结构|judgment_unit|反面证据|其他可能解释|最低验证|本体视图|研究逻辑|state_variable_chain|upstream 02",
            re.I,
        ),
        "02",
        "structure_gap",
    ),
    (re.compile(r"05|主题深度研究|研究员交付|合规声明|成稿章节", re.I), "05", "deliverable_gap"),
    (re.compile(r"material|图表|report_grade|04_05_materials|素材", re.I), "03", "material_gap"),
    (
        re.compile(
            r"03|证据|来源|口径|反证|coverage|admission|快照|manifest|取证|search_status|judgment_unit_readiness",
            re.I,
        ),
        "03",
        "evidence_gap",
    ),
    (re.compile(r"04|观点|claim|报告|审计|超过.*上限|conclusion|reasoning_report|reasoning_audit", re.I), "04", "expression_gap"),
]

BLOCKED_UPSTREAM_ROUTE: dict[str, str] = {
    "02": "01",
    "03": "02",
    "04": "03",
    "05": "04",
}

DEFAULT_FAILED_STAGE_ROUTE: dict[str, str] = {
    "01": "01",
    "02": "02",
    "03": "03",
    "04": "04",
    "05": "05",
    "publish": "03",
}


def infer_route_from_error(error: str, *, failed_stage: str) -> dict[str, str]:
    text = error.strip()
    prefix_match = re.match(r"^(0[1-5])(?:-report|-audit)?:\s", text)
    if prefix_match:
        stage = prefix_match.group(1)
        return {
            "return_stage": stage,
            "reason_code": "validation_failure",
            "reason": text,
            "source_stage": failed_stage,
        }
    for pattern, stage, reason_code in ERROR_ROUTE_RULES:
        if pattern.search(text):
            return {
                "return_stage": stage,
                "reason_code": reason_code,
                "reason": text,
                "source_stage": failed_stage,
            }
    fallback = DEFAULT_FAILED_STAGE_ROUTE.get(failed_stage, "03")
    return {
        "return_stage": fallback,
        "reason_code": "validation_failure",
        "reason": text,
        "source_stage": failed_stage,
    }


def _normalize_stage_key(stage: str) -> str:
    if stage.startswith("04"):
        return "04"
    if stage.startswith("05"):
        return "05"
    return stage


def collect_declared_returns(artifacts_meta: list[dict[str, Any]]) -> list[dict[str, str]]:
    declared: list[dict[str, str]] = []
    for item in artifacts_meta:
        meta = item.get("meta")
        if not isinstance(meta, dict):
            continue
        if not normalize_return_required(meta.get("return_required")):
            continue
        return_stage = str(meta.get("return_stage", "")).strip()
        if return_stage not in RETURN_STAGES:
            continue
        declared.append(
            {
                "return_stage": return_stage,
                "reason_code": "declared_return_required",
                "reason": str(item.get("label", "")),
                "source_stage": str(item.get("stage", "")),
            }
        )
    return declared


def build_return_plan(
    stage_results: dict[str, object],
    errors: list[str],
    *,
    declared_returns: list[dict[str, str]] | None = None,
) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()

    def add(item: dict[str, str]) -> None:
        key = (item["return_stage"], item.get("reason_code", ""))
        if key in seen:
            return
        seen.add(key)
        items.append(item)

    if declared_returns:
        for decl in declared_returns:
            add(decl)

    for stage, result in stage_results.items():
        if not isinstance(result, dict):
            continue
        stage_key = _normalize_stage_key(stage)
        status = str(result.get("status", ""))
        if status == "fail":
            error = str(result.get("error", ""))
            add(infer_route_from_error(error, failed_stage=stage_key))
        elif status == "missing":
            add(
                {
                    "return_stage": stage_key,
                    "reason_code": "missing_artifact",
                    "reason": f"{stage_key} 产物缺失",
                    "source_stage": stage_key,
                }
            )
        elif status == "blocked":
            upstream = BLOCKED_UPSTREAM_ROUTE.get(stage_key, stage_key)
            add(
                {
                    "return_stage": upstream,
                    "reason_code": "blocked_upstream",
                    "reason": f"{stage_key} 被上游阻断，需先修复 {upstream}",
                    "source_stage": stage_key,
                }
            )

    for error in errors:
        add(infer_route_from_error(error, failed_stage="publish"))

    items.sort(key=lambda item: stage_sort_key(item["return_stage"]))
    return items


def primary_return_stage(return_plan: list[dict[str, str]]) -> str | None:
    if not return_plan:
        return None
    return return_plan[0]["return_stage"]
