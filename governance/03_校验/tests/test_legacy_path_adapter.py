#!/usr/bin/env python3
from __future__ import annotations

import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "runtime/adapters"))

from legacy_run_manifest import migrate_manifest_paths, remap_repository_path  # noqa: E402


class LegacyPathAdapterTests(unittest.TestCase):
    def test_longest_prefix_wins(self) -> None:
        self.assertEqual(
            remap_repository_path("05_表达交付/模板/05C_行业周期判断模板.md"),
            "delivery/02_模板/05C_行业周期判断模板.md",
        )

    def test_manifest_business_fields_are_unchanged(self) -> None:
        legacy = {
            "task_id": "JTASK-001",
            "judgment_level": "J2",
            "artifacts": ["示例1/run_manifest.yaml", "methods/04_裁决/A01_状态判断.md"],
        }
        migrated = migrate_manifest_paths(legacy)
        self.assertEqual(migrated["task_id"], "JTASK-001")
        self.assertEqual(migrated["judgment_level"], "J2")
        self.assertEqual(migrated["artifacts"][0], "instances/01_正式样例/01_存储周期/run_manifest.yaml")
        self.assertEqual(migrated["artifacts"][1], "methods/04_裁决/A01_状态判断.md")


if __name__ == "__main__":
    unittest.main()
