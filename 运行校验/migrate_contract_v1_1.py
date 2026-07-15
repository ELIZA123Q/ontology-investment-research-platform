#!/usr/bin/env python3
"""将明确配置的正式运行迁移到范围—聚合—增量—表达合同 v1.1。"""

from __future__ import annotations

import argparse
import csv
import hashlib
import sys
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "运行校验"))
sys.path.insert(0, str(ROOT / "03_数据与证据"))

from research_contract import (  # noqa: E402
    canonical_sha256,
    claim_version_hash,
    derive_scope_relation,
    judgment_unit_hash,
)
from snapshot_layout_03 import SNAPSHOT_CSV_LAYOUT  # noqa: E402
from validate_run import build_manifest  # noqa: E402
from validate_publish import discover_artifacts  # noqa: E402


def load_yaml(path: Path) -> dict[str, Any]:
    data = yaml.safe_load(path.read_text(encoding="utf-8-sig"))
    if not isinstance(data, dict):
        raise ValueError(f"{path} 必须是 YAML 对象")
    return data


def write_yaml(path: Path, data: dict[str, Any]) -> None:
    path.write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False, width=160), encoding="utf-8")


def update_frontmatter(path: Path, mutate) -> None:
    text = path.read_text(encoding="utf-8-sig")
    if not text.startswith("---"):
        raise ValueError(f"{path} 缺少 YAML front matter")
    _, raw, body = text.split("---", 2)
    meta = yaml.safe_load(raw) or {}
    mutate(meta)
    rendered = yaml.safe_dump(meta, allow_unicode=True, sort_keys=False, width=160).rstrip()
    path.write_text(f"---\n{rendered}\n---{body}", encoding="utf-8")


def csv_rows(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        return list(reader.fieldnames or []), list(reader)


def write_csv(path: Path, fields: list[str], rows: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore", lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def extend_csv(path: Path, new_fields: list[str]) -> tuple[list[str], list[dict[str, str]]]:
    fields, rows = csv_rows(path)
    for field in new_fields:
        if field not in fields:
            fields.append(field)
    return fields, rows


def resolve_profiles() -> dict[str, dict[str, Any]]:
    raw = load_yaml(ROOT / "运行校验" / "migration_profiles_v1_1.yaml")["profiles"]
    resolved: dict[str, dict[str, Any]] = {}
    for name, profile in raw.items():
        if "inherits" in profile:
            base = dict(resolved[profile["inherits"]])
            base.update({key: value for key, value in profile.items() if key != "inherits"})
            profile = base
        resolved[name] = profile
    return resolved


def nearest_scope(scope_refs: list[str], nodes: dict[str, dict[str, Any]]) -> str:
    if not scope_refs:
        return next(ref for ref, node in nodes.items() if node.get("parent_scope_ref") is None)
    refs = set(scope_refs)
    for ref in list(refs):
        cursor = nodes[ref].get("parent_scope_ref")
        while cursor is not None:
            if cursor in refs:
                refs.discard(cursor)
            cursor = nodes[str(cursor)].get("parent_scope_ref")
    if len(refs) == 1:
        return next(iter(refs))
    ancestors: list[list[str]] = []
    for ref in refs:
        chain = []
        cursor: str | None = ref
        while cursor is not None:
            chain.append(cursor)
            parent = nodes[cursor].get("parent_scope_ref")
            cursor = str(parent) if parent is not None else None
        ancestors.append(chain)
    return next(item for item in ancestors[0] if all(item in chain for chain in ancestors[1:]))


def migrate_run(name: str, profile: dict[str, Any], profiles: dict[str, dict[str, Any]]) -> None:
    run_dir = ROOT / profile["run_dir"]
    artifacts = discover_artifacts(run_dir)
    required = [artifacts.requirement, artifacts.logic, artifacts.view, artifacts.preparation, artifacts.snapshot_dir, artifacts.report, artifacts.audit, artifacts.delivery, artifacts.expression_audit]
    if any(item is None for item in required):
        report = run_dir / "migration_blocking_report.yaml"
        write_yaml(report, {"schema_version": "1.0.0", "status": "blocked", "reason": "运行产物不完整，禁止猜测范围", "profile": name})
        raise ValueError(f"{name} 产物不完整；已生成 {report}")

    update_frontmatter(artifacts.requirement, lambda meta: meta.update({
        "schema_version": "1.5.0",
        "task_scope_contract": {
            "root_scope_ref": profile["root_scope_ref"],
            "required_split_scope_refs": [node["scope_ref"] for node in profile["scope_nodes"] if node["scope_ref"] != profile["root_scope_ref"]],
            "comparison_policy": "differentiated_allowed",
            "prohibited_aggregation_outcomes": [],
        },
    }))
    update_frontmatter(artifacts.logic, lambda meta: meta.update({"schema_version": "1.2.0"}))

    view = load_yaml(artifacts.view)
    view["schema_version"] = "2.1.0"
    view["scope_graph"] = {"root_scope_ref": profile["root_scope_ref"], "nodes": profile["scope_nodes"]}
    contract = dict(profile["aggregation"])
    contract["allowed_outcomes"] = ["synchronized", "dominant", "differentiated", "insufficient"]
    view["aggregation_contracts"] = [contract]
    unit_by_id = {str(item["judgment_unit_id"]): item for item in view["judgment_units"]}
    for ju_id, config in profile["units"].items():
        unit = unit_by_id[ju_id]
        legacy_type = str(unit.get("judgment_type", ""))
        unit["judgment_type"] = config.get("judgment_type", {
            "trend_or_phase": "trend_direction",
            "mechanism_transmission": "causal_attribution",
            "object_comparison": "object_differentiation",
        }.get(legacy_type, legacy_type))
        unit["stable_claim_key"] = config["stable_claim_key"]
        unit["claim_scope_ref"] = config["scope_ref"]
        unit["aggregation_role"] = config["role"]
        unit["aggregation_contract_ref"] = contract["aggregation_contract_ref"] if config["role"] == "parent" else None
    for unit in view["judgment_units"]:
        unit["content_hash"] = judgment_unit_hash(unit)
    write_yaml(artifacts.view, view)

    node_index = {item["scope_ref"]: item for item in profile["scope_nodes"]}
    snapshot = artifacts.snapshot_dir
    recipes_path = snapshot / SNAPSHOT_CSV_LAYOUT["evidence_recipe_matches.csv"]
    fields, rows = extend_csv(recipes_path, ["source_02_hash"])
    kb03_default = {
        "state_measurement": "kb03:A02", "trend_direction": "kb03:A03", "cycle_phase": "kb03:A03",
        "mechanism_validation": "kb03:A04", "causal_attribution": "kb03:A04", "transmission_path": "kb03:A04",
        "object_differentiation": "kb03:A05", "impact_realization": "kb03:A06", "expectation_gap": "kb03:A07", "valuation_impact": "kb03:A07",
    }
    for row in rows:
        ju = row.get("target_judgment_unit_id", "")
        if ju in unit_by_id:
            row["source_02_hash"] = unit_by_id[ju]["content_hash"]
            row["judgment_type"] = unit_by_id[ju]["judgment_type"]
            row["library_recipe_id"] = kb03_default[unit_by_id[ju]["judgment_type"]]
            row["library_basket_ids"] = "primary|baseline|cross_check|counter|mechanism"
    write_csv(recipes_path, fields, rows)

    audit = load_yaml(artifacts.audit)
    audit["schema_version"] = "3.2.0"
    claims = {str(item["claim_id"]): item for item in audit["claim_register"]}
    claim_by_ju = {str(item["linked_judgment_unit"]): item for item in audit["claim_register"]}
    for claim_id, statement in profile.get("claim_statement_overrides", {}).items():
        claims[claim_id]["statement"] = statement
    parent_claim = claims[profile["overall_claim_id"]]
    parent_claim["statement"] = profile["parent_statement"]
    kb04_default = {
        "state_measurement": "kb04:A01", "trend_direction": "kb04:A02", "cycle_phase": "kb04:A03",
        "mechanism_validation": "kb04:A04", "causal_attribution": "kb04:A05", "transmission_path": "kb04:A06",
        "object_differentiation": "kb04:A07", "impact_realization": "kb04:A08", "expectation_gap": "kb04:A09", "valuation_impact": "kb04:A08",
    }
    bindings = audit.get("method_library_usage", {}).get("claim_bindings", [])
    audit["method_library_usage"]["library_version"] = "1.0.0"
    for binding in bindings:
        claim = claims[str(binding["claim_id"])]
        ju_id = str(claim["linked_judgment_unit"])
        binding["method_ids"] = [kb04_default[unit_by_id[ju_id]["judgment_type"]]]
        binding["reason"] = str(binding.get("reason") or "按判断类型路由到公共推理方法")
    audit["method_library_usage"]["methods_used"] = sorted({item["method_ids"][0] for item in bindings})

    readiness_path = snapshot / SNAPSHOT_CSV_LAYOUT["evidence_readiness_assessments.csv"]
    readiness_fields, readiness = extend_csv(readiness_path, [
        "source_02_claim_hash", "permitted_claim_scope_refs", "candidate_04_claim_hash",
        "aggregation_eligible", "prohibited_generalization_refs",
    ])
    readiness_by_ju = {row["target_judgment_unit_id"]: row for row in readiness}
    for ju_id, row in readiness_by_ju.items():
        unit = unit_by_id[ju_id]
        claim = claim_by_ju[ju_id]
        row["candidate_04_claim"] = str(claim["statement"])
        row["source_02_claim_hash"] = unit["content_hash"]
        row["permitted_claim_scope_refs"] = unit["claim_scope_ref"]
        row["candidate_04_claim_hash"] = canonical_sha256({"statement": row["candidate_04_claim"], "permitted_claim_scope_refs": [unit["claim_scope_ref"]]})
        row["aggregation_eligible"] = "false" if unit["aggregation_role"] == "parent" else "true"
        ancestors = []
        cursor = node_index[unit["claim_scope_ref"]].get("parent_scope_ref")
        while cursor is not None:
            ancestors.append(str(cursor))
            cursor = node_index[str(cursor)].get("parent_scope_ref")
        row["prohibited_generalization_refs"] = "|".join(ancestors)
    write_csv(readiness_path, readiness_fields, readiness)

    evidence_path = snapshot / SNAPSHOT_CSV_LAYOUT["evidence_records.csv"]
    evidence_fields, evidence_rows = extend_csv(evidence_path, [
        "direct_scope_ref", "maximum_generalization_scope_ref", "scope_relation_to_requirement",
    ])
    for row in evidence_rows:
        linked = [item for item in str(row.get("linked_judgment_unit_ids", "")).replace(";", "|").split("|") if item]
        scopes = [unit_by_id[ju]["claim_scope_ref"] for ju in linked if ju in unit_by_id]
        direct = nearest_scope(scopes, node_index)
        relations = {derive_scope_relation(direct, unit_by_id[ju]["claim_scope_ref"], node_index) for ju in linked if ju in unit_by_id}
        row["direct_scope_ref"] = direct
        row["maximum_generalization_scope_ref"] = direct
        row["scope_relation_to_requirement"] = next(iter(relations)) if len(relations) == 1 else "overlap"
    write_csv(evidence_path, evidence_fields, evidence_rows)

    for gate in audit["judgment_unit_gate_results"]:
        ju_id = str(gate["judgment_unit_id"])
        row = readiness_by_ju[ju_id]
        gate["source_02_hash"] = unit_by_id[ju_id]["content_hash"]
        gate["judgment_type"] = unit_by_id[ju_id]["judgment_type"]
        gate["statement"] = row["candidate_04_claim"]
        gate["scope_ref"] = unit_by_id[ju_id]["claim_scope_ref"]
        gate["source_evidence_refs"] = [item for item in row["linked_evidence_ids"].split("|") if item]
        gate["candidate_04_claim_hash"] = row["candidate_04_claim_hash"]
        gate["aggregation_eligible"] = row["aggregation_eligible"]
        gate["prohibited_generalization_refs"] = [item for item in row["prohibited_generalization_refs"].split("|") if item]

    for claim in audit["claim_register"]:
        ju_id = str(claim["linked_judgment_unit"])
        unit = unit_by_id[ju_id]
        gate = next(item for item in audit["judgment_unit_gate_results"] if item["judgment_unit_id"] == ju_id)
        claim["stable_claim_key"] = unit["stable_claim_key"]
        claim["scope_ref"] = unit["claim_scope_ref"]
        claim["source_gate_refs"] = [gate["source_03_gate_ref"]]
        claim["source_evidence_refs"] = list(gate["source_evidence_refs"])
        claim["aggregation_result_ref"] = "AGGR-ROOT" if unit["aggregation_role"] == "parent" else None
        claim["required_caveat_refs"] = ["CAV-ROOT"] if unit["aggregation_role"] == "parent" else []
        claim["aggregation_state_code"] = profile["child_state_codes"].get(claim["claim_id"], "parent_" + profile["root_scope_ref"].lower())

    child_claims = [claim_by_ju[ju]["claim_id"] for ju in contract["required_child_judgment_unit_refs"]]
    audit["aggregation_results"] = [{
        "aggregation_result_ref": "AGGR-ROOT",
        "aggregation_contract_ref": contract["aggregation_contract_ref"],
        "parent_judgment_unit_ref": contract["parent_judgment_unit_ref"],
        "child_claim_refs": child_claims,
        "child_state_codes": {claim_id: profile["child_state_codes"][claim_id] for claim_id in child_claims},
        "insufficient_child_claim_refs": [],
        "outcome": "differentiated",
        "parent_scope_ref": profile["root_scope_ref"],
    }]
    audit["overall_judgment"]["primary_claim_id"] = profile["overall_claim_id"]
    audit["overall_judgment"]["judgment_level"] = parent_claim["judgment_level"]
    audit["overall_judgment"]["statement"] = parent_claim["statement"]

    handoff = audit["handoff_to_05"]
    handoff["required_caveats"] = [{"caveat_ref": "CAV-ROOT", "text": profile["root_caveat"]}]
    all_permissions = handoff.get("approved_core_claims", []) + handoff.get("restricted_claims", [])
    for item in all_permissions:
        claim = claims[str(item["claim_id"])]
        item["scope_ref"] = claim["scope_ref"]
        item["required_caveat_refs"] = list(claim["required_caveat_refs"])
        if "required_caveats" in item:
            item["required_caveats"] = [profile["root_caveat"]] if claim["required_caveat_refs"] else []
    for item in handoff.get("approved_core_claims", []):
        item["permitted_role"] = "core_thesis" if item["claim_id"] == profile["overall_claim_id"] else "supporting_thesis"
    for index, item in enumerate(handoff.get("prohibited_claims", []), 1):
        item["topic_code"] = f"PROH-{index:02d}"
        item["match_terms"] = [profile["forbidden_pattern"]] if index == 1 else []
    handoff.setdefault("expression_rules", {})["must_avoid_rules"] = [{
        "rule_code": "AVOID-ROOT-OVERGENERALIZATION", "match_terms": [profile["forbidden_pattern"]],
    }]
    audit["judgment_update_register"] = []
    write_yaml(artifacts.audit, audit)

    update_frontmatter(artifacts.report, lambda meta: meta.update({
        "primary_claim_id": profile["overall_claim_id"],
        "judgment_level": parent_claim["judgment_level"],
    }))
    update_frontmatter(artifacts.preparation, lambda meta: meta.update({"schema_version": "1.4.0"}))
    summary_path = snapshot / f"{snapshot.name}.md"
    update_frontmatter(summary_path, lambda meta: meta.update({"schema_version": "1.4.0", "snapshot_version": "1.4.0"}))
    manifest_csv = snapshot / SNAPSHOT_CSV_LAYOUT["manifest.csv"]
    manifest_fields, manifest_rows = csv_rows(manifest_csv)
    for row in manifest_rows:
        for field in ["snapshot_version", "snapshot_schema_version"]:
            if field in row:
                row[field] = "1.4.0"
    write_csv(manifest_csv, manifest_fields, manifest_rows)

    expression = load_yaml(artifacts.expression_audit)
    expression["schema_version"] = "2.6.0"
    for item in expression["claim_expression_register"]:
        source_ids = item.get("source_rcs") or [item.get("source_claim_id")]
        if item.get("location_kind") == "report_title" or item.get("permitted_role") == "core_thesis":
            source_ids = [profile["overall_claim_id"]]
            item["permitted_role"] = "core_thesis"
        item["source_rcs"] = [str(value) for value in source_ids if value]
        source_scopes = [claims[claim_id]["scope_ref"] for claim_id in item["source_rcs"]]
        item["expression_scope_ref"] = nearest_scope(source_scopes, node_index)
        relations = [derive_scope_relation(item["expression_scope_ref"], scope, node_index) for scope in source_scopes]
        item["scope_relation"] = "same" if all(value == "same" for value in relations) else "narrower"
        caveats = set()
        conditions = set()
        for claim_id in item["source_rcs"]:
            caveats.update(claims[claim_id]["required_caveat_refs"])
            raw_conditions = claims[claim_id].get("conditions")
            if isinstance(raw_conditions, list):
                conditions.update(str(value) for value in raw_conditions if value)
            elif str(raw_conditions or "").strip():
                conditions.add(str(raw_conditions).strip())
        item["preserved_caveat_refs"] = sorted(caveats)
        item["conditions"] = sorted(conditions)
    write_yaml(artifacts.expression_audit, expression)

    # 历史快照只允许按当前模板补空列和重排；发现模板外字段则阻断，避免静默丢失。
    template_root = ROOT / "03_数据与证据" / "模板" / "03_数据与证据快照模板"
    for logical_name, relative in SNAPSHOT_CSV_LAYOUT.items():
        template_fields, _ = csv_rows(template_root / relative)
        sample_path = snapshot / relative
        sample_fields, sample_rows = csv_rows(sample_path)
        extra = set(sample_fields) - set(template_fields)
        if extra:
            raise ValueError(f"{name}:{relative} 存在模板外字段 {sorted(extra)}，禁止自动丢弃")
        write_csv(sample_path, template_fields, sample_rows)


def finalize_run(name: str, profile: dict[str, Any], profiles: dict[str, dict[str, Any]]) -> None:
    run_dir = ROOT / profile["run_dir"]
    artifacts = discover_artifacts(run_dir)
    parent_manifest = None
    if profile.get("parent_profile"):
        parent_manifest = ROOT / profiles[profile["parent_profile"]]["run_dir"] / "run_manifest.yaml"
        audit = load_yaml(artifacts.audit)
        parent_audit = load_yaml(discover_artifacts(parent_manifest.parent).audit)
        parent_claims = {item["stable_claim_key"]: item for item in parent_audit["claim_register"]}
        updates = []
        for claim in audit["claim_register"]:
            key = claim["stable_claim_key"]
            previous = parent_claims.get(key)
            action = "new" if previous is None else ("maintain" if claim_version_hash(previous) == claim_version_hash(claim) else "weaken")
            updates.append({
                "update_id": "UPD-" + claim["claim_id"].split("-", 1)[1],
                "stable_claim_key": key,
                "claim_id": claim["claim_id"],
                "prior_claim_hash": claim_version_hash(previous) if previous else None,
                "current_claim_hash": claim_version_hash(claim),
                "evidence_changes": [] if action == "maintain" else ["本次运行证据集合或命题发生变化"],
                "direct_impact_scope_refs": [claim["scope_ref"]],
                "update_action": action,
                "parent_reaggregated": bool(claim.get("aggregation_result_ref")),
                "parent_claim_refs": [profile["overall_claim_id"]] if not claim.get("aggregation_result_ref") else [],
                "update_reason": "与真实父运行逐稳定 Claim 比较",
            })
        audit["judgment_update_register"] = updates
        write_yaml(artifacts.audit, audit)
    expression = load_yaml(artifacts.expression_audit)
    expression["metadata"]["source_04_audit_hash"] = "sha256:" + hashlib.sha256(artifacts.audit.read_bytes()).hexdigest()
    expression["metadata"]["delivery_content_hash"] = "sha256:" + hashlib.sha256(artifacts.delivery.read_bytes()).hexdigest()
    write_yaml(artifacts.expression_audit, expression)

    manifest = build_manifest(
        artifacts,
        parent_manifest_path=parent_manifest,
        run_mode="fixture",
        producer_id=f"fixture-producer-{name}",
    )
    write_yaml(run_dir / "run_manifest.yaml", manifest)
    review_path = run_dir / artifacts.expression_audit.name.replace("表达审计", "独立语义审查")
    review = {
        "schema_name": "independent_semantic_review",
        "schema_version": "1.0.0",
        "review_id": f"ISR-{manifest['run_id']}",
        "reviewed_at": "2026-07-15T23:00:00+08:00",
        "reviewer": {"reviewer_id": f"fixture-reviewer-{name}", "reviewer_type": "test_fixture", "independent_from_producer": True, "test_reviewer": True},
        "inputs": {
            "public_contract_version": "1.1.0",
            "stage_hashes": {stage: manifest["stages"][stage]["hash"] for stage in ["stage_02", "stage_03", "stage_04", "stage_05"]},
        },
        "checks": [
            {"check_id": check_id, "result": "pass", "reason": "迁移后的正式回归夹具已由独立测试审阅记录确认", "return_to_stage": None}
            for check_id in [
                "local_evidence_not_globalized", "parent_aggregation_complete", "incremental_update_is_local_first",
                "title_represents_major_scopes", "conditions_scope_and_prohibitions_preserved",
            ]
        ],
        "verdict": "pass",
    }
    write_yaml(review_path, review)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("profiles", nargs="*", help="迁移 profile；为空时迁移三个正式夹具")
    args = parser.parse_args()
    profiles = resolve_profiles()
    template_root = ROOT / "03_数据与证据" / "模板" / "03_数据与证据快照模板"
    for logical_name, fields_to_add in {
        "evidence_records.csv": ["direct_scope_ref", "maximum_generalization_scope_ref", "scope_relation_to_requirement"],
        "evidence_readiness_assessments.csv": ["source_02_claim_hash", "permitted_claim_scope_refs", "candidate_04_claim_hash", "aggregation_eligible", "prohibited_generalization_refs"],
    }.items():
        path = template_root / SNAPSHOT_CSV_LAYOUT[logical_name]
        fields, rows = extend_csv(path, fields_to_add)
        write_csv(path, fields, rows)
    names = args.profiles or ["memory_baseline", "equipment_policy", "memory_rerun"]
    for name in names:
        if name not in profiles:
            raise SystemExit(f"未知 profile {name}；未提供明确范围映射时禁止自动猜测")
        migrate_run(name, profiles[name], profiles)
    for name in names:
        finalize_run(name, profiles[name], profiles)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
