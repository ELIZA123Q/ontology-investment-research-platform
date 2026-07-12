#!/usr/bin/env python3
"""检查 04 判断执行与推理规则库的分类资产和职责边界。"""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent

REQUIRED_FILES = {
    "README.md": ["为什么按 A/B/C/D 分类", "与 02、03、05 的边界", "维护与准入规则"],
    "00_研究员裁决工作台.md": ["四类判断对象", "统一的 J0—J4 判断等级", "五种常见处理方式"],
    "00_职责边界与调用规则.md": ["进入 04 前必须具备什么", "04 的固定动作"],
    "A_单项判断裁决/A00_A类选择与判断等级规则.md": ["先选主问题，再选主方法", "什么时候不能用", "统一判断等级"],
    "A_单项判断裁决/A01_状态判断.md": ["判断步骤", "判断结果"],
    "A_单项判断裁决/A02_趋势判断.md": ["判断步骤", "判断结果"],
    "A_单项判断裁决/A03_阶段判断.md": ["判断步骤", "判断结果"],
    "A_单项判断裁决/A04_机制判断.md": ["判断步骤", "判断结果"],
    "A_单项判断裁决/A05_归因判断.md": ["判断步骤", "判断结果"],
    "A_单项判断裁决/A06_传导判断.md": ["判断步骤", "判断结果"],
    "A_单项判断裁决/A07_分化判断.md": ["判断步骤", "判断结果"],
    "A_单项判断裁决/A08_影响判断.md": ["判断步骤", "判断结果"],
    "A_单项判断裁决/A09_预期差判断.md": ["判断步骤", "判断结果"],
    "A_单项判断裁决/A10_投资命题裁决.md": ["五道判断前提", "判断步骤", "判断结果", "不是投资建议"],
    "B_推理路径验证/B01_路径成立与逐段放行.md": ["每段六问", "路径状态"],
    "B_推理路径验证/B02_中间承接时滞与阻断.md": ["三类承接", "时滞判断"],
    "B_推理路径验证/B03_规则适用与多路径合成.md": ["规则适用评价", "多路径如何合成"],
    "C_反证与竞争解释/C01_反证命中与裁决动作.md": ["反证先定位，再动作", "五步判断"],
    "C_反证与竞争解释/C02_竞争解释比较.md": ["对称比较表", "判断处理"],
    "C_反证与竞争解释/C03_冲突证据裁决.md": ["真冲突还是表面冲突", "四种处理"],
    "D_改判与复盘/D01_改判触发与判断版本.md": ["改判是判断等级的状态迁移", "改判在首次形成判断时就写好", "五种版本动作", "投资命题的双重更新"],
    "D_改判与复盘/D02_历史复盘与方法反馈.md": ["第一版的定位", "反馈去向"],
    "01_判断模式库.md": ["旧链接兼容"],
    "02_路径与规则评价方法.md": ["旧链接兼容"],
    "03_反证与竞争解释处理规则.md": ["旧链接兼容"],
    "04_改判与复盘规则.md": ["旧链接兼容"],
    "05_维护与准入标准.md": ["维护与准入规则已并入"],
}

BOUNDARY_FILES = {
    "02框架库/README.md": ["03取证策略库", "04推理方法库"],
    "03取证策略库/README.md": ["02框架库", "04推理方法库"],
    "04_推理输出规范.md": ["04推理方法库/README.md", "不新增判断路径"],
    "00_项目定位与边界.md": ["02 决定判断什么", "03 决定什么证据可以用", "04 决定合格证据"],
}


def main() -> int:
    errors: list[str] = []

    for relative_path, required_phrases in REQUIRED_FILES.items():
        path = ROOT / relative_path
        if not path.exists():
            errors.append(f"缺少必需文件：04推理方法库/{relative_path}")
            continue
        text = path.read_text(encoding="utf-8")
        for phrase in required_phrases:
            if phrase not in text:
                errors.append(f"{relative_path} 缺少必需章节或说明：{phrase}")

    for relative_path, required_phrases in BOUNDARY_FILES.items():
        path = PROJECT_ROOT / relative_path
        if not path.exists():
            errors.append(f"缺少边界文件：{relative_path}")
            continue
        text = path.read_text(encoding="utf-8")
        for phrase in required_phrases:
            if phrase not in text:
                errors.append(f"{relative_path} 缺少三库边界说明：{phrase}")

    if errors:
        print("METHOD_LIBRARY_RETURN_REQUIRED")
        for error in errors:
            print(f"- {error}")
        return 1

    print("METHOD_LIBRARY_PASS: A/B/C/D 分类资产、兼容入口及 02/03/04/05 边界有效。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
