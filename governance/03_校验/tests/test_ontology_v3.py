#!/usr/bin/env python3
from __future__ import annotations

import copy
import importlib.util
import unittest
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[3]
VALIDATOR = ROOT / "ontology/01_通用/validate_v3.py"
spec = importlib.util.spec_from_file_location("validate_v3", VALIDATOR)
assert spec and spec.loader
validate_v3 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validate_v3)


class OntologyV3Tests(unittest.TestCase):
    def setUp(self) -> None:
        self.bundle = validate_v3.load_default_bundle()

    def validate(self, bundle=None):
        return validate_v3.validate_bundle(*(bundle or self.bundle))

    def test_authoritative_bundle_passes(self) -> None:
        self.assertEqual(self.validate(), [])

    def test_public_contract_cannot_reference_missing_formal_type(self) -> None:
        contract = validate_v3.load_yaml(validate_v3.PUBLIC_CONTRACT)
        contract = copy.deepcopy(contract)
        contract["object_validity_propagation"]["formal_object_types"].append("MissingFormalType")
        errors = validate_v3.validate_bundle(*self.bundle, public_contract=contract)
        self.assertTrue(any("MissingFormalType" in error for error in errors), errors)

    def test_negative_fixtures_are_rejected(self) -> None:
        fixture_dir = ROOT / "governance/03_校验/fixtures/ontology_v3"
        for path in sorted(fixture_dir.glob("*.yaml")):
            case = yaml.safe_load(path.read_text(encoding="utf-8"))
            models, extension, meta, ledger, legacy = copy.deepcopy(self.bundle)
            mutation = case["mutation"]
            if mutation == "remove_field":
                del models["semantic"]["object_types"]["Company"]["attributes"]["name"]["type"]
            elif mutation == "replace_value":
                models["semantic"]["relation_types"]["produces"]["target_types"] = case["value"]
            elif mutation == "rename_rule":
                rule = models["judgment"]["rules"].pop("judgment_evidence_threshold")
                rule["metadata"]["id"] = case["value"]
                models["judgment"]["rules"][case["value"]] = rule
            elif mutation == "rename_extension_object":
                resource = extension["object_types"].pop("WaferFab")
                resource["metadata"]["id"] = case["value"]
                extension["object_types"][case["value"]] = resource
            elif mutation == "deprecate_without_replacement":
                metadata = models["semantic"]["object_types"]["Company"]["metadata"]
                metadata["status"] = "deprecated"
                metadata["replaced_by"] = []
            else:
                self.fail(f"unknown mutation {mutation}")
            errors = validate_v3.validate_bundle(models, extension, meta, ledger, legacy)
            self.assertTrue(any(case["expected_error"] in error for error in errors), f"{path}: {errors}")


if __name__ == "__main__":
    unittest.main()
