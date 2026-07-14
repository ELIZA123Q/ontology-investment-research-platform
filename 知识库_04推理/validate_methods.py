#!/usr/bin/env python3
"""校验 04 推理方法库的资产、接口、值域、链接和职责边界。"""

from __future__ import annotations

import re
from pathlib import Path
from urllib.parse import unquote


ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent

COMMON_A_SECTIONS = ["最低输入", "判断步骤", "判断结果", "必须输出", "输出上限与下一方法", "强制退回条件"]

REQUIRED_FILES = {
    "README.md": [
        "库里有什么",
        "本库与其他资产的边界",
        "如何使用",
        "常见任务的最小调用组合",
        "统一执行接口与判断记录",
        "质量与准入标准",
        "案例回归",
    ],
    "A_单项判断裁决/A00_A类选择与判断等级规则.md": [
        "先选主问题，再选主方法",
        "统一执行契约",
        "什么时候不能用",
        "统一判断等级",
    ],
    "A_单项判断裁决/A01_状态判断.md": COMMON_A_SECTIONS,
    "A_单项判断裁决/A02_趋势判断.md": COMMON_A_SECTIONS,
    "A_单项判断裁决/A03_阶段判断.md": COMMON_A_SECTIONS,
    "A_单项判断裁决/A04_机制判断.md": COMMON_A_SECTIONS,
    "A_单项判断裁决/A05_归因判断.md": COMMON_A_SECTIONS,
    "A_单项判断裁决/A06_传导判断.md": COMMON_A_SECTIONS,
    "A_单项判断裁决/A07_分化判断.md": COMMON_A_SECTIONS,
    "A_单项判断裁决/A08_影响判断.md": COMMON_A_SECTIONS,
    "A_单项判断裁决/A09_预期差判断.md": COMMON_A_SECTIONS,
    "A_单项判断裁决/A10_投资命题裁决.md": [
        "综合裁决定位",
        "最低输入",
        "进入条件",
        "五道判断前提",
        "判断步骤",
        "判断结果",
        "输出上限与下一方法",
        "必须输出",
        "强制退回条件",
        "不是投资建议",
    ],
    "B_推理路径验证/B01_路径成立与逐段验证.md": ["每段六问", "路径状态", "逐段验证规则", "研究员输出"],
    "B_推理路径验证/B02_中间承接时滞与阻断.md": ["三类承接", "时滞判断"],
    "B_推理路径验证/B03_规则适用与多路径合成.md": ["规则适用评价", "多路径如何合成"],
    "C_反证与竞争解释/C01_反证命中与裁决动作.md": ["反证先定位，再动作", "五步判断"],
    "C_反证与竞争解释/C02_竞争解释比较.md": ["对称比较表", "判断处理"],
    "C_反证与竞争解释/C03_冲突证据裁决.md": ["真冲突还是表面冲突", "四种处理"],
    "D_改判与复盘/D01_改判触发与判断版本.md": [
        "改判是判断等级的状态迁移",
        "改判与复盘的边界",
        "改判在首次形成判断时就写好",
        "五种版本动作",
        "投资命题的双重更新",
    ],
    "D_改判与复盘/D02_历史复盘与方法反馈.md": ["复盘定位", "六类复盘结果", "最低复盘记录", "反馈去向"],
}

BOUNDARY_FILES = {
    "知识库_02框架/README.md": ["知识库_03取证", "知识库_04推理"],
    "知识库_03取证/README.md": ["知识库_02框架", "知识库_04推理"],
    "04_推理/04_推理输出规范.md": ["知识库_04推理/README.md", "不新增判断路径"],
    "00_全局/00_项目定位与边界.md": ["02 决定判断什么", "03 决定什么证据可以用", "04 决定合格证据"],
}

A_METHOD_LABELS = [
    "A01 状态",
    "A02 趋势",
    "A03 阶段",
    "A04 机制",
    "A05 归因",
    "A06 传导",
    "A07 分化",
    "A08 影响",
    "A09 预期差",
    "A10 投资命题裁决",
]

PATH_RESULT_STATUS_CODES = {
    "established",
    "partially_established",
    "weakened",
    "blocked",
    "insufficient_evidence",
    "contested",
    "not_applicable",
}

METHOD_BOUNDARY_REQUIREMENTS = {
    "A_单项判断裁决/A04_机制判断.md": ["不能回答 | 该机制是否为主要原因", "判断到达节点进入 A06", "经营/财务意义进入 A08"],
    "A_单项判断裁决/A05_归因判断.md": ["调用或继承 C02", "不能回答 | 仅凭某机制成立"],
    "A_单项判断裁决/A06_传导判断.md": ["A06 不重复给每条边定状态", "读取 B01 的正式路径状态", "经营或财务结果时进入 A08"],
    "A_单项判断裁决/A08_影响判断.md": ["暴露、可能影响、经营兑现或财务兑现", "不能回答 | 把概念暴露写成已发生影响"],
    "A_单项判断裁决/A10_投资命题裁决.md": ["特殊综合裁决方法", "只消费前序判断", "不得达到 J4"],
}

FORBIDDEN_AFFIRMATIVE_PHRASES = (
    "自行补充数据",
    "自行补充证据",
    "新增路径",
    "新增判断路径",
    "修改研究范围",
    "重新定义研究范围",
)
NEGATORS = ("不", "不得", "禁止", "不能", "无权", "退回")


def normalize_title(value: str) -> str:
    """忽略空白、下划线和标点后比较文件名与一级标题。"""

    return re.sub(r"[\W_]+", "", value, flags=re.UNICODE)


def first_h1(text: str) -> str | None:
    match = re.search(r"(?m)^#\s+(.+?)\s*$", text)
    return match.group(1) if match else None


def table_status_codes(text: str) -> set[str]:
    return set(re.findall(r"(?m)^\|\s*`([a-z_]+)`\s*\|", text))


def check_required_assets(errors: list[str]) -> None:
    for relative_path, required_phrases in REQUIRED_FILES.items():
        path = ROOT / relative_path
        if not path.exists():
            errors.append(f"缺少必需文件：知识库_04推理/{relative_path}")
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


def check_a_contracts(errors: list[str]) -> None:
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    for label in A_METHOD_LABELS:
        if label not in readme:
            errors.append(f"README.md 的最小调用组合缺少方法名称：{label}")

    for number in range(1, 11):
        matches = list((ROOT / "A_单项判断裁决").glob(f"A{number:02d}_*.md"))
        if len(matches) != 1:
            errors.append(f"A{number:02d} 方法文件数量应为 1，实际为 {len(matches)}")
            continue
        text = matches[0].read_text(encoding="utf-8")
        for section in ("最低输入", "必须输出", "输出上限与下一方法", "强制退回条件"):
            if f"## {section}" not in text:
                errors.append(f"{matches[0].relative_to(ROOT)} 缺少统一接口章节：{section}")

        level_matches = re.findall(r"\|\s*最高允许等级\s*\|\s*J([0-4])\b", text)
        if len(level_matches) != 1:
            errors.append(f"{matches[0].relative_to(ROOT)} 必须且只能声明一次最高允许等级")
            continue
        if number >= 4 and int(level_matches[0]) > 3:
            errors.append(f"{matches[0].relative_to(ROOT)} 属于因果/综合判断，最高允许等级不得超过 J3")

    a10 = (ROOT / "A_单项判断裁决/A10_投资命题裁决.md").read_text(encoding="utf-8")
    if "| 最高允许等级 | J3" not in a10:
        errors.append("A10 必须明确最高允许等级为 J3")
    if "不得达到 J4" not in a10 and "不得使用 J4" not in a10:
        errors.append("A10 必须明确禁止 J4")

    for relative_path, required_phrases in METHOD_BOUNDARY_REQUIREMENTS.items():
        text = (ROOT / relative_path).read_text(encoding="utf-8")
        for phrase in required_phrases:
            if phrase not in text:
                errors.append(f"{relative_path} 缺少相邻方法边界：{phrase}")


def check_path_result_status_contract(errors: list[str]) -> None:
    b01_path = ROOT / "B_推理路径验证/B01_路径成立与逐段验证.md"
    b01_text = b01_path.read_text(encoding="utf-8")
    b01_codes = table_status_codes(b01_text)
    if b01_codes != PATH_RESULT_STATUS_CODES:
        missing = sorted(PATH_RESULT_STATUS_CODES - b01_codes)
        extra = sorted(b01_codes - PATH_RESULT_STATUS_CODES)
        errors.append(f"B01 路径结果状态值域不一致：缺少 {missing or '无'}；多出 {extra or '无'}")
    if "path_result_status" not in b01_text and "正式路径状态" not in b01_text:
        errors.append("B01 必须明确这些状态属于 04 的 path_result_status / 正式路径结果状态")
    if re.search(r"(?m)^\|\s*条件成立\s*\|", b01_text):
        errors.append("B01 不得把“条件成立”定义为正式路径状态")

    output_spec = (PROJECT_ROOT / "04_推理" / "04_推理输出规范.md").read_text(encoding="utf-8")
    output_codes = table_status_codes(output_spec)
    missing_in_spec = PATH_RESULT_STATUS_CODES - output_codes
    if missing_in_spec:
        errors.append(f"04_推理/04_推理输出规范.md 缺少 B01 正式状态码：{sorted(missing_in_spec)}")

    status_definition_files = []
    for path in ROOT.glob("[ABCD]_*/*.md"):
        if re.search(r"(?m)^##\s+路径(结果)?状态\b", path.read_text(encoding="utf-8")):
            status_definition_files.append(str(path.relative_to(ROOT)))
    if status_definition_files != ["B_推理路径验证/B01_路径成立与逐段验证.md"]:
        errors.append(f"正式路径状态只能由 B01 定义，当前定义位置：{status_definition_files}")


def check_titles_and_sections(errors: list[str]) -> None:
    title_to_files: dict[str, list[str]] = {}
    for path in sorted(ROOT.glob("[ABCD]_*/*.md")):
        relative = str(path.relative_to(ROOT))
        text = path.read_text(encoding="utf-8")
        title = first_h1(text)
        if title is None:
            errors.append(f"{relative} 缺少一级标题")
            continue
        expected = path.stem.replace("_", " ", 1)
        if normalize_title(title) != normalize_title(expected):
            errors.append(f"{relative} 一级标题与文件名不一致：{title}")
        title_to_files.setdefault(normalize_title(title), []).append(relative)

        headings = list(re.finditer(r"(?m)^(#{2,6})\s+(.+?)\s*$", text))
        for index, heading in enumerate(headings):
            level = len(heading.group(1))
            end = len(text)
            for later in headings[index + 1 :]:
                if len(later.group(1)) <= level:
                    end = later.start()
                    break
            body = text[heading.end() : end]
            body_without_headings = re.sub(r"(?m)^#{2,6}\s+.+$", "", body)
            if len(re.sub(r"\s+", "", body_without_headings)) < 8:
                errors.append(f"{relative} 章节内容过空：{heading.group(2)}")

    for files in title_to_files.values():
        if len(files) > 1:
            errors.append(f"重复方法标题：{files}")


def iter_markdown_links(text: str) -> list[str]:
    return re.findall(r"(?<!!)\[[^\]]+\]\(([^)]+)\)", text)


def check_relative_links(errors: list[str]) -> None:
    for path in sorted(ROOT.rglob("*.md")):
        text = path.read_text(encoding="utf-8")
        for raw_target in iter_markdown_links(text):
            target = raw_target.strip().strip("<>").split()[0]
            if not target or target.startswith("#") or re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", target):
                continue
            local_part = unquote(target.split("#", 1)[0].split("?", 1)[0])
            if not local_part:
                continue
            resolved = (path.parent / local_part).resolve()
            if not resolved.exists():
                errors.append(f"{path.relative_to(ROOT)} 存在失效相对链接：{target}")


def check_boundary_language(errors: list[str]) -> None:
    for path in sorted(ROOT.glob("[ABCD]_*/*.md")):
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            for phrase in FORBIDDEN_AFFIRMATIVE_PHRASES:
                start = line.find(phrase)
                if start == -1:
                    continue
                prefix = line[max(0, start - 10) : start]
                if not any(negator in prefix for negator in NEGATORS):
                    errors.append(f"{path.relative_to(ROOT)}:{line_number} 存在越界表述：{phrase}")


def main() -> int:
    errors: list[str] = []
    check_required_assets(errors)
    check_a_contracts(errors)
    check_path_result_status_contract(errors)
    check_titles_and_sections(errors)
    check_relative_links(errors)
    check_boundary_language(errors)

    if errors:
        print("METHOD_LIBRARY_RETURN_REQUIRED")
        for error in errors:
            print(f"- {error}")
        return 1

    print(
        "METHOD_LIBRARY_PASS: A/B/C/D 资产、统一接口、等级上限、路径状态、标题链接及 02/03/04/05 边界有效。"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
