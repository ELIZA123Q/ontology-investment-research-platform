#!/usr/bin/env python3
"""CLI for validation, preparation, execution, aggregation and reporting."""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

import yaml

from eval_core import (
    C_ORDER,
    DEFECTS_PATH,
    PRIMARY_PAIRWISE_BASELINES,
    REPO_ROOT,
    R_ORDER,
    SUITE_PATH,
    U_THRESHOLD_STATUS,
    U_THRESHOLDS,
    AdapterSession,
    EvalError,
    agreement_rate,
    apply_r_hard_gate,
    append_jsonl,
    apply_defect,
    blind_candidate,
    blind_data,
    blind_text,
    close_sessions,
    conservative_median,
    dump_json,
    dump_yaml,
    execute_request,
    grade_c,
    grade_s,
    grade_u,
    load_yaml,
    make_request,
    read_jsonl,
    resolve_repo_path,
    sha256_text,
    stable_hash,
    validate_profiles,
    validate_suite,
    wilson_interval,
)


SEEDS = [11, 22, 33]
PROMPT_VARIANTS = {11: "A", 22: "B", 33: "A"}
DOWNSTREAM_TASKS = ["core_restatement", "tracking_plan", "information_update", "research_questions"]


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def render_evidence(pack: dict[str, Any]) -> str:
    lines = ["## 冻结证据包", ""]
    for item in pack["evidence"]:
        lines.extend(
            [
                f"### {item['evidence_id']} · {item['title']}",
                f"- 发布者：{item['publisher']}",
                f"- 发布时间：{item['published_at']}；业务时间：{item['business_time']}",
                f"- 独立来源组：{item['independence_group']}；性质：{item['statement_nature']}",
                f"- 定位：{item['locator']}",
                f"- 摘录：{item['excerpt']}",
                f"- 可支持：{'；'.join(item['supports'])}",
                f"- 限制：{'；'.join(item['limits'])}",
                f"- 来源：{item['source_url']}",
                "",
            ]
        )
    return "\n".join(lines).strip() + "\n"


def read_reasoning_materials(case: dict[str, Any]) -> str:
    parts: list[str] = []
    for index, value in enumerate(case.get("reasoning_materials") or [], 1):
        path = resolve_repo_path(str(value))
        text = path.read_text(encoding="utf-8-sig")
        if path.suffix.lower() == ".md":
            text = blind_text(text, strip_body_labels=True)
        elif path.suffix.lower() in {".yaml", ".yml"}:
            text = yaml.safe_dump(blind_data(load_yaml(path)), allow_unicode=True, sort_keys=False)
        parts.append(f"## 推理材料 {index}\n\n{text}")
    return "\n\n".join(parts)


def command_validate(args: argparse.Namespace) -> int:
    cases = validate_suite(Path(args.suite))
    if args.profiles:
        validate_profiles(Path(args.profiles), require_official=args.official)
    else:
        validate_profiles(
            Path(__file__).resolve().parent / "mock_profiles.yaml",
            require_official=args.official,
        )
    evidence_count = sum(len(item["evidence"]["evidence"]) for item in cases)
    claim_count = sum(len(item["adjudication"]["core_claims"]) for item in cases)
    print(
        f"EVAL_PASS: {len(cases)}个试点案例，{evidence_count}条冻结证据，"
        f"{claim_count}条密封判断，10类缺陷；R/U/delta与S/C契约有效。"
    )
    return 0


def command_prepare(args: argparse.Namespace) -> int:
    cases = validate_suite(Path(args.suite))
    run_dir = Path(args.run_dir).resolve()
    if (run_dir / "requests.jsonl").exists() or (run_dir / "responses.jsonl").exists():
        raise EvalError("该run目录已有执行日志；请直接run断点续跑，或使用新的run目录重新prepare")
    contexts_root = run_dir / "contexts"
    candidates_root = run_dir / "candidates"
    variants_root = run_dir / "defect_variants"
    baselines_root = run_dir / "baselines"
    defects = load_yaml(DEFECTS_PATH)["items"]
    manifest_cases: list[dict[str, Any]] = []

    for info in cases:
        case = info["case"]
        case_id = case["case_id"]
        question = case["task_input"]["question"]
        normal = info["artifact_path"].read_text(encoding="utf-8-sig")
        blinded = blind_candidate(normal)
        evidence_md = render_evidence(info["evidence"])
        case_dir = contexts_root / case_id
        case_dir.mkdir(parents=True, exist_ok=True)
        candidate_dir = candidates_root / case_id
        candidate_dir.mkdir(parents=True, exist_ok=True)
        (candidate_dir / "system.md").write_text(blinded, encoding="utf-8")
        (case_dir / "A.md").write_text(f"# 研究问题\n\n{question}\n", encoding="utf-8")
        (case_dir / "B.md").write_text(f"# 研究问题\n\n{question}\n\n{evidence_md}", encoding="utf-8")
        (case_dir / "C.pending").write_text("same-evidence direct report is generated during run\n", encoding="utf-8")
        (case_dir / "D.md").write_text(f"# 研究问题\n\n{question}\n\n{blinded}", encoding="utf-8")
        (case_dir / "E.md").write_text(f"# 研究问题\n\n{question}\n\n{blinded}\n\n{evidence_md}", encoding="utf-8")
        case_defects = [item for item in defects if item["base_case"] == case_id]
        for defect in case_defects:
            mutated = blind_candidate(apply_defect(normal, defect))
            path = variants_root / case_id / f"{defect['defect_id']}.md"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(mutated, encoding="utf-8")
        case_hash = stable_hash(
            {
                "case": case,
                "evidence": info["evidence"],
                "artifact_hash": sha256_text(normal),
            }
        )
        manifest_cases.append(
            {
                "case_id": case_id,
                "stratum": case["stratum"],
                "case_path": str(info["case_path"].relative_to(REPO_ROOT)),
                "case_hash": case_hash,
                "system_artifact_hash": sha256_text(normal),
                "system_artifact_length": len(blinded),
                "defect_variants": [item["defect_id"] for item in case_defects],
            }
        )
        (baselines_root / case_id).mkdir(parents=True, exist_ok=True)

    dump_yaml(
        run_dir / "manifest.yaml",
        {
            "document_type": "research_value_eval_run_manifest",
            "schema_version": "1.0.0",
            "suite": str(Path(args.suite).resolve()),
            "prepared_at": now_iso(),
            "sealed_material_copied_to_contexts": False,
            "cases": manifest_cases,
        },
    )
    dump_yaml(
        run_dir / "request_plan.yaml",
        {
            "stages": [
                "calibration",
                "perturbation",
                "C_release_gate",
                "baseline_generation",
                "claim_extraction",
                "multi_role_review",
                "arbiter",
                "downstream_tasks",
                "independent_downstream_scoring",
                "pairwise",
            ],
            "judge_models": 2,
            "repetitions": 3,
            "resume_key": "request_id",
        },
    )
    print(f"EVAL_PREPARED: {run_dir}")
    return 0


class RunOrchestrator:
    def __init__(self, run_dir: Path, profiles_path: Path, suite_path: Path):
        self.run_dir = run_dir
        self.registry = validate_profiles(profiles_path)
        self.cases = validate_suite(suite_path)
        self.case_map = {item["case"]["case_id"]: item for item in self.cases}
        self.manifest = load_yaml(run_dir / "manifest.yaml")
        self.hashes = {item["case_id"]: item["case_hash"] for item in self.manifest["cases"]}
        self.request_log = run_dir / "requests.jsonl"
        self.response_log = run_dir / "responses.jsonl"
        self.existing = {item["request_id"]: item for item in read_jsonl(self.response_log)}
        self.sessions: dict[str, AdapterSession] = {}
        for name, profile in self.registry["profiles"].items():
            self.sessions[name] = AdapterSession(
                command=[str(part) for part in profile["command"]],
                model_id=str(profile["model_id"]),
                timeout_seconds=30.0,
                max_retries=2,
            )
        self.errors = 0
        self.calibration_blocked = False

    def call(
        self,
        role: str,
        profile_name: str,
        case_id: str,
        payload: dict[str, Any],
        *,
        seed: int,
        suffix: str,
        extra_meta: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        profile = self.registry["profiles"][profile_name]
        prompt_variant = PROMPT_VARIANTS.get(seed, "A")
        bindings = self.registry["role_bindings"]
        for balanced_group in (list(bindings["judges"]), list(bindings["downstream_models"])):
            if profile_name in balanced_group and balanced_group.index(profile_name) % 2 == 1:
                prompt_variant = "B" if prompt_variant == "A" else "A"
        request = make_request(
            role=role,
            profile_name=profile_name,
            profile=profile,
            case_id=case_id,
            payload=payload,
            seed=seed,
            prompt_variant=prompt_variant,
            request_suffix=suffix,
            case_hash=self.hashes.get(case_id, stable_hash(case_id)),
        )
        if extra_meta:
            request["metadata"].update(extra_meta)
        response = execute_request(
            request,
            self.sessions[profile_name],
            self.request_log,
            self.response_log,
            self.existing,
        )
        if response.get("status") != "ok":
            self.errors += 1
        return response

    def run(self, stage: str = "all") -> None:
        bindings = self.registry["role_bindings"]
        producer = bindings["producer"]
        judges = list(bindings["judges"])
        downstream_models = list(bindings["downstream_models"])
        defects = load_yaml(DEFECTS_PATH)["items"]

        # Calibration is a release gate and therefore always runs before formal R/U/delta work.
        for info in self.cases:
            case = info["case"]
            case_id = case["case_id"]
            question = case["task_input"]["question"]
            system_text = (self.run_dir / "candidates" / case_id / "system.md").read_text(encoding="utf-8")
            for perturbation in info["perturbations"]["items"]:
                for judge in judges:
                    for seed in SEEDS:
                        self.call(
                            "perturbation",
                            judge,
                            case_id,
                            {
                                "question": question,
                                "original_artifact": system_text,
                                "evidence": info["evidence"]["evidence"],
                                "perturbation": {
                                    key: value
                                    for key, value in perturbation.items()
                                    if key != "expected_action"
                                },
                            },
                            seed=seed,
                            suffix=f"perturb-{perturbation['perturbation_id']}-{judge}-{seed}",
                            extra_meta={
                                "perturbation_id": perturbation["perturbation_id"],
                                "expected_action": perturbation["expected_action"],
                            },
                        )

        for defect in defects:
            case_id = defect["base_case"]
            normal = (self.run_dir / "candidates" / case_id / "system.md").read_text(encoding="utf-8")
            variant = (self.run_dir / "defect_variants" / case_id / f"{defect['defect_id']}.md").read_text(
                encoding="utf-8"
            )
            for judge in judges:
                for seed in SEEDS:
                    order = ["normal", "variant"] if seed != 22 else ["variant", "normal"]
                    candidates = {
                        "candidate_1": normal if order[0] == "normal" else variant,
                        "candidate_2": normal if order[1] == "normal" else variant,
                    }
                    self.call(
                        "calibration",
                        judge,
                        case_id,
                        {
                            "possible_categories": [item["defect_type"] for item in defects],
                            "possible_locations": sorted({item["expected_location"] for item in defects}),
                            "possible_severities": ["critical", "major"],
                            **candidates,
                        },
                        seed=seed,
                        suffix=f"calibration-{defect['defect_id']}-{judge}-{seed}",
                        extra_meta={
                            "defect_id": defect["defect_id"],
                            "defect_type": defect["defect_type"],
                            "severity": defect["severity"],
                            "expected_location": defect["expected_location"],
                            "candidate_order": order,
                        },
                    )
        for info in self.cases:
            case_id = info["case"]["case_id"]
            normal = (self.run_dir / "candidates" / case_id / "system.md").read_text(encoding="utf-8")
            for judge in judges:
                for seed in SEEDS:
                    self.call(
                        "calibration_clean",
                        judge,
                        case_id,
                        {"candidate": normal},
                        seed=seed,
                        suffix=f"calibration-clean-{judge}-{seed}",
                    )

        calibration = compute_calibration(
            [row for row in self.existing.values() if row.get("status") == "ok"]
        )
        dump_yaml(self.run_dir / "calibration_summary.yaml", calibration)
        if C_ORDER[calibration["grade"]] < C_ORDER["C2"] or not calibration["all_judges_eligible"]:
            self.calibration_blocked = True
            close_sessions(self.sessions)
            self._write_status("calibration_failed", stage)
            return
        if stage == "calibration":
            close_sessions(self.sessions)
            self._write_status("calibration_passed", stage)
            return

        for info in self.cases:
            case = info["case"]
            case_id = case["case_id"]
            question = case["task_input"]["question"]
            evidence_md = render_evidence(info["evidence"])
            system_text = (self.run_dir / "candidates" / case_id / "system.md").read_text(encoding="utf-8")
            target_length = len(system_text)

            question_only = self.call(
                "question_only_generator",
                producer,
                case_id,
                {"question": question, "target_length": target_length},
                seed=11,
                suffix="question-only",
            ).get("result", {}).get("artifact_text", "")
            same_evidence_direct = self.call(
                "same_evidence_direct_generator",
                producer,
                case_id,
                {"question": question, "evidence": evidence_md, "target_length": target_length},
                seed=11,
                suffix="same-evidence-direct",
            ).get("result", {}).get("artifact_text", "")
            summary = self.call(
                "evidence_summary_generator",
                producer,
                case_id,
                {"question": question, "evidence": evidence_md, "target_length": target_length},
                seed=11,
                suffix="evidence-summary",
            ).get("result", {}).get("artifact_text", "")
            question_only_blind = blind_candidate(question_only)
            same_evidence_blind = blind_candidate(same_evidence_direct)
            summary_blind = blind_candidate(summary)
            lower, upper = target_length * 0.85, target_length * 1.15
            for baseline_name, baseline_text in {
                "question_only": question_only_blind,
                "same_evidence_direct": same_evidence_blind,
                "evidence_summary": summary_blind,
            }.items():
                if not lower <= len(baseline_text) <= upper:
                    raise EvalError(
                        f"{case_id} {baseline_name} 长度{len(baseline_text)}不在系统稿±15%区间"
                    )
            baseline_dir = self.run_dir / "baselines" / case_id
            baseline_dir.mkdir(parents=True, exist_ok=True)
            (baseline_dir / "question_only.md").write_text(question_only_blind, encoding="utf-8")
            (baseline_dir / "same_evidence_direct.md").write_text(same_evidence_blind, encoding="utf-8")
            (baseline_dir / "evidence_summary.md").write_text(summary_blind, encoding="utf-8")
            (self.run_dir / "contexts" / case_id / "C.md").write_text(
                f"# 研究问题\n\n{question}\n\n{same_evidence_blind}", encoding="utf-8"
            )

            extractor_results = []
            for judge in judges:
                response = self.call(
                    "claim_extractor",
                    judge,
                    case_id,
                    {"question": question, "blinded_artifact": system_text},
                    seed=11,
                    suffix=f"extract-{judge}",
                )
                extractor_results.append(response.get("result", {}))
            reconcile = self.call(
                "claim_reconciler",
                judges[0],
                case_id,
                {
                    "question": question,
                    "extractor_results": extractor_results,
                    "blinded_artifact": system_text,
                    "sealed_claim_contract": info["adjudication"]["core_claims"],
                },
                seed=22,
                suffix="reconcile",
            )
            claims = reconcile.get("result", {}).get("claims") or []
            if not 3 <= len(claims) <= 7:
                raise EvalError(f"{case_id} 协调后核心判断不是3—7条")
            reasoning_materials = read_reasoning_materials(case)
            for claim_index, claim in enumerate(claims, 1):
                claim_id = str(claim.get("claim_id") or f"{case_id}-CLAIM-{claim_index}")
                criticality = str(claim.get("criticality") or "primary")
                for judge in judges:
                    for seed in SEEDS:
                        common_meta = {"claim_id": claim_id, "criticality": criticality}
                        evidence_review = self.call(
                            "evidence_reviewer",
                            judge,
                            case_id,
                            {"claim": claim, "evidence": info["evidence"]["evidence"]},
                            seed=seed,
                            suffix=f"evidence-{claim_id}-{judge}-{seed}",
                            extra_meta=common_meta,
                        ).get("result", {})
                        reasoning_review = self.call(
                            "reasoning_reviewer",
                            judge,
                            case_id,
                            {"claim": claim, "reasoning_materials": reasoning_materials, "final_artifact": system_text},
                            seed=seed,
                            suffix=f"reasoning-{claim_id}-{judge}-{seed}",
                            extra_meta=common_meta,
                        ).get("result", {})
                        adversarial_review = self.call(
                            "adversarial_reviewer",
                            judge,
                            case_id,
                            {"claim": claim, "evidence": info["evidence"]["evidence"]},
                            seed=seed,
                            suffix=f"adversarial-{claim_id}-{judge}-{seed}",
                            extra_meta=common_meta,
                        ).get("result", {})
                        self.call(
                            "arbiter",
                            judge,
                            case_id,
                            {
                                "claim": {"claim_id": claim_id, "statement": claim.get("statement")},
                                "evidence_review": evidence_review,
                                "reasoning_review": reasoning_review,
                                "adversarial_review": adversarial_review,
                                "arbiter_must_not_add_arguments": True,
                            },
                            seed=seed,
                            suffix=f"arbiter-{claim_id}-{judge}-{seed}",
                            extra_meta=common_meta,
                        )

            case_contexts = {
                context: (self.run_dir / "contexts" / case_id / f"{context}.md").read_text(encoding="utf-8")
                for context in ["A", "B", "C", "D", "E"]
            }
            for downstream in downstream_models:
                for seed in SEEDS:
                    for context_id, context_text in case_contexts.items():
                        for task_id in DOWNSTREAM_TASKS:
                            task_payload = {
                                "question": question,
                                "context": context_text,
                                "task_id": task_id,
                            }
                            if task_id == "information_update":
                                task_payload["new_information_scenario"] = info["adjudication"]["update_scenarios"][0]
                            task_response = self.call(
                                f"downstream_{task_id}",
                                downstream,
                                case_id,
                                task_payload,
                                seed=seed,
                                suffix=f"downstream-{downstream}-{seed}-{context_id}-{task_id}",
                                extra_meta={"context_id": context_id, "task_id": task_id},
                            )
                            scorer = judges[downstream_models.index(downstream)]
                            self.call(
                                "downstream_scorer",
                                scorer,
                                case_id,
                                {
                                    "question": question,
                                    "task_id": task_id,
                                    "task_output": task_response.get("result", {}),
                                    "required_units": info["adjudication"]["downstream_required_units"].get(task_id, []),
                                    "update_scenarios": info["adjudication"]["update_scenarios"],
                                    "claim_contract": info["adjudication"]["core_claims"],
                                    "frozen_evidence": info["evidence"]["evidence"],
                                    "threshold": U_THRESHOLDS[task_id],
                                },
                                seed=seed,
                                suffix=f"downstream-score-{downstream}-{seed}-{context_id}-{task_id}",
                                extra_meta={
                                    "context_id": context_id,
                                    "task_id": task_id,
                                    "downstream_profile": downstream,
                                },
                            )

            comparisons = {
                "same_evidence_direct": same_evidence_blind,
                "evidence_summary": summary_blind,
            }
            order_schedule = [
                ["D", "baseline"],
                ["baseline", "D"],
                ["D", "baseline"],
                ["baseline", "D"],
                ["D", "baseline"],
                ["baseline", "D"],
            ]
            for baseline_name, baseline_text in comparisons.items():
                index = 0
                for judge in judges:
                    for seed in SEEDS:
                        order = order_schedule[index]
                        candidates = {
                            "candidate_1": system_text if order[0] == "D" else baseline_text,
                            "candidate_2": system_text if order[1] == "D" else baseline_text,
                        }
                        self.call(
                            "pairwise",
                            judge,
                            case_id,
                            {"question": question, **candidates},
                            seed=seed,
                            suffix=f"pairwise-{baseline_name}-{judge}-{seed}",
                            extra_meta={"baseline": baseline_name, "candidate_order": order},
                        )
                        index += 1

        close_sessions(self.sessions)
        self._write_status("completed" if self.errors == 0 else "completed_with_errors", stage)

    def _write_status(self, status: str, stage: str) -> None:
        dump_yaml(
            self.run_dir / "run_status.yaml",
            {
                "completed_at": now_iso(),
                "status": status,
                "stage": stage,
                "error_responses": self.errors,
                "unique_requests": len(self.existing),
                "run_mode": self.registry["run_mode"],
                "profiles": {
                    name: {"model_id": value["model_id"], "provider_family": value["provider_family"]}
                    for name, value in self.registry["profiles"].items()
                },
            },
        )


def command_run(args: argparse.Namespace) -> int:
    run_dir = Path(args.run_dir).resolve()
    if not (run_dir / "manifest.yaml").is_file():
        raise EvalError("run前必须先prepare")
    orchestrator = RunOrchestrator(run_dir, Path(args.profiles), Path(args.suite))
    try:
        orchestrator.run(stage=args.stage)
    finally:
        close_sessions(orchestrator.sessions)
    if orchestrator.calibration_blocked:
        print(
            f"EVAL_CALIBRATION_BLOCKED: requests={len(orchestrator.existing)} errors={orchestrator.errors}",
            file=sys.stderr,
        )
        return 3
    print(
        f"EVAL_RUN_COMPLETE: stage={args.stage} requests={len(orchestrator.existing)} errors={orchestrator.errors}"
    )
    return 0 if orchestrator.errors == 0 else 2


def normalized_pairwise_winner(row: dict[str, Any]) -> str:
    winner = row.get("result", {}).get("winner")
    if winner == "tie":
        return "tie"
    order = row.get("request_metadata", {}).get("candidate_order") or []
    if winner == "candidate_1" and len(order) == 2:
        return order[0]
    if winner == "candidate_2" and len(order) == 2:
        return order[1]
    return "invalid"


def safe_mean(values: list[float]) -> float:
    return statistics.fmean(values) if values else 0.0


def _calibration_metrics(rows: list[dict[str, Any]]) -> dict[str, Any]:
    defect_rows = [row for row in rows if row.get("request_metadata", {}).get("role") == "calibration"]
    clean_rows = [row for row in rows if row.get("request_metadata", {}).get("role") == "calibration_clean"]
    perturb_rows = [row for row in rows if row.get("request_metadata", {}).get("role") == "perturbation"]
    severe = [row for row in defect_rows if row.get("request_metadata", {}).get("severity") == "critical"]
    recall = safe_mean(
        [
            bool(row.get("result", {}).get("defect_detected"))
            and row.get("result", {}).get("detected_category")
            == row.get("request_metadata", {}).get("defect_type")
            for row in severe
        ]
    )
    false_kill = safe_mean([bool(row.get("result", {}).get("false_kill")) for row in clean_rows])
    ranking = safe_mean([bool(row.get("result", {}).get("normal_ranked_higher")) for row in defect_rows])
    location = safe_mean(
        [
            row.get("result", {}).get("located_at")
            == row.get("request_metadata", {}).get("expected_location")
            for row in defect_rows
        ]
    )
    severity = safe_mean(
        [
            row.get("result", {}).get("detected_severity")
            == row.get("request_metadata", {}).get("severity")
            for row in defect_rows
        ]
    )
    sensitivity = safe_mean(
        [
            row.get("result", {}).get("action")
            == row.get("request_metadata", {}).get("expected_action")
            for row in perturb_rows
        ]
    )
    grouped_judgments: dict[str, list[tuple[Any, ...]]] = defaultdict(list)
    for row in defect_rows:
        meta = row.get("request_metadata", {})
        result = row.get("result", {})
        grouped_judgments[str(meta.get("defect_id"))].append(
            (
                result.get("defect_detected"),
                result.get("detected_category"),
                result.get("located_at"),
                result.get("detected_severity"),
                result.get("normal_ranked_higher"),
            )
        )
    consistency = safe_mean([agreement_rate(values) for values in grouped_judgments.values()])
    grade = grade_c(recall, false_kill, ranking, location, sensitivity, severity, consistency)
    return {
        "grade": grade,
        "severe_defect_recall": round(recall, 4),
        "clean_false_kill_rate": round(false_kill, 4),
        "ranking_accuracy": round(ranking, 4),
        "location_accuracy": round(location, 4),
        "severity_accuracy": round(severity, 4),
        "judgment_consistency": round(consistency, 4),
        "perturbation_sensitivity_rate": round(sensitivity, 4),
        "defect_judgments": len(defect_rows),
        "clean_judgments": len(clean_rows),
    }


def compute_calibration(rows: list[dict[str, Any]]) -> dict[str, Any]:
    metrics = _calibration_metrics(rows)
    calibration_roles = {"calibration", "calibration_clean", "perturbation"}
    profile_names = sorted(
        {
            str(row.get("request_metadata", {}).get("profile_name"))
            for row in rows
            if row.get("request_metadata", {}).get("role") in calibration_roles
            and row.get("request_metadata", {}).get("profile_name")
        }
    )
    per_model = {
        profile_name: _calibration_metrics(
            [
                row
                for row in rows
                if row.get("request_metadata", {}).get("profile_name") == profile_name
            ]
        )
        for profile_name in profile_names
    }
    eligible = [
        profile_name
        for profile_name, item in per_model.items()
        if C_ORDER[item["grade"]] >= C_ORDER["C2"]
    ]
    metrics["per_model"] = per_model
    metrics["eligible_judge_profiles"] = eligible
    metrics["all_judges_eligible"] = len(per_model) == 2 and len(eligible) == 2
    return metrics


def compute_case_summary(case_id: str, info: dict[str, Any], rows: list[dict[str, Any]], calibration: dict[str, Any]) -> dict[str, Any]:
    case_rows = [row for row in rows if row.get("request_metadata", {}).get("case_id") == case_id]
    arbiter_rows = [row for row in case_rows if row.get("request_metadata", {}).get("role") == "arbiter"]
    per_run_claims: dict[tuple[str, int], list[int]] = defaultdict(list)
    arbiter_notes: list[dict[str, Any]] = []
    for row in arbiter_rows:
        meta = row["request_metadata"]
        if meta.get("criticality") != "primary":
            continue
        result = row.get("result", {})
        level = result.get("claim_r")
        if level not in R_ORDER:
            continue
        per_run_claims[(meta["profile_name"], int(meta["seed"]))].append(
            apply_r_hard_gate(level, result.get("hard_failures") or [])
        )
        arbiter_notes.append(result)
    case_levels = [min(values) for values in per_run_claims.values() if values]
    if len(case_levels) != 6:
        raise EvalError(f"{case_id} 有效案例裁决应为6次，实际{len(case_levels)}")
    r_value = conservative_median(case_levels)
    successes = sum(level >= 2 for level in case_levels)
    support_rate = {
        "estimate": round(successes / len(case_levels), 4),
        "successes": successes,
        "trials": len(case_levels),
        "label": "裁决支持频率/R通过频率，不是可靠概率",
        "note": "六次裁决针对同一产物与同一证据包，主要反映评测器一致支持程度，与稳定性S存在重叠。",
    }
    if C_ORDER[calibration["grade"]] < C_ORDER["C2"] or not calibration["all_judges_eligible"]:
        support_rate = None

    downstream_rows = [
        row for row in case_rows if row.get("request_metadata", {}).get("role") == "downstream_scorer"
    ]
    scores: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    errors: dict[str, list[float]] = defaultdict(list)
    error_categories: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    critical_d = False
    per_task_passes: dict[str, list[bool]] = defaultdict(list)
    for row in downstream_rows:
        meta = row["request_metadata"]
        result = row.get("result", {})
        context = meta.get("context_id")
        task = meta.get("task_id")
        if context not in {"A", "B", "C", "D", "E"} or task not in U_THRESHOLDS:
            continue
        score = float(result.get("score", 0.0))
        misread_rate = float(result.get("misread_rate", 0.0))
        scores[context][task].append(score)
        errors[context].append(float(result.get("error_count", 0.0)))
        for category in ["fact", "reasoning", "extrapolation"]:
            error_categories[context][category].append(
                float((result.get("error_counts") or {}).get(category, result.get("error_count", 0.0)))
            )
        if context == "D":
            critical_d = critical_d or bool(result.get("critical_error")) or (
                task == "core_restatement" and misread_rate >= 0.10
            )
            per_task_passes[task].append(
                score >= U_THRESHOLDS[task]
                and (task != "core_restatement" or misread_rate < 0.10)
            )
    context_task_means = {
        context: {task: round(safe_mean(values), 4) for task, values in task_map.items()}
        for context, task_map in scores.items()
    }
    d_scores = context_task_means.get("D", {})
    u_grade = grade_u(d_scores, critical_d)
    context_means = {
        context: round(safe_mean(list(task_map.values())), 4)
        for context, task_map in context_task_means.items()
    }
    task_delta_pp = {
        "A_question_only": round((context_means.get("D", 0.0) - context_means.get("A", 0.0)) * 100, 2),
        "B_raw_evidence": round((context_means.get("D", 0.0) - context_means.get("B", 0.0)) * 100, 2),
        "C_same_evidence_direct": round((context_means.get("D", 0.0) - context_means.get("C", 0.0)) * 100, 2),
    }
    error_means = {context: safe_mean(values) for context, values in errors.items()}
    error_reduction: dict[str, dict[str, float]] = {}
    # 主对比：同证据直接生成对应上下文C。摘要稿当前以盲评为主，错误降低相对原始材料B仅作诊断。
    for baseline_key, context_id in [
        ("same_evidence_direct", "C"),
        ("raw_evidence_diagnostic", "B"),
    ]:
        base = error_means.get(context_id, 0.0)
        current = error_means.get("D", 0.0)
        error_reduction[baseline_key] = {
            "total": round((base - current) / base, 4) if base > 0 else 0.0,
            "compared_context": context_id,
        }
        for category in ["fact", "reasoning", "extrapolation"]:
            base_category = safe_mean(error_categories[context_id][category])
            current_category = safe_mean(error_categories["D"][category])
            error_reduction[baseline_key][category] = (
                round((base_category - current_category) / base_category, 4)
                if base_category > 0
                else 0.0
            )

    pairwise_rows = [row for row in case_rows if row.get("request_metadata", {}).get("role") == "pairwise"]
    pairwise: dict[str, Any] = {}
    order_effect_gaps: list[float] = []
    for baseline in PRIMARY_PAIRWISE_BASELINES:
        selected_rows = [
            row
            for row in pairwise_rows
            if row.get("request_metadata", {}).get("baseline") == baseline
        ]
        votes = [normalized_pairwise_winner(row) for row in selected_rows]
        votes = [vote for vote in votes if vote != "invalid"]
        d_wins = votes.count("D") + 0.5 * votes.count("tie")
        interval = wilson_interval(d_wins, len(votes))
        pairwise[baseline] = {
            "D_win_rate": round(d_wins / len(votes), 4) if votes else 0.0,
            "wilson_90": [round(interval[0], 4), round(interval[1], 4)],
            "votes": dict(Counter(votes)),
        }
        position_scores: dict[str, list[float]] = {"D_first": [], "D_second": []}
        for row in selected_rows:
            vote = normalized_pairwise_winner(row)
            if vote == "invalid":
                continue
            order = row.get("request_metadata", {}).get("candidate_order") or []
            position = "D_first" if order and order[0] == "D" else "D_second"
            position_scores[position].append(1.0 if vote == "D" else 0.5 if vote == "tie" else 0.0)
        order_effect_gaps.append(
            abs(safe_mean(position_scores["D_first"]) - safe_mean(position_scores["D_second"]))
        )

    r_exact = agreement_rate(case_levels)
    downstream_agreement = safe_mean([agreement_rate(values) for values in per_task_passes.values()])
    flip_rate = safe_mean(order_effect_gaps) if order_effect_gaps else 1.0
    r_span = max(case_levels) - min(case_levels)
    s_grade = grade_s(r_exact, downstream_agreement, flip_rate, r_span)
    weakest = Counter(note.get("weakest_claim", "") for note in arbiter_notes).most_common(1)
    counter = Counter(note.get("strongest_counterevidence", "") for note in arbiter_notes).most_common(1)
    disagreement = Counter(note.get("major_disagreement", "") for note in arbiter_notes).most_common(1)
    hard_failures = sorted(
        {
            str(failure)
            for note in arbiter_notes
            for failure in (note.get("hard_failures") or [])
            if str(failure).strip()
        }
    )
    sealed_mode = info["adjudication"].get("provenance", {}).get("independence_mode")
    delta_gates = {
        "same_evidence_direct_win_rate_at_least_55pct": pairwise["same_evidence_direct"]["D_win_rate"] >= 0.55,
        "evidence_summary_win_rate_at_least_55pct": pairwise["evidence_summary"]["D_win_rate"] >= 0.55,
        "task_gain_vs_same_evidence_direct_positive": task_delta_pp["C_same_evidence_direct"] > 0,
        "errors_not_increased_vs_primary_baselines": error_reduction["same_evidence_direct"]["total"] >= 0,
        "threshold_status": U_THRESHOLD_STATUS,
    }

    return {
        "stratum": info["case"]["stratum"],
        "R": f"R{r_value}",
        "adjudication_support_rate": support_rate,
        "U": u_grade,
        "delta": {
            "task_score_pp": task_delta_pp,
            "error_reduction_rate": error_reduction,
            "pairwise": pairwise,
            "provisional_gates": delta_gates,
            "weak_baseline_note": "问题直答仅作弱基线，不得作为复杂流程价值的主证据",
        },
        "S": s_grade,
        "C": calibration["grade"],
        "diagnostics": {
            "R_run_levels": [f"R{value}" for value in case_levels],
            "R_exact_agreement": round(r_exact, 4),
            "downstream_pass_agreement": round(downstream_agreement, 4),
            "pairwise_flip_rate": round(flip_rate, 4),
            "task_scores_by_context": context_task_means,
            "weakest_core_judgment": weakest[0][0] if weakest else "",
            "strongest_counterevidence": counter[0][0] if counter else "",
            "major_disagreement": disagreement[0][0] if disagreement else "",
            "hard_failures": hard_failures,
            "sealed_independence_mode": sealed_mode,
            "u_threshold_status": U_THRESHOLD_STATUS,
            "applicability": "冻结证据边界内的四题校准试点，不代表未知任务泛化能力，不得写成系统研究可靠率",
        },
    }


def command_aggregate(args: argparse.Namespace) -> int:
    run_dir = Path(args.run_dir).resolve()
    status = load_yaml(run_dir / "run_status.yaml")
    if status.get("status") != "completed":
        raise EvalError(f"只有无执行错误的完整run可聚合，当前状态为{status.get('status')}")
    rows = [row for row in read_jsonl(run_dir / "responses.jsonl") if row.get("status") == "ok"]
    cases = validate_suite(Path(args.suite))
    calibration = compute_calibration(rows)
    summaries = {
        info["case"]["case_id"]: compute_case_summary(info["case"]["case_id"], info, rows, calibration)
        for info in cases
    }
    strata: dict[str, Any] = {}
    for stratum in ["report_value", "restraint"]:
        selected = [value for value in summaries.values() if value["stratum"] == stratum]
        r2_plus = sum(1 for item in selected if R_ORDER.get(item["R"], -1) >= 2)
        proxy_rate = {
            "estimate": round(r2_plus / len(selected), 4) if selected else 0.0,
            "numerator": r2_plus,
            "denominator": len(selected),
            "label": "案例集层代理可靠率（分层内最终R≥R2的案例比例）",
            "interval_reported": False,
            "note": "四题试点仅报告比例与分布；案例数达到约20—30且具备差异性后，才适合报告区间。",
        }
        strata[stratum] = {
            "case_count": len(selected),
            "R_distribution": dict(Counter(item["R"] for item in selected)),
            "U_distribution": dict(Counter(item["U"] for item in selected)),
            "proxy_reliability_rate": proxy_rate,
            "same_evidence_direct_win_rate_mean": round(
                safe_mean(
                    [
                        item["delta"]["pairwise"]["same_evidence_direct"]["D_win_rate"]
                        for item in selected
                    ]
                ),
                4,
            ),
            "evidence_summary_win_rate_mean": round(
                safe_mean(
                    [item["delta"]["pairwise"]["evidence_summary"]["D_win_rate"] for item in selected]
                ),
                4,
            ),
        }
    release_allowed = C_ORDER[calibration["grade"]] >= C_ORDER["C2"] and calibration["all_judges_eligible"]
    result = {
        "document_type": "research_value_eval_summary",
        "schema_version": "2.1.0",
        "suite_id": load_yaml(Path(args.suite))["suite_id"],
        "generated_at": now_iso(),
        "run_mode": status.get("run_mode"),
        "run_status": status.get("status"),
        "no_composite_score": True,
        "suite_proxy_rate_release_allowed": release_allowed,
        "calibration": calibration,
        "expert_review": {
            "status": load_yaml(Path(args.suite))["future_expert_review"]["current_status"],
            "required_for_pilot": False,
            "target_sample_rate": [0.05, 0.10],
        },
        "cases": summaries,
        "strata": strata,
        "limitations": [
            "案例级只报告裁决支持频率，不得写成可靠概率；六次裁决不是独立案例样本。",
            "流程价值主证据是相对同证据直接生成稿与同证据摘要稿的增益，不是相对无证据问题直答。",
            "当前四题密封契约为pilot_manual，只能验证流程与内部一致性，不能单独证明研究质量。",
            "四题为校准试点，report_value与restraint不得混报为泛化通过率或系统研究可靠率。",
            "U/C阈值均为pilot_threshold，不得把0.79/0.80解释为经验验证后的硬分界。",
            "mock运行只验证框架，不代表真实模型或研究方法表现。" if status.get("run_mode") == "development" else "",
        ],
    }
    result["limitations"] = [item for item in result["limitations"] if item]
    dump_yaml(run_dir / "summary.yaml", result)
    dump_json(run_dir / "summary.json", result)
    print(f"EVAL_AGGREGATED: C={calibration['grade']} cases={len(summaries)}")
    return 0


def percent(value: float) -> str:
    return f"{value * 100:.1f}%"


STRATUM_LABELS = {
    "report_value": "正式报告",
    "restraint": "正确停止",
}

R_PLAIN = {
    "R0": "核心判断站不住（硬错误或证据严重不足）",
    "R1": "只能当作待验证假设，尚不足以支撑正式结论",
    "R2": "方向成立，但量化、范围、独立来源或反证仍有缺口",
    "R3": "核心判断在冻结证据边界内站得住，表达未越级",
}

U_PLAIN = {
    "U0": "下游几乎用不了，或出现致命误读",
    "U1": "少数下游任务可用",
    "U2": "多数下游任务可用，仍有短板",
    "U3": "复述、跟踪、更新、调研四项都能接得住",
}


def _case_verdict_line(case_id: str, item: dict[str, Any]) -> str:
    r = item.get("R", "?")
    u = item.get("U", "?")
    hard = item.get("diagnostics", {}).get("hard_failures") or []
    if hard:
        return f"**{case_id}：不可直接采信。** 可靠性 {r}，有用性 {u}；存在硬错误。"
    if r in {"R2", "R3"} and u in {"U2", "U3"}:
        return f"**{case_id}：可作研究输入，但须带着边界使用。** 可靠性 {r}，有用性 {u}。"
    if r in {"R2", "R3"}:
        return f"**{case_id}：判断方向大体站得住，但下游可用性不足。** 可靠性 {r}，有用性 {u}。"
    return f"**{case_id}：暂不宜当作已成立结论。** 可靠性 {r}，有用性 {u}。"


def command_report(args: argparse.Namespace) -> int:
    run_dir = Path(args.run_dir).resolve()
    summary = load_yaml(run_dir / "summary.yaml")
    calibration = summary["calibration"]
    lines = [
        "# 研究价值评测报告",
        "",
        "## 怎么读这份报告",
        "",
        "这份报告回答三件事：系统产物的核心判断在冻结证据内站不站得住（R）、",
        "下游研究能不能接着用（U）、相对「同证据直接生成」有没有增益（delta）。",
        "R、U、delta 分项给出，不合成单一总分，也不给出「研究可靠概率」。",
        "",
        f"- 评测可信度（评测器校准）：**{calibration['grade']}**"
        + ("；达到进入正式结论的门槛" if C_ORDER[calibration["grade"]] >= C_ORDER["C2"] else "；未达门槛，下文正式结论应谨慎使用"),
        f"- 运行模式：`{summary['run_mode']}`",
        f"- 专家盲审：`{summary['expert_review']['status']}`",
        "",
        "## 总览",
        "",
    ]
    for case_id, item in summary["cases"].items():
        lines.append(f"- {_case_verdict_line(case_id, item)}")
    lines.append("")

    for stratum, item in (summary.get("strata") or {}).items():
        proxy = item.get("proxy_reliability_rate") or {}
        label = STRATUM_LABELS.get(stratum, stratum)
        lines.extend(
            [
                f"## 分层一览 · {label}",
                "",
                f"- 本层案例数：{item.get('case_count', 0)}",
                f"- 可靠性分布：{item.get('R_distribution')}",
                f"- 有用性分布：{item.get('U_distribution')}",
            ]
        )
        if summary.get("suite_proxy_rate_release_allowed"):
            lines.append(
                f"- 本层达到 R2 及以上的案例比例：{percent(proxy.get('estimate', 0.0))} "
                f"（{proxy.get('numerator', 0)}/{proxy.get('denominator', 0)}）。"
                "这是案例集层通过比例，不是系统研究可靠率。"
            )
        else:
            lines.append("- 本层通过比例因评测可信度不足而未发布。")
        lines.extend(
            [
                (
                    f"- 相对同证据直接生成稿的盲评胜率均值：{percent(item.get('same_evidence_direct_win_rate_mean', 0.0))}；"
                    f"相对摘要稿：{percent(item.get('evidence_summary_win_rate_mean', 0.0))}"
                ),
                "",
            ]
        )

    for case_id, item in summary["cases"].items():
        stratum_label = STRATUM_LABELS.get(item["stratum"], item["stratum"])
        r = item["R"]
        u = item["U"]
        diag = item.get("diagnostics") or {}
        hard = diag.get("hard_failures") or []
        lines.extend(
            [
                f"## {case_id}（{stratum_label}）",
                "",
                _case_verdict_line(case_id, item),
                "",
                "### 1. 判断站不站得住（可靠性 R）",
                "",
                f"- 等级：**{r}** — {R_PLAIN.get(r, '')}",
            ]
        )
        support = item.get("adjudication_support_rate")
        if support:
            lines.append(
                f"- 裁决支持频率：{percent(support['estimate'])} "
                f"（{support['successes']}/{support['trials']}）。"
                "表示多次独立裁决中有多少次给出 R2 及以上；不是该结论在现实中正确的概率。"
            )
        else:
            lines.append("- 裁决支持频率：因评测器校准未达 C2 而抑制，避免误读为可靠概率。")
        lines.extend(
            [
                f"- 硬错误：{'；'.join(hard) if hard else '无'}",
                f"- 最弱的核心判断：{diag.get('weakest_core_judgment') or '未标注'}",
                f"- 必须盯住的最强反证：{diag.get('strongest_counterevidence') or '未标注'}",
                f"- 评测员主要分歧：{diag.get('major_disagreement') or '无'}",
                f"- 适用边界：{diag.get('applicability') or '未标注'}",
                "",
                "### 2. 下游能不能接着用（有用性 U）",
                "",
                f"- 等级：**{u}** — {U_PLAIN.get(u, '')}",
                "- 看四件事：核心判断能否被准确复述、跟踪计划是否可执行、",
                "  新信息到来时能否正确改判、调研问题能否区分竞争解释。",
                "",
                "### 3. 相对同证据直接生成有没有增益（delta）",
                "",
            ]
        )
        direct_pair = item["delta"]["pairwise"]["same_evidence_direct"]
        summary_pair = item["delta"]["pairwise"]["evidence_summary"]
        direct_low, direct_high = direct_pair["wilson_90"]
        summary_low, summary_high = summary_pair["wilson_90"]
        direct_errors = item["delta"]["error_reduction_rate"]["same_evidence_direct"]["total"]
        lines.extend(
            [
                (
                    f"- 相对同证据直接生成完整报告：下游任务增益 "
                    f"{item['delta']['task_score_pp']['C_same_evidence_direct']:+.1f} 个百分点；"
                    f"错误降低 {percent(direct_errors)}；盲评胜率 {percent(direct_pair['D_win_rate'])} "
                    f"（90% Wilson 区间 {percent(direct_low)}—{percent(direct_high)}）。"
                    "这是流程价值的主对比。"
                ),
                (
                    f"- 相对同证据普通摘要稿：盲评胜率 {percent(summary_pair['D_win_rate'])} "
                    f"（90% Wilson 区间 {percent(summary_low)}—{percent(summary_high)}）。"
                ),
                (
                    f"- 相对「只看问题直答」：任务增益 "
                    f"{item['delta']['task_score_pp']['A_question_only']:+.1f} 个百分点"
                    "（弱基线，只能说明有证据比没证据好，不能证明流程有价值）。"
                ),
                "",
                "### 4. 稳不稳、评测本身靠不靠谱",
                "",
                f"- 稳定性：**{item['S']}**（换评测模型/提示/候选顺序后结论是否还一致）",
                f"- 密封裁决契约独立性：`{diag.get('sealed_independence_mode', 'unknown')}`",
                "",
            ]
        )

    lines.extend(
        [
            "## 评测器校准（这份评分本身信不信）",
            "",
            "正式结论要求评测器先通过校准门。下面是本轮校准摘要：",
            "",
            f"- 严重缺陷召回率：{percent(calibration['severe_defect_recall'])}",
            f"- 正常版错杀率：{percent(calibration['clean_false_kill_rate'])}",
            f"- 排序准确率：{percent(calibration['ranking_accuracy'])}",
            f"- 缺陷定位准确率：{percent(calibration['location_accuracy'])}",
            f"- 严重度准确率：{percent(calibration['severity_accuracy'])}",
            f"- 裁决一致率：{percent(calibration['judgment_consistency'])}",
            f"- 扰动敏感率：{percent(calibration['perturbation_sensitivity_rate'])}",
        ]
    )
    for profile_name, profile_metrics in calibration.get("per_model", {}).items():
        lines.append(
            f"- 评测模型 `{profile_name}`：{profile_metrics['grade']}；"
            f"严重缺陷召回 {percent(profile_metrics['severe_defect_recall'])}；"
            f"错杀 {percent(profile_metrics['clean_false_kill_rate'])}"
        )
    lines.extend(["", "## 使用限制", ""])
    lines.extend(f"- {item}" for item in summary["limitations"])
    lines.extend(
        [
            "- 本报告只分项呈现 R / U / delta / S / C，不合成单一总分。",
            "- 案例级「裁决支持频率」不是可靠概率；案例集层通过比例也不是系统研究可靠率。",
            "- 评测只判断冻结证据边界内是否站得住，不替代研究员对市场真实性的独立复核。",
        ]
    )
    report_path = run_dir / "report.md"
    report_path.write_text("\n".join(lines).strip() + "\n", encoding="utf-8")
    print(f"EVAL_REPORT_WRITTEN: {report_path}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="研究价值代理评测")
    parser.set_defaults(func=None)
    sub = parser.add_subparsers(dest="command")

    validate = sub.add_parser("validate")
    validate.add_argument("--suite", default=str(SUITE_PATH))
    validate.add_argument("--profiles")
    validate.add_argument("--official", action="store_true")
    validate.set_defaults(func=command_validate)

    prepare = sub.add_parser("prepare")
    prepare.add_argument("--suite", default=str(SUITE_PATH))
    prepare.add_argument("--run-dir", required=True)
    prepare.set_defaults(func=command_prepare)

    run = sub.add_parser("run")
    run.add_argument("--suite", default=str(SUITE_PATH))
    run.add_argument("--run-dir", required=True)
    run.add_argument("--profiles", required=True)
    run.add_argument("--stage", choices=["all", "calibration", "formal"], default="all")
    run.set_defaults(func=command_run)

    aggregate = sub.add_parser("aggregate")
    aggregate.add_argument("--suite", default=str(SUITE_PATH))
    aggregate.add_argument("--run-dir", required=True)
    aggregate.set_defaults(func=command_aggregate)

    report = sub.add_parser("report")
    report.add_argument("--run-dir", required=True)
    report.set_defaults(func=command_report)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not args.func:
        parser.print_help()
        return 2
    try:
        return int(args.func(args))
    except EvalError as exc:
        print(f"EVAL_FAIL: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
