#!/usr/bin/env python3
"""Focused regression for runtime_instance_graph projection helpers."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "07_runtime" / "engine"))

from runtime_instance_graph import (  # noqa: E402
    AUDIT_REASONING_LISTS,
    AUDIT_SCHEMA_VERSION,
    STAGE03_OBJECT_CSV,
)


class RuntimeInstanceGraphContractTests(unittest.TestCase):
    def test_audit_schema_version(self) -> None:
        self.assertEqual(AUDIT_SCHEMA_VERSION, "4.0.0")

    def test_method_applications_registered_in_audit_lists(self) -> None:
        self.assertIn("method_applications", AUDIT_REASONING_LISTS)
        object_type, id_field = AUDIT_REASONING_LISTS["method_applications"]
        self.assertEqual(object_type, "MethodApplication")
        self.assertEqual(id_field, "application_id")

    def test_stage03_projection_flags_exclude_non_graph_rows(self) -> None:
        readiness = STAGE03_OBJECT_CSV["evidence_readiness_assessments.csv"]
        self.assertFalse(readiness.get("project_to_graph", True))
        channels = STAGE03_OBJECT_CSV["acquisition_channels.csv"]
        self.assertFalse(channels.get("project_to_graph", True))
        inputs = STAGE03_OBJECT_CSV["reasoning_inputs.csv"]
        self.assertFalse(inputs.get("project_to_graph", True))
        baskets = STAGE03_OBJECT_CSV["evidence_baskets.csv"]
        self.assertNotIn("project_to_graph", baskets)


if __name__ == "__main__":
    unittest.main()
