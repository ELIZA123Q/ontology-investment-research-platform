#!/usr/bin/env python3

from __future__ import annotations

import copy
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "运行校验"))
sys.path.insert(0, str(ROOT / "04_推理"))
sys.path.insert(0, str(ROOT / "05_表达交付"))

from research_contract import derive_aggregation_outcome, derive_scope_relation, validate_scope_graph  # noqa: E402
from semantic_review import validate_independent_semantic_review  # noqa: E402
from validate_04_outputs import _validate_scope_aggregation_and_permissions  # noqa: E402
from validate_05_outputs import validate as validate_05  # noqa: E402
from validate_publish import discover_artifacts  # noqa: E402
from validate_run import derive_run_outcome  # noqa: E402
from validator_utils import file_sha256, load_yaml_file  # noqa: E402


def load(path: Path):
    return yaml.safe_load(path.read_text(encoding="utf-8"))


class ScopeAggregationReleaseTests(unittest.TestCase):
    def setUp(self) -> None:
        self.run = discover_artifacts(ROOT / "示例1")
        self.view = load_yaml_file(self.run.view)
        self.audit = load(self.run.audit)

    def test_scope_relation_is_derived_not_self_reported(self) -> None:
        graph = validate_scope_graph(self.view)
        self.assertEqual(derive_scope_relation("SCOPE-SERVER-DRAM", "SCOPE-MEMORY-INDUSTRY", graph), "narrower")
        self.assertEqual(derive_scope_relation("SCOPE-MEMORY-INDUSTRY", "SCOPE-SERVER-DRAM", graph), "broader")

    def test_product_evidence_cannot_generate_industry_claim(self) -> None:
        audit = copy.deepcopy(self.audit)
        next(item for item in audit["claim_register"] if item["claim_id"] == "C-05")["scope_ref"] = "SCOPE-MEMORY-INDUSTRY"
        with self.assertRaisesRegex(ValueError, "范围上限"):
            _validate_scope_aggregation_and_permissions(audit, self.view, self.run.snapshot_dir)

    def test_divergent_children_cannot_be_declared_synchronized(self) -> None:
        self.assertEqual(
            derive_aggregation_outcome(["structural_expansion", "enterprise_tight", "server_dram_digesting"]),
            "differentiated",
        )
        audit = copy.deepcopy(self.audit)
        audit["aggregation_results"][0]["outcome"] = "synchronized"
        with self.assertRaisesRegex(ValueError, "应由子项派生为 differentiated"):
            _validate_scope_aggregation_and_permissions(audit, self.view, self.run.snapshot_dir)

    def test_gate_statement_cannot_drift_from_stage_03(self) -> None:
        audit = copy.deepcopy(self.audit)
        audit["judgment_unit_gate_results"][0]["statement"] += "（擅自改写）"
        with self.assertRaisesRegex(ValueError, "未逐字段继承"):
            _validate_scope_aggregation_and_permissions(audit, self.view, self.run.snapshot_dir)

    def test_narrow_claim_cannot_be_used_as_industry_title(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "run"
            shutil.copytree(ROOT / "示例1", target)
            artifacts = discover_artifacts(target)
            source = load(artifacts.audit)
            permission = next(item for item in source["handoff_to_05"]["approved_core_claims"] if item["claim_id"] == "C-05")
            permission["permitted_role"] = "core_thesis"
            artifacts.audit.write_text(yaml.safe_dump(source, allow_unicode=True, sort_keys=False), encoding="utf-8")
            expression = load(artifacts.expression_audit)
            title = next(item for item in expression["claim_expression_register"] if item["location_kind"] == "report_title")
            title["source_rcs"] = ["C-05"]
            title["expression_scope_ref"] = "SCOPE-SERVER-DRAM"
            title["scope_relation"] = "same"
            expression["metadata"]["source_04_audit_hash"] = file_sha256(artifacts.audit)
            artifacts.expression_audit.write_text(yaml.safe_dump(expression, allow_unicode=True, sort_keys=False), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "主标题必须使用任务根范围"):
                validate_05(artifacts.delivery, "行业周期判断", artifacts.expression_audit, artifacts.audit)

    def test_missing_semantic_review_is_only_stage_ready(self) -> None:
        outcome = derive_run_outcome(
            chain_publish_status="PUBLISHABLE",
            quality_pass=True,
            validity_statuses={f"stage_0{i}": "current" for i in range(1, 6)},
            audit={"claim_register": [], "overall_judgment": {"judgment_level": "J0"}},
            semantic_review_status="missing",
        )
        self.assertEqual(outcome["publish_status"], "STAGE_READY")
        self.assertFalse(outcome["publishable"])

    def test_self_review_and_stale_hash_are_blocked(self) -> None:
        manifest = load(self.run.run_dir / "run_manifest.yaml")
        review = load(self.run.semantic_review)
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "review.yaml"
            self_review = copy.deepcopy(review)
            self_review["reviewer"]["reviewer_id"] = manifest["producer_id"]
            path.write_text(yaml.safe_dump(self_review, allow_unicode=True, sort_keys=False), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "生产者不得自审"):
                validate_independent_semantic_review(
                    path,
                    stage_hashes={stage: manifest["stages"][stage]["hash"] for stage in ["stage_02", "stage_03", "stage_04", "stage_05"]},
                    contract_version="1.2.0",
                    run_mode="fixture",
                    producer_id=manifest["producer_id"],
                )
            stale = copy.deepcopy(review)
            stale["inputs"]["stage_hashes"]["stage_04"] = "sha256:stale"
            path.write_text(yaml.safe_dump(stale, allow_unicode=True, sort_keys=False), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "输入哈希"):
                validate_independent_semantic_review(
                    path,
                    stage_hashes={stage: manifest["stages"][stage]["hash"] for stage in ["stage_02", "stage_03", "stage_04", "stage_05"]},
                    contract_version="1.2.0",
                    run_mode="fixture",
                    producer_id=manifest["producer_id"],
                )


if __name__ == "__main__":
    unittest.main()
