from __future__ import annotations

from copy import deepcopy
from pathlib import Path

import pytest
import yaml

from ir_platform.methodology import ResearchMethodRegistry
from ir_platform.planning import ResearchPlanningService


ROOT = Path(__file__).resolve().parents[1]


def test_method_registry_validates_and_resolves_declared_methodology() -> None:
    registry = ResearchMethodRegistry()
    selection = registry.resolve_for_request(
        {
            "methodology": {
                "judgment_types": ["trend_direction"],
                "framework_refs": ["BF-SD-01", "IF-SC-01"],
                "domain": "semiconductor",
            }
        }
    )
    assert selection["declared"] is True
    assert selection["evidence_method_refs"] == ["A02", "A03", "A08"]
    assert selection["reasoning_method_refs"] == ["R00", "R00-COUNTER", "R00-REVISION", "R02"]
    assert selection["framework_refs"] == ["BF-SD-01", "IF-SC-01"]
    assert selection["domain_catalog"].endswith("研究方法/半导体/research-catalog.yaml")


def test_planner_records_methodology_in_plan_context_and_context_node() -> None:
    proposal = ResearchPlanningService().propose(
        {
            "id": "method-aware-plan",
            "mode": "full_research",
            "methodology": {
                "judgment_types": ["cycle_phase"],
                "framework_refs": ["IF-SC-01"],
                "domain": "semiconductor",
            },
        },
        {"evidence_ready": False},
    )
    assert proposal.context["methodology"]["evidence_method_refs"] == ["A02", "A03", "A08"]
    assert proposal.context["methodology"]["reasoning_method_refs"][-1] == "R03"
    context_node = next(item for item in proposal.nodes if item.id == "context")
    assert context_node.parameters["methodology"] == proposal.context["methodology"]


def test_unknown_methodology_reference_is_rejected() -> None:
    registry = ResearchMethodRegistry()
    with pytest.raises(ValueError, match="未知研究框架"):
        registry.resolve_for_request({"methodology": {"framework_refs": ["invented"]}})


def test_a_share_equity_request_defaults_to_macro_screen_and_registered_frameworks() -> None:
    registry = ResearchMethodRegistry()
    selection = registry.resolve_for_request(
        {
            "asset_class": "equity",
            "market_scope": "A_share",
            "methodology": {"framework_refs": ["BF-SD-01"]},
        }
    )

    assert selection["macro_mode"] == "screen"
    assert selection["macro_context_required"] is True
    assert selection["framework_refs"] == ["BF-SD-01", "BF-MF-01", "BF-PI-01", "BF-EF-01"]
    assert "single_macro_score" in selection["macro_context_contract"]["forbidden_outputs"]


def test_legacy_request_remains_compatible_without_keyword_macro_routing() -> None:
    selection = ResearchMethodRegistry().resolve_for_request(
        {"title": "A股半导体行业研究", "methodology": {"framework_refs": ["BF-SD-01"]}}
    )

    assert selection["macro_mode"] is None
    assert selection["macro_context_required"] is False
    assert selection["framework_refs"] == ["BF-SD-01"]


@pytest.mark.parametrize(
    ("input_request", "message"),
    [
        (
            {
                "asset_class": "equity",
                "market_scope": "A_share",
                "methodology": {"macro_mode": "always_full"},
            },
            "screen 或 deep",
        ),
        (
            {"asset_class": "bond", "methodology": {"macro_mode": "screen"}},
            "只适用于 asset_class=equity",
        ),
    ],
)
def test_invalid_macro_request_contract_is_rejected(input_request: dict, message: str) -> None:
    with pytest.raises(ValueError, match=message):
        ResearchMethodRegistry().resolve_for_request(input_request)


def test_equity_without_a_share_scope_keeps_legacy_macro_compatibility() -> None:
    selection = ResearchMethodRegistry().resolve_for_request({"asset_class": "equity", "methodology": {}})
    assert selection["macro_mode"] is None
    assert selection["macro_context_required"] is False


def test_planner_injects_macro_contract_into_context_node() -> None:
    proposal = ResearchPlanningService().propose(
        {
            "id": "a-share-macro-aware-plan",
            "mode": "full_research",
            "asset_class": "equity",
            "market_scope": "A_share",
            "methodology": {"macro_mode": "deep"},
        },
        {"evidence_ready": False},
    )

    assert proposal.context["methodology"]["macro_mode"] == "deep"
    assert {"BF-MF-01", "BF-PI-01", "BF-EF-01"} <= set(proposal.context["methodology"]["framework_refs"])
    assert {"BF-IC-01", "BF-SD-01", "BF-VA-01"} <= set(proposal.context["methodology"]["framework_refs"])
    context_node = next(item for item in proposal.nodes if item.id == "context")
    assert context_node.parameters["methodology"]["macro_context_required"] is True


def test_historical_equity_requests_can_be_replayed_with_macro_context_without_rewriting_outputs() -> None:
    request_paths = [
        ROOT / "research_outputs" / "a-share-semiconductor-2026h1" / "request.yaml",
        ROOT / "research_outputs" / "a-share-innovative-drugs-one-month-2026-09-08" / "request.yaml",
    ]
    registry = ResearchMethodRegistry()

    for request_path in request_paths:
        request = yaml.safe_load(request_path.read_text(encoding="utf-8"))
        request["asset_class"] = "equity"
        request["market_scope"] = "A_share"
        request.setdefault("methodology", {})["macro_mode"] = "deep"
        selection = registry.resolve_for_request(request)
        assert {"BF-MF-01", "BF-PI-01", "BF-EF-01"} <= set(selection["framework_refs"])


def _valid_macro_context() -> dict:
    return {
        "as_of": "2026-09-14",
        "horizon": "one_quarter",
        "mode": "deep",
        "economic_direction": {
            "conclusion": "mixed",
            "confidence": "medium",
            "state_axes": ["activity", "inflation"],
            "decisive_evidence_refs": ["evidence:economy"],
            "competing_explanation": "结构分化",
        },
        "policy_stance": {
            "conclusion": "supportive",
            "confidence": "medium",
            "signal_execution_gap": "工具已执行但主体响应仍待确认",
            "evidence_layers": ["signal", "tool", "execution"],
            "decisive_evidence_refs": ["evidence:policy"],
        },
        "funding_conditions": {
            "entity_financing": {
                "conclusion": "mixed",
                "confidence": "medium",
                "evidence_dimensions": ["price", "availability"],
            },
            "equity_market": {
                "conclusion": "balanced",
                "confidence": "medium",
                "evidence_channels": ["long_term_institution", "leverage"],
                "net_equity_supply_checked": True,
                "balance_or_stock_checked": True,
            },
            "decisive_evidence_refs": ["evidence:funding"],
        },
        "regime_synthesis": {
            "alignment": "divergent",
            "target_materiality": "high",
            "industry_style_map": [],
            "transmission_limits": [],
        },
        "stop_conditions": [],
        "monitoring_triggers": [],
        "downstream_handoffs": ["BF-EG-01"],
    }


def test_valid_macro_context_preserves_divergence_instead_of_forcing_score() -> None:
    context = _valid_macro_context()
    assert ResearchMethodRegistry().validate_macro_context(context) is context


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (
            lambda context: context["policy_stance"].update(evidence_layers=["signal"]),
            "政策表态不能单独定性",
        ),
        (
            lambda context: context["funding_conditions"]["entity_financing"].update(
                conclusion="loose", evidence_dimensions=["aggregate_social_financing"]
            ),
            "至少需要.*两个证据维度",
        ),
        (
            lambda context: context["funding_conditions"]["equity_market"].update(
                conclusion="loose", evidence_channels=["etf_flow"]
            ),
            "至少需要两个.*资金渠道",
        ),
        (
            lambda context: context["regime_synthesis"].update(alignment="aligned"),
            "不能输出 aligned",
        ),
        (
            lambda context: context.update(single_macro_score=80),
            "包含禁止输出",
        ),
    ],
)
def test_macro_context_rejects_cross_layer_shortcuts(mutate, message: str) -> None:
    context = deepcopy(_valid_macro_context())
    mutate(context)
    with pytest.raises(ValueError, match=message):
        ResearchMethodRegistry().validate_macro_context(context)
