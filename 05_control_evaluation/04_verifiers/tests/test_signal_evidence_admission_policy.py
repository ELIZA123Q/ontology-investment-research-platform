#!/usr/bin/env python3
from __future__ import annotations

import copy
import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
VALIDATOR = ROOT / "05_control_evaluation/04_verifiers/validate_signal_evidence_admission_policy.py"
spec = importlib.util.spec_from_file_location("validate_signal_evidence_admission_policy", VALIDATOR)
assert spec and spec.loader
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


class SignalEvidenceAdmissionPolicyTests(unittest.TestCase):
    def test_current_policy_passes(self) -> None:
        self.assertEqual(validator.validate(
            validator.load(validator.POLICY), validator.load(validator.AUTHORITY), validator.load(validator.PARAMETERS),
            validator.PROJECTION.read_text(encoding="utf-8"), validator.CONSUMER.read_text(encoding="utf-8"),
        ), [])

    def test_policy_rejects_direct_signal_evidence(self) -> None:
        policy = validator.load(validator.POLICY)
        policy = copy.deepcopy(policy)
        policy["signal_payload"]["usable_as_evidence"] = True
        self.assertIn("signal payload must not be usable as evidence", validator.validate(
            policy, validator.load(validator.AUTHORITY), validator.load(validator.PARAMETERS),
            validator.PROJECTION.read_text(encoding="utf-8"), validator.CONSUMER.read_text(encoding="utf-8"),
        ))


if __name__ == "__main__":
    unittest.main()
