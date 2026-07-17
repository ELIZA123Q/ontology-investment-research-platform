#!/usr/bin/env python3
"""Validate that normative requirements have an explicit execution owner."""

from __future__ import annotations

from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]
MATRIX = Path(__file__).with_name("requirements_coverage.yaml")
ALLOWED_MODES = {"automated", "semantic_review", "human_required"}


def main() -> int:
    data = yaml.safe_load(MATRIX.read_text(encoding="utf-8"))
    errors: list[str] = []
    if not isinstance(data, dict) or data.get("schema_name") != "markdown_validator_requirements_coverage":
        errors.append("requirements_coverage schema_name 非法")
        data = {}
    rules = data.get("rules", [])
    seen: set[str] = set()
    if not isinstance(rules, list) or not rules:
        errors.append("requirements_coverage.rules 不得为空")
        rules = []
    for index, rule in enumerate(rules, 1):
        if not isinstance(rule, dict):
            errors.append(f"rules[{index}] 必须为对象")
            continue
        rule_id = str(rule.get("rule_id", "")).strip()
        if not rule_id or rule_id in seen:
            errors.append(f"rules[{index}].rule_id 为空或重复")
        seen.add(rule_id)
        mode = str(rule.get("execution_mode", ""))
        if mode not in ALLOWED_MODES:
            errors.append(f"{rule_id}.execution_mode 非法")
        source_path = str(rule.get("source_ref", "")).split("#", 1)[0]
        if not source_path or not (ROOT / source_path).is_file():
            errors.append(f"{rule_id}.source_ref 无法解析")
        validators = rule.get("validator_refs", [])
        tests = rule.get("test_refs", [])
        if not isinstance(validators, list) or not isinstance(tests, list):
            errors.append(f"{rule_id} validator_refs/test_refs 必须为列表")
            continue
        for ref in [*validators, *tests]:
            if not (ROOT / str(ref)).is_file():
                errors.append(f"{rule_id} 引用文件不存在: {ref}")
        if mode == "automated" and (not validators or not tests):
            errors.append(f"{rule_id} automated 规则必须同时绑定校验器与测试")
        if mode != "automated" and not str(rule.get("rationale", "")).strip():
            errors.append(f"{rule_id} 非自动规则必须说明 rationale")
    if errors:
        print("REQUIREMENTS_COVERAGE_RETURN_REQUIRED")
        print("\n".join(f"- {item}" for item in errors))
        return 1
    print(f"REQUIREMENTS_COVERAGE_PASS: {len(rules)} 条强制要求均有明确执行归属。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
