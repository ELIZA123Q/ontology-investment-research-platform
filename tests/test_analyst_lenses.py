from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from ir_platform.methodology import ResearchMethodRegistry
from ir_platform.planning import ResearchPlanningService


ROOT = Path(__file__).resolve().parents[1]


def _request_with_lenses(refs: list[str], horizon: str, reasons: dict[str, str]) -> dict:
    return {
        "asset_class": "equity",
        "market_scope": "A_share",
        "information_cutoff": "2026-09-08T15:00:00+08:00",
        "methodology": {
            "analyst_lens_refs": refs,
            "analyst_lens_horizon": horizon,
            "analyst_lens_selection_reasons": reasons,
        },
    }


def test_cards_are_source_backed_falsifiable_and_link_only_to_registered_frameworks() -> None:
    registry = ResearchMethodRegistry()
    assert {card["author"] for card in registry.analyst_lenses.values()} == {
        "高善文", "周金涛", "郭磊", "张忆东"
    }
    for card in registry.analyst_lenses.values():
        assert card["source"]["url"].startswith("https://")
        assert card["source"]["published_on"]
        assert card["source"]["locator"]
        assert card["related_primary_sources"]
        assert all(source["contribution"] for source in card["related_primary_sources"])
        assert card["theoretical_structure"] and card["research_operationalization"]
        source_ids = {card["source"]["id"]} | {
            source["id"] for source in card["related_primary_sources"]
        }
        assert all(set(component["source_refs"]) <= source_ids for component in card["theoretical_structure"])
        assert card["attribution_boundary"]
        assert card["applicable_horizons"]
        assert card["observable_predictions"] and card["falsifiers"] and card["invalidation_conditions"]
        assert set(card["framework_refs"]) <= set(registry.frameworks)
    assert registry.analyst_lens_registry["role"] == "candidate_explanations_only"


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("url", "", "缺少可回溯原文"),
        ("published_on", "unknown", "日期格式无效"),
        ("locator", "", "缺少可回溯原文"),
    ],
)
def test_incomplete_primary_source_is_rejected(field: str, value: str, message: str) -> None:
    registry = ResearchMethodRegistry()
    registry.analyst_lenses["AL-GSW-01"]["source"][field] = value
    with pytest.raises(ValueError, match=message):
        registry.validate()


def test_untraceable_theory_component_is_rejected() -> None:
    registry = ResearchMethodRegistry()
    registry.analyst_lenses["AL-ZJT-01"]["theoretical_structure"][0]["source_refs"] = ["invented"]
    with pytest.raises(ValueError, match="理论层次引用未知原文"):
        registry.validate()


def test_no_keyword_routing_and_selected_lenses_reach_plan_context() -> None:
    registry = ResearchMethodRegistry()
    assert registry.resolve_for_request(
        {"title": "高善文与郭磊如何看半导体", "asset_class": "equity", "market_scope": "A_share"}
    )["analyst_lens_refs"] == []

    request = _request_with_lenses(
        ["AL-GSW-01", "AL-GL-01"],
        "medium",
        {"AL-GSW-01": "检验信用主体分化", "AL-GL-01": "检验经济和融资环境背离"},
    )
    request.update(id="lens-plan", mode="full_research")
    proposal = ResearchPlanningService().propose(request, {"evidence_ready": False})
    selected = proposal.context["methodology"]
    assert selected["analyst_lens_refs"] == ["AL-GSW-01", "AL-GL-01"]
    assert selected["analyst_lens_cards"]["AL-GSW-01"]["source"]["published_on"] == "2018-07"
    context_node = next(item for item in proposal.nodes if item.id == "context")
    assert context_node.parameters["methodology"]["analyst_lens_selection_reasons"] == {
        "AL-GSW-01": "检验信用主体分化",
        "AL-GL-01": "检验经济和融资环境背离",
    }


@pytest.mark.parametrize(
    ("research_request", "message"),
    [
        (_request_with_lenses(["AL-ZJT-01"], "short", {"AL-ZJT-01": "周期"}), "不适用于"),
        (_request_with_lenses(["AL-GL-01"], "short", {}), "缺少按问题相关性选择的理由"),
        (_request_with_lenses(["invented"], "short", {"invented": "理由"}), "未知分析师视角"),
        (
            {**_request_with_lenses(["AL-GSW-01"], "medium", {"AL-GSW-01": "检验信用"}),
             "information_cutoff": "2018-06-30"},
            "晚于或无法确认早于信息截面",
        ),
        (
            {**_request_with_lenses(["AL-GSW-01"], "medium", {"AL-GSW-01": "检验信用"}),
             "information_cutoff": "2020-12-31"},
            "晚于或无法确认早于信息截面",
        ),
    ],
)
def test_lens_selection_guards_scope_reason_source_time_and_unknown_refs(
    research_request: dict, message: str
) -> None:
    with pytest.raises(ValueError, match=message):
        ResearchMethodRegistry().resolve_for_request(research_request)


def test_historical_semiconductor_and_short_pharma_replay_without_rewriting_outputs() -> None:
    registry = ResearchMethodRegistry()
    semiconductor = yaml.safe_load(
        (ROOT / "research_outputs/a-share-semiconductor-2026h1/request.yaml").read_text(encoding="utf-8")
    )
    semiconductor.update(asset_class="equity", market_scope="A_share")
    semiconductor["methodology"] = {
        "analyst_lens_refs": ["AL-GSW-01", "AL-GL-01"],
        "analyst_lens_horizon": "medium",
        "analyst_lens_selection_reasons": {
            "AL-GSW-01": "信用主体差异可解释产业链分化，但不能直接推出公司利润",
            "AL-GL-01": "交叉检查经济需求与融资条件",
        },
    }
    semicon_selection = registry.resolve_for_request(semiconductor)
    assert semicon_selection["analyst_lens_refs"] == ["AL-GSW-01", "AL-GL-01"]
    assert "AL-ZJT-01" not in semicon_selection["analyst_lens_refs"]

    pharma = yaml.safe_load(
        (ROOT / "research_outputs/a-share-innovative-drugs-one-month-2026-09-08/request.yaml").read_text(
            encoding="utf-8"
        )
    )
    pharma.update(asset_class="equity", market_scope="A_share")
    pharma["methodology"] = {
        "analyst_lens_refs": ["AL-ZYD-01"],
        "analyst_lens_horizon": "short",
        "analyst_lens_selection_reasons": {
            "AL-ZYD-01": "短期政策资金重定价与盈利兑现可能背离"
        },
    }
    pharma_selection = registry.resolve_for_request(pharma)
    assert pharma_selection["analyst_lens_refs"] == ["AL-ZYD-01"]
    assert "AL-ZJT-01" not in pharma_selection["analyst_lens_refs"]


def test_report_discloses_only_material_lenses_and_deduplicates_shared_evidence() -> None:
    registry = ResearchMethodRegistry()
    result = registry.prepare_analyst_lens_disclosures(
        [
            {
                "lens_ref": "AL-GL-01",
                "material_effect": "adds_competing_explanation",
                "source_refs": ["primary", "context-1"],
                "support_evidence_refs": ["evidence:credit", "evidence:activity"],
                "counter_evidence_refs": ["evidence:earnings"],
                "counterevidence": "盈利改善可能比资金更能解释市场分化",
                "conclusion_effect": "保留融资条件背离的竞争解释",
            },
            {
                "lens_ref": "AL-ZYD-01",
                "material_effect": "changes_monitoring",
                "source_refs": ["context-1"],
                "support_evidence_refs": ["evidence:credit"],
                "counter_evidence_refs": [],
                "counterevidence": "盈利兑现尚待观察，不能用价格代替",
                "conclusion_effect": "增加盈利验证触发点，不合成共识",
            },
            {"lens_ref": "AL-GSW-01", "material_effect": "none"},
        ],
        ["AL-GL-01", "AL-ZYD-01", "AL-GSW-01"],
    )
    assert [entry["lens_ref"] for entry in result["disclosures"]] == ["AL-GL-01", "AL-ZYD-01"]
    assert result["unique_evidence_refs"] == ["evidence:activity", "evidence:credit", "evidence:earnings"]
    assert [source["published_on"] for source in result["disclosures"][0]["sources"]] == [
        "2020-09-06", "2020-09-13"
    ]
    assert result["disclosures"][1]["sources"][0]["published_on"] == "2018-12-15"
    assert "score" not in result


def test_lens_votes_and_unselected_disclosures_are_rejected() -> None:
    registry = ResearchMethodRegistry()
    with pytest.raises(ValueError, match="不得投票或加权"):
        registry.prepare_analyst_lens_disclosures(
            [{"lens_ref": "AL-GL-01", "material_effect": "none", "weight": 2}], ["AL-GL-01"]
        )
    with pytest.raises(ValueError, match="未在研究设计中选择"):
        registry.prepare_analyst_lens_disclosures(
            [{"lens_ref": "AL-ZJT-01", "material_effect": "none"}], ["AL-GL-01"]
        )
    with pytest.raises(ValueError, match="须引用所用原文"):
        registry.prepare_analyst_lens_disclosures(
            [{"lens_ref": "AL-GL-01", "material_effect": "changes_monitoring", "source_refs": ["invented"]}],
            ["AL-GL-01"],
        )
