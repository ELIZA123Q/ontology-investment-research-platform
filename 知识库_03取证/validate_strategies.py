#!/usr/bin/env python3
"""校验 03 取证策略库的机器合同、语义一致性、文档同步和最小案例。"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Any, Iterable

import yaml


DEFAULT_ROOT = Path(__file__).resolve().parent
VERSION_RE = re.compile(r"^\d+\.\d+\.\d+$")
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
EXPECTED_QUALITY_LEVELS = {
    "Q0": "Q0_unusable",
    "Q1": "Q1_background",
    "Q2": "Q2_conditional_usable",
    "Q3": "Q3_directional_ready",
    "Q4": "Q4_decision_grade",
}
RECIPE_STATUSES = {"draft", "active", "deprecated", "retired"}
ALIAS_STATUSES = {"deprecated", "retired"}
RECIPE_LIST_FIELDS = {
    "mandatory_baskets",
    "minimum_pass_baskets",
    "strong_validation_baskets",
    "counter_baskets",
}
RECIPE_REQUIRED_FIELDS = {
    "name",
    "version",
    "status",
    "file",
    "primary_rule",
    "applicable_judgment_types",
    *RECIPE_LIST_FIELDS,
    "minimum_pass_rule",
    "high_quality_rule",
    "proxy_rule",
    "source_rule",
    "stop_rule",
    "downgrade_rule",
    "positive_example",
    "failure_example",
}
RECIPE_DOC_HEADINGS = {
    "### 适用问题",
    "### 必需证据",
    "### 强验证证据",
    "### 必查反证",
    "### 最低通过",
    "### 高质量标准",
    "### 代理边界",
    "### 降级规则",
    "### 停止条件",
    "### 成功示例",
    "### 失败示例",
}
REQUIRED_02_JUDGMENT_FIELDS = {"judgment_type", "required_evidence_roles"}
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


class UniqueKeyLoader(yaml.SafeLoader):
    """Reject duplicate mapping keys instead of silently keeping the last one."""


def _construct_mapping(
    loader: UniqueKeyLoader, node: yaml.Node, deep: bool = False
) -> dict[str, Any]:
    mapping: dict[str, Any] = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in mapping:
            raise ValueError(f"YAML duplicate key: {key}")
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping


UniqueKeyLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _construct_mapping
)


def load_yaml(path: Path, errors: list[str]) -> dict[str, Any]:
    if not path.is_file():
        errors.append(f"缺少文件: {path}")
        return {}
    try:
        data = yaml.load(path.read_text(encoding="utf-8-sig"), Loader=UniqueKeyLoader)
    except Exception as exc:  # pragma: no cover - diagnostics
        errors.append(f"{path.name}: YAML 无法解析: {exc}")
        return {}
    if not isinstance(data, dict):
        errors.append(f"{path.name}: 顶层必须是 mapping")
        return {}
    version = str(data.get("schema_version", ""))
    if not VERSION_RE.fullmatch(version):
        errors.append(f"{path.name}: schema_version 必须为 x.y.z，当前为 {version!r}")
    return data


def values_for_keys(value: Any, keys: set[str]) -> Iterable[tuple[str, Any]]:
    if isinstance(value, dict):
        for key, item in value.items():
            if key in keys:
                yield key, item
            yield from values_for_keys(item, keys)
    elif isinstance(value, list):
        for item in value:
            yield from values_for_keys(item, keys)


def ensure_refs_exist(
    refs: Iterable[Any], allowed: set[str], label: str, errors: list[str]
) -> None:
    for ref in refs:
        if ref not in allowed:
            errors.append(f"{label}: 引用未登记 Basket ID {ref}")


def section_for_recipe(text: str, recipe_id: str) -> str:
    pattern = re.compile(
        rf"^## {re.escape(recipe_id)}\b.*?(?=^## (?:ER-[A-Z]+-\d+|Recipe 准入状态)\b|\Z)",
        re.MULTILINE | re.DOTALL,
    )
    match = pattern.search(text)
    return match.group(0) if match else ""


def check_recipe_document(
    root: Path, recipe_id: str, recipe: dict[str, Any], errors: list[str]
) -> None:
    path = root / str(recipe.get("file", ""))
    if not path.is_file():
        errors.append(f"{recipe_id}: Recipe 文件不存在 {recipe.get('file')}")
        return
    section = section_for_recipe(path.read_text(encoding="utf-8"), recipe_id)
    if not section:
        errors.append(f"{recipe_id}: Markdown 缺少唯一完整章节")
        return
    for heading in RECIPE_DOC_HEADINGS:
        if heading not in section:
            errors.append(f"{recipe_id}: Markdown 章节缺少“{heading}”")
    for field in RECIPE_LIST_FIELDS:
        for basket_id in recipe.get(field, []):
            if f"`{basket_id}`" not in section:
                errors.append(f"{recipe_id}: Markdown 未同步 {field} 中的 {basket_id}")


def check_markdown_headings_and_links(
    root: Path, errors: list[str], *, strict_links: bool
) -> None:
    for path in root.rglob("*.md"):
        text = path.read_text(encoding="utf-8")
        headings: set[str] = set()
        for match in re.finditer(r"^(#{1,2})\s+(.+?)\s*$", text, re.MULTILINE):
            heading = f"{match.group(1)} {match.group(2)}"
            if heading in headings:
                errors.append(f"{path.relative_to(root)}: 重复标题 {heading}")
            headings.add(heading)
        for target in re.findall(r"\[[^\]]+\]\(([^)]+)\)", text):
            target = target.strip().strip("<>").split("#", 1)[0]
            if not target or "://" in target or target.startswith("mailto:"):
                continue
            resolved = (path.parent / target).resolve()
            try:
                resolved.relative_to(root.resolve())
                inside_root = True
            except ValueError:
                inside_root = False
            if not inside_root and not strict_links:
                continue
            if not resolved.exists():
                errors.append(f"{path.relative_to(root)}: 本地链接不存在 {target}")


def check_markdown_basket_ids(
    root: Path, basket_ids: set[str], errors: list[str]
) -> None:
    prefixes = {basket_id.split("_", 1)[0] for basket_id in basket_ids}
    for path in root.rglob("*.md"):
        text = path.read_text(encoding="utf-8")
        for candidate in re.findall(r"`([A-Z][A-Z0-9_]+)`", text):
            if candidate.split("_", 1)[0] in prefixes and candidate not in basket_ids:
                errors.append(
                    f"{path.relative_to(root)}: 使用未登记的 Basket ID {candidate}"
                )


def check_source_paths(
    root: Path, value: Any, label: str, errors: list[str]
) -> None:
    if not isinstance(value, dict):
        return
    file_ref = value.get("file")
    if file_ref and not (root / str(file_ref)).is_file():
        errors.append(f"{label}.file 不存在: {file_ref}")
    directory_ref = value.get("directory")
    if directory_ref and not (root / str(directory_ref)).is_dir():
        errors.append(f"{label}.directory 不存在: {directory_ref}")
    current_files = value.get("current_files", {})
    if current_files and not isinstance(current_files, dict):
        errors.append(f"{label}.current_files 必须是 mapping")
    elif isinstance(current_files, dict):
        for key, ref in current_files.items():
            if not (root / str(ref)).is_file():
                errors.append(f"{label}.current_files.{key} 不存在: {ref}")


def normalize_judgment_type(
    judgment_type: str,
    registry: dict[str, Any],
    aliases: dict[str, Any],
) -> str | None:
    if judgment_type in registry:
        return judgment_type
    alias = aliases.get(judgment_type)
    if isinstance(alias, dict):
        target = alias.get("canonical_type")
        return str(target) if target in registry else None
    return None


def validate(root: Path, *, strict_links: bool = False) -> list[str]:
    errors: list[str] = []
    strategy = load_yaml(root / "00_strategy_registry.yaml", errors)
    basket = load_yaml(root / "00_basket_registry.yaml", errors)
    quality = load_yaml(root / "00_quality_gates.yaml", errors)
    source = load_yaml(root / "00_source_registry.yaml", errors)

    basket_registry = basket.get("basket_registry", {})
    basket_ids = set(basket_registry) if isinstance(basket_registry, dict) else set()
    if not basket_ids:
        errors.append("00_basket_registry.yaml: basket_registry 不能为空")
    id_pattern_text = str(basket.get("id_pattern", ""))
    try:
        id_pattern = re.compile(id_pattern_text)
    except re.error as exc:
        errors.append(f"00_basket_registry.yaml: id_pattern 非法: {exc}")
        id_pattern = re.compile(r"a^")
    for basket_id, item in basket_registry.items():
        if not id_pattern.fullmatch(str(basket_id)):
            errors.append(f"Basket ID 不符合稳定格式: {basket_id}")
        if not isinstance(item, dict) or not item.get("label") or not item.get("family"):
            errors.append(f"{basket_id}: 必须提供 label 和 family")
    deprecated_aliases = basket.get("deprecated_aliases", {})
    if not isinstance(deprecated_aliases, dict):
        errors.append("00_basket_registry.yaml: deprecated_aliases 必须是 mapping")
        deprecated_aliases = {}
    for alias, target in deprecated_aliases.items():
        if alias in basket_ids:
            errors.append(f"Basket 旧名与规范 ID 冲突: {alias}")
        if target not in basket_ids:
            errors.append(f"Basket 旧名 {alias} 指向不存在的 ID {target}")

    rules = strategy.get("rules", {})
    if set(rules) != EXPECTED_RULE_IDS:
        errors.append("00_strategy_registry.yaml: A 类规则必须完整覆盖 A01—A09")
    for rule_id, item in rules.items():
        if not isinstance(item, dict):
            errors.append(f"{rule_id}: 规则必须是 mapping")
            continue
        path = root / str(item.get("file", ""))
        if not path.is_file():
            errors.append(f"{rule_id}: 规则文件不存在 {item.get('file')}")
            continue
        refs = item.get("basket_ids", [])
        if not refs:
            errors.append(f"{rule_id}: basket_ids 不能为空")
        ensure_refs_exist(refs, basket_ids, f"{rule_id}.basket_ids", errors)
        text = path.read_text(encoding="utf-8")
        for ref in refs:
            if f"`{ref}`" not in text:
                errors.append(f"{rule_id}: Markdown 未同步 Basket ID {ref}")
        for phrase in ("专项执行协议", "降级规则", "停止规则", "输出到 03 快照"):
            if phrase not in text:
                errors.append(f"{path.relative_to(root)}: 缺少“{phrase}”")

    recipes = strategy.get("evidence_recipes", {})
    if set(recipes) != EXPECTED_RECIPE_IDS:
        errors.append("核心 Recipe 必须且只能包含八个规范 ID")
    for recipe_id, item in recipes.items():
        if not isinstance(item, dict):
            errors.append(f"{recipe_id}: Recipe 必须是 mapping")
            continue
        missing = RECIPE_REQUIRED_FIELDS - set(item)
        if missing:
            errors.append(f"{recipe_id}: 缺少字段 {', '.join(sorted(missing))}")
        if str(item.get("status")) not in RECIPE_STATUSES:
            errors.append(f"{recipe_id}: status 非法 {item.get('status')}")
        if not VERSION_RE.fullmatch(str(item.get("version", ""))):
            errors.append(f"{recipe_id}: version 必须为 x.y.z")
        for field in RECIPE_LIST_FIELDS:
            refs = item.get(field, [])
            if not isinstance(refs, list) or not refs:
                errors.append(f"{recipe_id}.{field}: 必须是非空列表")
                continue
            ensure_refs_exist(refs, basket_ids, f"{recipe_id}.{field}", errors)
            for ref in refs:
                if ref in deprecated_aliases:
                    errors.append(f"{recipe_id}.{field}: 不得使用旧名 {ref}")
        mandatory = set(item.get("mandatory_baskets", []))
        minimum = set(item.get("minimum_pass_baskets", []))
        if not minimum.issubset(mandatory):
            errors.append(f"{recipe_id}: minimum_pass_baskets 必须是 mandatory_baskets 子集")
        primary_rule = item.get("primary_rule")
        if primary_rule not in rules:
            errors.append(f"{recipe_id}: primary_rule 不存在 {primary_rule}")
        else:
            rule_baskets = set(rules[primary_rule].get("basket_ids", []))
            if not mandatory.issubset(rule_baskets):
                missing_in_rule = ", ".join(sorted(mandatory - rule_baskets))
                errors.append(f"{recipe_id}: 主规则 {primary_rule} 未使用相同 Basket ID: {missing_in_rule}")
        check_recipe_document(root, recipe_id, item, errors)

    presets = strategy.get("recipe_presets", {})
    for preset_id, item in presets.items():
        for recipe_id in item.get("recipes", []):
            if recipe_id not in recipes:
                errors.append(f"{preset_id}: 引用不存在的 Recipe {recipe_id}")

    registry = strategy.get("judgment_type_registry", {})
    aliases = strategy.get("judgment_type_migration_aliases", {})
    if "judgment_unit_default_recipe" in strategy:
        errors.append("不得保留第二套 judgment_unit_default_recipe 路由")
    for judgment_type, item in registry.items():
        if not isinstance(item, dict) or "default_recipe" not in item:
            errors.append(f"{judgment_type}: 必须显式且唯一声明 default_recipe")
            continue
        if any(key in item for key in ("evidence_recipe", "evidence_recipes", "mandatory_baskets")):
            errors.append(f"{judgment_type}: 不得重复定义 Recipe 路由或 mandatory_baskets")
        recipe_id = item.get("default_recipe")
        if recipe_id is not None:
            if recipe_id not in recipes:
                errors.append(f"{judgment_type}: default_recipe 不存在 {recipe_id}")
            elif judgment_type not in recipes[recipe_id].get("applicable_judgment_types", []):
                errors.append(f"{judgment_type}: 与 {recipe_id}.applicable_judgment_types 冲突")
        if item.get("primary_rule") not in rules:
            errors.append(f"{judgment_type}: primary_rule 不存在")
        if item.get("required_quality_level") not in EXPECTED_QUALITY_LEVELS:
            errors.append(f"{judgment_type}: required_quality_level 非法")
    if not isinstance(aliases, dict):
        errors.append("judgment_type_migration_aliases 必须是 mapping")
        aliases = {}
    for alias, item in aliases.items():
        if alias in registry:
            errors.append(f"旧 judgment_type 与规范类型冲突: {alias}")
        if not isinstance(item, dict) or item.get("canonical_type") not in registry:
            errors.append(f"旧 judgment_type {alias} 未指向规范类型")
        if isinstance(item, dict) and item.get("status") not in ALIAS_STATUSES:
            errors.append(f"旧 judgment_type {alias}.status 非法")

    upstream_fields = set(
        strategy.get("execution_contract", {}).get(
            "required_02_judgment_unit_fields", []
        )
    )
    if upstream_fields != REQUIRED_02_JUDGMENT_FIELDS:
        errors.append("02→03 输入合同只能强制 judgment_type 与 required_evidence_roles")
    case_contract = strategy.get("evidence_pattern_case_contract", {})
    if set(case_contract.get("required_fields", [])) != REQUIRED_PATTERN_CASE_FIELDS:
        errors.append("Evidence Pattern Case 合同字段不完整")

    quality_levels = quality.get("quality_levels", {})
    if set(quality_levels) != set(EXPECTED_QUALITY_LEVELS):
        errors.append("00_quality_gates.yaml: Q0—Q4 必须完整且唯一")
    for level, semantic_name in EXPECTED_QUALITY_LEVELS.items():
        item = quality_levels.get(level, {})
        if item.get("semantic_name") != semantic_name:
            errors.append(f"{level}: semantic_name 应为 {semantic_name}")
        if not isinstance(item.get("minimum_conditions"), list) or not item.get("minimum_conditions"):
            errors.append(f"{level}: minimum_conditions 不得为空")
        if "evidence_permission" in item or "quality_output_ceiling" in item:
            errors.append(f"{level}: 不得在质量门中重复维护机器派生权限或输出上限")
    for name, data in {
        "00_strategy_registry.yaml": strategy,
        "00_basket_registry.yaml": basket,
        "00_source_registry.yaml": source,
    }.items():
        if "quality_levels" in data:
            errors.append(f"{name}: 不得重复定义 quality_levels")
    derivation = quality.get("derivation_contract", {})
    if derivation.get("inputs") != [
        "evidence_grade",
        "normalized_counterevidence_result",
        "path_readiness_status",
    ]:
        errors.append("00_quality_gates.yaml: derivation_contract.inputs 必须指向唯一三个矩阵输入")
    if "recipe_assessment_contract" not in strategy or "constraint_derivation_contract" not in strategy:
        errors.append("00_strategy_registry.yaml: 缺少 Recipe 检查或统一约束派生合同")

    for key in (
        "evaluation_principles",
        "assessment_layers",
        "conflict_resolution_protocol",
        "missing_data_protocol",
        "derivation_contract",
    ):
        if key not in quality:
            errors.append(f"00_quality_gates.yaml: 缺少 {key}")
    for key in ("source_selection_contract", "source_profile_admission"):
        if key not in source:
            errors.append(f"00_source_registry.yaml: 缺少 {key}")
    guidance = source.get("source_guidance_files", {})
    if not isinstance(guidance, dict):
        errors.append("00_source_registry.yaml: source_guidance_files 必须是 mapping")
    else:
        for key, item in guidance.items():
            check_source_paths(root, item, f"source_guidance_files.{key}", errors)

    work_order = root / "D_研究工作单" / "01_取证任务单.md"
    if not work_order.is_file():
        errors.append("缺少 D_研究工作单/01_取证任务单.md")
    else:
        work_order_text = work_order.read_text(encoding="utf-8")
        for field in (
            "matched_recipe",
            "recipe_version",
            "evidence_grade",
            "counterevidence_result",
            "path_readiness_status",
        ):
            if f"`{field}`" not in work_order_text:
                errors.append(f"D01 工作单未同步交接字段 {field}")

    check_markdown_basket_ids(root, basket_ids, errors)
    check_markdown_headings_and_links(root, errors, strict_links=strict_links)
    return errors


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        type=Path,
        default=DEFAULT_ROOT,
        help="03 取证策略库根目录，默认使用脚本所在目录",
    )
    parser.add_argument(
        "--strict-links",
        action="store_true",
        help="同时校验指向 03 目录外部的本地 Markdown 链接",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    root = args.root.expanduser().resolve()
    errors = validate(root, strict_links=args.strict_links)
    for error in errors:
        print(f"ERROR: {error}")
    if errors:
        print(f"FAIL: 03 取证策略库发现 {len(errors)} 个错误")
        return 1
    print("PASS: 判断类型、Basket、Recipe、统一约束合同、来源路径、文档同步和链接均有效")
    return 0


if __name__ == "__main__":
    sys.exit(main())
