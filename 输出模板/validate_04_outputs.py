#!/usr/bin/env python3
"""校验 04 研究员报告与机器推理审计的配对、完整性和展示边界。"""

from __future__ import annotations

import argparse
import csv
import re
from pathlib import Path
from typing import Any

import yaml


REQUIRED_BODY_HEADINGS = [
    "## 1. 核心判断",
    "## 2. 主导机制",
    "## 3. 分对象/环节判断",
    "## 4. 决定性不确定性与情景",
    "## 5. 跟踪与改判",
]

READER_LABELS = {"已确认", "倾向判断", "条件判断", "暂不可判断"}
CONCLUSION_LEVELS = {"insufficient_evidence", "observation", "supported", "contested", "blocked"}
PATH_STATUSES = {
    "established",
    "partially_established",
    "weakened",
    "blocked",
    "insufficient_evidence",
    "contested",
    "not_applicable",
}
UNCERTAINTY_TIERS = {"decisive", "boundary", "audit_only"}

FORBIDDEN_BODY_PATTERNS = {
    "03 准入码": r"\b(?:normal_pass|restricted_pass|incomplete_pass|failed)\b",
    "覆盖/推理状态码": r"\b(?:counted|blocked|profile|inference_allowed)\b",
    "审计 ID": r"\b(?:SVC|RI|EV|GAP|N|P)-\d+\b",
    "证据覆盖率": r"(?:证据|变量|锚点|单元)[^\n，。；]{0,12}覆盖率",
    "整体系统等级": r"(?:观察级|结论等级|整体置信度|\bconclusion_level\b)",
    "审计章节": r"(?:本体基座|命中对象与关系|路径状态与证据留痕)",
}


def fail(message: str) -> None:
    raise ValueError(message)


def load_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def split_refs(value: str | None) -> list[str]:
    return [item for item in (value or "").split("|") if item]


def parse_report(path: Path) -> tuple[dict[str, Any], str]:
    text = path.read_text(encoding="utf-8")
    match = re.match(r"^---\n(.*?)\n---\n(.*)$", text, flags=re.S)
    if not match:
        fail(f"{path.name}: 缺少可解析的 YAML front matter")
    metadata = yaml.safe_load(match.group(1))
    if not isinstance(metadata, dict):
        fail(f"{path.name}: front matter 不是对象")
    return metadata, match.group(2)


def require_keys(container: dict[str, Any], keys: list[str], label: str) -> None:
    missing = [key for key in keys if key not in container]
    if missing:
        fail(f"{label}: 缺少字段 {missing}")


def ref_set(items: list[dict[str, Any]], key: str) -> set[str]:
    values = [str(item.get(key, "")) for item in items]
    if any(not value for value in values):
        fail(f"{key}: 存在空引用")
    duplicates = {value for value in values if values.count(value) > 1}
    if duplicates:
        fail(f"{key}: 存在重复值 {sorted(duplicates)}")
    return set(values)


def assert_subset(refs: list[str], universe: set[str], label: str) -> None:
    dangling = sorted(set(refs) - universe)
    if dangling:
        fail(f"{label}: 存在悬空引用 {dangling}")


def flatten(values: list[list[str]]) -> list[str]:
    return [item for group in values for item in group]


def validate(
    report_path: Path,
    audit_path: Path,
    view_path: Path,
    snapshot_dir: Path,
) -> dict[str, int]:
    report_meta, report_body = parse_report(report_path)
    audit = yaml.safe_load(audit_path.read_text(encoding="utf-8"))
    view = yaml.safe_load(view_path.read_text(encoding="utf-8"))
    if not isinstance(audit, dict) or not isinstance(view, dict):
        fail("审计或本体视图 YAML 不是对象")

    require_keys(
        report_meta,
        [
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
            "quality_status",
            "conclusion_level",
            "confidence",
            "scope",
            "report_status",
        ],
        report_path.name,
    )
    require_keys(
        audit,
        [
            "document_type",
            "schema_version",
            "metadata",
            "evidence_admission",
            "overall_judgment",
            "claim_register",
            "uncertainty_register",
            "ontology_context",
            "path_results",
            "state_variable_results",
            "data_logic",
            "compliance_check",
        ],
        audit_path.name,
    )

    if report_meta["document_type"] != "reasoning_report" or audit["document_type"] != "reasoning_audit":
        fail("报告或审计 document_type 错误")
    if report_meta["schema_version"] != "1.3.0" or audit["schema_version"] != "1.3.0":
        fail("04 报告与审计必须使用 schema_version 1.3.0")

    audit_meta = audit["metadata"]
    pairing = {
        "task_id": "task_id",
        "execution_id": "execution_id",
        "source_01_ref": "source_01_ref",
        "source_02_logic_ref": "source_02_logic_ref",
        "source_02_view_ref": "source_02_view_ref",
        "preparation_ref": "preparation_ref",
        "snapshot_ref": "snapshot_ref",
        "judgment_as_of": "judgment_as_of",
    }
    for report_key, audit_key in pairing.items():
        if report_meta[report_key] != audit_meta.get(audit_key):
            fail(f"报告/审计配对失败：{report_key}")
    if Path(report_meta["audit_ref"]).name != audit_path.name:
        fail("报告 audit_ref 未指向当前审计")
    if Path(audit_meta.get("report_ref", "")).name != report_path.name:
        fail("审计 report_ref 未指向当前报告")

    if view["task_context"]["task_id"] != report_meta["task_id"]:
        fail("02 本体视图 task_id 与 04 不一致")
    if Path(report_meta["source_02_view_ref"]).name != view_path.name:
        fail("报告 source_02_view_ref 未指向当前视图")

    manifest_rows = load_csv(snapshot_dir / "manifest.csv")
    if len(manifest_rows) != 1:
        fail("manifest.csv 必须且只能有一行")
    manifest = manifest_rows[0]
    if manifest["task_id"] != report_meta["task_id"] or manifest["execution_id"] != report_meta["execution_id"]:
        fail("03 manifest 与 04 任务/运行标识不一致")

    admission = audit["evidence_admission"]
    admission_checks = {
        "quality_status": manifest["admission"],
        "coverage_unit_total": int(manifest["coverage_unit_total"]),
        "evidence_backed_unit_count": int(manifest["evidence_backed_unit_count"]),
        "confidence_ceiling": manifest["confidence_ceiling"],
    }
    for key, expected in admission_checks.items():
        if admission.get(key) != expected:
            fail(f"evidence_admission.{key} 与 03 manifest 不一致")
    if abs(float(admission["evidence_coverage_rate"]) - float(manifest["evidence_coverage_rate"])) > 1e-9:
        fail("evidence_admission.evidence_coverage_rate 与 03 manifest 不一致")
    if report_meta["quality_status"] != admission["quality_status"]:
        fail("报告 quality_status 未继承审计准入状态")
    if report_meta["conclusion_level"] != audit["overall_judgment"]["conclusion_level"]:
        fail("报告与审计 overall conclusion_level 不一致")
    if report_meta["confidence"] != audit["overall_judgment"]["confidence"]:
        fail("报告与审计 overall confidence 不一致")

    body_part, separator, appendix = report_body.partition("## 附录 A：证据边界与审计索引")
    if not separator:
        fail("报告缺少“附录 A：证据边界与审计索引”")
    positions = []
    for heading in REQUIRED_BODY_HEADINGS:
        position = body_part.find(heading)
        if position < 0:
            fail(f"报告正文缺少章节：{heading}")
        positions.append(position)
    if positions != sorted(positions):
        fail("报告五段正文顺序错误")
    core = body_part[positions[0] : positions[1]]
    if "已经可以判断" not in core or "还不能判断" not in core:
        fail("核心判断必须区分“已经可以判断”与“还不能判断”")
    for label, pattern in FORBIDDEN_BODY_PATTERNS.items():
        match = re.search(pattern, body_part, flags=re.I)
        if match:
            fail(f"正文出现{label}：{match.group(0)}")
    if "覆盖率高" not in appendix or "不等于" not in appendix:
        fail("附录必须解释覆盖率高不等于可确认完整阶段")
    if audit_path.name not in appendix or Path(report_meta["snapshot_ref"]).as_posix() not in appendix:
        fail("附录缺少审计或快照定位")
    if re.search(r"<(?:[^<>]+)>|\bTODO\b|\bTBD\b", report_body, flags=re.I):
        fail("报告存在模板占位符")

    coverage_rows = load_csv(snapshot_dir / "state_variable_coverage.csv")
    input_rows = load_csv(snapshot_dir / "reasoning_inputs.csv")
    evidence_rows = load_csv(snapshot_dir / "evidence_records.csv")
    gap_rows = load_csv(snapshot_dir / "gaps_and_risks.csv")
    readiness_rows = load_csv(snapshot_dir / "path_readiness.csv")
    coverage_ids = ref_set(coverage_rows, "coverage_id")
    input_ids = ref_set(input_rows, "input_id")
    evidence_ids = ref_set(evidence_rows, "evidence_id")
    gap_ids = ref_set(gap_rows, "gap_id")
    readiness_node_ids = ref_set(readiness_rows, "node_id")

    view_nodes: set[str] = set()
    for path in view["candidate_paths"]:
        for node in path["nodes"]:
            if node["node_id"] in view_nodes:
                fail(f"02 本体视图路径节点重复：{node['node_id']}")
            view_nodes.add(node["node_id"])
    view_variables = {item["id"] for item in view["reasoning_view"]["state_variables"]}
    if view_nodes != readiness_node_ids:
        fail("02 路径节点与 03 path_readiness 不一致")

    claims = audit["claim_register"]
    uncertainties = audit["uncertainty_register"]
    paths = audit["path_results"]
    variables = audit["state_variable_results"]
    claim_ids = ref_set(claims, "claim_id")
    uncertainty_ids = ref_set(uncertainties, "uncertainty_id")
    audit_node_ids = ref_set(paths, "node_id")
    audit_variable_ids = ref_set(variables, "state_variable_id")
    if audit_node_ids != view_nodes:
        fail(f"审计路径节点不完整：expected={sorted(view_nodes)} actual={sorted(audit_node_ids)}")
    if audit_variable_ids != view_variables:
        fail(f"审计状态变量不完整：expected={sorted(view_variables)} actual={sorted(audit_variable_ids)}")

    decisive = [item for item in uncertainties if item.get("tier") == "decisive"]
    if not 1 <= len(decisive) <= 4:
        fail(f"决定性不确定性必须为 1—4 项，当前为 {len(decisive)}")
    for item in uncertainties:
        if item.get("tier") not in UNCERTAINTY_TIERS:
            fail(f"{item['uncertainty_id']}: tier 非法")
        assert_subset(item.get("affects_claim_refs", []), claim_ids, f"{item['uncertainty_id']}.affects_claim_refs")
        assert_subset(item.get("gap_refs", []), gap_ids, f"{item['uncertainty_id']}.gap_refs")
        if item["tier"] == "decisive":
            for key in ("affects_claim_refs", "observation_signal", "update_trigger", "judgment_change"):
                if not item.get(key):
                    fail(f"{item['uncertainty_id']}: 决定性不确定性缺少 {key}")

    for item in claims:
        if item.get("reader_label") not in READER_LABELS:
            fail(f"{item['claim_id']}: reader_label 非法")
        if item.get("conclusion_level") not in CONCLUSION_LEVELS:
            fail(f"{item['claim_id']}: conclusion_level 非法")
        assert_subset(item.get("path_refs", []), view_nodes, f"{item['claim_id']}.path_refs")
        assert_subset(item.get("evidence_refs", []), evidence_ids, f"{item['claim_id']}.evidence_refs")
        assert_subset(item.get("uncertainty_refs", []), uncertainty_ids, f"{item['claim_id']}.uncertainty_refs")
        if not item.get("statement") or not item.get("report_section"):
            fail(f"{item['claim_id']}: 缺少 statement 或 report_section")
    for label in READER_LABELS:
        if not any(item["reader_label"] == label for item in claims):
            fail(f"claim_register 未覆盖正文标签：{label}")

    for item in paths:
        if item.get("status") not in PATH_STATUSES:
            fail(f"{item['node_id']}: path status 非法")
        assert_subset(item.get("input_refs", []), input_ids, f"{item['node_id']}.input_refs")
        assert_subset(item.get("evidence_refs", []), evidence_ids, f"{item['node_id']}.evidence_refs")
        assert_subset(item.get("counter_evidence_refs", []), evidence_ids, f"{item['node_id']}.counter_evidence_refs")
        assert_subset(item.get("gap_refs", []), gap_ids, f"{item['node_id']}.gap_refs")
        assert_subset(item.get("state_variable_refs", []), view_variables, f"{item['node_id']}.state_variable_refs")

    variable_coverage_refs = flatten([item.get("coverage_unit_refs", []) for item in variables])
    if set(variable_coverage_refs) != coverage_ids or len(variable_coverage_refs) != len(coverage_ids):
        fail("状态变量未且仅未引用全部 03 覆盖单元")
    coverage_by_variable: dict[str, list[dict[str, str]]] = {}
    for row in coverage_rows:
        coverage_by_variable.setdefault(row["state_variable_id"], []).append(row)
    for item in variables:
        variable_id = item["state_variable_id"]
        rows = coverage_by_variable.get(variable_id, [])
        expected_refs = {row["coverage_id"] for row in rows}
        if set(item.get("coverage_unit_refs", [])) != expected_refs:
            fail(f"{variable_id}: coverage_unit_refs 与 03 不一致")
        assert_subset(item.get("path_refs", []), view_nodes, f"{variable_id}.path_refs")
        assert_subset(item.get("evidence_refs", []), evidence_ids, f"{variable_id}.evidence_refs")
        assert_subset(item.get("uncertainty_refs", []), uncertainty_ids, f"{variable_id}.uncertainty_refs")
        allowed = {row["inference_allowed"] for row in rows}
        if allowed == {"blocked"} and item.get("inference_allowed") != "blocked":
            fail(f"{variable_id}: 超过 03 inference_allowed")
        if "blocked" in allowed and "blocked" not in str(item.get("inference_allowed", "")):
            fail(f"{variable_id}: 未在审计中保留 blocked 单元")

    blocked_refs = {row["coverage_id"] for row in coverage_rows if row["inference_allowed"] == "blocked"}
    if set(admission.get("blocked_coverage_refs", [])) != blocked_refs:
        fail("evidence_admission.blocked_coverage_refs 与 03 不一致")

    compliance = audit["compliance_check"]
    false_checks = sorted(key for key, value in compliance.items() if value is not True)
    if false_checks:
        fail(f"compliance_check 未通过：{false_checks}")

    return {
        "claims": len(claims),
        "decisive_uncertainties": len(decisive),
        "path_nodes": len(paths),
        "state_variables": len(variables),
        "coverage_units": len(coverage_rows),
        "evidence_records": len(evidence_rows),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", required=True, type=Path)
    parser.add_argument("--audit", required=True, type=Path)
    parser.add_argument("--view", required=True, type=Path)
    parser.add_argument("--snapshot", required=True, type=Path)
    args = parser.parse_args()
    result = validate(args.report, args.audit, args.view, args.snapshot)
    summary = ", ".join(f"{key}={value}" for key, value in result.items())
    print(f"04 outputs validation PASS: {summary}")


if __name__ == "__main__":
    main()
