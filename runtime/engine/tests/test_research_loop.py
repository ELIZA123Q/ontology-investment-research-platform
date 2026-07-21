#!/usr/bin/env python3
"""Unit tests for research_loop classification and convergence helpers."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "runtime" / "engine"))

from research_loop import (  # noqa: E402
    CLASSIFICATION_PRIORITY,
    CLASSIFICATION_STAGES,
    RETURN_TO_STAGE,
    _higher_classification,
    convergence_status,
)


class ResearchLoopRoutingTests(unittest.TestCase):
    def test_higher_classification_prefers_task_contract(self) -> None:
        self.assertEqual(
            _higher_classification("evidence_update", "task_contract_revision"),
            "task_contract_revision",
        )
        self.assertEqual(
            _higher_classification("no_semantic_delta", "presentation_revision"),
            "presentation_revision",
        )

    def test_return_to_stage_mapping(self) -> None:
        self.assertEqual(RETURN_TO_STAGE["task_contract_revision"], "stage_01")
        self.assertEqual(RETURN_TO_STAGE["reasoning_structure_revision"], "stage_02")
        self.assertEqual(RETURN_TO_STAGE["evidence_update"], "stage_03")
        self.assertEqual(RETURN_TO_STAGE["presentation_revision"], "stage_05")
        self.assertIsNone(RETURN_TO_STAGE["no_semantic_delta"])

    def test_classification_stages_are_suffixes(self) -> None:
        self.assertEqual(CLASSIFICATION_STAGES["presentation_revision"], ["stage_05"])
        self.assertEqual(CLASSIFICATION_STAGES["evidence_update"][0], "stage_03")
        self.assertGreater(
            CLASSIFICATION_PRIORITY["task_contract_revision"],
            CLASSIFICATION_PRIORITY["evidence_update"],
        )

    def test_convergence_status_requires_no_open_work(self) -> None:
        open_state = {
            "pending_structural_trigger_refs": ["TRIG-1"],
            "critical_stale_refs": [],
            "pending_stage_attempts": [],
            "attempt_hashes": {},
            "conflicts": [],
            "latest_wave": {"key_judgment_changed": False, "key_path_changed": False},
            "structural_impact_scope_unresolved": False,
        }
        result = convergence_status(open_state)
        self.assertFalse(result["converged"])
        self.assertTrue(any("pending_structural" in item for item in result["blockers"]))

        closed_state = {
            "pending_structural_trigger_refs": [],
            "critical_stale_refs": [],
            "pending_stage_attempts": [],
            "attempt_hashes": {
                "stage_01": {"declared_hash": "a", "actual_hash": "a"},
                "stage_02": {"declared_hash": "b", "actual_hash": "b"},
                "stage_03": {"declared_hash": "c", "actual_hash": "c"},
                "stage_04": {"declared_hash": "d", "actual_hash": "d"},
                "stage_05": {"declared_hash": "e", "actual_hash": "e"},
            },
            "conflicts": [{"conflict_ref": "C1", "resolution_status": "resolved"}],
            "latest_wave": {"key_judgment_changed": False, "key_path_changed": False},
            "structural_impact_scope_unresolved": False,
        }
        closed = convergence_status(closed_state)
        self.assertTrue(closed["converged"])
        self.assertFalse(closed["semantic_iteration_limit_used"])


if __name__ == "__main__":
    unittest.main()
