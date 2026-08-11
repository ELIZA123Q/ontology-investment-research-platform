#!/usr/bin/env python3
from __future__ import annotations

import copy
import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
PATH = ROOT / "05_control_evaluation/04_verifiers/validate_reasoning_trace_contract.py"
spec = importlib.util.spec_from_file_location("validate_reasoning_trace_contract", PATH)
assert spec and spec.loader
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


class ReasoningTraceContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.public = validator.load(validator.CONTRACT_PATH)

    def errors(self, value=None):
        return validator.validate_contract_data(value or self.public)

    def test_current_contract_passes(self) -> None:
        self.assertEqual(self.errors(), [])

    def test_signal_cannot_be_removed_from_chain(self) -> None:
        value = copy.deepcopy(self.public)
        value["reasoning_trace_contract"]["minimum_chain"].remove("Signal")
        self.assertTrue(any("minimum reasoning chain" in error for error in self.errors(value)))

    def test_condition_inputs_are_required(self) -> None:
        value = copy.deepcopy(self.public)
        value["reasoning_trace_contract"]["condition_result_required_fields"].remove("input_refs")
        self.assertTrue(any("condition result fields" in error for error in self.errors(value)))

    def test_judgment_cannot_omit_hypothesis_refs(self) -> None:
        value = copy.deepcopy(self.public)
        value["reasoning_trace_contract"]["judgment_required_refs"].remove("hypothesis_refs")
        self.assertTrue(any("Judgment direct trace refs" in error for error in self.errors(value)))


if __name__ == "__main__":
    unittest.main()
