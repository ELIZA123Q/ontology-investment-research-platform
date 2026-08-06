#!/usr/bin/env python3
"""只读校验 02 框架库的机器事实、门槛、内容结构与引用。

重点检查：
- registry 是唯一依赖事实源，且可被 YAML 正确解析；
- output gate、最低证据、门槛引用、依赖方向、循环与可达性；
- 框架正文不再复制 builds_on / hard_prerequisites / downstream_unlocks；
- Framework Output Contract 与 registry 的 output gate 完全对齐；
- 半导体主框架具备区分预测、真实任务验证状态且不过度重复；
- 场景卡、内部链接和正式本体标识符仍然可用。

校验通过只表示知识资产内部一致，不表示具体研究结论正确。
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Set, Tuple

import yaml


ROOT = Path(__file__).resolve().parent
WORKSPACE = ROOT.parents[3]  # 90_compat/methods/<lib> → repo
sys.path.insert(0, str(WORKSPACE / "05_governance/03_校验"))

from research_contract import public_contract  # noqa: E402


CANONICAL_JUDGMENT_TYPES = set(public_contract()["judgment_types"])


REQUIRED_FRONT_MATTER = ("framework_id", "name", "library", "version")
REQUIRED_SCENARIO_FRONT_MATTER = (
    "document_type",
    "scenario_id",
    "name",
    "version",
    "scenario_kind",
    "default_framework_id",
)
REQUIRED_SCENARIO_SECTIONS = (
    "本场景相对于主框架增加什么",
    "和哪个主框架一起用",
    "场景特有判断脊柱",
    "场景增量变量与竞争解释",
    "对 02 和 03 的增量交接",
)
REQUIRED_CONTRACT_FIELDS = (
    "framework_layer",
    "output_gate_refs",
    "judgment_types",
    "state_variable_candidates",
    "signal_candidates",
    "output_objects",
    "evidence_requirements",
    "falsification_conditions",
    "scenarios",
)
BANNED_STATIC_DEPENDENCY_FIELDS = (
    "hard_prerequisites",
    "quality_gate",
    "quality_gates",
    "downstream_unlocks",
)
EXPECTED_OUTPUT_CONTRACT_FIELDS = {
    "framework_id",
    "call_role",
    "judgment_unit_refs",
    "target_output_gates",
    "framework_layer",
    "gate_status",
    "prerequisite_judgment_refs",
    "judgment_types",
    "candidate_claims",
    "state_variable_candidates",
    "signal_candidates",
    "evidence_requirements",
    "falsification_conditions",
    "scenarios",
    "output_objects",
    "downstream_unlocks",
    "unresolved_gaps",
}

EXPECTED_JUDGMENT_FRAMEWORK_IDS = {
    "JF-STATE",
    "JF-TREND",
    "JF-CYCLE",
    "JF-ATTR",
    "JF-MECH",
    "JF-TRANS",
    "JF-DIFF",
    "JF-IMPACT",
    "JF-EXPECT",
    "JF-VALUATION",
}
EXPECTED_BASE_FRAMEWORK_LAYERS = {
    "BF-IC-01": "mechanism",
    "BF-MF-01": "mechanism",
    "BF-PI-01": "mechanism",
    "BF-SD-01": "mechanism",
    "BF-VT-01": "mechanism",
    "BF-PC-01": "mechanism",
    "BF-BM-01": "company_realization",
    "BF-FQ-01": "company_realization",
    "BF-EE-01": "company_realization",
    "BF-CG-01": "company_realization",
    "BF-CA-01": "company_realization",
    "BF-FS-01": "market_pricing",
    "BF-EG-01": "market_pricing",
    "BF-RS-01": "market_pricing",
    "BF-VA-01": "market_pricing",
}
EXPECTED_INDUSTRY_FRAMEWORK_LAYERS = {
    "IF-SC-01": "mechanism",
    "IF-LOC-01": "mechanism",
    "IF-APP-01": "mechanism",
    "IF-DES-01": "company_realization",
    "IF-FAB-01": "mechanism",
    "IF-PKG-01": "mechanism",
    "IF-EQP-01": "company_realization",
    "IF-MAT-01": "company_realization",
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
VALUATION_ENTRY_REFS = {
    "BF-EE-01.earnings_bridge",
    "BF-FS-01.conditional_forecast",
    "BF-EG-01.prior_expectation_baseline",
    "upstream_industry_or_mechanism_judgment",
    "valuation_input_change",
}

FRAMEWORK_ID_RE = re.compile(r"\b(?:BF|IF)-[A-Z]+-[0-9]+\b")
GATE_REF_RE = re.compile(r"^((?:BF|IF)-[A-Z]+-[0-9]+)\.([a-z][a-z0-9_]*)$")
SCENARIO_REF_RE = re.compile(r"\bSCN-[A-Z]+(?:-[A-Z]+)?\b")


def parse_front_matter(text: str) -> Tuple[Dict[str, Any], str, Optional[str]]:
    if not text.startswith("---\n"):
        return {}, text, None
    end = text.find("\n---\n", 4)
    if end < 0:
        return {}, text, "front matter 未闭合"
    raw = text[4:end]
    try:
        parsed = yaml.safe_load(raw) or {}
    except yaml.YAMLError as exc:
        return {}, text[end + 5 :], f"front matter YAML 无法解析: {exc}"
    if not isinstance(parsed, dict):
        return {}, text[end + 5 :], "front matter 必须是 YAML 对象"
    return dict(parsed), text[end + 5 :], None


def extract_contract(text: str) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    pattern = re.compile(
        r"^##\s+(?:本框架应交付什么[^\n]*|5\.\s+本框架特有输出)\s*$"
        r"(?P<body>.*?)(?=^##\s+|\Z)",
        flags=re.MULTILINE | re.DOTALL,
    )
    match = pattern.search(text)
    if not match:
        return None, "缺少 Framework Output Contract / 本框架特有输出"
    yaml_match = re.search(r"```yaml\s*\n(.*?)\n```", match.group("body"), flags=re.DOTALL)
    if not yaml_match:
        return None, "Framework Output Contract 缺少 YAML 代码块"
    try:
        parsed = yaml.safe_load(yaml_match.group(1)) or {}
    except yaml.YAMLError as exc:
        return None, f"Framework Output Contract YAML 无法解析: {exc}"
    if not isinstance(parsed, dict):
        return None, "Framework Output Contract 必须是 YAML 对象"
    return dict(parsed), None


def classify_asset(path: Path, root: Path, front: Mapping[str, Any]) -> str:
    rel = path.relative_to(root)
    parts = rel.parts
    name = path.name
    doc_type = str(front.get("document_type", ""))
    if name == "README.md" or name.startswith("00_") or "治理" in parts:
        return "skip"
    if doc_type in {
        "industry_framework_governance",
        "scenario_card_guide",
        "framework_admission_checklist",
        "framework_usage_record_template",
    }:
        return "skip"
    if "场景卡" in parts:
        return "scenario_card" if doc_type == "semiconductor_scenario_card" else "skip"
    if parts[0] == "基础框架库" or "主框架" in parts:
        return "framework"
    if front.get("framework_id") and "行业框架库" not in parts:
        return "framework"
    if parts[:2] == ("行业框架库", "半导体行业"):
        return "invalid"
    return "skip"


def iter_markdown_assets(root: Path) -> List[Path]:
    files = list((root / "基础框架库").glob("*.md"))
    files += list((root / "行业框架库").glob("**/*.md"))
    return sorted(files)


def ontology_identifiers(workspace: Path) -> Set[str]:
    identifiers: Set[str] = set()
    key_re = re.compile(r"^\s{2,}([A-Za-z][A-Za-z0-9_]*):(?:\s|$)")
    id_re = re.compile(r"\bid:\s*([A-Za-z][A-Za-z0-9_]*)")
    paths: List[Path] = []
    models = workspace / "01_semantic/01_ontology/models"
    if models.is_dir():
        paths.extend(sorted(models.glob("*.yaml")))
    domain = workspace / "01_semantic/01_ontology/domains/semiconductor"
    if domain.is_dir():
        for name in ("business_instances.yaml",):
            candidate = domain / name
            if candidate.is_file():
                paths.append(candidate)
    for path in paths:
        for line in path.read_text(encoding="utf-8").splitlines():
            match = key_re.match(line)
            if match:
                identifiers.add(match.group(1))
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


def validate_scenario_sections(relative: Path, text: str, errors: List[str]) -> None:
    headings = numbered_headings(text)
    if len(headings) != len(REQUIRED_SCENARIO_SECTIONS):
        errors.append(f"{relative}: 场景卡应有{len(REQUIRED_SCENARIO_SECTIONS)}个编号二级标题，实际为{len(headings)}")
        return
    for index, ((number, title), expected) in enumerate(zip(headings, REQUIRED_SCENARIO_SECTIONS), 1):
        if number != str(index) or title != expected:
            errors.append(f"{relative}: 第{index}节应为‘## {index}. {expected}’，实际为‘## {number}. {title}’")


def meaningful_lines(text: str) -> Set[str]:
    _, body, _ = parse_front_matter(text)
    body = re.sub(r"```yaml.*?```", "", body, flags=re.DOTALL)
    ignored = {
        "使用时字段见[README](../../../README.md#4-依赖登记与输出合同)，精确门槛读[依赖登记表](../../../00_framework_dependency_registry.yaml)。",
        "使用时字段和职责交接见[README](../../../README.md#4-依赖登记与输出合同)，精确门槛读[依赖登记表](../../../00_framework_dependency_registry.yaml)。",
        "使用时字段和下游可接续内容见[README](../../../README.md#4-依赖登记与输出合同)，精确门槛读[依赖登记表](../../../00_framework_dependency_registry.yaml)。",
        "使用本框架时，写清：前提判断是否具备、待验证观点有哪些、还有哪些未决缺口；字段说明见[README](../README.md#4-依赖登记与输出合同)，精确门槛读[依赖登记表](../00_framework_dependency_registry.yaml)。",
        "使用本框架时，写清：前提判断是否具备、待验证观点有哪些、还有哪些未决缺口，以及下游可接续什么；字段说明见[README](../README.md#4-依赖登记与输出合同)，精确门槛读[依赖登记表](../00_framework_dependency_registry.yaml)。",
        "组合方式见框架库 README「怎样选用」；系统核对见文末登记说明。需要核对进入条件与可写到哪一层时，见根目录依赖说明。",
        "候选变量和信号不表示单次任务全部使用。组合方式见框架库 README「怎样选用」；系统核对见文末登记说明。需要核对进入条件与可写到哪一层时，见根目录依赖说明。",
        "候选节点、变量和信号不表示单次任务全部使用。组合方式见框架库 README「怎样选用」；系统核对见文末登记说明。需要核对进入条件与可写到哪一层时，见根目录依赖说明。",
        "以下为系统登记，研究员可不读。",
        "02 只登记候选反证；是否命中、降级或改判由 04 裁决。",
    }
    lines: Set[str] = set()
    for raw in body.splitlines():
        line = re.sub(r"\s+", " ", raw.strip())
        if not line or line.startswith("#") or line.startswith("```"):
            continue
        if re.fullmatch(r"\|?\s*[-:]+(?:\s*\|\s*[-:]+)+\s*\|?", line):
            continue
        if line in ignored or len(line) < 16:
            continue
        lines.add(line)
    return lines


def validate_duplicate_content(framework_texts: Mapping[str, str], warnings: List[str]) -> None:
    line_sets = {framework_id: meaningful_lines(text) for framework_id, text in framework_texts.items()}
    ids = sorted(line_sets)
    for index, left in enumerate(ids):
        for right in ids[index + 1 :]:
            denominator = min(len(line_sets[left]), len(line_sets[right]))
            if denominator < 12:
                continue
            ratio = len(line_sets[left] & line_sets[right]) / denominator
            if ratio >= 0.38:
                warnings.append(f"重复内容: {left} 与 {right} 的有效行重合率为 {ratio:.0%}（警戒线 38%）")


def validate_discrimination_table(relative: Path, text: str, errors: List[str]) -> None:
    """检查竞争解释至少给出两项非空且不同的可观察预测。"""
    lines = text.splitlines()
    header_index = next(
        (index for index, line in enumerate(lines) if "| 解释 | 区分预测 |" in line),
        None,
    )
    if header_index is None:
        errors.append(f"{relative}: 竞争解释未声明不同的可观察预测")
        return
    predictions: List[str] = []
    for line in lines[header_index + 2 :]:
        if not line.strip().startswith("|"):
            break
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) >= 2 and cells[0] and cells[1]:
            predictions.append(cells[1])
    if len(predictions) < 2:
        errors.append(f"{relative}: 竞争解释表至少需要主解释和一项竞争解释")
    elif len(set(predictions)) != len(predictions):
        errors.append(f"{relative}: 竞争解释存在相同区分预测，不能产生可辨识差异")
    for prediction in predictions:
        if prediction in {"关注数据", "待验证", "数据改善", "数据恶化"}:
            errors.append(f"{relative}: 区分预测‘{prediction}’不可执行")


TASK_SELECTION_REQUIRED_KEYS = (
    "main_route",
    "competing_route",
    "critical_judgment_units",
    "decisive_variable_refs",
    "activated_modules",
    "excluded_modules",
    "target_output_gates",
    "prerequisite_frameworks",
    "downstream_handoffs",
    "stop_conditions",
)


def validate_task_selection_block(relative: Path, text: str, errors: List[str]) -> None:
    """基础框架必须提供统一的 *_task_selection 裁剪结果样板。"""
    if re.search(r"(?m)^\w+_task_cut:", text):
        errors.append(f"{relative}: 禁止使用 *_task_cut 根键，请统一为 *_task_selection")
    matches = list(re.finditer(r"(?m)^(\w+_task_selection):\s*$", text))
    if not matches:
        errors.append(f"{relative}: 缺少 *_task_selection 单次 02 裁剪结果块")
        return
    for match in matches:
        start = match.end()
        block_lines: List[str] = []
        for line in text[start:].splitlines():
            if line.strip() == "```":
                break
            block_lines.append(line)
        block = "\n".join(block_lines)
        for key in TASK_SELECTION_REQUIRED_KEYS:
            if not re.search(rf"(?m)^\s*{re.escape(key)}\s*:", block):
                errors.append(f"{relative}: {match.group(1)} 缺少必填键 {key}")


def find_cycle(graph: Mapping[str, Set[str]]) -> Optional[List[str]]:
    visiting: Set[str] = set()
    visited: Set[str] = set()
    stack: List[str] = []

    def visit(node: str) -> Optional[List[str]]:
        if node in visiting:
            start = stack.index(node)
            return stack[start:] + [node]
        if node in visited:
            return None
        visiting.add(node)
        stack.append(node)
        for neighbor in sorted(graph.get(node, set())):
            cycle = visit(neighbor)
            if cycle:
                return cycle
        stack.pop()
        visiting.remove(node)
        visited.add(node)
        return None

    for node in sorted(graph):
        cycle = visit(node)
        if cycle:
            return cycle
    return None


def load_registry(root: Path, errors: List[str]) -> Tuple[Dict[str, Any], Dict[str, Dict[str, Any]]]:
    path = root / "00_framework_dependency_registry.yaml"
    if not path.exists():
        errors.append("框架库: 缺少机器可读依赖登记")
        return {}, {}
    try:
        registry = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as exc:
        errors.append(f"依赖登记: YAML 无法解析: {exc}")
        return {}, {}
    if not isinstance(registry, dict):
        errors.append("依赖登记: 顶层必须是 YAML 对象")
        return {}, {}
    if str(registry.get("schema_version", "")) != "2.0.0":
        errors.append("依赖登记: schema_version 必须为 2.0.0")
    if registry.get("machine_truth") is not True:
        errors.append("依赖登记: machine_truth 必须为 true")
    base = registry.get("frameworks")
    industry = registry.get("industry_overlays")
    if not isinstance(base, dict) or not isinstance(industry, dict):
        errors.append("依赖登记: frameworks 与 industry_overlays 必须是对象")
        return registry, {}
    entries = {str(key): value for key, value in {**base, **industry}.items()}
    return registry, entries


def validate_registry(registry: Mapping[str, Any], entries: Mapping[str, Dict[str, Any]], errors: List[str]) -> None:
    expected_layers = {**EXPECTED_BASE_FRAMEWORK_LAYERS, **EXPECTED_INDUSTRY_FRAMEWORK_LAYERS}
    if set(entries) != set(expected_layers):
        missing = sorted(set(expected_layers) - set(entries))
        extra = sorted(set(entries) - set(expected_layers))
        if missing:
            errors.append(f"依赖登记缺失框架: {', '.join(missing)}")
        if extra:
            errors.append(f"依赖登记存在未治理框架: {', '.join(extra)}")
    graph: Dict[str, Set[str]] = {framework_id: set() for framework_id in entries}

    for framework_id, entry in entries.items():
        if not isinstance(entry, dict):
            errors.append(f"依赖登记: {framework_id} 必须是对象")
            continue
        if entry.get("layer") != expected_layers.get(framework_id):
            errors.append(f"依赖登记: {framework_id}.layer 应为 {expected_layers.get(framework_id)}")
        entry_requires = entry.get("entry_requires")
        if not isinstance(entry_requires, list) or not entry_requires:
            errors.append(f"依赖登记: {framework_id}.entry_requires 必须是非空列表")
        output_gates = entry.get("output_gates")
        if not isinstance(output_gates, dict) or not output_gates:
            errors.append(f"依赖登记: {framework_id}.output_gates 必须是非空对象")
            output_gates = {}
        for gate_id, gate in output_gates.items():
            if not re.fullmatch(r"[a-z][a-z0-9_]*", str(gate_id)):
                errors.append(f"依赖登记: {framework_id} 输出门槛 ID 非法 {gate_id}")
            if not isinstance(gate, dict):
                errors.append(f"依赖登记: {framework_id}.{gate_id} 必须是对象")
                continue
            if not isinstance(gate.get("requires"), list) or not gate["requires"]:
                errors.append(f"依赖登记: {framework_id}.{gate_id}.requires 必须是非空列表")
            minimum_evidence = gate.get("minimum_evidence")
            if not isinstance(minimum_evidence, list) or len(minimum_evidence) < 2:
                errors.append(f"依赖登记: {framework_id}.{gate_id}.minimum_evidence 至少需要两项交叉证据")
            elif len({str(item) for item in minimum_evidence}) != len(minimum_evidence):
                errors.append(f"依赖登记: {framework_id}.{gate_id}.minimum_evidence 存在重复项")

        quality_gates = entry.get("quality_gates", {})
        if not isinstance(quality_gates, dict):
            errors.append(f"依赖登记: {framework_id}.quality_gates 必须是对象")
            quality_gates = {}
        for gate_id, gate in quality_gates.items():
            if not isinstance(gate, dict) or not isinstance(gate.get("requires"), list) or not gate.get("on_failure"):
                errors.append(f"依赖登记: {framework_id}.quality_gates.{gate_id} 缺少 requires 或 on_failure")

        unlocks = entry.get("downstream_unlocks")
        if not isinstance(unlocks, list):
            errors.append(f"依赖登记: {framework_id}.downstream_unlocks 必须是列表")
            unlocks = []
        for target in unlocks:
            if target not in entries:
                errors.append(f"依赖登记: {framework_id} 解锁未知框架 {target}")
            else:
                graph[framework_id].add(str(target))
        handoffs = entry.get("boundary_handoffs")
        if not isinstance(handoffs, dict):
            errors.append(f"依赖登记: {framework_id}.boundary_handoffs 必须是对象")
        else:
            for owner in handoffs.values():
                if owner not in entries:
                    errors.append(f"依赖登记: {framework_id} 职责交接到未知框架 {owner}")

    for framework_id, entry in entries.items():
        for gate_group in (entry.get("output_gates", {}), entry.get("quality_gates", {})):
            if not isinstance(gate_group, dict):
                continue
            for gate in gate_group.values():
                if not isinstance(gate, dict):
                    continue
                for requirement in gate.get("requires", []):
                    match = GATE_REF_RE.match(str(requirement))
                    if not match:
                        continue
                    prerequisite_id, gate_id = match.groups()
                    prerequisite = entries.get(prerequisite_id)
                    if prerequisite is None:
                        errors.append(f"依赖登记: {framework_id} 引用未知框架 {prerequisite_id}")
                        continue
                    if gate_id not in prerequisite.get("output_gates", {}):
                        errors.append(f"依赖登记: {framework_id} 引用未知输出门槛 {requirement}")
                    if framework_id not in prerequisite.get("downstream_unlocks", []):
                        errors.append(f"依赖方向: {framework_id} 依赖 {requirement}，但 {prerequisite_id} 未解锁 {framework_id}")

    cycle = find_cycle(graph)
    if cycle:
        errors.append(f"依赖登记: downstream_unlocks 形成循环 {' -> '.join(cycle)}")

    roots = registry.get("graph_roots")
    if not isinstance(roots, list) or not roots:
        errors.append("依赖登记: graph_roots 必须是非空列表")
    else:
        unknown_roots = sorted(set(roots) - set(entries))
        if unknown_roots:
            errors.append(f"依赖登记: graph_roots 含未知框架 {', '.join(unknown_roots)}")
        reachable: Set[str] = set()
        pending = [str(item) for item in roots if item in entries]
        while pending:
            current = pending.pop()
            if current in reachable:
                continue
            reachable.add(current)
            pending.extend(graph.get(current, set()) - reachable)
        unreachable = sorted(set(entries) - reachable)
        if unreachable:
            errors.append(f"依赖登记: 存在不可达框架 {', '.join(unreachable)}")

    valuation = entries.get("BF-VA-01", {}).get("output_gates", {}).get("valuation_entry", {})
    valuation_requires = set(valuation.get("requires", [])) if isinstance(valuation, dict) else set()
    missing_valuation = sorted(VALUATION_ENTRY_REFS - valuation_requires)
    if missing_valuation:
        errors.append(f"依赖登记: BF-VA-01.valuation_entry 缺少 {', '.join(missing_valuation)}")

    actual_contract_fields = registry.get("output_contract_required_fields")
    if not isinstance(actual_contract_fields, list) or set(actual_contract_fields) != EXPECTED_OUTPUT_CONTRACT_FIELDS:
        errors.append("依赖登记: output_contract_required_fields 与统一运行容器不一致")


def validate(root: Path) -> Tuple[List[str], List[str], int, int]:
    workspace = root.parents[3]
    files = iter_markdown_assets(root)
    errors: List[str] = []
    warnings: List[str] = []
    ontology_ids = ontology_identifiers(workspace)
    registry, registry_entries = load_registry(root, errors)
    if registry_entries:
        validate_registry(registry, registry_entries, errors)

    registry_path = root / "00_framework_dependency_registry.yaml"
    if not registry_path.exists():
        errors.append("框架库: 缺少依赖登记表 00_framework_dependency_registry.yaml")

    router = root / "README.md"
    if not router.exists():
        errors.append("README: 缺少判断类型选用说明")
    else:
        router_text = router.read_text(encoding="utf-8")
        missing = sorted(EXPECTED_JUDGMENT_FRAMEWORK_IDS - set(re.findall(r"\bJF-[A-Z]+\b", router_text)))
        if missing:
            errors.append(f"README 判断类型缺失: {', '.join(missing)}")
        for phrase in ("竞争解释", "区分信号", "推翻条件", "待验证观点", "04"):
            if phrase not in router_text:
                errors.append(f"README 缺少判断类型核心要素‘{phrase}’")
        for phrase in ("可证伪", "有边界", "不跳步", "可区分", "可降级", "atomic_claim", "mechanism_ref"):
            if phrase not in router_text:
                errors.append(f"README 缺少待验证观点检查项‘{phrase}’")

    metadata: Dict[Path, Dict[str, Any]] = {}
    classes: Dict[Path, str] = {}
    framework_ids: Dict[str, Path] = {}
    scenario_ids: Dict[str, Path] = {}

    for path in files:
        text = path.read_text(encoding="utf-8")
        front, _body, parse_error = parse_front_matter(text)
        if parse_error:
            errors.append(f"{path.relative_to(root)}: {parse_error}")
        metadata[path] = front
        asset_class = classify_asset(path, root, front)
        classes[path] = asset_class
        if asset_class == "invalid":
            errors.append(f"{path.relative_to(root)}: 文档位置或 document_type 不符合结构")
            continue
        if asset_class == "framework":
            for key in REQUIRED_FRONT_MATTER:
                if not front.get(key):
                    errors.append(f"{path.relative_to(root)}: 缺少 front matter 字段 {key}")
            if "builds_on" in front:
                errors.append(f"{path.relative_to(root)}: builds_on 已禁用，依赖只能写入 registry")
            framework_id = str(front.get("framework_id", ""))
            if framework_id:
                if framework_id in framework_ids:
                    errors.append(f"{path.relative_to(root)}: framework_id {framework_id} 重复")
                framework_ids[framework_id] = path
        elif asset_class == "scenario_card":
            for key in REQUIRED_SCENARIO_FRONT_MATTER:
                if not front.get(key):
                    errors.append(f"{path.relative_to(root)}: 缺少 front matter 字段 {key}")
            scenario_id = str(front.get("scenario_id", ""))
            if front.get("document_type") != "semiconductor_scenario_card":
                errors.append(f"{path.relative_to(root)}: document_type 应为 semiconductor_scenario_card")
            if scenario_id:
                if scenario_id in scenario_ids:
                    errors.append(f"{path.relative_to(root)}: scenario_id {scenario_id} 重复")
                scenario_ids[scenario_id] = path

    framework_texts: Dict[str, str] = {}
    for framework_id, path in framework_ids.items():
        text = path.read_text(encoding="utf-8")
        front = metadata[path]
        relative = path.relative_to(root)
        framework_texts[framework_id] = text
        contract, contract_error = extract_contract(text)
        if contract_error:
            errors.append(f"{relative}: {contract_error}")
            continue
        assert contract is not None
        for field in REQUIRED_CONTRACT_FIELDS:
            if field not in contract:
                errors.append(f"{relative}: Framework Output Contract 缺少 {field}")
        judgment_types = contract.get("judgment_types")
        if not isinstance(judgment_types, list) or not judgment_types:
            errors.append(f"{relative}: judgment_types 必须是非空列表")
        else:
            unknown_types = sorted(set(map(str, judgment_types)) - CANONICAL_JUDGMENT_TYPES)
            if unknown_types:
                errors.append(
                    f"{relative}: judgment_types 含公共合同之外的类型 {', '.join(unknown_types)}"
                )
        for field in BANNED_STATIC_DEPENDENCY_FIELDS:
            if field in contract:
                errors.append(f"{relative}: 静态合同不得声明 {field}，请读取 registry")
        registry_entry = registry_entries.get(framework_id)
        if registry_entry:
            if contract.get("framework_layer") != registry_entry.get("layer"):
                errors.append(f"{relative}: framework_layer 与 registry 不一致")
            expected_refs = {
                f"{framework_id}.{gate_id}" for gate_id in registry_entry.get("output_gates", {})
            }
            actual_refs = set(contract.get("output_gate_refs", [])) if isinstance(contract.get("output_gate_refs"), list) else set()
            if actual_refs != expected_refs:
                errors.append(
                    f"{relative}: output_gate_refs 与 registry 不一致；"
                    f"缺少 {sorted(expected_refs - actual_refs)}，多出 {sorted(actual_refs - expected_refs)}"
                )
        if front.get("library") == "base" and not re.match(r"^[23]\.", str(front.get("version", ""))):
            errors.append(f"{relative}: 基础框架 version 应为 2.x 或 3.x")
        if front.get("library") == "base":
            validate_task_selection_block(relative, text, errors)
        if "研究员先看什么" not in text:
            errors.append(f"{relative}: 缺少‘研究员先看什么’")
        semantic_groups = (
            ("适用", "边界"),
            ("机制",),
            ("证据",),
            ("其他可能解释", "竞争解释"),
            ("停止条件",),
            ("组合", "裁剪"),
        )
        for alternatives in semantic_groups:
            if not any(term in text for term in alternatives):
                errors.append(f"{relative}: 缺少语义单元 {'/'.join(alternatives)}")
        if "半导体行业" in path.parts and "主框架" in path.parts:
            validate_discrimination_table(relative, text, errors)
            if front.get("validation_status") not in {"pending_two_tasks", "validated_two_tasks"}:
                errors.append(f"{relative}: validation_status 非法或缺失")
            case_refs = front.get("validated_case_refs")
            if not isinstance(case_refs, list):
                errors.append(f"{relative}: validated_case_refs 必须是列表")
                case_refs = []
            for case_ref in case_refs:
                if not (workspace / str(case_ref)).is_file():
                    errors.append(f"{relative}: 真实任务引用不存在 {case_ref}")
            if front.get("validation_status") == "validated_two_tasks" and len(case_refs) < 2:
                errors.append(f"{relative}: validated_two_tasks 至少需要两个真实任务引用")
            line_count = len(text.splitlines())
            if line_count > 120:
                warnings.append(f"{relative}: 主框架仍有 {line_count} 行，建议继续压缩到 80—120 行")

        if "## 8. 本体映射" in text and "## 9." in text:
            mapping = text.split("## 8. 本体映射", 1)[1].split("## 9.", 1)[0]
            formal_mapping = mapping.split("**任务候选或本体缺口**", 1)[0]
            used = set(re.findall(r"`([A-Za-z][A-Za-z0-9_]*)`", formal_mapping))
            unknown = sorted(used - ontology_ids)
            if unknown:
                errors.append(f"{relative}: 本体映射引用未知标识符 {', '.join(unknown)}")

    for path, asset_class in classes.items():
        if asset_class != "scenario_card":
            continue
        text = path.read_text(encoding="utf-8")
        relative = path.relative_to(root)
        validate_scenario_sections(relative, text, errors)
        if "## 2. 和哪个主框架一起用" in text:
            combo = text.split("## 2. 和哪个主框架一起用", 1)[1].split("## 3.", 1)[0]
            unknown_frameworks = sorted(set(FRAMEWORK_ID_RE.findall(combo)) - set(framework_ids))
            unknown_scenarios = sorted(set(SCENARIO_REF_RE.findall(combo)) - set(scenario_ids))
            if unknown_frameworks:
                errors.append(f"{relative}: 和哪个主框架一起用引用未知框架 {', '.join(unknown_frameworks)}")
            if unknown_scenarios:
                errors.append(f"{relative}: 和哪个主框架一起用引用未知场景卡 {', '.join(unknown_scenarios)}")
        line_count = len(text.splitlines())
        if line_count > 120:
            warnings.append(f"{relative}: 场景卡仍有 {line_count} 行，建议压缩到 80—120 行")

    link_files = [root / "README.md"] + files
    for path in link_files:
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        for raw_target, resolved in local_markdown_links(path, text):
            if not resolved.exists():
                errors.append(f"{path.relative_to(root)}: 内部链接不存在 {raw_target}")

    expected_frameworks = set(EXPECTED_BASE_FRAMEWORK_LAYERS) | set(EXPECTED_INDUSTRY_FRAMEWORK_LAYERS)
    if set(framework_ids) != expected_frameworks:
        missing = sorted(expected_frameworks - set(framework_ids))
        extra = sorted(set(framework_ids) - expected_frameworks)
        if missing:
            errors.append(f"正式框架缺失: {', '.join(missing)}")
        if extra:
            warnings.append(f"正式框架出现未治理 ID: {', '.join(extra)}")
    if set(scenario_ids) != EXPECTED_SEMICONDUCTOR_SCENARIO_IDS:
        missing = sorted(EXPECTED_SEMICONDUCTOR_SCENARIO_IDS - set(scenario_ids))
        extra = sorted(set(scenario_ids) - EXPECTED_SEMICONDUCTOR_SCENARIO_IDS)
        if missing:
            errors.append(f"半导体场景卡缺失: {', '.join(missing)}")
        if extra:
            warnings.append(f"半导体场景卡出现未登记 ID: {', '.join(extra)}")

    validate_duplicate_content(framework_texts, warnings)
    return errors, warnings, len(framework_ids), len(scenario_ids)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parent,
        help="90_compat/methods/02_判断结构目录，默认使用脚本所在目录",
    )
    args = parser.parse_args()
    errors, warnings, framework_count, scenario_count = validate(args.root.resolve())
    for warning in warnings:
        print(f"WARN: {warning}")
    for error in errors:
        print(f"ERROR: {error}")
    if errors:
        print(f"FAIL: 校验{framework_count}个框架、{scenario_count}张场景卡，发现{len(errors)}个错误、{len(warnings)}个警告")
        return 1
    print(f"PASS: 校验{framework_count}个框架、{scenario_count}张场景卡，0个错误、{len(warnings)}个警告")
    return 0


if __name__ == "__main__":
    sys.exit(main())
