from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest
import yaml

from ir_platform.causal import (
    contains_direct_causal_language,
    validate_causal_assessment,
    validate_causal_design,
    validate_causal_judgment,
)
from ir_platform.adapters import SemanticaResearchGraphRepository
from ir_platform.execution import ApprovalService, ResearchOrchestrator
from ir_platform.planning import ExecutionPlanCompiler, ResearchPlanningService
from ir_platform.research_design import validate_equity_report
from ir_platform.runtime import EvidenceLineageService, RuntimeEntity


def causal_design(*, bidirectional: bool = False, strategy: str = "process_tracing") -> dict:
    structures = [
        {
            "relationship": "forward_a_to_b",
            "statement": "A先变化并通过M影响B",
            "directed_edges": ["A→M", "M→B"],
            "observable_predictions": ["A先于M和B", "高A暴露单位的B变化更大"],
            "falsifier": "B先变化或M不响应",
        },
        {
            "relationship": "reverse_b_to_a",
            "statement": "B的变化反过来影响A",
            "directed_edges": ["B→A"],
            "observable_predictions": ["B先于A", "B冲击后A变化"],
            "falsifier": "A稳定领先B",
        },
        {
            "relationship": "common_cause",
            "statement": "C同时影响A与B",
            "directed_edges": ["C→A", "C→B"],
            "observable_predictions": ["控制C后A与B关系减弱"],
            "falsifier": "控制C后关系不变且中介成立",
        },
    ]
    if bidirectional:
        structures.append(
            {
                "relationship": "bidirectional",
                "statement": "A与B在不同时间尺度相互影响",
                "directed_edges": ["A→B", "B→A"],
                "observable_predictions": ["两个方向各有独立时滞和中介"],
                "falsifier": "任一方向缺少时滞或中介",
            }
        )
    diagnostics = ["temporality", "mechanism", "exposure_contrast", "reverse_direction", "common_cause"]
    if strategy in {
        "natural_experiment",
        "difference_in_differences",
        "regression_discontinuity",
        "instrumental_variable",
        "synthetic_control",
    }:
        diagnostics.extend(["pretrend", "robustness"])
    elif strategy == "randomized_experiment":
        diagnostics.append("robustness")
    return {
        "causal_question": "A是否影响B",
        "cause_a": "A",
        "outcome_b": "B",
        "unit_of_analysis": "公司季度",
        "scope": "样本公司",
        "business_window": "2025Q1—2026Q2",
        "lag_hypothesis": "A领先B一个季度",
        "causal_estimand": "A变化对B的平均处理效应",
        "counterfactual": "相同条件下未发生A变化的单位",
        "candidate_structures": structures,
        "confounders": ["C"],
        "confounder_search": "分别检索C对A和B的时序与机制",
        "mediators": ["M"],
        "colliders": ["选择进入样本"],
        "identification_strategy": strategy,
        "identification_assumptions": ["可比单位除A暴露外无系统差异"],
        "evidence_tasks": [
            {
                "task_ref": f"task:{name}",
                "diagnostic_type": name,
                "target_structure": "A/B/C候选结构",
                "question": f"检查{name}",
                "evidence_roles": ["primary", "counter"],
            }
            for name in diagnostics
        ],
        "downgrade_if_missing": "降为not_identified",
    }


def diagnostic(name: str, status: str, *, groups: list[str] | None = None) -> dict:
    return {
        "diagnostic_type": name,
        "status": status,
        "evidence_refs": [] if status in {"inconclusive", "not_applicable"} else [f"evidence:{name}"],
        "independent_source_groups": groups or ([f"group:{name}"] if status != "inconclusive" else []),
        "explanation": f"{name}为{status}",
    }


def assessment(
    relationship: str,
    status: str,
    *,
    temporality: str = "passed",
    mechanism: str = "passed",
    exposure: str = "passed",
    reverse: str = "weakened",
    common: str = "weakened",
) -> dict:
    language = {
        "identified": "direct_causal",
        "strongly_supported": "supported_causal",
        "partially_supported": "possible_contribution",
        "consistent_only": "association_only",
        "not_identified": "unidentified",
        "contradicted": "causal_rejection",
    }[status]
    if status == "identified":
        conclusion = "A导致B。"
    elif status == "partially_supported":
        conclusion = "A可能促成B。"
    elif status == "contradicted":
        conclusion = "时序证据反驳A对B的目标因果方向。"
    else:
        conclusion = {
            "common_cause": "证据较强支持共同原因结构；A与B存在相关，但当前不支持A直接导致B。",
            "reverse_b_to_a": "证据较强支持B对A存在反向因果作用。",
            "bidirectional": "证据较强支持A与B存在双向因果作用。",
            "association_only": "A与B同期相关，方向尚未识别。",
            "unresolved": "无法区分A→B、B→A和共同原因。",
        }.get(relationship, "证据较强支持A对B存在因果作用。")
    directional_paths = []
    if relationship == "bidirectional":
        directional_paths = [
            {
                "direction": "forward_a_to_b",
                "lag": "A领先B一个季度",
                "mediator": "M1",
                "lag_evidence_refs": ["evidence:temporality"],
                "mediator_evidence_refs": ["evidence:mechanism"],
            },
            {
                "direction": "reverse_b_to_a",
                "lag": "B领先A两个季度",
                "mediator": "M2",
                "lag_evidence_refs": ["evidence:reverse_direction"],
                "mediator_evidence_refs": ["evidence:mechanism"],
            },
        ]
    return {
        "design_ref": "causal-design:1",
        "relationship_conclusion": relationship,
        "causal_status": status,
        "diagnostics": [
            diagnostic("temporality", temporality),
            diagnostic("mechanism", mechanism),
            diagnostic("exposure_contrast", exposure),
            diagnostic("reverse_direction", reverse),
            diagnostic("common_cause", common),
        ],
        "identification_assumptions_status": "passed" if status == "identified" else "partial",
        "independent_source_groups": [
            "group:temporality",
            "group:common_cause" if relationship == "common_cause" else "group:mechanism",
        ],
        "effect_estimate": None,
        "directional_paths": directional_paths,
        "decisive_evidence_refs": ["evidence:temporality"],
        "unresolved_alternatives": [],
        "limitations": ["观察期资料有限"],
        "claim_language_level": language,
        "conclusion_statement": conclusion,
    }


def test_causal_design_requires_forward_reverse_and_common_cause() -> None:
    payload = causal_design()
    payload["candidate_structures"] = payload["candidate_structures"][:2]
    with pytest.raises(ValueError, match="candidate_structures|必要候选结构"):
        validate_causal_design(payload)


def test_causal_design_requires_counterfactual_and_common_cause_task() -> None:
    payload = causal_design()
    payload["counterfactual"] = ""
    with pytest.raises(ValueError, match="counterfactual"):
        validate_causal_design(payload)
    payload = causal_design()
    payload["evidence_tasks"] = [
        item for item in payload["evidence_tasks"] if item["diagnostic_type"] != "common_cause"
    ]
    with pytest.raises(ValueError, match="必要识别任务|at least 5"):
        validate_causal_design(payload)


@pytest.mark.parametrize(
    ("relationship", "reverse", "common"),
    [
        ("forward_a_to_b", "weakened", "weakened"),
        ("reverse_b_to_a", "passed", "weakened"),
        ("common_cause", "weakened", "passed"),
    ],
)
def test_directional_relationships_use_structure_specific_gates(
    relationship: str, reverse: str, common: str
) -> None:
    design = validate_causal_design(causal_design())
    result = validate_causal_assessment(
        assessment(relationship, "strongly_supported", reverse=reverse, common=common),
        design=design,
    )
    assert result.relationship_conclusion == relationship


def test_bidirectional_requires_preregistered_structure_and_two_direction_evidence() -> None:
    payload = assessment("bidirectional", "strongly_supported", reverse="passed", common="weakened")
    with pytest.raises(ValueError, match="预登记"):
        validate_causal_assessment(payload, design=validate_causal_design(causal_design()))
    result = validate_causal_assessment(
        payload, design=validate_causal_design(causal_design(bidirectional=True))
    )
    assert result.relationship_conclusion == "bidirectional"


def test_same_period_association_cannot_be_upgraded_to_causality() -> None:
    result = validate_causal_assessment(
        assessment(
            "association_only",
            "consistent_only",
            temporality="inconclusive",
            mechanism="inconclusive",
            exposure="inconclusive",
            reverse="inconclusive",
            common="inconclusive",
        ),
        design=validate_causal_design(causal_design()),
    )
    assert result.claim_language_level == "association_only"


def test_quasi_experiment_missing_robustness_and_effect_estimate_is_not_identified() -> None:
    payload = assessment("forward_a_to_b", "identified")
    design = validate_causal_design(causal_design(strategy="difference_in_differences"))
    with pytest.raises(ValueError, match="稳健性"):
        validate_causal_assessment(payload, design=design)
    payload["diagnostics"].append(diagnostic("robustness", "passed"))
    with pytest.raises(ValueError, match="事前趋势"):
        validate_causal_assessment(payload, design=design)
    payload["diagnostics"].append(diagnostic("pretrend", "passed"))
    with pytest.raises(ValueError, match="效应估计"):
        validate_causal_assessment(payload, design=design)


def test_qualified_quasi_experiment_can_reach_identified() -> None:
    payload = assessment("forward_a_to_b", "identified")
    payload["diagnostics"].extend(
        [diagnostic("pretrend", "passed"), diagnostic("robustness", "passed")]
    )
    payload["effect_estimate"] = {
        "estimate": 2.5,
        "unit": "percentage_points",
        "uncertainty_interval": "95% CI [1.1, 3.9]",
        "sample_description": "40家公司，8个季度",
        "method": "difference_in_differences",
        "reproducible_artifact_ref": "artifact:did-notebook",
    }
    result = validate_causal_assessment(
        payload,
        design=validate_causal_design(causal_design(strategy="difference_in_differences")),
    )
    assert result.causal_status == "identified"


def test_causal_language_guard_distinguishes_direct_and_negated_claims() -> None:
    assert contains_direct_causal_language("A导致B") is True
    assert contains_direct_causal_language("当前不支持A直接导致B") is False
    assert contains_direct_causal_language("当前不能写成A导致B") is False
    with pytest.raises(ValueError, match="未启用因果识别"):
        validate_causal_judgment(
            {"statement": "A导致B"}, causal_required=False
        )


def test_nonidentified_judgment_cannot_use_direct_causal_language() -> None:
    design = validate_causal_design(causal_design())
    causal_assessment = validate_causal_assessment(
        assessment("forward_a_to_b", "partially_supported", common="inconclusive"),
        design=design,
    )
    judgment = {
        "statement": "A导致B",
        "relationship_conclusion": "forward_a_to_b",
        "causal_status": "partially_supported",
        "causal_assessment_ref": "causal-assessment:1",
        "claim_language_level": "possible_contribution",
    }
    with pytest.raises(ValueError, match="只有 identified"):
        validate_causal_judgment(judgment, causal_required=True, assessment=causal_assessment)


def test_semiconductor_company_comovement_replay_stays_association_only() -> None:
    pilot = Path(__file__).resolve().parents[1] / (
        "research_outputs/a-share-semiconductor-evidence-pilot-2026-09-08"
    )
    design_payload = yaml.safe_load((pilot / "causal-design.yaml").read_text(encoding="utf-8"))[
        "causal_design"
    ]
    assessment_payload = yaml.safe_load(
        (pilot / "causal-assessment.yaml").read_text(encoding="utf-8")
    )["causal_assessment"]
    evidence_handoff = yaml.safe_load(
        (pilot / "evidence-handoff.yaml").read_text(encoding="utf-8")
    )["evidence_handoff"]
    known_claims = {item["id"] for item in evidence_handoff["claims"]}
    cited_claims = {
        ref
        for item in assessment_payload["diagnostics"]
        for ref in item["evidence_refs"]
    } | set(assessment_payload["decisive_evidence_refs"])
    assert cited_claims <= known_claims
    result = validate_causal_assessment(
        assessment_payload,
        design=validate_causal_design(design_payload),
    )
    assert result.relationship_conclusion == "association_only"
    assert result.causal_status == "consistent_only"
    assert any("无偏总体" in item for item in result.limitations)


def causal_request(bundle_id: str) -> dict:
    return {
        "id": f"request:{bundle_id}",
        "mode": "full_research",
        "information_cutoff": "2026-09-08",
        "question": "A是否导致B",
        "decision_use": "区分因果方向",
        "methodology": {"judgment_types": ["causal_attribution"]},
    }


def research_design_payload(causal_design_ref: str) -> dict:
    return {
        "information_cutoff": "2026-09-08",
        "horizon": "one_year",
        "decision_use": "区分因果方向",
        "primary_question": "A是否导致B",
        "main_contradiction": "A→B与B→A均可解释同期变化",
        "hypotheses": [
            {
                "role": "main",
                "claim": "A先变化并影响B",
                "observable_prediction": "A领先B且高暴露单位变化更大",
                "falsifier": "B稳定领先A",
            },
            {
                "role": "competing",
                "claim": "C同时影响A和B",
                "observable_prediction": "控制C后关系减弱",
                "falsifier": "控制C后A的中介仍成立",
            },
        ],
        "evidence_plan": [
            {
                "question": "区分三个方向",
                "preferred_source": "原始时间序列与公司披露",
                "distinguishing_signal": "时序、中介和暴露梯度",
            }
        ],
        "framework_refs": [],
        "framework_selection_reasons": {},
        "personal_principle_refs": [],
        "analyst_lens_refs": [],
        "causal_design_refs": [causal_design_ref],
        "stop_conditions": ["无法建立反事实则停止"],
        "monitoring_triggers": ["出现可比较的外生冲击"],
    }


def test_planner_routes_only_declared_causal_tasks_through_causal_nodes() -> None:
    planner = ResearchPlanningService()
    causal = planner.propose(causal_request("routing"), {"evidence_ready": False})
    causal_capabilities = [node.capability_ref for node in causal.nodes]
    assert causal.context["methodology"]["causal_identification_required"] is True
    assert causal.context["methodology"]["causal_contract_version"] == "1.0.0"
    assert "R00-CAUSAL" in causal.context["methodology"]["reasoning_method_refs"]
    assert "evaluate_causality" in causal_capabilities
    assert "form_causal_judgment" in causal_capabilities
    assert "form_judgment" not in causal_capabilities

    ordinary_request = {
        "id": "request:ordinary",
        "mode": "full_research",
        "methodology": {"judgment_types": ["trend_direction"]},
    }
    ordinary = planner.propose(ordinary_request, {"evidence_ready": False})
    ordinary_capabilities = [node.capability_ref for node in ordinary.nodes]
    assert ordinary.context["methodology"]["causal_identification_required"] is False
    assert "evaluate_causality" not in ordinary_capabilities
    assert "form_causal_judgment" not in ordinary_capabilities
    assert "form_judgment" in ordinary_capabilities

    refresh_request = {**causal_request("refresh"), "mode": "evidence_refresh"}
    refresh = planner.propose(refresh_request, {"evidence_ready": False})
    ExecutionPlanCompiler().compile(refresh)
    assert refresh.context["methodology"]["causal_identification_required"] is True
    assert refresh.context["methodology"]["research_design_required"] is False
    assert "evaluate_causality" not in [node.capability_ref for node in refresh.nodes]


@pytest.mark.parametrize(
    "judgment_type",
    ["mechanism_validation", "causal_attribution", "transmission_path", "impact_realization"],
)
def test_all_registered_causal_problem_types_load_shared_protocol(judgment_type: str) -> None:
    methodology = ResearchPlanningService().methods.resolve_for_request(
        {"methodology": {"judgment_types": [judgment_type]}}
    )
    assert methodology["causal_identification_required"] is True
    assert methodology["reasoning_method_refs"].count("R00-CAUSAL") == 1


def test_causal_equity_report_requires_assessment_section() -> None:
    request_payload = {
        **causal_request("equity-report"),
        "asset_class": "equity",
        "market_scope": "A_share",
    }
    contract = ResearchPlanningService().methods.resolve_for_request(request_payload)[
        "equity_report_contract"
    ]
    report = {
        "information_cutoff": "2026-09-08",
        "research_scope": "A股因果识别报告",
        "market_implied_view": "市场隐含A会推动B",
        "research_difference": "方向尚需识别",
        "shortest_evidence_chain": ["fact:causal"],
        "decisive_falsifier": "B稳定领先A",
        "verification_window": "未来一年",
        "thesis_status": "watch",
        "macro_context_ref": "macro:causal",
        "evidence_handoff_ref": "handoff:causal",
        "judgment_refs": ["judgment:causal"],
        "fundamental_judgment": "基本面传导方向仍需因果识别",
        "expectation_and_valuation": "市场预期隐含正向传导但未排除反向或共同原因",
        "industry_style_mapping": "仅用于影响映射，不推出交易结论",
        "weakest_link": "方向识别不足",
        "monitoring_triggers": ["验证A与B的时间先后关系"],
    }
    with pytest.raises(ValueError, match="因果识别"):
        validate_equity_report(report, contract)
    validate_equity_report(
        {
            **report,
            "causal_summary": "当前只能写A可能促成B，共同原因尚未排除。",
            "causal_assessment_refs": ["causal-assessment:run"],
        },
        contract,
    )


def test_runtime_rejects_direct_causal_language_without_causal_route(tmp_path: Path) -> None:
    bundle_id = "ordinary-guard"
    request_payload = {
        "id": f"request:{bundle_id}",
        "mode": "full_research",
        "methodology": {"judgment_types": ["trend_direction"]},
    }
    plan = ExecutionPlanCompiler().compile(
        ResearchPlanningService().propose(
            request_payload,
            {
                "evidence_ready": True,
                "available_types": ["EvidenceFact", "EvidenceAssessment"],
            },
        )
    )
    seeds = [
        RuntimeEntity(
            id=request_payload["id"],
            type="ResearchRequest",
            properties=request_payload,
            bundle_id=bundle_id,
        ),
        RuntimeEntity(id="fact:ordinary", type="EvidenceFact", bundle_id=bundle_id),
        RuntimeEntity(
            id="assessment:ordinary",
            type="EvidenceAssessment",
            properties={
                "assessment_status": "complete",
                "lineage_complete": True,
                "ready_for_directional_judgment": True,
            },
            bundle_id=bundle_id,
        ),
    ]
    repository = SemanticaResearchGraphRepository(tmp_path)
    summary = ResearchOrchestrator(repository).start(
        plan,
        bundle_id=bundle_id,
        seed_entities=seeds,
        runtime_context={
            "node_outputs": {
                "judgment": [
                    {
                        "id": "judgment:unguarded-causal",
                        "type": "Judgment",
                        "properties": {"statement": "A导致B", "judgment_level": "J1"},
                    }
                ]
            }
        },
    )
    assert summary.status == "failed"
    assert summary.failed_nodes == ["judgment"]
    repository.close()


def test_runtime_causal_judgment_traces_through_assessment(tmp_path: Path) -> None:
    bundle_id = "causal-run"
    request_payload = causal_request(bundle_id)
    plan = ExecutionPlanCompiler().compile(
        ResearchPlanningService().propose(
            request_payload,
            {
                "evidence_ready": True,
                "conflict_detected": False,
                "available_types": ["EvidenceFact", "EvidenceAssessment"],
            },
        )
    )
    seed_request = RuntimeEntity(
        id=request_payload["id"],
        type="ResearchRequest",
        properties=request_payload,
        recorded_at=datetime(2026, 9, 8, tzinfo=timezone.utc),
        bundle_id=bundle_id,
    )
    fact_ids = [
        "fact:causal",
        "evidence:temporality",
        "evidence:mechanism",
        "evidence:exposure_contrast",
        "evidence:reverse_direction",
    ]
    facts = [RuntimeEntity(id=item, type="EvidenceFact", bundle_id=bundle_id) for item in fact_ids]
    evidence_assessment = RuntimeEntity(
        id="evidence-assessment:causal",
        type="EvidenceAssessment",
        properties={
            "assessment_status": "complete",
            "lineage_complete": True,
            "ready_for_directional_judgment": True,
        },
        bundle_id=bundle_id,
    )
    design_id = "causal-design:run"
    assessment_id = "causal-assessment:run"
    assessment_payload = assessment(
        "forward_a_to_b", "partially_supported", common="inconclusive"
    )
    assessment_payload["design_ref"] = design_id
    repository = SemanticaResearchGraphRepository(tmp_path)
    orchestrator = ResearchOrchestrator(repository)
    waiting = orchestrator.start(
        plan,
        bundle_id=bundle_id,
        seed_entities=[seed_request, *facts, evidence_assessment],
        runtime_context={
            "node_outputs": {
                "design": [
                    {
                        "id": "research-design:run",
                        "type": "ResearchDesign",
                        "properties": research_design_payload(design_id),
                    },
                    {"id": design_id, "type": "CausalDesign", "properties": causal_design()},
                ],
                "causality": [
                    {"id": assessment_id, "type": "CausalAssessment", "properties": assessment_payload}
                ],
                "causal_judgment": [
                    {
                        "id": "judgment:causal",
                        "type": "Judgment",
                        "properties": {
                            "statement": "A可能促成B",
                            "judgment_level": "J1",
                            "evidence_refs": ["fact:causal"],
                            "rule_evaluation_refs": [],
                            "limitations": ["共同原因尚未充分排除"],
                            "relationship_conclusion": "forward_a_to_b",
                            "causal_status": "partially_supported",
                            "causal_assessment_ref": assessment_id,
                            "claim_language_level": "possible_contribution",
                        },
                    }
                ],
            }
        },
    )
    assert waiting.status == "awaiting_input"
    approval_request = next(
        item for item in repository.list_entities(bundle_id) if item.type == "ApprovalRequest"
    )
    ApprovalService(repository).approve(
        bundle_id=bundle_id,
        request_id=approval_request.id,
        approver_id="human-reviewer",
    )
    completed = orchestrator.resume(plan, bundle_id=bundle_id)
    assert completed.status == "completed"
    trace = EvidenceLineageService(repository).trace("judgment:causal")
    assert assessment_id in {item["id"] for item in trace["entities"]}
    repository.close()
