#!/usr/bin/env python3
"""语义基线发布门的最小负向回归。"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "05_control_evaluation" / "03_校验"))

from validate_semantic_baseline import current_ontology_identity, validate_semantic_baseline  # noqa: E402
from validator_utils import artifact_sha256  # noqa: E402


def main() -> int:
    fingerprint, versions = current_ontology_identity()
    assert fingerprint.startswith("sha256:") and len(fingerprint) == 71
    assert versions
    with tempfile.TemporaryDirectory() as temp:
        run_dir = Path(temp)
        try:
            validate_semantic_baseline(run_dir, {"run_mode": "production"})
        except ValueError as exc:
            assert "缺少 semantic_baseline" in str(exc)
        else:
            raise AssertionError("生产正式包缺少语义基线时必须失败")
        fixture = validate_semantic_baseline(run_dir, {"run_mode": "fixture"})
        assert fixture["status"] == "legacy_fixture"

        projection_fingerprints = {
            "stage_02": "a" * 64,
            "stage_03": "b" * 64,
            "stage_04": "c" * 64,
        }
        graph = {
            "authority_contract": "ontology_authority_graph_v1",
            "business_instance_graph": {
                "schema_name": "ontology_business_instance_graph",
                "schema_version": "1.0.0",
                "authority": "business_parameters",
                "objects": [],
                "relations": [],
                "projection_fingerprints": projection_fingerprints,
            },
        }
        graph_path = run_dir / "business_instance_graph.yaml"
        graph_path.write_text(yaml.safe_dump(graph, sort_keys=False), encoding="utf-8")
        contexts = {}
        for stage in ["stage_01", "stage_02", "stage_03", "stage_04", "stage_05"]:
            contexts[stage] = {
                "schema_version": "1.0.0",
                "stage": stage,
                "ontology_versions": versions,
                "ontology_fingerprint": fingerprint,
                "declared_object_ids": [],
                "referenced_semantic_ids": [],
                "resolved_semantic_ids": [],
                "task_local_ids": [],
                "unresolved_semantic_ids": [],
                "reference_coverage": 1,
                "resolution_status": "not_applicable",
            }
        baseline = {
            "schema_name": "controlled_research_semantic_baseline",
            "schema_version": "1.0.0",
            "ontology_fingerprint": fingerprint,
            "ontology_versions": versions,
            "resolution_policy": "production_complete",
            "instance_graph": {
                "artifact": "business_instance_graph.yaml",
                "source_artifact_id": "graph-artifact",
                "source_artifact_version": 1,
                "authority_contract": "ontology_authority_graph_v1",
                "projection_fingerprints": projection_fingerprints,
            },
            "stage_contexts": contexts,
        }
        baseline_path = run_dir / "semantic_context.yaml"
        baseline_path.write_text(yaml.safe_dump(baseline, sort_keys=False), encoding="utf-8")
        production_manifest = {
            "run_mode": "production",
            "semantic_baseline": {
                "artifact": "semantic_context.yaml",
                "hash": artifact_sha256(baseline_path),
                "ontology_fingerprint": fingerprint,
                "instance_graph_artifact": "business_instance_graph.yaml",
                "instance_graph_hash": artifact_sha256(graph_path),
            },
        }
        result = validate_semantic_baseline(run_dir, production_manifest)
        assert result["status"] == "pass"
        contexts["stage_03"]["unresolved_semantic_ids"] = ["JU-MISSING"]
        contexts["stage_03"]["referenced_semantic_ids"] = ["JU-MISSING"]
        contexts["stage_03"]["reference_coverage"] = 0
        contexts["stage_03"]["resolution_status"] = "partial"
        baseline_path.write_text(yaml.safe_dump(baseline, sort_keys=False), encoding="utf-8")
        production_manifest["semantic_baseline"]["hash"] = artifact_sha256(baseline_path)
        try:
            validate_semantic_baseline(run_dir, production_manifest)
        except ValueError as exc:
            assert "未解析语义引用" in str(exc)
        else:
            raise AssertionError("生产语义基线含未解析引用时必须失败")
    print("semantic baseline negative regression passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
