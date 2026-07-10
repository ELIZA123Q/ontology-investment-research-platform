#!/usr/bin/env python3
"""只读校验 02 框架库的结构、引用、来源和本体标识符。"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Dict, Iterable, List, Set, Tuple


REQUIRED_FRONT_MATTER = ("framework_id", "name", "library", "version")
REQUIRED_SECTIONS = (
    "适用问题与边界",
    "核心判断任务与关键口径",
    "核心问题树",
    "分析模块与传导机制",
    "最低证据与交叉验证",
    "其他可能解释、逻辑失效与停止条件",
    "情景设置",
    "本体映射",
    "组合与裁剪",
    "权威依据卡",
    "框架自检",
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


def parse_front_matter(text: str) -> Tuple[Dict[str, str], str]:
    if not text.startswith("---\n"):
        return {}, text
    end = text.find("\n---\n", 4)
    if end < 0:
        return {}, text
    raw = text[4:end]
    values: Dict[str, str] = {}
    for line in raw.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        values[key.strip()] = value.strip()
    return values, text[end + 5 :]


def parse_builds_on(value: str) -> List[str]:
    value = value.strip()
    if value.startswith("[") and value.endswith("]"):
        value = value[1:-1]
    return [item.strip().strip("'\"") for item in value.split(",") if item.strip()]


def framework_files(root: Path) -> List[Path]:
    files = list((root / "基础框架库").glob("*.md"))
    files += list((root / "行业框架库").glob("**/*.md"))
    return sorted(path for path in files if not path.name.startswith("00_"))


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


def validate(root: Path) -> Tuple[List[str], List[str], int]:
    workspace = root.parent
    files = framework_files(root)
    ontology_ids = ontology_identifiers(workspace)
    errors: List[str] = []
    warnings: List[str] = []
    ids: Dict[str, Path] = {}
    metadata: Dict[Path, Dict[str, str]] = {}

    for path in files:
        text = path.read_text(encoding="utf-8")
        front, _ = parse_front_matter(text)
        metadata[path] = front
        for key in REQUIRED_FRONT_MATTER:
            if not front.get(key):
                errors.append(f"{path}: 缺少 front matter 字段 {key}")
        framework_id = front.get("framework_id")
        if framework_id:
            if framework_id in ids:
                errors.append(f"{path}: framework_id {framework_id} 与 {ids[framework_id]} 重复")
            else:
                ids[framework_id] = path

    known_ids = set(ids)
    for path in files:
        text = path.read_text(encoding="utf-8")
        front = metadata[path]
        relative = path.relative_to(root)

        headings = re.findall(r"^##\s+(\d+)\.\s+(.+?)\s*$", text, flags=re.MULTILINE)
        if len(headings) != 11:
            errors.append(f"{relative}: 应有11个编号二级标题，实际为{len(headings)}")
        else:
            for index, ((number, title), expected) in enumerate(zip(headings, REQUIRED_SECTIONS), 1):
                if number != str(index) or title != expected:
                    errors.append(
                        f"{relative}: 第{index}节应为“## {index}. {expected}”，实际为“## {number}. {title}”"
                    )

        for dependency in parse_builds_on(front.get("builds_on", "")):
            if dependency not in known_ids:
                errors.append(f"{relative}: builds_on 引用了不存在的 {dependency}")

        if "## 10. 权威依据卡" in text:
            source_section = text.split("## 10. 权威依据卡", 1)[1].split("## 11.", 1)[0]
            urls = re.findall(r"https?://[^)\s]+", source_section)
            domains = {re.sub(r"^https?://", "", url).split("/", 1)[0].lower() for url in urls}
            is_industry = "行业框架库" in str(relative)
            if is_industry and len(domains) < 2:
                errors.append(f"{relative}: 权威依据卡少于两个独立网络来源")
            if is_industry and not any(
                authority in domain for domain in domains for authority in CHINA_AUTHORITY_DOMAINS
            ):
                errors.append(f"{relative}: 行业框架缺少中国政府、标准或全国性行业组织来源")
            if "多来源方法论候选" not in source_section:
                errors.append(f"{relative}: 权威依据卡未标明“多来源方法论候选”")

        if "## 8. 本体映射" in text and "## 9." in text:
            mapping = text.split("## 8. 本体映射", 1)[1].split("## 9.", 1)[0]
            formal_mapping = mapping.split("**任务候选或本体缺口**", 1)[0]
            used_ids = set(re.findall(r"`([A-Za-z][A-Za-z0-9_]*)`", formal_mapping))
            unknown = sorted(used_ids - ontology_ids)
            if unknown:
                errors.append(f"{relative}: 本体映射引用未知标识符 {', '.join(unknown)}")

    link_files = [root / "README.md"] + list(root.glob("行业框架库/**/*.md"))
    for path in link_files:
        text = path.read_text(encoding="utf-8")
        for raw_target, resolved in local_markdown_links(path, text):
            if not resolved.exists():
                errors.append(f"{path.relative_to(root)}: 内部链接不存在 {raw_target}")

    expected_semiconductor_ids = {
        "IF-SC-01", "IF-MEM-01", "IF-APC-01", "IF-OSAT-01", "IF-OPTO-01", "IF-LOC-01",
        "IF-APKG-01", "IF-DES-01", "IF-FOUNDRY-01", "IF-EQP-01", "IF-MAT-01", "IF-EDAIP-01",
        "IF-PWR-01", "IF-AUTO-01", "IF-SPC-01", "IF-AI-01",
    }
    semiconductor_ids = {
        front.get("framework_id", "")
        for path, front in metadata.items()
        if path.parent.name == "半导体"
    }
    if semiconductor_ids != expected_semiconductor_ids:
        missing = sorted(expected_semiconductor_ids - semiconductor_ids)
        extra = sorted(semiconductor_ids - expected_semiconductor_ids)
        if missing:
            errors.append(f"半导体核心框架缺失: {', '.join(missing)}")
        if extra:
            warnings.append(f"半导体核心框架出现未登记ID: {', '.join(extra)}")

    return errors, warnings, len(files)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parent,
        help="02框架库目录，默认使用脚本所在目录",
    )
    args = parser.parse_args()
    errors, warnings, count = validate(args.root.resolve())
    for warning in warnings:
        print(f"WARN: {warning}")
    for error in errors:
        print(f"ERROR: {error}")
    if errors:
        print(f"FAIL: 校验{count}个框架，发现{len(errors)}个错误、{len(warnings)}个警告")
        return 1
    print(f"PASS: 校验{count}个框架，0个错误、{len(warnings)}个警告")
    return 0


if __name__ == "__main__":
    sys.exit(main())
