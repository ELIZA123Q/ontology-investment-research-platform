from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from ir_platform.adapters import SemanticaResearchGraphRepository
from ir_platform.compat import ResearchRunExporter, ResearchRunImporter
from ir_platform.runtime import EvidenceLineageService


ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize("example", ["示例1", "示例2"])
def test_legacy_run_round_trip_is_byte_exact(example: str, tmp_path: Path) -> None:
    source = ROOT / example
    repository = SemanticaResearchGraphRepository(tmp_path / "runtime")
    bundle = ResearchRunImporter(repository).import_legacy_run(source)
    assert any(item.type == "Judgment" for item in bundle.entities)
    assert any(item.type == "EvidenceFact" for item in bundle.entities)
    lineage = EvidenceLineageService(repository).trace(f"{bundle.bundle_id}:J-RUN-01")
    lineage_types = {item["type"] for item in lineage["entities"]}
    assert {"Judgment", "RuleEvaluation", "EvidenceFact", "EvidenceClaim", "SourceDocument"} <= lineage_types
    repository.close()
    del repository

    reopened = SemanticaResearchGraphRepository(tmp_path / "runtime")
    exported = tmp_path / "exported"
    ResearchRunExporter(reopened).export_legacy_run(bundle.bundle_id, exported)
    for original in sorted(path for path in source.rglob("*") if path.is_file() and path.suffix.lower() in {".yaml", ".yml", ".json", ".csv", ".md", ".txt"}):
        relative = original.relative_to(source)
        assert (exported / relative).read_bytes() == original.read_bytes()
    reopened.close()


@pytest.mark.parametrize("example", ["示例1", "示例2"])
def test_fixture_manifest_remains_publishable(example: str) -> None:
    # 这里检查刷新后的冻结边界；完整旧校验器由 validate_project.py 继续执行。
    manifest = yaml.safe_load((ROOT / example / "run_manifest.yaml").read_text(encoding="utf-8"))
    assert manifest["validation_issues"] == []
    assert all(stage["validity_status"] == "current" for stage in manifest["stages"].values())
