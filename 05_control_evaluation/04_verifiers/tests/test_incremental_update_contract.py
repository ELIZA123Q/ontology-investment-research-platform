#!/usr/bin/env python3
from __future__ import annotations

import copy
import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
VALIDATOR_PATH = ROOT / "05_control_evaluation/04_verifiers/validate_incremental_update_contract.py"
spec = importlib.util.spec_from_file_location("validate_incremental_update_contract", VALIDATOR_PATH)
assert spec and spec.loader
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


class IncrementalUpdateContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.public = validator.load(validator.CONTRACT_PATH)

    def errors(self, value=None):
        return validator.validate_contract_data(value or self.public)

    def test_current_contract_passes(self) -> None:
        self.assertEqual(self.errors(), [])

    def test_direct_impacts_are_required(self) -> None:
        value = copy.deepcopy(self.public)
        value["incremental_update_contract"]["required_fields"].remove("direct_impacts")
        self.assertTrue(any("required fields" in error for error in self.errors(value)))

    def test_propagation_edges_need_dependency_type(self) -> None:
        value = copy.deepcopy(self.public)
        value["incremental_update_contract"]["propagation_edge_required_fields"].remove("dependency_type")
        self.assertTrue(any("edge fields" in error for error in self.errors(value)))

    def test_reachable_closure_rule_cannot_be_removed(self) -> None:
        value = copy.deepcopy(self.public)
        value["incremental_update_contract"]["rules"] = [
            rule for rule in value["incremental_update_contract"]["rules"] if "可达闭包" not in rule
        ]
        self.assertTrue(any("可达闭包" in error for error in self.errors(value)))


if __name__ == "__main__":
    unittest.main()
