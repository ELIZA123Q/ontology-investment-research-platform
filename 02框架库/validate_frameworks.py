#!/usr/bin/env python3
"""只读校验 02 框架库的结构、引用、来源和本体标识符。

适配当前结构：
- 基础框架：11 节正式框架模板
- 半导体行业：8 个主框架（两横六纵）+ 10 张场景卡
- 场景卡、治理文档、README、总纲不按正式框架模板验收
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set, Tuple


REQUIRED_FRONT_MATTER = ("framework_id", "name", "library", "version")
REQUIRED_SECTIONS = (
    "适用问题与边界",
    "核心判断任务与关键口径",
    "核心问题树",
    "分析模块与传导机制",
    "最低证据与交叉验证",
    "竞争解释、阻断与停止条件",
    "情景设置",
    "本体映射",
    "组合与裁剪",
    "权威依据卡",
    "框架自检",
)
REQUIRED_SCENARIO_FRONT_MATTER = ("document_type", "scenario_id", "name", "version")
REQUIRED_SCENARIO_SECTIONS = (
    "适用问题",
    "推荐主框架组合",
    "最小判断链",
    "关键变量",
    "最低证据",
    "主要反证与阻断",
    "停止条件",
    "常见误判",
    "输出到 03 的证据要求",
)
CHINA_AUTHORITY_DOMAINS = (
    "gov.cn",
    "miit.gov.cn",
    "stats.gov.cn",
    "samr.gov.cn",
    "sac.gov.cn",
    "cac.gov.cn",
    "csia.net.cn",
    "caict.ac.cn",
    "ccsa.org.cn",
)
CHINA_AUTHORITY_KEYWORDS = (
    "中国政府",
    "政府部门",
    "国家统计",
    "国家标准化",
    "行业协会",
    "产业联盟",
    "标准组织",
    "中国信通院",
    "中国半导体行业协会",
    "中国通信标准化协会",
)
DEPRECATED_INDUSTRY_PREFIX = "行业框架库/半导体/"

EXPECTED_SEMICONDUCTOR_FRAMEWORK_IDS = {
    "IF-SC-01",
    "IF-LOC-01",
    "IF-APP-01",
    "IF-DES-01",
    "IF-FAB-01",
    "IF-PKG-01",
    "IF-EQP-01",
    "IF-MAT-01",
}
EXPECTED_SEMICONDUCTOR_SCENARIO_IDS = {
    "SCN-MEM-HBM",
    "SCN-AI",
    "SCN-AUTO",
    "SCN-PWR-SIC",
    "SCN-OPTO",
    "SCN-GEO",
    "SCN-LOC-EQP",
    "SCN-LOC-MAT",
    "SCN-MEM-CYCLE",
    "SCN-PKG-BTL",
}


def parse_front_matter(text: str) -> Tuple[Dict[str, str], str]:
    if not text.startswith("---\n"):
        return {}, text
    end = text.find("\n---\n", 4)
    if end < 0:
        # 兼容异常分隔线（如遗留候选卡）
        alt = re.search(r"\n-{3,}\n", text[4:])
        if not alt:
            return {}, text
        end = 4 + alt.start()
        body_start = 4 + alt.end()
    else:
        body_start = end + 5
    raw = text[4:end]
    values: Dict[str, str] = {}
    for line in raw.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        values[key.strip()] = value.strip().strip("\"'")
    return values, text[body_start:]


def parse_builds_on(value: str) -> List[str]:
    value = value.strip()
    if value.startswith("[") and value.endswith("]"):
        value = value[1:-1]
    return [item.strip().strip("'\"") for item in value.split(",") if item.strip()]


def classify_asset(path: Path, root: Path, front: Dict[str, str]) -> str:
    """返回 framework / scenario_card / skip / legacy。"""
    rel = path.relative_to(root)
    parts = rel.parts
    name = path.name
    doc_type = front.get("document_type", "")

    if name == "README.md":
        return "skip"
    if name.startswith("00_"):
        return "skip"
    if "03_治理与迁移" in parts:
        return "skip"
    if doc_type in {
        "industry_framework_governance",
        "scenario_card_guide",
        "framework_admission_checklist",
        "framework_usage_record_template",
    }:
        return "skip"

    if "02_场景卡" in parts or doc_type == "semiconductor_scenario_card":
        if "02_场景卡" in parts:
            return "scenario_card"
        return "legacy"

    if parts[0] == "基础框架库":
        return "framework"
    if "01_主框架" in parts:
        return "framework"
    if parts[:2] == ("行业框架库", "光通信"):
        return "framework"
    if front.get("framework_id"):
        return "framework"
    if parts[:2] == ("行业框架库", "半导体行业"):
        return "legacy"
    return "skip"


def iter_markdown_assets(root: Path) -> List[Path]:
    files = list((root / "基础框架库").glob("*.md"))
    files += list((root / "行业框架库").glob("**/*.md"))
    return sorted(files)


def ontology_identifiers(workspace: Path) -> Set[str]:
    identifiers: Set[str] = set()
    ontology_dirs = (workspace / "一级通用本体规范", workspace / "二级半导体领域本体规范")
    key_re = re.compile(r"^\s{2,}([A-Za-z][A-Za-z0-9_]*):(?:\s|$)")
    id_re = re.compile(r"\bid:\s*([A-Za-z][A-Za-z0-9_]*)")
    for directory in ontology_dirs:
        for path in directory.glob("*.yaml"):
            for line in path.read_text(encoding="utf-8").splitlines():
                key_match = key_re.match(line)
                if key_match:
                    identifiers.add(key_match.group(1))
                identifiers.update(id_re.findall(line))
    return identifiers


def local_markdown_links(path: Path, text: str) -> Iterable[Tuple[str, Path]]:
    for target in re.findall(r"\[[^\]]+\]\(([^)]+)\)", text):
        target = target.strip().strip("<>")
        if "://" in target or target.startswith("#") or not target.split("#", 1)[0].endswith(".md"):
            continue
        clean = target.split("#", 1)[0]
        yield target, (path.parent / clean).resolve()


def numbered_headings(text: str) -> List[Tuple[str, str]]:
    return re.findall(r"^##\s+(\d+)\.\s+(.+?)\s*$", text, flags=re.MULTILINE)


def validate_numbered_sections(
    relative: Path,
    text: str,
    expected: Tuple[str, ...],
    errors: List[str],
) -> None:
    headings = numbered_headings(text)
    if len(headings) != len(expected):
        errors.append(f"{relative}: 应有{len(expected)}个编号二级标题，实际为{len(headings)}")
        return
    for index, ((number, title), expected_title) in enumerate(zip(headings, expected), 1):
        if number != str(index) or title != expected_title:
            errors.append(
                f"{relative}: 第{index}节应为“## {index}. {expected_title}”，"
                f"实际为“## {number}. {title}”"
            )


def extract_authority_section(text: str) -> Optional[str]:
    if "## 10. 权威依据卡" not in text:
        return None
    return text.split("## 10. 权威依据卡", 1)[1].split("## 11.", 1)[0]


def validate_authority_card(relative: Path, text: str, library: str, errors: List[str]) -> None:
    source_section = extract_authority_section(text)
    if source_section is None:
        return

    urls = re.findall(r"https?://[^)\s]+", source_section)
    domains = {re.sub(r"^https?://", "", url).split("/", 1)[0].lower() for url in urls}
    is_industry = str(relative).startswith("行业框架库")
    is_semiconductor_main = "半导体行业" in str(relative) and "01_主框架" in str(relative)

    has_china_domain = any(
        authority in domain for domain in domains for authority in CHINA_AUTHORITY_DOMAINS
    )
    has_china_keyword = any(keyword in source_section for keyword in CHINA_AUTHORITY_KEYWORDS)

    if is_industry:
        if urls:
            if len(domains) < 2:
                errors.append(f"{relative}: 权威依据卡少于两个独立网络来源")
            if not has_china_domain and not (is_semiconductor_main and has_china_keyword):
                errors.append(f"{relative}: 行业框架缺少中国政府、标准或全国性行业组织来源")
        elif is_semiconductor_main:
            # 新版主框架允许“来源类型”清单，但仍需覆盖中国权威来源类型
            if not has_china_keyword:
                errors.append(f"{relative}: 权威依据卡未覆盖中国政府、标准或全国性行业组织来源类型")
            type_hits = sum(
                1
                for marker in (
                    "中国政府",
                    "国家统计",
                    "行业协会",
                    "国际半导体",
                    "原始公司披露",
                    "机构研究",
                )
                if marker in source_section
            )
            if type_hits < 2:
                errors.append(f"{relative}: 权威依据卡来源类型过少，至少需要两类独立来源类型")
        else:
            errors.append(f"{relative}: 权威依据卡少于两个独立网络来源")
            if not has_china_keyword:
                errors.append(f"{relative}: 行业框架缺少中国政府、标准或全国性行业组织来源")

    # 基础框架与仍使用表格写法的行业框架，保留“多来源方法论候选”标记
    uses_evidence_table = "证据等级" in source_section or "主要来源" in source_section
    if library == "base" or uses_evidence_table:
        if "多来源方法论候选" not in source_section:
            errors.append(f"{relative}: 权威依据卡未标明“多来源方法论候选”")


def extract_framework_refs(text: str) -> Set[str]:
    return set(re.findall(r"\b(?:IF|BF|SCN)-[A-Z]+(?:-[A-Z]+)?-\d+\b|\bSCN-[A-Z]+(?:-[A-Z]+)?\b", text))


def validate(root: Path) -> Tuple[List[str], List[str], int, int]:
    workspace = root.parent
    files = iter_markdown_assets(root)
    ontology_ids = ontology_identifiers(workspace)
    errors: List[str] = []
    warnings: List[str] = []
    ids: Dict[str, Path] = {}
    scenario_ids: Dict[str, Path] = {}
    metadata: Dict[Path, Dict[str, str]] = {}
    classes: Dict[Path, str] = {}

    for path in files:
        text = path.read_text(encoding="utf-8")
        front, _ = parse_front_matter(text)
        metadata[path] = front
        asset_class = classify_asset(path, root, front)
        classes[path] = asset_class

        if asset_class == "legacy":
            warnings.append(f"{path.relative_to(root)}: 未纳入新结构的遗留文档，已跳过正式校验")
            continue
        if asset_class == "skip":
            continue

        if asset_class == "framework":
            for key in REQUIRED_FRONT_MATTER:
                if not front.get(key):
                    errors.append(f"{path}: 缺少 front matter 字段 {key}")
            framework_id = front.get("framework_id")
            if framework_id:
                if framework_id in ids:
                    errors.append(f"{path}: framework_id {framework_id} 与 {ids[framework_id]} 重复")
                else:
                    ids[framework_id] = path
        elif asset_class == "scenario_card":
            for key in REQUIRED_SCENARIO_FRONT_MATTER:
                if not front.get(key):
                    errors.append(f"{path}: 缺少 front matter 字段 {key}")
            if front.get("document_type") and front.get("document_type") != "semiconductor_scenario_card":
                errors.append(f"{path}: document_type 应为 semiconductor_scenario_card")
            scenario_id = front.get("scenario_id")
            if scenario_id:
                if scenario_id in scenario_ids:
                    errors.append(f"{path}: scenario_id {scenario_id} 与 {scenario_ids[scenario_id]} 重复")
                else:
                    scenario_ids[scenario_id] = path

    known_ids = set(ids)
    known_scenario_ids = set(scenario_ids)

    for path in files:
        asset_class = classes[path]
        if asset_class not in {"framework", "scenario_card"}:
            continue
        text = path.read_text(encoding="utf-8")
        front = metadata[path]
        relative = path.relative_to(root)

        if asset_class == "framework":
            validate_numbered_sections(relative, text, REQUIRED_SECTIONS, errors)

            for dependency in parse_builds_on(front.get("builds_on", "")):
                if dependency not in known_ids:
                    errors.append(f"{relative}: builds_on 引用了不存在的 {dependency}")

            validate_authority_card(relative, text, front.get("library", ""), errors)

            if "## 8. 本体映射" in text and "## 9." in text:
                mapping = text.split("## 8. 本体映射", 1)[1].split("## 9.", 1)[0]
                formal_mapping = mapping.split("**任务候选或本体缺口**", 1)[0]
                used_ids = set(re.findall(r"`([A-Za-z][A-Za-z0-9_]*)`", formal_mapping))
                unknown = sorted(used_ids - ontology_ids)
                if unknown:
                    errors.append(f"{relative}: 本体映射引用未知标识符 {', '.join(unknown)}")

        elif asset_class == "scenario_card":
            validate_numbered_sections(relative, text, REQUIRED_SCENARIO_SECTIONS, errors)
            if "## 2. 推荐主框架组合" in text:
                combo = text.split("## 2. 推荐主框架组合", 1)[1].split("## 3.", 1)[0]
                refs = extract_framework_refs(combo)
                framework_refs = {ref for ref in refs if ref.startswith(("IF-", "BF-"))}
                scenario_refs = {ref for ref in refs if ref.startswith("SCN-")}
                unknown_frameworks = sorted(framework_refs - known_ids)
                unknown_scenarios = sorted(scenario_refs - known_scenario_ids)
                if unknown_frameworks:
                    errors.append(
                        f"{relative}: 推荐主框架组合引用了不存在的框架 "
                        f"{', '.join(unknown_frameworks)}"
                    )
                if unknown_scenarios:
                    errors.append(
                        f"{relative}: 推荐主框架组合引用了不存在的场景卡 "
                        f"{', '.join(unknown_scenarios)}"
                    )

    link_files = [root / "README.md"] + list(root.glob("行业框架库/**/*.md"))
    for path in link_files:
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        for raw_target, resolved in local_markdown_links(path, text):
            if resolved.exists():
                continue
            # 旧扁平目录链接视为迁移警告，不再阻断新结构验收
            if raw_target.startswith(DEPRECATED_INDUSTRY_PREFIX) or f"/{DEPRECATED_INDUSTRY_PREFIX}" in raw_target:
                warnings.append(f"{path.relative_to(root)}: 内部链接指向已废弃路径 {raw_target}")
            else:
                errors.append(f"{path.relative_to(root)}: 内部链接不存在 {raw_target}")

    semiconductor_framework_ids = {
        front.get("framework_id", "")
        for path, front in metadata.items()
        if classes.get(path) == "framework" and "半导体行业" in path.parts and "01_主框架" in path.parts
    }
    if semiconductor_framework_ids != EXPECTED_SEMICONDUCTOR_FRAMEWORK_IDS:
        missing = sorted(EXPECTED_SEMICONDUCTOR_FRAMEWORK_IDS - semiconductor_framework_ids)
        extra = sorted(semiconductor_framework_ids - EXPECTED_SEMICONDUCTOR_FRAMEWORK_IDS)
        if missing:
            errors.append(f"半导体主框架缺失: {', '.join(missing)}")
        if extra:
            warnings.append(f"半导体主框架出现未登记ID: {', '.join(extra)}")

    if known_scenario_ids != EXPECTED_SEMICONDUCTOR_SCENARIO_IDS:
        missing = sorted(EXPECTED_SEMICONDUCTOR_SCENARIO_IDS - known_scenario_ids)
        extra = sorted(known_scenario_ids - EXPECTED_SEMICONDUCTOR_SCENARIO_IDS)
        if missing:
            errors.append(f"半导体场景卡缺失: {', '.join(missing)}")
        if extra:
            warnings.append(f"半导体场景卡出现未登记ID: {', '.join(extra)}")

    framework_count = sum(1 for asset_class in classes.values() if asset_class == "framework")
    scenario_count = sum(1 for asset_class in classes.values() if asset_class == "scenario_card")
    return errors, warnings, framework_count, scenario_count


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parent,
        help="02框架库目录，默认使用脚本所在目录",
    )
    args = parser.parse_args()
    errors, warnings, framework_count, scenario_count = validate(args.root.resolve())
    for warning in warnings:
        print(f"WARN: {warning}")
    for error in errors:
        print(f"ERROR: {error}")
    if errors:
        print(
            f"FAIL: 校验{framework_count}个框架、{scenario_count}张场景卡，"
            f"发现{len(errors)}个错误、{len(warnings)}个警告"
        )
        return 1
    print(
        f"PASS: 校验{framework_count}个框架、{scenario_count}张场景卡，"
        f"0个错误、{len(warnings)}个警告"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
