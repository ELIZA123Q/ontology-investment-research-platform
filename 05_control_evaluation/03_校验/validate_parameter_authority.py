#!/usr/bin/env python3
"""校验主要业务参数只有一个本体权威源，并输出参数归属覆盖率。"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import yaml

from repo_paths import ensure_all_validator_paths

ensure_all_validator_paths()

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


ROOT = Path(__file__).resolve().parents[2]


def _validate_domain_semantics(domain_doc: dict, graph: dict, errors: list[str]) -> None:
    """把领域业务参数绑定到正式 Ontology 3.0，避免数量通过但语义悬空。"""
    domain_path = ROOT / "01_semantic_knowledge/01_ontology/domains/semiconductor/business_instances.yaml"
    depends_on = domain_doc.get("depends_on") or []
    required_models = {
        "semantic.yaml", "state_event.yaml", "evidence.yaml", "judgment.yaml",
        "ontology_extension.yaml",
    }
    dependency_names = {Path(str(item)).name for item in depends_on}
    missing_dependencies = sorted(required_models - dependency_names)
    if missing_dependencies:
        errors.append(f"二级业务实例 depends_on 缺少正式模型: {missing_dependencies}")

    formal_types: set[str] = set()
    for raw_ref in depends_on:
        path = (domain_path.parent / str(raw_ref)).resolve()
        if not path.is_file():
            errors.append(f"二级业务实例 depends_on 无法解析: {raw_ref}")
            continue
        document = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        formal_types.update(str(item) for item in (document.get("object_types") or {}))

    objects = graph.get("objects") or []
    object_by_id = {str(item.get("id")): item for item in objects if isinstance(item, dict)}
    if len(object_by_id) != len(objects):
        errors.append("二级业务实例对象 ID 不得重复或为空")
    evidence_profiles = {
        object_id for object_id, item in object_by_id.items() if item.get("type") == "EvidenceProfile"
    }
    state_variables = {
        object_id for object_id, item in object_by_id.items() if item.get("type") == "StateVariable"
    }

    state_required = {
        "id", "name", "category", "definition", "decision_use", "variable_kind",
        "anchors", "observation_guidance", "evidence_profile_ref",
        "counter_evidence_guidance", "variable_role",
    }
    for object_id in state_variables:
        props = object_by_id[object_id].get("properties") or {}
        missing = sorted(state_required - set(props))
        if missing:
            errors.append(f"StateVariable {object_id} 缺少稳定定义字段: {missing}")
        if str(props.get("id")) != object_id:
            errors.append(f"StateVariable {object_id}.properties.id 不一致")
        anchors = props.get("anchors") or []
        if not isinstance(anchors, list) or not anchors:
            errors.append(f"StateVariable {object_id}.anchors 不得为空")
        else:
            unresolved = sorted({str(item) for item in anchors} - formal_types)
            if unresolved:
                errors.append(f"StateVariable {object_id}.anchors 引用未定义正式类型: {unresolved}")
        profile_ref = str(props.get("evidence_profile_ref") or "")
        if profile_ref not in evidence_profiles:
            errors.append(f"StateVariable {object_id}.evidence_profile_ref 无法解析: {profile_ref}")

    registry = yaml.safe_load((ROOT / "03_agent_capability/05_method_libraries/03_取证/03_registry.yaml").read_text(encoding="utf-8")) or {}
    method_version = str(registry.get("schema_version") or "")
    for item in objects:
        if not isinstance(item, dict):
            continue
        object_id = str(item.get("id") or "")
        props = item.get("properties") or {}
        object_type = item.get("type")
        if object_type == "PropagationTemplate":
            for field in ("source_variables", "target_variables"):
                refs = {str(ref) for ref in props.get(field) or []}
                unresolved = sorted(refs - state_variables)
                if not refs or unresolved:
                    errors.append(f"PropagationTemplate {object_id}.{field} 为空或悬空: {unresolved}")
            if not str(props.get("time_lag") or "").strip():
                errors.append(f"PropagationTemplate {object_id}.time_lag 不得为空")
            alignment = str(props.get("anchor_alignment") or "")
            alignment_types = {part.strip() for part in alignment.split("/") if part.strip()}
            unresolved = sorted(alignment_types - formal_types)
            if unresolved:
                errors.append(f"PropagationTemplate {object_id}.anchor_alignment 未定义: {unresolved}")
            profile_ref = str(props.get("evidence_profile_ref") or "")
            if profile_ref not in evidence_profiles:
                errors.append(f"PropagationTemplate {object_id}.evidence_profile_ref 无法解析: {profile_ref}")
        elif object_type == "EvidenceRecipe":
            if str(props.get("strategyVersion")) != method_version:
                errors.append(
                    f"EvidenceRecipe {object_id}.strategyVersion 必须与 kb03={method_version} 一致"
                )
            source_ref = ROOT / str(props.get("strategyLibraryRef") or "")
            if not source_ref.is_file():
                errors.append(f"EvidenceRecipe {object_id}.strategyLibraryRef 无法解析")
        elif object_type == "ProxyIndicator":
            required = {
                "id", "proxyIndicatorName", "proxyFor", "targetStateVariableId", "proxyLogic",
                "expectedTimeLag", "validConditions", "invalidConditions", "confidenceDiscount",
                "cannotReplace", "requiredDisclosure",
            }
            missing = sorted(required - set(props))
            if missing:
                errors.append(f"ProxyIndicator {object_id} 缺少字段: {missing}")
            target = str(props.get("targetStateVariableId") or "")
            if target not in state_variables or str(props.get("proxyFor") or "") != target:
                errors.append(f"ProxyIndicator {object_id} 目标变量不一致或无法解析: {target}")

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
    "05_control_evaluation/03_校验/status_derivation.py",  # 仅从本体规则加载集合
    "05_control_evaluation/03_校验/validate_parameter_authority.py",
    "05_control_evaluation/03_校验/knowledge_graph/ontology_instance_graph.py",
}


def _scan_duplicate_authority(errors: list[str]) -> None:
    from repo_paths import STAGE_SPEC_SCAN_ROOTS

    scan_roots = [
        ROOT / "05_control_evaluation/03_校验",
        *STAGE_SPEC_SCAN_ROOTS,
        ROOT / "05_control_evaluation",
        ROOT / "01_semantic_knowledge/01_ontology",
        ROOT / "01_semantic_knowledge/01_ontology/domains/semiconductor",
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
            if "/tests/" in f"/{relative}/" or relative.startswith("05_control_evaluation/03_校验/tests/"):
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

    from repo_paths import stage_yaml_template

    task_views = [stage_yaml_template("02")]
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
            coverage["task_views"] += 1
        except Exception as exc:
            errors.append(f"{path.relative_to(ROOT)}: {exc}")

    domain_dir = ROOT / "01_semantic_knowledge/01_ontology/domains/semiconductor"
    domain_doc = yaml.safe_load((domain_dir / "business_instances.yaml").read_text(encoding="utf-8"))
    try:
        graph = validate_instance_graph(domain_doc["business_instance_graph"])
        coverage["domain_instances"] = len(graph.get("objects", []))
    except Exception as exc:
        errors.append(f"二级业务实例图: {exc}")
        graph = {"objects": []}
    _validate_domain_semantics(domain_doc, graph, errors)
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
        "evidence_recipes": 10,
        "proxy_indicators": 5,
    }
    if counts != expected:
        errors.append(f"二级业务实例数量不一致: {counts} != {expected}")
    # 领域实例已全部迁入 business_instances.yaml；旧二级 evidence/reasoning schema 已退役。
    if not (domain_dir / "business_instances.yaml").is_file():
        errors.append("缺少 01_semantic_knowledge/01_ontology/domains/semiconductor/business_instances.yaml")
    # 正式样例已迁至 02_V3样例；阶段 03/04 的 business_instance_graph 形态由 validate_v3_samples 覆盖。
    v3_runs = sorted((ROOT / "04_context_state" / "03_workspace" / "02_V3样例").glob("*/run_manifest.yaml"))
    coverage["stage03_manifests"] = len(v3_runs)
    coverage["stage04_audits"] = len(v3_runs)
    if len(v3_runs) < 2:
        errors.append("04_context_state/03_workspace/02_V3样例 至少需要两个 run-002 样例")
    raw_contract = yaml.safe_load((ROOT / "05_control_evaluation/02_合同/public_contract.yaml").read_text(encoding="utf-8"))
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

    matrix_path = ROOT / "05_control_evaluation" / "02_合同" / "parameter_authority_matrix.yaml"
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
            "object_types",
            "relation_types",
            "state_variables",
            "state_and_event_types",
            "research_scenario_types",
            "stable_domain_rules",
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

    kb03 = yaml.safe_load((ROOT / "03_agent_capability/05_method_libraries/03_取证" / "03_registry.yaml").read_text(encoding="utf-8")) or {}
    if "ontology_authority_refs" not in kb03:
        errors.append("03_agent_capability/05_method_libraries/03_取证/03_registry.yaml 缺少 ontology_authority_refs")
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
        + coverage["stage03_manifests"]
        + coverage["stage04_audits"]
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
        "28 个传导模板、4 个情景模板、9 个情景标签、5 个 J 门槛模板、取证配方/来源画像/5 个代理指标"
        "及判断门槛均由本体单一驱动。"
    )
    print(f"PARAMETER_OWNERSHIP_COVERAGE: {coverage_rate:.2%} ({owned}/{required})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
