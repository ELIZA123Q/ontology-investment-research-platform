#!/usr/bin/env python3
"""只读校验 03 取证策略库的注册表、文件、Recipe 合同和内部引用。"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parent
RECIPE_REQUIRED_FIELDS = {
    "name",
    "version",
    "status",
    "file",
    "primary_rule",
    "mandatory_baskets",
    "counter_baskets",
    "minimum_pass_rule",
    "high_quality_rule",
    "proxy_rule",
    "stop_rule",
    "downgrade_rule",
}
EXPECTED_RULE_IDS = {f"A{i:02d}" for i in range(1, 10)}
EXPECTED_RECIPE_IDS = {
    "ER-STATE-01",
    "ER-TREND-01",
    "ER-CYCLE-01",
    "ER-ATTR-01",
    "ER-TRANS-01",
    "ER-DIFF-01",
    "ER-EARN-01",
    "ER-EXPECT-01",
}
EXPECTED_PERMISSION_MATRIX = {
    "Q4_report_grade": "core_judgment",
    "Q3_directional_ready": "directional_judgment",
    "Q2_reasoning_usable": "conditional_judgment",
    "Q1_background": "background_only",
    "Q0_unusable": "prohibited",
}
EXPECTED_PERMISSION_USES = {
    "Q4_report_grade": "核心判断",
    "Q3_directional_ready": "方向判断",
    "Q2_reasoning_usable": "条件判断",
    "Q1_background": "背景",
    "Q0_unusable": "禁止",
}
REQUIRED_02_JUDGMENT_FIELDS = {"judgment_type", "required_evidence_role", "default_recipe"}
REQUIRED_PATTERN_CASE_FIELDS = {
    "case_id",
    "case_name",
    "source_task_ref",
    "judgment_type",
    "effective_recipe",
    "most_effective_evidence",
    "misjudgment_sources",
    "added_counter_evidence",
    "inaccessible_evidence",
    "downstream_04_consumption_issue",
    "learning_target",
    "status",
}


def load_yaml(path: Path, errors: list[str]) -> dict:
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception as exc:  # pragma: no cover - diagnostics
        errors.append(f"{path.name}: YAML 无法解析: {exc}")
        return {}
    if not isinstance(data, dict):
        errors.append(f"{path.name}: 顶层必须是 mapping")
        return {}
    return data


def check_local_links(errors: list[str]) -> None:
    for path in ROOT.rglob("*.md"):
        text = path.read_text(encoding="utf-8")
        for target in re.findall(r"\[[^\]]+\]\(([^)]+)\)", text):
            target = target.strip().strip("<>").split("#", 1)[0]
            if not target or "://" in target or not target.endswith(".md"):
                continue
            if not (path.parent / target).resolve().exists():
                errors.append(f"{path.relative_to(ROOT)}: 内部链接不存在 {target}")


def validate() -> list[str]:
    errors: list[str] = []
    strategy = load_yaml(ROOT / "00_strategy_registry.yaml", errors)
    quality = load_yaml(ROOT / "00_quality_gates.yaml", errors)
    source = load_yaml(ROOT / "00_source_registry.yaml", errors)

    rules = strategy.get("rules", {})
    if set(rules) != EXPECTED_RULE_IDS:
        errors.append(
            "00_strategy_registry.yaml: A 类规则应为 "
            + ", ".join(sorted(EXPECTED_RULE_IDS))
        )
    for rule_id, item in rules.items():
        path = ROOT / item.get("file", "")
        if not path.is_file():
            errors.append(f"{rule_id}: 规则文件不存在 {item.get('file')}")

    recipes = strategy.get("evidence_recipes", {})
    missing_recipes = EXPECTED_RECIPE_IDS - set(recipes)
    if missing_recipes:
        errors.append(f"核心 Recipe 缺失: {', '.join(sorted(missing_recipes))}")
    for recipe_id, item in recipes.items():
        missing = RECIPE_REQUIRED_FIELDS - set(item)
        if missing:
            errors.append(f"{recipe_id}: 缺少字段 {', '.join(sorted(missing))}")
        path = ROOT / item.get("file", "")
        if not path.is_file():
            errors.append(f"{recipe_id}: Recipe 文件不存在 {item.get('file')}")
        elif recipe_id not in path.read_text(encoding="utf-8"):
            errors.append(f"{recipe_id}: Recipe 文件未出现该 ID")
        if item.get("primary_rule") not in rules:
            errors.append(f"{recipe_id}: primary_rule 不存在 {item.get('primary_rule')}")
        if not item.get("mandatory_baskets") or not item.get("counter_baskets"):
            errors.append(f"{recipe_id}: mandatory/counter baskets 不能为空")

    for preset_id, item in strategy.get("recipe_presets", {}).items():
        for recipe_id in item.get("recipes", []):
            if recipe_id not in recipes:
                errors.append(f"{preset_id}: 引用不存在的 Recipe {recipe_id}")

    for judgment_type, item in strategy.get("judgment_type_registry", {}).items():
        refs = []
        if item.get("evidence_recipe"):
            refs.append(item["evidence_recipe"])
        refs.extend(item.get("evidence_recipes", []))
        for recipe_id in refs:
            if recipe_id not in recipes:
                errors.append(f"{judgment_type}: 引用不存在的 Recipe {recipe_id}")

    permission_matrix = strategy.get("evidence_permission_matrix", {})
    actual_permissions = {
        level: item.get("evidence_permission")
        for level, item in permission_matrix.items()
        if isinstance(item, dict)
    }
    if actual_permissions != EXPECTED_PERMISSION_MATRIX:
        errors.append("Evidence Permission Matrix 必须完整映射 Q4—Q0 到核心/方向/条件/背景/禁止权限")
    actual_uses = {
        level: item.get("allowed_04_use")
        for level, item in permission_matrix.items()
        if isinstance(item, dict)
    }
    if actual_uses != EXPECTED_PERMISSION_USES:
        errors.append("Evidence Permission Matrix.allowed_04_use 必须为核心判断/方向判断/条件判断/背景/禁止")
    upstream_fields = set(strategy.get("execution_contract", {}).get("required_02_judgment_unit_fields", []))
    if upstream_fields != REQUIRED_02_JUDGMENT_FIELDS:
        errors.append("02→03 输入合同必须强制 judgment_type、required_evidence_role、default_recipe")
    default_routes = strategy.get("judgment_unit_default_recipe", {})
    if not default_routes:
        errors.append("缺少 judgment_unit_default_recipe")
    for judgment_type, recipe_id in default_routes.items():
        if recipe_id not in recipes:
            errors.append(f"{judgment_type}: default_recipe 不存在 {recipe_id}")
    case_contract = strategy.get("evidence_pattern_case_contract", {})
    case_fields = set(case_contract.get("required_fields", [])) if isinstance(case_contract, dict) else set()
    if case_fields != REQUIRED_PATTERN_CASE_FIELDS:
        errors.append("Evidence Pattern Case 合同字段不完整")
    if case_contract.get("storage_location") != "D_研究工作单/05_研究复盘与框架反馈.md":
        errors.append("Evidence Pattern Case 必须沉淀在现有 D05，不得扩张新目录")
    pilot_cases = strategy.get("pilot_validation_plan", {}).get("cases", [])
    pilot_types = {item.get("case_type") for item in pilot_cases if isinstance(item, dict)}
    if pilot_types != {"industry_cycle", "geopolitical_shock", "company_earnings_elasticity"}:
        errors.append("案例验证计划必须覆盖行业周期、地缘冲击和公司业绩弹性")

    for path in sorted((ROOT / "A_取证规则").glob("A0[1-9]_*.md")):
        text = path.read_text(encoding="utf-8")
        for phrase in ("专项执行协议", "降级规则", "停止规则", "输出到 03 快照"):
            if phrase not in text:
                errors.append(f"{path.relative_to(ROOT)}: 缺少“{phrase}”")

    capability = ROOT / "00_能力模型与文件职责矩阵.md"
    if not capability.is_file():
        errors.append("缺少 00_能力模型与文件职责矩阵.md")
    guide = ROOT / "C_Evidence_Recipe" / "00_证据配方使用说明.md"
    if not guide.is_file() or "最低证据组合的完整要求" not in guide.read_text(encoding="utf-8"):
        errors.append("C_Evidence_Recipe: 缺少最低证据组合的完整要求")

    for key in ("evaluation_principles", "assessment_layers", "conflict_resolution_protocol", "missing_data_protocol"):
        if key not in quality:
            errors.append(f"00_quality_gates.yaml: 缺少 {key}")
    for key in ("source_selection_contract", "source_profile_admission"):
        if key not in source:
            errors.append(f"00_source_registry.yaml: 缺少 {key}")
    for item in source.get("source_guidance_files", {}).values():
        ref = item.get("file")
        if ref and not (ROOT / ref).is_file():
            errors.append(f"00_source_registry.yaml: 来源指引不存在 {ref}")

    check_local_links(errors)
    return errors


def main() -> int:
    errors = validate()
    for error in errors:
        print(f"ERROR: {error}")
    if errors:
        print(f"FAIL: 03 取证策略库发现 {len(errors)} 个错误")
        return 1
    print("PASS: 03 取证策略库注册表、9 条规则、8 个 Recipe、来源指引和内部链接有效")
    return 0


if __name__ == "__main__":
    sys.exit(main())
