#!/usr/bin/env python3
from __future__ import annotations

import copy
import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
VALIDATOR = ROOT / "governance/03_校验/validate_rule_authority.py"
spec = importlib.util.spec_from_file_location("validate_rule_authority", VALIDATOR)
assert spec and spec.loader
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


class RuleAuthorityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.registry = validator.load(validator.REGISTRY)
        self.ledger = validator.load(validator.LEDGER)
        self.operations = validator.load(validator.OPERATIONS)

    def errors(self, registry=None, ledger=None, operations=None, refs=None):
        return validator.validate_rule_authority(
            registry or self.registry,
            ledger or self.ledger,
            operations or self.operations,
            judgment_rule_refs=refs,
        )

    def test_authoritative_registry_passes(self) -> None:
        self.assertEqual(self.errors(), [])

    def test_governance_rule_cannot_support_business_judgment(self) -> None:
        errors = self.errors(refs=[("negative-fixture", "GOV-REASONING-TRACE-001")])
        self.assertTrue(any("non-formal rule" in error for error in errors), errors)

    def test_runtime_action_cannot_use_ambiguous_rule_refs(self) -> None:
        operations = copy.deepcopy(self.operations)
        operations["actions"]["FormJudgment"]["rule_refs"] = ["judgment_evidence_threshold"]
        errors = self.errors(operations=operations, refs=[])
        self.assertTrue(any("ambiguous rule_refs" in error for error in errors), errors)

    def test_every_legacy_rule_needs_explicit_migration(self) -> None:
        ledger = copy.deepcopy(self.ledger)
        del ledger["overrides"]["formal_rule_merges"]["mapping"]["unique_identity"]
        errors = self.errors(ledger=ledger, refs=[])
        self.assertTrue(any("unique_identity requires exactly one explicit migration" in error for error in errors), errors)

    def test_formal_registry_must_match_formal_models(self) -> None:
        registry = copy.deepcopy(self.registry)
        registry["formal_ontology_rules"]["kb04:A01"] = {
            "source_ref": "methods/04_裁决/A01_状态判断.md",
            "rule_class": "evidence_constraint",
        }
        errors = self.errors(registry=registry, refs=[])
        self.assertTrue(any("formal rule registry drift" in error for error in errors), errors)


if __name__ == "__main__":
    unittest.main()
