#!/usr/bin/env python3
from __future__ import annotations

import copy
import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
PATH = ROOT / "governance/03_校验/validate_method_application_contract.py"
spec = importlib.util.spec_from_file_location("validate_method_application_contract", PATH)
assert spec and spec.loader
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


class MethodApplicationContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.public = validator.load(validator.CONTRACT_PATH)

    def errors(self, value=None):
        return validator.validate_contract_data(value or self.public)

    def test_current_contract_passes(self) -> None:
        self.assertEqual(self.errors(), [])

    def test_legacy_canonical_field_is_rejected(self) -> None:
        value = copy.deepcopy(self.public)
        value["method_application_contract"]["canonical_stage_field"] = "method_application_register"
        self.assertTrue(any("canonical" in error for error in self.errors(value)))

    def test_stage02_cannot_preselect_method(self) -> None:
        value = copy.deepcopy(self.public)
        value["method_application_contract"]["stage_field_ownership"]["stage_02"]["allowed_statuses"] = ["candidate", "selected"]
        self.assertTrue(any("only create candidate" in error for error in self.errors(value)))

    def test_stage03_cannot_execute_method(self) -> None:
        value = copy.deepcopy(self.public)
        value["method_application_contract"]["stage_field_ownership"]["stage_03"]["forbidden_statuses"] = []
        self.assertTrue(any("forbid executed" in error for error in self.errors(value)))

    def test_terminal_status_cannot_reopen(self) -> None:
        value = copy.deepcopy(self.public)
        value["method_application_contract"]["allowed_transitions"]["rejected"] = ["rejected", "candidate"]
        self.assertTrue(any("terminal status rejected" in error for error in self.errors(value)))

    def application(self):
        return {
            "application_id": "MA-01", "method_id": "kb03:A01", "method_version": "3.2.0",
            "capability_type": "evidence", "target_question_refs": ["Q-01"],
            "target_judgment_unit_refs": ["JU-01"], "target_ontology_object_refs": ["OBJ-01"],
            "status": "candidate", "precondition_checks": [], "input_evidence_refs": [],
            "output_signal_refs": [], "output_judgment_refs": [], "execution_summary": "",
            "applicability_boundary": "scope", "limitations": [], "counter_example_refs": [],
            "provenance": {"stage": "stage_02", "source_application_id": None, "actor": "tester", "recorded_at": "2026-07-17T10:00:00+08:00"},
            "alternatives": [],
        }

    def test_duplicate_application_id_is_rejected(self) -> None:
        item = self.application()
        errors = validator.validate_stage_applications(
            {"method_applications": [item, copy.deepcopy(item)]}, "stage_02", required=True
        )
        self.assertTrue(any("duplicate application_id" in error for error in errors))

    def test_all_immutable_fields_are_compared(self) -> None:
        prior = self.application()
        current = copy.deepcopy(prior)
        current["target_question_refs"] = ["Q-02"]
        current["provenance"] = {**current["provenance"], "stage": "stage_03", "source_application_id": "MA-01"}
        errors = validator.validate_stage_applications(
            {"method_applications": [current]}, "stage_03", required=True, prior_items=[prior]
        )
        self.assertTrue(any("immutable field drift: target_question_refs" in error for error in errors))

    def test_executed_application_requires_preconditions_and_outputs(self) -> None:
        item = self.application()
        item.update({"status": "executed", "input_evidence_refs": ["EV-01"], "execution_summary": "ran"})
        item["provenance"] = {**item["provenance"], "stage": "stage_04", "source_application_id": "MA-01"}
        errors = validator.validate_stage_applications(
            {"method_applications": [item]}, "stage_04", required=True,
            known_evidence={"EV-01"}, known_signals=set(), known_judgments=set(),
        )
        self.assertTrue(any("no precondition checks" in error for error in errors))
        self.assertTrue(any("no signal/judgment output" in error for error in errors))

    def test_stage05_semantic_collection_injection_is_rejected(self) -> None:
        expression = {"claim_expression_register": [], "method_applications": [self.application()]}
        errors = validator.validate_expression_projection(expression, {}, required=False)
        self.assertTrue(any("forbidden semantic collections" in error for error in errors))

    def test_each_judgment_unit_requires_all_three_capabilities(self) -> None:
        errors = validator.validate_stage_applications(
            {"method_applications": [self.application()]}, "stage_02", required=True,
            known_judgment_units={"JU-01"},
        )
        self.assertTrue(any("missing capabilities" in error for error in errors))

    def test_stage03_evidence_candidate_must_converge(self) -> None:
        item = self.application()
        item["provenance"] = {**item["provenance"], "stage": "stage_03", "source_application_id": "MA-01"}
        errors = validator.validate_stage_applications(
            {"method_applications": [item]}, "stage_03", required=True, prior_items=[self.application()]
        )
        self.assertTrue(any("evidence application must converge" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
