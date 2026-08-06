#!/usr/bin/env python3
"""校验证据事实到表达的最小推理追溯合同。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


ROOT = Path(__file__).resolve().parents[2]
CONTRACT_PATH = ROOT / "05_governance/02_合同/public_contract.yaml"
EXPECTED_CHAIN = [
    "EvidenceFact", "Signal", "Hypothesis", "RuleEvaluation",
    "MethodApplication", "Judgment", "ReasoningTrace", "Expression",
]


def load(path: Path) -> dict[str, Any]:
    value = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path}: YAML root must be a mapping")
    return value


def validate_contract_data(public_contract: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    contract = public_contract.get("reasoning_trace_contract") or {}
    if str(contract.get("schema_version")) != "1.0.0":
        errors.append("reasoning trace contract version must be 1.0.0")
    if contract.get("minimum_chain") != EXPECTED_CHAIN:
        errors.append("minimum reasoning chain is incomplete or out of order")
    condition_fields = set(contract.get("condition_result_required_fields") or [])
    if condition_fields != {"condition_id", "expression", "input_refs", "outcome", "rationale"}:
        errors.append("RuleEvaluation condition result fields are incomplete")
    required_refs = set(contract.get("judgment_required_refs") or [])
    if required_refs != {"evidence_refs", "signal_refs", "hypothesis_refs", "rule_evaluation_refs", "method_application_refs"}:
        errors.append("Judgment direct trace refs are incomplete")
    ownership = contract.get("field_ownership") or {}
    if set(ownership) != {"stage_03", "stage_04", "stage_05"}:
        errors.append("reasoning object field ownership must cover stage_03 through stage_05")
    rules = "\n".join(contract.get("rules") or [])
    for phrase in ("EvidenceBasket", "正式本体规则", "executed MethodApplication", "ReasoningTrace.node_refs"):
        if phrase not in rules:
            errors.append(f"reasoning trace contract missing rule: {phrase}")
    return errors


def validate_repository() -> list[str]:
    errors = validate_contract_data(load(CONTRACT_PATH))
    evidence_model = load(ROOT / "01_semantic/01_ontology/models/evidence.yaml")
    if "no_direct_evidence_to_judgment" not in (evidence_model.get("rules") or {}):
        errors.append("formal ontology lacks no_direct_evidence_to_judgment")
    template = load(ROOT / "90_compat/methods/05_表达/templates/05_表达审计模板.yaml")
    checks = template.get("overall_check") or {}
    for key in ("all_evidence_mapped_to_04_judgments", "all_methods_mapped_to_executed_04_applications"):
        if key not in checks:
            errors.append(f"05 expression audit template missing {key}")
    runtime_schema = (ROOT / "07_runtime/engine/schemas.ts").read_text(encoding="utf-8")
    runtime_validator = (ROOT / "07_runtime/engine/reasoning_trace.ts").read_text(encoding="utf-8")
    for phrase in ("hypotheses", "rule_evaluations", "reasoning_traces", "target_hypothesis_ids"):
        if phrase not in runtime_schema:
            errors.append(f"Runtime stage_04 schema missing {phrase}")
    for phrase in ("非正式本体规则", "EvidenceBasket", "绕过了 Signal/Hypothesis", "完整 ReasoningTrace"):
        if phrase not in runtime_validator:
            errors.append(f"Runtime reasoning validator missing invariant: {phrase}")
    return errors


def main() -> int:
    errors = validate_repository()
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        print(f"REASONING_TRACE_CONTRACT_RETURN_REQUIRED: {len(errors)} error(s)")
        return 1
    print("REASONING_TRACE_CONTRACT_PASS: fact-level Evidence → Signal → Hypothesis → RuleEvaluation → Judgment → Expression")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
