#!/usr/bin/env python3
"""Validate 05 publishable deliverables against the theme-deep-research template contract."""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "05_control_evaluation" / "04_verifiers"))
from repo_paths import ensure_run_path  # noqa: E402

ensure_run_path()

from quality_gate_utils import (  # noqa: E402
    HIGH_VISIBILITY_EXPRESSION_LOCATIONS,
    assert_no_audit_register_voice,
    judgment_level_rank,
    validate_gate_review_fields,
    validate_judgment_level,
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
    require_keys,
    require_mapping,
    require_schema_version,
    same_ref,
    split_refs,
)
from status_derivation import reject_manual_derived_fields  # noqa: E402
from research_contract import derive_scope_relation, validate_scope_graph  # noqa: E402
from validate_method_application_contract import validate_expression_projection  # noqa: E402

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

# 内容功能检查（不是精确章节标题匹配）
# 每项是一个 (关键词, 功能说明)，报告需覆盖这些内容功能
REQUIRED_CONTENT_FUNCTIONS = [
    ("投资要点|核心结论|结论概览|核心观点|摘要", "报告开头需有结论摘要"),
    ("市场认知差|Research Edge|差异化|增量", "需说明差异化判断与研究增量"),
    ("风险|验证|催化", "尾部需讨论风险与验证要素"),
    ("来源|资料来源|参考", "需列明资料来源"),
]

# 论点章节：仅计「## 一、… 五、」编号章（与 runtime stage05_quality.ts 口径一致）。
# 固定节（投资要点/核心结论概览/Research Edge 等）与尾节不计入论点章。
MIN_ARGUMENT_CHAPTERS = 2
MAX_ARGUMENT_CHAPTERS = 5

# 仅禁止系统内部字段泄露到研究员可见正文
FORBIDDEN_BODY_TERMS = [
    "evidence_bundle",
    "judgment_unit",
    "state_variable",
    "path_readiness",
    "manifest.csv",
    "method_application",
    "judgment_method_routes",
    "judgment_threshold_caps",
    "formal_ontology_rules",
]

# 合规声明：检查文末是否包含免责声明语义，不再强制特定关键词组合
DISCLAIMER_PATTERN = re.compile(
    r"(不构成.*(?:投资|证券|交易|评级).*建议|本报告.*(?:内部|研究|讨论).*不构成|仅供参考.*不构成)",
    re.DOTALL,
)
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

EXPRESSION_AUDIT_SCHEMA_VERSION = "3.0.0"
EXPRESSION_REQUIRED_FIELDS = [
    "expression_id",
    "source_rcs",
    "location_kind",
    "expression_text",
    "inherited_judgment_level",
    "permitted_role",
    "conditions",
]
ROLE_ALLOWED_LOCATIONS = {
    "core_thesis": LOCATION_KINDS,
    "supporting_thesis": LOCATION_KINDS - {"report_title"},
    "risk": LOCATION_KINDS - {"report_title"},
    "observation": LOCATION_KINDS - {"report_title"},
    "scenario_condition": LOCATION_KINDS - {"report_title"},
}
# 低等级判断正文不得使用绝对化措辞，防止表达强度静默升级。
STRENGTH_UPGRADE_MARKERS = {
    "J0": (
        "必然",
        "毫无疑问",
        "已成定局",
        "板上钉钉",
        "已经确认",
        "确定见顶",
        "确定见底",
        "确定结束",
        "已经见顶",
        "已经见底",
    ),
    "J1": (
        "必然",
        "毫无疑问",
        "已成定局",
        "板上钉钉",
        "已经确认",
    ),
}


def _header_text(body: str) -> str:
    """取第一个 ## 之前的内容作为文首。"""
    first_h2 = re.search(r"^##\s+", body, re.MULTILINE)
    if first_h2:
        return body[: first_h2.start()]
    return body


def _count_argument_chapters(body: str) -> int:
    """计数论点章节数：仅「## 一、… 五、」编号章（与 runtime 口径一致）。"""
    return len(re.findall(r"^##\s+[一二三四五]、", body, re.MULTILINE))


def _check_content_functions(body: str) -> None:
    """检查内容功能覆盖，不要求精确章节标题匹配。"""
    for pattern, description in REQUIRED_CONTENT_FUNCTIONS:
        if not re.search(pattern, body):
            fail(f"05 正文需覆盖内容功能: {description}")


def _validate_body(path: Path, body: str) -> None:
    header = _header_text(body)
    for field in REQUIRED_HEADER_FIELDS:
        if field not in header:
            fail(f"{path} 文首必须说明 {field}")

    _check_content_functions(body)

    chapter_count = _count_argument_chapters(body)
    if chapter_count < MIN_ARGUMENT_CHAPTERS:
        fail(
            f"{path} 正文核心论点章节不足: 需要至少 {MIN_ARGUMENT_CHAPTERS} 个 ## 章节，当前 {chapter_count} 个"
        )
    if chapter_count > MAX_ARGUMENT_CHAPTERS:
        fail(
            f"{path} 正文核心论点章节过多: 最多 {MAX_ARGUMENT_CHAPTERS} 个 ## 章节，当前 {chapter_count} 个"
        )

    validate_researcher_body(body, str(path))
    if not DISCLAIMER_PATTERN.search(body):
        fail(f"{path} 文末必须包含合规声明（说明报告为内部研究讨论、不构成投资建议）")
    for term in FORBIDDEN_BODY_TERMS:
        if term in body:
            fail(f"05 正文不得包含系统内部字段: {term}")
    forbidden = ["目标价", "买入评级", "卖出评级", "仓位建议", "收益率预测"]
    for marker in forbidden:
        for match in re.finditer(re.escape(marker), body):
            context = body[max(0, match.start() - 30) : match.end() + 12]
            if "不构成" in context or "不得" in context or "不输出" in context:
                continue
            fail(f"05 正文不得包含投资建议或评级用语: {marker}")


def _permission_index(
    handoff: dict[str, object],
) -> tuple[dict[str, dict[str, object]], dict[str, dict[str, object]], set[str]]:
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
    return approved_permissions, restricted_permissions, set(approved_permissions) | set(restricted_permissions)


def _assert_no_strength_upgrade(level: str, expression_text: str, label: str) -> None:
    markers = STRENGTH_UPGRADE_MARKERS.get(level, ())
    for marker in markers:
        if marker in expression_text:
            # 豁免否定语境（如"无法确定见底时间"）
            neg_pattern = re.compile(
                r"(?:不|未|无|非|难|岂|莫|勿|否)[\u4e00-\u9fff]{0,5}" + re.escape(marker)
            )
            if neg_pattern.search(expression_text):
                continue
            fail(f"{label}: {level} 表达不得使用绝对化措辞导致强度升级: {marker}")


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
    require_schema_version(audit["schema_version"], str(expression_audit_path), expected=EXPRESSION_AUDIT_SCHEMA_VERSION)
    if audit["document_type"] != "delivery_expression_audit" or str(audit["schema_version"]) != EXPRESSION_AUDIT_SCHEMA_VERSION:
        fail(f"05 表达审计必须使用 delivery_expression_audit / {EXPRESSION_AUDIT_SCHEMA_VERSION}")
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

    # Wave C：扩展节若出现则结构校验；历史 formal pack 可不含这些节（compat）。
    for section in (
        "report_level_expression_map",
        "main_judgment_check",
        "judgment_priority_check",
        "key_unknown_check",
        "expression_quality_alignment",
    ):
        if section in audit and not isinstance(audit.get(section), dict):
            fail(f"05 audit.{section} 若存在必须为对象")
    if "substantive_beyond_generic_research_discipline" in edge_check and not isinstance(
        edge_check.get("substantive_beyond_generic_research_discipline"), bool
    ):
        fail("research_edge_check.substantive_beyond_generic_research_discipline 必须为布尔")

    # 研究价值硬门（与 Runtime research_value_review 对齐）：若审计携带该字段则必须 pass。
    research_value = audit.get("research_value_review")
    if isinstance(research_value, dict):
        if str(research_value.get("status") or "") != "pass":
            fail("research_value_review.status 必须为 pass（研究价值硬门）")
        total = research_value.get("total_score")
        threshold = research_value.get("pass_threshold", 16)
        if isinstance(total, (int, float)) and isinstance(threshold, (int, float)) and total < threshold:
            fail(f"research_value_review.total_score={total} < pass_threshold={threshold}")
        quality = str(metadata.get("quality_status") or "")
        if quality == "return_required":
            fail("quality_status=return_required 时不得发布（研究价值或上游门禁失败）")

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
    approved_permissions, restricted_permissions, permitted_claim_ids = _permission_index(handoff)
    permission_by_claim = {**restricted_permissions, **approved_permissions}
    view_ref = str(source_metadata.get("source_02_view_ref", "")).strip()
    view_path = source_04_audit_path.parent / view_ref
    if not view_path.is_file():
        fail("05 无法解析 04.metadata.source_02_view_ref")
    source_view = load_yaml_file(view_path)
    method_contract_required = (
        str(source_view.get("schema_version")) == "3.0.0"
        or str(source_audit.get("schema_version")) == "5.0.0"
    )
    method_projection_errors = validate_expression_projection(
        audit,
        source_audit,
        required=method_contract_required,
    )
    if method_projection_errors:
        fail("; ".join(method_projection_errors))
    try:
        scope_graph = validate_scope_graph(source_view)
    except ValueError as exc:
        fail(str(exc))
    root_scope_ref = str(source_view.get("scope_graph", {}).get("root_scope_ref", ""))
    caveat_catalog = {
        str(item.get("caveat_ref")): str(item.get("text", ""))
        for item in handoff.get("required_caveats", [])
        if isinstance(item, dict) and item.get("caveat_ref") and item.get("text")
    }
    prohibited_claim_ids = {
        str(item.get("claim_id_or_topic"))
        for item in handoff.get("prohibited_claims", [])
        if isinstance(item, dict) and str(item.get("claim_id_or_topic", "")) in source_claims
    }
    if handoff.get("formal_report_allowed") is not True:
        fail("04 handoff_to_05 未允许形成正式研究稿")
    expressions = audit["claim_expression_register"]
    if not isinstance(expressions, list) or not expressions:
        fail("claim_expression_register 至少需要一项")
    title_match = re.search(r"^#\s+(.+)$", body, re.MULTILINE)
    report_title = title_match.group(1).strip() if title_match else ""
    title_registered = False
    for item in expressions:
        require_keys(item, EXPRESSION_REQUIRED_FIELDS, "claim_expression_register[]")
        label = f"claim_expression_register#{item['expression_id']}"
        source_ids = split_refs(item.get("source_rcs"))
        if not source_ids:
            fail(f"{label} 必须填写 source_rcs")
        expression_role = str(item.get("expression_role", "synthesis" if len(source_ids) > 1 else "paraphrase"))
        if expression_role not in {"direct", "paraphrase", "synthesis"}:
            fail(f"{label}.expression_role 非法")
        if len(source_ids) > 1 and expression_role != "synthesis":
            fail(f"{label} 引用多个 source_rcs 时 expression_role 必须为 synthesis")
        unknown_sources = sorted(set(source_ids) - set(source_claims))
        if unknown_sources:
            fail(f"{label}.source_rcs 未在 04 claim_register 中定义: {', '.join(unknown_sources)}")
        prohibited_sources = sorted(set(source_ids) & prohibited_claim_ids)
        if prohibited_sources:
            fail(f"{label}.source_rcs 已被 04 明确禁止表达: {', '.join(prohibited_sources)}")
        unpermitted_sources = sorted(set(source_ids) - permitted_claim_ids)
        if unpermitted_sources:
            fail(f"{label}.source_rcs 未获得 04 handoff_to_05 表达许可: {', '.join(unpermitted_sources)}")
        source_items = [source_claims[source_id] for source_id in source_ids]
        permissions = [permission_by_claim[source_id] for source_id in source_ids]
        source_levels = [str(source.get("judgment_level", "")).strip() for source in source_items]
        for source_id, source_level in zip(source_ids, source_levels):
            validate_judgment_level(source_level, f"{label}.source_rcs#{source_id}")
        expected_level = min(source_levels, key=judgment_level_rank)
        inherited_level = str(item["inherited_judgment_level"]).strip()
        validate_judgment_level(inherited_level, label)
        if inherited_level != expected_level:
            fail(f"{label}.inherited_judgment_level 必须等于来源主张中的最低等级 {expected_level}")
        declared_role = str(item["permitted_role"]).strip()
        allowed_roles: set[str] | None = None
        for permission in permissions:
            role = str(permission.get("permitted_role", "")).strip()
            role_options = {role}
            if role == "core_thesis":
                role_options.add("supporting_thesis")
            allowed_roles = role_options if allowed_roles is None else allowed_roles & role_options
        if allowed_roles is None or declared_role not in allowed_roles:
            fail(f"{label}.permitted_role 超出 source_rcs 的共同表达许可")
        if declared_role not in ROLE_ALLOWED_LOCATIONS:
            fail(f"{label}.permitted_role 非法: {declared_role}")
        if item["location_kind"] not in LOCATION_KINDS:
            fail(f"{label}.location_kind 非法")
        if item["location_kind"] not in ROLE_ALLOWED_LOCATIONS[declared_role]:
            fail(f"{label}: 角色 {declared_role} 不得用于 {item['location_kind']}")
        expression_text = str(item["expression_text"]).strip()
        if not expression_text or expression_text not in body:
            fail(f"{label}.expression_text 必须可在 05 正文中精确定位")
        _assert_no_strength_upgrade(inherited_level, expression_text, label)
        if item["location_kind"] in HIGH_VISIBILITY_EXPRESSION_LOCATIONS:
            assert_no_audit_register_voice(expression_text, label)
        if item["location_kind"] == "report_title" and expression_text == report_title:
            title_registered = True
        if item["location_kind"] == "report_title" and any(source_id not in approved_permissions for source_id in source_ids):
            fail(f"{label}: 受限观点不得用于 05 主标题")
        if item["location_kind"] == "report_title" and declared_role != "core_thesis":
            fail(f"{label}: 主标题只能使用 core_thesis")
        expected_conditions: set[str] = set()
        for source in source_items:
            expected_conditions.update(split_refs(source.get("conditions")))
        if set(split_refs(item["conditions"])) != expected_conditions:
            fail(f"{label}.conditions 必须完整继承全部 source_rcs")
        if item.get("conditions_preserved") is not None and item["conditions_preserved"] is not True:
            fail(f"{label}.conditions_preserved 必须为 true")
        if "expression_scope_ref" in item and "scope_relation" in item:
            expression_scope_ref = str(item.get("expression_scope_ref", "")).strip()
            if expression_scope_ref not in scope_graph:
                fail(f"{label}.expression_scope_ref 未在 02.scope_graph 定义")
            relations = [
                derive_scope_relation(expression_scope_ref, str(source.get("scope_ref", "")), scope_graph)
                for source in source_items
            ]
            if any(relation not in {"same", "narrower"} for relation in relations):
                fail(f"{label}: 表达范围超过或脱离来源 Claim: {relations}")
            derived_scope_relation = "same" if all(relation == "same" for relation in relations) else "narrower"
            if item["scope_relation"] != derived_scope_relation:
                fail(f"{label}.scope_relation 应由范围图派生为 {derived_scope_relation}")
        if "preserved_caveat_refs" in item:
            required_caveats: set[str] = set()
            for source, permission in zip(source_items, permissions):
                required_caveats.update(split_refs(source.get("required_caveat_refs")))
                required_caveats.update(split_refs(permission.get("required_caveat_refs")))
            preserved = set(split_refs(item.get("preserved_caveat_refs")))
            if not required_caveats.issubset(preserved):
                fail(f"{label}.preserved_caveat_refs 丢失 04 必要限定")
            if not preserved.issubset(caveat_catalog):
                fail(f"{label}.preserved_caveat_refs 含未定义限定")
        if item.get("semantic_strength_review") is not None and item["semantic_strength_review"] != "pass":
            fail(f"{label}.semantic_strength_review 必须为 pass")
        if judgment_level_rank(inherited_level) > judgment_level_rank(expected_level):
            fail(f"{label}: 表达等级超过 04 判断许可")
        if item["location_kind"] == "report_title":
            if expression_scope_ref != root_scope_ref:
                fail(f"{label}: 主标题必须使用任务根范围")
            if any(str(source.get("scope_ref")) != root_scope_ref for source in source_items):
                fail(f"{label}: 主标题不得用较窄 Claim 冒充根范围结论")
    if not title_registered:
        fail("05 主标题必须登记到 claim_expression_register")

    # 禁止主题和 must_avoid 使用结构化代码与字面触发词，不能再靠 overall_check=true 自证。
    forbidden_rules = [
        item for item in handoff.get("prohibited_claims", [])
        if isinstance(item, dict)
    ] + [
        item for item in handoff.get("expression_rules", {}).get("must_avoid_rules", [])
        if isinstance(item, dict)
    ]
    for rule in forbidden_rules:
        code = str(rule.get("topic_code") or rule.get("rule_code") or "UNKNOWN")
        for pattern in split_refs(rule.get("match_terms")):
            if pattern and pattern in body:
                fail(f"05 正文触发 04 禁止主题 {code}: {pattern}")
    for caveat_ref, caveat_text in caveat_catalog.items():
        if caveat_ref in {
            ref for item in expressions for ref in split_refs(item.get("preserved_caveat_refs"))
        } and caveat_text not in body:
            fail(f"05 正文未实际呈现必要限定 {caveat_ref}: {caveat_text}")

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
    for heading in argument_headings:
        assert_no_audit_register_voice(heading, "05 论点章节标题")
    require_registered_fragments(
        argument_headings,
        location_kind="section_heading",
        label="05 论点章节标题",
    )
    for line in investment_lines:
        assert_no_audit_register_voice(line, "05 投资要点")
    for cell in overview_rows:
        assert_no_audit_register_voice(cell, "05 核心结论概览")

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
        "schema_version": EXPRESSION_AUDIT_SCHEMA_VERSION,
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
