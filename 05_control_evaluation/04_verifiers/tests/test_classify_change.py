#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
CLASSIFIER = ROOT / "05_control_evaluation/04_verifiers/classify_change.py"
spec = importlib.util.spec_from_file_location("classify_change", CLASSIFIER)
assert spec and spec.loader
classifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(classifier)


class ChangeClassifierTests(unittest.TestCase):
    def setUp(self) -> None:
        self.policy = classifier.load_policy()

    def test_reusable_constraint_requires_policy_projection_and_regression(self) -> None:
        plan = classifier.plan_for(self.policy, ["reusable_deterministic_constraint"], "Add a financial reconciliation")
        route = plan["deposition_plan"][0]
        self.assertEqual(route["authority"], "05_control_evaluation/01_rules/policies/")
        self.assertEqual(route["required_artifacts"], ["policy", "generated_projection_or_explicit_consumer", "drift_validator", "regression_test"])
        self.assertEqual(plan["change_record_template"]["classifications"], ["reusable_deterministic_constraint"])

    def test_multi_route_plan_preserves_each_explicit_authority(self) -> None:
        plan = classifier.plan_for(self.policy, ["stable_domain_semantics", "execution_mechanics"])
        self.assertEqual([item["classification"] for item in plan["deposition_plan"]], ["stable_domain_semantics", "execution_mechanics"])

    def test_missing_or_unknown_route_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "explicit classification"):
            classifier.plan_for(self.policy, [])
        with self.assertRaisesRegex(ValueError, "unknown classification"):
            classifier.plan_for(self.policy, ["runtime_only"])


if __name__ == "__main__":
    unittest.main()
