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
REPO_ROOT = RUNTIME_ROOT.parents[2]  # 03_执行 → 14_evals → 05_governance → repo
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
    normalize_role_result,
    role_output_tokens,
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

    def test_legacy_perturbation_actions_normalize_to_frozen_vocabulary(self) -> None:
        base = {"request_metadata": {"role": "perturbation"}}
        self.assertEqual(normalize_role_result({**base, "result": {"judgment": "降级"}})["action"], "downgrade")
        self.assertEqual(
            normalize_role_result({**base, "result": {"evaluation": {"result": "维持暂不可判断"}}})["action"],
            "maintain_abstention",
        )
        self.assertEqual(normalize_role_result({**base, "result": {"action": "reopen"}})["action"], "reopen")
        self.assertEqual(normalize_role_result({**base, "result": {"decision": "弃答"}})["action"], "abstain")

    def test_perturbation_actions_reject_free_text_contract(self) -> None:
        def mutate(_: dict, case_dir: Path) -> None:
            path = case_dir / "perturbations.yaml"
            perturbations = load_yaml(path)
            perturbations["items"][0]["acceptable_actions"] = ["自由文本"]
            path.write_text(yaml.safe_dump(perturbations, allow_unicode=True, sort_keys=False), encoding="utf-8")

        self._mutate_case("RV-T08", mutate)

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
        source["run_mode"] = "official"
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
            duplicate_downstream = copy.deepcopy(source)
            duplicate_downstream["profiles"]["downstream_b"]["model_id"] = duplicate_downstream["profiles"]["downstream_a"]["model_id"]
            path.write_text(yaml.safe_dump(duplicate_downstream, sort_keys=False), encoding="utf-8")
            with self.assertRaises(EvalError):
                validate_profiles(path)
            producer_as_downstream = copy.deepcopy(source)
            producer_as_downstream["profiles"]["downstream_a"]["model_id"] = producer_as_downstream["profiles"]["producer"]["model_id"]
            path.write_text(yaml.safe_dump(producer_as_downstream, sort_keys=False), encoding="utf-8")
            with self.assertRaises(EvalError):
                validate_profiles(path)

    def test_single_vendor_pro_flash_profile_is_bounded_comparative(self) -> None:
        path = RUNTIME_ROOT / "model_profiles.yaml"
        registry = validate_profiles(path)
        self.assertEqual(registry["run_mode"], "single_vendor")
        ids = {profile["model_id"] for profile in registry["profiles"].values()}
        self.assertEqual(ids, {"deepseek-v4-flash", "deepseek-v4-pro"})
        self.assertEqual(registry["evaluation_scope"], "single_vendor_comparative")
        self.assertTrue(registry["research_gain_claim_eligible"])
        self.assertEqual(registry["profiles"]["producer"]["model_id"], "deepseek-v4-flash")
        self.assertEqual(registry["profiles"]["judge_a"]["model_id"], "deepseek-v4-pro")

    def test_single_vendor_flash_only_stays_pipeline_only(self) -> None:
        source = load_yaml(RUNTIME_ROOT / "model_profiles.yaml")
        for name in source["profiles"]:
            source["profiles"][name]["model_id"] = "deepseek-v4-flash"
        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / "profiles.yaml"
            path.write_text(yaml.safe_dump(source, allow_unicode=True, sort_keys=False), encoding="utf-8")
            registry = validate_profiles(path)
        self.assertEqual(registry["evaluation_scope"], "pipeline_only")
        self.assertFalse(registry["research_gain_claim_eligible"])

    def test_single_vendor_two_model_profile_is_bounded_comparative(self) -> None:
        source = load_yaml(RUNTIME_ROOT / "model_profiles.yaml")
        source["profiles"]["producer"]["model_id"] = "deepseek-pro-frozen"
        source["profiles"]["downstream_a"]["model_id"] = "deepseek-v4-pro"
        source["profiles"]["downstream_b"]["model_id"] = "deepseek-v4-pro"
        source["profiles"]["judge_a"]["model_id"] = "deepseek-v4-flash"
        source["profiles"]["judge_b"]["model_id"] = "deepseek-v4-flash"
        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / "profiles.yaml"
            path.write_text(yaml.safe_dump(source, allow_unicode=True, sort_keys=False), encoding="utf-8")
            registry = validate_profiles(path)
        self.assertEqual(registry["evaluation_scope"], "single_vendor_comparative")
        self.assertTrue(registry["research_gain_claim_eligible"])
    def test_development_profile_is_not_claim_eligible(self) -> None:
        registry = validate_profiles(RUNTIME_ROOT / "mock_profiles.yaml")
        self.assertEqual(registry["evaluation_scope"], "development_only")
        self.assertFalse(registry["research_gain_claim_eligible"])


class MetricTests(unittest.TestCase):
    def test_structured_calibration_budget_allows_a_final_json_answer(self) -> None:
        self.assertEqual(role_output_tokens("calibration", {}), 2048)
        self.assertEqual(role_output_tokens("calibration_clean", {}), 1024)
        self.assertEqual(role_output_tokens("perturbation", {}), 1600)

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
    def test_pipeline_only_profile_requires_an_explicit_request_cap(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            run_dir = root / "run"
            profiles_path = root / "profiles.yaml"
            source = load_yaml(RUNTIME_ROOT / "model_profiles.yaml")
            for name in source["profiles"]:
                source["profiles"][name]["model_id"] = "deepseek-v4-flash"
            profiles_path.write_text(yaml.safe_dump(source, allow_unicode=True, sort_keys=False), encoding="utf-8")
            run_cli("prepare", "--run-dir", str(run_dir))
            run_cli(
                "run",
                "--run-dir",
                str(run_dir),
                "--profiles",
                str(profiles_path),
                expect=1,
            )
            self.assertFalse((run_dir / "responses.jsonl").exists())

    def test_hard_request_budget_stops_before_extra_model_call(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            run_dir = Path(raw) / "run"
            run_cli("prepare", "--run-dir", str(run_dir))
            run_cli(
                "run",
                "--run-dir",
                str(run_dir),
                "--profiles",
                str(RUNTIME_ROOT / "mock_profiles.yaml"),
                "--max-new-requests",
                "2",
                expect=4,
            )
            responses = (run_dir / "responses.jsonl").read_text(encoding="utf-8").splitlines()
            status = load_yaml(run_dir / "run_status.yaml")
            self.assertEqual(len(responses), 2)
            self.assertEqual(status["status"], "request_budget_exhausted")
            self.assertEqual(status["new_requests_sent"], 2)
            self.assertEqual(status["max_new_requests"], 2)

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
            self.assertEqual(summary["evaluation_scope"], "development_only")
            self.assertFalse(summary["research_gain_claim_eligible"])
            self.assertFalse(summary["suite_proxy_rate_release_allowed"])
            self.assertEqual(summary["calibration"]["grade"], "C3")
            self.assertTrue(summary["calibration"]["all_judges_eligible"])
            self.assertEqual(set(summary["cases"]), {"RV-T01", "RV-T02", "RV-T07", "RV-T08"})
            self.assertNotIn("综合分", report)
            self.assertNotIn("代理可靠概率", report)
            self.assertIn("裁决支持频率", report)
            self.assertIn("同证据直接生成", report)
            self.assertIn("无，仅作管线诊断", report)
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
