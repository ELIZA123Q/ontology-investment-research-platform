from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Any


THESIS_STATUSES = {
    "formed", "conditional", "watch", "not_formed", "blocked", "expired", "rewrite",
}
EXPECTATION_BASELINE_TERMS = ("超预期", "低估", "高估", "低估了", "高估了", "mispriced", "underpriced", "overpriced")
EQUITY_REPORT_TEMPLATE = Path(__file__).resolve().parents[2] / "研究能力" / "报告模板" / "a_share_equity_thesis.md"


def _nonempty(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _strings(value: Any, *, minimum: int = 1) -> bool:
    return isinstance(value, list) and len(value) >= minimum and all(_nonempty(item) for item in value)


def validate_research_design(payload: dict[str, Any], contract: dict[str, Any]) -> None:
    """Validate the submitted pre-evidence design; structure is not evidence or a judgment."""

    for field in ("information_cutoff", "horizon", "decision_use", "primary_question", "main_contradiction"):
        if not _nonempty(payload.get(field)):
            raise ValueError(f"ResearchDesign 缺少 {field}")
    try:
        cutoff = date.fromisoformat(str(payload["information_cutoff"])[:10])
    except ValueError as exc:
        raise ValueError("ResearchDesign information_cutoff 日期无效") from exc
    requested_cutoff = contract.get("information_cutoff")
    if requested_cutoff is not None:
        try:
            expected = date.fromisoformat(str(requested_cutoff)[:10])
        except ValueError as exc:
            raise ValueError("研究请求 information_cutoff 日期无效") from exc
        if cutoff != expected:
            raise ValueError("ResearchDesign information_cutoff 与请求不一致")
    for field in ("decision_use", "primary_question"):
        requested_value = contract.get(field)
        if requested_value is not None and payload[field].strip() != str(requested_value).strip():
            raise ValueError(f"ResearchDesign {field} 与请求不一致")

    hypotheses = payload.get("hypotheses")
    if not isinstance(hypotheses, list) or len(hypotheses) < 2:
        raise ValueError("ResearchDesign 至少需要主假设与竞争假设")
    roles: list[str] = []
    for item in hypotheses:
        if not isinstance(item, dict) or any(
            not _nonempty(item.get(field)) for field in ("claim", "observable_prediction", "falsifier")
        ):
            raise ValueError("ResearchDesign 假设缺少命题、预测或反证")
        role = item.get("role")
        if role not in {"main", "competing"}:
            raise ValueError("ResearchDesign 假设角色无效")
        roles.append(role)
    if roles.count("main") != 1 or "competing" not in roles:
        raise ValueError("ResearchDesign 须有一条主假设与至少一条竞争假设")

    evidence_plan = payload.get("evidence_plan")
    if not isinstance(evidence_plan, list) or not evidence_plan:
        raise ValueError("ResearchDesign 缺少证据方案")
    for item in evidence_plan:
        if not isinstance(item, dict) or any(
            not _nonempty(item.get(field)) for field in ("question", "preferred_source", "distinguishing_signal")
        ):
            raise ValueError("ResearchDesign 证据方案缺少问题、优先来源或区分信号")

    if not _strings(payload.get("stop_conditions")) or not _strings(payload.get("monitoring_triggers")):
        raise ValueError("ResearchDesign 缺少停止条件或监测触发点")
    selected_frameworks = contract.get("framework_refs") or []
    if payload.get("framework_refs") != selected_frameworks:
        raise ValueError("ResearchDesign 框架引用与已选方法不一致")
    reasons = payload.get("framework_selection_reasons")
    if not isinstance(reasons, dict) or any(not _nonempty(reasons.get(ref)) for ref in selected_frameworks):
        raise ValueError("ResearchDesign 缺少框架选择理由")
    if payload.get("personal_principle_refs", []) != contract.get("personal_principle_refs", []):
        raise ValueError("ResearchDesign 个人原则引用与已确认选择不一致")
    if payload.get("analyst_lens_refs", []) != contract.get("analyst_lens_refs", []):
        raise ValueError("ResearchDesign 分析师视角引用与已选视角不一致")
    causal_refs = payload.get("causal_design_refs", [])
    if contract.get("causal_identification_required"):
        if not _strings(causal_refs):
            raise ValueError("因果研究的 ResearchDesign 缺少 causal_design_refs")
    elif causal_refs:
        raise ValueError("非因果研究的 ResearchDesign 不得声明 causal_design_refs")


def validate_equity_report(payload: dict[str, Any], contract: dict[str, Any]) -> None:
    """Require an A10-facing presentation without changing its judgment gate."""

    for field in contract["required_fields"]:
        if field in {"shortest_evidence_chain", "judgment_refs", "monitoring_triggers"}:
            if not _strings(payload.get(field)):
                raise ValueError(f"A股权益报告缺少 {field}")
        elif not _nonempty(payload.get(field)):
            raise ValueError(f"A股权益报告缺少 {field}")
    requested_cutoff = contract.get("information_cutoff")
    if requested_cutoff is not None and str(payload["information_cutoff"])[:10] != str(requested_cutoff)[:10]:
        raise ValueError("A股权益报告信息截面与研究请求不一致")
    if payload["thesis_status"] not in THESIS_STATUSES:
        raise ValueError("A股权益报告命题状态不属于 A10 七类结论")
    if any(field in payload for field in contract["forbidden_fields"]):
        raise ValueError("A股权益报告不得包含交易、仓位、目标价或择时字段")
    expectation_text = "\n".join(
        str(payload.get(field, ""))
        for field in ("market_implied_view", "research_difference", "expectation_and_valuation")
    )
    if any(term in expectation_text for term in EXPECTATION_BASELINE_TERMS) and not _nonempty(
        payload.get("expectation_baseline_ref")
    ):
        raise ValueError("超预期、低估或高估表达必须引用明确的事前预期基线")
    if contract.get("causal_identification_required"):
        if not _nonempty(payload.get("causal_summary")) or not _strings(
            payload.get("causal_assessment_refs")
        ):
            raise ValueError("因果研究报告缺少因果识别结论或评估引用")


def render_equity_report(payload: dict[str, Any], *, title: str) -> str:
    """Project validated A10-facing fields into the repository's readable template."""

    template = EQUITY_REPORT_TEMPLATE.read_text(encoding="utf-8")
    values = {**payload, "title": title}
    values["shortest_evidence_chain"] = "\n".join(f"- {item}" for item in payload["shortest_evidence_chain"])
    values["judgment_refs"] = "\n".join(f"- {item}" for item in payload["judgment_refs"])
    values["monitoring_triggers"] = "\n".join(f"- {item}" for item in payload["monitoring_triggers"])
    if payload.get("causal_summary"):
        refs = "、".join(payload.get("causal_assessment_refs") or [])
        values["causal_section"] = f"{payload['causal_summary']}\n\n因果评估引用：{refs}"
    else:
        values["causal_section"] = "本研究未启用因果识别流程，相关表述不构成因果判断。"
    for key, value in values.items():
        template = template.replace("{{ " + key + " }}", str(value))
    if "{{" in template:
        raise ValueError("A股权益报告模板仍有未填充字段")
    return template
