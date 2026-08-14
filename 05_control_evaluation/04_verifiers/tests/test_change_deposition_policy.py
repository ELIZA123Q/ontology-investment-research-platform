#!/usr/bin/env python3
from __future__ import annotations

import copy
import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
VALIDATOR = ROOT / "05_control_evaluation/04_verifiers/validate_change_deposition_policy.py"
spec = importlib.util.spec_from_file_location("validate_change_deposition_policy", VALIDATOR)
assert spec and spec.loader
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


class ChangeDepositionPolicyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.policy = validator.load(validator.POLICY)
        self.authority = validator.load(validator.AUTHORITY)
        self.records = [(path, validator.load(path)) for path in sorted(validator.RECORDS.glob("*.yaml"))]

    def test_current_policy_and_records_pass(self) -> None:
        self.assertEqual(validator.validate(self.policy, self.authority, self.records), [])

    def test_missing_execution_reference_is_rejected(self) -> None:
        records = copy.deepcopy(self.records)
        records[0][1]["execution_refs"] = ["06_runtime/src/does-not-exist.ts"]
        self.assertTrue(any("unresolved execution_refs" in error for error in validator.validate(self.policy, self.authority, records)))

    def test_runtime_only_classification_cannot_replace_required_routes(self) -> None:
        policy = copy.deepcopy(self.policy)
        policy["classification_routes"].pop("reusable_deterministic_constraint")
        self.assertTrue(any("classification routes drift" in error for error in validator.validate(policy, self.authority, self.records)))


if __name__ == "__main__":
    unittest.main()
