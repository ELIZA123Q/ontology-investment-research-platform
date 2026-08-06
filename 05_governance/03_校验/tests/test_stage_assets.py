#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[3]
VALIDATOR = ROOT / "05_governance/03_校验/validate_stage_assets.py"
spec = importlib.util.spec_from_file_location("validate_stage_assets", VALIDATOR)
assert spec and spec.loader
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


class StageAssetTests(unittest.TestCase):
    def test_repository_passes(self) -> None:
        self.assertEqual(validator.validate_repository(), [])

    def test_old_schema_is_rejected(self) -> None:
        path, expected = validator.TEMPLATES["05"]
        text = path.read_text(encoding="utf-8")
        document = yaml.safe_load(text)
        document["schema_version"] = "2.6.0"
        self.assertTrue(any("schema" in error for error in validator.validate_template("05", document, text, expected)))

    def test_deprecated_method_alias_is_rejected(self) -> None:
        path, expected = validator.TEMPLATES["03"]
        text = path.read_text(encoding="utf-8") + "\nmethod_input_bindings: []\n"
        document = yaml.safe_load(path.read_text(encoding="utf-8"))
        self.assertTrue(any("deprecated MethodApplication" in error for error in validator.validate_template("03", document, text, expected)))

    def test_matched_only_rule_evaluation_is_rejected(self) -> None:
        path, expected = validator.TEMPLATES["04"]
        text = path.read_text(encoding="utf-8") + "\ncondition_results: [matched]\n"
        document = yaml.safe_load(path.read_text(encoding="utf-8"))
        self.assertTrue(any("matched-only" in error for error in validator.validate_template("04", document, text, expected)))


if __name__ == "__main__":
    unittest.main()
