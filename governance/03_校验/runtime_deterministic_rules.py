"""Shared Runtime REQUIRED_RULES + deterministic_result assertions.

Aligned with runtime/engine/semantic_execution.ts REQUIRED_RULES and
assertDeterministicRuleResults. Validators assert presence and consistency;
they do not re-implement computeRule.
"""

from __future__ import annotations

from typing import Any

ENGINE_VERSION = "runtime-semantic-rules-2.0.0"
REQUIRED_RULES = frozenset({
    "evidence_scope_time_alignment",
    "no_direct_evidence_to_judgment",
    "judgment_reference_integrity",
    "judgment_evidence_threshold",
    "judgment_status_consistency",
})


def _rule_id(item: dict[str, Any]) -> str:
    return str(item.get("id") or item.get("rule_evaluation_id") or "")


def _judgment_id(item: dict[str, Any]) -> str:
    return str(item.get("judgment_id") or item.get("id") or "")


def _judgment_rule_refs(item: dict[str, Any]) -> list[str]:
    refs = item.get("rule_evaluation_ids") or item.get("rule_evaluation_refs") or []
    return [str(ref) for ref in refs]


def assert_required_deterministic_rules(
    judgment_doc: dict[str, Any],
    *,
    error_prefix: str = "",
    require_deterministic_on_all: bool = True,
) -> list[str]:
    """Assert each Judgment binds all REQUIRED_RULES with consistent deterministic_result."""
    prefix = f"{error_prefix}: " if error_prefix else ""
    errors: list[str] = []
    evaluations = {
        _rule_id(item): item
        for item in judgment_doc.get("rule_evaluations") or []
        if isinstance(item, dict) and _rule_id(item)
    }

    for rule_id, evaluation in evaluations.items():
        rule_ref = str(evaluation.get("rule_ref") or "")
        needs_deterministic = require_deterministic_on_all or rule_ref in REQUIRED_RULES
        if not needs_deterministic:
            continue
        deterministic = evaluation.get("deterministic_result")
        if not isinstance(deterministic, dict):
            errors.append(f"{prefix}rule evaluation {rule_id} 缺少 deterministic_result")
            continue
        if deterministic.get("engine_version") != ENGINE_VERSION:
            errors.append(f"{prefix}rule evaluation {rule_id} 缺少可验证 Runtime 确定性结果")
        elif deterministic.get("result") != evaluation.get("result"):
            errors.append(f"{prefix}rule evaluation {rule_id} 声明结果与 deterministic_result 不一致")

    judgments = [item for item in judgment_doc.get("judgments") or [] if isinstance(item, dict)]
    if not judgments:
        errors.append(f"{prefix}04_judgment 缺少 judgments")
        return errors

    for item in judgments:
        jid = _judgment_id(item) or "<unknown>"
        bound = [evaluations.get(ref) for ref in _judgment_rule_refs(item)]
        missing_refs = [ref for ref, rule in zip(_judgment_rule_refs(item), bound) if rule is None]
        for ref in missing_refs:
            errors.append(f"{prefix}judgment {jid} 引用未知 RuleEvaluation {ref}")
        rule_names = {str(rule.get("rule_ref")) for rule in bound if rule}
        if not REQUIRED_RULES.issubset(rule_names):
            errors.append(
                f"{prefix}judgment {jid} 缺少 Runtime 确定性规则: "
                f"{', '.join(sorted(REQUIRED_RULES - rule_names))}"
            )
        bad_rules = [
            str(rule.get("rule_ref"))
            for rule in bound
            if rule and rule.get("result") in {"fail", "blocked"}
        ]
        if bad_rules:
            errors.append(f"{prefix}judgment {jid} 存在阻断规则: {', '.join(bad_rules)}")

    return errors
