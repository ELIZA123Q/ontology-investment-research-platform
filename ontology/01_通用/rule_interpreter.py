#!/usr/bin/env python3
"""本体规则 fixture 小解释器：用 models/*.yaml 的 condition / counter_conditions / preconditions 驱动断言。

P1：冻结门与 Runtime 共用同一套谓词语义，避免 YAML↔手写分支漂移。
支持：
- 布尔键：input[pred] 为真/假
- 成员式：target_type in [Observation, Event]
- 派生：target_type_is_Judgment
- 条件：atom and atom；clause or clause
"""

from __future__ import annotations

import re
from typing import Any

POSITIVE_RESULTS = {"pass", "allow", "valid", "success"}
NEGATIVE_RESULTS = {"reject", "fail", "invalid", "block", "downgrade_or_reject"}

_ATOM_IN = re.compile(r"^([A-Za-z_][\w.]*)\s+in\s+\[([^\]]+)\]$")
_SPLIT_OR = re.compile(r"\s+or\s+")
_SPLIT_AND = re.compile(r"\s+and\s+")


def normalize_expected_polarity(expected: str) -> str | None:
    value = str(expected).lower()
    if value in POSITIVE_RESULTS:
        return "positive"
    if value in NEGATIVE_RESULTS:
        return "negative"
    return None


def _truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() not in {"", "false", "0", "no", "null", "none"}
    if isinstance(value, (list, dict, tuple, set)):
        return len(value) > 0
    return bool(value)


def _derived_predicate(name: str, case_input: dict[str, Any]) -> bool | None:
    if name == "target_type_is_Judgment":
        return case_input.get("target_type") == "Judgment"
    if name.endswith("_present"):
        # judgment_unit_present / hypothesis_present
        return _truthy(case_input.get(name))
    if name.startswith("missing_"):
        stem = name[len("missing_") :]
        present_key = f"{stem}_present"
        if present_key in case_input:
            return not _truthy(case_input.get(present_key))
        if stem in case_input:
            return not _truthy(case_input.get(stem))
    return None


def eval_atom(atom: str, case_input: dict[str, Any]) -> bool:
    text = atom.strip()
    if not text:
        return True
    matched = _ATOM_IN.match(text)
    if matched:
        key = matched.group(1)
        allowed = [part.strip() for part in matched.group(2).split(",") if part.strip()]
        return str(case_input.get(key, "")) in allowed
    if text in case_input:
        return _truthy(case_input.get(text))
    derived = _derived_predicate(text, case_input)
    if derived is not None:
        return derived
    # 未知原子默认 false，迫使 fixture 显式提供谓词
    return False


def eval_condition(expression: str, case_input: dict[str, Any]) -> bool:
    expr = (expression or "").strip()
    if not expr:
        return True
    clauses = _SPLIT_OR.split(expr)
    return any(all(eval_atom(atom, case_input) for atom in _SPLIT_AND.split(clause)) for clause in clauses)


def evaluate_rule_fixture(resource: dict[str, Any], case_input: dict[str, Any]) -> str:
    """按 YAML 规则定义判定 fixture：任一 counter_condition 为真则 reject；否则要求 condition 成立。"""
    for counter in resource.get("counter_conditions") or []:
        if not isinstance(counter, str):
            continue
        if eval_atom(counter, case_input):
            return "reject"
    if eval_condition(str(resource.get("condition") or ""), case_input):
        return "pass"
    return "reject"


def assert_executable_rule_fixtures(name: str, rule_id: str, resource: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if resource.get("test_case_role") != "executable":
        return errors
    cases = resource.get("test_cases") or []
    if not isinstance(cases, list):
        return errors
    for index, case in enumerate(cases, 1):
        if not isinstance(case, dict):
            continue
        case_id = case.get("id") or index
        case_input = case.get("input")
        expected = case.get("expected")
        if not isinstance(case_input, dict) or not isinstance(expected, str) or not expected.strip():
            continue
        actual = evaluate_rule_fixture(resource, case_input)
        expected_polarity = normalize_expected_polarity(expected)
        actual_polarity = normalize_expected_polarity(actual)
        if expected_polarity is None or actual_polarity is None or expected_polarity != actual_polarity:
            errors.append(
                f"{name}:{rule_id} executable fixture {case_id} expected {expected!r} got {actual!r}"
            )
    return errors
