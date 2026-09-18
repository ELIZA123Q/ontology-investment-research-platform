#!/usr/bin/env python3
"""Validate project-level strategic research boundary markers."""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
REQUIRED_MARKERS = {
    "governance/01_架构/00_项目定位与边界.md": (
        "高质量战略研究",
        "不得降级为资料整理",
        "研究范围、读者、交付深度和前瞻窗口可以在对话或 01 受理中确认",
    ),
    "workflow/stages/01_受理/01_投研判断任务受理与整理规范.md": (
        "给谁看、做到多深",
        "研究范围、读者和深度",
        "不得把“浅一点”“快一点”解释为可以跳过证据",
    ),
    "delivery/01_标准/05_投研表达标准.md": (
        "正式 05 输出默认是高质量战略研究表达",
        "不得降级为资料整理",
    ),
    ".agents/skills/touyan-zhanlue-yanjiu-zongkong/SKILL.md": (
        "上位边界就是高质量战略研究",
        "确认研究范围、读者、前瞻窗口和交付深度",
        "不得跳过 01—04",
        "references/strategy-method-router.md",
    ),
    ".agents/skills/touyan-lunzheng-yuyan-bianji/SKILL.md": (
        "研究范围、读者和深度可以在对话或 01 中确认",
        "不得把“范围较小”或“需要快一点”理解为可以降低成品质量",
        "references/ceo-strategy-report-quality-rubric.md",
    ),
    ".agents/skills/touyan-zhanlue-yanjiu-zongkong/references/strategy-method-router.md": (
        "事实或约束 -> 机制 -> 业务结果 -> 战略含义 -> 失效或改判条件",
        "Strategy Choice Cascade",
        "Rumelt Kernel",
        "禁止把相关性写成因果",
    ),
    ".agents/skills/touyan-lunzheng-yuyan-bianji/references/ceo-strategy-report-quality-rubric.md": (
        "CEO 战略报告质量 Rubric",
        "原因、机制、结果和失效条件",
        "强因果词",
    ),
}


def validate_repository() -> list[str]:
    errors: list[str] = []
    for relative, markers in REQUIRED_MARKERS.items():
        path = ROOT / relative
        if not path.is_file():
            errors.append(f"missing required file: {relative}")
            continue
        text = path.read_text(encoding="utf-8")
        for marker in markers:
            if marker not in text:
                errors.append(f"{relative} lacks marker: {marker}")
    return errors


def main() -> int:
    errors = validate_repository()
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        print(f"STRATEGIC_RESEARCH_BOUNDARY_RETURN_REQUIRED: {len(errors)} error(s)")
        return 1
    print("STRATEGIC_RESEARCH_BOUNDARY_PASS: 项目边界、01受理、05表达和Agent入口均保留高质量战略研究约束。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
