from __future__ import annotations

from pathlib import Path
import hashlib
import json

import pytest
import yaml

from ir_platform.adapters import SemanticaResearchGraphRepository
from ir_platform.runtime import EvidenceLineageService, ResearchGraphArchiveService


ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize("name", ["memory-cycle", "equipment-substitution"])
def test_graph_example_preserves_judgments_boundaries_and_publication(name: str, tmp_path: Path) -> None:
    example = ROOT / "examples" / name
    expected = yaml.safe_load((example / "expected.yaml").read_text(encoding="utf-8"))
    repository = SemanticaResearchGraphRepository(tmp_path / name)
    bundle = ResearchGraphArchiveService(repository).import_bundle(example / "research-bundle.trig")
    assert bundle.bundle_id == expected["bundle_id"]
    entities = repository.list_entities(bundle.bundle_id)
    actual = {item.id: item for item in entities if item.type == "Judgment"}
    assert {
        item["id"]: (item["judgment_level"], item["statement"])
        for item in expected["judgments"]
    } == {
        identifier: (item.properties.get("judgment_level"), item.properties.get("statement"))
        for identifier, item in actual.items()
    }
    assert any(
        item.type == "PublishedReport"
        and item.properties.get("overall_judgment_level") == expected["overall_judgment_level"]
        and item.properties.get("publish_status") == expected["publish_status"]
        for item in entities
    )
    assert any(item.type == "ApprovalRecord" and item.properties.get("approver_type") == "human" for item in entities)
    assert any(item.type == "ExecutionPlan" for item in entities)
    boundaries = [
        {
            "id": item.id,
            **{
                key: item.properties.get(key)
                for key in ("conditions", "scope", "time_horizon", "uncertainty_refs")
            },
        }
        for item in entities
        if item.type == "Judgment"
    ]
    gaps = [
        {
            "id": item.id,
            **{
                key: item.properties.get(key)
                for key in (
                    "linked_gap_ids",
                    "gap_action",
                    "scope_limit",
                    "downgrade_reason",
                    "forbidden_outputs",
                )
            },
        }
        for item in entities
        if item.type == "EvidenceReadinessAssessment"
    ]
    assert len(boundaries) == expected["judgment_boundary_count"]
    assert len(gaps) == expected["evidence_gap_count"]
    assert _digest(boundaries) == expected["judgment_boundary_sha256"]
    assert _digest(gaps) == expected["evidence_gap_sha256"]
    lineage = EvidenceLineageService(repository).trace(expected["judgments"][0]["id"])
    assert {"SourceDocument", "EvidenceClaim", "EvidenceFact", "RuleEvaluation", "Judgment"} <= {
        item["type"] for item in lineage["entities"]
    }
    repository.close()


def _digest(items: list[dict]) -> str:
    payload = json.dumps(
        sorted(items, key=lambda item: item["id"]),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
