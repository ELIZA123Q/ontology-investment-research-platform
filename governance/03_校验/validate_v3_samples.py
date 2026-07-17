#!/usr/bin/env python3
"""Validate Ontology 3.0 / Public Contract 1.3 example runs."""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Any

import yaml


ROOT = Path(__file__).resolve().parents[2]
SAMPLE_ROOT = ROOT / "instances/02_V3样例"
DEFAULT_RUNS = (SAMPLE_ROOT / "01_memory-cycle-run-002", SAMPLE_ROOT / "02_us-controls-localization-run-002")


def load(path: Path) -> dict[str, Any]:
    value = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path}: YAML root must be a mapping")
    return value


def _ids(items: list[dict[str, Any]], field: str) -> set[str]:
    return {str(item.get(field, "")) for item in items if isinstance(item, dict) and item.get(field)}


def validate_run_data(run: dict[str, dict[str, Any]], contract: dict[str, Any], known_rules: set[str]) -> list[str]:
    errors: list[str] = []
    manifest = run["manifest"]
    structure = run["structure"]
    evidence = run["evidence"]
    judgment = run["judgment"]
    expression = run["expression"]
    update = run["update"]
    label = str(manifest.get("run_id", "<unknown-run>"))

    versions = manifest.get("versions") or {}
    expected_versions = {"contract": "1.3.0", "ontology_meta_schema": "1.0.0", "ontology": "3.0.0", "domain_ontology": "3.0.0", "kb03": "3.2.0", "kb04": "1.0.0"}
    for key, expected in expected_versions.items():
        if str(versions.get(key)) != expected:
            errors.append(f"{label}: version {key} must be {expected}")
    if manifest.get("legacy_compatibility", {}).get("legacy_run") is not False:
        errors.append(f"{label}: V3 sample must not be marked legacy")

    required_fields = set(contract["method_application_contract"]["required_fields"])
    status_values = set(contract["method_application_contract"]["statuses"])
    candidates = structure.get("method_application_candidates") or []
    candidate_by_id = {item.get("application_id"): item for item in candidates}
    for index, item in enumerate(candidates):
        missing = sorted(required_fields - set(item))
        if missing:
            errors.append(f"{label}: candidate[{index}] missing {missing}")
        if item.get("status") != "candidate":
            errors.append(f"{label}: candidate {item.get('application_id')} must start as candidate")

    facts = _ids(evidence.get("facts") or [], "evidence_id")
    assessments = _ids(evidence.get("assessments") or [], "assessment_id")
    evidence_refs = facts | assessments
    bindings = evidence.get("method_input_bindings") or []
    for binding in bindings:
        app_id = binding.get("application_id")
        if app_id not in candidate_by_id:
            errors.append(f"{label}: 03 binding {app_id} has no 02 candidate")
        if binding.get("status") not in {"selected", "rejected", "blocked", "degraded"}:
            errors.append(f"{label}: 03 binding {app_id} has invalid status")
        for ref in binding.get("input_evidence_refs", []):
            if ref not in facts:
                errors.append(f"{label}: 03 binding {app_id} unresolved evidence {ref}")

    signals = _ids(judgment.get("signals") or [], "signal_id")
    hypotheses = _ids(judgment.get("hypotheses") or [], "hypothesis_id")
    rule_evaluations = judgment.get("rule_evaluations") or []
    rule_eval_ids = _ids(rule_evaluations, "rule_evaluation_id")
    for evaluation in rule_evaluations:
        if evaluation.get("rule_ref") not in known_rules:
            errors.append(f"{label}: unknown or non-ontology rule {evaluation.get('rule_ref')}")
        conditions = evaluation.get("condition_results") or []
        if not conditions or conditions == ["matched"]:
            errors.append(f"{label}: {evaluation.get('rule_evaluation_id')} has aggregate matched-only result")
        for condition in conditions:
            if not isinstance(condition, dict) or not {"condition_id", "expression", "input_refs", "outcome", "rationale"} <= set(condition):
                errors.append(f"{label}: {evaluation.get('rule_evaluation_id')} has incomplete condition result")

    applications = judgment.get("method_application_register") or []
    app_by_id = {item.get("application_id"): item for item in applications}
    for index, item in enumerate(applications):
        app_id = item.get("application_id")
        missing = sorted(required_fields - set(item))
        if missing:
            errors.append(f"{label}: application[{index}] missing {missing}")
        if item.get("status") not in status_values - {"candidate", "selected"}:
            errors.append(f"{label}: application {app_id} not finalized")
        candidate = candidate_by_id.get(app_id)
        if not candidate or candidate.get("method_id") != item.get("method_id"):
            errors.append(f"{label}: application {app_id} does not finalize matching 02 candidate")
        method_id = str(item.get("method_id", ""))
        expected_method_version = versions.get(method_id.split(":", 1)[0]) if ":" in method_id else None
        if str(item.get("method_version")) != str(expected_method_version):
            errors.append(f"{label}: application {app_id} method version drift")
        if item.get("status") == "executed":
            if not item.get("input_evidence_refs"):
                errors.append(f"{label}: executed application {app_id} missing evidence inputs")
            if not item.get("output_signal_refs") and not item.get("output_judgment_refs"):
                errors.append(f"{label}: executed application {app_id} missing outputs")
            for ref in item.get("input_evidence_refs", []):
                if ref not in facts:
                    errors.append(f"{label}: application {app_id} unresolved evidence {ref}")
            for ref in item.get("output_signal_refs", []):
                if ref not in signals:
                    errors.append(f"{label}: application {app_id} unresolved signal {ref}")
        if item.get("status") in {"rejected", "blocked", "degraded"}:
            failed = any(check.get("result") in {"fail", "partial"} for check in item.get("precondition_checks", []))
            if not failed or not item.get("alternatives"):
                errors.append(f"{label}: non-executed application {app_id} lacks failure reason/alternative")

    judgments = judgment.get("judgments") or []
    judgment_ids = _ids(judgments, "judgment_id")
    for item in judgments:
        judgment_id = item.get("judgment_id")
        executed_refs = [ref for ref in item.get("method_application_refs", []) if app_by_id.get(ref, {}).get("status") == "executed"]
        if not executed_refs:
            errors.append(f"{label}: judgment {judgment_id} lacks executed MethodApplication")
        if not item.get("signal_refs") or not item.get("hypothesis_refs"):
            errors.append(f"{label}: judgment {judgment_id} bypasses signal/hypothesis")
        for ref in item.get("signal_refs", []):
            if ref not in signals:
                errors.append(f"{label}: judgment {judgment_id} unresolved signal {ref}")
        for ref in item.get("hypothesis_refs", []):
            if ref not in hypotheses:
                errors.append(f"{label}: judgment {judgment_id} unresolved hypothesis {ref}")
        for ref in item.get("rule_evaluation_refs", []):
            if ref not in rule_eval_ids:
                errors.append(f"{label}: judgment {judgment_id} unresolved RuleEvaluation {ref}")

    expression_apps: set[str] = set()
    expression_ids: set[str] = set()
    for item in expression.get("expressions") or []:
        expression_ids.add(str(item.get("expression_id")))
        if item.get("source_claim_id") not in judgment_ids:
            errors.append(f"{label}: expression unresolved judgment {item.get('source_claim_id')}")
        for ref in item.get("source_method_application_refs", []):
            expression_apps.add(ref)
            if app_by_id.get(ref, {}).get("status") != "executed":
                errors.append(f"{label}: expression references non-executed application {ref}")
        for ref in item.get("source_evidence_refs", []):
            if ref not in facts:
                errors.append(f"{label}: expression unresolved evidence {ref}")
    checks = expression.get("overall_check") or {}
    for key in ("no_new_fact_created", "no_new_judgment_created", "no_method_status_changed"):
        if checks.get(key) is not True:
            errors.append(f"{label}: 05 check {key} must be true")

    stale = set(update.get("affected_graph", {}).get("stale", []))
    current = set(update.get("affected_graph", {}).get("remains_current", []))
    if not stale or stale & current:
        errors.append(f"{label}: incremental stale/current sets invalid")
    if update.get("full_rerun_required") is not False or update.get("structural_checkpoint_required") is not False:
        errors.append(f"{label}: evidence-only exercise must be local-first")
    changed_judgment = update.get("expected_judgment_change", {}).get("judgment_ref")
    if changed_judgment not in judgment_ids or changed_judgment not in stale:
        errors.append(f"{label}: incremental judgment change not linked to stale graph")
    return errors


def load_run(run_dir: Path) -> dict[str, dict[str, Any]]:
    return {
        "manifest": load(run_dir / "run_manifest.yaml"),
        "structure": load(run_dir / "02_structure.yaml"),
        "evidence": load(run_dir / "03_evidence.yaml"),
        "judgment": load(run_dir / "04_judgment.yaml"),
        "expression": load(run_dir / "05_expression.yaml"),
        "update": load(run_dir / "incremental_update.yaml"),
    }


def known_rule_ids() -> set[str]:
    output: set[str] = set()
    for path in (ROOT / "ontology/01_通用/models").glob("*.yaml"):
        output.update((load(path).get("rules") or {}).keys())
    output.update((load(ROOT / "ontology/01_通用/models/semiconductor_extension.yaml").get("evidence_constraints") or {}).keys())
    return output


def main(argv: list[str]) -> int:
    runs = tuple(Path(arg).resolve() for arg in argv) or DEFAULT_RUNS
    contract = load(ROOT / "governance/02_合同/public_contract.yaml")
    rules = known_rule_ids()
    errors: list[str] = []
    for run_dir in runs:
        errors.extend(validate_run_data(load_run(run_dir), contract, rules))
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        print(f"V3_SAMPLES_RETURN_REQUIRED: {len(errors)} error(s)")
        return 1
    print(f"V3_SAMPLES_PASS: {len(runs)} run(s), contract=1.3.0, ontology=3.0.0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
