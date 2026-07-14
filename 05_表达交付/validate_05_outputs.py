#!/usr/bin/env python3
"""Validate 05 publishable deliverables against the theme-deep-research template contract."""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "运行校验"))
from _path_setup import ensure_run_path  # noqa: E402

ensure_run_path()

from quality_gate_utils import (  # noqa: E402
    validate_gate_review_fields,
    validate_quality_status,
    validate_researcher_body,
    validate_stage_status,
)
from validator_utils import (  # noqa: E402
    error_payload,
    fail,
    file_sha256,
    file_name,
    load_yaml_file,
    ok_payload,
    parse_triplet,
    read_text,
    require_body_sections,
    require_keys,
    require_mapping,
    require_schema_version,
    same_ref,
    split_refs,
)
from status_derivation import reject_manual_derived_fields  # noqa: E402

KNOWN_DELIVERY_KINDS = {
    "事件点评",
    "行业动态点评",
    "行业周期判断",
    "公司业绩点评",
    "主题深度研究",
}

ARCHETYPE_NAME_MAP = {
    "事件点评": "event_commentary",
    "行业动态点评": "industry_dynamic_commentary",
    "行业周期判断": "industry_cycle_report",
    "公司业绩点评": "company_earnings_commentary",
    "主题深度研究": "theme_deep_dive",
}

REQUIRED_HEADER_FIELDS = [
    "判断时点",
    "前瞻窗口",
    "研究对象",
    "研究范围",
]

REQUIRED_FIXED_SECTIONS = [
    "投资要点",
    "核心结论概览",
    "市场认知差 / Research Edge",
    "投资含义与重点观察",
    "催化、验证与风险",
    "主要资料来源",
]

REQUIRED_TAIL_MARKERS = [
    "未来重点观察",
    "主要风险",
]

ARGUMENT_CHAPTER_PATTERN = re.compile(r"^##\s+[一二三四五]、", re.MULTILINE)

MIN_ARGUMENT_CHAPTERS = 2
MAX_ARGUMENT_CHAPTERS = 5

FORBIDDEN_HEADER_FIELDS = [
    "事件口径",
]

FORBIDDEN_SECTION_NAMES = [
    "一页摘要",
    "核心观点",
    "关键跟踪指标",
]

FORBIDDEN_BODY_TERMS = [
    "证据门禁",
    "包级准入",
    "allowed_04_output",
    "judgment_unit",
    "state_variable",
    "path_readiness",
    "manifest.csv",
    "推理审计",
    "本体视图",
    "倾向判断：",
    "条件判断：",
    "已确认：",
    "暂不可判断：",
    "判断单元",
    "状态变量",
    "路径节点",
]

DISCLAIMER_MARKERS = ("不构成", "证券评级", "交易操作")
LOCATION_KINDS = {
    "report_title",
    "subtitle",
    "investment_point",
    "conclusion_overview",
    "section_heading",
    "paragraph_lead",
    "chart_title",
    "table_title",
    "summary_conclusion",
}


def _header_text(body: str) -> str:
    for section in REQUIRED_FIXED_SECTIONS:
        marker = f"## {section}"
        if marker in body:
            return body.split(marker, 1)[0]
    return body.split("##", 1)[0]


def _count_argument_chapters(body: str) -> int:
    return len(ARGUMENT_CHAPTER_PATTERN.findall(body))


def _validate_body(path: Path, body: str) -> None:
    header = _header_text(body)
    for field in REQUIRED_HEADER_FIELDS:
        if field not in header:
            fail(f"{path} 文首必须说明 {field}")
    for field in FORBIDDEN_HEADER_FIELDS:
        if field in header:
            fail(f"{path} 文首应使用「研究范围」，不得使用「{field}」")

    require_body_sections(body, REQUIRED_FIXED_SECTIONS, str(path))
    for marker in REQUIRED_TAIL_MARKERS:
        if marker not in body:
            fail(f"{path} 缺少尾部小节: {marker}")
    for section in FORBIDDEN_SECTION_NAMES:
        if section in body:
            fail(f"{path} 不得使用已废止的 05 章节名: {section}")

    chapter_count = _count_argument_chapters(body)
    if chapter_count < MIN_ARGUMENT_CHAPTERS:
        fail(
            f"{path} 正文核心论点章节不足: 需要至少 {MIN_ARGUMENT_CHAPTERS} 个「## 一、」至「## 五、」章节，当前 {chapter_count} 个"
        )
    if chapter_count > MAX_ARGUMENT_CHAPTERS:
        fail(
            f"{path} 正文核心论点章节过多: 最多 {MAX_ARGUMENT_CHAPTERS} 个「## 一、」至「## 五、」章节，当前 {chapter_count} 个"
        )

    validate_researcher_body(body, str(path))
    if not any(marker in body for marker in DISCLAIMER_MARKERS):
        fail(f"{path} 文末必须包含合规声明（不构成证券评级/收益承诺/交易操作建议）")
    for term in FORBIDDEN_BODY_TERMS:
        if term in body:
            fail(f"05 正文不得包含系统术语: {term}")
    forbidden = ["目标价", "买入评级", "卖出评级", "仓位建议", "收益率预测"]
    for marker in forbidden:
        for match in re.finditer(re.escape(marker), body):
            context = body[max(0, match.start() - 30) : match.end() + 12]
            if "不构成" in context or "不得" in context or "不输出" in context:
                continue
            fail(f"05 正文不得包含投资建议或评级用语: {marker}")


def _validate_expression_audit(
    path: Path,
    body: str,
    expression_audit_path: Path,
    source_04_audit_path: Path,
) -> dict[str, object]:
    audit = load_yaml_file(expression_audit_path)
    source_audit = load_yaml_file(source_04_audit_path)
    if not isinstance(audit, dict) or not isinstance(source_audit, dict):
        fail("05 表达审计和 04 推理审计必须是 YAML 对象")
    try:
        reject_manual_derived_fields(audit, "05.audit")
    except ValueError as exc:
        fail(str(exc))
    require_keys(audit, ["document_type", "schema_version", "metadata", "claim_expression_register", "research_edge_check", "high_risk_section_coverage", "overall_check"], str(expression_audit_path))
    require_schema_version(audit["schema_version"], str(expression_audit_path), expected="2.3.0")
    if audit["document_type"] != "delivery_expression_audit" or str(audit["schema_version"]) != "2.3.0":
        fail("05 表达审计必须使用 delivery_expression_audit / 2.3.0")
    metadata = audit["metadata"]
    require_keys(metadata, ["task_id", "execution_id", "delivery_ref", "delivery_content_hash", "source_04_brief_ref", "source_04_audit_ref", "source_04_audit_hash", "stage_status", "quality_status", "quality_gate_ref", "deterministic_check_status", "semantic_review_status"], "05 audit.metadata")
    validate_stage_status(metadata["stage_status"], "05 audit.metadata")
    validate_quality_status(metadata["quality_status"], "05 audit.metadata")
    validate_gate_review_fields(metadata, "05 audit.metadata")
    if not same_ref(metadata["delivery_ref"], file_name(path)):
        fail("05 audit.metadata.delivery_ref 必须指向配对交付物")
    if not same_ref(metadata["source_04_audit_ref"], file_name(source_04_audit_path)):
        fail("05 audit.metadata.source_04_audit_ref 必须指向 04 推理审计")
    if metadata["delivery_content_hash"] != file_sha256(path):
        fail("05 audit.metadata.delivery_content_hash 与当前 05 正文不一致")
    if metadata["source_04_audit_hash"] != file_sha256(source_04_audit_path):
        fail("05 audit.metadata.source_04_audit_hash 与当前 04 推理审计不一致")
    edge_check = require_mapping(audit["research_edge_check"], "research_edge_check")
    for key in [
        "reference_view_present",
        "differentiated_claim_mapped_to_04",
        "underappreciated_mechanism_supported",
        "falsification_signal_observable",
        "evidence_boundary_disclosed",
        "no_fabricated_consensus",
    ]:
        if edge_check.get(key) is not True:
            fail(f"research_edge_check.{key} 必须为 true")
    if edge_check.get("result") != "pass":
        fail("research_edge_check.result 必须为 pass")

    source_metadata = source_audit.get("metadata", {})
    if not same_ref(metadata["source_04_brief_ref"], source_metadata.get("brief_ref")):
        fail("05 audit.metadata.source_04_brief_ref 必须与 04 审计 brief_ref 一致")
    for field in ["task_id", "execution_id"]:
        if not same_ref(metadata[field], source_metadata.get(field)):
            fail(f"05/04 audit {field} 必须一致")
    if source_metadata.get("stage_status") != "complete":
        fail("05 只能继承 stage_status=complete 的 04 审计")
    source_claims = {
        str(item["claim_id"]): item
        for item in source_audit.get("claim_register", [])
        if isinstance(item, dict) and item.get("claim_id")
    }
    handoff = source_audit.get("handoff_to_05")
    if not isinstance(handoff, dict):
        fail("04 推理审计必须提供 handoff_to_05 表达权限")
    approved_permissions = {
        str(item.get("claim_id")): item
        for item in handoff.get("approved_core_claims", [])
        if isinstance(item, dict) and item.get("claim_id")
    }
    restricted_permissions = {
        str(item.get("claim_id")): item
        for item in handoff.get("restricted_claims", [])
        if isinstance(item, dict) and item.get("claim_id")
    }
    prohibited_claim_ids = {
        str(item.get("claim_id_or_topic"))
        for item in handoff.get("prohibited_claims", [])
        if isinstance(item, dict) and str(item.get("claim_id_or_topic", "")) in source_claims
    }
    permitted_claim_ids = set(approved_permissions) | set(restricted_permissions)
    if handoff.get("formal_report_allowed") is not True:
        fail("04 handoff_to_05 未允许形成正式研究稿")
    expressions = audit["claim_expression_register"]
    if not isinstance(expressions, list) or not expressions:
        fail("claim_expression_register 至少需要一项")
    title_match = re.search(r"^#\s+(.+)$", body, re.MULTILINE)
    report_title = title_match.group(1).strip() if title_match else ""
    title_registered = False
    for item in expressions:
        require_keys(item, ["expression_id", "source_claim_id", "location_kind", "section", "expression_text", "conditions", "conditions_preserved", "scope_relation", "semantic_strength_review"], "claim_expression_register[]")
        label = f"claim_expression_register#{item['expression_id']}"
        claim_id = str(item["source_claim_id"])
        if claim_id not in source_claims:
            fail(f"{label}.source_claim_id 未在 04 claim_register 中定义")
        if claim_id in prohibited_claim_ids:
            fail(f"{label}.source_claim_id 已被 04 明确禁止表达")
        if claim_id not in permitted_claim_ids:
            fail(f"{label}.source_claim_id 未获得 04 handoff_to_05 表达许可")
        source_claim = source_claims[claim_id]
        if item["location_kind"] not in LOCATION_KINDS:
            fail(f"{label}.location_kind 非法")
        expression_text = str(item["expression_text"]).strip()
        if not expression_text or expression_text not in body:
            fail(f"{label}.expression_text 必须可在 05 正文中精确定位")
        if item["location_kind"] == "report_title" and expression_text == report_title:
            title_registered = True
        if item["location_kind"] == "report_title" and claim_id not in approved_permissions:
            fail(f"{label}: 受限观点不得用于 05 主标题")
        if set(split_refs(item["conditions"])) != set(split_refs(source_claim.get("conditions"))):
            fail(f"{label}.conditions 必须完整继承 04")
        if item["conditions_preserved"] is not True:
            fail(f"{label}.conditions_preserved 必须为 true")
        if item["scope_relation"] not in {"same", "narrower"}:
            fail(f"{label}.scope_relation 只能是 same 或 narrower")
        if item["semantic_strength_review"] != "pass":
            fail(f"{label}.semantic_strength_review 必须为 pass")
    if not title_registered:
        fail("05 主标题必须登记到 claim_expression_register")

    def section_text(section_name: str) -> str:
        marker = f"## {section_name}"
        if marker not in body:
            return ""
        remainder = body.split(marker, 1)[1]
        return remainder.split("\n## ", 1)[0]

    def require_registered_fragments(
        fragments: list[str],
        *,
        location_kind: str,
        label: str,
    ) -> None:
        registered = [
            str(item["expression_text"]).strip()
            for item in expressions
            if item.get("location_kind") == location_kind
        ]
        for fragment in fragments:
            if not any(text and text in fragment for text in registered):
                fail(f"{label} 未逐条登记到 claim_expression_register: {fragment}")

    investment_lines = [
        line.strip()
        for line in section_text("投资要点").splitlines()
        if re.match(r"^-\s+\*\*.+?\*\*", line.strip())
    ]
    require_registered_fragments(
        investment_lines,
        location_kind="investment_point",
        label="05 投资要点",
    )

    overview_rows: list[str] = []
    for line in section_text("核心结论概览").splitlines():
        stripped = line.strip()
        if not stripped.startswith("|") or "---" in stripped:
            continue
        cells = [cell.strip() for cell in stripped.strip("|").split("|")]
        if len(cells) >= 2 and cells[0] != "项目":
            overview_rows.append(cells[1])
    require_registered_fragments(
        overview_rows,
        location_kind="conclusion_overview",
        label="05 核心结论概览",
    )

    argument_headings = [
        match.group(1).strip()
        for match in re.finditer(r"^##\s+[一二三四五]、(.+)$", body, re.MULTILINE)
    ]
    require_registered_fragments(
        argument_headings,
        location_kind="section_heading",
        label="05 论点章节标题",
    )

    coverage = audit["high_risk_section_coverage"]
    for key in ["report_title", "investment_points", "conclusion_overview", "section_headings", "paragraph_leads", "chart_and_table_titles", "summary_conclusions"]:
        if coverage.get(key) is not True:
            fail(f"high_risk_section_coverage.{key} 必须为 true")
    overall = audit["overall_check"]
    for key in ["all_expressions_mapped_to_04_claims", "no_expression_level_upgrade", "no_condition_loss", "no_scope_expansion", "no_status_washing", "semantic_review_complete"]:
        if overall.get(key) is not True:
            fail(f"overall_check.{key} 必须为 true")
    if overall.get("result") != "pass":
        fail("overall_check.result 必须为 pass")
    return {"expressions": len(expressions), "task_id": metadata["task_id"], "execution_id": metadata["execution_id"], "quality_status": metadata["quality_status"]}


def validate(
    path: str | Path,
    delivery_kind: str,
    expression_audit_path: str | Path,
    source_04_audit_path: str | Path,
) -> dict[str, object]:
    path = Path(path)
    expression_audit_path = Path(expression_audit_path)
    source_04_audit_path = Path(source_04_audit_path)
    if delivery_kind not in KNOWN_DELIVERY_KINDS:
        fail(f"未知 05 交付形态: {delivery_kind}")
    topic, date, seq = parse_triplet(path, delivery_kind, stage="05")
    body = read_text(path)
    if body.startswith("---"):
        fail(f"{path} 05 交付物不使用 YAML front matter，正文应从标题开始")
    _validate_body(path, body)
    audit_triplet = parse_triplet(expression_audit_path, "表达审计", stage="05")
    if audit_triplet != (topic, date, seq):
        fail("05 交付物与表达审计的主题、日期、序号必须一致")
    audit_result = _validate_expression_audit(path, body, expression_audit_path, source_04_audit_path)
    return {
        "schema_version": "2.3.0",
        "delivery_kind": delivery_kind,
        "topic": topic,
        "date": date,
        "seq": seq,
        "path": str(path),
        "argument_chapters": _count_argument_chapters(body),
        "expressions": audit_result["expressions"],
        "quality_status": audit_result["quality_status"],
    }


def main(argv: list[str]) -> int:
    if len(argv) != 5:
        print("usage: validate_05_outputs.py <05交付文件.md> <交付形态> <05表达审计.yaml> <04推理审计.yaml>")
        return 2
    try:
        print(ok_payload(**validate(argv[1], argv[2], argv[3], argv[4])))
        return 0
    except Exception as exc:
        print(error_payload(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
