#!/usr/bin/env python3
"""Validate 03 data/evidence preparation and frozen snapshot outputs."""

from __future__ import annotations

import sys
from pathlib import Path

from quality_gate_utils import (
    CLAIM_MODES,
    JUDGMENT_LABELS,
    JUDGMENT_LEVELS,
    JUDGMENT_STATUSES,
    PATH_STATUSES,
    REASONING_READINESS,
    TARGET_CLAIM_TYPES,
    judgment_level_rank,
    validate_admission,
    validate_admission_search_consistency,
    validate_core_ju_publish_baseline,
    validate_gate_review_fields,
    validate_quality_status,
    validate_researcher_body,
    validate_return_action,
    validate_return_routing_fields,
    validate_search_status,
    validate_target_claim_level,
    validate_upstream_quality_gate,
)
from validate_05_materials import validate_05_materials
from validator_utils import (
    assert_subset,
    assert_values,
    error_payload,
    fail,
    file_name,
    load_yaml_file,
    ok_payload,
    parse_markdown,
    parse_triplet,
    read_csv,
    read_csv_header,
    ref_set,
    require_body_sections,
    require_keys,
    require_schema_version,
    same_ref,
    split_refs,
)


TEMPLATE_DIR = Path(__file__).resolve().parent / "03_数据与证据快照模板"

REQUIRED_PREP_META = [
    "document_type",
    "schema_version",
    "task_id",
    "execution_id",
    "plan_id",
    "source_02_view_id",
    "source_02_logic_id",
    "source_02_view_ref",
    "source_02_logic_ref",
    "execution_date",
    "timezone",
    "data_cutoff",
    "resolved_anchor_date",
    "resolved_start",
    "resolved_end",
    "resolved_at",
    "resolved_objects",
    "source_registry_version",
    "recipe_library_version",
    "snapshot_ref",
    "snapshot_summary_ref",
    "preparation_status",
    "quality_status",
    "quality_gate_ref",
    "deterministic_check_status",
    "semantic_review_status",
    "admission",
    "evidence_quality_level",
    "confidence_ceiling",
    "coverage_unit_total",
    "evidence_backed_unit_count",
    "evidence_coverage_rate",
    "required_coverage_rate",
    "critical_node_gate_status",
    "judgment_unit_gate_status",
    "search_status",
    "highest_supported_judgment_level",
    "return_required",
    "return_stage",
]

REQUIRED_PREP_SECTIONS = [
    "本次范围",
    "研究基线",
    "需要哪些证据",
    "来源与取数方式",
    "数据如何处理与归类",
    "各结论的证据把握",
    "证据覆盖情况",
    "证据评估结论",
    "快照文件索引",
    "03 质量门槛检查",
]

REQUIRED_SUMMARY_META = [
    "document_type",
    "schema_version",
    "task_id",
    "execution_id",
    "snapshot_version",
    "preparation_ref",
    "snapshot_directory",
    "admission",
    "evidence_quality_level",
    "confidence_ceiling",
    "coverage_unit_total",
    "evidence_backed_unit_count",
    "evidence_coverage_rate",
    "required_coverage_rate",
    "critical_node_gate_status",
    "judgment_unit_total",
    "highest_supported_judgment_level",
    "core_judgment_publish_floor_met",
    "search_status",
    "quality_status",
    "deterministic_check_status",
    "semantic_review_status",
]

REQUIRED_CSV_FILES = [
    path.name
    for path in sorted(TEMPLATE_DIR.glob("*.csv"))
    if path.name != "字段清单.csv"
]


def _expected_header(file_name_: str) -> list[str]:
    return read_csv_header(TEMPLATE_DIR / file_name_)


def _validate_upstream_02(prep_meta: dict[str, object], prep_path: Path) -> dict[str, object]:
    view_ref = str(prep_meta.get("source_02_view_ref", "")).strip()
    if not view_ref:
        fail("03 preparation 必须记录 source_02_view_ref")
    view_path = prep_path.parent / view_ref
    if not view_path.is_file():
        fail(f"03 preparation.source_02_view_ref 无法解析: {view_ref}")
    view = load_yaml_file(view_path)
    quality_control = view.get("quality_control")
    if not isinstance(quality_control, dict):
        fail(f"{view_path} 缺少 quality_control")
    validate_upstream_quality_gate(
        quality_control,
        upstream_label=str(view_path),
        downstream_label=str(prep_path),
        default_return_stage="02",
    )
    if str(view.get("schema_version")) != "2.0.0":
        fail(f"{view_path} schema_version 必须为 2.0.0")
    return view


def _validate_return_actions(rows: dict[str, list[dict[str, str]]]) -> None:
    for row in rows["judgment_unit_readiness.csv"]:
        action = row.get("return_action", "none")
        validate_return_action(action, f"judgment_unit_readiness#{row.get('judgment_unit_id')}")
    for row in rows["gaps_and_risks.csv"]:
        action = row.get("return_action", "none")
        validate_return_action(action, f"gaps_and_risks#{row.get('gap_id')}")


def _validate_headers(snapshot_dir: Path) -> None:
    missing = [name for name in REQUIRED_CSV_FILES if not (snapshot_dir / name).exists()]
    if missing:
        fail("快照目录缺少 CSV: " + ", ".join(missing))
    for name in REQUIRED_CSV_FILES:
        actual = read_csv_header(snapshot_dir / name)
        expected = _expected_header(name)
        if actual != expected:
            fail(f"{name} 表头必须与模板一致")


def _rows(snapshot_dir: Path) -> dict[str, list[dict[str, str]]]:
    return {name: read_csv(snapshot_dir / name) for name in REQUIRED_CSV_FILES}


def _validate_cross_domain_instance_manifest(
    *,
    prep_path: Path,
    snapshot_dir: Path,
    prep_triplet: tuple[str, str, str],
    prep_meta: dict[str, object],
    rows: dict[str, list[dict[str, str]]],
) -> dict[str, object]:
    topic, date, seq = prep_triplet
    manifest_path = prep_path.parent / f"03-{topic}跨域运行实例清单-{date}-{seq}.yaml"
    manifest_kind = "跨域运行实例清单"
    if not manifest_path.is_file():
        legacy_path = prep_path.parent / f"03-{topic}证据实例清单-{date}-{seq}.yaml"
        if not legacy_path.is_file():
            fail(f"03 缺少配对跨域运行实例清单: {manifest_path.name}")
        manifest_path = legacy_path
        manifest_kind = "证据实例清单"
    if parse_triplet(manifest_path, manifest_kind, stage="03") != prep_triplet:
        fail("03 跨域运行实例清单与准备文档三元组不一致")
    manifest = load_yaml_file(manifest_path)
    if not isinstance(manifest, dict):
        fail("03 跨域运行实例清单必须是 YAML 对象")
    require_keys(manifest, ["document_type", "schema_version", "metadata", "ontology_versions", "cross_domain_constraints", "validation"], str(manifest_path))
    require_schema_version(manifest["schema_version"], str(manifest_path), expected="2.0.0")
    if manifest["document_type"] not in {"cross_domain_runtime_instance_manifest", "evidence_instance_manifest"}:
        fail("03 跨域运行实例清单 document_type 非法")
    metadata = manifest["metadata"]
    require_keys(metadata, ["task_id", "execution_id", "source_02_view_ref", "source_02_view_version", "source_02_view_hash", "snapshot_ref", "frozen_at"], "evidence_instance_manifest.metadata")
    for field in ["task_id", "execution_id"]:
        if not same_ref(metadata[field], prep_meta[field]):
            fail(f"跨域运行实例清单 metadata.{field} 与准备文档不一致")
    if not same_ref(metadata["source_02_view_ref"], prep_meta["source_02_view_ref"]):
        fail("跨域运行实例清单 source_02_view_ref 与准备文档不一致")
    snapshot_manifest = rows["manifest.csv"][0]
    if not same_ref(metadata["source_02_view_hash"], snapshot_manifest["source_02_view_hash"]):
        fail("跨域运行实例清单 source_02_view_hash 与快照 manifest 不一致")
    if not same_ref(metadata["snapshot_ref"], f"{snapshot_dir.name}/manifest.csv"):
        fail("跨域运行实例清单 snapshot_ref 必须指向配对快照")
    if manifest["document_type"] == "cross_domain_runtime_instance_manifest":
        require_keys(manifest, ["manifest_role", "domain_instances", "operational_files"], str(manifest_path))
        role = manifest["manifest_role"]
        if role != {"stage": "03", "included_domains": ["semantic", "evidence", "reasoning_input"], "instance_only": True, "formal_ontology_mutated": False}:
            fail("跨域运行实例清单 manifest_role 必须明确语义域、证据域和冻结推理输入")
        domains = manifest["domain_instances"]
        require_keys(domains, ["semantic_domain", "evidence_domain", "reasoning_domain"], "domain_instances")
        expected_domain_files = {
            "semantic_domain": {"objects": "semantic_instances.csv", "relations": "semantic_relations.csv"},
            "evidence_domain": {"source_documents": "source_documents.csv", "claims": "evidence_claims.csv", "facts": "evidence_facts.csv", "relations": "evidence_relations.csv", "assessments": "evidence_assessments.csv"},
            "reasoning_domain": {"inputs": "reasoning_inputs.csv"},
        }
        for domain_name, expected in expected_domain_files.items():
            section = domains[domain_name]
            if not isinstance(section, dict) or not isinstance(section.get("files"), dict):
                fail(f"domain_instances.{domain_name}.files 必须是对象")
            require_keys(section["files"], expected, f"domain_instances.{domain_name}.files")
            for key, filename in expected.items():
                if not same_ref(section["files"][key], f"{snapshot_dir.name}/{filename}"):
                    fail(f"domain_instances.{domain_name}.files.{key} 必须指向 {filename}")
        operational = manifest["operational_files"]
        for key, filename in {"source_retrievals": "source_snapshot.csv", "compatibility_projection": "evidence_records.csv"}.items():
            if not same_ref(operational.get(key), f"{snapshot_dir.name}/{filename}"):
                fail(f"operational_files.{key} 必须指向 {filename}")
    else:
        require_keys(manifest, ["domain_role", "instance_files"], str(manifest_path))
        if manifest["domain_role"] != {"primary_domain": "evidence", "instance_only": True, "formal_ontology_mutated": False}:
            fail("旧版证据实例清单 domain_role 非法")
    constraints = manifest["cross_domain_constraints"]
    required_true = ["source_claim_fact_chain_complete", "assessment_targets_resolvable", "semantic_instances_runtime_only", "reasoning_inputs_frozen", "no_rule_evaluation_instances", "no_judgment_instances"]
    for key in required_true:
        if constraints.get(key) is not True:
            fail(f"跨域运行实例清单 cross_domain_constraints.{key} 必须为 true")
    validation = manifest["validation"]
    if not isinstance(validation, dict) or validation.get("result") != "pass":
        fail("跨域运行实例清单 validation.result 必须为 pass")
    return manifest


def _validate_normalized_evidence_graph(rows: dict[str, list[dict[str, str]]]) -> None:
    source_documents = ref_set(rows["source_documents.csv"], "source_document_id", "source_documents.csv")
    source_runs = ref_set(rows["source_snapshot.csv"], "source_run_id", "source_snapshot.csv")
    claims = ref_set(rows["evidence_claims.csv"], "claim_id", "evidence_claims.csv")
    facts = ref_set(rows["evidence_facts.csv"], "fact_id", "evidence_facts.csv")
    assessments = ref_set(rows["evidence_assessments.csv"], "assessment_id", "evidence_assessments.csv")
    judgment_units = ref_set(rows["judgment_unit_readiness.csv"], "judgment_unit_id", "judgment_unit_readiness.csv")
    for claim in rows["evidence_claims.csv"]:
        assert_subset(split_refs(claim.get("source_document_id")), source_documents, f"{claim.get('claim_id')}.source_document_id")
        assert_subset(split_refs(claim.get("source_run_refs")), source_runs, f"{claim.get('claim_id')}.source_run_refs")
    relation_rows = rows["evidence_relations.csv"]
    allowed_relations = {"claimCitesSource", "factSupportedByClaim", "assessmentEvaluatesEvidence", "conflictsWith", "supersedes", "invalidates"}
    assert_values([row.get("relation_type", "") for row in relation_rows], allowed_relations, "evidence_relations.relation_type")
    claim_source_links: set[str] = set()
    fact_claim_links: set[str] = set()
    assessment_links: dict[str, set[str]] = {item: set() for item in assessments}
    evidence_universe = claims | facts
    for relation in relation_rows:
        relation_type = relation.get("relation_type")
        source = str(relation.get("source_evidence_id", ""))
        target = str(relation.get("target_evidence_id", ""))
        if relation_type == "claimCitesSource":
            assert_subset([source], claims, f"{relation.get('relation_id')}.source")
            assert_subset([target], source_documents, f"{relation.get('relation_id')}.target")
            claim_source_links.add(source)
        elif relation_type == "factSupportedByClaim":
            assert_subset([source], facts, f"{relation.get('relation_id')}.source")
            assert_subset([target], claims, f"{relation.get('relation_id')}.target")
            fact_claim_links.add(source)
        elif relation_type == "assessmentEvaluatesEvidence":
            assert_subset([source], assessments, f"{relation.get('relation_id')}.source")
            assert_subset([target], evidence_universe | source_documents, f"{relation.get('relation_id')}.target")
            assessment_links[source].add(target)
        else:
            assert_subset([source, target], evidence_universe, f"{relation.get('relation_id')}.evidence_endpoints")
    if claims - claim_source_links:
        fail("所有 EvidenceClaim 都必须存在 claimCitesSource: " + ", ".join(sorted(claims - claim_source_links)))
    if facts - fact_claim_links:
        fail("所有 EvidenceFact 都必须存在 factSupportedByClaim: " + ", ".join(sorted(facts - fact_claim_links)))
    for assessment in rows["evidence_assessments.csv"]:
        aid = str(assessment.get("assessment_id", ""))
        targets = set(split_refs(assessment.get("evidence_refs")))
        assert_subset(targets, evidence_universe | source_documents, f"{aid}.evidence_refs")
        assert_subset(split_refs(assessment.get("linked_judgment_unit_ids")), judgment_units, f"{aid}.linked_judgment_unit_ids")
        if not targets or not targets.issubset(assessment_links.get(aid, set())):
            fail(f"{aid} 的 evidence_refs 必须逐项存在 assessmentEvaluatesEvidence")


def _validate_instance_manifest(
    prep_path: Path,
    snapshot_dir: Path,
    prep_triplet: tuple[str, str, str],
    prep_meta: dict[str, object],
    rows: dict[str, list[dict[str, str]]],
) -> None:
    topic, date, seq = prep_triplet
    candidates = [
        prep_path.parent / f"03-{topic}证据实例清单-{date}-{seq}.yaml",
        prep_path.parent / f"03-{topic}跨域运行实例清单-{date}-{seq}.yaml",
    ]
    path = next((item for item in candidates if item.is_file()), candidates[0])
    if not path.is_file():
        fail("03 缺少配对证据/跨域运行实例清单")
    manifest = load_yaml_file(path)
    if manifest.get("document_type") == "cross_domain_runtime_instance_manifest":
        require_keys(
            manifest,
            [
                "document_type",
                "schema_version",
                "metadata",
                "ontology_versions",
                "manifest_role",
                "domain_instances",
                "operational_files",
                "cross_domain_constraints",
                "validation",
            ],
            str(path),
        )
        require_schema_version(manifest["schema_version"], str(path), expected="2.0.0")
        metadata = manifest["metadata"]
        require_keys(
            metadata,
            [
                "task_id",
                "execution_id",
                "source_02_view_ref",
                "source_02_view_version",
                "source_02_view_hash",
                "snapshot_ref",
                "frozen_at",
            ],
            "跨域运行实例清单.metadata",
        )
        for field in ["task_id", "execution_id"]:
            if not same_ref(metadata[field], prep_meta[field]):
                fail(f"跨域运行实例清单 metadata.{field} 与准备文档不一致")
        if not same_ref(metadata["source_02_view_ref"], prep_meta["source_02_view_ref"]):
            fail("跨域运行实例清单 source_02_view_ref 与准备文档不一致")
        snapshot_manifest = rows["manifest.csv"][0]
        if not same_ref(metadata["source_02_view_hash"], snapshot_manifest["source_02_view_hash"]):
            fail("跨域运行实例清单 source_02_view_hash 与快照 manifest 不一致")
        if not same_ref(metadata["snapshot_ref"], f"{snapshot_dir.name}/manifest.csv"):
            fail("跨域运行实例清单 snapshot_ref 必须指向配对快照")
        role = manifest["manifest_role"]
        if role.get("stage") != "03" or role.get("instance_only") is not True or role.get("formal_ontology_mutated") is not False:
            fail("跨域运行实例清单必须声明 stage=03、instance_only=true、formal_ontology_mutated=false")
        domains = manifest["domain_instances"]
        expected = {
            "semantic_domain": {
                "objects": "semantic_instances.csv",
                "relations": "semantic_relations.csv",
            },
            "evidence_domain": {
                "source_documents": "source_documents.csv",
                "claims": "evidence_claims.csv",
                "facts": "evidence_facts.csv",
                "relations": "evidence_relations.csv",
                "assessments": "evidence_assessments.csv",
            },
            "reasoning_domain": {"inputs": "reasoning_inputs.csv"},
        }
        for domain_name, file_map in expected.items():
            domain = domains.get(domain_name)
            if not isinstance(domain, dict) or not isinstance(domain.get("files"), dict):
                fail(f"跨域运行实例清单缺少 {domain_name}.files")
            for key, filename in file_map.items():
                if not same_ref(domain["files"].get(key), f"{snapshot_dir.name}/{filename}"):
                    fail(f"跨域运行实例清单 {domain_name}.{key} 必须指向 {filename}")
        operations = manifest["operational_files"]
        if not same_ref(operations.get("source_retrievals"), f"{snapshot_dir.name}/source_snapshot.csv"):
            fail("跨域运行实例清单 source_retrievals 必须指向 source_snapshot.csv")
        if not same_ref(operations.get("compatibility_projection"), f"{snapshot_dir.name}/evidence_records.csv"):
            fail("跨域运行实例清单 compatibility_projection 必须指向 evidence_records.csv")
        for key in [
            "source_claim_fact_chain_complete",
            "assessment_targets_resolvable",
            "semantic_instances_runtime_only",
            "reasoning_inputs_frozen",
            "no_rule_evaluation_instances",
            "no_judgment_instances",
        ]:
            if manifest["cross_domain_constraints"].get(key) is not True:
                fail(f"跨域运行实例清单.cross_domain_constraints.{key} 必须为 true")
        if manifest["validation"].get("result") != "pass":
            fail("跨域运行实例清单.validation.result 必须为 pass")
        return
    require_keys(manifest, ["document_type", "schema_version", "metadata", "ontology_versions", "domain_role", "instance_files", "cross_domain_constraints", "validation"], str(path))
    require_schema_version(manifest["schema_version"], str(path), expected="2.0.0")
    if manifest["document_type"] != "evidence_instance_manifest":
        fail("03 证据实例清单 document_type 必须为 evidence_instance_manifest")
    metadata = manifest["metadata"]
    require_keys(metadata, ["task_id", "execution_id", "source_02_view_ref", "source_02_view_version", "source_02_view_hash", "snapshot_ref", "frozen_at"], "证据实例清单.metadata")
    for field in ["task_id", "execution_id"]:
        if not same_ref(metadata[field], prep_meta[field]):
            fail(f"证据实例清单 metadata.{field} 与准备文档不一致")
    if not same_ref(metadata["source_02_view_ref"], prep_meta["source_02_view_ref"]):
        fail("证据实例清单 source_02_view_ref 与准备文档不一致")
    snapshot_manifest = rows["manifest.csv"][0]
    if not same_ref(metadata["source_02_view_hash"], snapshot_manifest["source_02_view_hash"]):
        fail("证据实例清单 source_02_view_hash 与快照 manifest 不一致")
    if not same_ref(metadata["snapshot_ref"], f"{snapshot_dir.name}/manifest.csv"):
        fail("证据实例清单 snapshot_ref 必须指向配对快照")
    if manifest["domain_role"] != {"primary_domain": "evidence", "instance_only": True, "formal_ontology_mutated": False}:
        fail("证据实例清单必须声明：证据域为主、只生成实例、不修改正式本体")
    expected_files = {
        "source_documents": "source_documents.csv",
        "source_retrievals": "source_snapshot.csv",
        "evidence_claims": "evidence_claims.csv",
        "evidence_facts": "evidence_facts.csv",
        "evidence_relations": "evidence_relations.csv",
        "evidence_assessments": "evidence_assessments.csv",
        "semantic_instances": "semantic_instances.csv",
        "semantic_relations": "semantic_relations.csv",
        "reasoning_inputs": "reasoning_inputs.csv",
        "compatibility_projection": "evidence_records.csv",
    }
    require_keys(manifest["instance_files"], expected_files, "证据实例清单.instance_files")
    for key, filename in expected_files.items():
        if not same_ref(manifest["instance_files"][key], f"{snapshot_dir.name}/{filename}"):
            fail(f"证据实例清单.instance_files.{key} 必须指向 {filename}")
    for key in ["source_claim_fact_chain_complete", "assessment_targets_resolvable", "semantic_instances_runtime_only", "reasoning_inputs_frozen", "no_rule_evaluation_instances", "no_judgment_instances"]:
        if manifest["cross_domain_constraints"].get(key) is not True:
            fail(f"证据实例清单.cross_domain_constraints.{key} 必须为 true")
    if manifest["validation"].get("result") != "pass":
        fail("证据实例清单.validation.result 必须为 pass")


def _validate_ontology_instances(view: dict[str, object], rows: dict[str, list[dict[str, str]]]) -> None:
    semantic_scope = view["semantic_scope"]
    evidence_contract = view["evidence_contract"]
    allowed_object_types = set(split_refs(semantic_scope.get("object_type_refs")))
    allowed_relation_types = set(split_refs(semantic_scope.get("relation_type_refs")))
    allowed_profiles = set(split_refs(evidence_contract.get("evidence_profile_refs")))
    formal_evidence = load_yaml_file(Path(__file__).resolve().parent.parent / "一级通用本体规范" / "evidence.yaml")

    def enum_values(object_type: str, property_name: str) -> set[str]:
        values = formal_evidence["object_types"][object_type]["properties"][property_name].get("allowed_values", [])
        return {str(item) for item in values}

    assert_values([row.get("source_type", "") for row in rows["source_documents.csv"]], enum_values("SourceDocument", "sourceType"), "source_documents.source_type")
    assert_values([row.get("access_scope", "") for row in rows["source_documents.csv"]], enum_values("SourceDocument", "accessScope"), "source_documents.access_scope")
    assert_values([row.get("source_reliability", "") for row in rows["source_documents.csv"]], enum_values("SourceDocument", "sourceReliability"), "source_documents.source_reliability")
    assert_values([row.get("status", "") for row in rows["source_documents.csv"]], enum_values("SourceDocument", "status"), "source_documents.status")
    assert_values([row.get("claim_type", "") for row in rows["evidence_claims.csv"]], enum_values("EvidenceClaim", "claimType"), "evidence_claims.claim_type")
    assert_values([row.get("claim_confidence", "") for row in rows["evidence_claims.csv"]], enum_values("EvidenceClaim", "claimConfidence"), "evidence_claims.claim_confidence")
    assert_values([row.get("status", "") for row in rows["evidence_claims.csv"]], enum_values("EvidenceClaim", "status"), "evidence_claims.status")
    assert_values([row.get("fact_type", "") for row in rows["evidence_facts.csv"]], enum_values("EvidenceFact", "factType"), "evidence_facts.fact_type")
    assert_values([row.get("fact_confidence", "") for row in rows["evidence_facts.csv"]], enum_values("EvidenceFact", "factConfidence"), "evidence_facts.fact_confidence")
    assert_values([row.get("status", "") for row in rows["evidence_facts.csv"]], enum_values("EvidenceFact", "status"), "evidence_facts.status")
    assert_values([row.get("usability", "") for row in rows["evidence_assessments.csv"]], enum_values("EvidenceAssessment", "usability"), "evidence_assessments.usability")
    assert_values([row.get("quality_level", "") for row in rows["evidence_assessments.csv"]], enum_values("EvidenceAssessment", "qualityLevel"), "evidence_assessments.quality_level")
    semantic_ids = ref_set(rows["semantic_instances.csv"], "instance_id", "semantic_instances.csv")
    instance_types: dict[str, str] = {}
    for row in rows["semantic_instances.csv"]:
        instance_id = row["instance_id"]
        instance_type = row["instance_type"]
        if instance_type not in allowed_object_types:
            fail(f"{instance_id}.instance_type 未由 02 semantic_scope 冻结: {instance_type}")
        if instance_type in {"Observation", "Event", "Hypothesis", "Signal", "RuleEvaluation", "Judgment", "ReasoningTrace"}:
            fail(f"03 semantic_instances 不得保存推理对象: {instance_type}")
        instance_types[instance_id] = instance_type
    for row in rows["semantic_relations.csv"]:
        relation_id = row["relation_id"]
        if row["relation_type"] not in allowed_relation_types:
            fail(f"{relation_id}.relation_type 未由 02 semantic_scope 冻结: {row['relation_type']}")
        assert_subset([row["source_instance_id"], row["target_instance_id"]], semantic_ids, f"{relation_id}.endpoints")
    for row in rows["reasoning_inputs.csv"]:
        target = row.get("target_instance_id", "")
        assert_subset([target], semantic_ids, f"{row.get('input_id')}.target_instance_id")
        if row.get("anchor_instance_type") != instance_types[target]:
            fail(f"{row.get('input_id')}.anchor_instance_type 与语义实例类型不一致")

    source_documents = ref_set(rows["source_documents.csv"], "source_document_id", "source_documents.csv")
    source_runs = ref_set(rows["source_snapshot.csv"], "source_run_id", "source_snapshot.csv")
    claims = ref_set(rows["evidence_claims.csv"], "claim_id", "evidence_claims.csv")
    facts = ref_set(rows["evidence_facts.csv"], "fact_id", "evidence_facts.csv")
    assessments = ref_set(rows["evidence_assessments.csv"], "assessment_id", "evidence_assessments.csv")
    judgment_units = ref_set(rows["judgment_unit_readiness.csv"], "judgment_unit_id", "judgment_unit_readiness.csv")
    for claim in rows["evidence_claims.csv"]:
        assert_subset(split_refs(claim.get("source_document_id")), source_documents, f"{claim.get('claim_id')}.source_document_id")
        assert_subset(split_refs(claim.get("source_run_refs")), source_runs, f"{claim.get('claim_id')}.source_run_refs")
        assert_subset(split_refs(claim.get("about_instance_refs")), semantic_ids, f"{claim.get('claim_id')}.about_instance_refs")
    for fact in rows["evidence_facts.csv"]:
        assert_subset(split_refs(fact.get("about_instance_refs")), semantic_ids, f"{fact.get('fact_id')}.about_instance_refs")
    allowed_evidence_relations = set(split_refs(evidence_contract.get("required_relation_types"))) | set(split_refs(evidence_contract.get("conflict_relation_types")))
    claim_source_links: set[str] = set()
    fact_claim_links: set[str] = set()
    assessment_links: dict[str, set[str]] = {item: set() for item in assessments}
    evidence_universe = claims | facts
    for relation in rows["evidence_relations.csv"]:
        relation_type = relation["relation_type"]
        source = relation["source_evidence_id"]
        target = relation["target_evidence_id"]
        if relation_type not in allowed_evidence_relations:
            fail(f"{relation.get('relation_id')}.relation_type 未由 02 evidence_contract 冻结")
        if relation_type == "claimCitesSource":
            assert_subset([source], claims, f"{relation.get('relation_id')}.source")
            assert_subset([target], source_documents, f"{relation.get('relation_id')}.target")
            claim_source_links.add(source)
        elif relation_type == "factSupportedByClaim":
            assert_subset([source], facts, f"{relation.get('relation_id')}.source")
            assert_subset([target], claims, f"{relation.get('relation_id')}.target")
            fact_claim_links.add(source)
        elif relation_type == "assessmentEvaluatesEvidence":
            assert_subset([source], assessments, f"{relation.get('relation_id')}.source")
            assert_subset([target], evidence_universe | source_documents, f"{relation.get('relation_id')}.target")
            if relation.get("relation_role") not in {"support", "counter", "conflict", "context"}:
                fail(f"{relation.get('relation_id')}.relation_role 不符合 assessmentEvaluatesEvidence")
            assessment_links[source].add(target)
        else:
            assert_subset([source, target], evidence_universe, f"{relation.get('relation_id')}.endpoints")
    if claims - claim_source_links:
        fail("所有 EvidenceClaim 都必须存在 claimCitesSource")
    if facts - fact_claim_links:
        fail("所有 EvidenceFact 都必须存在 factSupportedByClaim")
    for assessment in rows["evidence_assessments.csv"]:
        aid = assessment["assessment_id"]
        if assessment["profile_ref"] not in allowed_profiles:
            fail(f"{aid}.profile_ref 未由 02 evidence_contract 冻结")
        targets = set(split_refs(assessment.get("evidence_refs")))
        assert_subset(targets, evidence_universe | source_documents, f"{aid}.evidence_refs")
        assert_subset(split_refs(assessment.get("linked_judgment_unit_ids")), judgment_units, f"{aid}.linked_judgment_unit_ids")
        if not targets or not targets.issubset(assessment_links.get(aid, set())):
            fail(f"{aid}.evidence_refs 必须逐项存在 assessmentEvaluatesEvidence")


def _validate_snapshot_refs(rows: dict[str, list[dict[str, str]]]) -> None:
    source_runs = ref_set(rows["source_snapshot.csv"], "source_run_id", "source_snapshot.csv")
    inputs = ref_set(rows["reasoning_inputs.csv"], "input_id", "reasoning_inputs.csv")
    evidence = ref_set(rows["evidence_records.csv"], "evidence_id", "evidence_records.csv")
    coverage = ref_set(rows["state_variable_coverage.csv"], "coverage_id", "state_variable_coverage.csv")
    gaps = ref_set(rows["gaps_and_risks.csv"], "gap_id", "gaps_and_risks.csv", allow_empty=True)
    judgment_units = ref_set(rows["judgment_unit_readiness.csv"], "judgment_unit_id", "judgment_unit_readiness.csv")

    for row in rows["evidence_records.csv"]:
        assert_subset(split_refs(row.get("source_run_id")), source_runs, f"{row.get('evidence_id')}.source_run_id")
        assert_subset(split_refs(row.get("grounds_input_ids")), inputs, f"{row.get('evidence_id')}.grounds_input_ids")
        assert_subset(split_refs(row.get("linked_judgment_unit_ids")), judgment_units, f"{row.get('evidence_id')}.linked_judgment_unit_ids")

    for row in rows["reasoning_inputs.csv"]:
        assert_subset(split_refs(row.get("source_run_refs")), source_runs, f"{row.get('input_id')}.source_run_refs")
        assert_subset(split_refs(row.get("evidence_refs")), evidence, f"{row.get('input_id')}.evidence_refs")
        assert_subset(split_refs(row.get("linked_judgment_unit_ids")), judgment_units, f"{row.get('input_id')}.linked_judgment_unit_ids")

    for file_, id_field in [
        ("state_variable_coverage.csv", "coverage_id"),
        ("path_readiness.csv", "node_id"),
        ("judgment_unit_readiness.csv", "judgment_unit_id"),
    ]:
        for row in rows[file_]:
            label = f"{file_}#{row.get(id_field)}"
            assert_subset(split_refs(row.get("linked_input_ids")), inputs, label + ".linked_input_ids")
            assert_subset(split_refs(row.get("linked_evidence_ids")), evidence, label + ".linked_evidence_ids")
            assert_subset(split_refs(row.get("linked_gap_ids")), gaps, label + ".linked_gap_ids")
            assert_subset(split_refs(row.get("linked_judgment_unit_ids")), judgment_units, label + ".linked_judgment_unit_ids")

    assert_subset(
        split_refs("|".join(row.get("linked_coverage_ids", "") for row in rows["judgment_unit_readiness.csv"])),
        coverage,
        "judgment_unit_readiness.linked_coverage_ids",
    )


def _validate_counts(prep_meta: dict[str, object], summary_meta: dict[str, object], rows: dict[str, list[dict[str, str]]]) -> None:
    manifest_rows = rows["manifest.csv"]
    if len(manifest_rows) != 1:
        fail("manifest.csv 必须且只能有一行")
    manifest = manifest_rows[0]
    if manifest.get("snapshot_version") != "2.0.0" or manifest.get("snapshot_schema_version") != "2.0.0":
        fail("manifest snapshot_version 与 snapshot_schema_version 必须为 2.0.0")

    coverage_total = len(rows["state_variable_coverage.csv"])
    counted = sum(1 for row in rows["state_variable_coverage.csv"] if row.get("evidence_gate_status") == "counted")
    if int(manifest["coverage_unit_total"]) != coverage_total:
        fail("manifest.coverage_unit_total 必须等于 state_variable_coverage.csv 行数")
    if int(manifest["evidence_backed_unit_count"]) != counted:
        fail("manifest.evidence_backed_unit_count 必须等于 evidence_gate_status=counted 的覆盖单元数")

    for meta_label, meta in [("prep", prep_meta), ("summary", summary_meta)]:
        if int(meta["coverage_unit_total"]) != coverage_total:
            fail(f"{meta_label}.coverage_unit_total 与快照不一致")
        if int(meta["evidence_backed_unit_count"]) != counted:
            fail(f"{meta_label}.evidence_backed_unit_count 与快照不一致")

    unit_rows = rows["judgment_unit_readiness.csv"]
    readiness_counts = {value: 0 for value in REASONING_READINESS}
    level_counts = {value: 0 for value in JUDGMENT_LEVELS}
    for row in unit_rows:
        readiness = row.get("reasoning_readiness", "")
        level = row.get("maximum_judgment_level", "")
        if readiness not in REASONING_READINESS:
            fail(f"judgment_unit_readiness#{row.get('judgment_unit_id')}.reasoning_readiness 非法")
        if level not in JUDGMENT_LEVELS:
            fail(f"judgment_unit_readiness#{row.get('judgment_unit_id')}.maximum_judgment_level 非法")
        readiness_counts[readiness] += 1
        level_counts[level] += 1
    count_fields = {
        "judgment_unit_total": len(unit_rows),
        "judgment_unit_full_reasoning_ready_count": readiness_counts["full_reasoning_ready"],
        "judgment_unit_restricted_reasoning_ready_count": readiness_counts["restricted_reasoning_ready"],
        "judgment_unit_insufficient_count": readiness_counts["insufficient"],
        "judgment_unit_J4_count": level_counts["J4"],
        "judgment_unit_J3_count": level_counts["J3"],
        "judgment_unit_J2_count": level_counts["J2"],
        "judgment_unit_J1_count": level_counts["J1"],
        "judgment_unit_J0_count": level_counts["J0"],
    }
    for field, expected in count_fields.items():
        if int(manifest.get(field, -1)) != expected:
            fail(f"manifest.{field} 必须为 {expected}")
        if field in summary_meta and int(summary_meta[field]) != expected:
            fail(f"summary.{field} 必须为 {expected}")

    highest = max((row["maximum_judgment_level"] for row in unit_rows), key=judgment_level_rank)
    for label, meta in [("prep", prep_meta), ("summary", summary_meta), ("manifest", manifest)]:
        if str(meta.get("highest_supported_judgment_level")) != highest:
            fail(f"{label}.highest_supported_judgment_level 必须为 {highest}")
    floor_met = any(judgment_level_rank(row["maximum_judgment_level"]) >= judgment_level_rank("J2") for row in unit_rows)
    for label, meta in [("summary", summary_meta), ("manifest", manifest)]:
        value = str(meta.get("core_judgment_publish_floor_met", "")).lower() in {"true", "1", "yes"}
        if value != floor_met:
            fail(f"{label}.core_judgment_publish_floor_met 必须为 {str(floor_met).lower()}")


def _validate_judgment_strength(view: dict[str, object], rows: dict[str, list[dict[str, str]]]) -> None:
    view_units = {
        str(item["judgment_unit_id"]): item
        for item in view.get("judgment_units", [])
        if isinstance(item, dict) and item.get("judgment_unit_id")
    }
    path_rows = rows["path_readiness.csv"]
    evidence_rows = rows["evidence_records.csv"]

    for row in path_rows:
        label = f"path_readiness#{row.get('path_id')}#{row.get('node_id')}"
        if row.get("path_status") not in PATH_STATUSES:
            fail(f"{label}.path_status 非法")
        if row.get("reasoning_readiness") not in REASONING_READINESS:
            fail(f"{label}.reasoning_readiness 非法")
        if row.get("maximum_judgment_level") not in JUDGMENT_LEVELS:
            fail(f"{label}.maximum_judgment_level 非法")
        if row.get("path_status") == "blocked" and row.get("maximum_judgment_level") != "J0":
            fail(f"{label}: path_status=blocked 时 maximum_judgment_level 必须为 J0")

    for row in rows["judgment_unit_readiness.csv"]:
        ju_id = row.get("judgment_unit_id", "")
        label = f"judgment_unit_readiness#{ju_id}"
        if ju_id not in view_units:
            fail(f"{label} 未在 02 judgment_units 中定义")
        source_unit = view_units[ju_id]
        target_type = row.get("target_claim_type", "")
        level = row.get("maximum_judgment_level", "")
        validate_target_claim_level(target_type, level, label)
        if target_type != str(source_unit.get("target_claim_type")):
            fail(f"{label}.target_claim_type 必须继承 02")
        if row.get("maximum_judgment_label") != JUDGMENT_LABELS[level]:
            fail(f"{label}.maximum_judgment_label 必须为 {JUDGMENT_LABELS[level]}")
        if row.get("reasoning_readiness") not in REASONING_READINESS:
            fail(f"{label}.reasoning_readiness 非法")
        if row.get("claim_mode") not in CLAIM_MODES:
            fail(f"{label}.claim_mode 非法")
        if row.get("judgment_status") not in JUDGMENT_STATUSES:
            fail(f"{label}.judgment_status 非法")
        if row.get("claim_mode") == "conditional" and not split_refs(row.get("conditions")):
            fail(f"{label}: claim_mode=conditional 时 conditions 不得为空")
        if row.get("judgment_status") == "contested" and judgment_level_rank(level) > judgment_level_rank("J1"):
            fail(f"{label}: contested 的最高支持等级不得超过 J1")
        if row.get("reasoning_readiness") == "insufficient" and level != "J0":
            fail(f"{label}: reasoning_readiness=insufficient 时必须为 J0")
        if not str(row.get("strength_basis", "")).strip():
            fail(f"{label}.strength_basis 不得为空")

        linked_evidence = [
            item for item in evidence_rows
            if ju_id in split_refs(item.get("linked_judgment_unit_ids"))
        ]
        independent_groups = {
            item.get("independence_group_id", "").strip()
            for item in linked_evidence
            if item.get("independence_group_id", "").strip()
        }
        if int(row.get("independent_source_group_count", -1)) != len(independent_groups):
            fail(f"{label}.independent_source_group_count 必须由 evidence_records 去重得到 {len(independent_groups)}")
        evidence_baskets = set()
        for item in linked_evidence:
            evidence_baskets.update(split_refs(item.get("evidence_basket_ids")))
            requirement_id = str(item.get("requirement_id", ""))
            for basket in source_unit.get("mandatory_evidence_baskets", []):
                if requirement_id in split_refs(basket.get("evidence_requirement_refs")):
                    evidence_baskets.add(str(basket["basket_id"]))
        level_requirement = source_unit["level_requirements"][level]
        if level_requirement.get("applicable") is not True:
            fail(f"{label}: 02 未允许使用 {level}")
        if len(independent_groups) < int(level_requirement.get("minimum_independent_source_groups", 0)):
            fail(f"{label}: 独立来源组数未达到 02 对 {level} 的要求")
        required_baskets = set(split_refs(level_requirement.get("required_evidence_basket_refs")))
        baskets_met = level != "J0" and required_baskets.issubset(evidence_baskets)
        declared_baskets_met = str(row.get("mandatory_evidence_baskets_met", "")).lower() in {"true", "1", "yes"}
        if declared_baskets_met != baskets_met:
            fail(f"{label}.mandatory_evidence_baskets_met 与 evidence_records 不一致")

        linked_path_rows = [
            item for item in path_rows
            if ju_id in split_refs(item.get("linked_judgment_unit_ids"))
        ]
        if linked_path_rows and all(item.get("path_status") == "blocked" for item in linked_path_rows) and level != "J0":
            fail(f"{label}: 关联路径全部 blocked 时必须为 J0")

        support_roles = {"support", "primary_support", "corroborating_support"}
        direct_support = any(
            item.get("evidence_role") in support_roles and item.get("directness") == "direct"
            for item in linked_evidence
        )
        traceable_signal = any(item.get("traceability") not in {"", "untraceable"} for item in linked_evidence)
        counter_checked = row.get("counter_evidence_status") not in {"", "not_checked"}
        alternative_checked = row.get("alternative_explanation_status") not in {"", "not_checked", "compared_unresolved"}
        conflict_clear = row.get("conflict_status") not in {"", "unresolved", "unresolved_material", "material_conflict"}

        if level == "J4":
            primary_direct = any(
                item.get("evidence_role") in support_roles
                and item.get("directness") == "direct"
                and item.get("source_authority") in {"primary", "official", "official_primary"}
                for item in linked_evidence
            )
            if not (primary_direct and baskets_met and counter_checked and conflict_clear and row.get("scope_alignment") == "matched" and row.get("time_alignment") == "matched"):
                fail(f"{label}: J4 未满足一手直接证据、证据篮子、反证、冲突及范围时间要求")
        elif level == "J3":
            if not (baskets_met and len(independent_groups) >= 2 and counter_checked and alternative_checked and conflict_clear):
                fail(f"{label}: J3 未满足证据篮子、两组独立来源、反证、替代解释或冲突要求")
            if any(item.get("path_status") == "blocked" for item in linked_path_rows):
                fail(f"{label}: J3 的关联路径不得 blocked")
            if row.get("scope_alignment") != "matched" or row.get("time_alignment") != "matched":
                fail(f"{label}: J3 要求范围与时间匹配")
        elif level == "J2" and not (direct_support and counter_checked):
            fail(f"{label}: J2 至少需要一项直接支持且已检查反证")
        elif level == "J1" and not traceable_signal:
            fail(f"{label}: J1 至少需要一项可追溯初步信号")


def validate(prep_path: str | Path, snapshot_dir: str | Path) -> dict[str, object]:
    prep_path = Path(prep_path)
    snapshot_dir = Path(snapshot_dir)
    prep_triplet = parse_triplet(prep_path, "数据与证据准备", stage="03")
    dir_triplet = parse_triplet(snapshot_dir, "数据与证据快照", stage="03")
    if prep_triplet != dir_triplet:
        fail("03 准备文档与快照目录文件名核心主题、日期、序号必须一致")
    if not snapshot_dir.is_dir():
        fail(f"{snapshot_dir} 不是快照目录")

    summary_path = snapshot_dir / f"{snapshot_dir.name}.md"
    if not summary_path.exists():
        fail("快照目录缺少同名 Markdown 摘要")

    prep_meta, prep_body = parse_markdown(prep_path)
    summary_meta, _ = parse_markdown(summary_path)
    require_keys(prep_meta, REQUIRED_PREP_META, str(prep_path))
    require_keys(summary_meta, REQUIRED_SUMMARY_META, str(summary_path))
    require_schema_version(prep_meta["schema_version"], str(prep_path), expected="2.0.0")
    require_schema_version(summary_meta["schema_version"], str(summary_path), expected="2.0.0")
    if str(prep_meta["schema_version"]) != "2.0.0" or str(summary_meta["schema_version"]) != "2.0.0":
        fail("03 准备文档与快照摘要 schema_version 必须为 2.0.0")
    if str(summary_meta["snapshot_version"]) != "2.0.0":
        fail("03 快照摘要 snapshot_version 必须为 2.0.0")
    if prep_meta["document_type"] != "data_evidence_preparation":
        fail("03 准备文档 document_type 必须为 data_evidence_preparation")
    if summary_meta["document_type"] != "data_evidence_snapshot_summary":
        fail("03 快照摘要 document_type 必须为 data_evidence_snapshot_summary")
    validate_quality_status(prep_meta["quality_status"], str(prep_path))
    validate_quality_status(summary_meta["quality_status"], str(summary_path))
    validate_gate_review_fields(prep_meta, str(prep_path))
    validate_gate_review_fields(summary_meta, str(summary_path))
    validate_admission(prep_meta["admission"], str(prep_path))
    validate_admission(summary_meta["admission"], str(summary_path))
    validate_search_status(prep_meta["search_status"], str(prep_path))
    validate_search_status(summary_meta["search_status"], str(summary_path))
    if str(prep_meta["highest_supported_judgment_level"]) not in JUDGMENT_LEVELS:
        fail("preparation.highest_supported_judgment_level 非法")
    validate_return_routing_fields(prep_meta, str(prep_path), current_stage="03")
    require_body_sections(prep_body, REQUIRED_PREP_SECTIONS, str(prep_path))
    validate_researcher_body(prep_body, str(prep_path))

    view = _validate_upstream_02(prep_meta, prep_path)

    if not same_ref(prep_meta["snapshot_ref"], f"{snapshot_dir.name}/manifest.csv"):
        fail("preparation.snapshot_ref 必须指向快照目录 manifest.csv")
    if not same_ref(prep_meta["snapshot_summary_ref"], f"{snapshot_dir.name}/{file_name(summary_path)}"):
        fail("preparation.snapshot_summary_ref 必须指向快照摘要")

    _validate_headers(snapshot_dir)
    rows = _rows(snapshot_dir)
    _validate_instance_manifest(prep_path, snapshot_dir, prep_triplet, prep_meta, rows)
    _validate_ontology_instances(view, rows)
    _validate_normalized_evidence_graph(rows)
    _validate_counts(prep_meta, summary_meta, rows)
    _validate_snapshot_refs(rows)
    _validate_return_actions(rows)
    _validate_judgment_strength(view, rows)

    manifest = rows["manifest.csv"][0]
    validate_return_routing_fields(manifest, "manifest", current_stage="03")
    validate_admission_search_consistency(prep_meta, summary_meta, manifest)
    validate_gate_review_fields(manifest, "manifest")
    validate_core_ju_publish_baseline(
        rows["judgment_unit_readiness.csv"],
        admission=manifest["admission"],
        quality_status=manifest["quality_status"],
        label="manifest",
    )
    validate_core_ju_publish_baseline(
        rows["judgment_unit_readiness.csv"],
        admission=prep_meta["admission"],
        quality_status=prep_meta["quality_status"],
        label=str(prep_path),
    )
    validate_core_ju_publish_baseline(
        rows["judgment_unit_readiness.csv"],
        admission=summary_meta["admission"],
        quality_status=summary_meta["quality_status"],
        label=str(summary_path),
    )
    if not same_ref(manifest["task_id"], prep_meta["task_id"]):
        fail("manifest.task_id 与 preparation.task_id 不一致")
    if not same_ref(manifest["execution_id"], prep_meta["execution_id"]):
        fail("manifest.execution_id 与 preparation.execution_id 不一致")
    assert_values([row.get("maximum_judgment_level", "") for row in rows["path_readiness.csv"]], JUDGMENT_LEVELS, "path_readiness.maximum_judgment_level")
    assert_values([row.get("maximum_judgment_level_after_gap", "") for row in rows["gaps_and_risks.csv"]], JUDGMENT_LEVELS, "gaps_and_risks.maximum_judgment_level_after_gap")
    assert_values([row.get("coverage_constraint", "") for row in rows["state_variable_coverage.csv"]], {"none", "downgrade", "block"}, "state_variable_coverage.coverage_constraint")

    material_summary = validate_05_materials(
        snapshot_dir,
        quality_status=manifest["quality_status"],
        label="05_material_readiness",
    )

    return {
        "schema_version": "2.0.0",
        "task_id": prep_meta["task_id"],
        "execution_id": prep_meta["execution_id"],
        "coverage_unit_total": int(manifest["coverage_unit_total"]),
        "evidence_backed_unit_count": int(manifest["evidence_backed_unit_count"]),
        "judgment_unit_total": int(manifest["judgment_unit_total"]),
        "material_readiness": material_summary,
    }


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print("usage: validate_03_outputs.py <数据与证据准备.md> <数据与证据快照目录>")
        return 2
    try:
        print(ok_payload(**validate(argv[1], argv[2])))
        return 0
    except Exception as exc:
        print(error_payload(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
