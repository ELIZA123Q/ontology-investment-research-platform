#!/usr/bin/env python3
"""校验主要业务参数只有一个本体权威源，并输出参数归属覆盖率。"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import yaml

from ontology_instance_graph import (
    expand_judgment_nested_parameters,
    project_downstream_stage_views,
    validate_instance_graph,
)
from research_contract import public_contract
from runtime_instance_graph import (
    AUDIT_REASONING_LISTS,
    STAGE03_OBJECT_CSV,
    STAGE03_RELATION_CSV,
    assert_stage03_projections,
)
import status_derivation as status


ROOT = Path(__file__).resolve().parent.parent

# 禁止在模板/校验代码中重新声明已由本体权威承载的业务枚举或门槛矩阵。
_FORBIDDEN_AUTHORITY_PATTERNS: list[tuple[str, str]] = [
    (r"JUDGMENT_LEVELS\s*=\s*\{", "不得硬编码 JUDGMENT_LEVELS 集合"),
    (r"EVIDENCE_GRADES\s*=\s*\{", "不得硬编码 EVIDENCE_GRADES 集合"),
    (r"PATH_READINESS_STATUSES\s*=\s*\{", "不得硬编码 PATH_READINESS_STATUSES 集合"),
    (r"evidence_grade_caps\s*=\s*\{", "不得硬编码 evidence_grade_caps 门槛矩阵"),
    (r"counterevidence_caps\s*=\s*\{", "不得硬编码 counterevidence_caps 门槛矩阵"),
    (r"path_readiness_caps\s*=\s*\{", "不得硬编码 path_readiness_caps 门槛矩阵"),
    (r'judgment_levels\s*:\s*\[\s*"J0"', "模板不得内联 judgment_levels 值域"),
]

_SCAN_ALLOWLIST_SUFFIXES = {
    "运行校验/status_derivation.py",  # 仅从本体规则加载集合
    "运行校验/validate_parameter_authority.py",
    "运行校验/migrate_contract_v1_1.py",
    "运行校验/migrate_contract_v1_2.py",
    "运行校验/migrate_runtime_instance_graphs.py",
}


def _scan_duplicate_authority(errors: list[str]) -> None:
    scan_roots = [
        ROOT / "运行校验",
        ROOT / "02_判断结构",
        ROOT / "03_数据与证据",
        ROOT / "04_推理",
        ROOT / "05_表达交付",
        ROOT / "00_全局",
        ROOT / "一级通用本体规范",
        ROOT / "二级半导体领域本体规范",
    ]
    for root in scan_roots:
        if not root.is_dir():
            continue
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            if path.suffix not in {".py", ".yaml", ".yml", ".md"}:
                continue
            relative = path.relative_to(ROOT).as_posix()
            if "/tests/" in f"/{relative}/" or relative.startswith("运行校验/tests/"):
                continue
            if relative in _SCAN_ALLOWLIST_SUFFIXES:
                continue
            if relative.endswith("migrate_contract_v1_1.py") or relative.endswith("migrate_contract_v1_2.py"):
                continue
            text = path.read_text(encoding="utf-8-sig", errors="ignore")
            for pattern, message in _FORBIDDEN_AUTHORITY_PATTERNS:
                if re.search(pattern, text):
                    errors.append(f"{relative}: {message}")


def _assert_nested_parameters_instantiated(path: Path, data: dict, errors: list[str]) -> None:
    graph = expand_judgment_nested_parameters(data["business_instance_graph"])
    types = {item.get("type") for item in graph.get("objects", [])}
    required = {"CandidateClaim", "JudgmentLevelCriterion", "EvidenceBasketRequirement"}
    missing = sorted(required - types)
    if missing and "JudgmentUnit" in types:
        errors.append(f"{path.relative_to(ROOT)} 缺少正式嵌套实例类型: {missing}")
    for item in data["business_instance_graph"].get("objects", []):
        if item.get("type") != "JudgmentUnit":
            continue
        props = item.get("properties") or {}
        for nested in ("level_requirements", "mandatory_evidence_baskets"):
            if nested in props:
                errors.append(
                    f"{path.relative_to(ROOT)} JudgmentUnit {item.get('id')} 仍内嵌 {nested}；"
                    "应拆为正式实例"
                )


def main() -> int:
    errors: list[str] = []
    coverage = {
        "task_views": 0,
        "domain_instances": 0,
        "stage03_manifests": 0,
        "stage04_audits": 0,
        "authority_refs": 0,
    }

    task_views = sorted(ROOT.glob("示例*/02-*本体视图-*.yaml")) + [
        ROOT / "02_判断结构" / "模板" / "02_任务本体视图模板.yaml"
    ]
    for path in task_views:
        data = yaml.safe_load(path.read_text(encoding="utf-8-sig"))
        if not isinstance(data, dict) or "business_instance_graph" not in data:
            errors.append(f"{path.relative_to(ROOT)} 未使用 business_instance_graph")
            continue
        forbidden = {
            "judgment_units", "path_design", "instance_requirements", "evidence_requirements",
            "scope_graph", "aggregation_contracts", "research_framework", "semantic_scope",
            "evidence_contract", "reasoning_plan", "ontology_bindings",
        }
        duplicated = sorted(forbidden & set(data))
        if duplicated:
            errors.append(f"{path.relative_to(ROOT)} 仍在磁盘双写业务段: {duplicated}")
        try:
            validate_instance_graph(data["business_instance_graph"])
            if path.parent.name.startswith("示例"):
                _assert_nested_parameters_instantiated(path, data, errors)
                project_downstream_stage_views(data)
            coverage["task_views"] += 1
        except Exception as exc:
            errors.append(f"{path.relative_to(ROOT)}: {exc}")

    domain_dir = ROOT / "二级半导体领域本体规范"
    domain_doc = yaml.safe_load((domain_dir / "business_instances.yaml").read_text(encoding="utf-8"))
    try:
        graph = validate_instance_graph(domain_doc["business_instance_graph"])
        coverage["domain_instances"] = len(graph.get("objects", []))
    except Exception as exc:
        errors.append(f"二级业务实例图: {exc}")
        graph = {"objects": []}
    counts: dict[str, int] = {}
    for item in graph.get("objects", []):
        section = str(item.get("projection", {}).get("section", ""))
        counts[section] = counts.get(section, 0) + 1
    expected = {
        "evidence_profiles": 12,
        "state_variables": 46,
        "propagation_templates": 28,
        "scenario_templates": 4,
        "business_scenario_tags": 9,
    }
    if counts != expected:
        errors.append(f"二级业务实例数量不一致: {counts} != {expected}")
    for filename, forbidden in {
        "evidence.yaml": {"evidence_profiles"},
        "reasoning.yaml": {"state_variables", "propagation_templates", "scenario_templates", "business_scenario_tags"},
    }.items():
        schema = yaml.safe_load((domain_dir / filename).read_text(encoding="utf-8"))
        duplicated = sorted(forbidden & set(schema))
        if duplicated or schema.get("business_instance_graph_ref") != "business_instances.yaml":
            errors.append(f"{filename} registry 未完全迁出: {duplicated}")

    for path in sorted(ROOT.glob("示例*/03-*语义域与证据域实例清单-*.yaml")):
        data = yaml.safe_load(path.read_text(encoding="utf-8-sig"))
        if not isinstance(data, dict) or "business_instance_graph" not in data:
            errors.append(f"{path.relative_to(ROOT)} 未使用 business_instance_graph")
            continue
        if str(data.get("schema_version")) != "3.0.0":
            errors.append(f"{path.relative_to(ROOT)} schema_version 必须为 3.0.0")
        snapshot_name = str(data.get("metadata", {}).get("snapshot_ref", "")).split("/")[0]
        snapshot_dir = path.parent / snapshot_name
        try:
            check = {
                key: value
                for key, value in data["business_instance_graph"].items()
                if key != "projection_fingerprints"
            }
            validate_instance_graph(check, check_relation_endpoints=False)
            assert_stage03_projections(data, snapshot_dir)
            coverage["stage03_manifests"] += 1
        except Exception as exc:
            errors.append(f"{path.relative_to(ROOT)}: {exc}")
        fingerprints = (data.get("business_instance_graph") or {}).get("projection_fingerprints") or {}
        missing = sorted((set(STAGE03_OBJECT_CSV) | set(STAGE03_RELATION_CSV)) - set(fingerprints))
        if missing:
            errors.append(f"{path.relative_to(ROOT)} 缺少投影指纹: {missing}")
        # EvidenceBasket 必须引用需求对象，不得把计划门槛当权威。
        for item in (data.get("business_instance_graph") or {}).get("objects", []):
            if item.get("type") != "EvidenceBasket":
                continue
            props = item.get("properties") or {}
            if not str(props.get("basket_requirement_ref") or props.get("basketRequirementRef") or "").strip():
                errors.append(
                    f"{path.relative_to(ROOT)} EvidenceBasket {item.get('id')} 缺少 basket_requirement_ref"
                )

    for path in sorted(ROOT.glob("示例*/04-*推理审计-*.yaml")):
        text = path.read_text(encoding="utf-8-sig")
        data = yaml.safe_load(text)
        if not isinstance(data, dict) or "business_instance_graph" not in data:
            errors.append(f"{path.relative_to(ROOT)} 未使用 business_instance_graph")
            continue
        if str(data.get("schema_version")) != "4.0.0":
            errors.append(f"{path.relative_to(ROOT)} schema_version 必须为 4.0.0")
        duplicated = sorted(set(AUDIT_REASONING_LISTS) & set(data))
        if duplicated:
            errors.append(f"{path.relative_to(ROOT)} 仍在磁盘双写推理实例段: {duplicated}")
        try:
            validate_instance_graph(data["business_instance_graph"], check_relation_endpoints=False)
            coverage["stage04_audits"] += 1
        except Exception as exc:
            errors.append(f"{path.relative_to(ROOT)}: {exc}")

    raw_contract = yaml.safe_load((ROOT / "00_全局/contracts/public_contract.yaml").read_text(encoding="utf-8"))
    for field in ("judgment_types", "judgment_levels", "path_readiness_statuses"):
        if field in raw_contract:
            errors.append(f"public_contract 不得重复定义业务参数 {field}")
    refs = raw_contract.get("business_authority_refs") or {}
    coverage["authority_refs"] = len(refs)
    contract = public_contract()
    if set(contract["judgment_levels"]) != status.JUDGMENT_LEVELS:
        errors.append("judgment_levels 未由本体一致驱动")
    if set(contract["path_readiness_statuses"]) != status.PATH_READINESS_STATUSES:
        errors.append("path_readiness_statuses 未由本体一致驱动")

    _scan_duplicate_authority(errors)

    owned = (
        coverage["task_views"]
        + coverage["domain_instances"]
        + coverage["stage03_manifests"]
        + coverage["stage04_audits"]
        + coverage["authority_refs"]
    )
    required = (
        len(task_views)
        + sum(expected.values())
        + len(list(ROOT.glob("示例*/03-*语义域与证据域实例清单-*.yaml")))
        + len(list(ROOT.glob("示例*/04-*推理审计-*.yaml")))
        + len(refs)
    )
    coverage_rate = 0.0 if required == 0 else owned / required

    if errors:
        print("PARAMETER_AUTHORITY_RETURN_REQUIRED")
        for error in errors:
            print(f"- {error}")
        print(f"PARAMETER_OWNERSHIP_COVERAGE: {coverage_rate:.2%} ({owned}/{required})")
        return 1
    if coverage_rate < 1.0:
        print("PARAMETER_AUTHORITY_RETURN_REQUIRED")
        print(f"- 参数归属覆盖率未达 100%: {coverage_rate:.2%} ({owned}/{required})")
        return 1
    print(
        "PARAMETER_AUTHORITY_PASS: 02 任务参数、03/04 运行实例、12 个证据画像、46 个状态变量、"
        "28 个传导模板、4 个情景模板、9 个情景标签及判断门槛均由本体单一驱动。"
    )
    print(f"PARAMETER_OWNERSHIP_COVERAGE: {coverage_rate:.2%} ({owned}/{required})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
