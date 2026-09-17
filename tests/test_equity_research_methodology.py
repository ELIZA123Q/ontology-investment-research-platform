from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest
import yaml

from ir_platform.adapters import SemanticaResearchGraphRepository
from ir_platform.cli import build_parser
from ir_platform.execution import ApprovalService, ResearchOrchestrator
from ir_platform.methodology import ResearchMethodRegistry
from ir_platform.planning import ExecutionPlanCompiler, PlanCompilationError, ResearchPlanningService
from ir_platform.research_design import validate_equity_report, validate_research_design
from ir_platform.runtime import RuntimeEntity


ROOT = Path(__file__).resolve().parents[1]


def _request(mode: str = "full_research") -> dict:
    return {
        "id": "equity-methodology-test",
        "mode": mode,
        "asset_class": "equity",
        "market_scope": "A_share",
        "information_cutoff": "2026-09-08T15:00:00+08:00",
        "decision_use": "行业研究优先级判断",
        "question": "行业主要矛盾与剩余预期差是什么？",
    }


def _design(contract: dict) -> dict:
    return {
        "information_cutoff": "2026-09-08",
        "horizon": "未来一个季度",
        "decision_use": "行业研究优先级判断",
        "primary_question": "行业主要矛盾与剩余预期差是什么？",
        "main_contradiction": "需求改善能否转化为现金而非仅增加库存",
        "hypotheses": [
            {
                "role": "main",
                "claim": "需求改善可持续",
                "observable_prediction": "订单与经营现金流同步改善",
                "falsifier": "订单改善但回款持续恶化",
            },
            {
                "role": "competing",
                "claim": "订单改善仅为补库",
                "observable_prediction": "库存上升而终端销售不跟进",
                "falsifier": "终端销售和回款持续同步改善",
            },
        ],
        "evidence_plan": [
            {
                "question": "需求改善是否进入现金流",
                "preferred_source": "公司法定披露与行业官方统计",
                "distinguishing_signal": "订单、库存与经营现金流同口径变化",
            }
        ],
        "framework_refs": contract["framework_refs"],
        "framework_selection_reasons": {ref: "检验目标相关的宏观或资金条件" for ref in contract["framework_refs"]},
        "personal_principle_refs": contract["personal_principle_refs"],
        "analyst_lens_refs": contract["analyst_lens_refs"],
        "stop_conditions": ["缺少同口径订单和现金证据时停止上推"],
        "monitoring_triggers": ["下一财报窗口核验库存与现金的背离"],
    }


def _report() -> dict:
    return {
        "information_cutoff": "2026-09-08",
        "research_scope": "A股行业完整研究",
        "market_implied_view": "市场隐含需求持续恢复",
        "research_difference": "持续性与回款路径尚未验证",
        "shortest_evidence_chain": ["fact:orders", "fact:cash"],
        "decisive_falsifier": "两期订单与回款持续背离",
        "verification_window": "未来一个季度",
        "thesis_status": "watch",
        "macro_context_ref": "macro:placeholder",
        "evidence_handoff_ref": "handoff:placeholder",
        "judgment_refs": ["judgment:placeholder"],
        "fundamental_judgment": "基本面改善仍需现金流验证",
        "expectation_and_valuation": "估值反映需求恢复，但未充分反映回款不确定性",
        "industry_style_mapping": "更偏向现金流兑现度高的细分方向",
        "weakest_link": "订单与现金流背离",
        "monitoring_triggers": ["下一财报窗口核验库存与现金的背离"],
    }


def _macro_context() -> dict:
    axis = {
        "conclusion": "mixed",
        "confidence": "low",
        "evidence_refs": ["fact:orders"],
        "competing_explanations": ["短期数据不足以形成单向判断"],
    }
    return {
        "as_of": "2026-09-08",
        "horizon": "未来一个季度",
        "mode": "screen",
        "economic_direction": dict(axis),
        "policy_stance": dict(axis, conclusion="mixed"),
        "funding_conditions": {
            "entity_financing": dict(axis, conclusion="mixed"),
            "equity_market": dict(axis, conclusion="mixed"),
        },
        "regime_synthesis": {
            "alignment": "uncertain",
            "target_materiality": "medium",
            "industry_style_map": "现金流兑现优先",
            "conflicts": ["经济、政策和资金轴线未形成一致方向"],
        },
        "stop_conditions": ["缺少政策执行或资金分层证据时不输出强宏观结论"],
        "monitoring_triggers": ["社融结构、ETF流向与行业订单同步复核"],
        "downstream_handoffs": ["只映射行业与风格，不推出个股利润"],
    }


def _evidence_handoff() -> dict:
    return {
        "information_cutoff": "2026-09-08T15:00:00+08:00",
        "task_refs": ["task:demand-cash"],
        "sources": [],
        "claims": [],
        "observations": [],
        "calculations": [],
        "coverage_by_role": {"task:demand-cash": {"primary": "missing"}},
        "source_independence_groups": {},
        "conflicts": [],
        "counter_searches": [],
        "gaps": [
            {
                "id": "gap:primary",
                "task_ref": "task:demand-cash",
                "gap_type": "source_not_found",
                "required_role": "primary",
                "description": "测试场景未接入真实取证输出",
                "attempts": ["使用种子 EvidenceFact 作为运行时门槛测试"],
                "impact": "只能验证链路，不形成真实研究结论",
            }
        ],
        "completeness": "unusable",
        "stop_decision": {
            "continue_research": False,
            "reason": "测试夹具缺少真实来源",
            "upgrade_evidence_needed": ["补充官方来源与公司披露"],
        },
    }


def _hypothesis() -> dict:
    return {
        "statement": "需求改善若不能进入现金流，投资命题只能保持观察",
        "scope": "A股行业完整研究测试",
        "falsifiers": ["订单和回款连续两期同步改善"],
    }


def _final_validation(artifact_ref: str) -> dict:
    categories = [
        "numbers_and_calculations",
        "evidence_boundary",
        "logic_and_counterevidence",
        "report_boundary",
        "language_quality",
        "question_coverage",
    ]
    return {
        "artifact_ref": artifact_ref,
        "validator_role": "independent_final_artifact_validator",
        "independent_from_production": True,
        "verdict": "pass",
        "checks": [
            {
                "category": category,
                "status": "pass",
                "evidence": ["测试报告字段齐备"],
                "note": "测试夹具用于校验发布门槛",
            }
            for category in categories
        ],
        "findings": [],
        "question_coverage": [
            {
                "question": "行业主要矛盾与剩余预期差是什么？",
                "answer_location": "市场隐含判断与研究差异",
                "status": "answered",
            }
        ],
        "calculation_audit": "无派生数字需要复核",
        "counterevidence_audit": "已确认报告呈现决定性反证",
        "unverified_items": [],
    }


def _needs_revision_validation(artifact_ref: str) -> dict:
    payload = _final_validation(artifact_ref)
    payload["verdict"] = "needs_revision"
    payload["checks"][1]["status"] = "fail"
    payload["findings"] = [
        {
            "severity": "high",
            "location": "测试报告",
            "issue": "证据边界不足",
            "impact": "当前版本不宜进入发布审批",
            "required_revision": "补充证据或降级结论",
        }
    ]
    return payload


def test_design_activation_and_legacy_compatibility() -> None:
    planner = ResearchPlanningService()
    compiler = ExecutionPlanCompiler()
    for mode in ("full_research", "research_update"):
        proposal = planner.propose(_request(mode), {"evidence_ready": False})
        assert proposal.context["methodology"]["research_design_required"] is True
        assert proposal.context["methodology"]["personal_principle_refs"] == []
        assert {"R09", "R10"} <= set(proposal.context["methodology"]["reasoning_method_refs"])
        assert proposal.context["methodology"]["judgment_types_defaulted"] is True
        assert proposal.context["methodology"]["final_artifact_validation_required"] is True
        assert set(proposal.context["methodology"]["framework_selection_reasons"]) == set(
            proposal.context["methodology"]["framework_refs"]
        )
        assert "design" in {node.id for node in proposal.nodes}
        plan = compiler.compile(proposal)
        positions = {node.id: index for index, node in enumerate(plan.nodes)}
        assert positions["design"] < positions["macro"] < positions["evidence_handoff"]
        assert positions["evidence_handoff"] < positions["hypotheses"] < positions["draft"]
        assert positions["draft"] < positions["final_validation"] < positions["approval_request"]

    for mode in ("ingest_only", "evidence_refresh"):
        proposal = planner.propose(_request(mode), {"evidence_ready": False})
        assert "design" not in {node.id for node in proposal.nodes}

    legacy = planner.propose({"id": "legacy", "mode": "full_research", "title": "A股行业研究"}, {})
    assert "design" not in {node.id for node in legacy.nodes}
    assert legacy.context["methodology"]["research_design_required"] is False
    parsed = build_parser().parse_args(["run", "plan:x", "bundle:x", "--node-outputs", "outputs.yaml"])
    assert parsed.node_outputs == "outputs.yaml"


def test_compiler_rejects_design_bypass() -> None:
    proposal = ResearchPlanningService().propose(_request(), {"evidence_ready": False})
    proposal.nodes = [node for node in proposal.nodes if node.id != "design"]
    for node in proposal.nodes:
        node.dependencies = [dep for dep in node.dependencies if dep != "design"]
    with pytest.raises(PlanCompilationError, match="ResearchDesign|研究设计|输入不可满足"):
        ExecutionPlanCompiler().compile(proposal)


def test_candidate_principles_never_auto_activate_without_user_confirmation() -> None:
    registry = ResearchMethodRegistry()
    assert all(card["status"] == "candidate" for card in registry.personal_principles.values())
    assert registry.resolve_for_request(_request())["personal_principle_refs"] == []
    first = registry.personal_principles["PR-001"]
    first["status"] = "confirmed"
    with pytest.raises(ValueError, match="用户确认"):
        registry._validate_personal_methodology()
    first["confirmation"] = {
        "confirmed_by": "user",
        "confirmed_on": "2026-09-14",
        "record": "用户逐条确认 PR-001 的研究原则",
    }
    registry._validate_personal_methodology()
    assert registry.resolve_for_request(_request())["personal_principle_refs"] == ["PR-001"]
    registry.personal_principles["PR-001-v2"] = {
        **first,
        "version": 2,
        "supersedes": "PR-001",
        "status": "candidate",
        "confirmation": None,
    }
    registry._validate_personal_methodology()
    registry.personal_principles["PR-001-v2"]["status"] = "confirmed"
    registry.personal_principles["PR-001-v2"]["confirmation"] = dict(first["confirmation"])
    with pytest.raises(ValueError, match="多个已确认版本"):
        registry._validate_personal_methodology()


def test_design_and_report_contract_reject_missing_or_invented_fields() -> None:
    selected = ResearchMethodRegistry().resolve_for_request(_request())
    contract = selected["research_design_contract"]
    design = _design(contract)
    validate_research_design(design, contract)
    invalid = dict(design, hypotheses=design["hypotheses"][:1])
    with pytest.raises(ValueError, match="竞争假设"):
        validate_research_design(invalid, contract)
    invalid = dict(design, information_cutoff="2026-09-09")
    with pytest.raises(ValueError, match="不一致"):
        validate_research_design(invalid, contract)
    invalid = dict(design, personal_principle_refs=["PR-001"])
    with pytest.raises(ValueError, match="个人原则"):
        validate_research_design(invalid, contract)

    report_contract = selected["equity_report_contract"]
    validate_equity_report(_report(), report_contract)
    with pytest.raises(ValueError, match="命题状态"):
        validate_equity_report(dict(_report(), thesis_status="strong_buy"), report_contract)
    with pytest.raises(ValueError, match="交易、仓位"):
        validate_equity_report(dict(_report(), trade_action="buy"), report_contract)
    with pytest.raises(ValueError, match="事前预期基线"):
        validate_equity_report(dict(_report(), expectation_and_valuation="市场明显低估"), report_contract)
    validate_equity_report(
        dict(_report(), expectation_and_valuation="市场明显低估", expectation_baseline_ref="baseline:consensus"),
        report_contract,
    )


def test_case_ledger_rejects_incomplete_retrospective() -> None:
    registry = ResearchMethodRegistry()
    registry.personal_case_ledger["cases"]["case:unfinished"] = {"request_ref": "missing.yaml"}
    with pytest.raises(ValueError, match="复盘案例.*缺少"):
        registry._validate_personal_methodology()


def test_runtime_stops_on_missing_design_and_enforces_report_contract(tmp_path: Path) -> None:
    request = _request()
    plan = ExecutionPlanCompiler().compile(
        ResearchPlanningService().propose(request, {"evidence_ready": True, "available_types": ["EvidenceFact", "EvidenceAssessment"]})
    )

    def run_case(name: str, node_outputs: dict, *, old_report: bool = False) -> tuple[SemanticaResearchGraphRepository, object]:
        repository = SemanticaResearchGraphRepository(tmp_path / name)
        seed = RuntimeEntity(id=f"request:{name}", type="ResearchRequest", properties=request, bundle_id=name)
        facts = [
            RuntimeEntity(id="fact:orders", type="EvidenceFact", bundle_id=name),
            RuntimeEntity(id="fact:cash", type="EvidenceFact", bundle_id=name),
        ]
        assessment = RuntimeEntity(
            id=f"assessment:{name}", type="EvidenceAssessment", bundle_id=name,
            properties={"assessment_status": "complete", "lineage_complete": True, "ready_for_directional_judgment": True},
        )
        seeds = [seed, *facts, assessment]
        if old_report:
            seeds.append(RuntimeEntity(id=f"old-report:{name}", type="PublishedReport", bundle_id=name))
        summary = ResearchOrchestrator(repository).start(
            plan, bundle_id=name, seed_entities=seeds,
            runtime_context={"node_outputs": node_outputs, "recorded_at": datetime(2026, 9, 8, tzinfo=timezone.utc)},
        )
        return repository, summary

    missing_repository, summary = run_case("missing-design", {}, old_report=True)
    assert summary.status == "failed"
    assert summary.failed_nodes == ["design"]
    assert not any(item.type in {"Hypothesis", "DraftReport"} for item in missing_repository.list_entities("missing-design"))

    design_contract = plan.planning_context["methodology"]["research_design_contract"]
    design_output = {"design": [{"type": "ResearchDesign", "properties": _design(design_contract)}]}
    repository, summary = run_case("missing-macro", design_output)
    assert summary.status == "failed"
    assert summary.failed_nodes == ["macro"]
    repository.close()

    macro_output = dict(design_output, macro=[{"type": "MacroContext", "properties": _macro_context()}])
    repository, summary = run_case("missing-handoff", macro_output)
    assert summary.status == "failed"
    assert summary.failed_nodes == ["evidence_handoff"]
    repository.close()

    pre_report_output = dict(
        macro_output,
        evidence_handoff=[{"type": "EvidenceHandoff", "properties": _evidence_handoff()}],
        hypotheses=[{"type": "Hypothesis", "properties": _hypothesis()}],
    )
    repository, summary = run_case("missing-report", pre_report_output)
    assert summary.status == "failed"
    assert summary.failed_nodes == ["draft"]
    repository.close()

    lens_report = dict(_report(), shortest_evidence_chain=["analyst-lens:historical-view"])
    repository, summary = run_case(
        "lens-as-evidence", dict(pre_report_output, draft=[{"type": "DraftReport", "properties": lens_report}])
    )
    assert summary.status == "failed"
    assert summary.failed_nodes == ["draft"]
    repository.close()

    def revision_outputs(name: str) -> dict:
        report = dict(
            _report(),
            macro_context_ref=f"{name}:macro:result:1",
            evidence_handoff_ref=f"{name}:evidence_handoff:result:1",
            judgment_refs=[f"{name}:judgment:result:1"],
        )
        return dict(
            pre_report_output,
            draft=[{"type": "DraftReport", "properties": report}],
            final_validation=[
                {
                    "type": "FinalArtifactValidation",
                    "properties": _needs_revision_validation(f"{name}:draft:result:1"),
                }
            ],
        )

    repository, summary = run_case("needs-revision", revision_outputs("needs-revision"))
    assert summary.status == "failed"
    assert summary.failed_nodes == ["final_validation"]
    assert not any(item.type == "ApprovalRequest" for item in repository.list_entities("needs-revision"))
    repository.close()

    def complete_outputs(name: str) -> dict:
        report = dict(
            _report(),
            macro_context_ref=f"{name}:macro:result:1",
            evidence_handoff_ref=f"{name}:evidence_handoff:result:1",
            judgment_refs=[f"{name}:judgment:result:1"],
        )
        return dict(
            pre_report_output,
            draft=[{"type": "DraftReport", "properties": report}],
            final_validation=[
                {
                    "type": "FinalArtifactValidation",
                    "properties": _final_validation(f"{name}:draft:result:1"),
                }
            ],
        )

    valid_outputs = complete_outputs("missing-design")
    recovered = ResearchOrchestrator(missing_repository).resume(
        plan, bundle_id="missing-design", runtime_context={"node_outputs": valid_outputs}
    )
    assert recovered.status == "awaiting_input"
    missing_repository.close()

    repository, summary = run_case("complete", complete_outputs("complete"))
    assert summary.status == "awaiting_input"
    draft = next(item for item in repository.list_entities("complete") if item.type == "DraftReport")
    assert "市场隐含判断与研究差异" in draft.properties["content_markdown"]
    assert "两期订单与回款持续背离" in draft.properties["content_markdown"]
    approvals = [item for item in repository.list_entities("complete") if item.type == "ApprovalRequest"]
    assert len(approvals) == 1
    ApprovalService(repository).approve(bundle_id="complete", request_id=approvals[0].id, approver_id="human")
    assert ResearchOrchestrator(repository).resume(plan, bundle_id="complete").status == "completed"
    published = next(item for item in repository.list_entities("complete") if item.type == "PublishedReport")
    assert published.properties["content_markdown"] == draft.properties["content_markdown"]
    repository.close()


def test_historical_research_requests_are_replayed_without_rewriting_outputs() -> None:
    paths = [
        ROOT / "research_outputs/a-share-semiconductor-2026h1/request.yaml",
        ROOT / "research_outputs/a-share-innovative-drugs-one-month-2026-09-08/request.yaml",
    ]
    registry = ResearchMethodRegistry()
    for path in paths:
        original = yaml.safe_load(path.read_text(encoding="utf-8"))
        original["asset_class"] = "equity"
        original["market_scope"] = "A_share"
        selected = registry.resolve_for_request(original)
        assert selected["research_design_required"] is True
        assert selected["personal_principle_refs"] == []
        assert selected["analyst_lens_refs"] == []
        assert set(("BF-MF-01", "BF-PI-01", "BF-EF-01")) <= set(selected["framework_refs"])


def test_skill_and_report_template_references_are_registered() -> None:
    skill = ROOT / ".agents/skills/touyan-quanyi-yanjiu-zongkong/SKILL.md"
    protocol = skill.parent / "references/research-design-protocol.md"
    skill_text = skill.read_text(encoding="utf-8")
    assert skill_text.startswith("---\n")
    frontmatter = yaml.safe_load(skill_text.split("---", 2)[1])
    assert frontmatter["name"] == "touyan-quanyi-yanjiu-zongkong"
    assert "完整研究" in frontmatter["description"]
    assert protocol.is_file()
    assert (ROOT / "研究方法/个人方法论/principles.yaml").is_file()
    selected = ResearchMethodRegistry().resolve_for_request(_request())
    assert (ROOT / selected["equity_report_contract"]["template_ref"]).is_file()
