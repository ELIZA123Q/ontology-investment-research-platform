#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
VALIDATOR = ROOT / "governance/03_校验/validate_strategic_research_boundary.py"
spec = importlib.util.spec_from_file_location("validate_strategic_research_boundary", VALIDATOR)
assert spec and spec.loader
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


class StrategicResearchBoundaryTests(unittest.TestCase):
    def test_repository_keeps_strategic_research_boundary_markers(self) -> None:
        self.assertEqual(validator.validate_repository(), [])

    def test_all_marker_groups_are_nonempty(self) -> None:
        for markers in validator.REQUIRED_MARKERS.values():
            self.assertGreaterEqual(len(markers), 2)


if __name__ == "__main__":
    unittest.main()
