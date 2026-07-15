#!/usr/bin/env python3
"""校验 04 推理方法库 V2.1：统一接口、认知错误、等级、路径、链接与边界。"""

from __future__ import annotations

import re
from pathlib import Path
from urllib.parse import unquote


ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent

METHOD_SECTIONS = [
    "方法定位",
    "判断模型与停止点",
    "方法特有判断原则",
    "判断流程",
    "裁决与输出增量",
    "边界与退回",
    "例与误判",
]

LEGACY_METHOD_HEADINGS = {
    "开始前需要什么",
    "最低输入",
    "最低输入（开始前需要什么）",
    "等级使用提示",
    "必须输出",
    "必须写清",
    "强制退回条件",
    "缺什么就退回",
    "输出上限与下一方法",
    "能说到哪、下一步去哪",
    "裁决矩阵",
}

REQUIRED_FILES = {
    "README.md": [
        "从哪组方法进入",
        "判断单元",
        "主研究命题",
        "方法怎么分层看",
        "和 02、03、05 的边界",
        "怎么用",
        "四份附录",
        "七部分",
        "案例回归",
        "不能证明",
        "方法有效性验证",
    ],
    "A00_裁决总则.md": [
        "先选主问题，再选主方法",
        "主研究命题",
        "判断单元",
        "统一输入规范",
        "统一输出规范",
        "统一等级规则",
        "统一退回规则",
        "统一案例规范",
        "附录4：通用认知错误与误用索引",
        "A02—A10 | J3",
    ],
    "A00-附录1_路径与阻断协议.md": [
        "每一段先问这六个问题",
        "节点与路径角色",
        "中间有没有真正接上",
        "这一段路径走到哪一步",
        "承接、时滞与阻断",
        "多路径输入边界",
        "至少写清这五件事",
    ],
    "A00-附录2_反证与竞争解释协议.md": [
        "反证：先看打在哪，再决定怎么改",
        "竞争解释：用同一张表比",
        "材料看起来打架时",
    ],
    "A00-附录3_改判与版本协议.md": [
        "改判是等级怎么跟着证据走",
        "改判条件要写到能执行",
        "七种版本动作",
        "投资命题要盯两套变化",
        "历史复盘与方法反馈",
    ],
    "A00-附录4_通用认知错误与误用索引.md": [
        "CE01 相关替代因果",
        "CE02 相邻判断类型偷换",
        "CE03 代理替代真实变量",
        "CE04 未观测替代零或未发生",
        "CE05 单点、局部或幸存样本外推总体",
        "CE06 同源材料替代独立验证",
        "CE07 遗漏共同驱动和最强竞争解释",
        "CE08 事后调整基线、阈值、窗口或阶段定义",
        "CE09 时间窗口错配或顺序倒置",
        "CE10 跨层跳跃",
    ],
}

BOUNDARY_FILES = {
    "知识库_02框架/README.md": ["知识库_03取证", "知识库_04推理"],
    "知识库_03取证/README.md": ["知识库_02框架", "知识库_04推理"],
    "04_推理/04_推理输出规范.md": [
        "知识库_04推理/README.md",
        "不新增判断路径",
        "四份附录",
        "附录4",
    ],
    "00_全局/00_项目定位与边界.md": [
        "02 决定判断什么",
        "03 决定什么证据可以用",
        "04 决定合格证据",
    ],
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
    "A10 投资命题",
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
    "A04_机制判断.md": ["主因", "A05", "A06", "A08", "附录1", "附录2"],
    "A05_归因判断.md": ["附录2", "主要由", "共同驱动", "精确贡献"],
    "A06_传导判断.md": ["附录1", "最后可达节点", "第一条未通过路径", "A08"],
    "A08_影响判断.md": ["边际贡献", "总量结果", "A05", "A09"],
    "A09_预期差判断.md": ["事前共识或关键假设＋预测修订＋定价反应", "只有价格变化", "J0", "A10"],
    "A10_投资命题裁决.md": [
        "同一组敏感变量",
        "幅度区间",
        "不得写“收益风险比显著有利”",
        "G4 只算部分通过",
        "最高 J3",
    ],
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
    return re.sub(r"[\W_]+", "", value, flags=re.UNICODE)


def first_h1(text: str) -> str | None:
    match = re.search(r"(?m)^#\s+(.+?)\s*$", text)
    return match.group(1) if match else None


def h2_titles(text: str) -> list[str]:
    return re.findall(r"(?m)^##\s+(.+?)\s*$", text)


def section_body(text: str, title: str) -> str:
    match = re.search(
        rf"(?ms)^##\s+{re.escape(title)}\s*$\n(.*?)(?=^##\s+|\Z)",
        text,
    )
    return match.group(1) if match else ""


def table_status_codes(text: str) -> set[str]:
    """Extract formal status codes from Markdown table cells."""
    return set(re.findall(r"(?m)^\|(?:[^|\n]*\|)*?\s*`([a-z_]+)`\s*\|", text))


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


def check_canonical_method_files(errors: list[str]) -> dict[int, Path]:
    catalog: dict[int, Path] = {}
    for number in range(1, 11):
        matches = sorted(ROOT.rglob(f"A{number:02d}_*.md"))
        if len(matches) != 1:
            listed = [str(path.relative_to(ROOT)) for path in matches]
            errors.append(
                f"A{number:02d} 正式方法文件递归数量应为 1，实际为 {len(matches)}：{listed}"
            )
            continue
        path = matches[0]
        if path.parent != ROOT:
            errors.append(f"{path.relative_to(ROOT)} 不得作为子目录中的正式方法卡")
            continue
        catalog[number] = path
    return catalog


def check_a_contracts(errors: list[str], warnings: list[str]) -> None:
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    for label in A_METHOD_LABELS:
        if label not in readme:
            errors.append(f"README.md 缺少方法名称：{label}")

    catalog = check_canonical_method_files(errors)
    registry_text = (ROOT / "A00-附录4_通用认知错误与误用索引.md").read_text(
        encoding="utf-8"
    )
    registry_ids = set(re.findall(r"(?m)^##\s+(CE\d{2})\b", registry_text))
    expected_ids = {f"CE{number:02d}" for number in range(1, 11)}
    if registry_ids != expected_ids:
        errors.append(
            f"附录4 认知错误 ID 不完整：缺少 {sorted(expected_ids - registry_ids)}；"
            f"多出 {sorted(registry_ids - expected_ids)}"
        )

    for number, path in sorted(catalog.items()):
        text = path.read_text(encoding="utf-8")
        headings = h2_titles(text)
        if headings != METHOD_SECTIONS:
            errors.append(f"{path.name} 七段模板不一致：{headings}")

        legacy = sorted(set(headings) & LEGACY_METHOD_HEADINGS)
        if legacy:
            errors.append(f"{path.name} 重复维护全局章节：{legacy}")

        if "一句话哲学" not in section_body(text, "方法定位"):
            errors.append(f"{path.name} 方法定位缺少一句话哲学")

        workflow = section_body(text, "判断流程")
        step_count = len(re.findall(r"(?m)^\d+\.\s+", workflow))
        if not 5 <= step_count <= 7:
            errors.append(f"{path.name} 判断流程应为 5—7 步，实际为 {step_count} 步")

        if text.count("**合格例：**") != 1 or text.count("**高迷惑性反例：**") != 1:
            errors.append(f"{path.name} 必须且只能有一个合格例和一个高迷惑性反例")

        ce_ids = set(re.findall(r"\bCE\d{2}\b", text))
        unknown = sorted(ce_ids - registry_ids)
        if unknown:
            errors.append(f"{path.name} 引用了未注册认知错误：{unknown}")
        if not 2 <= len(ce_ids) <= 4:
            errors.append(f"{path.name} 应引用 2—4 个通用认知错误，实际为 {sorted(ce_ids)}")

        line_count = len(text.splitlines())
        maximum = 290 if number == 10 else 240
        if line_count > maximum:
            warnings.append(f"{path.name} 当前 {line_count} 行，超过编辑软上限 {maximum} 行")

    a00 = (ROOT / "A00_裁决总则.md").read_text(encoding="utf-8")
    for phrase in (
        "| A01 | J4 |",
        "| A02—A10 | J3 |",
        "最终等级取“03 上限、方法上限、决定性环节上限”中的最低者",
    ):
        if phrase not in a00:
            errors.append(f"A00_裁决总则.md 缺少集中等级规则：{phrase}")
    for forbidden in ("| A02 | J4 / J3 |", "| A03 | J4 / J3 |", "| A04—A10 | J3 |"):
        if forbidden in a00:
            errors.append(f"A00_裁决总则.md 仍含已废弃等级口径：{forbidden}")

    for relative_path, required_phrases in METHOD_BOUNDARY_REQUIREMENTS.items():
        text = (ROOT / relative_path).read_text(encoding="utf-8")
        for phrase in required_phrases:
            if phrase not in text:
                errors.append(f"{relative_path} 缺少方法硬规则或边界：{phrase}")


def check_path_result_status_contract(errors: list[str]) -> None:
    appendix1 = ROOT / "A00-附录1_路径与阻断协议.md"
    text = appendix1.read_text(encoding="utf-8")
    section_text = section_body(text, "这一段路径走到哪一步") or text
    codes = table_status_codes(section_text)
    if codes != PATH_RESULT_STATUS_CODES:
        errors.append(
            f"附录1 路径状态不一致：缺少 {sorted(PATH_RESULT_STATUS_CODES - codes) or '无'}；"
            f"多出 {sorted(codes - PATH_RESULT_STATUS_CODES) or '无'}"
        )
    if "path_result_status" not in text:
        errors.append("附录1 须说明与审计 path_result_status 对应")
    if re.search(r"(?m)^\|\s*条件成立\s*\|", section_text):
        errors.append("附录1 不得把“条件成立”定义为正式路径状态")

    output_spec = (PROJECT_ROOT / "04_推理" / "04_推理输出规范.md").read_text(
        encoding="utf-8"
    )
    missing_in_spec = PATH_RESULT_STATUS_CODES - table_status_codes(output_spec)
    if missing_in_spec:
        errors.append(f"04_推理输出规范.md 缺少路径状态码：{sorted(missing_in_spec)}")


def check_rule_scenarios(errors: list[str]) -> None:
    """静态回归两条最容易被后续编辑稀释的规则场景。"""
    a09 = (ROOT / "A09_预期差判断.md").read_text(encoding="utf-8")
    a09_requirements = (
        "只有价格变化或事后评论 | 无有效基线 | J0",
        "禁止使用“超预期、低于预期、未计价”",
        "事前共识或关键假设＋预测修订＋定价反应",
    )
    missing_a09 = [phrase for phrase in a09_requirements if phrase not in a09]
    if missing_a09:
        errors.append(
            "A09 场景回归失败：只有价格、无事前基线时必须停在 J0；缺少 "
            + "、".join(missing_a09)
        )

    a10 = (ROOT / "A10_投资命题裁决.md").read_text(encoding="utf-8")
    a10_requirements = (
        "同一组敏感变量",
        "方向、幅度区间、窗口和可逆性",
        "不得写“收益风险比显著有利”",
        "G4 只算部分通过",
        "最高输出条件性投资命题或观察命题",
    )
    missing_a10 = [phrase for phrase in a10_requirements if phrase not in a10]
    if missing_a10:
        errors.append(
            "A10 场景回归失败：情景不可比或无幅度区间时不得写显著有利；缺少 "
            + "、".join(missing_a10)
        )


def check_titles_and_sections(errors: list[str]) -> None:
    for path in sorted(ROOT.glob("A[0-9][0-9]_*.md")):
        relative = str(path.relative_to(ROOT))
        text = path.read_text(encoding="utf-8")
        title = first_h1(text)
        if title is None:
            errors.append(f"{relative} 缺少一级标题")
            continue
        expected = path.stem.replace("_", " ", 1)
        if normalize_title(title) != normalize_title(expected):
            errors.append(f"{relative} 一级标题与文件名不一致：{title}")

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


def iter_markdown_links(text: str) -> list[str]:
    return re.findall(r"(?<!!)\[[^\]]+\]\(([^)]+)\)", text)


def check_relative_links(errors: list[str]) -> None:
    for path in sorted(ROOT.rglob("*.md")):
        text = path.read_text(encoding="utf-8")
        for raw_target in iter_markdown_links(text):
            target = raw_target.strip().strip("<>").split()[0]
            if not target or target.startswith("#") or re.match(
                r"^[a-zA-Z][a-zA-Z0-9+.-]*:", target
            ):
                continue
            local_part = unquote(target.split("#", 1)[0].split("?", 1)[0])
            if not local_part:
                continue
            resolved = (path.parent / local_part).resolve()
            if not resolved.exists():
                errors.append(f"{path.relative_to(ROOT)} 存在失效相对链接：{target}")


def check_boundary_language(errors: list[str]) -> None:
    paths = list(ROOT.glob("A[0-9][0-9]_*.md")) + list(ROOT.glob("A00*.md"))
    for path in sorted(paths):
        for line_number, line in enumerate(
            path.read_text(encoding="utf-8").splitlines(), start=1
        ):
            for phrase in FORBIDDEN_AFFIRMATIVE_PHRASES:
                start = line.find(phrase)
                if start == -1:
                    continue
                prefix = line[max(0, start - 12) : start]
                if not any(negator in prefix for negator in NEGATORS):
                    errors.append(f"{path.relative_to(ROOT)}:{line_number} 存在越界表述：{phrase}")


def main() -> int:
    errors: list[str] = []
    warnings: list[str] = []
    check_required_assets(errors)
    check_a_contracts(errors, warnings)
    check_path_result_status_contract(errors)
    check_rule_scenarios(errors)
    check_titles_and_sections(errors)
    check_relative_links(errors)
    check_boundary_language(errors)

    if warnings:
        print("METHOD_LIBRARY_EDITORIAL_WARNINGS")
        for warning in warnings:
            print(f"- {warning}")

    if errors:
        print("METHOD_LIBRARY_RETURN_REQUIRED")
        for error in errors:
            print(f"- {error}")
        return 1

    print(
        "METHOD_LIBRARY_PASS: V2.1 方法卡与四附录齐全，七段接口、集中等级、"
        "认知错误、路径状态、链接及边界有效。（合规通过 ≠ 方法已验证有效）"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
