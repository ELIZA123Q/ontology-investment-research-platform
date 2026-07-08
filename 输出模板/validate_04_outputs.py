#!/usr/bin/env python3
"""Validate 04 reasoning report and audit outputs."""

from __future__ import annotations

import sys
import re
from pathlib import Path

from quality_gate_utils import ALLOWED_04_OUTPUTS, output_rank, validate_allowed_04_output, validate_quality_status
from validator_utils import (
    assert_subset,
    error_payload,
    fail,
    file_name,
    load_yaml_file,
    ok_payload,
    parse_markdown,
    parse_triplet,
    read_csv,
    require_body_sections,
    require_keys,
    require_schema_version,
    same_ref,
    split_refs,
)


REQUIRED_REPORT_META = [
    "document_type",
    "schema_version",
    "task_id",
    "execution_id",
    "source_01_ref",
    "source_02_logic_ref",
    "source_02_view_ref",
    "preparation_ref",
    "snapshot_ref",
    "audit_ref",
    "judgment_as_of",
    "report_status",
    "quality_status",
    "conclusion_level",
    "confidence",
    "scope",
]

REQUIRED_REPORT_SECTIONS = [
    "一页摘要",
    "核心落点：当前怎么看—为什么—下一步看什么",
    "主导机制",
    "对象分化",
    "演进路线",
    "改判闸门",
    "可执行跟踪",
    "证据边界与审计索引",
    "04 质量门槛检查",
]

REQUIRED_AUDIT_TOP = [
    "document_type",
    "schema_version",
    "metadata",
    "input_integrity",
    "evidence_admission",
    "judgment_unit_gate_results",
    "overall_judgment",
    "claim_register",
    "uncertainty_register",
    "change_gate_register",
    "tracking_register",
    "ontology_context",
    "path_results",
    "state_variable_results",
    "data_logic",
    "report_quality_check",
    "compliance_check",
]

REPORT_STATUSES = {"draft", "complete", "published"}
CONCLUSION_LEVELS = {
    "confirmed",
    "directional",
    "conditional",
    "insufficient_evidence",
    "blocked",
    "contested",
}


def _validate_report(report_path: Path) -> tuple[dict[str, object], str]:
    meta, body = parse_markdown(report_path)
    require_keys(meta, REQUIRED_REPORT_META, str(report_path))
    require_schema_version(meta["schema_version"], str(report_path))
    if meta["document_type"] != "reasoning_report":
        fail("04 报告 document_type 必须为 reasoning_report")
    if meta["report_status"] not in REPORT_STATUSES:
        fail("report_status 非法")
    validate_quality_status(meta["quality_status"], str(report_path))
    if meta["conclusion_level"] not in CONCLUSION_LEVELS:
        fail("conclusion_level 非法")
    if not isinstance(meta.get("scope"), dict):
        fail("scope 必须是对象")
    require_body_sections(body, REQUIRED_REPORT_SECTIONS, str(report_path))
    forbidden = ["目标价", "收益率预测", "仓位建议", "买入评级", "卖出评级"]
    for marker in forbidden:
        for match in re.finditer(re.escape(marker), body):
            context = body[max(0, match.start() - 30) : match.end() + 12]
            if "不构成" in context or "不得" in context or "不输出" in context:
                continue
            fail(f"04 正文不得包含投资建议或评级用语: {marker}")
    return meta, body


def _validate_audit(audit_path: Path) -> dict[str, object]:
    audit = load_yaml_file(audit_path)
    if not isinstance(audit, dict):
        fail("04 审计文件必须是 YAML 对象")
    require_keys(audit, REQUIRED_AUDIT_TOP, str(audit_path))
    require_schema_version(audit["schema_version"], str(audit_path))
    if audit["document_type"] != "reasoning_audit":
        fail("04 审计 document_type 必须为 reasoning_audit")
    metadata = audit["metadata"]
    require_keys(metadata, ["task_id", "execution_id", "report_ref", "snapshot_ref", "audit_status", "quality_status"], "audit.metadata")
    validate_quality_status(metadata["quality_status"], "audit.metadata")
    if metadata["audit_status"] not in REPORT_STATUSES:
        fail("audit.metadata.audit_status 非法")
    return audit


def _snapshot_rows(snapshot_dir: Path) -> tuple[dict[str, str], dict[str, dict[str, str]]]:
    manifest_rows = read_csv(snapshot_dir / "manifest.csv")
    if len(manifest_rows) != 1:
        fail("manifest.csv 必须且只能有一行")
    judgments = read_csv(snapshot_dir / "judgment_unit_readiness.csv")
    judgment_by_id = {row["judgment_unit_id"]: row for row in judgments}
    if not judgment_by_id:
        fail("judgment_unit_readiness.csv 至少需要一行")
    for unit_id, row in judgment_by_id.items():
        validate_allowed_04_output(row.get("allowed_04_output"), f"judgment_unit_readiness#{unit_id}")
    return manifest_rows[0], judgment_by_id


def _validate_claims(audit: dict[str, object], judgment_by_id: dict[str, dict[str, str]]) -> None:
    claims = audit["claim_register"]
    if not isinstance(claims, list) or not claims:
        fail("claim_register 至少需要一项")
    judgment_ids = set(judgment_by_id)
    claim_ids = set()
    for claim in claims:
        require_keys(
            claim,
            [
                "claim_id",
                "report_section",
                "reader_label",
                "statement",
                "linked_judgment_unit",
                "allowed_04_output",
                "conclusion_level",
                "confidence",
                "overreach_check",
            ],
            "claim_register[]",
        )
        claim_ids.add(str(claim["claim_id"]))
        validate_allowed_04_output(claim["allowed_04_output"], f"claim_register#{claim['claim_id']}")
        linked_units = split_refs(claim.get("linked_judgment_unit"))
        assert_subset(linked_units, judgment_ids, f"claim_register#{claim['claim_id']}.linked_judgment_unit")
        for unit_id in linked_units:
            source_output = judgment_by_id[unit_id]["allowed_04_output"]
            if output_rank(str(claim["allowed_04_output"])) > output_rank(source_output):
                fail(f"{claim['claim_id']} 超过 03 使用上限: {unit_id}={source_output}")
        checks = claim["overreach_check"]
        if not isinstance(checks, dict):
            fail(f"{claim['claim_id']}.overreach_check 必须是对象")
        for key in ["within_03_use_limit", "evidence_label_consistent", "no_unfrozen_fact_used"]:
            if checks.get(key) is not True:
                fail(f"{claim['claim_id']}.overreach_check.{key} 必须为 true")

    for register, ref_field in [
        ("uncertainty_register", "affects_claim_refs"),
        ("change_gate_register", "linked_claim_refs"),
    ]:
        for row in audit.get(register, []):
            assert_subset(split_refs(row.get(ref_field)), claim_ids, f"{register}.{ref_field}")


def _validate_quality_and_compliance(audit: dict[str, object]) -> None:
    quality = audit["report_quality_check"]
    compliance = audit["compliance_check"]
    for key in [
        "answer_first",
        "claims_within_03_use_limits",
        "claim_labels_match_evidence_strength",
        "change_gates_observable",
        "no_internal_ids_in_main_text",
        "no_investment_advice",
        "audit_report_consistent",
    ]:
        if quality.get(key) is not True:
            fail(f"report_quality_check.{key} 必须为 true")
    if quality.get("result") != "pass":
        fail("report_quality_check.result 必须为 pass")
    for key in [
        "no_rating_target_price_return_forecast_or_position_advice",
        "no_new_unfrozen_evidence",
        "no_scope_drift",
        "citations_or_evidence_refs_complete",
        "publishable",
    ]:
        if compliance.get(key) is not True:
            fail(f"compliance_check.{key} 必须为 true")


def validate(report_path: str | Path, audit_path: str | Path, snapshot_dir: str | Path) -> dict[str, object]:
    report_path = Path(report_path)
    audit_path = Path(audit_path)
    snapshot_dir = Path(snapshot_dir)
    report_triplet = parse_triplet(report_path, "推理报告")
    audit_triplet = parse_triplet(audit_path, "推理审计")
    snapshot_triplet = parse_triplet(snapshot_dir, "数据与证据快照")
    if report_triplet != audit_triplet or report_triplet != snapshot_triplet:
        fail("04 报告、审计与 03 快照文件名核心主题、日期、序号必须一致")

    report_meta, _ = _validate_report(report_path)
    audit = _validate_audit(audit_path)
    metadata = audit["metadata"]
    manifest, judgment_by_id = _snapshot_rows(snapshot_dir)

    if not same_ref(report_meta["audit_ref"], file_name(audit_path)):
        fail("report.audit_ref 必须指向配对审计 YAML")
    if not same_ref(metadata["report_ref"], file_name(report_path)):
        fail("audit.metadata.report_ref 必须指向配对报告")
    if not same_ref(report_meta["snapshot_ref"], f"{snapshot_dir.name}/manifest.csv"):
        fail("report.snapshot_ref 必须指向 03 快照 manifest.csv")
    if not same_ref(metadata["snapshot_ref"], f"{snapshot_dir.name}/manifest.csv"):
        fail("audit.metadata.snapshot_ref 必须指向 03 快照 manifest.csv")
    for field in ["task_id", "execution_id"]:
        if not same_ref(report_meta[field], metadata[field]) or not same_ref(report_meta[field], manifest[field]):
            fail(f"{field} 在 report/audit/manifest 中必须一致")

    evidence_admission = audit["evidence_admission"]
    for field in ["admission", "coverage_unit_total", "evidence_backed_unit_count", "confidence_ceiling"]:
        if field in evidence_admission and not same_ref(evidence_admission[field], manifest[field]):
            fail(f"audit.evidence_admission.{field} 必须与 manifest 一致")

    _validate_claims(audit, judgment_by_id)
    _validate_quality_and_compliance(audit)

    return {
        "schema_version": "1.0.0",
        "task_id": report_meta["task_id"],
        "execution_id": report_meta["execution_id"],
        "claims": len(audit["claim_register"]),
    }


def main(argv: list[str]) -> int:
    if len(argv) != 4:
        print("usage: validate_04_outputs.py <推理报告.md> <推理审计.yaml> <数据与证据快照目录>")
        return 2
    try:
        print(ok_payload(**validate(argv[1], argv[2], argv[3])))
        return 0
    except Exception as exc:
        print(error_payload(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
