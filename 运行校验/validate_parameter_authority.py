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
    (r"(?<![A-Z_])JUDGMENT_LEVELS\s*=\s*\{", "不得硬编码 JUDGMENT_LEVELS 集合"),
    (r"(?<![A-Z_])EVIDENCE_GRADES\s*=\s*\{", "不得硬编码 EVIDENCE_GRADES 集合"),
    (r"(?<![A-Z_])PATH_READINESS_STATUSES\s*=\s*\{", "不得硬编码 PATH_READINESS_STATUSES 集合"),
    (r"(?<![A-Z_])PATH_RESULT_STATUSES\s*=\s*\{", "不得硬编码 PATH_RESULT_STATUSES 集合"),
    (r"(?<![A-Z_])SOURCE_TIERS\s*=\s*\{", "不得硬编码 SOURCE_TIERS 集合"),
    (r"(?<![A-Z_])SOURCE_AUTHORITY_LEVELS\s*=\s*\{", "不得硬编码 SOURCE_AUTHORITY_LEVELS 集合"),
    (r"(?<![A-Z_])CONFIDENCE_LEVELS\s*=\s*\{", "不得硬编码 CONFIDENCE_LEVELS 集合"),
    (r"evidence_grade_caps\s*=\s*\{", "不得硬编码 evidence_grade_caps 门槛矩阵"),
    (r"counterevidence_caps\s*=\s*\{", "不得硬编码 counterevidence_caps 门槛矩阵"),
    (r"path_readiness_caps\s*=\s*\{", "不得硬编码 path_readiness_caps 门槛矩阵"),
    (r'judgment_levels\s*:\s*\[\s*"J0"', "模板不得内联 judgment_levels 值域"),
]

_SCAN_ALLOWLIST_SUFFIXES = {
    "运行校验/status_derivation.py",  # 仅从本体规则加载集合
    "运行校验/validate_parameter_authority.py",
    "运行校验/ontology_instance_graph.py",  # 兼容展开旧 level_requirements
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
                    "应拆为正式实例或 criterion_template_bindings"
                )
        if "JudgmentUnit" in types and not props.get("criterion_template_bindings"):
            # Allow legacy full JudgmentLevelCriterion objects on disk.
            has_local_criteria = any(
                obj.get("type") == "JudgmentLevelCriterion"
                and (obj.get("properties") or {}).get("judgment_unit_id")
                in {item.get("id"), (item.get("properties") or {}).get("judgment_unit_id")}
                for obj in data["business_instance_graph"].get("objects", [])
            )
            if not has_local_criteria:
                errors.append(
                    f"{path.relative_to(ROOT)} JudgmentUnit {item.get('id')} "
                    "缺少 criterion_template_bindings"
                )


def main() -> int:
    errors: list[str] = []
    coverage = {
        "task_views": 0,
        "domain_instances": 0,
        "stage03_manifests": 0,
        "stage04_audits": 0,
        "authority_refs": 0,
        "authority_matrix": 0,
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
        "judgment_level_criterion_templates": 5,
        "source_profiles": 3,
        "evidence_recipes": 3,
        "proxy_indicators": 1,
    }
    if counts != expected:
        errors.append(f"二级业务实例数量不一致: {counts} != {expected}")
    for filename, forbidden in {
        "evidence.yaml": {"evidence_profiles", "evidence_recipes", "source_profiles", "proxy_indicators"},
        "reasoning.yaml": {
            "state_variables",
            "propagation_templates",
            "scenario_templates",
            "business_scenario_tags",
            "judgment_level_criterion_templates",
        },
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
    for field in (
        "judgment_types",
        "judgment_levels",
        "path_readiness_statuses",
        "path_result_statuses",
        "source_authority_levels",
        "source_tiers",
        "confidence_levels",
        "basket_roles",
    ):
        if field in raw_contract:
            errors.append(f"public_contract 不得重复定义业务参数 {field}")
    refs = raw_contract.get("business_authority_refs") or {}
    coverage["authority_refs"] = len(refs)
    contract = public_contract()
    if set(contract["judgment_levels"]) != status.JUDGMENT_LEVELS:
        errors.append("judgment_levels 未由本体一致驱动")
    if set(contract["path_readiness_statuses"]) != status.PATH_READINESS_STATUSES:
        errors.append("path_readiness_statuses 未由本体一致驱动")
    if set(contract["path_result_statuses"]) != status.PATH_RESULT_STATUSES:
        errors.append("path_result_statuses 未由本体一致驱动")
    if set(contract["source_tiers"]) != status.SOURCE_TIERS:
        errors.append("source_tiers 未由本体一致驱动")
    if set(contract["confidence_levels"]) != status.CONFIDENCE_LEVELS:
        errors.append("confidence_levels 未由本体一致驱动")

    matrix_path = ROOT / "00_全局" / "contracts" / "parameter_authority_matrix.yaml"
    if not matrix_path.is_file():
        errors.append("缺少 parameter_authority_matrix.yaml")
    else:
        matrix = yaml.safe_load(matrix_path.read_text(encoding="utf-8")) or {}
        entries = matrix.get("parameters") or []
        if len(entries) < 8:
            errors.append("parameter_authority_matrix.parameters 条目过少")
        allowed_kinds = {
            "formal_ontology_instance",
            "ontology_rule_param",
            "knowledge_base_ref",
            "runtime_contract",
        }
        matrix_ids: set[str] = set()
        for index, entry in enumerate(entries):
            if not isinstance(entry, dict):
                errors.append(f"parameter_authority_matrix.parameters[{index}] 必须是对象")
                continue
            if entry.get("authority_kind") not in allowed_kinds:
                errors.append(
                    f"parameter_authority_matrix.parameters[{index}].authority_kind 非法"
                )
            entry_id = str(entry.get("id") or "").strip()
            if not entry_id:
                errors.append(f"parameter_authority_matrix.parameters[{index}].id 为空")
            else:
                matrix_ids.add(entry_id)
        # 领域实例族与 business_authority_refs 必须在矩阵中有权威登记。
        required_matrix_ids = set(expected) | set(refs) | {
            "judgment_evidence_threshold",
            "judgment_method_routes",
            "stage_statuses",
            "quality_status",
        }
        missing_matrix = sorted(required_matrix_ids - matrix_ids)
        if missing_matrix:
            errors.append(
                f"parameter_authority_matrix 缺少已有权威项登记: {missing_matrix}"
            )
        ownership = raw_contract.get("ownership") or {}
        formal_owned = set(ownership.get("formal_ontology") or [])
        required_formal = {
            "state_variables",
            "evidence_profiles",
            "propagation_templates",
            "scenario_templates",
            "business_scenario_tags",
            "judgment_level_criterion_templates",
            "evidence_recipes",
            "source_profiles",
            "proxy_indicators",
        }
        missing_formal = sorted(required_formal - formal_owned)
        if missing_formal:
            errors.append(
                f"public_contract.ownership.formal_ontology 缺少: {missing_formal}"
            )
        public_owned = set(ownership.get("public_contract") or [])
        if "judgment_method_routes" not in public_owned:
            errors.append(
                "public_contract.ownership.public_contract 缺少 judgment_method_routes"
            )
        not_promoted = matrix.get("not_promoted") or []
        if not isinstance(not_promoted, list) or len(not_promoted) < 3:
            errors.append(
                "parameter_authority_matrix.not_promoted 须登记不升格项"
                "（二级证据维度 / 事件分类 / 04 审计枚举等）"
            )
        else:
            for index, item in enumerate(not_promoted):
                if not isinstance(item, dict) or not str(item.get("id") or "").strip():
                    errors.append(
                        f"parameter_authority_matrix.not_promoted[{index}] 须含 id"
                    )
                elif str(item.get("id")) in matrix_ids:
                    errors.append(
                        f"not_promoted.{item.get('id')} 不得同时出现在 parameters"
                    )
        coverage["authority_matrix"] = len(entries)

    kb03 = yaml.safe_load((ROOT / "知识库_03取证" / "03_registry.yaml").read_text(encoding="utf-8")) or {}
    if "ontology_authority_refs" not in kb03:
        errors.append("知识库_03取证/03_registry.yaml 缺少 ontology_authority_refs")
    for role, meta in (kb03.get("evidence_roles") or {}).items():
        if not isinstance(meta, dict) or not meta.get("basket_role_ref"):
            errors.append(f"KB03 evidence_roles.{role} 缺少 basket_role_ref")
        elif meta.get("basket_role_ref") not in status.BASKET_ROLES:
            errors.append(
                f"KB03 evidence_roles.{role}.basket_role_ref 不在本体篮子角色中"
            )
    for key, meta in (kb03.get("quality_language") or {}).items():
        if key not in status.QUALITY_LANGUAGE_TO_EVIDENCE_GRADES:
            errors.append(f"KB03 quality_language.{key} 未在本体规则参数中登记")
        if not isinstance(meta, dict) or "machine_evidence_grades_ref" not in meta:
            errors.append(f"KB03 quality_language.{key} 缺少 machine_evidence_grades_ref")
        if "machine_evidence_grades" in (meta or {}):
            errors.append(
                f"KB03 quality_language.{key} 不得再内联 machine_evidence_grades；只保留 ref"
            )

    _scan_duplicate_authority(errors)

    owned = (
        coverage["task_views"]
        + coverage["domain_instances"]
        + coverage["stage03_manifests"]
        + coverage["stage04_audits"]
        + coverage["authority_refs"]
        + coverage.get("authority_matrix", 0)
    )
    required = (
        len(task_views)
        + sum(expected.values())
        + len(list(ROOT.glob("示例*/03-*语义域与证据域实例清单-*.yaml")))
        + len(list(ROOT.glob("示例*/04-*推理审计-*.yaml")))
        + len(refs)
        + coverage.get("authority_matrix", 0)
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
        "28 个传导模板、4 个情景模板、9 个情景标签、5 个 J 门槛模板、取证配方/来源画像/代理指标"
        "及判断门槛均由本体单一驱动。"
    )
    print(f"PARAMETER_OWNERSHIP_COVERAGE: {coverage_rate:.2%} ({owned}/{required})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
