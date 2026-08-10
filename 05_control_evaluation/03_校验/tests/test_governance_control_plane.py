#!/usr/bin/env python3
from __future__ import annotations

import copy
import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
VALIDATOR = ROOT / "05_control_evaluation/03_校验/validate_governance_control_plane.py"
spec = importlib.util.spec_from_file_location("validate_governance_control_plane", VALIDATOR)
assert spec and spec.loader
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


class GovernanceControlPlaneTests(unittest.TestCase):
    def setUp(self) -> None:
        self.meta = validator.load(validator.META_SCHEMA)
        self.registry = validator.load(validator.GOVERNANCE_MODEL_REGISTRY)
        self.models = validator.load_governance_models(self.registry)
        self.instances = validator.load(validator.GOVERNANCE_INSTANCE_GRAPH)
        self.formal_registry = validator.load(validator.FORMAL_PLATFORM_REGISTRY)
        self.formal_ids = validator.formal_element_ids(self.formal_registry)

    def errors(self, *, meta=None, models=None, instances=None, formal_ids=None):
        return validator.validate_governance_control_plane(
            meta or self.meta,
            self.registry,
            models or self.models,
            instances or self.instances,
            self.formal_registry,
            known_formal_ids=formal_ids if formal_ids is not None else self.formal_ids,
        )

    def model_with(self, schema_name: str) -> dict:
        return next(model for model in self.models if model.get("schema_name") == schema_name)

    def test_authoritative_governance_ontology_passes(self) -> None:
        self.assertEqual(self.errors(), [])

    def test_governance_cannot_be_registered_as_formal_domain(self) -> None:
        meta = copy.deepcopy(self.meta)
        meta["boundary"]["formal_registration_allowed"] = True
        errors = self.errors(meta=meta)
        self.assertTrue(any("must be false" in error for error in errors), errors)

    def test_action_graph_cannot_skip_impact_assessment(self) -> None:
        models = copy.deepcopy(self.models)
        action_model = next(model for model in models if model.get("schema_name") == "ontology_governance_action_model")
        action_model["action_types"]["FreezeImpactAssessment"]["state_transition"]["to"] = "approved"
        errors = self.errors(models=models)
        self.assertTrue(any("transition graph drift" in error for error in errors), errors)

    def test_action_rule_reference_must_resolve(self) -> None:
        models = copy.deepcopy(self.models)
        action_model = next(model for model in models if model.get("schema_name") == "ontology_governance_action_model")
        action_model["action_types"]["ReleaseOntologyBaseline"]["submission_criteria"][0]["rule_ref"] = "missing_rule"
        errors = self.errors(models=models)
        self.assertTrue(any("unresolved rule" in error for error in errors), errors)

    def test_inverse_relation_must_be_reciprocal(self) -> None:
        models = copy.deepcopy(self.models)
        relation_model = next(model for model in models if model.get("schema_name") == "ontology_governance_relation_model")
        relation_model["relation_types"]["proposalUsesBranch"]["inverse_of"] = "proposalUsesBranch"
        errors = self.errors(models=models)
        self.assertTrue(any("not reciprocal" in error for error in errors), errors)

    def test_governance_id_cannot_leak_into_formal_ontology(self) -> None:
        leaked = set(self.formal_ids)
        leaked.add("GovernedAsset")
        errors = self.errors(formal_ids=leaked)
        self.assertTrue(any("leaked into formal ontology" in error for error in errors), errors)

    def test_asset_authority_and_owner_must_resolve(self) -> None:
        instances = copy.deepcopy(self.instances)
        asset = next(item for item in instances["objects"] if item["id"] == "governance.meta_ontology")
        asset["properties"]["authority_ref"] = "missing/path.yaml"
        asset["properties"]["owner_role"] = "nobody"
        errors = self.errors(instances=instances)
        self.assertTrue(any("authority_ref does not exist" in error for error in errors), errors)
        self.assertTrue(any("unresolved owner_role" in error for error in errors), errors)


if __name__ == "__main__":
    unittest.main()
