#!/usr/bin/env python3
from __future__ import annotations

import copy
import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
VALIDATOR = ROOT / "05_governance/03_校验/validate_v3_samples.py"
spec = importlib.util.spec_from_file_location("validate_v3_samples", VALIDATOR)
assert spec and spec.loader
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


class V3SampleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.contract = validator.load(ROOT / "05_governance/02_合同/public_contract.yaml")
        self.rules = validator.known_rule_ids()
        self.run_dir = ROOT / "90_compat/instances/02_V3样例/01_memory-cycle-run-002"
        self.run = validator.load_run(self.run_dir)

    def errors(self, run=None):
        return validator.validate_run_data(run or self.run, self.contract, self.rules)

    def test_examples_pass(self) -> None:
        self.assertEqual(self.errors(), [])
        other = validator.load_run(ROOT / "90_compat/instances/02_V3样例/02_us-controls-localization-run-002")
        self.assertEqual(self.errors(other), [])

    def test_matched_only_rule_evaluation_is_rejected(self) -> None:
        run = copy.deepcopy(self.run)
        run["judgment"]["rule_evaluations"][0]["condition_results"] = ["matched"]
        self.assertTrue(any("matched-only" in error for error in self.errors(run)))

    def test_signal_cannot_bind_evidence_basket_instead_of_fact(self) -> None:
        run = copy.deepcopy(self.run)
        run["judgment"]["signals"][0]["evidence_refs"] = ["EB-JU01-S"]
        self.assertTrue(any("concrete EvidenceFact" in error for error in self.errors(run)))

    def test_rule_condition_cannot_use_basket_only_input(self) -> None:
        run = copy.deepcopy(self.run)
        evaluation = run["judgment"]["rule_evaluations"][0]
        evaluation["input_refs"].append("EB-JU01-S")
        evaluation["condition_results"][0]["input_refs"] = ["EB-JU01-S"]
        self.assertTrue(any("basket-only" in error for error in self.errors(run)))

    def test_rule_condition_input_must_be_declared(self) -> None:
        run = copy.deepcopy(self.run)
        run["judgment"]["rule_evaluations"][0]["condition_results"][0]["input_refs"] = ["EV-999"]
        self.assertTrue(any("not declared by evaluation" in error for error in self.errors(run)))

    def test_judgment_evidence_cannot_bypass_signal(self) -> None:
        run = copy.deepcopy(self.run)
        run["judgment"]["judgments"][0]["evidence_refs"].append("EV-02")
        self.assertTrue(any("evidence bypassing signals" in error for error in self.errors(run)))

    def test_reasoning_trace_must_cover_direct_dependencies(self) -> None:
        run = copy.deepcopy(self.run)
        run["judgment"]["reasoning_traces"][0]["node_refs"].remove("RE-01")
        self.assertTrue(any("ReasoningTrace is incomplete" in error for error in self.errors(run)))

    def test_expression_evidence_must_come_from_source_judgment(self) -> None:
        run = copy.deepcopy(self.run)
        run["expression"]["expressions"][0]["source_evidence_refs"] = ["EV-02"]
        self.assertTrue(any("not used by source judgment" in error for error in self.errors(run)))

    def test_method_without_version_is_rejected(self) -> None:
        run = copy.deepcopy(self.run)
        run["judgment"]["method_applications"][0].pop("method_version")
        self.assertTrue(any("method_version" in error for error in self.errors(run)))

    def test_unregistered_candidate_method_is_rejected(self) -> None:
        run = copy.deepcopy(self.run)
        run["structure"]["method_applications"][0]["method_id"] = "kb03:UNKNOWN"
        self.assertTrue(any("unregistered method" in error for error in self.errors(run)))

    def test_candidate_capability_mismatch_is_rejected(self) -> None:
        run = copy.deepcopy(self.run)
        run["structure"]["method_applications"][0]["capability_type"] = "adjudication"
        self.assertTrue(any("capability mismatch" in error for error in self.errors(run)))

    def test_evidence_binding_cannot_change_method_identity(self) -> None:
        run = copy.deepcopy(self.run)
        run["evidence"]["method_applications"][0]["method_id"] = "kb03:A01"
        self.assertTrue(any("method identity drift" in error for error in self.errors(run)))

    def test_stage03_cannot_silently_drop_method(self) -> None:
        run = copy.deepcopy(self.run)
        run["evidence"]["method_applications"].pop()
        self.assertTrue(any("without additions or drops" in error for error in self.errors(run)))

    def test_duplicate_application_id_is_rejected_before_indexing(self) -> None:
        run = copy.deepcopy(self.run)
        run["structure"]["method_applications"].append(copy.deepcopy(run["structure"]["method_applications"][0]))
        self.assertTrue(any("duplicate application_id" in error for error in self.errors(run)))

    def test_stage03_cannot_change_target_question(self) -> None:
        run = copy.deepcopy(self.run)
        run["evidence"]["method_applications"][0]["target_question_refs"] = ["Q-02"]
        self.assertTrue(any("immutable field drift: target_question_refs" in error for error in self.errors(run)))

    def test_target_judgment_unit_cannot_drift(self) -> None:
        run = copy.deepcopy(self.run)
        run["judgment"]["method_applications"][0]["target_judgment_unit_refs"] = ["JU-999"]
        self.assertTrue(any("immutable field drift" in error for error in self.errors(run)))

    def test_executed_method_requires_precondition_details(self) -> None:
        run = copy.deepcopy(self.run)
        run["judgment"]["method_applications"][0]["precondition_checks"] = []
        self.assertTrue(any("no precondition checks" in error for error in self.errors(run)))

    def test_provenance_child_fields_are_required(self) -> None:
        run = copy.deepcopy(self.run)
        run["evidence"]["method_applications"][0]["provenance"].pop("actor")
        self.assertTrue(any("provenance missing" in error or "provenance.actor" in error for error in self.errors(run)))

    def test_nonexecuted_method_requires_alternative(self) -> None:
        run = copy.deepcopy(self.run)
        degraded = next(item for item in run["judgment"]["method_applications"] if item["status"] == "degraded")
        degraded["alternatives"] = []
        self.assertTrue(any("has no alternative method" in error for error in self.errors(run)))

    def test_deprecated_stage_field_is_rejected(self) -> None:
        run = copy.deepcopy(self.run)
        run["structure"]["method_application_candidates"] = run["structure"].pop("method_applications")
        self.assertTrue(any("deprecated method fields" in error for error in self.errors(run)))

    def test_governance_rule_cannot_support_judgment(self) -> None:
        run = copy.deepcopy(self.run)
        run["judgment"]["rule_evaluations"][0]["rule_ref"] = "reasoning_trace_required"
        self.assertTrue(any("non-ontology rule" in error for error in self.errors(run)))

    def test_expression_cannot_create_new_judgment(self) -> None:
        run = copy.deepcopy(self.run)
        run["expression"]["expressions"][0]["source_claim_id"] = "C-999"
        errors = self.errors(run)
        self.assertTrue(any("unresolved judgment" in error for error in errors))

    def test_expression_requires_executed_method_trace(self) -> None:
        run = copy.deepcopy(self.run)
        run["expression"]["expressions"][0]["source_method_application_refs"] = []
        self.assertTrue(any("lacks executed MethodApplication trace" in error for error in self.errors(run)))

    def test_stage05_cannot_hide_new_facts_behind_self_check(self) -> None:
        run = copy.deepcopy(self.run)
        run["expression"]["facts"] = [{"evidence_id": "EV-NEW"}]
        self.assertTrue(any("forbidden semantic collections" in error for error in self.errors(run)))

    def test_stage05_deprecated_self_certification_is_rejected(self) -> None:
        run = copy.deepcopy(self.run)
        run["expression"]["overall_check"]["no_new_fact_created"] = True
        self.assertTrue(any("deprecated self-certification" in error for error in self.errors(run)))

    def test_ontology_instance_type_must_resolve(self) -> None:
        run = copy.deepcopy(self.run)
        run["structure"]["ontology_instances"][0]["type"] = "MissingType"
        self.assertTrue(any("unknown formal type" in error for error in self.errors(run)))

    def test_ontology_instance_required_attribute_is_enforced(self) -> None:
        run = copy.deepcopy(self.run)
        chip = next(item for item in run["structure"]["ontology_instances"] if item["type"] == "Chip")
        chip.pop("chip_category")
        self.assertTrue(any("missing required attribute chip_category" in error for error in self.errors(run)))

    def test_ontology_relation_endpoint_must_match_formal_contract(self) -> None:
        run = copy.deepcopy(self.run)
        relation = run["structure"]["ontology_relations"][0]
        relation["target_ref"] = "SV-INV"
        self.assertTrue(any("target endpoint incompatible" in error for error in self.errors(run)))

    def test_sample_must_disclose_evidence_gap(self) -> None:
        run = copy.deepcopy(self.run)
        run["evidence"]["evidence_gaps"] = []
        self.assertTrue(any("explicit evidence gap" in error for error in self.errors(run)))

    def test_full_rerun_for_local_evidence_is_rejected(self) -> None:
        run = copy.deepcopy(self.run)
        run["update"]["full_rerun_required"] = True
        self.assertTrue(any("local-first" in error for error in self.errors(run)))

    def test_incremental_update_cannot_miss_reachable_object(self) -> None:
        run = copy.deepcopy(self.run)
        run["update"]["affected_graph"]["stale"].remove("C-02")
        self.assertTrue(any("misses reachable objects" in error for error in self.errors(run)))

    def test_incremental_update_requires_current_schema(self) -> None:
        run = copy.deepcopy(self.run)
        run["update"]["schema_version"] = "1.0.0"
        self.assertTrue(any("instance version must be 1.1.0" in error for error in self.errors(run)))

    def test_new_evidence_is_not_itself_stale(self) -> None:
        run = copy.deepcopy(self.run)
        run["update"]["affected_graph"]["stale"].append("EV-04")
        self.assertTrue(any("must not be marked stale" in error for error in self.errors(run)))

    def test_incremental_update_cannot_invalidate_unreachable_object(self) -> None:
        run = copy.deepcopy(self.run)
        run["update"]["affected_graph"]["stale"].append("C-01")
        self.assertTrue(any("contains unreachable objects" in error for error in self.errors(run)))

    def test_propagation_edge_must_exist_in_actual_graph(self) -> None:
        run = copy.deepcopy(self.run)
        run["update"]["propagation_edges"][0]["target_ref"] = "C-01"
        self.assertTrue(any("not in actual dependency graph" in error for error in self.errors(run)))

    def test_recompute_stages_are_derived_from_stale_objects(self) -> None:
        run = copy.deepcopy(self.run)
        run["update"]["recompute_stages"] = ["04", "05"]
        self.assertTrue(any("must be derived from stale objects" in error for error in self.errors(run)))


if __name__ == "__main__":
    unittest.main()
