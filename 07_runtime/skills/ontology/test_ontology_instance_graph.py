#!/usr/bin/env python3
from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "05_governance/03_校验"))
from repo_paths import ensure_all_validator_paths  # noqa: E402

ensure_all_validator_paths()

from ontology_instance_graph import (  # noqa: E402
    InstanceGraphError,
    validate_instance_graph,
)


class InstanceGraphTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        path = ROOT / "90_compat/methods/templates/02_任务本体视图模板.yaml"
        cls.compact = yaml.safe_load(path.read_text(encoding="utf-8"))
        domain = ROOT / "01_semantic/01_ontology/domains/semiconductor/business_instances.yaml"
        cls.domain = yaml.safe_load(domain.read_text(encoding="utf-8"))

    def test_template_and_domain_graphs_validate(self) -> None:
        validate_instance_graph(self.compact["business_instance_graph"])
        validate_instance_graph(self.domain["business_instance_graph"])

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

    def test_graph_requires_business_parameters_authority(self) -> None:
        graph = copy.deepcopy(self.compact["business_instance_graph"])
        graph["authority"] = "formal_ontology"
        with self.assertRaises(InstanceGraphError):
            validate_instance_graph(graph)


if __name__ == "__main__":
    unittest.main()
