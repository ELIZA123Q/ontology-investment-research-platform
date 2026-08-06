#!/usr/bin/env python3
from __future__ import annotations

import copy
import importlib.util
import unittest
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[3]
VALIDATOR = ROOT / "01_semantic/01_ontology/validate_v3.py"
spec = importlib.util.spec_from_file_location("validate_v3", VALIDATOR)
assert spec and spec.loader
validate_v3 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validate_v3)


class OntologyV3Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.authoritative_bundle = validate_v3.load_default_bundle()

    def setUp(self) -> None:
        self.bundle = copy.deepcopy(self.authoritative_bundle)

    def validate(self, bundle=None):
        return validate_v3.validate_bundle(*(bundle or self.bundle))

    def mutated(self):
        return copy.deepcopy(self.bundle)

    def assert_rejected(self, bundle, expected: str) -> None:
        errors = self.validate(bundle)
        self.assertTrue(any(expected in error for error in errors), errors)

    def test_authoritative_bundle_passes(self) -> None:
        self.assertEqual(self.validate(), [])

    def test_public_contract_cannot_reference_missing_formal_type(self) -> None:
        contract = validate_v3.load_yaml(validate_v3.PUBLIC_CONTRACT)
        contract = copy.deepcopy(contract)
        contract["object_validity_propagation"]["formal_object_types"].append("MissingFormalType")
        errors = validate_v3.validate_bundle(*self.bundle, public_contract=contract)
        self.assertTrue(any("MissingFormalType" in error for error in errors), errors)

    def test_object_top_level_contract_is_required(self) -> None:
        models, *_ = bundle = self.mutated()
        del models["semantic"]["object_types"]["Company"]["primary_key"]
        self.assert_rejected(bundle, "object missing")

    def test_attribute_type_required_flag_and_role_are_strongly_typed(self) -> None:
        for field, value, expected in (
            ("type", "money", "invalid attribute type"),
            ("required", "yes", "required must be boolean"),
            ("value_role", "opinion", "invalid value_role"),
        ):
            with self.subTest(field=field):
                models, *_ = bundle = self.mutated()
                models["semantic"]["object_types"]["Company"]["attributes"]["name"][field] = value
                self.assert_rejected(bundle, expected)

    def test_object_ref_target_must_resolve(self) -> None:
        models, *_ = bundle = self.mutated()
        models["state_event"]["object_types"]["StateVariable"]["attributes"]["metric_ref"]["reference_target"] = "MissingMetric"
        self.assert_rejected(bundle, "unresolved reference_target")

    def test_constraints_are_required_and_must_reference_attributes(self) -> None:
        models, *_ = bundle = self.mutated()
        constraints = models["semantic"]["object_types"]["Company"]["constraints"]
        del constraints["lifecycle"]
        constraints["unique"] = ["missing_attribute"]
        errors = self.validate(bundle)
        self.assertTrue(any("constraints missing" in error for error in errors), errors)
        self.assertTrue(any("constraints.unique unknown attribute" in error for error in errors), errors)

    def test_metadata_namespace_semver_and_dates_are_validated(self) -> None:
        mutations = (
            ("namespace", "unknown.namespace", "invalid metadata namespace"),
            ("version", "v3", "must be SemVer"),
            ("label_zh", "", "must be non-empty string"),
        )
        for field, value, expected in mutations:
            with self.subTest(field=field):
                models, *_ = bundle = self.mutated()
                models["semantic"]["object_types"]["Company"]["metadata"][field] = value
                self.assert_rejected(bundle, expected)
        models, *_ = bundle = self.mutated()
        metadata = models["semantic"]["object_types"]["Company"]["metadata"]
        metadata["valid_from"] = "2027-01-01"
        metadata["valid_to"] = "2026-01-01"
        self.assert_rejected(bundle, "valid_from must not exceed valid_to")

    def test_deprecated_replacement_must_resolve(self) -> None:
        models, *_ = bundle = self.mutated()
        metadata = models["semantic"]["object_types"]["Company"]["metadata"]
        metadata["status"] = "deprecated"
        metadata["replaced_by"] = ["MissingCompany"]
        self.assert_rejected(bundle, "unresolved replaced_by")

    def test_global_namespace_id_pair_must_be_unique(self) -> None:
        models, *_ = bundle = self.mutated()
        duplicate = copy.deepcopy(models["semantic"]["relation_types"]["produces"])
        duplicate["metadata"]["id"] = "Company"
        duplicate["metadata"]["inverse_of"] = "Company"
        models["semantic"]["relation_types"]["Company"] = duplicate
        self.assert_rejected(bundle, "global duplicate namespace+id")

    def test_relation_cardinality_direction_boolean_and_policy_are_validated(self) -> None:
        cases = (
            ("source_cardinality", "many", "invalid source_cardinality"),
            ("direction", "forward", "invalid direction"),
            ("temporal", "yes", "temporal must be boolean"),
            ("invalidation_policy", "delete", "invalid invalidation_policy"),
        )
        for field, value, expected in cases:
            with self.subTest(field=field):
                models, *_ = bundle = self.mutated()
                models["semantic"]["relation_types"]["produces"][field] = value
                self.assert_rejected(bundle, expected)

    def test_relation_attribute_uses_full_attribute_contract(self) -> None:
        models, *_ = bundle = self.mutated()
        models["semantic"]["relation_types"]["produces"]["attributes"] = {
            "share": {"type": "number", "required": True, "description": "share"}
        }
        self.assert_rejected(bundle, "produces.attributes.share missing")

    def test_inverse_endpoints_and_cardinality_must_be_mirrored(self) -> None:
        models, *_ = bundle = self.mutated()
        models["semantic"]["relation_types"]["produces"]["target_cardinality"] = "1..1"
        self.assert_rejected(bundle, "cardinality is not mirrored")
        models, *_ = bundle = self.mutated()
        models["semantic"]["relation_types"]["produces"]["target_types"] = ["Technology"]
        self.assert_rejected(bundle, "endpoints are not mirrored")

    def test_extension_subproperty_endpoints_must_project_to_parent(self) -> None:
        models, extension, *_ = bundle = self.mutated()
        relation = next(
            value for value in extension["relation_types"].values() if value.get("subproperty_of") is not None
        )
        relation["source_types"] = ["Region"]
        self.assert_rejected(bundle, "subproperty endpoints incompatible")

    def test_extension_inheritance_must_be_acyclic_and_reach_core(self) -> None:
        models, extension, *_ = bundle = self.mutated()
        object_ids = list(extension["object_types"])
        first, second = object_ids[:2]
        extension["object_types"][first]["extends"] = second
        extension["object_types"][first].pop("projects_to", None)
        extension["object_types"][second]["extends"] = first
        extension["object_types"][second].pop("projects_to", None)
        self.assert_rejected(bundle, "inheritance cycle")

    def test_rule_fields_and_concrete_positive_negative_cases_are_required(self) -> None:
        models, *_ = bundle = self.mutated()
        rule = models["semantic"]["rules"]["semantic_endpoint_compatibility"]
        rule["condition"] = ""
        rule["test_cases"][0].pop("input", None)
        errors = self.validate(bundle)
        self.assertTrue(any("rule condition must be non-empty" in error for error in errors), errors)
        self.assertTrue(any("requires concrete non-empty input" in error for error in errors), errors)
        models, *_ = bundle = self.mutated()
        models["semantic"]["rules"]["semantic_endpoint_compatibility"]["test_cases"] = [
            models["semantic"]["rules"]["semantic_endpoint_compatibility"]["test_cases"][0]
        ]
        self.assert_rejected(bundle, "requires at least positive and negative")

    def test_direct_evidence_fact_to_final_judgment_is_forbidden(self) -> None:
        models, *_ = bundle = self.mutated()
        forward = models["evidence"]["relation_types"]["factSupportsSignal"]
        inverse = models["evidence"]["relation_types"]["signalGroundedByFact"]
        forward["target_types"] = ["Judgment"]
        inverse["source_types"] = ["Judgment"]
        self.assert_rejected(bundle, "forbidden direct EvidenceFact->Judgment")

    def test_event_taxonomy_must_be_explicit_unique_and_complete(self) -> None:
        models, extension, *_ = bundle = self.mutated()
        extension["event_taxonomy"]["allowed_extensions"].append("not_in_taxonomy")
        self.assert_rejected(bundle, "allowed_extensions and taxonomy keys must match")

    def test_negative_fixtures_are_rejected(self) -> None:
        fixture_dir = ROOT / "05_governance/03_校验/fixtures/ontology_v3"
        for path in sorted(fixture_dir.glob("*.yaml")):
            case = yaml.safe_load(path.read_text(encoding="utf-8"))
            models, extension, meta = copy.deepcopy(self.bundle)
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
            errors = validate_v3.validate_bundle(models, extension, meta)
            self.assertTrue(any(case["expected_error"] in error for error in errors), f"{path}: {errors}")


if __name__ == "__main__":
    unittest.main()
