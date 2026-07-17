#!/usr/bin/env python3
"""Contract, failure-mode, metric and deterministic end-to-end tests for eval runtime."""

from __future__ import annotations

import copy
import json
import random
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import yaml


RUNTIME_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = RUNTIME_ROOT.parents[1]
sys.path.insert(0, str(RUNTIME_ROOT))

from eval_core import (  # noqa: E402
    AdapterSession,
    EvalError,
    apply_r_hard_gate,
    apply_defect,
    blind_candidate,
    conservative_median,
    grade_c,
    grade_s,
    grade_u,
    load_yaml,
    validate_case,
    validate_profiles,
    validate_suite,
    wilson_interval,
)


FIXTURE = Path(__file__).resolve().parent / "fixtures" / "adapter_fixture.py"


def run_cli(*args: str, expect: int = 0) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(
        [sys.executable, str(RUNTIME_ROOT / "eval_cli.py"), *args],
        cwd=REPO_ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    if completed.returncode != expect:
        raise AssertionError(
            f"command returned {completed.returncode}, expected {expect}: {' '.join(args)}\n{completed.stdout}"
        )
    return completed


class ContractTests(unittest.TestCase):
    def test_suite_and_defects_validate(self) -> None:
        cases = validate_suite()
        self.assertEqual([item["case"]["case_id"] for item in cases], ["RV-T01", "RV-T02", "RV-T07", "RV-T08"])
        defects = load_yaml(RUNTIME_ROOT / "calibration" / "defects.yaml")["items"]
        self.assertEqual(len(defects), 11)
        case_map = {item["case"]["case_id"]: item for item in cases}
        for defect in defects:
            normal = case_map[defect["base_case"]]["artifact_path"].read_text(encoding="utf-8-sig")
            self.assertNotEqual(apply_defect(normal, defect), normal)

    def test_blinding_removes_labels_and_normalizes_title(self) -> None:
        source = "---\nquality_status: high_quality_pass\nconfidence: high\n---\n# 原始05标题\n\n正文\n"
        result = blind_candidate(source)
        self.assertTrue(result.startswith("# 候选研究产物"))
        self.assertNotIn("high_quality_pass", result)
        self.assertNotIn("confidence", result)
        self.assertNotIn("原始05标题", result)
        with self.assertRaises(EvalError):
            blind_candidate("# 标题\n\n正文夹带 high_quality_pass 标签\n")

    def _copy_case(self, case_id: str, root: Path) -> Path:
        source = RUNTIME_ROOT.parent / "02_案例" / case_id
        target = root / case_id
        shutil.copytree(source, target)
        return target / "case.yaml"

    def _mutate_case(self, case_id: str, mutator) -> None:  # type: ignore[no-untyped-def]
        with tempfile.TemporaryDirectory() as raw:
            case_path = self._copy_case(case_id, Path(raw))
            case = load_yaml(case_path)
            mutator(case, case_path.parent)
            case_path.write_text(yaml.safe_dump(case, allow_unicode=True, sort_keys=False), encoding="utf-8")
            with self.assertRaises(EvalError):
                validate_case(case_path)

    def test_missing_case_field_fails(self) -> None:
        self._mutate_case("RV-T01", lambda case, _: case.pop("experiment"))

    def test_missing_evidence_locator_fails(self) -> None:
        def mutate(_: dict, case_dir: Path) -> None:
            evidence_path = case_dir / "evidence.yaml"
            evidence = load_yaml(evidence_path)
            evidence["evidence"][0]["locator"] = ""
            evidence_path.write_text(yaml.safe_dump(evidence, allow_unicode=True, sort_keys=False), encoding="utf-8")

        self._mutate_case("RV-T01", mutate)

    def test_time_travel_and_hash_mismatch_fail(self) -> None:
        for field, value in [("published_at", "2099-01-01"), ("content_hash", "sha256:broken")]:
            def mutate(_: dict, case_dir: Path, field: str = field, value: str = value) -> None:
                evidence_path = case_dir / "evidence.yaml"
                evidence = load_yaml(evidence_path)
                evidence["evidence"][0][field] = value
                evidence_path.write_text(
                    yaml.safe_dump(evidence, allow_unicode=True, sort_keys=False), encoding="utf-8"
                )

            self._mutate_case("RV-T01", mutate)

    def test_sealed_information_leakage_fails(self) -> None:
        def mutate(case: dict, _: Path) -> None:
            case["isolation"]["producer_visible"].append("sealed/adjudication.yaml")

        self._mutate_case("RV-T01", mutate)

    def test_sealed_provenance_required(self) -> None:
        def mutate(_: dict, case_dir: Path) -> None:
            path = case_dir / "sealed" / "adjudication.yaml"
            adjudication = load_yaml(path)
            adjudication.pop("provenance", None)
            path.write_text(yaml.safe_dump(adjudication, allow_unicode=True, sort_keys=False), encoding="utf-8")

        self._mutate_case("RV-T01", mutate)

    def test_official_profile_separation_fails(self) -> None:
        source = load_yaml(RUNTIME_ROOT / "mock_profiles.yaml")
        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / "profiles.yaml"
            duplicate = copy.deepcopy(source)
            duplicate["profiles"]["judge_b"]["model_id"] = duplicate["profiles"]["judge_a"]["model_id"]
            path.write_text(yaml.safe_dump(duplicate, sort_keys=False), encoding="utf-8")
            with self.assertRaises(EvalError):
                validate_profiles(path)
            self_scoring = copy.deepcopy(source)
            self_scoring["profiles"]["downstream_a"]["model_id"] = self_scoring["profiles"]["judge_a"]["model_id"]
            path.write_text(yaml.safe_dump(self_scoring, sort_keys=False), encoding="utf-8")
            with self.assertRaises(EvalError):
                validate_profiles(path)
            single = copy.deepcopy(source)
            single["role_bindings"]["judges"] = ["judge_a"]
            path.write_text(yaml.safe_dump(single, sort_keys=False), encoding="utf-8")
            with self.assertRaises(EvalError):
                validate_profiles(path)


class MetricTests(unittest.TestCase):
    def test_conservative_median_and_wilson(self) -> None:
        self.assertEqual(conservative_median([0, 1, 2, 3, 3, 3]), 2)
        self.assertEqual(apply_r_hard_gate("R3", ["核心事实错误"]), 0)
        self.assertEqual(apply_r_hard_gate("R2", []), 2)
        low, high = wilson_interval(6, 6)
        self.assertAlmostEqual(low, 0.6892, places=3)
        self.assertEqual(high, 1.0)

    def test_u_s_c_boundaries(self) -> None:
        four_pass = {"core_restatement": 0.85, "tracking_plan": 0.80, "information_update": 0.75, "research_questions": 0.80}
        self.assertEqual(grade_u(four_pass, False), "U3")
        self.assertEqual(grade_u(four_pass, True), "U0")
        self.assertEqual(grade_s(0.80, 0.80, 0.10, 1), "S3")
        self.assertEqual(grade_s(0.66, 0.70, 0.20, 2), "S2")
        self.assertEqual(grade_c(0.90, 0.10, 0.90, 0.80, 0.80), "C3")
        self.assertEqual(grade_c(0.79, 0.10, 0.90, 0.80, 0.80), "C1")
        self.assertEqual(grade_c(0.95, 0.05, 0.95, 0.90, 0.90, severity=0.50), "C1")


class AdapterTests(unittest.TestCase):
    def _request(self, request_id: str = "REQ-test") -> dict[str, object]:
        return {"request_id": request_id}

    def test_retry_then_success(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            session = AdapterSession(
                [sys.executable, str(FIXTURE), "--mode", "flaky", "--state-file", str(Path(raw) / "state")],
                "fixture-model",
                timeout_seconds=0.5,
                max_retries=2,
            )
            try:
                self.assertEqual(session.send(self._request())["status"], "ok")
            finally:
                session.close()

    def test_invalid_mismatch_and_timeout_are_recorded(self) -> None:
        for mode in ["invalid", "mismatch", "timeout"]:
            command = [sys.executable, str(FIXTURE), "--mode", mode]
            if mode == "timeout":
                command.extend(["--delay", "0.1"])
            session = AdapterSession(command, "fixture-model", timeout_seconds=0.02, max_retries=2)
            try:
                response = session.send(self._request(f"REQ-{mode}"))
                self.assertEqual(response["status"], "error")
                self.assertIn("attempt=3", str(response["error"]))
            finally:
                session.close()


class EndToEndTests(unittest.TestCase):
    def test_failed_calibration_blocks_formal_roles(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            run_dir = root / "run"
            profiles_path = root / "profiles.yaml"
            command = [sys.executable, str(FIXTURE), "--mode", "valid"]
            profiles = {
                "run_mode": "development",
                "profiles": {
                    "producer": {"model_id": "producer", "provider_family": "p", "command": command},
                    "judge_a": {"model_id": "judge-a", "provider_family": "a", "command": command},
                    "judge_b": {"model_id": "judge-b", "provider_family": "b", "command": command},
                    "downstream_a": {"model_id": "downstream-a", "provider_family": "a", "command": command},
                    "downstream_b": {"model_id": "downstream-b", "provider_family": "b", "command": command},
                },
                "role_bindings": {
                    "producer": "producer",
                    "judges": ["judge_a", "judge_b"],
                    "downstream_models": ["downstream_a", "downstream_b"],
                },
            }
            profiles_path.write_text(yaml.safe_dump(profiles, sort_keys=False), encoding="utf-8")
            run_cli("prepare", "--run-dir", str(run_dir))
            run_cli(
                "run",
                "--run-dir",
                str(run_dir),
                "--profiles",
                str(profiles_path),
                expect=3,
            )
            roles = {
                json.loads(line)["role"]
                for line in (run_dir / "requests.jsonl").read_text(encoding="utf-8").splitlines()
            }
            self.assertEqual(roles, {"calibration", "calibration_clean", "perturbation"})
            self.assertEqual(load_yaml(run_dir / "run_status.yaml")["status"], "calibration_failed")

    def test_mock_pipeline_resume_and_unordered_aggregation(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            run_dir = Path(raw) / "run"
            run_cli("prepare", "--run-dir", str(run_dir))
            run_cli(
                "run",
                "--run-dir",
                str(run_dir),
                "--profiles",
                str(RUNTIME_ROOT / "mock_profiles.yaml"),
            )
            responses = run_dir / "responses.jsonl"
            before = responses.read_text(encoding="utf-8").splitlines()
            self.assertEqual(len(before), 1506)

            # Re-running is a pure resume: no duplicate request or response rows are appended.
            run_cli(
                "run",
                "--run-dir",
                str(run_dir),
                "--profiles",
                str(RUNTIME_ROOT / "mock_profiles.yaml"),
            )
            after = responses.read_text(encoding="utf-8").splitlines()
            self.assertEqual(after, before)

            # Aggregation is keyed by request metadata and is independent of response order.
            random.Random(7).shuffle(after)
            responses.write_text("\n".join(after) + "\n", encoding="utf-8")
            run_cli("aggregate", "--run-dir", str(run_dir))
            run_cli("report", "--run-dir", str(run_dir))
            summary = load_yaml(run_dir / "summary.yaml")
            report = (run_dir / "report.md").read_text(encoding="utf-8")
            self.assertTrue(summary["no_composite_score"])
            self.assertEqual(summary["calibration"]["grade"], "C3")
            self.assertTrue(summary["calibration"]["all_judges_eligible"])
            self.assertEqual(set(summary["cases"]), {"RV-T01", "RV-T02", "RV-T07", "RV-T08"})
            self.assertNotIn("综合分", report)
            self.assertNotIn("代理可靠概率", report)
            self.assertIn("裁决支持频率", report)
            self.assertIn("同证据直接生成", report)
            self.assertNotIn("proxy_reliability_probability", json.dumps(summary, ensure_ascii=False))
            self.assertIn("adjudication_support_rate", summary["cases"]["RV-T01"])
            self.assertIn("proxy_reliability_rate", summary["strata"]["report_value"])
            self.assertIn("same_evidence_direct", summary["cases"]["RV-T01"]["delta"]["pairwise"])
            self.assertEqual(
                summary["cases"]["RV-T01"]["diagnostics"]["sealed_independence_mode"],
                "pilot_manual",
            )

if __name__ == "__main__":
    unittest.main(verbosity=2)
