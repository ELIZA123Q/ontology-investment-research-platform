from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]


def _load_script(relative_path: str, module_name: str):
    path = ROOT / relative_path
    spec = importlib.util.spec_from_file_location(module_name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _valid_design_review() -> dict:
    return {
        "design_review": {
            "verdict": "pass",
            "research_question": "国产算力集群需求是否进入可持续扩张阶段？",
            "decision_use": "产业战略研究",
            "output_boundary": "形成研究设计与取证方案，不输出交易建议",
            "information_cutoff": "2026-09-17T12:00:00+08:00",
            "object_scope": {
                "subject": "国产AI算力产业链",
                "geography": "中国大陆",
                "time_window": "未来12个月",
                "unit_of_analysis": "产业链环节",
            },
            "main_hypothesis": {
                "id": "H1",
                "statement": "需求扩张主要由可验证训练与推理工作负载驱动",
                "observable_predictions": ["云厂商与企业侧CAPEX、订单和利用率同步改善"],
            },
            "competing_hypotheses": [
                {
                    "id": "C1",
                    "statement": "扩张主要由政策和库存前置驱动，需求兑现不足",
                    "observable_predictions": ["订单增长领先于真实利用率，库存周转恶化"],
                }
            ],
            "evidence_plan": [
                {
                    "role": "primary",
                    "evidence_question": "订单和利用率是否同时改善",
                    "source_strategy": "公司公告、招投标、运营口径交叉核对",
                    "required": True,
                },
                {
                    "role": "baseline",
                    "evidence_question": "过去周期的正常扩张斜率是什么",
                    "source_strategy": "历史CAPEX、服务器出货、公开财报口径",
                    "required": True,
                },
                {
                    "role": "counter",
                    "evidence_question": "是否存在库存或政策前置解释",
                    "source_strategy": "库存、应收、利用率和采购节奏反证",
                    "required": True,
                },
            ],
            "decisive_disconfirmers": ["利用率不升且库存周转恶化"],
            "key_risks": [
                {
                    "risk_type": "common_cause",
                    "description": "政策补贴可能同时推动订单和资本开支",
                    "mitigation": "拆分真实负载、政策口径和采购前置",
                }
            ],
            "stop_conditions": ["关键利用率口径无法获得时降级为观察清单"],
        }
    }


def _valid_argument_language_edit() -> dict:
    return {
        "argument_language_edit": {
            "edit_status": "edited",
            "source_artifact_ref": "report:test",
            "replacement_text": "现有证据支持需求改善的可能性上升，但仍需等待利用率与订单的同口径验证。",
            "paragraph_edits": [
                {
                    "location": "summary.p1",
                    "original_text": "国产算力需求确定性爆发。",
                    "revised_text": "现有证据支持国产算力需求改善的可能性上升。",
                    "edit_reason": "降低确定性表达并保留证据边界",
                }
            ],
            "downgraded_claims": [
                {
                    "location": "summary.p1",
                    "original_text": "确定性爆发",
                    "revised_text": "可能性上升",
                    "reason": "缺少完整因果识别和反证裁决",
                }
            ],
            "boundary_violations": [
                {
                    "location": "summary.p1",
                    "violation_type": "unsupported_certainty",
                    "severity": "medium",
                    "required_action": "downgrade",
                }
            ],
            "needs_producer_revision": [],
            "protected_judgment_thresholds": ["不得提高置信度"],
            "final_validation_required": True,
        }
    }


def test_design_review_validator_accepts_contract_and_rejects_missing_counter() -> None:
    validator = _load_script(
        ".agents/skills/touyan-yanjiu-sheji-pingshen/scripts/validate_design_review.py",
        "design_review_validator",
    )
    payload = _valid_design_review()
    validator.validate(payload)

    invalid = _valid_design_review()
    invalid["design_review"]["evidence_plan"] = [
        item for item in invalid["design_review"]["evidence_plan"] if item["role"] != "counter"
    ]
    with pytest.raises(SystemExit, match="primary and counter"):
        validator.validate(invalid)


def test_design_review_validator_blocks_trade_fields() -> None:
    validator = _load_script(
        ".agents/skills/touyan-yanjiu-sheji-pingshen/scripts/validate_design_review.py",
        "design_review_validator_trade_fields",
    )
    invalid = _valid_design_review()
    invalid["design_review"]["trade_action"] = "buy"
    with pytest.raises(SystemExit, match="prohibited"):
        validator.validate(invalid)


def test_argument_language_validator_accepts_contract_and_rejects_false_clean() -> None:
    validator = _load_script(
        ".agents/skills/touyan-lunzheng-yuyan-bianji/scripts/validate_argument_language_edit.py",
        "argument_language_validator",
    )
    payload = _valid_argument_language_edit()
    validator.validate(payload)

    invalid = _valid_argument_language_edit()
    invalid["argument_language_edit"]["edit_status"] = "clean"
    invalid["argument_language_edit"]["boundary_violations"] = [
        {
            "location": "conclusion.p2",
            "violation_type": "return_promise",
            "severity": "high",
            "required_action": "validation_block",
        }
    ]
    with pytest.raises(SystemExit, match="hard boundary violations|validation_block"):
        validator.validate(invalid)


def test_argument_language_validator_requires_producer_revision_when_needed() -> None:
    validator = _load_script(
        ".agents/skills/touyan-lunzheng-yuyan-bianji/scripts/validate_argument_language_edit.py",
        "argument_language_validator_revision",
    )
    invalid = _valid_argument_language_edit()
    invalid["argument_language_edit"]["edit_status"] = "needs_producer_revision"
    invalid["argument_language_edit"]["needs_producer_revision"] = []
    with pytest.raises(SystemExit, match="requires needs_producer_revision"):
        validator.validate(invalid)


def test_skill_routing_copy_keeps_a_share_equity_with_equity_controller() -> None:
    strategic = (
        ROOT / ".agents/skills/touyan-zhanlue-yanjiu-zongkong/SKILL.md"
    ).read_text(encoding="utf-8")
    display = (
        ROOT / ".agents/skills/touyan-quanyi-juece-bijiao/agents/openai.yaml"
    ).read_text(encoding="utf-8")
    assert "明确A股权益完整研究优先使用权益总控" in strategic
    assert "asset_class: equity" in strategic
    assert "market_scope: A_share" in strategic
    assert "A股权益研究载体比较" in display
