#!/usr/bin/env python3
from __future__ import annotations

import copy
import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
VALIDATOR = ROOT / "05_control_evaluation/03_校验/ontology/validate_ontology.py"
spec = importlib.util.spec_from_file_location("validate_v3_migration", VALIDATOR)
assert spec and spec.loader
validate_v3 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validate_v3)


class MigrationLedgerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.models, cls.extension, _ = validate_v3.load_default_bundle()
        cls.ledger = validate_v3.load_yaml(validate_v3.MIGRATION_LEDGER)

    def validate(self, ledger):
        return validate_v3.validate_migration_ledger(ledger, self.models, self.extension)

    def test_direct_to_latest_ledger_passes(self) -> None:
        self.assertEqual(self.validate(copy.deepcopy(self.ledger)), [])

    def test_legacy_retention_is_rejected(self) -> None:
        ledger = copy.deepcopy(self.ledger)
        ledger["retirement_policy"]["legacy_samples_retained"] = True
        self.assertTrue(any("legacy_samples_retained" in error for error in self.validate(ledger)))

    def test_inventory_count_drift_is_rejected(self) -> None:
        ledger = copy.deepcopy(self.ledger)
        ledger["inventory"]["semantic.yaml"]["object_types"].pop()
        self.assertTrue(any("object_types count" in error for error in self.validate(ledger)))

    def test_unresolved_replacement_is_rejected(self) -> None:
        ledger = copy.deepcopy(self.ledger)
        ledger["overrides"]["merged_objects"]["mapping"]["Segment"] = "MissingObject"
        self.assertTrue(any("Segment->MissingObject" in error for error in self.validate(ledger)))


if __name__ == "__main__":
    unittest.main()
