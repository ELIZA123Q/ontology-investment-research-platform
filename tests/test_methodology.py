from __future__ import annotations

import pytest

from ir_platform.methodology import ResearchMethodRegistry
from ir_platform.planning import ResearchPlanningService


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
