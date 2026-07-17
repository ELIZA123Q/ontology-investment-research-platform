#!/usr/bin/env python3
from __future__ import annotations

import copy
import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
VALIDATOR = ROOT / "governance/03_校验/validate_v3_samples.py"
spec = importlib.util.spec_from_file_location("validate_v3_samples", VALIDATOR)
assert spec and spec.loader
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


class V3SampleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.contract = validator.load(ROOT / "governance/02_合同/public_contract.yaml")
        self.rules = validator.known_rule_ids()
        self.run_dir = ROOT / "instances/02_V3样例/01_memory-cycle-run-002"
        self.run = validator.load_run(self.run_dir)

    def errors(self, run=None):
        return validator.validate_run_data(run or self.run, self.contract, self.rules)

    def test_examples_pass(self) -> None:
        self.assertEqual(self.errors(), [])
        other = validator.load_run(ROOT / "instances/02_V3样例/02_us-controls-localization-run-002")
        self.assertEqual(self.errors(other), [])

    def test_matched_only_rule_evaluation_is_rejected(self) -> None:
        run = copy.deepcopy(self.run)
        run["judgment"]["rule_evaluations"][0]["condition_results"] = ["matched"]
        self.assertTrue(any("matched-only" in error for error in self.errors(run)))

    def test_method_without_version_is_rejected(self) -> None:
        run = copy.deepcopy(self.run)
        run["judgment"]["method_application_register"][0].pop("method_version")
        self.assertTrue(any("method_version" in error for error in self.errors(run)))

    def test_governance_rule_cannot_support_judgment(self) -> None:
        run = copy.deepcopy(self.run)
        run["judgment"]["rule_evaluations"][0]["rule_ref"] = "reasoning_trace_required"
        self.assertTrue(any("non-ontology rule" in error for error in self.errors(run)))

    def test_expression_cannot_create_new_judgment(self) -> None:
        run = copy.deepcopy(self.run)
        run["expression"]["expressions"][0]["source_claim_id"] = "C-999"
        run["expression"]["overall_check"]["no_new_judgment_created"] = False
        errors = self.errors(run)
        self.assertTrue(any("unresolved judgment" in error for error in errors))
        self.assertTrue(any("no_new_judgment_created" in error for error in errors))

    def test_full_rerun_for_local_evidence_is_rejected(self) -> None:
        run = copy.deepcopy(self.run)
        run["update"]["full_rerun_required"] = True
        self.assertTrue(any("local-first" in error for error in self.errors(run)))


if __name__ == "__main__":
    unittest.main()

