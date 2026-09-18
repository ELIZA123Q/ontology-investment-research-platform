#!/usr/bin/env python3
"""Validate CEO-facing strategic report structure.

This checker does not judge research depth. It blocks recurring delivery failures:
missing executive summary, process/disclaimer chapters in the main body, and reports
that were not explicitly produced with the CEO strategy template.
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PROCESS_HEADING_TERMS = (
    "研究问题",
    "结论边界",
    "研究边界",
    "研究过程",
    "研究设计",
    "方法说明",
    "取证过程",
    "证据台账",
    "免责声明",
    "合规声明",
)
WEAK_OPENERS = (
    "本文",
    "本报告",
    "本节",
    "首先",
    "其次",
    "此外",
    "另外",
    "从",
    "在",
)
REQUIRED_MARKERS = (
    "ceo_strategy_report: true",
    "## 摘要",
    "## 附录",
)
CAUSAL_MARKERS = (
    "机制",
    "失效条件",
)


def _strip_code(text: str) -> str:
    return re.sub(r"```.*?```", "", text, flags=re.S)


def _headings(text: str) -> list[tuple[int, str]]:
    result: list[tuple[int, str]] = []
    for line in text.splitlines():
        match = re.match(r"^(#{1,6})\s+(.+?)\s*$", line)
        if match:
            result.append((len(match.group(1)), match.group(2).strip()))
    return result


def _main_body_headings(headings: list[tuple[int, str]]) -> list[str]:
    body: list[str] = []
    in_appendix = False
    for level, title in headings:
        if level == 2 and title.startswith("附录"):
            in_appendix = True
            continue
        if level == 2 and not in_appendix and title != "摘要":
            body.append(title)
    return body


def _paragraphs(text: str) -> list[str]:
    clean = _strip_code(text)
    blocks = [block.strip() for block in re.split(r"\n\s*\n", clean) if block.strip()]
    paragraphs: list[str] = []
    for block in blocks:
        if block.startswith(("#", "|", "-", ">", "<!--")):
            continue
        if re.match(r"^\*\*[^*]+：\*\*", block):
            continue
        paragraphs.append(re.sub(r"\s+", " ", block))
    return paragraphs


def validate_text(text: str) -> list[str]:
    errors: list[str] = []
    for marker in REQUIRED_MARKERS:
        if marker not in text:
            errors.append(f"missing required marker: {marker}")
    for marker in CAUSAL_MARKERS:
        if marker not in text:
            errors.append(f"CEO report must preserve causal clarity marker: {marker}")

    headings = _headings(text)
    h2_titles = [title for level, title in headings if level == 2]
    if "摘要" not in h2_titles:
        errors.append("CEO report must have ## 摘要")
    if not any(title.startswith("附录") for title in h2_titles):
        errors.append("CEO report must put boundaries/process/sources in an appendix")

    body_headings = _main_body_headings(headings)
    if len(body_headings) < 4:
        errors.append("CEO report needs at least four substantive body chapters before appendix")
    for title in body_headings:
        for term in PROCESS_HEADING_TERMS:
            if term in title:
                errors.append(f"process/disclaimer heading cannot be main body chapter: {title}")
        if title.endswith(("分析", "研究", "背景", "概述")) and not re.match(r"^[一二三四五六七八九十]+、", title):
            errors.append(f"heading should be a substantive judgment, not a generic label: {title}")

    weak_count = 0
    checked = 0
    for paragraph in _paragraphs(text):
        if "<" in paragraph and ">" in paragraph:
            continue
        first_sentence = re.split(r"[。；;.!?？]", paragraph, maxsplit=1)[0].strip()
        if not first_sentence:
            continue
        checked += 1
        if first_sentence.startswith(WEAK_OPENERS):
            weak_count += 1
    if checked >= 4 and weak_count > max(1, checked // 3):
        errors.append("too many paragraphs start with process/background openers instead of viewpoint sentences")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="校验 CEO 战略报告正文结构")
    parser.add_argument("path", type=Path)
    args = parser.parse_args()
    errors = validate_text(args.path.read_text(encoding="utf-8"))
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        print(f"CEO_STRATEGY_REPORT_RETURN_REQUIRED: {len(errors)} error(s)")
        return 1
    print("CEO_STRATEGY_REPORT_PASS: CEO 战略报告结构符合摘要、正文结论化和附录边界要求。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
