from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import pytest

from ir_platform.adapters import SemanticaResearchGraphRepository
from ir_platform.runtime import (
    EvidenceLineageService,
    GraphBundle,
    ResearchStateService,
    RuleExecutionService,
    RuntimeEntity,
    RuntimeRelation,
)


def dt(day: int) -> datetime:
    return datetime(2026, 1, day, tzinfo=timezone.utc)


def test_persistence_read_model_temporal_replay_and_lineage(tmp_path: Path) -> None:
    repository = SemanticaResearchGraphRepository(tmp_path)
    entities = [
        RuntimeEntity(id="source", type="SourceDocument", properties={"locator": "p.1"}, recorded_at=dt(2), bundle_id="run"),
        RuntimeEntity(id="claim", type="EvidenceClaim", recorded_at=dt(3), bundle_id="run"),
        RuntimeEntity(id="fact", type="EvidenceFact", valid_from=dt(1), recorded_at=dt(4), bundle_id="run"),
        RuntimeEntity(id="judgment", type="Judgment", valid_from=dt(1), recorded_at=dt(5), bundle_id="run"),
    ]
    relations = [
        RuntimeRelation(id="r1", type="claimCitesSource", source_id="source", target_id="claim", recorded_at=dt(3), bundle_id="run"),
        RuntimeRelation(id="r2", type="claimSupportsFact", source_id="claim", target_id="fact", recorded_at=dt(4), bundle_id="run"),
        RuntimeRelation(id="r3", type="factGroundsJudgment", source_id="fact", target_id="judgment", recorded_at=dt(5), bundle_id="run"),
    ]
    repository.add_bundle(GraphBundle(bundle_id="run", entities=entities, relations=relations))
    repository.record_provenance(
        entities[-1], activity_id="evaluate:judgment", source="fact", source_location="p.1", used_entities=["fact"]
    )
    prov_result = repository.query_sparql(
        "ASK { GRAPH ?bundle { ?judgment <http://www.w3.org/ns/prov#wasGeneratedBy> ?activity . "
        "?activity a <http://www.w3.org/ns/prov#Activity> } }"
    )
    assert prov_result["metadata"]["boolean"] is True
    assert len(repository.context_graph.nodes) == 4
    assert len(repository.context_graph.edges) == 3
    assert [item.id for item in ResearchStateService(repository).state_at(bundle_id="run", recorded_at=dt(3)).entities] == ["claim", "source"]
    lineage = EvidenceLineageService(repository).trace("judgment")
    assert {item["id"] for item in lineage["entities"]} == {"source", "claim", "fact", "judgment"}
    repository.close()
    del repository

    reopened = SemanticaResearchGraphRepository(tmp_path)
    assert reopened.get_entity("judgment") is not None
    assert len(reopened.list_relations("run")) == 3
    reopened.close()
    with sqlite3.connect(tmp_path / "provenance.sqlite3") as connection:
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert tables


def test_append_only_revisions_and_conflicts_are_retained(tmp_path: Path) -> None:
    repository = SemanticaResearchGraphRepository(tmp_path)
    original = RuntimeEntity(id="fact:v1", type="EvidenceFact", properties={"value": 1}, recorded_at=dt(2), bundle_id="run")
    revision = RuntimeEntity(id="fact:v2", type="EvidenceFact", properties={"value": 2}, recorded_at=dt(4), supersedes="fact:v1", bundle_id="run")
    conflict = RuntimeEntity(id="fact:conflict", type="EvidenceFact", properties={"value": 3}, recorded_at=dt(4), bundle_id="run")
    repository.add_bundle(GraphBundle(bundle_id="run", entities=[original, revision, conflict]))
    with pytest.raises(ValueError):
        repository.add_entity(original.model_copy(update={"properties": {"value": 99}}))
    assert {item.id for item in repository.state_at(bundle_id="run", recorded_at=dt(3)).entities} == {"fact:v1"}
    assert {item.id for item in repository.state_at(bundle_id="run", recorded_at=dt(5)).entities} == {"fact:v2", "fact:conflict"}
    repository.close()


def test_deterministic_rule_execution_creates_runtime_record(tmp_path: Path) -> None:
    repository = SemanticaResearchGraphRepository(tmp_path)
    record = RuleExecutionService(repository).evaluate(
        bundle_id="run",
        rule_id="evidence-cap",
        rule_version="1",
        inputs={"grade": "Q1"},
        evaluator=lambda inputs: (inputs["grade"] == "Q1", {"maximum_judgment_level": "J1"}),
    )
    assert record.type == "RuleEvaluation"
    assert record.properties["result"]["maximum_judgment_level"] == "J1"
    repository.close()
