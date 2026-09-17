from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
import yaml

from ir_platform import validate_decision_comparison
from ir_platform.adapters import SemanticaResearchGraphRepository
from ir_platform.execution import ResearchOrchestrator
from ir_platform.methodology import ResearchMethodRegistry
from ir_platform.planning import ExecutionPlanCompiler, ResearchPlanningService
from ir_platform.runtime import RuntimeEntity


ROOT = Path(__file__).resolve().parents[1]


def _load_decision_validator():
    path = ROOT / ".agents/skills/touyan-quanyi-juece-bijiao/scripts/validate_decision_comparison.py"
    spec = importlib.util.spec_from_file_location("decision_validator", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _decision_payload() -> dict:
    dimensions = [
        "exposure_coverage",
        "fundamental_capture",
        "expectation_gap",
        "valuation",
        "downside_risk",
        "implementability",
    ]
    return {
        "decision_comparison": {
            "information_cutoff": "2026-09-08T15:00:00+08:00",
            "a10_thesis_ref": "judgment:A10:test",
            "a10_thesis_status": "formed",
            "decision_question": "ETF还是选股？",
            "comparison_scope": {
                "asset_universe": "A股银行与银行ETF",
                "horizon": "未来半年",
                "benchmark": "中证银行",
                "common_dimensions": [
                    {"id": dimension, "label": dimension, "comparison_basis": "同一信息截面"}
                    for dimension in dimensions
                ],
            },
            "preferred_vehicle": "hybrid",
            "preferred_vehicle_rationale": "行业beta用ETF承接，个股分化需另行研究",
            "selection_edge": "moderate",
            "selection_edge_basis": [
                {
                    "dimension": "fundamental_dispersion",
                    "statement": "资本和资产质量分化可观测",
                    "evidence_refs": ["claim:bank:1"],
                    "independent_source_groups": ["issuer"],
                },
                {
                    "dimension": "index_coverage_gap",
                    "statement": "指数覆盖稀释部分区域银行暴露",
                    "evidence_refs": ["claim:index:1"],
                    "independent_source_groups": ["index_provider"],
                },
            ],
            "industry_dispersion": {
                "level": "medium",
                "dimensions": ["资产质量", "资本约束"],
                "evidence_refs": ["claim:bank:1"],
            },
            "etf_analysis": {
                "candidates": [
                    {
                        "object_ref": "etf:bank",
                        "name": "银行ETF",
                        "index_or_strategy": "中证银行",
                        "exposure_coverage": "覆盖行业共同beta",
                        "concentration_risks": ["头部银行权重较高"],
                        "replication_or_tracking": "需核验跟踪误差",
                        "evidence_refs": ["claim:index:1"],
                    }
                ],
                "coverage_gaps": ["none_identified"],
            },
            "stock_categories": [
                {
                    "category_ref": "stock-category:regional-quality",
                    "name": "区域资产质量较优银行",
                    "definition": "区域暴露和资产迁徙可核验",
                    "advantage_hypothesis": "相对ETF具有经营分化承接优势",
                    "inclusion_rule": "披露口径可比且资本缓冲充足",
                    "evidence_refs": ["claim:bank:1"],
                }
            ],
            "candidate_ranking": [
                {
                    "rank": 1,
                    "object_ref": "etf:bank",
                    "name": "银行ETF",
                    "object_type": "etf",
                    "category_ref": "not_applicable",
                    "dimension_assessments": [
                        {
                            "dimension_ref": dimension,
                            "assessment": "neutral",
                            "value_or_band": "unknown",
                            "evidence_refs": ["claim:index:1"],
                        }
                        for dimension in dimensions
                    ],
                    "advantage_statement": "行业共同暴露承接较直接",
                    "decisive_risks": ["指数集中度"],
                    "evidence_refs": ["claim:index:1"],
                },
                {
                    "rank": 2,
                    "object_ref": "stock:example",
                    "name": "候选银行",
                    "object_type": "stock",
                    "category_ref": "stock-category:regional-quality",
                    "dimension_assessments": [
                        {
                            "dimension_ref": dimension,
                            "assessment": "unknown",
                            "value_or_band": "unknown",
                            "evidence_refs": ["claim:bank:1"],
                        }
                        for dimension in dimensions
                    ],
                    "advantage_statement": "具备后续研究优先级",
                    "decisive_risks": ["披露不足"],
                    "evidence_refs": ["claim:bank:1"],
                },
            ],
            "decisive_tradeoffs": [
                {
                    "topic": "行业共性与个股分化",
                    "favors": "hybrid",
                    "explanation": "共同beta和个体差异同时存在",
                    "evidence_refs": ["claim:bank:1"],
                }
            ],
            "invalidation_conditions": [
                {
                    "condition": "个股分化不可复现",
                    "observable_signal": "同口径差异消失",
                    "deadline": "下一财报期",
                    "consequence": "downgrade_to_etf",
                    "evidence_refs": ["claim:bank:1"],
                }
            ],
            "confidence": "medium",
            "limitations": ["测试样例不是投资结论"],
            "report_boundary": {
                "conclusion_level": "research_vehicle_comparison",
                "prohibited_outputs": [
                    "buy_sell_instruction",
                    "position_or_allocation",
                    "order_execution",
                    "target_price",
                    "return_promise",
                    "market_timing",
                ],
            },
        }
    }


def test_decision_comparison_validator_accepts_contract_and_rejects_trade_fields() -> None:
    validator = _load_decision_validator()
    validator.validate(_decision_payload())
    validate_decision_comparison(_decision_payload())
    invalid = _decision_payload()
    invalid["decision_comparison"]["trade_action"] = "buy"
    with pytest.raises(SystemExit, match="prohibited"):
        validator.validate(invalid)
    with pytest.raises(ValueError, match="不得包含"):
        validate_decision_comparison(invalid)


def test_decision_comparison_is_registered_as_runtime_logic(tmp_path: Path) -> None:
    request = {
        "id": "decision-comparison-runtime",
        "mode": "decision_comparison",
        "asset_class": "equity",
        "market_scope": "A_share",
        "information_cutoff": "2026-09-08T15:00:00+08:00",
        "decision_use": "比较 ETF 与选股研究载体",
        "question": "ETF还是选股？",
    }
    proposal = ResearchPlanningService().propose(request, {"available_types": ["Judgment"]})
    assert proposal.logic_ref == "decision_comparison"
    plan = ExecutionPlanCompiler().compile(proposal)
    assert [node.capability_ref for node in plan.nodes][-1] == "form_decision_comparison"

    bundle_id = "decision-comparison-runtime"
    repository = SemanticaResearchGraphRepository(tmp_path / bundle_id)
    try:
        payload = _decision_payload()["decision_comparison"]
        judgment = RuntimeEntity(
            id=payload["a10_thesis_ref"],
            type="Judgment",
            bundle_id=bundle_id,
            properties={
                "statement": "测试 A10 命题",
                "judgment_level": "J2",
                "evidence_refs": ["fact:test"],
                "rule_evaluation_refs": ["rule:test"],
                "limitations": ["测试"],
                "thesis_status": payload["a10_thesis_status"],
            },
        )
        seed = RuntimeEntity(id=request["id"], type="ResearchRequest", properties=request, bundle_id=bundle_id)
        summary = ResearchOrchestrator(repository).start(
            plan,
            bundle_id=bundle_id,
            seed_entities=[seed, judgment],
            runtime_context={
                "node_outputs": {
                    "decision_comparison": [{"type": "DecisionComparison", "properties": payload}]
                }
            },
        )
        assert summary.status == "completed"
        comparisons = [item for item in repository.list_entities(bundle_id) if item.type == "DecisionComparison"]
        assert len(comparisons) == 1
        assert any(
            relation.type == "judgmentGuidesDecisionComparison"
            for relation in repository.list_relations(bundle_id)
        )
    finally:
        repository.close()


def test_bank_domain_catalog_and_framework_are_registered() -> None:
    registry = ResearchMethodRegistry()
    selected = registry.resolve_for_request(
        {
            "id": "bank-domain",
            "mode": "full_research",
            "asset_class": "equity",
            "market_scope": "A_share",
            "information_cutoff": "2026-09-08T15:00:00+08:00",
            "methodology": {"domain": "bank", "framework_refs": ["IF-BANK-01"]},
        }
    )
    assert selected["domain_catalog"] == "研究方法/银行/research-catalog.yaml"
    assert "IF-BANK-01" in selected["framework_refs"]
    assert (ROOT / "研究方法/取证/B03_银行业来源速查.md").is_file()
    yaml.safe_load((ROOT / selected["domain_catalog"]).read_text(encoding="utf-8"))
