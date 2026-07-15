#!/usr/bin/env python3
"""检查 Markdown 正文是否重新引入不适合研究交流的工程化表达。"""

from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent
GLOSSARY = ROOT / "00_全局" / "00_项目定位与边界.md"

# 这些词可以在项目说明的反例中出现，但不应出现在其他文档的自然语言正文中。
FORBIDDEN = (
    "门禁",
    "放行",
    "证据篮子",
    "取证配方",
    "使用上限",
    "运行实例",
    "运行视图",
    "强绑定",
    "硬桥接",
    "任务合同",
    "取证合同",
    "证据合同",
    "研究价值门",
    "语义审阅",
    "确定性校验",
    "研究员抓手",
    "本体切片",
    "改判闸门",
    "消费断点",
    "可消费",
    "answer first",
    "overclaim",
    "阶段包",
    "本体同源",
    "机器事实",
    "派生矩阵",
    "包级准入",
    "质量门槛槛",
    "机器可读唯一真相",
    "调用路由",
    "method_library_usage",
    "formal_a08",
)

AWKWARD = ("必需必要", "可可", "本次本次", "判断判断")


def visible_prose(line: str) -> str:
    """移除代码和链接地址，只检查读者实际阅读的自然语言。"""
    line = re.sub(r"`[^`]*`", "", line)
    line = re.sub(r"\]\([^)]*\)", "]", line)
    return line


def main() -> int:
    failures: list[str] = []
    for path in sorted(ROOT.rglob("*.md")):
        if path == GLOSSARY or ".git" in path.parts:
            continue
        fence_marker: str | None = None
        for number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            fence_match = re.match(r"^\s*(`{3,}|~{3,})", raw_line)
            if fence_match:
                marker = fence_match.group(1)[0]
                if fence_marker is None:
                    fence_marker = marker
                elif fence_marker == marker:
                    fence_marker = None
                continue
            if fence_marker is not None:
                continue
            line = visible_prose(raw_line)
            matched = [term for term in (*FORBIDDEN, *AWKWARD) if term.lower() in line.lower()]
            if raw_line.strip() == "****":
                matched.append("空粗体标记")
            if matched:
                relative = path.relative_to(ROOT)
                failures.append(f"{relative}:{number}: {', '.join(matched)}")

    if failures:
        print("MARKDOWN_LANGUAGE_RETURN_REQUIRED")
        print("\n".join(failures))
        return 1

    print("MARKDOWN_LANGUAGE_PASS: Markdown 正文未发现禁用工程化表达或明显病句。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
