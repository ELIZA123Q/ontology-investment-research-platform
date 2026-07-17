#!/usr/bin/env python3
from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "governance/03_校验"))
from repo_paths import ensure_all_validator_paths  # noqa: E402

ensure_all_validator_paths()

from ontology_instance_graph import (  # noqa: E402
    InstanceGraphError,
    compact_task_view,
    project_task_view,
    validate_instance_graph,
)


class InstanceGraphTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        path = ROOT / "workflow/stages/02_结构/模板/02_任务本体视图模板.yaml"
        cls.compact = yaml.safe_load(path.read_text(encoding="utf-8"))
        domain = ROOT / "ontology/02_领域/semiconductor/business_instances.yaml"
        cls.domain = yaml.safe_load(domain.read_text(encoding="utf-8"))

    def test_template_and_domain_graphs_validate(self) -> None:
        validate_instance_graph(self.compact["business_instance_graph"])
        validate_instance_graph(self.domain["business_instance_graph"])

    def test_projection_round_trip_is_lossless(self) -> None:
        projected = project_task_view(self.compact)
        self.assertEqual(compact_task_view(projected), self.compact)

    def test_unknown_object_type_fails(self) -> None:
        graph = copy.deepcopy(self.compact["business_instance_graph"])
        graph["objects"][0]["type"] = "UnknownBusinessParameter"
        with self.assertRaises(InstanceGraphError):
            validate_instance_graph(graph)

    def test_dangling_relation_fails(self) -> None:
        graph = copy.deepcopy(self.compact["business_instance_graph"])
        graph["relations"][0]["targetId"] = "MISSING"
        with self.assertRaises(InstanceGraphError):
            validate_instance_graph(graph)

    def test_legacy_disk_shape_is_compacted(self) -> None:
        projected = project_task_view(self.compact)
        converted = compact_task_view(projected)
        self.assertNotIn("judgment_units", converted)
        self.assertIn("business_instance_graph", converted)


if __name__ == "__main__":
    unittest.main()
