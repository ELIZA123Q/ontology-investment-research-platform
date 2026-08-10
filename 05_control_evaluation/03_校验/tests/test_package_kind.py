#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[3]
MODULE = ROOT / "05_control_evaluation/03_校验/package_kind.py"
spec = importlib.util.spec_from_file_location("package_kind", MODULE)
assert spec and spec.loader
package_kind = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package_kind)


class PackageKindTests(unittest.TestCase):
    def test_v3_samples_detected(self) -> None:
        sample = ROOT / "04_context_state/03_workspace/02_V3样例/01_memory-cycle-run-002"
        self.assertEqual(package_kind.detect_package_kind(sample), package_kind.KIND_V3)

    def test_workbench_manifest_wins(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp)
            (run_dir / "01_task.yaml").write_text("stage: '01'\nquestion: q\n", encoding="utf-8")
            (run_dir / "02_structure.yaml").write_text("stage: '02'\n", encoding="utf-8")
            (run_dir / "run_manifest.yaml").write_text(
                yaml.safe_dump({
                    "schema_name": "controlled_research_run_manifest_workbench",
                    "package_kind": "workbench_export",
                    "run_mode": "workbench",
                }),
                encoding="utf-8",
            )
            self.assertEqual(package_kind.detect_package_kind(run_dir), package_kind.KIND_WORKBENCH)

    def test_formal_marker(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp)
            (run_dir / "01-主题投研需求说明-2026-1.md").write_text("# req\n", encoding="utf-8")
            self.assertEqual(package_kind.detect_package_kind(run_dir), package_kind.KIND_FORMAL)

    def test_new_audit_manifest_is_routed_to_full_chain_validator(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp)
            (run_dir / "run_manifest.yaml").write_text(
                yaml.safe_dump({
                    "schema_name": "controlled_research_run_manifest",
                    "schema_version": "1.3.0",
                    "package_kind": "research_audit_pack",
                }),
                encoding="utf-8",
            )
            self.assertEqual(package_kind.detect_package_kind(run_dir), package_kind.KIND_AUDIT)


if __name__ == "__main__":
    unittest.main()
