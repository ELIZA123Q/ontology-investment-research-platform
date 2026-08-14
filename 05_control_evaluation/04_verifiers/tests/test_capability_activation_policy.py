#!/usr/bin/env python3
from __future__ import annotations

import copy
import importlib.util
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
VALIDATOR = ROOT / "05_control_evaluation/04_verifiers/validate_capability_activation_policy.py"
spec = importlib.util.spec_from_file_location("validate_capability_activation_policy", VALIDATOR)
assert spec and spec.loader
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


class CapabilityActivationPolicyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.policy = validator.yaml.safe_load(validator.POLICY.read_text(encoding="utf-8"))
        self.manifest = json.loads(validator.MANIFEST.read_text(encoding="utf-8"))
        self.evidence = json.loads(validator.RELEASE_EVIDENCE.read_text(encoding="utf-8"))

    def test_current_release_has_no_unregistered_evaluation_activation(self) -> None:
        self.assertEqual(validator.validate(self.manifest, self.policy, self.evidence), [])

    def test_active_candidate_cannot_self_attest_metrics(self) -> None:
        manifest = copy.deepcopy(self.manifest)
        entry = next(item for item in manifest["skills"] if item["id"] == "financial-modeling")
        entry.update({"lifecycle": "active", "executionScopes": ["production", "evaluation"], "activationEvidence": {"type": "evaluation_run", "evaluatedAt": "2026-08-13T00:00:00.000Z", "evaluationRunRefs": ["eval:forged"], "metrics": {"comparableCases": 12, "blindWinRate": 0.60, "severeRegressions": 0}}})
        errors = validator.validate(manifest, self.policy, self.evidence)
        self.assertTrue(any("unregistered evaluation run" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
