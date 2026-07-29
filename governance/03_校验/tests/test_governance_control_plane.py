#!/usr/bin/env python3
from __future__ import annotations

import copy
import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
VALIDATOR = ROOT / "governance/03_校验/validate_governance_control_plane.py"
spec = importlib.util.spec_from_file_location("validate_governance_control_plane", VALIDATOR)
assert spec and spec.loader
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


class GovernanceControlPlaneTests(unittest.TestCase):
    def setUp(self) -> None:
        self.contract = validator.load(validator.CONTRACT)
        self.assets = validator.load(validator.ASSET_REGISTRY)
        self.consumers = validator.load(validator.CONSUMER_REGISTRY)
        self.models = validator.load(validator.MODEL_REGISTRY)
        self.public = validator.load(validator.PUBLIC_CONTRACT)
        self.formal_ids = validator.formal_element_ids(self.models)

    def errors(self, contract=None, assets=None, formal_ids=None):
        return validator.validate_governance_control_plane(
            contract or self.contract,
            assets or self.assets,
            self.consumers,
            self.models,
            self.public,
            known_formal_ids=formal_ids if formal_ids is not None else self.formal_ids,
        )

    def test_authoritative_control_plane_passes(self) -> None:
        self.assertEqual(self.errors(), [])

    def test_governance_cannot_be_registered_as_formal_domain(self) -> None:
        contract = copy.deepcopy(self.contract)
        contract["boundary"]["formal_ontology_model_registered"] = True
        errors = self.errors(contract=contract)
        self.assertTrue(any("must be false" in error for error in errors), errors)

    def test_release_path_cannot_skip_impact_assessment(self) -> None:
        contract = copy.deepcopy(self.contract)
        contract["change_request"]["transitions"]["proposed"] = ["approved", "rejected"]
        errors = self.errors(contract=contract)
        self.assertTrue(any("must not skip" in error for error in errors), errors)

    def test_governance_object_cannot_leak_into_formal_ontology(self) -> None:
        leaked = set(self.formal_ids)
        leaked.add("GovernedAsset")
        errors = self.errors(formal_ids=leaked)
        self.assertTrue(any("leaked into formal ontology" in error for error in errors), errors)

    def test_asset_must_have_resolvable_owner_and_consumer(self) -> None:
        assets = copy.deepcopy(self.assets)
        assets["assets"][0]["owner_role"] = "nobody"
        assets["assets"][0]["consumers"] = ["unknown_consumer"]
        errors = self.errors(assets=assets)
        self.assertTrue(any("unresolved owner_role" in error for error in errors), errors)
        self.assertTrue(any("unresolved consumers" in error for error in errors), errors)

    def test_release_gates_are_complete(self) -> None:
        contract = copy.deepcopy(self.contract)
        contract["release_gates"] = contract["release_gates"][:-1]
        errors = self.errors(contract=contract)
        self.assertTrue(any("release gates drift" in error for error in errors), errors)


if __name__ == "__main__":
    unittest.main()
