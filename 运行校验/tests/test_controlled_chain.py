#!/usr/bin/env python3
"""一期可控研究链：语义、路由、强度、表达权限、版本与 stale。"""

from __future__ import annotations

import copy
import csv
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "运行校验"))

from research_contract import (  # noqa: E402
    ContractError,
    validate_evidence_routes,
    validate_judgment_units,
    validate_reasoning_routes,
)
from status_derivation import reject_manual_derived_fields  # noqa: E402
from validate_run import derive_run_outcome  # noqa: E402

sys.path.insert(0, str(ROOT / "05_表达交付"))
from validate_05_outputs import _validate_body  # noqa: E402


def _view(example: str) -> dict:
    path = next((ROOT / example).glob("02-*本体视图-*.yaml"))
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _audit(example: str) -> dict:
    path = next((ROOT / example).glob("04-*推理审计-*.yaml"))
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _recipes(example: str) -> list[dict[str, str]]:
    path = next((ROOT / example).glob("03-*数据与证据快照-*")) / "01_plan" / "evidence_recipe_matches.csv"
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


class ControlledChainTests(unittest.TestCase):
    def test_normal_support_chain_is_publishable(self) -> None:
        completed = subprocess.run(
            [sys.executable, "运行校验/validate_run.py", "示例2", "--no-write"],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
        payload = json.loads(completed.stdout)
        self.assertTrue(payload["publishable"])
        self.assertTrue(payload["directional_conclusion_available"])

    def test_insufficient_judgment_can_still_publish(self) -> None:
        outcome = derive_run_outcome(
            chain_publish_status="PUBLISHABLE",
            quality_pass=True,
            validity_statuses={stage: "current" for stage in ["01", "02", "03", "04", "05"]},
            audit={
                "overall_judgment": {"judgment_level": "J0"},
                "claim_register": [{"claim_id": "C-01", "judgment_level": "J0"}],
            },
            semantic_review_status="pass",
        )
        self.assertTrue(outcome["publishable"])
        self.assertFalse(outcome["directional_conclusion_available"])

    def test_semantic_drift_is_blocked(self) -> None:
        rows = copy.deepcopy(_recipes("示例1"))
        rows[0]["judgment_type"] = "state_measurement"
        with self.assertRaisesRegex(ContractError, "漂移"):
            validate_evidence_routes(_view("示例1"), rows)

    def test_incompatible_reasoning_method_is_blocked(self) -> None:
        audit = copy.deepcopy(_audit("示例1"))
        audit["method_library_usage"]["claim_bindings"][0]["method_ids"] = ["kb04:A07"]
        with self.assertRaisesRegex(ContractError, "不兼容"):
            validate_reasoning_routes(_view("示例1"), audit)

    def test_allowed_alternative_evidence_method_requires_reason(self) -> None:
        rows = copy.deepcopy(_recipes("示例1"))
        trend_row = next(row for row in rows if row["judgment_type"] == "trend_direction")
        trend_row["library_recipe_id"] = "kb03:A02"
        trend_row["notes"] = "先完成同口径状态测量，暂不直接使用默认趋势方法"
        routes = validate_evidence_routes(_view("示例1"), rows)
        self.assertEqual(routes[trend_row["target_judgment_unit_id"]], "kb03:A02")

        trend_row["notes"] = ""
        with self.assertRaisesRegex(ContractError, "必须在 notes 说明理由"):
            validate_evidence_routes(_view("示例1"), rows)

    def test_bare_method_id_is_blocked(self) -> None:
        rows = copy.deepcopy(_recipes("示例1"))
        rows[0]["library_recipe_id"] = "A03"
        with self.assertRaisesRegex(ContractError, "命名空间"):
            validate_evidence_routes(_view("示例1"), rows)

    def test_risk_reassessment_must_return_to_02_for_decomposition(self) -> None:
        view = copy.deepcopy(_view("示例1"))
        view["judgment_units"][0]["judgment_type"] = "risk_reassessment"
        with self.assertRaisesRegex(ContractError, "返回 02 重新拆分"):
            validate_judgment_units(view)

    def test_strict_j4_passes_and_missing_upgrade_review_fails(self) -> None:
        view = _view("示例2")
        audit = _audit("示例2")
        validate_reasoning_routes(view, audit)

        missing_review = copy.deepcopy(audit)
        j4_claim = next(item for item in missing_review["claim_register"] if item["judgment_level"] == "J4")
        j4_claim.pop("j4_upgrade_review")
        with self.assertRaisesRegex(ContractError, "j4_upgrade_review"):
            validate_reasoning_routes(view, missing_review)

    def test_05_overreach_is_blocked(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir)
            source_dir = ROOT / "示例2"
            shutil.copytree(source_dir, target, dirs_exist_ok=True)
            delivery = next(target.glob("05-*主题深度研究-*.md"))
            expression_copy = next(target.glob("05-*表达审计-*.yaml"))
            audit = next(target.glob("04-*推理审计-*.yaml"))
            data = yaml.safe_load(expression_copy.read_text(encoding="utf-8"))
            data["claim_expression_register"][0]["source_rcs"] = ["C-999"]
            expression_copy.write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8")
            completed = subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "05_表达交付" / "validate_05_outputs.py"),
                    str(delivery),
                    "主题深度研究",
                    str(expression_copy),
                    str(audit),
                ],
                cwd=ROOT,
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(completed.returncode, 0)
            self.assertIn("C-999", completed.stdout)

    def test_upstream_change_marks_downstream_stale(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "run"
            shutil.copytree(ROOT / "示例1", target)
            view_path = next(target.glob("02-*本体视图-*.yaml"))
            view_path.write_text(view_path.read_text(encoding="utf-8") + "\n", encoding="utf-8")
            completed = subprocess.run(
                [sys.executable, str(ROOT / "运行校验" / "validate_run.py"), str(target), "--no-write"],
                cwd=ROOT,
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(completed.returncode, 0)
            payload = json.loads(completed.stdout)
            for stage in ["stage_02", "stage_03", "stage_04", "stage_05"]:
                self.assertEqual(payload["validity_statuses"][stage], "stale")

    def test_contract_version_change_requires_revalidation(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "run"
            shutil.copytree(ROOT / "示例1", target)
            manifest_path = target / "run_manifest.yaml"
            manifest = yaml.safe_load(manifest_path.read_text(encoding="utf-8"))
            manifest["versions"]["contract"] = "0.0.0"
            manifest_path.write_text(
                yaml.safe_dump(manifest, allow_unicode=True, sort_keys=False),
                encoding="utf-8",
            )
            completed = subprocess.run(
                [sys.executable, str(ROOT / "运行校验" / "validate_run.py"), str(target), "--no-write"],
                cwd=ROOT,
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(completed.returncode, 0)
            payload = json.loads(completed.stdout)
            self.assertTrue(
                all(status == "revalidation_required" for status in payload["validity_statuses"].values())
            )

    def test_manual_publishable_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "publishable"):
            reject_manual_derived_fields({"publishable": True}, "stage_artifact")

    def test_valuation_sensitivity_is_allowed_but_target_price_is_blocked(self) -> None:
        delivery = next((ROOT / "示例2").glob("05-*主题深度研究-*.md"))
        body = delivery.read_text(encoding="utf-8")
        sensitivity_body = body.replace(
            "## 投资要点",
            "## 投资要点\n\n估值敏感性分析显示，结论只影响假设区间，不形成价格结论。",
            1,
        )
        _validate_body(delivery, sensitivity_body)

        target_price_body = body.replace("## 投资要点", "## 投资要点\n\n目标价为 100 元。", 1)
        with self.assertRaisesRegex(ValueError, "目标价"):
            _validate_body(delivery, target_price_body)


if __name__ == "__main__":
    unittest.main()
