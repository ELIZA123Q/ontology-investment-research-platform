#!/usr/bin/env python3
"""MethodApplication 1.2 / Public Contract 1.3 validation helpers.

The functions in this module are intentionally independent from the compact V3
examples.  Stage validators use them for normal 02--05 artifacts as well.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

import yaml


ROOT = Path(__file__).resolve().parents[2]
CONTRACT_PATH = ROOT / "governance/02_合同/public_contract.yaml"
CANONICAL_FIELD = "method_applications"
DEPRECATED_FIELDS = {
    "method_application_candidates",
    "method_input_bindings",
    "method_application_register",
}
REQUIRED_IMMUTABLE = {
    "application_id",
    "method_id",
    "method_version",
    "capability_type",
    "target_question_refs",
    "target_judgment_unit_refs",
}
TERMINAL_STATUSES = {"executed", "rejected", "blocked", "degraded"}
PRECONDITION_RESULTS = {"pass", "fail", "partial", "not_checked", "not_applicable"}


def load(path: Path) -> dict[str, Any]:
    value = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path}: YAML root must be a mapping")
    return value


def public_method_contract() -> dict[str, Any]:
    contract = load(CONTRACT_PATH)
    value = contract.get("method_application_contract")
    if not isinstance(value, dict):
        raise ValueError("public contract is missing method_application_contract")
    return value


def validate_contract_data(public_contract: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if str(public_contract.get("schema_version")) != "1.3.0":
        errors.append("Public Contract version must be 1.3.0")
    contract = public_contract.get("method_application_contract") or {}
    if str(contract.get("schema_version")) != "1.2.0":
        errors.append("MethodApplication contract version must be 1.2.0")
    if contract.get("canonical_stage_field") != CANONICAL_FIELD:
        errors.append("canonical MethodApplication stage field must be method_applications")
    if set((contract.get("deprecated_stage_fields") or {}).keys()) != DEPRECATED_FIELDS:
        errors.append("deprecated MethodApplication aliases must be completely registered")
    required = set(contract.get("required_fields") or [])
    for field in ("precondition_checks", "provenance", "alternatives"):
        if field not in required:
            errors.append(f"MethodApplication required_fields is missing {field}")
    if not REQUIRED_IMMUTABLE <= set(contract.get("immutable_fields") or []):
        errors.append("immutable MethodApplication identity fields are incomplete")
    if set(contract.get("per_judgment_unit_required_capabilities") or []) != {"judgment_structure", "evidence", "adjudication"}:
        errors.append("every JudgmentUnit must require structure, evidence and adjudication capabilities")
    ownership = contract.get("stage_field_ownership") or {}
    if set(ownership) != {"stage_02", "stage_03", "stage_04", "stage_05"}:
        errors.append("stage ownership must cover stage_02 through stage_05")
    if (ownership.get("stage_02") or {}).get("allowed_statuses") != ["candidate"]:
        errors.append("stage_02 may only create candidate MethodApplications")
    if "executed" not in ((ownership.get("stage_03") or {}).get("forbidden_statuses") or []):
        errors.append("stage_03 must forbid executed")
    if set((ownership.get("stage_04") or {}).get("allowed_statuses") or []) != TERMINAL_STATUSES:
        errors.append("stage_04 must converge every MethodApplication to a terminal status")
    if (ownership.get("stage_05") or {}).get("creates") or (ownership.get("stage_05") or {}).get("updates"):
        errors.append("stage_05 must not create or update MethodApplications")
    transitions = contract.get("allowed_transitions") or {}
    if "executed" not in (transitions.get("candidate") or []):
        errors.append("candidate must be executable in stage_04")
    for terminal in TERMINAL_STATUSES:
        if terminal == "degraded":
            continue
        if transitions.get(terminal) != [terminal]:
            errors.append(f"terminal status {terminal} must be immutable")
    return errors


def _refs(value: Any, label: str, errors: list[str]) -> list[str]:
    if not isinstance(value, list):
        errors.append(f"{label} must be a list")
        return []
    output: list[str] = []
    for index, item in enumerate(value):
        ref = str(item or "").strip()
        if not ref:
            errors.append(f"{label}[{index}] must be a non-empty reference")
        else:
            output.append(ref)
    if len(output) != len(set(output)):
        errors.append(f"{label} contains duplicate references")
    return output


def _check_resolved(refs: Iterable[str], known: set[str] | None, label: str, errors: list[str]) -> None:
    if known is None:
        return
    unresolved = sorted(set(refs) - known)
    if unresolved:
        errors.append(f"{label} contains unresolved refs: {', '.join(unresolved)}")


def application_index(items: Any, label: str = CANONICAL_FIELD) -> tuple[dict[str, dict[str, Any]], list[str]]:
    errors: list[str] = []
    if not isinstance(items, list):
        return {}, [f"{label} must be a list"]
    output: dict[str, dict[str, Any]] = {}
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            errors.append(f"{label}[{index}] must be an object")
            continue
        app_id = str(item.get("application_id") or "").strip()
        if not app_id:
            errors.append(f"{label}[{index}].application_id must be non-empty")
        elif app_id in output:
            errors.append(f"{label} has duplicate application_id {app_id}")
        else:
            output[app_id] = item
    return output, errors


def validate_stage_applications(
    artifact: dict[str, Any],
    stage: str,
    *,
    required: bool,
    prior_items: Any | None = None,
    known_questions: set[str] | None = None,
    known_judgment_units: set[str] | None = None,
    known_objects: set[str] | None = None,
    known_evidence: set[str] | None = None,
    known_signals: set[str] | None = None,
    known_judgments: set[str] | None = None,
) -> list[str]:
    """Validate one canonical stage list and, when supplied, its inheritance."""

    errors: list[str] = []
    label = f"{stage}.{CANONICAL_FIELD}"
    deprecated = sorted(DEPRECATED_FIELDS & set(artifact))
    if deprecated and (required or CANONICAL_FIELD in artifact):
        errors.append(f"{stage} uses deprecated MethodApplication fields: {', '.join(deprecated)}")
    if CANONICAL_FIELD not in artifact:
        if required:
            errors.append(f"{stage} Public Contract 1.3 artifact is missing {CANONICAL_FIELD}")
        return errors
    items = artifact.get(CANONICAL_FIELD)
    current, index_errors = application_index(items, label)
    errors.extend(index_errors)
    if required and not current:
        errors.append(f"{label} must contain at least one application")

    contract = public_method_contract()
    required_fields = set(contract.get("required_fields") or [])
    allowed_statuses = set(
        ((contract.get("stage_field_ownership") or {}).get(stage) or {}).get("allowed_statuses") or []
    )
    forbidden_nonempty = set(
        ((contract.get("stage_field_ownership") or {}).get(stage) or {}).get("forbidden_nonempty") or []
    )
    capabilities = set(contract.get("capability_types") or [])
    required_capabilities = set(contract.get("per_judgment_unit_required_capabilities") or [])
    if required_capabilities != {"judgment_structure", "evidence", "adjudication"}:
        errors.append("every JudgmentUnit must require structure, evidence and adjudication capabilities")

    for app_id, item in current.items():
        missing = sorted(required_fields - set(item))
        if missing:
            errors.append(f"{label}#{app_id} missing required fields: {', '.join(missing)}")
        for scalar in ("method_id", "method_version", "capability_type", "status", "applicability_boundary"):
            if not str(item.get(scalar) or "").strip():
                errors.append(f"{label}#{app_id}.{scalar} must be non-empty")
        status = str(item.get("status") or "")
        if status not in allowed_statuses:
            errors.append(f"{label}#{app_id}.status {status!r} is not allowed")
        if item.get("capability_type") not in capabilities:
            errors.append(f"{label}#{app_id}.capability_type is invalid")
        for field in forbidden_nonempty:
            if item.get(field) not in (None, "", []):
                errors.append(f"{label}#{app_id}.{field} must be empty in {stage}")

        questions = _refs(item.get("target_question_refs"), f"{label}#{app_id}.target_question_refs", errors)
        units = _refs(item.get("target_judgment_unit_refs"), f"{label}#{app_id}.target_judgment_unit_refs", errors)
        objects = _refs(item.get("target_ontology_object_refs"), f"{label}#{app_id}.target_ontology_object_refs", errors)
        inputs = _refs(item.get("input_evidence_refs"), f"{label}#{app_id}.input_evidence_refs", errors)
        signals = _refs(item.get("output_signal_refs"), f"{label}#{app_id}.output_signal_refs", errors)
        judgments = _refs(item.get("output_judgment_refs"), f"{label}#{app_id}.output_judgment_refs", errors)
        counterexamples = _refs(item.get("counter_example_refs"), f"{label}#{app_id}.counter_example_refs", errors)
        del counterexamples
        if not questions:
            errors.append(f"{label}#{app_id} must target at least one ResearchQuestion")
        if not units:
            errors.append(f"{label}#{app_id} must target at least one JudgmentUnit")
        _check_resolved(questions, known_questions, f"{label}#{app_id}.target_question_refs", errors)
        _check_resolved(units, known_judgment_units, f"{label}#{app_id}.target_judgment_unit_refs", errors)
        _check_resolved(objects, known_objects, f"{label}#{app_id}.target_ontology_object_refs", errors)
        _check_resolved(inputs, known_evidence, f"{label}#{app_id}.input_evidence_refs", errors)
        _check_resolved(signals, known_signals, f"{label}#{app_id}.output_signal_refs", errors)
        _check_resolved(judgments, known_judgments, f"{label}#{app_id}.output_judgment_refs", errors)

        checks = item.get("precondition_checks")
        if not isinstance(checks, list):
            errors.append(f"{label}#{app_id}.precondition_checks must be a list")
            checks = []
        check_ids: set[str] = set()
        for check_index, check in enumerate(checks):
            check_label = f"{label}#{app_id}.precondition_checks[{check_index}]"
            if not isinstance(check, dict):
                errors.append(f"{check_label} must be an object")
                continue
            missing_check = sorted(set(contract.get("precondition_check_required_fields") or []) - set(check))
            if missing_check:
                errors.append(f"{check_label} missing: {', '.join(missing_check)}")
            check_id = str(check.get("precondition_id") or "").strip()
            if not check_id or check_id in check_ids:
                errors.append(f"{check_label}.precondition_id is empty or duplicate")
            check_ids.add(check_id)
            if check.get("result") not in PRECONDITION_RESULTS:
                errors.append(f"{check_label}.result is invalid")
            check_refs = _refs(check.get("evidence_refs"), f"{check_label}.evidence_refs", errors)
            _check_resolved(check_refs, known_evidence, f"{check_label}.evidence_refs", errors)
            if not str(check.get("reason") or "").strip():
                errors.append(f"{check_label}.reason must be non-empty")

        provenance = item.get("provenance")
        if not isinstance(provenance, dict):
            errors.append(f"{label}#{app_id}.provenance must be an object")
        else:
            missing_prov = sorted(set(contract.get("provenance_required_fields") or []) - set(provenance))
            if missing_prov:
                errors.append(f"{label}#{app_id}.provenance missing: {', '.join(missing_prov)}")
            if provenance.get("stage") != stage:
                errors.append(f"{label}#{app_id}.provenance.stage must be {stage}")
            expected_source = None if stage == "stage_02" else app_id
            if provenance.get("source_application_id") != expected_source:
                errors.append(f"{label}#{app_id}.provenance.source_application_id is invalid")
            if not str(provenance.get("actor") or "").strip():
                errors.append(f"{label}#{app_id}.provenance.actor must be non-empty")
            recorded = str(provenance.get("recorded_at") or "").strip()
            try:
                datetime.fromisoformat(recorded.replace("Z", "+00:00"))
            except ValueError:
                errors.append(f"{label}#{app_id}.provenance.recorded_at must be ISO 8601")

        alternatives = item.get("alternatives")
        if not isinstance(alternatives, list):
            errors.append(f"{label}#{app_id}.alternatives must be a list")
            alternatives = []
        for alt_index, alternative in enumerate(alternatives):
            alt_label = f"{label}#{app_id}.alternatives[{alt_index}]"
            if not isinstance(alternative, dict):
                errors.append(f"{alt_label} must be an object")
                continue
            missing_alt = sorted(set(contract.get("alternative_required_fields") or []) - set(alternative))
            if missing_alt:
                errors.append(f"{alt_label} missing: {', '.join(missing_alt)}")
            for field in ("method_id", "decision", "reason"):
                if not str(alternative.get(field) or "").strip():
                    errors.append(f"{alt_label}.{field} must be non-empty")

        if status == "executed":
            if not checks:
                errors.append(f"{label}#{app_id} executed application has no precondition checks")
            if any(check.get("result") == "fail" for check in checks if isinstance(check, dict)):
                errors.append(f"{label}#{app_id} executed application has a failed precondition")
            if not inputs:
                errors.append(f"{label}#{app_id} executed application has no evidence input")
            if not signals and not judgments:
                errors.append(f"{label}#{app_id} executed application has no signal/judgment output")
            if not str(item.get("execution_summary") or "").strip():
                errors.append(f"{label}#{app_id} executed application has no execution summary")
        elif stage in {"stage_03", "stage_04"} and status in {"rejected", "blocked", "degraded"}:
            failed = any(
                isinstance(check, dict) and check.get("result") in {"fail", "partial"} and str(check.get("reason") or "").strip()
                for check in checks
            )
            if not failed:
                errors.append(f"{label}#{app_id} {status} application has no explicit failed/partial precondition reason")
            if not alternatives:
                errors.append(f"{label}#{app_id} {status} application has no alternative method")

        if stage == "stage_03" and item.get("capability_type") == "evidence" and status == "candidate":
            errors.append(f"{label}#{app_id} evidence application must converge in stage_03")

    if known_judgment_units is not None:
        required_capabilities = set(contract.get("per_judgment_unit_required_capabilities") or [])
        for unit_id in sorted(known_judgment_units):
            covered = {
                str(item.get("capability_type"))
                for item in current.values()
                if unit_id in (item.get("target_judgment_unit_refs") or [])
            }
            missing = sorted(required_capabilities - covered)
            if missing:
                errors.append(f"{label} JudgmentUnit {unit_id} missing capabilities: {', '.join(missing)}")

    if prior_items is not None:
        prior, prior_errors = application_index(prior_items, f"prior-to-{stage}.{CANONICAL_FIELD}")
        errors.extend(prior_errors)
        if set(current) != set(prior):
            errors.append(f"{stage} must inherit every prior application_id without additions or drops")
        immutable = set(contract.get("immutable_fields") or [])
        additive = set(contract.get("additive_only_fields") or [])
        transitions = contract.get("allowed_transitions") or {}
        for app_id in sorted(set(current) & set(prior)):
            before, after = prior[app_id], current[app_id]
            for field in immutable:
                if after.get(field) != before.get(field):
                    errors.append(f"{stage}.{app_id} immutable field drift: {field}")
            for field in additive:
                if not set(before.get(field) or []) <= set(after.get(field) or []):
                    errors.append(f"{stage}.{app_id} removed additive-only value from {field}")
            if after.get("status") not in set(transitions.get(before.get("status")) or []):
                errors.append(
                    f"{stage}.{app_id} illegal status transition {before.get('status')} -> {after.get('status')}"
                )
    return errors


def assert_valid_stage_applications(*args: Any, **kwargs: Any) -> None:
    errors = validate_stage_applications(*args, **kwargs)
    if errors:
        raise ValueError("; ".join(errors))


def validate_expression_projection(
    expression_audit: dict[str, Any],
    source_04: dict[str, Any],
    *,
    required: bool,
) -> list[str]:
    """Validate that 05 only projects 04 facts, judgments and executed methods."""

    errors: list[str] = []
    forbidden_creation_keys = {
        "facts", "evidence_facts", "signals", "hypotheses", "rule_evaluations",
        "judgments", "reasoning_traces", CANONICAL_FIELD,
    }
    def find_creation_keys(value: Any) -> set[str]:
        found_keys: set[str] = set()
        if isinstance(value, dict):
            found_keys.update(forbidden_creation_keys & set(value))
            for child in value.values():
                found_keys.update(find_creation_keys(child))
        elif isinstance(value, list):
            for child in value:
                found_keys.update(find_creation_keys(child))
        return found_keys

    found = sorted(find_creation_keys(expression_audit))
    if found:
        errors.append("stage_05 creates forbidden semantic collections: " + ", ".join(found))

    apps, app_errors = application_index(source_04.get(CANONICAL_FIELD), "stage_04.method_applications")
    if required:
        errors.extend(app_errors)
        if not apps:
            errors.append("stage_04 has no MethodApplication available for stage_05 projection")
    claims = {
        str(item.get("claim_id")): item
        for item in source_04.get("claim_register", []) or []
        if isinstance(item, dict) and item.get("claim_id")
    }
    judgments_by_claim = {
        str(item.get("claim_id")): item
        for item in source_04.get("judgments", []) or []
        if isinstance(item, dict) and item.get("claim_id")
    }
    expressions = expression_audit.get("claim_expression_register")
    if not isinstance(expressions, list):
        return errors + (["stage_05.claim_expression_register must be a list"] if required else [])
    for index, item in enumerate(expressions):
        if not isinstance(item, dict):
            errors.append(f"stage_05 expression[{index}] must be an object")
            continue
        label = f"stage_05 expression {item.get('expression_id', index)}"
        method_refs = _refs(item.get("source_method_application_refs"), f"{label}.source_method_application_refs", errors)
        evidence_refs = _refs(item.get("source_evidence_refs"), f"{label}.source_evidence_refs", errors)
        if required and not method_refs:
            errors.append(f"{label} must reference at least one executed MethodApplication")
        if required and not evidence_refs:
            errors.append(f"{label} must reference at least one concrete EvidenceFact")
        for ref in method_refs:
            if ref not in apps:
                errors.append(f"{label} references unknown MethodApplication {ref}")
            elif apps[ref].get("status") != "executed":
                errors.append(f"{label} references non-executed MethodApplication {ref}")
        if required and not any(apps.get(ref, {}).get("capability_type") == "adjudication" for ref in method_refs):
            errors.append(f"{label} must retain adjudication MethodApplication trace")
        source_ids = item.get("source_rcs") or [item.get("source_claim_id")]
        if not isinstance(source_ids, list):
            source_ids = [source_ids]
        allowed_methods: set[str] = set()
        allowed_evidence: set[str] = set()
        for claim_id in (str(value) for value in source_ids if value):
            judgment = judgments_by_claim.get(claim_id) or claims.get(claim_id) or {}
            allowed_methods.update(judgment.get("method_application_refs") or [])
            allowed_evidence.update(judgment.get("evidence_refs") or judgment.get("source_evidence_refs") or [])
        if method_refs and not set(method_refs) <= allowed_methods:
            errors.append(f"{label} method trace exceeds its source Judgment")
        if evidence_refs and not set(evidence_refs) <= allowed_evidence:
            errors.append(f"{label} evidence trace exceeds its source Judgment")
    return errors


def validate_repository() -> list[str]:
    from repo_paths import stage_yaml_template

    errors = validate_contract_data(load(CONTRACT_PATH))
    required_templates = (
        stage_yaml_template("02"),
        stage_yaml_template("03"),
        stage_yaml_template("04"),
    )
    for path in required_templates:
        text = path.read_text(encoding="utf-8")
        if f"{CANONICAL_FIELD}:" not in text:
            errors.append(f"{path.relative_to(ROOT)} missing canonical method_applications field")
        for deprecated in DEPRECATED_FIELDS:
            if f"{deprecated}:" in text:
                errors.append(f"{path.relative_to(ROOT)} still uses deprecated field {deprecated}")
    formal_gate_sources = {
        ROOT / "governance/03_校验/stages/stage_02/validate_02_outputs.py": "assert_valid_stage_applications",
        ROOT / "governance/03_校验/stages/stage_03/validate_03_outputs.py": "prior_items=view.get(\"method_applications\")",
        ROOT / "governance/03_校验/stages/stage_04/validate_04_outputs.py": "claim_register#{claim_id}",
        ROOT / "governance/03_校验/stages/stage_05/validate_05_outputs.py": "validate_expression_projection",
    }
    for path, invariant in formal_gate_sources.items():
        if invariant not in path.read_text(encoding="utf-8"):
            errors.append(f"{path.relative_to(ROOT)} is not connected to the formal MethodApplication gate")
    return errors


def main() -> int:
    errors = validate_repository()
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        print(f"METHOD_APPLICATION_CONTRACT_RETURN_REQUIRED: {len(errors)} error(s)")
        return 1
    print("METHOD_APPLICATION_CONTRACT_PASS: Public Contract 1.3; MethodApplication 1.2; formal stage helpers active")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
