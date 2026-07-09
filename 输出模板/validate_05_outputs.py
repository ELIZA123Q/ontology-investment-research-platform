#!/usr/bin/env python3
"""Validate 05 internal deep research report drafts."""

from __future__ import annotations

import re
import sys
from pathlib import Path

from quality_gate_utils import output_rank, validate_quality_status
from validator_utils import (
    assert_subset,
    error_payload,
    fail,
    load_yaml_file,
    ok_payload,
    parse_markdown,
    parse_triplet,
    read_csv,
    read_text,
    require_body_sections,
    require_keys,
    same_ref,
    split_refs,
)


ARCHETYPE_NAME_MAP = {
    "事件点评": "event_commentary",
    "行业动态点评": "industry_dynamic_commentary",
    "行业周期判断": "industry_cycle_report",
    "公司业绩点评": "company_earnings_commentary",
    "主题深度研究": "theme_deep_dive",
}

REQUIRED_REPORT_SECTIONS_BY_ARCHETYPE = {
    "event_commentary": [
        "一页摘要",
        "核心观点",
        "一、事件概述",
        "二、市场理解与预期差",
        "三、影响机制",
        "四、影响测算",
        "五、产业链与对象映射",
        "六、情景推演",
        "七、图表与关键数据",
        "八、改判信号与后续跟踪",
        "九、风险提示",
    ],
    "industry_dynamic_commentary": [
        "一页摘要",
        "核心观点",
        "一、最近发生了什么变化",
        "二、关键观察",
        "三、预期差",
        "四、数据验证",
        "五、产业链影响",
        "六、演进判断",
        "七、图表与关键数据",
        "八、改判信号与后续跟踪",
        "九、风险提示",
    ],
    "industry_cycle_report": [
        "一页摘要",
        "核心观点",
        "一、核心判断",
        "二、预期差",
        "三、主导机制",
        "四、证据推进",
        "五、强弱排序",
        "六、周期如何结束",
        "七、情景推演",
        "八、图表与关键数据",
        "九、改判信号与后续跟踪",
        "十、风险提示",
    ],
    "company_earnings_commentary": [
        "一页摘要",
        "核心观点",
        "一、业绩与指引概览",
        "二、超预期或低预期来自哪里",
        "三、分业务或分产品分析",
        "四、预测调整与核心假设",
        "五、估值或经营弹性讨论",
        "六、图表与关键数据",
        "七、后续验证与改判信号",
        "八、风险提示",
    ],
    "theme_deep_dive": [
        "一页摘要",
        "核心观点",
        "一、为什么现在研究这个主题",
        "二、空间测算",
        "三、产业链拆解",
        "四、竞争格局与壁垒",
        "五、演进路径",
        "六、图表与关键数据",
        "七、改判信号与后续跟踪",
        "八、风险提示",
    ],
}

REQUIRED_HANDOFF_FIELDS = [
    "target_05_archetype",
    "target_05_quality",
    "handoff_status",
    "output_ceiling",
    "formal_report_allowed",
    "report_title_candidates",
    "core_thesis_sentence",
    "one_page_summary_points",
    "section_plan",
    "market_common_view",
    "differentiated_view",
    "why_now",
    "misread_risks",
    "narrative_spine",
    "evidence_progression",
    "object_strength_ranking",
    "front_section_caveats",
    "approved_core_claims",
    "chart_candidates",
    "chart_package",
    "table_candidates",
    "table_package",
    "confidence_ceiling",
]

EXPRESSION_STRENGTH_RANK = {
    "insufficient_evidence": 0,
    "hypothesis": 1,
    "observation": 2,
    "medium_directional": 3,
    "strong_directional": 4,
}

HANDOFF_STRENGTH_TO_OUTPUT = {
    "hypothesis": "conditional_only",
    "observation": "conditional_only",
    "medium_directional": "directional_only",
    "strong_directional": "full_reasoning_ready",
}

FORBIDDEN_TERMS = ["目标价", "收益率预测", "仓位建议", "买入评级", "卖出评级", "买入建议", "卖出建议", "交易建议"]
FORBIDDEN_ID_RE = re.compile(r"\b(?:C|JU|EV|RI|DDC|SRC|SR)-[A-Za-z0-9_]+\b")
FORBIDDEN_BACKEND_TOKENS = [
    "claim_id",
    "judgment_unit_id",
    "evidence_id",
    "input_id",
    "source_id",
    "data_candidate_id",
    "display_data_candidate_id",
    "task_id",
    "execution_id",
    "delivery_id",
    "source_01_requirement_ref",
    "source_02_logic_ref",
    "source_02_view_ref",
    "source_03_preparation_ref",
    "source_03_snapshot_ref",
    "source_04_report_ref",
    "source_04_audit_ref",
    "handoff_to_05",
    "allowed_04_output",
    "quality_gate",
    "quality_status",
    "upstream_03_admission",
    "upstream_04_quality_status",
    "normal_pass",
    "restricted_pass",
    "incomplete_pass",
    "failed",
    "full_reasoning_ready",
    "directional_only",
    "conditional_only",
    "insufficient_evidence",
    "intended_message",
    "data_status",
]
RESTRICTION_PHRASES = ["不能确认", "不能外推", "只能", "不足以", "缺口", "限制", "不得", "尚未", "不等于"]


def _section_text(body: str, title: str) -> str:
    match = re.search(rf"^##\s+{re.escape(title)}(?:\s|：|$).*$", body, re.M)
    if not match:
        return ""
    next_match = re.search(r"^##\s+", body[match.end() :], re.M)
    end = match.end() + next_match.start() if next_match else len(body)
    return body[match.end() : end]


def _count_table_rows(section: str) -> int:
    rows = 0
    for line in section.splitlines():
        stripped = line.strip()
        if not stripped.startswith("|"):
            continue
        if "---" in stripped or "对象" in stripped or "字段" in stripped:
            continue
        if stripped.count("|") >= 3:
            rows += 1
    return rows


def _check_forbidden_terms(text: str) -> None:
    for term in FORBIDDEN_TERMS:
        for match in re.finditer(re.escape(term), text):
            context = text[max(0, match.start() - 60) : match.end() + 60]
            if (
                "不作为" in context
                or "不输出" in context
                or "不回答" in context
                or "不写入" in context
                or "不得" in context
                or "禁止" in context
                or "不构成" in context
            ):
                continue
            fail(f"05 正文不得包含投资建议或评级用语: {term}")


def _parse_05_triplet(report_path: Path) -> tuple[tuple[str, str, str], str]:
    errors: list[str] = []
    for kind, archetype in ARCHETYPE_NAME_MAP.items():
        try:
            return parse_triplet(report_path, kind, "05"), archetype
        except Exception as exc:  # keep trying other allowed report names
            errors.append(str(exc))
    allowed = " / ".join(ARCHETYPE_NAME_MAP)
    fail(f"{report_path.name} 文件名必须使用 05 输出原型名称之一: {allowed}")


def _load_01(requirement_path: Path) -> dict[str, object]:
    triplet = parse_triplet(requirement_path, "投研需求说明", "01")
    meta, _body = parse_markdown(requirement_path)
    if meta.get("document_type") != "judgment_task":
        fail("source_01_requirement_ref 必须指向 judgment_task")
    archetype = meta.get("delivery_archetype")
    if not isinstance(archetype, dict) or not archetype.get("primary"):
        fail("01 缺少 delivery_archetype.primary，05 不能临时选择输出原型")
    return {"triplet": triplet, "meta": meta}


FRONT_META_TABLE_MARKERS = [
    "判断时点",
    "数据截止日",
    "报告性质",
    "事件名称",
    "事件时间",
    "研究对象",
    "覆盖行业",
    "公司/标的",
    "主题名称",
    "财报期间",
    "观察窗口",
]


def _front_matter_before_summary(body: str) -> str:
    match = re.search(r"^##\s+一页摘要(?:\s|：|$).*$", body, re.M)
    if not match:
        return body
    return body[: match.start()]


def _has_front_meta_table(front: str) -> bool:
    table_blocks = re.findall(r"(?:^\|.+\|\s*$)+", front, re.M)
    for block in table_blocks:
        if any(marker in block for marker in FRONT_META_TABLE_MARKERS):
            return True
    return False


def _title_looks_like_topic_only(front: str) -> bool:
    lines = [line.strip() for line in front.splitlines() if line.strip()]
    if not lines or not lines[0].startswith("# "):
        return False
    title = lines[0][2:].strip()
    weak_suffixes = ("研究", "分析", "报告", "点评", "概述", "说明")
    judgment_markers = ("不是", "而是", "应", "不应", "需要", "主要", "关键", "驱动", "约束", "延续", "转向", "分化", "受益", "承压", "误读", "更")
    if any(marker in title for marker in judgment_markers):
        return False
    return title.endswith(weak_suffixes) or len(title) <= 12


def _validate_report_text(report_path: Path, archetype: str) -> str:
    body = read_text(report_path)
    if body.startswith("---\n"):
        fail("05 研报正文不得使用 YAML front matter")
    if "附录：内部追溯" in body or "系统留痕" in body or "A0. 后台元数据" in body:
        fail("05 不再包含系统留痕或内部追溯附录；追溯由 04 审计承担")
    require_body_sections(body, REQUIRED_REPORT_SECTIONS_BY_ARCHETYPE[archetype], str(report_path))
    front = _front_matter_before_summary(body)
    if _has_front_meta_table(front):
        fail("05 一页摘要前不得放置判断时点/数据截止日等元信息表，应移到文末口径说明")
    if _title_looks_like_topic_only(front):
        fail("05 标题应是判断句，不能只是主题名或“xxx分析/研究/报告”")
    id_matches = sorted(set(FORBIDDEN_ID_RE.findall(body)))
    if id_matches:
        fail(f"05 正文不得出现本体/审计/证据编号: {', '.join(id_matches[:10])}")
    for token in FORBIDDEN_BACKEND_TOKENS:
        if re.search(rf"\b{re.escape(token)}\b", body):
            fail(f"05 正文不得出现后台字段或质量门槛字段: {token}")
    _check_forbidden_terms(body)
    summary_and_views = _section_text(body, "一页摘要") + _section_text(body, "核心观点")
    restriction_count = sum(summary_and_views.count(phrase) for phrase in RESTRICTION_PHRASES)
    if restriction_count > 6:
        fail("05 摘要和核心观点中限制性表达过度前置，应集中到改判信号和风险提示")
    ranking_section = ""
    if archetype == "industry_cycle_report":
        ranking_section = _section_text(body, "五、强弱排序")
    if ranking_section:
        ranking_rows = _count_table_rows(ranking_section)
        if ranking_rows < 3:
            fail("05 强弱排序章节至少需要 3 个排序对象，除非上游明确对象少于 3 个")
    return body


def _load_04(audit_path: Path) -> dict[str, object]:
    audit = load_yaml_file(audit_path)
    if not isinstance(audit, dict):
        fail("04 审计必须是 YAML 对象")
    require_keys(audit, ["metadata", "claim_register", "handoff_to_05", "compliance_check"], str(audit_path))
    if audit.get("document_type") != "reasoning_audit":
        fail("source_04_audit_ref 必须指向 reasoning_audit")
    validate_quality_status(audit["metadata"]["quality_status"], str(audit_path))
    return audit


def _snapshot_rows(
    snapshot_dir: Path,
) -> tuple[
    dict[str, str],
    list[dict[str, str]],
    list[dict[str, str]],
    list[dict[str, str]],
    list[dict[str, str]],
    dict[str, set[str]],
]:
    manifest_rows = read_csv(snapshot_dir / "manifest.csv")
    if len(manifest_rows) != 1:
        fail("03 manifest.csv 必须且只能有一行")
    rows = {
        "source_snapshot.csv": read_csv(snapshot_dir / "source_snapshot.csv"),
        "reasoning_inputs.csv": read_csv(snapshot_dir / "reasoning_inputs.csv"),
        "evidence_records.csv": read_csv(snapshot_dir / "evidence_records.csv"),
        "judgment_unit_readiness.csv": read_csv(snapshot_dir / "judgment_unit_readiness.csv"),
        "evidence_readiness_assessments.csv": read_csv(snapshot_dir / "evidence_readiness_assessments.csv"),
        "display_data_candidates.csv": read_csv(snapshot_dir / "display_data_candidates.csv"),
        "chart_data_package.csv": read_csv(snapshot_dir / "chart_data_package.csv"),
        "table_material_package.csv": read_csv(snapshot_dir / "table_material_package.csv"),
        "source_annotation_package.csv": read_csv(snapshot_dir / "source_annotation_package.csv"),
    }
    sets = {
        "source_ids": {row["source_id"] for row in rows["source_snapshot.csv"] if row.get("source_id")},
        "input_ids": {row["input_id"] for row in rows["reasoning_inputs.csv"] if row.get("input_id")},
        "evidence_ids": {row["evidence_id"] for row in rows["evidence_records.csv"] if row.get("evidence_id")},
        "judgment_unit_ids": {row["judgment_unit_id"] for row in rows["judgment_unit_readiness.csv"] if row.get("judgment_unit_id")},
        "readiness_assessment_ids": {row["assessment_id"] for row in rows["evidence_readiness_assessments.csv"] if row.get("assessment_id")},
        "readiness_judgment_unit_ids": {row["target_judgment_unit_id"] for row in rows["evidence_readiness_assessments.csv"] if row.get("target_judgment_unit_id")},
        "data_candidate_ids": {row["data_candidate_id"] for row in rows["display_data_candidates.csv"] if row.get("data_candidate_id")},
        "chart_ids": {row["figure_id"] for row in rows["chart_data_package.csv"] if row.get("figure_id")},
        "table_ids": {row["table_id"] for row in rows["table_material_package.csv"] if row.get("table_id")},
        "source_annotation_ids": {row["annotation_id"] for row in rows["source_annotation_package.csv"] if row.get("annotation_id")},
    }
    return (
        manifest_rows[0],
        rows["display_data_candidates.csv"],
        rows["chart_data_package.csv"],
        rows["table_material_package.csv"],
        rows["source_annotation_package.csv"],
        sets,
    )


def _validate_handoff(audit: dict[str, object], sets: dict[str, set[str]], archetype: str) -> None:
    handoff = audit["handoff_to_05"]
    require_keys(handoff, REQUIRED_HANDOFF_FIELDS, "handoff_to_05")
    if handoff.get("target_05_archetype") != archetype:
        fail(f"handoff_to_05.target_05_archetype 与 05 文件原型不一致: {handoff.get('target_05_archetype')} vs {archetype}")
    if handoff.get("output_ceiling") == "gap_report_only":
        fail("04 handoff 仅允许 gap_report_only，05 不得生成完整研报稿")
    if handoff.get("handoff_status") == "not_ready":
        fail("04 handoff_status 为 not_ready，05 不得生成完整研报稿")
    if not handoff.get("formal_report_allowed"):
        fail("04 未允许生成正式内部研报稿")
    for field in ["market_common_view", "differentiated_view", "why_now", "narrative_spine"]:
        if not str(handoff.get(field, "")).strip():
            fail(f"handoff_to_05.{field} 不得为空，05 预期差必须来自上游")
    if not str(handoff.get("core_thesis_sentence", "")).strip():
        fail("handoff_to_05.core_thesis_sentence 不得为空")
    for field in ["misread_risks", "evidence_progression", "object_strength_ranking"]:
        if not isinstance(handoff.get(field), list) or not handoff[field]:
            fail(f"handoff_to_05.{field} 必须是非空列表")
    if len(handoff["object_strength_ranking"]) < 3:
        fail("handoff_to_05.object_strength_ranking 至少需要 3 个对象，除非上游明确对象少于 3 个")

    claim_ids = {str(row.get("claim_id", "")).strip() for row in audit["claim_register"] if row.get("claim_id")}
    approved_claim_ids = {str(row.get("claim_id", "")).strip() for row in handoff.get("approved_core_claims", []) if row.get("claim_id")}
    if not approved_claim_ids:
        fail("04 未批准任何核心判断时，05 不得生成高质量方向性研报")
    assert_subset(approved_claim_ids, claim_ids, "handoff_to_05.approved_core_claims.claim_id")

    for row in handoff["approved_core_claims"]:
        require_keys(
            row,
            ["claim_id", "expression_strength", "source_judgment_units", "readiness_assessment_refs", "evidence_anchors"],
            "handoff_to_05.approved_core_claims[]",
        )
        strength = str(row.get("expression_strength", ""))
        if strength not in EXPRESSION_STRENGTH_RANK:
            fail(f"handoff_to_05.approved_core_claims#{row.get('claim_id')}.expression_strength 非法")
        assert_subset(split_refs(row.get("source_judgment_units")), sets["judgment_unit_ids"], f"handoff_to_05.approved_core_claims#{row.get('claim_id')}.source_judgment_units")
        assert_subset(split_refs(row.get("source_judgment_units")), sets["readiness_judgment_unit_ids"], f"handoff_to_05.approved_core_claims#{row.get('claim_id')}.source_judgment_units.readiness")
        assert_subset(split_refs(row.get("readiness_assessment_refs")), sets["readiness_assessment_ids"], f"handoff_to_05.approved_core_claims#{row.get('claim_id')}.readiness_assessment_refs")
        assert_subset(split_refs(row.get("evidence_anchors")), sets["evidence_ids"], f"handoff_to_05.approved_core_claims#{row.get('claim_id')}.evidence_anchors")

    for row in handoff["chart_candidates"]:
        assert_subset(split_refs(row.get("source_data_candidate_ids")), sets["data_candidate_ids"], "handoff_to_05.chart_candidates.source_data_candidate_ids")
        assert_subset(split_refs(row.get("source_evidence_ids")), sets["evidence_ids"], "handoff_to_05.chart_candidates.source_evidence_ids")
    for row in handoff["table_candidates"]:
        assert_subset(split_refs(row.get("source_data_candidate_ids")), sets["data_candidate_ids"], "handoff_to_05.table_candidates.source_data_candidate_ids")
        assert_subset(split_refs(row.get("source_evidence_ids")), sets["evidence_ids"], "handoff_to_05.table_candidates.source_evidence_ids")
    for row in handoff["chart_package"]:
        if str(row.get("figure_id", "")).strip() not in sets["chart_ids"]:
            fail(f"handoff_to_05.chart_package 引用了不存在的 figure_id: {row.get('figure_id')}")
        assert_subset(split_refs(row.get("data_candidate_ids")), sets["data_candidate_ids"], "handoff_to_05.chart_package.data_candidate_ids")
        assert_subset(split_refs(row.get("source_ids")), sets["source_ids"], "handoff_to_05.chart_package.source_ids")
    for row in handoff["table_package"]:
        if str(row.get("table_id", "")).strip() not in sets["table_ids"]:
            fail(f"handoff_to_05.table_package 引用了不存在的 table_id: {row.get('table_id')}")
        assert_subset(split_refs(row.get("source_data_candidate_ids")), sets["data_candidate_ids"], "handoff_to_05.table_package.source_data_candidate_ids")
        assert_subset(split_refs(row.get("source_evidence_ids")), sets["evidence_ids"], "handoff_to_05.table_package.source_evidence_ids")


def _validate_strength(audit: dict[str, object], manifest: dict[str, str]) -> None:
    if not same_ref(audit["metadata"]["task_id"], manifest["task_id"]):
        fail("task_id 在 04/03 中必须一致")
    if not same_ref(audit["metadata"]["execution_id"], manifest["execution_id"]):
        fail("execution_id 在 04/03 中必须一致")
    if audit["metadata"]["quality_status"] != "high_quality_pass":
        fail("05 高质量通过要求 04 也为 high_quality_pass")
    handoff = audit["handoff_to_05"]
    max_allowed_output = "insufficient"
    for claim in handoff.get("approved_core_claims", []):
        candidate = HANDOFF_STRENGTH_TO_OUTPUT.get(str(claim.get("expression_strength", "")), "insufficient")
        if output_rank(candidate) > output_rank(max_allowed_output):
            max_allowed_output = candidate
    if output_rank(max_allowed_output) < output_rank("directional_only"):
        fail("05 高质量研报至少需要 04 批准方向性或更强判断")


def _high_quality_data_gate(
    display_rows: list[dict[str, str]],
    chart_rows: list[dict[str, str]],
    table_rows: list[dict[str, str]],
    archetype: str,
) -> tuple[bool, str]:
    ready = [
        row
        for row in display_rows
        if row.get("chart_readiness") == "ready" and row.get("report_grade_status") == "report_grade_ready"
    ]
    quant_ready = [
        row
        for row in display_rows
        if row.get("visual_role") == "quant_chart"
        and row.get("quantitative_or_qualitative") == "quantitative"
        and row.get("chart_readiness") == "ready"
        and row.get("report_grade_status") == "report_grade_ready"
    ]
    ranking_ready = [
        row
        for row in display_rows
        if row.get("visual_role") == "ranking_table"
        and row.get("ranking_support") == "strong"
        and row.get("report_grade_status") == "report_grade_ready"
    ]
    table_ready = [
        row
        for row in ready
        if row.get("visual_role") in {"supporting_table", "qualitative_table", "ranking_table"}
    ]
    report_grade_charts = [
        row
        for row in chart_rows
        if row.get("chart_readiness") == "ready" and row.get("report_grade_status") == "report_grade_ready"
    ]
    report_grade_ranking_tables = [
        row
        for row in table_rows
        if row.get("table_role") == "ranking" and row.get("readiness") == "ready" and row.get("ranking_support") == "strong"
    ]
    timeline_ready = [row for row in ready if row.get("visual_role") == "event_timeline"]
    summary = (
        f"quant_charts={len(quant_ready)};"
        f"report_grade_charts={len(report_grade_charts)};"
        f"ranking_tables={len(ranking_ready)};"
        f"report_grade_ranking_tables={len(report_grade_ranking_tables)};"
        f"ready_display={len(ready)}"
    )

    if archetype == "industry_cycle_report":
        if len(quant_ready) >= 2 and len(report_grade_charts) >= 2:
            return True, summary
        if len(quant_ready) >= 1 and ranking_ready and report_grade_ranking_tables:
            return True, summary
        return False, summary
    if archetype == "event_commentary":
        return (len(quant_ready) + len(table_ready) + len(timeline_ready) >= 1), summary
    if archetype == "industry_dynamic_commentary":
        return len(ready) >= 3, summary
    if archetype == "company_earnings_commentary":
        return len(ready) >= 3, summary
    if archetype == "theme_deep_dive":
        return len(quant_ready) >= 1 and len(ready) >= 3, summary
    return False, summary


def _validate_01_archetype(requirement: dict[str, object], report_triplet: tuple[str, str, str], archetype: str) -> None:
    if requirement["triplet"] != report_triplet:
        fail("05 内容稿与 01 需求说明文件名核心主题、日期、序号必须一致")
    meta = requirement["meta"]
    delivery_archetype = meta["delivery_archetype"]
    if delivery_archetype["primary"] != archetype:
        fail(f"05 输出原型与 01 不一致: 01={delivery_archetype['primary']}, 05={archetype}")


def validate(
    report_path: str | Path,
    requirement_path: str | Path,
    audit_path: str | Path,
    snapshot_dir: str | Path,
    allow_minimum: bool = False,
) -> dict[str, object]:
    report_path = Path(report_path)
    requirement_path = Path(requirement_path)
    audit_path = Path(audit_path)
    snapshot_dir = Path(snapshot_dir)
    report_triplet, archetype = _parse_05_triplet(report_path)
    requirement = _load_01(requirement_path)
    audit_triplet = parse_triplet(audit_path, "推理审计", "04")
    snapshot_triplet = parse_triplet(snapshot_dir, "数据与证据快照", "03")
    _validate_01_archetype(requirement, report_triplet, archetype)
    if report_triplet != audit_triplet or report_triplet != snapshot_triplet:
        fail("05 内容稿、04 审计与 03 快照文件名核心主题、日期、序号必须一致")
    if not snapshot_dir.is_dir():
        fail(f"{snapshot_dir} 不是快照目录")

    _validate_report_text(report_path, archetype)
    audit = _load_04(audit_path)
    manifest, display_rows, chart_rows, table_rows, _annotation_rows, sets = _snapshot_rows(snapshot_dir)
    _validate_strength(audit, manifest)
    _validate_handoff(audit, sets, archetype)
    data_ok, data_summary = _high_quality_data_gate(display_rows, chart_rows, table_rows, archetype)
    if not data_ok and not allow_minimum:
        fail("05 high_quality_pass 图表/表格数据密度不足；当前 " + data_summary)
    return {
        "schema_version": "1.0.0",
        "task_id": audit["metadata"]["task_id"],
        "execution_id": audit["metadata"]["execution_id"],
        "archetype": archetype,
        "quality_status": "high_quality_pass" if data_ok else "minimum_pass",
        "display_data_gate": data_summary,
    }


def main(argv: list[str]) -> int:
    if len(argv) not in {5, 6}:
        print("usage: validate_05_outputs.py <05研报.md> <01需求说明.md> <04推理审计.yaml> <03数据与证据快照目录> [--allow-minimum]")
        return 2
    allow_minimum = len(argv) == 6 and argv[5] == "--allow-minimum"
    if len(argv) == 6 and not allow_minimum:
        print("usage: validate_05_outputs.py <05研报.md> <01需求说明.md> <04推理审计.yaml> <03数据与证据快照目录> [--allow-minimum]")
        return 2
    try:
        print(ok_payload(**validate(argv[1], argv[2], argv[3], argv[4], allow_minimum=allow_minimum)))
        return 0
    except Exception as exc:
        print(error_payload(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
