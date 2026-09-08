from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest

from ir_platform.adapters import SemanticaPipelineAdapter, SemanticaResearchGraphRepository
from ir_platform.execution import ApprovalService, CapabilityRegistry, ResearchOrchestrator
from ir_platform.planning import ExecutionNode, ExecutionPlan, ExecutionPlanCompiler, ResearchPlanningService
from ir_platform.rules import CapabilityDefinitionRegistry
from ir_platform.runtime import EvidenceLineageService, RuntimeEntity


def request(bundle_id: str, mode: str = "full_research") -> RuntimeEntity:
    return RuntimeEntity(
        id=f"request:{bundle_id}",
        type="ResearchRequest",
        properties={"id": f"request:{bundle_id}", "mode": mode},
        recorded_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        bundle_id=bundle_id,
    )


def test_orchestrator_waits_for_human_approval_and_records_rule_audit(tmp_path: Path) -> None:
    repository = SemanticaResearchGraphRepository(tmp_path)
    seed = request("run")
    state = {"evidence_ready": True, "available_types": ["EvidenceFact", "EvidenceAssessment"]}
    plan = ExecutionPlanCompiler().compile(ResearchPlanningService().propose(seed.properties, state))
    facts = RuntimeEntity(id="fact", type="EvidenceFact", bundle_id="run")
    assessment = RuntimeEntity(
        id="assessment",
        type="EvidenceAssessment",
        properties={
            "assessment_status": "complete",
            "lineage_complete": True,
            "ready_for_directional_judgment": True,
        },
        bundle_id="run",
    )
    orchestrator = ResearchOrchestrator(repository, pipeline_adapter=SemanticaPipelineAdapter(max_workers=2))
    waiting = orchestrator.start(plan, bundle_id="run", seed_entities=[seed, facts, assessment])
    assert waiting.status == "awaiting_input"
    approval_requests = [item for item in repository.list_entities("run") if item.type == "ApprovalRequest"]
    assert len(approval_requests) == 1
    ApprovalService(repository).approve(
        bundle_id="run", request_id=approval_requests[0].id, approver_id="human-reviewer"
    )
    completed = orchestrator.resume(plan, bundle_id="run")
    assert completed.status == "completed"
    entities = repository.list_entities("run")
    assert any(item.type == "PublishedReport" for item in entities)
    rule_purposes = {
        item.properties.get("purpose") for item in entities if item.type == "RuleEvaluation"
    }
    assert {"selected-plan", "selected-node", "activated-node", "completed-plan"} <= rule_purposes
    report = next(item for item in entities if item.type == "PublishedReport")
    lineage_types = {
        item["type"] for item in EvidenceLineageService(repository).trace(report.id)["entities"]
    }
    assert {
        "ExecutionPlan",
        "ExecutionNode",
        "ExecutionAttempt",
        "RuleEvaluation",
        "ApprovalRecord",
        "PublishedReport",
    } <= lineage_types
    repository.close()


def test_plan_revision_is_append_only(tmp_path: Path) -> None:
    repository = SemanticaResearchGraphRepository(tmp_path)
    seed = request("rev", "ingest_only")
    proposal = ResearchPlanningService().propose(seed.properties, {})
    compiler = ExecutionPlanCompiler()
    first = compiler.compile(proposal)
    second = compiler.compile(proposal, revision=2, supersedes=first.id)
    orchestrator = ResearchOrchestrator(repository)
    orchestrator.persist_plan(first, bundle_id="rev", seed_entities=[seed])
    orchestrator.persist_plan(second, bundle_id="rev", seed_entities=[seed])
    assert repository.get_entity(first.id).type == "ExecutionPlan"
    assert repository.get_entity(second.id).type == "PlanRevision"
    assert repository.get_entity(second.id).supersedes == first.id
    repository.close()


def test_runtime_rule_caps_formal_judgment_level(tmp_path: Path) -> None:
    repository = SemanticaResearchGraphRepository(tmp_path)
    seed = request("capped")
    state = {"evidence_ready": True, "available_types": ["EvidenceFact", "EvidenceAssessment"]}
    plan = ExecutionPlanCompiler().compile(ResearchPlanningService().propose(seed.properties, state))
    facts = RuntimeEntity(id="fact", type="EvidenceFact", bundle_id="capped")
    assessment = RuntimeEntity(
        id="assessment",
        type="EvidenceAssessment",
        properties={
            "assessment_status": "complete",
            "lineage_complete": True,
            "ready_for_directional_judgment": False,
        },
        bundle_id="capped",
    )
    summary = ResearchOrchestrator(repository).start(
        plan,
        bundle_id="capped",
        seed_entities=[seed, facts, assessment],
        runtime_context={
            "node_outputs": {
                "judgment": [
                    {
                        "id": "judgment:too-high",
                        "type": "Judgment",
                        "properties": {"judgment_level": "J2"},
                    }
                ]
            }
        },
    )
    assert summary.status == "failed"
    assert summary.failed_nodes == ["judgment"]
    entities = repository.list_entities("capped")
    assert not any(item.id == "judgment:too-high" for item in entities)
    assert any(
        item.type == "ExecutionAttempt"
        and item.properties.get("node_id") == "judgment"
        and "超过规则上限 J1" in item.properties.get("error", "")
        for item in entities
    )
    repository.close()


@pytest.mark.parametrize(
    ("idempotent", "max_retries", "succeeds_on", "expected_status", "expected_calls"),
    [(True, 1, 2, "completed", 2), (False, 0, 99, "failed", 1)],
)
def test_only_idempotent_capabilities_retry(
    tmp_path: Path,
    idempotent: bool,
    max_retries: int,
    succeeds_on: int,
    expected_status: str,
    expected_calls: int,
) -> None:
    definition_path = tmp_path / "capabilities.yaml"
    definition_path.write_text(
        f"""
capabilities:
  flaky:
    version: 1.0.0
    input_types: [ResearchRequest]
    output_types: [SourceDocument]
    handler_ref: test.flaky
    reads: [ResearchRequest]
    writes: [SourceDocument]
    idempotent: {str(idempotent).lower()}
    max_retries: {max_retries}
    side_effects: {str(not idempotent).lower()}
    parallel_safe: false
    lifecycle_view: evidence
""",
        encoding="utf-8",
    )
    capabilities = CapabilityRegistry(CapabilityDefinitionRegistry(definition_path))
    calls = 0

    def flaky(call):
        nonlocal calls
        calls += 1
        if calls < succeeds_on:
            raise RuntimeError("transient")
        return [RuntimeEntity(id=f"source:{calls}", type="SourceDocument", bundle_id=call.bundle_id)]

    capabilities.register("test.flaky", flaky)
    node = ExecutionNode(
        id="flaky",
        capability_ref="flaky",
        capability_version="1.0.0",
        dependencies=[],
        activate_rule_refs=[],
        selection_rule_refs=["route_material_ingestion"],
        parameters={},
        input_types=["ResearchRequest"],
        output_types=["SourceDocument"],
        reads=["ResearchRequest"],
        writes=["SourceDocument"],
        idempotent=idempotent,
        max_retries=max_retries,
        side_effects=not idempotent,
        parallel_safe=False,
        lifecycle_view="evidence",
    )
    plan = ExecutionPlan(
        id=f"plan:retry:{idempotent}",
        request_id="request:retry",
        logic_ref="material_ingestion",
        logic_version="1.0.0",
        selection_rule_refs=["route_material_ingestion"],
        revision=1,
        nodes=[node],
        initial_types=["ResearchRequest"],
        awaitable_types=[],
        goal_types=["SourceDocument"],
        completion_rule_refs=["source_document_goal_satisfied"],
        planning_context={"request": {"mode": "ingest_only"}, "state": {}},
        proposal_id="proposal:retry",
    )
    repository = SemanticaResearchGraphRepository(tmp_path / "runtime")
    summary = ResearchOrchestrator(repository, capabilities=capabilities).start(
        plan,
        bundle_id="retry",
        seed_entities=[request("retry", "ingest_only")],
    )
    assert summary.status == expected_status
    assert calls == expected_calls
    attempts = [item for item in repository.list_entities("retry") if item.type == "ExecutionAttempt"]
    assert len(attempts) == expected_calls
    repository.close()
