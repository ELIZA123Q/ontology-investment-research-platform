from __future__ import annotations

from copy import deepcopy

import pytest
from pydantic import ValidationError

from ir_platform.planning import ExecutionPlanCompiler, PlanCompilationError, ResearchPlanningService
from ir_platform.rules import RuleDefinition, RuleEvaluator, RuleRegistry


def test_four_graph_states_compile_to_different_dags() -> None:
    planner = ResearchPlanningService()
    compiler = ExecutionPlanCompiler()
    cases = [
        ({"id": "none", "mode": "full_research"}, {"evidence_ready": False}),
        (
            {"id": "ready", "mode": "full_research"},
            {"evidence_ready": True, "available_types": ["EvidenceFact", "EvidenceAssessment"]},
        ),
        (
            {"id": "conflict", "mode": "full_research"},
            {"evidence_ready": False, "conflict_detected": True},
        ),
        ({"id": "ingest", "mode": "ingest_only"}, {}),
    ]
    plans = [compiler.compile(planner.propose(request, state)) for request, state in cases]
    assert [len(plan.nodes) for plan in plans] == [13, 8, 14, 2]
    assert "conflict_followup" in {node.id for node in plans[2].nodes}
    assert {node.capability_ref for node in plans[3].nodes} == {"normalize_request", "ingest_material"}


def test_restricted_rule_dsl_rejects_code_and_supports_graph_patterns() -> None:
    evaluator = RuleEvaluator()
    rule = RuleRegistry().resolve("source_document_goal_satisfied")
    assert evaluator.evaluate(rule, {"graph": {"type_counts": {"SourceDocument": 1}}}).matched
    malicious = rule.model_copy(update={"when": {"eval": "__import__('os').system('false')"}})
    with pytest.raises(ValueError, match="不允许"):
        evaluator.evaluate(malicious, {})

    with pytest.raises(ValidationError, match="不允许的规则结果"):
        RuleDefinition.model_validate(
            {
                "id": "arbitrary-code",
                "version": "1.0.0",
                "kind": "validation",
                "input_types": ["ResearchRequest"],
                "priority": 1,
                "when": {"exists": {"path": "request.id"}},
                "then": [{"run_python": "os.system('false')"}],
                "failure_handling": "block",
            }
        )


def test_compiler_rejects_unknown_capability_cycle_type_mismatch_and_publish_bypass() -> None:
    planner = ResearchPlanningService()
    compiler = ExecutionPlanCompiler()
    proposal = planner.propose({"id": "x", "mode": "full_research"}, {"evidence_ready": False})

    unknown = proposal.model_copy(deep=True)
    unknown.nodes[0].capability_ref = "invented_by_ai"
    with pytest.raises(PlanCompilationError, match="未知"):
        compiler.compile(unknown)

    cyclic = proposal.model_copy(deep=True)
    cyclic.nodes[0].dependencies = [cyclic.nodes[-1].id]
    with pytest.raises(PlanCompilationError, match="循环"):
        compiler.compile(cyclic)

    mismatch = proposal.model_copy(deep=True)
    mismatch.nodes = [node for node in mismatch.nodes if node.id != "context"]
    mismatch.nodes[0].dependencies = []
    for node in mismatch.nodes:
        node.dependencies = [dep for dep in node.dependencies if dep != "context"]
    with pytest.raises(PlanCompilationError, match="输入不可满足"):
        compiler.compile(mismatch)

    bypass = proposal.model_copy(deep=True)
    bypass.nodes = [node for node in bypass.nodes if node.id != "approval_request"]
    for node in bypass.nodes:
        node.dependencies = [dep for dep in node.dependencies if dep != "approval_request"]
    with pytest.raises(PlanCompilationError, match="人工审批"):
        compiler.compile(bypass)


def test_compiler_rejects_write_scope_escalation_and_creates_revision() -> None:
    planner = ResearchPlanningService()
    compiler = ExecutionPlanCompiler()
    proposal = planner.propose({"id": "revision", "mode": "ingest_only"}, {})
    escalated = proposal.model_copy(deep=True)
    escalated.nodes[0].requested_writes = ["PublishedReport"]
    with pytest.raises(PlanCompilationError, match="越权"):
        compiler.compile(escalated)
    first = compiler.compile(proposal)
    second = compiler.compile(proposal, revision=2, supersedes=first.id)
    assert second.revision == 2
    assert second.supersedes == first.id
    assert second.content_hash != first.content_hash
