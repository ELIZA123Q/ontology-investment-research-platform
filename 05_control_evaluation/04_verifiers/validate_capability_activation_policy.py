#!/usr/bin/env python3
"""Ensure production capability activation cannot bypass governed evaluation evidence."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

import yaml


ROOT = Path(__file__).resolve().parents[2]
POLICY = ROOT / "05_control_evaluation/01_rules/policies/capability_activation_policy.yaml"
MANIFEST = ROOT / "03_agent_capability/releases/current.json"
RUNTIME = ROOT / "06_runtime/src/capabilities/registry.ts"
AUDIT = ROOT / "06_runtime/scripts/audit-cutover.ts"
RELEASE_EVIDENCE = ROOT / "05_control_evaluation/05_evals/release_evidence/registry.json"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def valid_time(value: object) -> bool:
    try:
        datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return True
    except ValueError:
        return False


def validate(manifest: dict[str, Any], policy: dict[str, Any], release_evidence: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    activation = policy.get("production_activation") or {}
    evidence_by_id = {str(item.get("id")): item for item in release_evidence.get("evidenceRuns", []) if isinstance(item, dict) and item.get("id")}
    for kind in ("skills", "agents", "tools"):
        for entry in manifest.get(kind, []):
            if "production" not in entry.get("executionScopes", []):
                continue
            evidence = entry.get("activationEvidence") or {}
            if evidence.get("type") != "evaluation_run":
                continue
            run_refs = evidence.get("evaluationRunRefs")
            if not isinstance(run_refs, list) or not run_refs:
                errors.append(f"{kind}:{entry.get('id')} lacks evaluation run refs")
                continue
            matching_runs = [evidence_by_id.get(str(ref)) for ref in run_refs]
            if any(run is None for run in matching_runs):
                errors.append(f"{kind}:{entry.get('id')} references an unregistered evaluation run")
                continue
            run = matching_runs[0]
            if run.get("status") != "completed" or run.get("formalScoreEligible") is not True:
                errors.append(f"{kind}:{entry.get('id')} requires a completed formally eligible evaluation run")
            if entry.get("id") not in run.get("capabilityIds", []):
                errors.append(f"{kind}:{entry.get('id')} is not covered by its evaluation run")
            if len(run.get("caseIds", [])) < activation.get("required_metrics", {}).get("comparable_cases", {}).get("minimum", 12):
                errors.append(f"{kind}:{entry.get('id')} evaluation run has too few comparable cases")
            release_metrics = evidence.get("metrics") or {}
            run_metrics = run.get("metrics") or {}
            for release_key, run_key in (("comparableCases", "comparableCases"), ("blindWinRate", "blindWinRate"), ("severeRegressions", "severeRegressions")):
                if release_metrics.get(release_key) != run_metrics.get(run_key):
                    errors.append(f"{kind}:{entry.get('id')} release metrics do not match its evaluation run")
                    break
    return errors


def main() -> int:
    policy = yaml.safe_load(POLICY.read_text(encoding="utf-8"))
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    release_evidence = json.loads(RELEASE_EVIDENCE.read_text(encoding="utf-8"))
    require(isinstance(policy, dict) and policy.get("schema_name") == "capability_activation_policy" and policy.get("status") == "active", "capability activation policy must be active")
    activation = policy.get("production_activation") or {}
    metrics = activation.get("required_metrics") if isinstance(activation, dict) else None
    require(isinstance(metrics, dict), "activation metrics are required")
    require(metrics.get("comparable_cases", {}).get("minimum") == 12 and metrics.get("blind_win_rate", {}).get("minimum") == 0.60 and metrics.get("severe_regressions", {}).get("maximum") == 0, "activation thresholds drift")
    require(activation.get("candidate_production_dispatch_allowed") is False, "candidate production dispatch must remain forbidden")
    require(policy.get("release_evidence_registry") == str(RELEASE_EVIDENCE.relative_to(ROOT)), "release evidence registry authority drift")
    require(release_evidence.get("schemaName") == "capability_release_evidence_registry" and release_evidence.get("status") == "current" and isinstance(release_evidence.get("evidenceRuns"), list), "release evidence registry is invalid")
    declared = manifest.get("activationPolicy") or {}
    require(declared.get("minimumComparableCases") == 12 and declared.get("minimumBlindWinRate") == 0.60 and declared.get("maximumSevereRegressions") == 0 and declared.get("candidateProductionDispatchAllowed") is False, "release manifest activation policy differs from governed policy")
    production_entries = [entry for kind in ("skills", "agents", "tools") for entry in manifest.get(kind, []) if "production" in entry.get("executionScopes", [])]
    require(production_entries, "release manifest has no production entries")
    baseline = policy.get("foundational_baseline") or {}
    permitted = baseline.get("permitted_entries") if isinstance(baseline, dict) else None
    require(isinstance(permitted, dict), "foundational baseline must enumerate the fixed existing production entries")
    for kind in ("skills", "agents", "tools"):
        for entry in manifest.get(kind, []):
            if "production" not in entry.get("executionScopes", []):
                continue
            evidence = entry.get("activationEvidence")
            require(isinstance(evidence, dict) and valid_time(evidence.get("evaluatedAt")), f"{entry.get('id')} lacks dated activation evidence")
            if evidence.get("type") == "foundational_baseline":
                require(entry.get("id") in permitted.get(kind, []), f"{entry.get('id')} is not a permitted foundational baseline")
                require(bool(str(evidence.get("rationale", "")).strip()), f"{entry.get('id')} foundational baseline lacks rationale")
            else:
                require(evidence.get("type") == "evaluation_run", f"{entry.get('id')} activation evidence type is invalid")
                run_refs = evidence.get("evaluationRunRefs")
                measure = evidence.get("metrics")
                require(isinstance(run_refs, list) and run_refs and isinstance(measure, dict), f"{entry.get('id')} evaluation evidence is incomplete")
                require(measure.get("comparableCases", 0) >= 12 and measure.get("blindWinRate", 0) >= 0.60 and measure.get("severeRegressions", 1) == 0, f"{entry.get('id')} does not meet activation thresholds")
            if entry.get("lifecycle") != "active":
                require("production" not in entry.get("executionScopes", []), f"candidate {entry.get('id')} has production scope")
    for kind in ("skills", "agents", "tools"):
        baseline_entries = [entry.get("id") for entry in manifest.get(kind, []) if entry.get("activationEvidence", {}).get("type") == "foundational_baseline"]
        require(set(baseline_entries) == set(permitted.get(kind, [])), f"{kind} foundational baseline list must exactly match the governed allowlist")
    errors = validate(manifest, policy, release_evidence)
    require(not errors, "; ".join(errors))
    runtime = RUNTIME.read_text(encoding="utf-8")
    audit = AUDIT.read_text(encoding="utf-8")
    require("activationEvidence" in runtime, "runtime release type must expose activation evidence")
    require("activationEvidence" in audit and "candidateProductionDispatchAllowed" in audit, "cutover audit must enforce activation evidence")
    print(f"CAPABILITY_ACTIVATION_POLICY_PASS: production_entries={len(production_entries)}, release_evidence_runs={len(release_evidence['evidenceRuns'])}, candidate_production_dispatch=false.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AssertionError, yaml.YAMLError, json.JSONDecodeError) as error:
        print(f"CAPABILITY_ACTIVATION_POLICY_RETURN_REQUIRED: {error}")
        raise SystemExit(1)
