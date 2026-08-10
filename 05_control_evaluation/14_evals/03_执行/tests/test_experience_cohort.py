#!/usr/bin/env python3
"""Negative regression tests for the researcher-experience cohort contract."""

from __future__ import annotations

import copy
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path


RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT))

from experience_cohort import (  # noqa: E402
    ExperienceCohortError,
    load_cohort,
    validate_cohort,
    validate_database_bindings,
)


class ExperienceCohortContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.cohort = load_cohort()

    def test_current_cohort_is_valid_but_not_ready(self) -> None:
        summary = validate_cohort(self.cohort)
        self.assertEqual(summary["case_count"], 10)
        self.assertEqual(summary["completed_count"], 0)
        self.assertFalse(summary["baseline_ready"])
        self.assertGreaterEqual(summary["scenario_counts"]["normal_success"], 3)
        self.assertGreaterEqual(summary["scenario_counts"]["conflict_stop"], 2)
        self.assertGreaterEqual(summary["scenario_counts"]["insufficient_stop"], 2)
        self.assertGreaterEqual(summary["scenario_counts"]["incremental_rejudgment"], 2)
        self.assertGreaterEqual(summary["scenario_counts"]["source_invalidation"], 1)
        self.assertGreaterEqual(summary["ontology_hypothesis_counts"]["semantic_alignment"], 2)
        self.assertGreaterEqual(summary["ontology_hypothesis_counts"]["stage_scope_guard"], 2)

    def test_too_few_cases_fail(self) -> None:
        mutated = copy.deepcopy(self.cohort)
        mutated["primary_cases"] = mutated["primary_cases"][:7]
        with self.assertRaisesRegex(ExperienceCohortError, "数量"):
            validate_cohort(mutated)

    def test_coverage_gap_fails(self) -> None:
        mutated = copy.deepcopy(self.cohort)
        for item in mutated["primary_cases"]:
            item["scenarios"] = [value for value in item["scenarios"] if value != "source_invalidation"]
        with self.assertRaisesRegex(ExperienceCohortError, "source_invalidation"):
            validate_cohort(mutated)

    def test_ontology_value_hypothesis_gap_fails(self) -> None:
        mutated = copy.deepcopy(self.cohort)
        for item in mutated["primary_cases"]:
            item["ontology_value_hypotheses"] = [
                value for value in item["ontology_value_hypotheses"]
                if value != "causal_boundary"
            ]
        with self.assertRaisesRegex(ExperienceCohortError, "causal_boundary"):
            validate_cohort(mutated)

    def test_pure_ontology_causal_claim_is_forbidden(self) -> None:
        mutated = copy.deepcopy(self.cohort)
        mutated["ontology_value_contract"]["pure_ontology_causal_claim_allowed"] = True
        with self.assertRaisesRegex(ExperienceCohortError, "纯本体因果效应"):
            validate_cohort(mutated)

    def test_targets_cannot_be_frozen_before_eight_completed_cases(self) -> None:
        mutated = copy.deepcopy(self.cohort)
        mutated["measurement_contract"]["targets_frozen"] = True
        mutated["measurement_contract"]["targets"] = {"ttfc_minutes": 30}
        with self.assertRaisesRegex(ExperienceCohortError, "不得冻结"):
            validate_cohort(mutated)

    def test_active_case_requires_run_id_and_planned_case_rejects_one(self) -> None:
        enrolled = copy.deepcopy(self.cohort)
        enrolled["primary_cases"][0]["status"] = "enrolled"
        with self.assertRaisesRegex(ExperienceCohortError, "必须绑定"):
            validate_cohort(enrolled)

        planned = copy.deepcopy(self.cohort)
        planned["primary_cases"][0]["run_id"] = "not-yet-created"
        with self.assertRaisesRegex(ExperienceCohortError, "不应提前绑定"):
            validate_cohort(planned)

    def test_historical_anchors_never_enter_quantitative_denominator(self) -> None:
        mutated = copy.deepcopy(self.cohort)
        mutated["historical_anchors"][0]["quantitative_cohort_eligible"] = True
        with self.assertRaisesRegex(ExperienceCohortError, "不得进入"):
            validate_cohort(mutated)

    def test_database_binding_is_discovered_from_append_only_event(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            db_path = Path(raw) / "workbench.sqlite"
            connection = sqlite3.connect(db_path)
            connection.executescript("""
                CREATE TABLE research_runs(
                  id TEXT PRIMARY KEY, question TEXT, domain TEXT, status TEXT, current_stage INTEGER
                );
                CREATE TABLE research_experience_events(
                  id TEXT PRIMARY KEY, run_id TEXT, event_type TEXT, payload_json TEXT, occurred_at TEXT
                );
            """)
            case = self.cohort["primary_cases"][0]
            connection.execute(
                "INSERT INTO research_runs VALUES(?,?,?,?,?)",
                ("run-1", case["question"], "semiconductor", "draft", 0),
            )
            connection.execute(
                "INSERT INTO research_experience_events VALUES(?,?,?,?,?)",
                (
                    "event-1",
                    "run-1",
                    "run_created",
                    json.dumps({
                        "experience_cohort_id": self.cohort["cohort_id"],
                        "experience_case_id": case["case_id"],
                    }),
                    "2026-07-22T00:00:00Z",
                ),
            )
            connection.commit()
            connection.close()
            self.assertEqual(
                validate_database_bindings(self.cohort, db_path),
                {"bound_count": 1, "completed_count": 0},
            )


if __name__ == "__main__":
    unittest.main()
