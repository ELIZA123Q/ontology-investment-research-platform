#!/usr/bin/env python3
"""校验 03 取证库（证据准备边界），并可从 02 任务本体视图生成取证任务卡。"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Any

import yaml


ROOT = Path(__file__).resolve().parent
WORKSPACE = ROOT.parents[2]  # 03_agent_capability/05_method_libraries/<lib> → repo
sys.path.insert(0, str(WORKSPACE / "05_control_evaluation/03_校验"))

from research_contract import public_contract  # noqa: E402


REGISTRY_PATH = ROOT / "03_registry.yaml"
MCP_GUIDE_ROOT = WORKSPACE / "03_agent_capability/04_protocols/mcp"
DOMAIN_SEMI_ROOT = ROOT / "domains" / "semiconductor"
METHOD_IDS = {f"A{i:02d}" for i in range(1, 10)}
PRIMARY_METHOD_IDS = {f"A{i:02d}" for i in range(1, 8)}
ROLE_IDS = {"primary", "baseline", "mechanism", "cross_check", "counter"}
ROLE_ORDER = ("primary", "baseline", "mechanism", "cross_check", "counter")
QUALITY_IDS = {"sufficient", "limited", "observation", "unusable"}
JUDGMENT_TYPES = set(public_contract()["judgment_types"])
METHOD_HEADINGS = [
    "## 1. 什么时候使用",
    "## 2. 取证逻辑",
    "## 3. 最少必须取得什么",
    "## 4. 优先来源",
    "## 5. 完备度怎样受限",
    "## 6. 交给 04 什么",
]
FORBIDDEN_ADJUDICATION = [
    "阶段已确认",
    "路径已成立",
    "最受益",
    "判断被阻断",
    "预期差成立",
    "weaken / block / invalidate",
    "supported / blocked / contested",
]
QP_PATTERN = re.compile(r"\bQP-(?:(?:GEN|SEMI|GEO)-\d{2}|MCP-\d{2})\b")


def load_yaml(path: Path) -> dict[str, Any]:
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise ValueError(f"{path}: YAML 无法读取: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError(f"{path}: 顶层必须是 mapping")
    return data


def as_mapping(value: Any, label: str, errors: list[str]) -> dict[str, Any]:
    if not isinstance(value, dict):
        errors.append(f"{label} 必须是 mapping")
        return {}
    return value


def validate_registry(registry: dict[str, Any], errors: list[str]) -> None:
    if registry.get("registry_type") != "evidence_method_registry":
        errors.append("03_registry.yaml.registry_type 必须为 evidence_method_registry")
    if str(registry.get("schema_version")) != "3.2.0":
        errors.append("03_registry.yaml.schema_version 必须精确为 3.2.0")
    if "ontology_authority_refs" not in registry:
        errors.append("03_registry.yaml 缺少 ontology_authority_refs")

    preconditions = registry.get("validity_preconditions")
    if not isinstance(preconditions, list) or len(preconditions) < 6:
        errors.append("validity_preconditions 必须列出至少六项共同有效性条件")

    roles = as_mapping(registry.get("evidence_roles"), "evidence_roles", errors)
    if set(roles) != ROLE_IDS:
        errors.append("evidence_roles 必须且只能包含五类角色（不含 scope）")
    if "scope" in roles:
        errors.append("scope 不得作为 evidence_roles；应放入 validity_preconditions")

    quality = as_mapping(registry.get("quality_language"), "quality_language", errors)
    if set(quality) != QUALITY_IDS:
        errors.append("quality_language 必须且只能包含 sufficient/limited/observation/unusable")
    sufficient = quality.get("sufficient") if isinstance(quality.get("sufficient"), dict) else {}
    max_use = str(sufficient.get("maximum_use", ""))
    if "明确否定" not in max_use and "明确支持与明确否定" not in max_use:
        errors.append("quality_language.sufficient.maximum_use 必须允许明确支持与明确否定")

    methods = as_mapping(registry.get("methods"), "methods", errors)
    if set(methods) != METHOD_IDS:
        errors.append("methods 必须完整且唯一覆盖 A01—A09")
    for method_id, item in methods.items():
        if not isinstance(item, dict):
            errors.append(f"methods.{method_id} 必须是 mapping")
            continue
        contract = item.get("contract")
        required_contract_fields = {
            "applicability", "preconditions", "inputs", "outputs",
            "not_applicable_when", "degrade_policy", "alternatives", "counter_examples",
        }
        if not isinstance(contract, dict):
            errors.append(f"methods.{method_id}.contract 必须是 mapping")
        else:
            missing = sorted(required_contract_fields - set(contract))
            if missing:
                errors.append(f"methods.{method_id}.contract 缺少字段: {missing}")
        file_ref = str(item.get("file", "")).strip()
        path = ROOT / file_ref
        if not file_ref or not path.is_file():
            errors.append(f"methods.{method_id}.file 无法解析: {file_ref}")
            continue
        text = path.read_text(encoding="utf-8")
        for heading in METHOD_HEADINGS:
            if heading not in text:
                errors.append(f"{file_ref} 缺少固定章节: {heading}")
        for phrase in FORBIDDEN_ADJUDICATION:
            idx = text.find(phrase)
            while idx != -1:
                window = text[max(0, idx - 36): idx + len(phrase) + 36]
                if not any(k in window for k in ("不写", "不输出", "不得", "不能", "由 04", "本方法不", "禁止")):
                    errors.append(f"{file_ref} 疑似输出正式裁决用语: {phrase}")
                    break
                idx = text.find(phrase, idx + 1)
        if "证据完备度" not in text and "完备度" not in text:
            errors.append(f"{file_ref} 必须讨论证据完备度而非仅结论成立")
        if "待裁决问题" not in text:
            errors.append(f"{file_ref} 第 6 节必须包含交给 04 的待裁决问题")
        line_count = len(text.splitlines())
        if method_id in PRIMARY_METHOD_IDS and not 55 <= line_count <= 110:
            errors.append(f"{file_ref} 应控制在 55—110 行，当前 {line_count} 行")
        if method_id in {"A08", "A09"} and line_count > 75:
            errors.append(f"{file_ref} 作为附加模块不应超过 75 行")
        required_roles = set(item.get("required_roles", []) or [])
        if not required_roles or not required_roles <= ROLE_IDS:
            errors.append(f"methods.{method_id}.required_roles 非法（不得含 scope）")
        if method_id == "A09":
            max_as_core = str(item.get("max_completeness_as_core_substitute", ""))
            if max_as_core != "limited":
                errors.append("methods.A09.max_completeness_as_core_substitute 必须为 limited")
        if method_id == "A03":
            req = set(item.get("requires_methods", []) or [])
            if "A02" not in req:
                errors.append("methods.A03.requires_methods 必须包含 A02")
        if method_id == "A06":
            forbidden = set(item.get("forbidden_without", []) or [])
            if "financial_baseline" not in forbidden or "critical_financial_bridge" not in forbidden:
                errors.append("methods.A06.forbidden_without 必须含 financial_baseline 与 critical_financial_bridge")
        if method_id == "A07":
            forbidden = set(item.get("forbidden_without", []) or [])
            if "pre_event_consensus_vintage" not in forbidden:
                errors.append("methods.A07.forbidden_without 必须含 pre_event_consensus_vintage")

    judgment_types = as_mapping(registry.get("judgment_types"), "judgment_types", errors)
    if set(judgment_types) != JUDGMENT_TYPES:
        errors.append("judgment_types 必须与最小公共合同的十类判断类型完全一致")
    for judgment_type, item in judgment_types.items():
        if not isinstance(item, dict):
            errors.append(f"judgment_types.{judgment_type} 必须是 mapping")
            continue
        method = str(item.get("method", ""))
        if method not in methods:
            errors.append(f"judgment_types.{judgment_type}.method 未注册: {method}")
        required = set(item.get("required_roles", []) or [])
        optional = set(item.get("optional_roles", []) or [])
        if not required or not (required | optional) <= ROLE_IDS:
            errors.append(f"judgment_types.{judgment_type} 的证据角色非法（不得含 scope）")
        if required & optional:
            errors.append(f"judgment_types.{judgment_type} 的 required_roles 与 optional_roles 重复")
        if "scope" in required or "scope" in optional:
            errors.append(f"judgment_types.{judgment_type} 不得把 scope 列为证据角色")
        if judgment_type in {"trend_direction", "cycle_phase"}:
            if "A02" not in set(item.get("requires_methods", []) or []):
                errors.append(f"judgment_types.{judgment_type}.requires_methods 必须含 A02")
        if judgment_type in {"mechanism_validation", "causal_attribution", "transmission_path"}:
            if "A01" not in set(item.get("auto_add", []) or []):
                errors.append(f"judgment_types.{judgment_type}.auto_add 必须含 A01")
        if judgment_type == "impact_realization":
            required_inputs = {"financial_baseline", "critical_financial_bridge"}
            if not required_inputs <= set(item.get("forbidden_without", []) or []):
                errors.append("judgment_types.impact_realization.forbidden_without 必须含财务基线与关键财务桥")
        if judgment_type == "expectation_gap":
            if "pre_event_consensus_vintage" not in set(item.get("forbidden_without", []) or []):
                errors.append("judgment_types.expectation_gap.forbidden_without 必须含 pre_event_consensus_vintage")
        if judgment_type == "valuation_impact":
            if "valuation_baseline" not in set(item.get("forbidden_without", []) or []):
                errors.append("judgment_types.valuation_impact.forbidden_without 必须含 valuation_baseline")

    deps = as_mapping(registry.get("dependency_rules"), "dependency_rules", errors)
    for key in (
        "A03_requires_A02",
        "A04_auto_A01",
        "A06_auto_on_financials",
        "A07_requires_vintage",
        "A09_no_sufficient_as_core",
    ):
        if key not in deps:
            errors.append(f"dependency_rules 缺少 {key}")

    for group_name in ("source_guides",):
        refs = as_mapping(registry.get(group_name), group_name, errors)
        for key, ref in refs.items():
            if not (WORKSPACE / str(ref)).is_file():
                errors.append(f"{group_name}.{key} 无法解析: {ref}")
    references = as_mapping(registry.get("runtime_references"), "runtime_references", errors)
    for group_name, refs in references.items():
        if not isinstance(refs, list) or not refs:
            errors.append(f"runtime_references.{group_name} 必须是非空列表")
            continue
        for ref in refs:
            candidate = Path(str(ref))
            if candidate.is_absolute():
                resolved = candidate
            else:
                root_relative = ROOT / candidate
                workspace_relative = WORKSPACE / candidate
                resolved = root_relative if root_relative.is_file() else workspace_relative
            if not resolved.is_file():
                errors.append(f"runtime_references.{group_name} 无法解析: {ref}")


def validate_frontstage(errors: list[str]) -> None:
    expected = [
        ROOT / "README.md",
        ROOT / "00_取证任务卡.md",
        ROOT / "00_证据质量与结论上限.md",
    ]
    for path in expected:
        if not path.is_file():
            errors.append(f"缺少研究员入口文件: {path.relative_to(ROOT)}")

    quality = ROOT / "00_证据质量与结论上限.md"
    if quality.is_file():
        text = quality.read_text(encoding="utf-8")
        if "两条轴" not in text and "命题支持状态" not in text:
            errors.append("00_证据质量与结论上限.md 必须拆开完备度与命题支持状态")
        if "关键路径被反证阻断" in text and "完备度仍可以是" not in text:
            errors.append("00_证据质量与结论上限.md 不得把路径阻断直接等同于证据不可用")

    card = ROOT / "00_取证任务卡.md"
    if card.is_file():
        text = card.read_text(encoding="utf-8")
        for required in ("证据完备度", "交给 04 的待裁决问题", "范围与口径（前置检查"):
            if required not in text:
                errors.append(f"00_取证任务卡.md 缺少: {required}")
        if "可支持的结论" in text and "证据完备度与移交" not in text:
            errors.append("00_取证任务卡.md 应收口为完备度与移交，而非可支持的结论")

    a_files = sorted(p.name for p in ROOT.glob("A0*.md"))
    if len(a_files) != 9:
        errors.append(f"根目录必须且只能包含 A01—A09 九个方法文件，当前: {a_files}")
    required_b_root = {
        "B00_来源选择与使用边界.md",
        "B01_通用来源速查.md",
    }
    b_root = {p.name for p in ROOT.glob("B0*.md")}
    if not required_b_root <= b_root:
        errors.append(f"根目录至少需要 B00—B01 两个来源文件，当前: {sorted(b_root)}")
    b02 = DOMAIN_SEMI_ROOT / "B02_半导体来源速查.md"
    if not b02.is_file():
        errors.append("domains/semiconductor/ 需要 B02_半导体来源速查.md")
    # B03 为可选的 MCP 通道注册
    b03 = MCP_GUIDE_ROOT / "B03_MCP通道注册.md"
    if b03.is_file():
        text = b03.read_text(encoding="utf-8")
        if "不是来源生产者" not in text:
            errors.append("B03_MCP通道注册.md 必须声明 MCP 是获取通道而非来源生产者")
        if "留痕要求" not in text:
            errors.append("B03_MCP通道注册.md 必须包含 MCP 获取留痕要求")
    b00 = ROOT / "B00_来源选择与使用边界.md"
    if b00.is_file():
        text = b00.read_text(encoding="utf-8")
        if len(text.splitlines()) > 120:
            errors.append("B00_来源选择与使用边界.md 不应超过 120 行")
        if "OPS 准入" not in text and "准入条件" not in text:
            errors.append("B00 应说明 OPS 准入条件")

    forbidden_top_level = [
        "00_basket_registry.yaml",
        "00_strategy_registry.yaml",
        "00_source_registry.yaml",
        "00_quality_gates.yaml",
        "A_取证方法",
        "B_来源速查",
        "A_取证规则",
        "B_取证来源",
        "C_最低证据组合",
        "D_研究工作单",
        "_runtime",
    ]
    for name in forbidden_top_level:
        if (ROOT / name).exists():
            errors.append(f"旧分层目录或多注册表仍存在: {name}")


def validate_ops_and_qp_links(errors: list[str]) -> None:
    ops_files = sorted(ROOT.glob("OPS_*.md")) + sorted(DOMAIN_SEMI_ROOT.glob("OPS_*.md"))
    core_ops_names = {
        "OPS_通用真实来源查询与回退手册.md",
        "OPS_地缘规则与冲击查询手册.md",
        "OPS_半导体真实来源查询与口径手册.md",
    }
    present_ops = {p.name for p in ops_files}
    missing_core = core_ops_names - present_ops
    if missing_core:
        errors.append(f"至少需要三份核心 OPS_*.md（通用/地缘/半导体），缺少: {sorted(missing_core)}")
    # OPS_MCP 为可选文件
    all_qps: dict[str, str] = {}
    for path in ops_files:
        text = path.read_text(encoding="utf-8")
        if "准入" not in text and "复核" not in text:
            # Admission may live in B00; still require review date markers in OPS cards.
            pass
        ids = QP_PATTERN.findall(text)
        if not ids:
            errors.append(f"{path.name} 未发现 QP-GEN/SEMI/GEO ID")
        for qp in ids:
            if qp in all_qps and all_qps[qp] != path.name:
                errors.append(f"QP ID 重复: {qp} 同时出现在 {all_qps[qp]} 与 {path.name}")
            all_qps[qp] = path.name
        # Require at least one review/update marker for governance.
        if not re.search(r"(复核|更新|updated|reviewed)", text, re.IGNORECASE):
            errors.append(f"{path.name} 应含复核或更新日期标记")

    guide_paths = [
        ROOT / "B01_通用来源速查.md",
        DOMAIN_SEMI_ROOT / "B02_半导体来源速查.md",
    ]
    for path in guide_paths:
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8")
        refs = QP_PATTERN.findall(text)
        if not refs:
            errors.append(f"{path.name} 应至少链接若干 OPS QP ID，避免与 OPS 平行维护")
        for qp in refs:
            if qp not in all_qps:
                errors.append(f"{path.name} 引用了不存在的 QP: {qp}")
        if "MCP通道" in text.split("\n")[0:20] or re.search(r"\|\s*MCP通道\s*\|", text):
            errors.append(f"{path.name} 不应维护 MCP通道列；通道绑定归 04_protocols/mcp")


def _scope_text(task_context: dict[str, Any]) -> tuple[str, str]:
    scope = task_context.get("scope") if isinstance(task_context.get("scope"), dict) else {}
    objects = scope.get("objects", [])
    if isinstance(objects, list):
        object_text = "、".join(str(item) for item in objects)
    else:
        object_text = str(objects or "")
    geography = str(scope.get("geography", "")).strip()
    if geography and geography not in object_text:
        object_text = f"{object_text}；{geography}" if object_text else geography
    return object_text or "<待确认>", str(scope.get("time", "<待确认>"))


def _claim_suggests_financials(claim: str) -> bool:
    keys = ("收入", "利润", "毛利", "净利", "现金流", "EPS", "盈利", "财务")
    return any(k in claim for k in keys)


def generate_card(view_path: Path, output_path: Path, registry: dict[str, Any]) -> None:
    view = load_yaml(view_path)
    units = view.get("judgment_units")
    if not isinstance(units, list) or not units:
        raise ValueError(f"{view_path}: judgment_units 至少需要一项")
    task_context = view.get("task_context") if isinstance(view.get("task_context"), dict) else {}
    object_text, time_text = _scope_text(task_context)
    methods = registry["methods"]
    judgment_types = registry["judgment_types"]
    roles = registry["evidence_roles"]
    chunks = [
        "# 03 取证任务卡",
        "",
        f"> 由 `{view_path.name}` 自动生成；来源计划、实际结果与完备度由研究员补充。03 不填写命题支持状态。",
        "",
    ]
    for unit in units:
        if not isinstance(unit, dict):
            raise ValueError(f"{view_path}: judgment_units 项必须是 mapping")
        unit_id = str(unit.get("judgment_unit_id", "<缺失 ID>"))
        judgment_type = str(unit.get("judgment_type", ""))
        if judgment_type not in judgment_types:
            raise ValueError(f"{unit_id}.judgment_type 未在 03_registry 注册: {judgment_type}")
        route = judgment_types[judgment_type]
        method_id = str(route["method"])
        method = methods[method_id]
        claim = str(unit.get("candidate_claim") or unit.get("statement") or "<待验证判断>")
        auto_add = list(route.get("auto_add", []) or [])
        if _claim_suggests_financials(claim) and "A06" not in auto_add and method_id != "A06":
            auto_add.append("A06")
        formal_a08 = bool(route.get("formal_a08", False))
        a08_text = "是（正式反向证据扫描）" if formal_a08 else "否（仅轻量反向检查）"
        auto_text = "、".join(auto_add) if auto_add else "无"
        chunks.extend([
            f"## {unit_id} 取证任务",
            "",
            "### 1. 要验证的判断",
            "",
            f"- 待验证判断：{claim}",
            f"- 对象／产品／地区：{object_text}",
            f"- 业务时间与观察窗口：{time_text}",
            "",
            "### 2. 主取证方法",
            "",
            f"- 主方法：{method_id} {method['name']}",
            f"- 使用理由：02 判断类型 `{judgment_type}` 自动路由",
            f"- 自动附加方法：{auto_text}",
            f"- 正式调用 A08：{a08_text}",
            "- A09 代理指标：否（直接数据不可得时再调用）",
            "",
            "### 3. 有效性前置与必需证据",
            "",
            "- 范围与口径（前置检查，非可选角色）：对象、业务时间、定义、单位、版本是否匹配",
        ])
        required = set(route.get("required_roles", []))
        optional = set(route.get("optional_roles", []))
        for role_id in ROLE_ORDER:
            if role_id not in required and role_id not in optional:
                continue
            status = "必需" if role_id in required else "按需"
            chunks.append(f"- {roles[role_id]['label']}（{status}）：<待补；{roles[role_id]['question']}>")
        chunks.extend([
            "",
            "### 4. 来源计划",
            "",
            "- 主源：",
            "- 独立交叉源：",
            "- 反证来源：",
            "- 主源不可得时的替代及影响：",
            "",
            "### 5. 当前结果",
            "",
            "- 已取得：",
            "- 尚缺／冲突／代理限制：",
            "- 是否继续补证及理由：",
            "",
            "### 6. 证据完备度与移交",
            "",
            "- 证据完备度：充分／受限／观察／不可用",
            "- 适用范围与主要限制：",
            "- 交给 04 的待裁决问题：",
            "- 补什么证据可以升级：",
            "- 是否继续补证：是／否",
            "",
        ])
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(chunks).rstrip() + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--generate-card", type=Path, help="02 任务本体视图 YAML")
    parser.add_argument("--output", type=Path, help="生成的 Markdown 任务卡")
    args = parser.parse_args()

    errors: list[str] = []
    try:
        registry = load_yaml(REGISTRY_PATH)
    except ValueError as exc:
        print(f"03_RETURN_REQUIRED: {exc}")
        return 1
    validate_registry(registry, errors)
    validate_frontstage(errors)
    validate_ops_and_qp_links(errors)
    if errors:
        print("03_RETURN_REQUIRED:")
        for error in errors:
            print(f"- {error}")
        return 1

    if args.generate_card:
        if not args.output:
            print("03_RETURN_REQUIRED: --generate-card 必须同时提供 --output")
            return 1
        try:
            generate_card(args.generate_card, args.output, registry)
        except ValueError as exc:
            print(f"03_RETURN_REQUIRED: {exc}")
            return 1
        print(f"03_CARD_GENERATED: {args.output}")
        return 0
    if args.output:
        print("03_RETURN_REQUIRED: --output 只能与 --generate-card 同时使用")
        return 1
    print("03_PASS: 证据准备边界、双轴完备度、依赖规则与 QP 链接校验通过。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
