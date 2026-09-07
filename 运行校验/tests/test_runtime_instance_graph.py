#!/usr/bin/env python3
from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "运行校验"))
sys.path.insert(0, str(ROOT / "03_数据与证据"))

from ontology_instance_graph import InstanceGraphError, validate_instance_graph  # noqa: E402
from runtime_instance_graph import (  # noqa: E402
    assert_stage03_projections,
    compact_reasoning_audit,
    project_reasoning_audit,
)
import status_derivation as status  # noqa: E402


class RuntimeInstanceGraphTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.audit_path = ROOT / "示例2" / "04-美国管制与国产设备替代推理审计-20260715-1.yaml"
        cls.manifest_path = ROOT / "示例2" / "03-美国管制与国产设备替代语义域与证据域实例清单-20260715-1.yaml"
        cls.snapshot_dir = ROOT / "示例2" / "03-美国管制与国产设备替代数据与证据快照-20260715-1"
        cls.audit = yaml.safe_load(cls.audit_path.read_text(encoding="utf-8"))
        cls.manifest = yaml.safe_load(cls.manifest_path.read_text(encoding="utf-8"))

    def test_04_projection_round_trip(self) -> None:
        projected = project_reasoning_audit(self.audit)
        self.assertGreaterEqual(len(projected["hypotheses"]), 1)
        compacted = compact_reasoning_audit(projected)
        self.assertNotIn("hypotheses", compacted)
        self.assertIn("business_instance_graph", compacted)

    def test_04_dual_write_fails(self) -> None:
        bad = project_reasoning_audit(self.audit)
        bad["business_instance_graph"] = copy.deepcopy(self.audit["business_instance_graph"])
        with self.assertRaises(InstanceGraphError):
            compact_reasoning_audit(bad)

    def test_03_hand_edited_projection_fails(self) -> None:
        claims = self.snapshot_dir / "02_assets" / "evidence_claims.csv"
        original = claims.read_text(encoding="utf-8")
        try:
            lines = original.splitlines()
            self.assertGreaterEqual(len(lines), 2)
            lines[1] = lines[1] + "|tampered"
            claims.write_text("\n".join(lines) + "\n", encoding="utf-8")
            with self.assertRaises(InstanceGraphError):
                assert_stage03_projections(self.manifest, self.snapshot_dir)
        finally:
            claims.write_text(original, encoding="utf-8")

    def test_unknown_type_fails(self) -> None:
        graph = copy.deepcopy(self.audit["business_instance_graph"])
        graph["objects"][0]["type"] = "NotARealBusinessType"
        with self.assertRaises(InstanceGraphError):
            validate_instance_graph(graph, check_relation_endpoints=False)

    def test_drivability_threshold_from_ontology(self) -> None:
        before = status.derive_constraint("Q4", "cleared", "ready").maximum_judgment_level
        self.assertEqual(before, "J4")
        schema_path = ROOT / "研究规则" / "reasoning.yaml"
        schema = yaml.safe_load(schema_path.read_text(encoding="utf-8"))
        caps = schema["rules"]["judgment_evidence_threshold"]["parameters"]["evidence_grade_caps"]
        original = caps["Q4"]
        caps["Q4"] = "J2"
        schema_path.write_text(yaml.safe_dump(schema, allow_unicode=True, sort_keys=False, width=140), encoding="utf-8")
        try:
            import importlib

            importlib.reload(status)
            after = status.derive_constraint("Q4", "cleared", "ready").maximum_judgment_level
            self.assertEqual(after, "J2")
        finally:
            caps["Q4"] = original
            schema_path.write_text(yaml.safe_dump(schema, allow_unicode=True, sort_keys=False, width=140), encoding="utf-8")
            import importlib

            importlib.reload(status)

    def test_drivability_evidence_profile_instance(self) -> None:
        before = status.evidence_profile_quality_floor("demand_orders")
        self.assertIn(before, status.EVIDENCE_GRADES)
        profile_path = ROOT / "研究规则" / "二级半导体" / "research_config.yaml"
        original = profile_path.read_text(encoding="utf-8")
        document = yaml.safe_load(original)
        target = next(
            item
            for item in document["runtime_objects"]
            if item.get("id") == "demand_orders" and item.get("type") == "EvidenceProfile"
        )
        target["properties"]["quality_floor"] = "Q1"
        profile_path.write_text(
            yaml.safe_dump(document, allow_unicode=True, sort_keys=False, width=140),
            encoding="utf-8",
        )
        try:
            after = status.evidence_profile_quality_floor("demand_orders")
            self.assertEqual(after, "Q1")
            self.assertNotEqual(after, before)
        finally:
            profile_path.write_text(original, encoding="utf-8")

    def test_02_projects_downstream_views_for_03_04(self) -> None:
        from ontology_instance_graph import canonical_json, project_downstream_stage_views

        view_path = ROOT / "示例2" / "02-美国管制与国产设备替代本体视图-20260715-1.yaml"
        view = yaml.safe_load(view_path.read_text(encoding="utf-8"))
        first = project_downstream_stage_views(view)
        second = project_downstream_stage_views(view)
        self.assertEqual(canonical_json(first), canonical_json(second))
        self.assertGreaterEqual(len(first["judgment_unit_ids"]), 1)
        self.assertGreaterEqual(len(first["evidence_basket_requirement_ids"]), 1)
        self.assertGreaterEqual(len(first["candidate_claim_ids"]), 1)
        self.assertGreaterEqual(len(first["judgment_level_criterion_ids"]), 1)

        baskets = ROOT / "示例2" / "03-美国管制与国产设备替代数据与证据快照-20260715-1" / "01_plan" / "evidence_baskets.csv"
        text = baskets.read_text(encoding="utf-8")
        for basket_id in first["evidence_basket_requirement_ids"]:
            self.assertIn(basket_id, text)
        for ju_id in first["judgment_unit_ids"]:
            self.assertIn(ju_id, text)

        audit = yaml.safe_load(
            (ROOT / "示例2" / "04-美国管制与国产设备替代推理审计-20260715-1.yaml").read_text(encoding="utf-8")
        )
        judgment_count = sum(
            1 for item in audit["business_instance_graph"]["objects"] if item.get("type") == "Judgment"
        )
        self.assertGreaterEqual(judgment_count, 1)
        from research_contract import task_view_hash

        self.assertEqual(first["source_02_view_hash"], task_view_hash(view))


if __name__ == "__main__":
    unittest.main()
