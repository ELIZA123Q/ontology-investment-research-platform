#!/usr/bin/env python3
from __future__ import annotations

import copy
import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
VALIDATOR = ROOT / "05_control_evaluation/04_verifiers/validate_method_assets.py"
spec = importlib.util.spec_from_file_location("validate_method_assets", VALIDATOR)
assert spec and spec.loader
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


class MethodAssetTests(unittest.TestCase):
    def setUp(self) -> None:
        self.assets = validator.load(validator.ASSET_PATH)
        self.structure = validator.load(validator.STRUCTURE_PATH)
        self.evidence = validator.load(validator.EVIDENCE_PATH)
        self.routes = validator.load(validator.ROUTE_PATH)

    def errors(self, assets=None, structure=None, evidence=None, routes=None):
        return validator.validate_method_assets_data(
            assets or self.assets,
            structure or self.structure,
            evidence or self.evidence,
            routes or self.routes,
            check_files=False,
        )

    def test_current_catalog_passes(self) -> None:
        self.assertEqual(self.errors(), [])
        catalog, errors = validator.build_method_catalog(
            self.assets, self.structure, self.evidence
        )
        self.assertEqual(errors, [])
        self.assertEqual(len(catalog), 43)
        self.assertIn("kb04:A00", catalog)

    def test_version_drift_is_rejected(self) -> None:
        evidence = copy.deepcopy(self.evidence)
        evidence["schema_version"] = "3.1.0"
        self.assertTrue(any("exactly match 3.2.0" in error for error in self.errors(evidence=evidence)))

    def test_missing_method_contract_field_is_rejected(self) -> None:
        evidence = copy.deepcopy(self.evidence)
        evidence["methods"]["A03"]["contract"].pop("preconditions")
        self.assertTrue(any("kb03:A03" in error and "preconditions" in error for error in self.errors(evidence=evidence)))

    def test_unknown_route_method_is_rejected(self) -> None:
        routes = copy.deepcopy(self.routes)
        routes["routes"]["trend_direction"]["allowed_kb04_methods"] = ["kb04:UNKNOWN"]
        self.assertTrue(any("unknown method kb04:UNKNOWN" in error for error in self.errors(routes=routes)))

    def test_route_capability_mismatch_is_rejected(self) -> None:
        routes = copy.deepcopy(self.routes)
        routes["routes"]["trend_direction"]["allowed_kb03_methods"] = ["kb04:A02"]
        self.assertTrue(any("capability must be evidence" in error for error in self.errors(routes=routes)))

    def test_a00_cannot_be_silently_removed(self) -> None:
        assets = copy.deepcopy(self.assets)
        assets["groups"]["adjudication"]["methods"] = [
            item for item in assets["groups"]["adjudication"]["methods"]
            if item["id"] != "kb04:A00"
        ]
        errors = self.errors(assets=assets)
        self.assertTrue(any("method count must be 11" in error for error in errors))
        self.assertTrue(any("global optional method is not registered" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
