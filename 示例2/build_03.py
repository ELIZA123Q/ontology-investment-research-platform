#!/usr/bin/env python3
"""Build 03 snapshot and preparation docs for US-Iran negotiation semiconductor run."""

from __future__ import annotations

import csv
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "示例2"
TEMPLATE = ROOT / "输出模板" / "03_数据与证据快照模板"
THEME = "美伊谈判半导体影响"
RUN = "20260709-1"
TASK = "JTASK-USIRAN-NEG-SEMI-001"
EXEC = "EXEC-USIRAN-NEG-SEMI-20260709-1"
PLAN = "DAP-USIRAN-NEG-SEMI-20260709-1"
VIEW = "TOV-USIRAN-NEG-SEMI-20260709-1"
LOGIC = "RLOG-USIRAN-NEG-SEMI-20260709-1"
AS_OF = "2026-07-09T16:00:00+08:00"
DATE = "2026-07-09"
F02Y = f"02-{THEME}本体视图-{RUN}.yaml"
F02M = f"02-{THEME}研究逻辑-{RUN}.md"
F03M = f"03-{THEME}数据与证据准备-{RUN}.md"
SNAP = f"03-{THEME}数据与证据快照-{RUN}"
F03S = f"{SNAP}/03-{THEME}数据与证据快照-{RUN}.md"
VIEW_HASH = "sha256:" + hashlib.sha256((OUT / F02Y).read_bytes()).hexdigest()

COV_TOTAL = 14
COV_COUNTED = 9
COV_RATE = f"{COV_COUNTED / COV_TOTAL:.6f}"
JU_TOTAL = 7
JU_DIR = 4
JU_COND = 2
JU_INSUF = 1


def wcsv(rel: str, rows: list[dict[str, str]]) -> None:
    src = TEMPLATE / rel
    dst = OUT / SNAP / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    with src.open(newline="", encoding="utf-8-sig") as f:
        header = next(csv.reader(f))
    with dst.open("w", newline="", encoding="utf-8") as f:
        wr = csv.DictWriter(f, fieldnames=header, lineterminator="\n")
        wr.writeheader()
        for row in rows:
            wr.writerow({k: row.get(k, "") for k in header})


def build_csvs() -> None:
    E = EXEC
    wcsv("01_plan/source_profiles.csv", [
        {"source_profile_id": "SP-APNEWS", "execution_id": E, "source_name": "AP News", "source_tier": "S3", "source_category": "news", "authority_type": "wire_service", "typical_content_domains": "geopolitical|negotiation", "allowed_claim_types": "reported_fact|background", "forbidden_use": "单独确认全部谈判细节", "default_reliability": "medium", "independence_group": "IG-NEWS-INTL", "access_scope_default": "public_web", "common_limitations": "转述需交叉", "notes": ""},
        {"source_profile_id": "SP-AXIOS", "execution_id": E, "source_name": "Axios", "source_tier": "S3", "source_category": "news", "authority_type": "political_reporting", "typical_content_domains": "geopolitical|shipping", "allowed_claim_types": "reported_fact|analysis", "forbidden_use": "替代官方文本", "default_reliability": "medium", "independence_group": "IG-NEWS-INTL", "access_scope_default": "public_web", "common_limitations": "政策解读层", "notes": ""},
        {"source_profile_id": "SP-GEP", "execution_id": E, "source_name": "GEP Hormuz Advisory", "source_tier": "S4", "source_category": "research", "authority_type": "supply_chain_advisory", "typical_content_domains": "helium|procurement", "allowed_claim_types": "estimate|analysis", "forbidden_use": "厂侧硬数据", "default_reliability": "medium", "independence_group": "IG-RESEARCH", "access_scope_default": "public_summary", "common_limitations": "采购视角", "notes": ""},
        {"source_profile_id": "SP-LIGHTSOURCE", "execution_id": E, "source_name": "LightSource Blog", "source_tier": "S4", "source_category": "research", "authority_type": "industry_analysis", "typical_content_domains": "semiconductor|helium", "allowed_claim_types": "analysis|scenario", "forbidden_use": "精确产量", "default_reliability": "medium", "independence_group": "IG-RESEARCH", "access_scope_default": "public_web", "common_limitations": "情景推演", "notes": ""},
        {"source_profile_id": "SP-FITCH", "execution_id": E, "source_name": "Fitch Ratings", "source_tier": "S4", "source_category": "research", "authority_type": "rating_agency", "typical_content_domains": "exposure", "allowed_claim_types": "estimate", "forbidden_use": "替代披露", "default_reliability": "medium", "independence_group": "IG-RESEARCH", "access_scope_default": "public_summary", "common_limitations": "摘要", "notes": ""},
        {"source_profile_id": "SP-MARKET", "execution_id": E, "source_name": "公开市场指数", "source_tier": "S4", "source_category": "market_data", "authority_type": "index", "typical_content_domains": "valuation", "allowed_claim_types": "data_point", "forbidden_use": "基本面确认", "default_reliability": "medium", "independence_group": "IG-MARKET", "access_scope_default": "licensed_or_public", "common_limitations": "仅定价反应", "notes": ""},
        {"source_profile_id": "SP-CN-MEDIA", "execution_id": E, "source_name": "中文行业媒体", "source_tier": "S5", "source_category": "media", "authority_type": "secondary", "typical_content_domains": "semiconductor|china", "allowed_claim_types": "analysis", "forbidden_use": "精确测算", "default_reliability": "low", "independence_group": "IG-CN", "access_scope_default": "public_web", "common_limitations": "转述", "notes": ""},
        {"source_profile_id": "SP-FILING", "execution_id": E, "source_name": "交易所公司披露", "source_tier": "S1", "source_category": "filing", "authority_type": "regulatory_filing", "typical_content_domains": "financial", "allowed_claim_types": "disclosure", "forbidden_use": "无", "default_reliability": "high", "independence_group": "IG-FILING", "access_scope_default": "public_filing", "common_limitations": "披露滞后", "notes": ""},
    ])
    wcsv("01_plan/acquisition_channels.csv", [
        {"acquisition_channel_id": "AC-WEB-NEWS", "execution_id": E, "channel_name": "公开新闻检索", "channel_type": "web_search", "supported_source_profile_ids": "SP-APNEWS|SP-AXIOS|SP-LIGHTSOURCE|SP-CN-MEDIA", "supported_content_domains": "geopolitical|negotiation|semiconductor", "repeatability": "high", "traceability_level": "url_timestamp", "permission_requirement": "none", "typical_failure_modes": "转述冲突", "allowed_usage": "谈判时间线与解读", "forbidden_usage": "无URL硬事实", "notes": ""},
        {"acquisition_channel_id": "AC-ADVISORY", "execution_id": E, "channel_name": "供应链咨询摘要", "channel_type": "web_fetch", "supported_source_profile_ids": "SP-GEP|SP-LIGHTSOURCE", "supported_content_domains": "helium|supply_chain", "repeatability": "medium", "traceability_level": "url", "permission_requirement": "none", "typical_failure_modes": "情景假设", "allowed_usage": "边界框架", "forbidden_usage": "厂侧确认", "notes": ""},
        {"acquisition_channel_id": "AC-MARKET", "execution_id": E, "channel_name": "指数行情", "channel_type": "market_data", "supported_source_profile_ids": "SP-MARKET", "supported_content_domains": "valuation", "repeatability": "high", "traceability_level": "index_code", "permission_requirement": "none", "typical_failure_modes": "口径不一", "allowed_usage": "情绪通道代理", "forbidden_usage": "供应链事实", "notes": ""},
        {"acquisition_channel_id": "AC-FILING", "execution_id": E, "channel_name": "披露检索", "channel_type": "filing_search", "supported_source_profile_ids": "SP-FILING", "supported_content_domains": "financial", "repeatability": "medium", "traceability_level": "filing_id", "permission_requirement": "none", "typical_failure_modes": "无匹配", "allowed_usage": "精确影响验证", "forbidden_usage": "猜测", "notes": ""},
    ])
    wcsv("01_plan/evidence_requirements.csv", [
        {"evidence_requirement_id": "ER-01", "execution_id": E, "target_judgment_unit_id": "JU-01", "target_path_node_id": "N-01", "target_state_variable_id": "SV-NEG-SIGNAL", "requirement_purpose": "support", "evidence_role": "primary_support", "required_evidence_category": "event", "required_content_domains": "geopolitical", "required_object_scope": "美伊谈判", "required_time_scope": "2026-01至2026-07", "required_grain": "event_point", "minimum_quality_level": "Q3_directional_ready", "minimum_source_tier": "S3", "minimum_independent_source_count": "2", "mandatory_basket_ids": "EB-NEG-TIMELINE", "counter_basket_ids": "EB-NEG-STABLE", "allowed_proxy": "false", "preferred_source_profile_ids": "SP-APNEWS|SP-AXIOS", "allowed_acquisition_channel_ids": "AC-WEB-NEWS", "forbidden_sources": "匿名社媒", "required_freshness": "谈判窗口内", "required_traceability": "URL", "required_comparability": "同一谈判议题", "stop_condition": "多源对齐", "missing_policy": "downgrade", "allowed_04_output_if_met": "directional_only", "allowed_04_output_if_missing": "conditional_only", "notes": ""},
        {"evidence_requirement_id": "ER-02", "execution_id": E, "target_judgment_unit_id": "JU-02", "target_path_node_id": "N-02", "target_state_variable_id": "SV-SECTOR-PRICE", "requirement_purpose": "support", "evidence_role": "primary_support", "required_evidence_category": "valuation", "required_content_domains": "market", "required_object_scope": "半导体板块", "required_time_scope": "谈判关键日前后", "required_grain": "time_series", "minimum_quality_level": "Q2_reasoning_usable", "minimum_source_tier": "S4", "minimum_independent_source_count": "1", "mandatory_basket_ids": "EB-SECTOR-REACT", "counter_basket_ids": "EB-PRICE-DECOUPLE", "allowed_proxy": "true", "preferred_source_profile_ids": "SP-MARKET", "allowed_acquisition_channel_ids": "AC-MARKET", "forbidden_sources": "", "required_freshness": "日级", "required_traceability": "指数口径", "required_comparability": "同一指数", "stop_condition": "反应窗口", "missing_policy": "downgrade", "allowed_04_output_if_met": "directional_only", "allowed_04_output_if_missing": "conditional_only", "notes": ""},
        {"evidence_requirement_id": "ER-03", "execution_id": E, "target_judgment_unit_id": "JU-03", "target_path_node_id": "N-03", "target_state_variable_id": "SV-HORMUZ-ACTUAL", "requirement_purpose": "support", "evidence_role": "primary_support", "required_evidence_category": "supply", "required_content_domains": "shipping|helium", "required_object_scope": "霍尔木兹卡塔尔", "required_time_scope": "2026-03至2026-07", "required_grain": "text_claim", "minimum_quality_level": "Q3_directional_ready", "minimum_source_tier": "S3", "minimum_independent_source_count": "2", "mandatory_basket_ids": "EB-PHYSICAL-FLOW", "counter_basket_ids": "EB-PHYSICAL-STUCK", "allowed_proxy": "false", "preferred_source_profile_ids": "SP-APNEWS|SP-AXIOS", "allowed_acquisition_channel_ids": "AC-WEB-NEWS", "forbidden_sources": "", "required_freshness": "60日", "required_traceability": "来源名", "required_comparability": "通航与复产", "stop_condition": "谈妥与实物流对齐", "missing_policy": "downgrade", "allowed_04_output_if_met": "directional_only", "allowed_04_output_if_missing": "conditional_only", "notes": ""},
        {"evidence_requirement_id": "ER-04", "execution_id": E, "target_judgment_unit_id": "JU-04", "target_path_node_id": "N-04", "target_state_variable_id": "SV-SANCTIONS-CHG", "requirement_purpose": "background", "evidence_role": "background_evidence", "required_evidence_category": "policy", "required_content_domains": "trade", "required_object_scope": "半导体贸易", "required_time_scope": "2026", "required_grain": "event_point", "minimum_quality_level": "Q2_reasoning_usable", "minimum_source_tier": "S2", "minimum_independent_source_count": "1", "mandatory_basket_ids": "EB-SANCTIONS", "counter_basket_ids": "", "allowed_proxy": "false", "preferred_source_profile_ids": "SP-APNEWS", "allowed_acquisition_channel_ids": "AC-WEB-NEWS", "forbidden_sources": "", "required_freshness": "政策窗口", "required_traceability": "报道引用", "required_comparability": "物项范围", "stop_condition": "正式文本", "missing_policy": "downgrade", "allowed_04_output_if_met": "conditional_only", "allowed_04_output_if_missing": "conditional_only", "notes": ""},
        {"evidence_requirement_id": "ER-05", "execution_id": E, "target_judgment_unit_id": "JU-04", "target_path_node_id": "N-05", "target_state_variable_id": "SV-MAT-LEAD", "requirement_purpose": "validate", "evidence_role": "cross_validation", "required_evidence_category": "supply", "required_content_domains": "semiconductor", "required_object_scope": "全链", "required_time_scope": "2026Q2Q3", "required_grain": "cross_section", "minimum_quality_level": "Q2_reasoning_usable", "minimum_source_tier": "S4", "minimum_independent_source_count": "2", "mandatory_basket_ids": "EB-CHAIN-SEG", "counter_basket_ids": "EB-CHAIN-FLAT", "allowed_proxy": "true", "preferred_source_profile_ids": "SP-GEP|SP-LIGHTSOURCE", "allowed_acquisition_channel_ids": "AC-ADVISORY", "forbidden_sources": "", "required_freshness": "季度", "required_traceability": "环节标注", "required_comparability": "五环节", "stop_condition": "两环节", "missing_policy": "downgrade", "allowed_04_output_if_met": "conditional_only", "allowed_04_output_if_missing": "conditional_only", "notes": ""},
        {"evidence_requirement_id": "ER-06", "execution_id": E, "target_judgment_unit_id": "JU-05", "target_path_node_id": "N-06", "target_state_variable_id": "SV-NEG-SIGNAL", "requirement_purpose": "validate", "evidence_role": "cross_validation", "required_evidence_category": "event", "required_content_domains": "geopolitical", "required_object_scope": "谈判情景", "required_time_scope": "向前", "required_grain": "text_claim", "minimum_quality_level": "Q2_reasoning_usable", "minimum_source_tier": "S4", "minimum_independent_source_count": "1", "mandatory_basket_ids": "EB-SCENARIO", "counter_basket_ids": "EB-SCENARIO-BLOCK", "allowed_proxy": "false", "preferred_source_profile_ids": "SP-LIGHTSOURCE", "allowed_acquisition_channel_ids": "AC-ADVISORY", "forbidden_sources": "", "required_freshness": "情景", "required_traceability": "假设来源", "required_comparability": "谈妥谈崩", "stop_condition": "两情景", "missing_policy": "downgrade", "allowed_04_output_if_met": "conditional_only", "allowed_04_output_if_missing": "insufficient", "notes": ""},
        {"evidence_requirement_id": "ER-07", "execution_id": E, "target_judgment_unit_id": "JU-06", "target_path_node_id": "N-07", "target_state_variable_id": "SV-CN-MFG", "requirement_purpose": "support", "evidence_role": "primary_support", "required_evidence_category": "exposure", "required_content_domains": "semiconductor|china", "required_object_scope": "中国大陆", "required_time_scope": "2026", "required_grain": "text_claim", "minimum_quality_level": "Q2_reasoning_usable", "minimum_source_tier": "S4", "minimum_independent_source_count": "1", "mandatory_basket_ids": "EB-CN-SEG", "counter_basket_ids": "EB-CN-SENTIMENT", "allowed_proxy": "true", "preferred_source_profile_ids": "SP-CN-MEDIA", "allowed_acquisition_channel_ids": "AC-WEB-NEWS", "forbidden_sources": "", "required_freshness": "半年", "required_traceability": "三类分开", "required_comparability": "制造材料设计", "stop_condition": "三类线索", "missing_policy": "downgrade", "allowed_04_output_if_met": "directional_only", "allowed_04_output_if_missing": "conditional_only", "notes": ""},
        {"evidence_requirement_id": "ER-08", "execution_id": E, "target_judgment_unit_id": "JU-07", "target_path_node_id": "N-08", "target_state_variable_id": "SV-FAB-PRECISE", "requirement_purpose": "block", "evidence_role": "blocking_condition", "required_evidence_category": "financial", "required_content_domains": "semiconductor", "required_object_scope": "fab", "required_time_scope": "2026", "required_grain": "quarterly", "minimum_quality_level": "Q4_report_grade", "minimum_source_tier": "S1", "minimum_independent_source_count": "1", "mandatory_basket_ids": "EB-FAB-DISC", "counter_basket_ids": "", "allowed_proxy": "false", "preferred_source_profile_ids": "SP-FILING", "allowed_acquisition_channel_ids": "AC-FILING", "forbidden_sources": "转述", "required_freshness": "最近季报", "required_traceability": "公告", "required_comparability": "产量收入", "stop_condition": "无披露", "missing_policy": "block", "allowed_04_output_if_met": "conditional_only", "allowed_04_output_if_missing": "insufficient", "notes": ""},
    ])
    wcsv("01_plan/evidence_recipe_matches.csv", [
        {"recipe_match_id": "RM-01", "execution_id": E, "evidence_recipe_id": "REC-A01", "recipe_name": "A01事实确认", "target_judgment_unit_id": "JU-01", "judgment_type": "event_impact_judgment", "strategy_library_ref": "03取证策略库/A_取证规则/A01_事实确认取证规则.md", "strategy_version": "1.0.0", "applicable_conditions": "谈判事件", "required_basket_types": "谈判时间线", "mandatory_basket_types": "谈判时间线", "optional_basket_types": "", "counter_basket_types": "谈判稳定", "minimum_pass_rule": "多源", "high_quality_rule": "官方+媒体", "proxy_rule": "不允许", "source_rule": "B04地缘", "stop_rule": "时间线对齐", "downgrade_rule": "directional_only", "match_status": "matched", "notes": ""},
        {"recipe_match_id": "RM-02", "execution_id": E, "evidence_recipe_id": "REC-A07", "recipe_name": "A07市场预期", "target_judgment_unit_id": "JU-02", "judgment_type": "expectation_gap_judgment", "strategy_library_ref": "03取证策略库/A_取证规则/A07_市场预期与定价取证规则.md", "strategy_version": "1.0.0", "applicable_conditions": "定价反应", "required_basket_types": "板块反应", "mandatory_basket_types": "板块反应", "optional_basket_types": "", "counter_basket_types": "定价脱钩", "minimum_pass_rule": "指数对齐", "high_quality_rule": "多指数", "proxy_rule": "限用", "source_rule": "B02市场", "stop_rule": "窗口对齐", "downgrade_rule": "directional_only", "match_status": "matched", "notes": ""},
        {"recipe_match_id": "RM-03", "execution_id": E, "evidence_recipe_id": "REC-A04", "recipe_name": "A04机制传导", "target_judgment_unit_id": "JU-03", "judgment_type": "event_impact_judgment", "strategy_library_ref": "03取证策略库/A_取证规则/A04_机制传导验证取证规则.md", "strategy_version": "1.0.0", "applicable_conditions": "实物流滞后", "required_basket_types": "通航氦气", "mandatory_basket_types": "通航氦气", "optional_basket_types": "", "counter_basket_types": "实物流仍受阻", "minimum_pass_rule": "谈妥与通航", "high_quality_rule": "航运+设施", "proxy_rule": "限用", "source_rule": "B04+B03", "stop_rule": "滞后登记", "downgrade_rule": "directional_only", "match_status": "matched", "notes": ""},
    ])
    wcsv("01_plan/evidence_baskets.csv", [
        {"evidence_basket_id": "EB-NEG-TIMELINE", "execution_id": E, "basket_type": "谈判时间线", "target_judgment_unit_id": "JU-01", "target_requirement_ids": "ER-01", "basket_role": "primary_support", "required_evidence_categories": "event", "required_claim_types": "reported_fact", "required_source_profile_ids": "SP-APNEWS|SP-AXIOS", "minimum_source_tier": "S3", "minimum_independent_source_count": "2", "required_time_coverage": "2026Q2Q3", "required_object_coverage": "美伊谈判", "required_content_domains": "geopolitical", "allowed_proxy": "false", "actual_evidence_ids": "EV-01|EV-02|EV-03", "actual_fact_ids": "EV-01|EV-02|EV-03", "actual_source_ids": "SRC-01|SRC-02|SRC-03", "basket_status": "partial", "conflict_status": "minor_conflict", "counter_check_status": "checked", "quality_level": "Q3_directional_ready", "allowed_04_output": "conditional_only", "usage_limit": " rhetoric与事实需分开", "gap_action": "补MOU原文", "notes": ""},
        {"evidence_basket_id": "EB-NEG-STABLE", "execution_id": E, "basket_type": "谈判稳定反证", "target_judgment_unit_id": "JU-01", "target_requirement_ids": "ER-01", "basket_role": "counter_evidence", "required_evidence_categories": "event", "required_claim_types": "reported_fact", "required_source_profile_ids": "SP-APNEWS", "minimum_source_tier": "S3", "minimum_independent_source_count": "1", "required_time_coverage": "2026-07", "required_object_coverage": "谈判", "required_content_domains": "geopolitical", "allowed_proxy": "false", "actual_evidence_ids": "EV-02", "actual_fact_ids": "EV-02", "actual_source_ids": "SRC-01", "basket_status": "partial", "conflict_status": "no_material_conflict", "counter_check_status": "checked", "quality_level": "Q2_reasoning_usable", "allowed_04_output": "conditional_only", "usage_limit": "幕后谈判仍在进行", "gap_action": "", "notes": ""},
        {"evidence_basket_id": "EB-SECTOR-REACT", "execution_id": E, "basket_type": "板块反应", "target_judgment_unit_id": "JU-02", "target_requirement_ids": "ER-02", "basket_role": "primary_support", "required_evidence_categories": "valuation", "required_claim_types": "data_point", "required_source_profile_ids": "SP-MARKET", "minimum_source_tier": "S4", "minimum_independent_source_count": "1", "required_time_coverage": "2026-07", "required_object_coverage": "半导体指数", "required_content_domains": "market", "allowed_proxy": "true", "actual_evidence_ids": "EV-04", "actual_fact_ids": "EV-04", "actual_source_ids": "SRC-04", "basket_status": "partial", "conflict_status": "no_material_conflict", "counter_check_status": "checked", "quality_level": "Q2_reasoning_usable", "allowed_04_output": "conditional_only", "usage_limit": "仅情绪通道", "gap_action": "补多指数", "notes": ""},
        {"evidence_basket_id": "EB-PRICE-DECOUPLE", "execution_id": E, "basket_type": "定价脱钩", "target_judgment_unit_id": "JU-02", "target_requirement_ids": "ER-02", "basket_role": "counter_evidence", "required_evidence_categories": "valuation", "required_claim_types": "background", "required_source_profile_ids": "SP-MARKET", "minimum_source_tier": "S4", "minimum_independent_source_count": "1", "required_time_coverage": "2026-07", "required_object_coverage": "半导体", "required_content_domains": "market", "allowed_proxy": "false", "actual_evidence_ids": "EV-11", "actual_fact_ids": "EV-11", "actual_source_ids": "SRC-04", "basket_status": "partial", "conflict_status": "no_material_conflict", "counter_check_status": "checked", "quality_level": "Q1_background", "allowed_04_output": "conditional_only", "usage_limit": "弱反证", "gap_action": "", "notes": ""},
        {"evidence_basket_id": "EB-PHYSICAL-FLOW", "execution_id": E, "basket_type": "实物流", "target_judgment_unit_id": "JU-03", "target_requirement_ids": "ER-03", "basket_role": "primary_support", "required_evidence_categories": "supply", "required_claim_types": "reported_fact", "required_source_profile_ids": "SP-APNEWS|SP-AXIOS", "minimum_source_tier": "S3", "minimum_independent_source_count": "2", "required_time_coverage": "2026-07", "required_object_coverage": "霍尔木兹", "required_content_domains": "shipping", "allowed_proxy": "false", "actual_evidence_ids": "EV-03|EV-05", "actual_fact_ids": "EV-03|EV-05", "actual_source_ids": "SRC-02|SRC-03", "basket_status": "partial", "conflict_status": "minor_conflict", "counter_check_status": "checked", "quality_level": "Q3_directional_ready", "allowed_04_output": "conditional_only", "usage_limit": "谈妥≠通航恢复", "gap_action": "补航运硬数据", "notes": ""},
        {"evidence_basket_id": "EB-PHYSICAL-STUCK", "execution_id": E, "basket_type": "实物流受阻", "target_judgment_unit_id": "JU-03", "target_requirement_ids": "ER-03", "basket_role": "counter_evidence", "required_evidence_categories": "supply", "required_claim_types": "analysis", "required_source_profile_ids": "SP-GEP", "minimum_source_tier": "S4", "minimum_independent_source_count": "1", "required_time_coverage": "2026", "required_object_coverage": "氦气", "required_content_domains": "helium", "allowed_proxy": "false", "actual_evidence_ids": "EV-06", "actual_fact_ids": "EV-06", "actual_source_ids": "SRC-05", "basket_status": "partial", "conflict_status": "no_material_conflict", "counter_check_status": "checked", "quality_level": "Q2_reasoning_usable", "allowed_04_output": "conditional_only", "usage_limit": "停火不解除氦气约束", "gap_action": "", "notes": ""},
        {"evidence_basket_id": "EB-CHAIN-SEG", "execution_id": E, "basket_type": "全链环节", "target_judgment_unit_id": "JU-04", "target_requirement_ids": "ER-05", "basket_role": "cross_validation", "required_evidence_categories": "supply", "required_claim_types": "analysis", "required_source_profile_ids": "SP-LIGHTSOURCE|SP-GEP", "minimum_source_tier": "S4", "minimum_independent_source_count": "2", "required_time_coverage": "2026", "required_object_coverage": "半导体全链", "required_content_domains": "semiconductor", "allowed_proxy": "true", "actual_evidence_ids": "EV-07|EV-08", "actual_fact_ids": "EV-07|EV-08", "actual_source_ids": "SRC-06|SRC-05", "basket_status": "partial", "conflict_status": "no_material_conflict", "counter_check_status": "partial", "quality_level": "Q2_reasoning_usable", "allowed_04_output": "conditional_only", "usage_limit": "缺厂侧硬交期", "gap_action": "补环节订单", "notes": ""},
        {"evidence_basket_id": "EB-CHAIN-FLAT", "execution_id": E, "basket_type": "全链无差异", "target_judgment_unit_id": "JU-04", "target_requirement_ids": "ER-05", "basket_role": "counter_evidence", "required_evidence_categories": "supply", "required_claim_types": "analysis", "required_source_profile_ids": "SP-LIGHTSOURCE", "minimum_source_tier": "S4", "minimum_independent_source_count": "1", "required_time_coverage": "2026", "required_object_coverage": "fab", "required_content_domains": "semiconductor", "allowed_proxy": "false", "actual_evidence_ids": "EV-12", "actual_fact_ids": "EV-12", "actual_source_ids": "SRC-06", "basket_status": "not_met", "conflict_status": "not_checked", "counter_check_status": "checked", "quality_level": "Q1_background", "allowed_04_output": "conditional_only", "usage_limit": "反证未充分", "gap_action": "补厂侧运营", "notes": ""},
        {"evidence_basket_id": "EB-SCENARIO", "execution_id": E, "basket_type": "情景边界", "target_judgment_unit_id": "JU-05", "target_requirement_ids": "ER-06", "basket_role": "cross_validation", "required_evidence_categories": "event", "required_claim_types": "scenario", "required_source_profile_ids": "SP-LIGHTSOURCE", "minimum_source_tier": "S4", "minimum_independent_source_count": "1", "required_time_coverage": "向前", "required_object_coverage": "全球半导体", "required_content_domains": "semiconductor", "allowed_proxy": "false", "actual_evidence_ids": "EV-09", "actual_fact_ids": "EV-09", "actual_source_ids": "SRC-06", "basket_status": "partial", "conflict_status": "minor_conflict", "counter_check_status": "checked", "quality_level": "Q2_reasoning_usable", "allowed_04_output": "conditional_only", "usage_limit": "情景非预测", "gap_action": "", "notes": ""},
        {"evidence_basket_id": "EB-SCENARIO-BLOCK", "execution_id": E, "basket_type": "情景阻断", "target_judgment_unit_id": "JU-05", "target_requirement_ids": "ER-06", "basket_role": "counter_evidence", "required_evidence_categories": "event", "required_claim_types": "background", "required_source_profile_ids": "SP-APNEWS", "minimum_source_tier": "S3", "minimum_independent_source_count": "1", "required_time_coverage": "2026-07", "required_object_coverage": "谈判", "required_content_domains": "geopolitical", "allowed_proxy": "false", "actual_evidence_ids": "EV-01", "actual_fact_ids": "EV-01", "actual_source_ids": "SRC-01", "basket_status": "partial", "conflict_status": "no_material_conflict", "counter_check_status": "checked", "quality_level": "Q2_reasoning_usable", "allowed_04_output": "conditional_only", "usage_limit": "局势快速变化", "gap_action": "", "notes": ""},
        {"evidence_basket_id": "EB-CN-SEG", "execution_id": E, "basket_type": "中国三类", "target_judgment_unit_id": "JU-06", "target_requirement_ids": "ER-07", "basket_role": "primary_support", "required_evidence_categories": "exposure", "required_claim_types": "analysis", "required_source_profile_ids": "SP-CN-MEDIA", "minimum_source_tier": "S5", "minimum_independent_source_count": "1", "required_time_coverage": "2026", "required_object_coverage": "中国半导体", "required_content_domains": "china", "allowed_proxy": "true", "actual_evidence_ids": "EV-10", "actual_fact_ids": "EV-10", "actual_source_ids": "SRC-07", "basket_status": "partial", "conflict_status": "minor_conflict", "counter_check_status": "checked", "quality_level": "Q2_reasoning_usable", "allowed_04_output": "conditional_only", "usage_limit": "转述层", "gap_action": "补披露", "notes": ""},
        {"evidence_basket_id": "EB-CN-SENTIMENT", "execution_id": E, "basket_type": "情绪误读", "target_judgment_unit_id": "JU-06", "target_requirement_ids": "ER-07", "basket_role": "counter_evidence", "required_evidence_categories": "valuation", "required_claim_types": "background", "required_source_profile_ids": "SP-MARKET", "minimum_source_tier": "S4", "minimum_independent_source_count": "1", "required_time_coverage": "2026-07", "required_object_coverage": "A股半导体", "required_content_domains": "market", "allowed_proxy": "false", "actual_evidence_ids": "EV-04", "actual_fact_ids": "EV-04", "actual_source_ids": "SRC-04", "basket_status": "partial", "conflict_status": "no_material_conflict", "counter_check_status": "checked", "quality_level": "Q1_background", "allowed_04_output": "conditional_only", "usage_limit": "板块摆动≠制造放松", "gap_action": "", "notes": ""},
        {"evidence_basket_id": "EB-FAB-DISC", "execution_id": E, "basket_type": "fab披露", "target_judgment_unit_id": "JU-07", "target_requirement_ids": "ER-08", "basket_role": "blocking_condition", "required_evidence_categories": "financial", "required_claim_types": "disclosure", "required_source_profile_ids": "SP-FILING", "minimum_source_tier": "S1", "minimum_independent_source_count": "1", "required_time_coverage": "2026Q2", "required_object_coverage": "fab", "required_content_domains": "semiconductor", "allowed_proxy": "false", "actual_evidence_ids": "EV-13", "actual_fact_ids": "EV-13", "actual_source_ids": "SRC-08", "basket_status": "missing", "conflict_status": "not_applicable", "counter_check_status": "missing", "quality_level": "Q1_background", "allowed_04_output": "insufficient", "usage_limit": "无精确量化", "gap_action": "保持insufficient", "notes": ""},
        {"evidence_basket_id": "EB-SANCTIONS", "execution_id": E, "basket_type": "制裁贸易", "target_judgment_unit_id": "JU-04", "target_requirement_ids": "ER-04", "basket_role": "background_evidence", "required_evidence_categories": "policy", "required_claim_types": "reported_fact", "required_source_profile_ids": "SP-APNEWS", "minimum_source_tier": "S3", "minimum_independent_source_count": "1", "required_time_coverage": "2026", "required_object_coverage": "核谈判", "required_content_domains": "policy", "allowed_proxy": "false", "actual_evidence_ids": "EV-01", "actual_fact_ids": "EV-01", "actual_source_ids": "SRC-01", "basket_status": "partial", "conflict_status": "no_material_conflict", "counter_check_status": "checked", "quality_level": "Q2_reasoning_usable", "allowed_04_output": "conditional_only", "usage_limit": "制裁与谈判交织", "gap_action": "", "notes": ""},
    ])
    wcsv("01_plan/proxy_indicators.csv", [
        {"proxy_indicator_id": "PX-01", "execution_id": E, "proxy_indicator_name": "半导体指数谈判窗口波动", "proxy_for": "情绪通道强度", "target_state_variable_id": "SV-SECTOR-PRICE", "target_requirement_id": "ER-02", "proxy_logic": "谈判头条日前后指数波动", "valid_conditions": "有明确谈判时点", "invalid_conditions": "有厂侧硬数据", "required_source_profile_ids": "SP-MARKET", "confidence_discount": "0.5", "cannot_replace": "材料交期与氦气合约", "required_disclosure": "标注为定价代理", "proxy_status": "active", "notes": ""},
        {"proxy_indicator_id": "PX-02", "execution_id": E, "proxy_indicator_name": "咨询报告环节压力排序", "proxy_for": "全链环节分化", "target_state_variable_id": "SV-MAT-LEAD", "target_requirement_id": "ER-05", "proxy_logic": "材料与制造优先承压叙事", "valid_conditions": "缺环节订单硬数据", "invalid_conditions": "有公司披露", "required_source_profile_ids": "SP-GEP|SP-LIGHTSOURCE", "confidence_discount": "0.6", "cannot_replace": "设备设计订单验证", "required_disclosure": "咨询情景", "proxy_status": "active", "notes": ""},
    ])
    wcsv("02_assets/source_snapshot.csv", _source_snapshot_rows(E))
    wcsv("02_assets/acquisition_log.csv", _acquisition_log_rows(E))
    wcsv("02_assets/semantic_instances.csv", _semantic_instances_rows(E))
    wcsv("02_assets/semantic_relations.csv", _semantic_relations_rows(E))
    wcsv("02_assets/reasoning_inputs.csv", _reasoning_inputs_rows(E))
    wcsv("02_assets/evidence_records.csv", _evidence_records_rows(E))
    wcsv("03_gate/evidence_readiness_assessments.csv", _assessment_rows(E))
    wcsv("03_gate/state_variable_coverage.csv", _coverage_rows(E))
    wcsv("03_gate/path_readiness.csv", _path_readiness_rows(E))
    wcsv("03_gate/gaps_and_risks.csv", _gaps_rows(E))
    wcsv("04_05_materials/display_data_candidates.csv", _display_rows(E))
    wcsv("04_05_materials/chart_data_package.csv", _chart_rows(E))
    wcsv("04_05_materials/table_material_package.csv", _table_rows(E))
    wcsv("04_05_materials/source_annotation_package.csv", _annotation_rows(E))
    wcsv("04_05_materials/05_material_readiness.csv", _material_rows(E))
    wcsv("manifest.csv", [_manifest_row(E)])


def _source_snapshot_rows(e: str) -> list[dict[str, str]]:
    rows = [
        ("SRC-01", "SR-01", "SRC-01", "AP News", "SP-APNEWS", "S3", "AC-WEB-NEWS", "https://apnews.com/article/us-iran-ceasefire-rhetoric-2026-07-09", "2026-07-09T08:00:00Z", "geopolitical|negotiation"),
        ("SRC-02", "SR-02", "SRC-02", "Axios", "SP-AXIOS", "S3", "AC-WEB-NEWS", "https://www.axios.com/2026/07/09/iran-hormuz-mou-unraveling", "2026-07-09T10:30:00Z", "geopolitical|shipping"),
        ("SRC-03", "SR-03", "SRC-03", "AP News", "SP-APNEWS", "S3", "AC-WEB-NEWS", "https://apnews.com/article/hormuz-negotiations-focal-2026-07-09", "2026-07-09T12:00:00Z", "shipping|negotiation"),
        ("SRC-04", "SR-04", "SRC-04", "公开市场指数", "SP-MARKET", "S4", "AC-MARKET", "SSE:半导体指数", "2026-07-09T15:00:00+08:00", "valuation"),
        ("SRC-05", "SR-05", "SRC-05", "GEP Hormuz Advisory", "SP-GEP", "S4", "AC-ADVISORY", "https://www.gep.com/blog/mind/helium-hormuz-ceasefire", "2026-07-08T00:00:00Z", "helium|procurement"),
        ("SRC-06", "SR-06", "SRC-06", "LightSource Blog", "SP-LIGHTSOURCE", "S4", "AC-ADVISORY", "https://lightsource.ai/blog/helium-semiconductor-supply-2026", "2026-07-07T00:00:00Z", "semiconductor|helium"),
        ("SRC-07", "SR-07", "SRC-07", "中文行业媒体", "SP-CN-MEDIA", "S5", "AC-WEB-NEWS", "https://example.cn/semi/china-segments-2026", "2026-07-05T00:00:00+08:00", "semiconductor|china"),
        ("SRC-08", "SR-08", "SRC-08", "交易所公司披露", "SP-FILING", "S1", "AC-FILING", "filing-search:no-match-2026Q2", "2026-07-09T00:00:00+08:00", "financial"),
    ]
    out = []
    for sid, srun, _, sname, spid, tier, ch, loc, pub, tags in rows:
        out.append({
            "source_run_id": srun, "execution_id": e, "source_id": sid, "source_name": sname,
            "source_profile_id": spid, "source_group_id": "SG-NEWS" if tier.startswith("S3") else "SG-OTHER",
            "independence_group_id": "IG-NEWS-INTL" if spid in {"SP-APNEWS", "SP-AXIOS"} else "IG-RESEARCH",
            "source_type": "news" if spid in {"SP-APNEWS", "SP-AXIOS"} else "research",
            "source_tier": tier, "source_status_at_run": "active", "acquisition_channel_id": ch,
            "recipe_id": "REC-A01", "content_domain_tags": tags, "access_mode": "public_web",
            "access_permission_status": "granted", "usage_restriction": "不得外推为厂侧硬数据",
            "requested_at": AS_OF, "retrieved_at": AS_OF, "publication_time": pub,
            "business_time_start": "2026-07-01", "business_time_end": "2026-07-09",
            "source_locator": loc, "raw_artifact_ref": f"artifacts/{srun}.html", "content_hash": "",
            "retrieval_status": "success" if sid != "SRC-08" else "no_match",
            "quality_status": "accepted" if sid != "SRC-08" else "rejected",
            "directness": "direct", "traceability": "url", "independence": "independent",
            "time_relevance": "current", "scope_match": "matched", "license_scope": "public", "notes": "",
        })
    return out


def _acquisition_log_rows(e: str) -> list[dict[str, str]]:
    return [
        {"attempt_id": "AL-01", "execution_id": e, "requirement_id": "ER-01", "linked_judgment_unit_ids": "JU-01", "path_id": "P-01", "node_id": "N-01", "recipe_id": "REC-A01", "source_id": "SRC-01", "source_tier": "S3", "search_round": "1", "query_parameters": "US Iran ceasefire rhetoric July 2026", "attempted_at": AS_OF, "result_status": "accepted", "records_received": "3", "records_accepted": "2", "is_counter_evidence_search": "false", "failure_code": "", "fallback_action": "", "stopping_rule": "multi_source", "stop_reason": "met_minimum", "notes": ""},
        {"attempt_id": "AL-02", "execution_id": e, "requirement_id": "ER-08", "linked_judgment_unit_ids": "JU-07", "path_id": "P-03", "node_id": "N-08", "recipe_id": "REC-A06", "source_id": "SRC-08", "source_tier": "S1", "search_round": "1", "query_parameters": "fab revenue impact Iran negotiation 2026Q2", "attempted_at": AS_OF, "result_status": "no_match", "records_received": "0", "records_accepted": "0", "is_counter_evidence_search": "false", "failure_code": "NO_DISCLOSURE", "fallback_action": "mark_insufficient", "stopping_rule": "block", "stop_reason": "no_filing", "notes": ""},
    ]


def _semantic_instances_rows(e: str) -> list[dict[str, str]]:
    inst = [
        ("INST-NEG", "Event", "美伊谈判进程", "美伊谈判", "EVT-USIRAN-NEG-2026", "JU-01|JU-05", "SR-01|SR-02", "EV-01|EV-02"),
        ("INST-HZ", "LogisticsNode", "霍尔木兹通航", "霍尔木兹海峡", "HORMUZ-TRANSIT", "JU-03", "SR-02|SR-03", "EV-03|EV-05"),
        ("INST-HE", "SupplyFacility", "卡塔尔氦气出口", "卡塔尔LNG氦", "QA-HELIUM", "JU-03|JU-05", "SR-05|SR-06", "EV-06|EV-08"),
        ("INST-CHAIN", "ValueChain", "全球半导体全链", "半导体全链", "GLOBAL-SEMI-CHAIN", "JU-04", "SR-06", "EV-07|EV-09"),
        ("INST-CN", "RegionalExposure", "中国半导体板块", "中国半导体", "CN-SEMI", "JU-06", "SR-07", "EV-10"),
    ]
    return [{
        "instance_id": iid, "execution_id": e, "requirement_id": "ER-01", "linked_judgment_unit_ids": ju,
        "instance_type": itype, "name": name, "canonical_name": cname, "stable_identifier": sid,
        "classification": "core", "scope": "global", "valid_from": "2026-01-01", "valid_to": "2027-12-31",
        "verification_status": "verified", "source_run_refs": sruns, "evidence_refs": evs, "notes": "",
    } for iid, itype, name, cname, sid, ju, sruns, evs in inst]


def _semantic_relations_rows(e: str) -> list[dict[str, str]]:
    return [
        {"relation_id": "REL-01", "execution_id": e, "requirement_id": "ER-03", "linked_judgment_unit_ids": "JU-03", "relation_type": "constrains", "source_instance_id": "INST-NEG", "target_instance_id": "INST-HZ", "relation_scope": "negotiation_to_logistics", "valid_from": "2026-03-01", "valid_to": "", "verification_status": "partial", "relation_evidence_strength": "medium", "source_run_refs": "SR-02|SR-03", "evidence_refs": "EV-03|EV-05", "notes": "MOU围绕霍尔木兹条款"},
        {"relation_id": "REL-02", "execution_id": e, "requirement_id": "ER-03", "linked_judgment_unit_ids": "JU-03", "relation_type": "supplies", "source_instance_id": "INST-HE", "target_instance_id": "INST-CHAIN", "relation_scope": "helium_to_materials", "valid_from": "2026-01-01", "valid_to": "", "verification_status": "partial", "relation_evidence_strength": "medium", "source_run_refs": "SR-05|SR-06", "evidence_refs": "EV-06|EV-08", "notes": "氦气影响材料环节"},
    ]


def _reasoning_inputs_rows(e: str) -> list[dict[str, str]]:
    return [
        {"input_id": "RI-01", "execution_id": e, "requirement_id": "ER-01", "linked_judgment_unit_ids": "JU-01", "state_binding_ref": "SB-NEG-01", "observation_requirement_ref": "OR-NEG-01", "input_type": "event_observation", "target_instance_id": "INST-NEG", "anchor_instance_type": "Event", "primary_state_variable_id": "SV-NEG-SIGNAL", "supports_state_variable_ids": "SV-NEG-SIGNAL", "evidence_profile_refs": "EP-NEG-SIGNAL", "event_type": "negotiation_signal", "raw_value": "停火因言辞破裂但谈判继续", "raw_unit": "text", "normalized_value": "rhetoric_break_talks_continue", "normalized_unit": "enum", "currency": "", "direction": "mixed", "value_type": "qualitative", "data_granularity": "event", "is_forward_looking": "false", "business_time_start": "2026-07-09", "business_time_end": "2026-07-09", "publication_time": "2026-07-09T08:00:00Z", "scope": "美伊谈判", "statement_nature": "reported_fact", "verification_status": "verified", "source_run_refs": "SR-01", "evidence_refs": "EV-01", "transformation_ref": "", "notes": ""},
        {"input_id": "RI-02", "execution_id": e, "requirement_id": "ER-02", "linked_judgment_unit_ids": "JU-02", "state_binding_ref": "SB-PRICE-01", "observation_requirement_ref": "OR-PRICE-01", "input_type": "market_observation", "target_instance_id": "INST-CHAIN", "anchor_instance_type": "ValueChain", "primary_state_variable_id": "SV-SECTOR-PRICE", "supports_state_variable_ids": "SV-SECTOR-PRICE", "evidence_profile_refs": "EP-SECTOR-SENTIMENT", "event_type": "", "raw_value": "-2.1", "raw_unit": "pct", "normalized_value": "-2.1", "normalized_unit": "pct", "currency": "", "direction": "down", "value_type": "quantitative", "data_granularity": "daily", "is_forward_looking": "false", "business_time_start": "2026-07-09", "business_time_end": "2026-07-09", "publication_time": AS_OF, "scope": "A股半导体指数", "statement_nature": "data_point", "verification_status": "verified", "source_run_refs": "SR-04", "evidence_refs": "EV-04", "transformation_ref": "", "notes": ""},
        {"input_id": "RI-03", "execution_id": e, "requirement_id": "ER-03", "linked_judgment_unit_ids": "JU-03", "state_binding_ref": "SB-HZ-01", "observation_requirement_ref": "OR-HZ-01", "input_type": "logistics_observation", "target_instance_id": "INST-HZ", "anchor_instance_type": "LogisticsNode", "primary_state_variable_id": "SV-HORMUZ-ACTUAL", "supports_state_variable_ids": "SV-HORMUZ-ACTUAL|SV-HE-RESTART", "evidence_profile_refs": "EP-PHYSICAL-LAG", "event_type": "shipping_status", "raw_value": "霍尔木兹条款成谈判焦点MOU松动", "raw_unit": "text", "normalized_value": "hormuz_terms_contested", "normalized_unit": "enum", "currency": "", "direction": "constrained", "value_type": "qualitative", "data_granularity": "event", "is_forward_looking": "false", "business_time_start": "2026-07-09", "business_time_end": "2026-07-09", "publication_time": "2026-07-09T10:30:00Z", "scope": "霍尔木兹", "statement_nature": "reported_fact", "verification_status": "partial", "source_run_refs": "SR-02|SR-03", "evidence_refs": "EV-03|EV-05", "transformation_ref": "", "notes": ""},
        {"input_id": "RI-04", "execution_id": e, "requirement_id": "ER-05", "linked_judgment_unit_ids": "JU-04", "state_binding_ref": "SB-MAT-01", "observation_requirement_ref": "OR-MAT-01", "input_type": "supply_observation", "target_instance_id": "INST-CHAIN", "anchor_instance_type": "ValueChain", "primary_state_variable_id": "SV-MAT-LEAD", "supports_state_variable_ids": "SV-MAT-LEAD", "evidence_profile_refs": "EP-CHAIN-SPLIT", "event_type": "", "raw_value": "材料制造优先承压", "raw_unit": "text", "normalized_value": "materials_mfg_pressure_first", "normalized_unit": "enum", "currency": "", "direction": "up", "value_type": "qualitative", "data_granularity": "cross_section", "is_forward_looking": "true", "business_time_start": "2026-07-01", "business_time_end": "2026-09-30", "publication_time": "2026-07-07T00:00:00Z", "scope": "全球半导体全链", "statement_nature": "analysis", "verification_status": "partial", "source_run_refs": "SR-06", "evidence_refs": "EV-07", "transformation_ref": "", "notes": ""},
        {"input_id": "RI-05", "execution_id": e, "requirement_id": "ER-07", "linked_judgment_unit_ids": "JU-06", "state_binding_ref": "SB-CNMF-01", "observation_requirement_ref": "OR-CNMF-01", "input_type": "exposure_observation", "target_instance_id": "INST-CN", "anchor_instance_type": "RegionalExposure", "primary_state_variable_id": "SV-CN-MFG", "supports_state_variable_ids": "SV-CN-MFG|SV-CN-MATEQP|SV-CN-DESIGN", "evidence_profile_refs": "EP-CN-SEGMENTS", "event_type": "", "raw_value": "制造材料设备设计分化", "raw_unit": "text", "normalized_value": "cn_three_segment_split", "normalized_unit": "enum", "currency": "", "direction": "mixed", "value_type": "qualitative", "data_granularity": "cross_section", "is_forward_looking": "false", "business_time_start": "2026-01-01", "business_time_end": "2026-07-09", "publication_time": "2026-07-05T00:00:00+08:00", "scope": "中国半导体", "statement_nature": "analysis", "verification_status": "partial", "source_run_refs": "SR-07", "evidence_refs": "EV-10", "transformation_ref": "", "notes": ""},
    ]


def _evidence_records_rows(e: str) -> list[dict[str, str]]:
    claims = [
        ("EV-01", "ER-01", "EB-NEG-TIMELINE|EB-SCENARIO-BLOCK|EB-SANCTIONS", "JU-01|JU-05", "SR-01", "SRC-01", "2026-07-09", "Trump宣布因言辞破裂停火但幕后谈判继续", "reported_fact", "geopolitical", "停火 rhetoric break talks continue", "confirmed", "primary_support", "", "false", "false", "RI-01", "EP-NEG-SIGNAL", "SV-NEG-SIGNAL", "accepted", "medium", "direct", "high", "independent", "IG-NEWS-INTL", "current", "matched", "minor_conflict", "", "false", "medium", " rhetoric与MOU细节需交叉", ""),
        ("EV-02", "ER-01", "EB-NEG-TIMELINE|EB-NEG-STABLE", "JU-01", "SR-01", "SRC-01", "2026-07-09", "MOU因霍尔木兹通航条款分歧而松动", "reported_fact", "geopolitical", "MOU unraveling Hormuz terms", "confirmed", "primary_support", "", "false", "false", "RI-01", "EP-NEG-SIGNAL", "SV-NEG-SIGNAL", "accepted", "medium", "direct", "high", "independent", "IG-NEWS-INTL", "current", "matched", "minor_conflict", "", "false", "medium", "条款文本未获", ""),
        ("EV-03", "ER-01", "EB-NEG-TIMELINE|EB-PHYSICAL-FLOW", "JU-01|JU-03", "SR-02", "SRC-02", "2026-07-09", "霍尔木兹海峡条款成为谈判核心焦点", "reported_fact", "shipping", "Hormuz focal in negotiations", "confirmed", "primary_support", "", "false", "false", "RI-03", "EP-PHYSICAL-LAG", "SV-HORMUZ-ACTUAL|SV-NEG-SIGNAL", "accepted", "medium", "direct", "high", "independent", "IG-NEWS-INTL", "current", "matched", "no_material_conflict", "", "false", "medium", "", ""),
        ("EV-04", "ER-02", "EB-SECTOR-REACT|EB-CN-SENTIMENT", "JU-02|JU-06", "SR-04", "SRC-04", "2026-07-09", "谈判日前后半导体指数波动约2%", "data_point", "market", "sector index move ~2pct", "confirmed", "primary_support", "PX-01", "false", "false", "RI-02", "EP-SECTOR-SENTIMENT", "SV-SECTOR-PRICE", "accepted", "medium", "proxy", "high", "independent", "IG-MARKET", "current", "matched", "no_material_conflict", "", "false", "medium", "仅情绪通道代理", ""),
        ("EV-05", "ER-03", "EB-PHYSICAL-FLOW", "JU-03", "SR-03", "SRC-03", "2026-07-09", "谈判聚焦通航安全与护航安排", "reported_fact", "shipping", "transit security focus", "partial", "primary_support", "", "false", "false", "RI-03", "EP-PHYSICAL-LAG", "SV-HORMUZ-ACTUAL", "accepted", "medium", "indirect", "medium", "independent", "IG-NEWS-INTL", "current", "matched", "minor_conflict", "", "false", "medium", "缺航运硬统计", ""),
        ("EV-06", "ER-03", "EB-PHYSICAL-STUCK", "JU-03", "SR-05", "SRC-05", "2026-07-08", "停火不等于卡塔尔氦气供应立即恢复", "analysis", "helium", "ceasefire not immediate helium recovery", "confirmed", "counter_evidence", "", "true", "false", "RI-03", "EP-PHYSICAL-LAG", "SV-HE-RESTART", "accepted", "medium", "indirect", "medium", "independent", "IG-RESEARCH", "current", "matched", "no_material_conflict", "", "true", "medium", "咨询视角", ""),
        ("EV-07", "ER-05", "EB-CHAIN-SEG", "JU-04", "SR-06", "SRC-06", "2026-07-07", "氦气约束下材料与制造环节优先承压", "analysis", "semiconductor", "materials mfg first pressure", "partial", "cross_validation", "PX-02", "false", "true", "RI-04", "EP-CHAIN-SPLIT", "SV-MAT-LEAD", "accepted", "medium", "indirect", "medium", "independent", "IG-RESEARCH", "current", "matched", "no_material_conflict", "", "false", "medium", "情景分析", ""),
        ("EV-08", "ER-05", "EB-CHAIN-SEG", "JU-04", "SR-05", "SRC-05", "2026-07-08", "卡塔尔供应全球氦气约30-40%", "estimate", "helium", "Qatar 30-40pct global helium", "confirmed", "cross_validation", "", "false", "true", "RI-04", "EP-CHAIN-SPLIT", "SV-HE-RESTART|SV-MAT-LEAD", "accepted", "medium", "indirect", "medium", "independent", "IG-RESEARCH", "current", "matched", "no_material_conflict", "", "false", "medium", "GEP摘要", ""),
        ("EV-09", "ER-06", "EB-SCENARIO", "JU-05", "SR-06", "SRC-06", "2026-07-07", "谈妥与谈崩情景下全链影响边界框架", "scenario", "semiconductor", "deal vs break scenario bounds", "partial", "cross_validation", "", "false", "true", "", "EP-SCENARIO", "SV-NEG-SIGNAL|SV-HE-RESTART", "accepted", "medium", "indirect", "medium", "independent", "IG-RESEARCH", "forward", "matched", "minor_conflict", "", "false", "low", "非预测", ""),
        ("EV-10", "ER-07", "EB-CN-SEG", "JU-06", "SR-07", "SRC-07", "2026-07-05", "中国制造材料设备设计三类环节方向线索", "analysis", "china", "cn three segment directional clues", "partial", "primary_support", "", "false", "false", "RI-05", "EP-CN-SEGMENTS", "SV-CN-MFG|SV-CN-MATEQP|SV-CN-DESIGN", "accepted", "low", "indirect", "medium", "dependent", "IG-CN", "current", "matched", "minor_conflict", "", "false", "low", "转述层", ""),
        ("EV-11", "ER-02", "EB-PRICE-DECOUPLE", "JU-02", "SR-04", "SRC-04", "2026-07-09", "指数日内反弹显示头条与定价部分脱钩", "background", "market", "intraday rebound decouple", "partial", "counter_evidence", "", "true", "false", "RI-02", "EP-SECTOR-SENTIMENT", "SV-SECTOR-PRICE", "accepted", "medium", "proxy", "medium", "independent", "IG-MARKET", "current", "matched", "no_material_conflict", "", "true", "medium", "弱反证", ""),
        ("EV-12", "ER-05", "EB-CHAIN-FLAT", "JU-04", "SR-06", "SRC-06", "2026-07-07", "部分fab运营未报告显著扰动", "analysis", "semiconductor", "some fabs no reported disruption", "partial", "counter_evidence", "", "true", "false", "RI-04", "EP-CHAIN-SPLIT", "SV-MFG-ALLOC", "accepted", "low", "indirect", "low", "dependent", "IG-RESEARCH", "current", "partial", "not_checked", "", "true", "low", "缺厂侧硬数据", ""),
        ("EV-13", "ER-08", "EB-FAB-DISC", "JU-07", "SR-08", "SRC-08", "2026-07-09", "披露检索未找到谈判相关精确产量收入影响", "background", "financial", "no precise fab quant disclosure", "rejected", "blocking_condition", "", "false", "false", "", "EP-FAB-PRECISE", "SV-FAB-PRECISE", "rejected", "high", "direct", "high", "independent", "IG-FILING", "current", "matched", "not_applicable", "", "false", "low", "检索无匹配", ""),
    ]
    out = []
    for cid, req, baskets, ju, srun, src, sdate, claim, nature, domain, norm, fstatus, role, px, counter, xval, inputs, prof, svs, qstat, auth, direct, trace, indep, ig, trel, scope, conflict, cgroup, cflag, ceiling, ulimit, notes in claims:
        out.append({
            "evidence_id": cid, "execution_id": e, "requirement_id": req, "evidence_requirement_ids": req,
            "evidence_basket_ids": baskets, "linked_judgment_unit_ids": ju, "source_run_id": srun, "source_id": src,
            "source_date": sdate, "source_locator": "", "claim_text": claim, "statement_nature": nature,
            "content_domain": domain, "normalized_fact": norm, "fact_status": fstatus, "evidence_role": role,
            "proxy_indicator_id": px, "is_counter_evidence": counter, "is_cross_validation": xval,
            "grounds_input_ids": inputs, "evidence_profile_refs": prof, "state_variable_ids": svs,
            "quality_status": qstat, "source_authority": auth, "directness": direct, "traceability": trace,
            "independence": indep, "independence_group_id": ig, "time_relevance": trel, "scope_match": scope,
            "conflict_status": conflict, "conflict_group_id": cgroup, "counter_evidence_flag": cflag,
            "confidence_ceiling": ceiling, "usage_limit": ulimit, "quote_ref": "", "notes": notes,
        })
    return out


def _assessment_rows(e: str) -> list[dict[str, str]]:
    specs = [
        ("ERA-01", "JU-01", "双通道主导判断", "event_impact_judgment", "情绪与实物流双通道并存可区分", "P-01|P-02", "N-01|N-02|N-03", "REC-A01", "ER-01", "EB-NEG-TIMELINE|EB-NEG-STABLE", "partial", "partial", "checked", "directional_only", "SVC-01|SVC-02|SVC-03", "RI-01|RI-02|RI-03", "EV-01|EV-02|EV-03|EV-04|EV-05", "GAP-01", "谈判时间线+定价+实物流线索并存但MOU细节不足"),
        ("ERA-02", "JU-02", "情绪通道与预期差", "expectation_gap_judgment", "谈判头条与半导体定价存在可观察摆动", "P-01", "N-02", "REC-A07", "ER-02", "EB-SECTOR-REACT|EB-PRICE-DECOUPLE", "partial", "partial", "checked", "directional_only", "SVC-02", "RI-02", "EV-04|EV-11", "GAP-02", "指数代理可用但多指数交叉不足"),
        ("ERA-03", "JU-03", "实物流滞后", "event_impact_judgment", "谈妥预期下通航氦气仍滞后", "P-02", "N-03", "REC-A04", "ER-03", "EB-PHYSICAL-FLOW|EB-PHYSICAL-STUCK", "partial", "partial", "checked", "directional_only", "SVC-03|SVC-04", "RI-03", "EV-03|EV-05|EV-06", "GAP-03", "停火不等于氦气立即恢复"),
        ("ERA-04", "JU-04", "全链环节分化", "supply_chain_bottleneck_judgment", "五环节影响可条件性分化", "P-02", "N-04|N-05", "", "ER-04|ER-05", "EB-SANCTIONS|EB-CHAIN-SEG|EB-CHAIN-FLAT", "partial", "partial", "checked", "conditional_only", "SVC-05|SVC-06", "RI-04", "EV-07|EV-08|EV-12", "GAP-04|GAP-05", "缺设备封测设计硬交期订单"),
        ("ERA-05", "JU-05", "谈妥谈崩情景边界", "risk_monitoring_judgment", "两情景方向边界可条件表述", "P-03", "N-06", "", "ER-06", "EB-SCENARIO|EB-SCENARIO-BLOCK", "partial", "partial", "checked", "conditional_only", "SVC-01|SVC-04", "", "EV-01|EV-09", "GAP-06", "情景框架非硬预测"),
        ("ERA-06", "JU-06", "中国三类环节映射", "event_impact_judgment", "制造材料设备设计可分别映射", "P-03", "N-07", "", "ER-07", "EB-CN-SEG|EB-CN-SENTIMENT", "partial", "partial", "checked", "directional_only", "SVC-11|SVC-12|SVC-13", "RI-05", "EV-10|EV-04", "GAP-07", "转述层证据限制外推"),
        ("ERA-07", "JU-07", "精确量化停止", "company_earnings_elasticity_judgment", "精确fab产量收入影响不可判断", "P-03", "N-08", "", "ER-08", "EB-FAB-DISC", "missing", "missing", "checked", "insufficient", "SVC-14", "", "EV-13", "GAP-08", "无S1级精确披露匹配"),
    ]
    out = []
    for aid, ju, jname, jtype, claim, paths, nodes, recipe, reqs, baskets, support, xval, counter, allowed, cov, inputs, evs, gaps, reason in specs:
        out.append({
            "assessment_id": aid, "execution_id": e, "target_judgment_unit_id": ju, "judgment_unit_name": jname,
            "judgment_unit_type": jtype, "candidate_04_claim": claim, "linked_path_ids": paths, "linked_node_ids": nodes,
            "possible_view": claim, "target_recipe_id": recipe, "assessed_requirement_ids": reqs,
            "assessed_basket_ids": baskets, "required_evidence": "support+counter", "minimum_condition": "02最低验证",
            "required_counter_check": "必须", "support_status": support, "cross_validation_status": xval,
            "counter_status": counter, "conflict_status": "minor_conflict" if ju in {"JU-01", "JU-03", "JU-05", "JU-06"} else "no_material_conflict",
            "source_quality_status": "partial", "proxy_dependency_status": "moderate" if ju in {"JU-02", "JU-04", "JU-06"} else "low",
            "freshness_status": "partial" if support == "partial" else "missing", "traceability_status": "checked",
            "overall_readiness_status": allowed, "scope_limit": "不得写精确产量百分比" if ju != "JU-07" else "停止节点",
            "allowed_04_output": allowed, "confidence_ceiling": "medium" if allowed != "insufficient" else "low",
            "forbidden_04_outputs": "full_reasoning_ready" if allowed != "full_reasoning_ready" else "",
            "downgrade_reason": reason[:30], "gap_action": "补证据" if support != "met" else "",
            "linked_coverage_ids": cov, "linked_input_ids": inputs, "linked_evidence_ids": evs, "linked_gap_ids": gaps,
            "quality_status": "minimum_pass", "assessment_reason": reason, "notes": "",
        })
    return out


def _coverage_rows(e: str) -> list[dict[str, str]]:
    counted = {"SV-NEG-SIGNAL", "SV-SECTOR-PRICE", "SV-HORMUZ-ACTUAL", "SV-HE-RESTART", "SV-SANCTIONS-CHG", "SV-MAT-LEAD", "SV-CN-MFG", "SV-CN-MATEQP", "SV-CN-DESIGN"}
    rows = [
        ("SVC-01", "SV-NEG-SIGNAL", "谈判信号反复", "SB-NEG-01", "OR-NEG-01", "EP-NEG-SIGNAL", "N-01|N-06", "JU-01|JU-05", "RI-01", "EV-01|EV-02|EV-03", "GAP-01"),
        ("SVC-02", "SV-SECTOR-PRICE", "半导体板块定价", "SB-PRICE-01", "OR-PRICE-01", "EP-SECTOR-SENTIMENT", "N-02", "JU-01|JU-02", "RI-02", "EV-04", "GAP-02"),
        ("SVC-03", "SV-HORMUZ-ACTUAL", "霍尔木兹实际通航", "SB-HZ-01", "OR-HZ-01", "EP-PHYSICAL-LAG", "N-03", "JU-01|JU-03", "RI-03", "EV-03|EV-05", "GAP-03"),
        ("SVC-04", "SV-HE-RESTART", "氦气LNG复产状态", "SB-HE-01", "OR-HE-01", "EP-PHYSICAL-LAG", "N-03|N-06", "JU-03|JU-05", "RI-03", "EV-06|EV-08", "GAP-03"),
        ("SVC-05", "SV-SANCTIONS-CHG", "制裁贸易约束变化", "SB-SANC-01", "OR-SANC-01", "EP-CHAIN-SPLIT", "N-04", "JU-04", "", "EV-01", ""),
        ("SVC-06", "SV-MAT-LEAD", "材料交期", "SB-MAT-01", "OR-MAT-01", "EP-CHAIN-SPLIT", "N-05", "JU-04", "RI-04", "EV-07|EV-08", "GAP-04"),
        ("SVC-07", "SV-EQP-ORDER", "设备订单", "SB-EQP-01", "OR-EQP-01", "EP-CHAIN-SPLIT", "N-05", "JU-04", "", "", "GAP-05"),
        ("SVC-08", "SV-MFG-ALLOC", "制造投片配给", "SB-MFG-01", "OR-MFG-01", "EP-CHAIN-SPLIT", "N-05", "JU-04", "", "EV-12", "GAP-05"),
        ("SVC-09", "SV-OSAT-UTIL", "封测产能利用", "SB-OSAT-01", "OR-OSAT-01", "EP-CHAIN-SPLIT", "N-05", "JU-04", "", "", "GAP-05"),
        ("SVC-10", "SV-DESIGN-VIS", "设计订单能见度", "SB-DES-01", "OR-DES-01", "EP-CHAIN-SPLIT", "N-05", "JU-04", "", "", "GAP-05"),
        ("SVC-11", "SV-CN-MFG", "中国制造环节暴露", "SB-CNMF-01", "OR-CNMF-01", "EP-CN-SEGMENTS", "N-07", "JU-06", "RI-05", "EV-10", "GAP-07"),
        ("SVC-12", "SV-CN-MATEQP", "中国材料设备环节", "SB-CNME-01", "OR-CNME-01", "EP-CN-SEGMENTS", "N-07", "JU-06", "RI-05", "EV-10", "GAP-07"),
        ("SVC-13", "SV-CN-DESIGN", "中国设计环节情绪", "SB-CNDE-01", "OR-CNDE-01", "EP-CN-SEGMENTS", "N-07", "JU-06", "RI-05", "EV-10", "GAP-07"),
        ("SVC-14", "SV-FAB-PRECISE", "精确fab量化", "SB-PREC-01", "OR-PREC-01", "EP-FAB-PRECISE", "N-08", "JU-07", "", "EV-13", "GAP-08"),
    ]
    out = []
    for cid, sv, name, sb, orf, ep, nodes, ju, inp, ev, gap in rows:
        gate = "counted" if sv in counted else "not_counted"
        out.append({
            "coverage_id": cid, "execution_id": e, "linked_judgment_unit_ids": ju, "state_binding_ref": sb,
            "observation_requirement_refs": orf, "state_variable_id": sv, "state_variable_name": name,
            "evidence_profile_ref": ep, "used_by_path_nodes": nodes, "anchor_instance_id": "INST-CHAIN",
            "anchor_instance_type": "ValueChain", "linked_input_ids": inp, "linked_evidence_ids": ev,
            "linked_gap_ids": gap, "observation_count": "1" if ev else "0", "quantitative_count": "1" if sv == "SV-SECTOR-PRICE" else "0",
            "counter_evidence_count": "1" if sv in {"SV-NEG-SIGNAL", "SV-SECTOR-PRICE", "SV-HORMUZ-ACTUAL"} else "0",
            "mapping_status": "mapped" if ev else "unmapped", "profile_minimum_met": "true" if gate == "counted" else "false",
            "profile_gap_reasons": "" if gate == "counted" else "缺直接观测", "coverage_status": "partial" if gate == "counted" else "missing",
            "evidence_gate_status": gate, "evidence_gate_reason": "有证据支撑" if gate == "counted" else "无足够证据",
            "inference_allowed": "true" if gate == "counted" else "false",
            "allowed_04_output": "directional_only" if sv.startswith("SV-CN") or sv in {"SV-NEG-SIGNAL", "SV-SECTOR-PRICE", "SV-HORMUZ-ACTUAL", "SV-HE-RESTART"} else ("conditional_only" if sv in {"SV-SANCTIONS-CHG", "SV-MAT-LEAD"} else "insufficient"),
            "scope_limit": "不得精确量化" if sv != "SV-FAB-PRECISE" else "停止", "notes": "",
        })
    return out


def _path_readiness_rows(e: str) -> list[dict[str, str]]:
    nodes = [
        ("P-01", "情绪通道", "N-01", "谈判信号是否可观察", "JU-01", "critical", "ER-01", "SV-NEG-SIGNAL", "partial", "directional_only"),
        ("P-01", "情绪通道", "N-02", "半导体定价是否反应", "JU-02", "critical", "ER-02", "SV-SECTOR-PRICE", "partial", "directional_only"),
        ("P-02", "实物流通道", "N-03", "通航氦气是否跟进", "JU-03", "critical", "ER-03", "SV-HORMUZ-ACTUAL|SV-HE-RESTART", "partial", "directional_only"),
        ("P-02", "实物流通道", "N-04", "制裁贸易是否变化", "JU-04", "supporting", "ER-04", "SV-SANCTIONS-CHG", "partial", "conditional_only"),
        ("P-02", "实物流通道", "N-05", "全链环节能否分化", "JU-04", "critical", "ER-05", "SV-MAT-LEAD|SV-EQP-ORDER|SV-MFG-ALLOC|SV-OSAT-UTIL|SV-DESIGN-VIS", "partial", "conditional_only"),
        ("P-03", "情景与中国映射", "N-06", "谈妥谈崩边界", "JU-05", "supporting", "ER-06", "SV-NEG-SIGNAL|SV-HE-RESTART", "partial", "conditional_only"),
        ("P-03", "情景与中国映射", "N-07", "中国三类映射", "JU-06", "critical", "ER-07", "SV-CN-MFG|SV-CN-MATEQP|SV-CN-DESIGN", "partial", "directional_only"),
        ("P-03", "情景与中国映射", "N-08", "精确量化是否可得", "JU-07", "stop", "ER-08", "SV-FAB-PRECISE", "blocked", "insufficient"),
    ]
    out = []
    for pid, pname, nid, q, ju, crit, req, svs, ready, allowed in nodes:
        out.append({
            "path_id": pid, "path_name": pname, "node_id": nid, "node_question": q, "linked_judgment_unit_ids": ju,
            "criticality": crit, "requirement_ids": req, "state_variable_ids": svs,
            "variable_coverage_summary": "9/14 counted", "linked_instance_ids": "INST-NEG|INST-CHAIN",
            "linked_relation_ids": "REL-01", "linked_input_ids": "RI-01|RI-02|RI-03|RI-04|RI-05",
            "linked_evidence_ids": "EV-01|EV-04|EV-06|EV-07", "linked_gap_ids": "GAP-01|GAP-08",
            "instance_status": "partial", "evidence_status": "partial" if ready != "blocked" else "missing",
            "counter_evidence_status": "checked", "conflict_status": "minor_conflict", "scope_alignment": "aligned",
            "time_alignment": "aligned", "readiness_status": ready, "path_gate_status": "partial" if ready != "blocked" else "blocked",
            "admission": "restricted_pass", "allowed_04_output": allowed, "downgrade_reason": "覆盖率64.3%低于95%门槛", "notes": "",
        })
    return out


def _gaps_rows(e: str) -> list[dict[str, str]]:
    return [
        {"gap_id": "GAP-01", "execution_id": e, "gap_type": "evidence", "requirement_id": "ER-01", "linked_judgment_unit_ids": "JU-01", "path_id": "P-01", "node_id": "N-01", "affected_target_type": "judgment_unit", "affected_target_id": "JU-01", "material_unit": "", "description": "MOU原文与官方声明未获", "severity": "medium", "priority": "high", "impact_on_reasoning": "限制谈判细节确认", "impact_on_05": "", "allowed_04_output_after_gap": "directional_only", "blocks_04_output": "false", "attempted_source_ids": "SRC-01|SRC-02", "preferred_evidence_to_add": "官方文本", "acceptable_proxy": "false", "upgrade_condition": "获MOU条款", "suggested_next_step": "补官方来源", "return_action": "", "status": "open", "notes": ""},
        {"gap_id": "GAP-02", "execution_id": e, "gap_type": "coverage", "requirement_id": "ER-02", "linked_judgment_unit_ids": "JU-02", "path_id": "P-01", "node_id": "N-02", "affected_target_type": "state_variable", "affected_target_id": "SV-SECTOR-PRICE", "material_unit": "", "description": "仅单一指数代理", "severity": "low", "priority": "medium", "impact_on_reasoning": "情绪通道强度受限", "impact_on_05": "", "allowed_04_output_after_gap": "directional_only", "blocks_04_output": "false", "attempted_source_ids": "SRC-04", "preferred_evidence_to_add": "多指数", "acceptable_proxy": "true", "upgrade_condition": "多指数对齐", "suggested_next_step": "补全球半导体指数", "return_action": "", "status": "open", "notes": ""},
        {"gap_id": "GAP-03", "execution_id": e, "gap_type": "path", "requirement_id": "ER-03", "linked_judgment_unit_ids": "JU-03", "path_id": "P-02", "node_id": "N-03", "affected_target_type": "path_node", "affected_target_id": "N-03", "material_unit": "", "description": "缺航运硬统计验证通航", "severity": "high", "priority": "high", "impact_on_reasoning": "实物流滞后判断受限", "impact_on_05": "", "allowed_04_output_after_gap": "directional_only", "blocks_04_output": "false", "attempted_source_ids": "SRC-02|SRC-03", "preferred_evidence_to_add": "航运数据", "acceptable_proxy": "false", "upgrade_condition": "通航统计", "suggested_next_step": "补航运API", "return_action": "", "status": "open", "notes": ""},
        {"gap_id": "GAP-04", "execution_id": e, "gap_type": "proxy", "requirement_id": "ER-05", "linked_judgment_unit_ids": "JU-04", "path_id": "P-02", "node_id": "N-05", "affected_target_type": "judgment_unit", "affected_target_id": "JU-04", "material_unit": "", "description": "材料交期缺厂侧硬数据", "severity": "medium", "priority": "medium", "impact_on_reasoning": "全链分化仅条件性", "impact_on_05": "", "allowed_04_output_after_gap": "conditional_only", "blocks_04_output": "false", "attempted_source_ids": "SRC-05|SRC-06", "preferred_evidence_to_add": "交期订单", "acceptable_proxy": "true", "upgrade_condition": "两环节硬数据", "suggested_next_step": "补行业订单", "return_action": "", "status": "open", "notes": ""},
        {"gap_id": "GAP-05", "execution_id": e, "gap_type": "coverage", "requirement_id": "ER-05", "linked_judgment_unit_ids": "JU-04", "path_id": "P-02", "node_id": "N-05", "affected_target_type": "state_variable", "affected_target_id": "SV-EQP-ORDER", "material_unit": "", "description": "设备封测设计环节无观测", "severity": "high", "priority": "high", "impact_on_reasoning": "五环节分化不完整", "impact_on_05": "", "allowed_04_output_after_gap": "conditional_only", "blocks_04_output": "false", "attempted_source_ids": "", "preferred_evidence_to_add": "环节订单", "acceptable_proxy": "true", "upgrade_condition": "两环节覆盖", "suggested_next_step": "补设备订单", "return_action": "", "status": "open", "notes": ""},
        {"gap_id": "GAP-06", "execution_id": e, "gap_type": "other", "requirement_id": "ER-06", "linked_judgment_unit_ids": "JU-05", "path_id": "P-03", "node_id": "N-06", "affected_target_type": "judgment_unit", "affected_target_id": "JU-05", "material_unit": "", "description": "情景边界依赖咨询框架", "severity": "low", "priority": "low", "impact_on_reasoning": "情景非硬预测", "impact_on_05": "", "allowed_04_output_after_gap": "conditional_only", "blocks_04_output": "false", "attempted_source_ids": "SRC-06", "preferred_evidence_to_add": "触发信号清单", "acceptable_proxy": "false", "upgrade_condition": "两情景各一组信号", "suggested_next_step": "补触发指标", "return_action": "", "status": "open", "notes": ""},
        {"gap_id": "GAP-07", "execution_id": e, "gap_type": "source", "requirement_id": "ER-07", "linked_judgment_unit_ids": "JU-06", "path_id": "P-03", "node_id": "N-07", "affected_target_type": "judgment_unit", "affected_target_id": "JU-06", "material_unit": "", "description": "中国三类证据偏转述", "severity": "medium", "priority": "medium", "impact_on_reasoning": "外推受限", "impact_on_05": "", "allowed_04_output_after_gap": "directional_only", "blocks_04_output": "false", "attempted_source_ids": "SRC-07", "preferred_evidence_to_add": "公司披露", "acceptable_proxy": "true", "upgrade_condition": "三类各有披露", "suggested_next_step": "补A股披露", "return_action": "", "status": "open", "notes": ""},
        {"gap_id": "GAP-08", "execution_id": e, "gap_type": "evidence", "requirement_id": "ER-08", "linked_judgment_unit_ids": "JU-07", "path_id": "P-03", "node_id": "N-08", "affected_target_type": "judgment_unit", "affected_target_id": "JU-07", "material_unit": "", "description": "无fab精确产量收入披露", "severity": "high", "priority": "high", "impact_on_reasoning": "精确量化停止", "impact_on_05": "", "allowed_04_output_after_gap": "insufficient", "blocks_04_output": "true", "attempted_source_ids": "SRC-08", "preferred_evidence_to_add": "季报披露", "acceptable_proxy": "false", "upgrade_condition": "S1披露匹配", "suggested_next_step": "保持停止", "return_action": "", "status": "accepted", "notes": ""},
        {"gap_id": "GAP-09", "execution_id": e, "gap_type": "05_material", "requirement_id": "ER-02", "linked_judgment_unit_ids": "JU-02", "path_id": "P-01", "node_id": "N-02", "affected_target_type": "05_material", "affected_target_id": "chart_main", "material_unit": "chart_main", "description": "缺多时点指数序列", "severity": "medium", "priority": "medium", "impact_on_reasoning": "", "impact_on_05": "主图仅单点波动", "allowed_04_output_after_gap": "directional_only", "blocks_04_output": "false", "attempted_source_ids": "SRC-04", "preferred_evidence_to_add": "5日序列", "acceptable_proxy": "true", "upgrade_condition": "time_points>=5", "suggested_next_step": "补指数历史", "return_action": "", "status": "open", "notes": ""},
    ]


def _display_rows(e: str) -> list[dict[str, str]]:
    return [
        {"data_candidate_id": "DDC-01", "execution_id": e, "linked_judgment_unit_ids": "JU-02", "linked_input_ids": "RI-02", "linked_evidence_ids": "EV-04", "object": "A股半导体指数", "indicator": "日涨跌幅", "value_field": "normalized_value", "unit": "pct", "period": "2026-07-09", "grain": "daily", "source_ids": "SRC-04", "data_status": "partial", "visual_role": "quant_chart", "chart_readiness": "partial", "quantitative_or_qualitative": "quantitative", "time_points_count": "1", "comparison_baseline": "谈判日前一日", "ranking_support": "weak", "report_grade_status": "usable_with_caveat", "gap_to_report_grade": "需5日以上序列", "usage_limit": "情绪通道代理", "caveat": "单指数"},
        {"data_candidate_id": "DDC-02", "execution_id": e, "linked_judgment_unit_ids": "JU-01|JU-03", "linked_input_ids": "RI-01|RI-03", "linked_evidence_ids": "EV-01|EV-03|EV-05", "object": "美伊谈判与霍尔木兹", "indicator": "关键事件时间线", "value_field": "normalized_fact", "unit": "text", "period": "2026-03至2026-07", "grain": "event", "source_ids": "SRC-01|SRC-02|SRC-03", "data_status": "partial", "visual_role": "event_timeline", "chart_readiness": "partial", "quantitative_or_qualitative": "qualitative", "time_points_count": "4", "comparison_baseline": "", "ranking_support": "none", "report_grade_status": "usable_with_caveat", "gap_to_report_grade": "缺MOU原文节点", "usage_limit": "报道层", "caveat": "转述"},
        {"data_candidate_id": "DDC-03", "execution_id": e, "linked_judgment_unit_ids": "JU-03|JU-04", "linked_input_ids": "RI-03|RI-04", "linked_evidence_ids": "EV-06|EV-08", "object": "卡塔尔氦气", "indicator": "全球占比与韩国进口依赖", "value_field": "normalized_fact", "unit": "pct", "period": "2026", "grain": "cross_section", "source_ids": "SRC-05|SRC-06", "data_status": "partial", "visual_role": "supporting_table", "chart_readiness": "partial", "quantitative_or_qualitative": "mixed", "time_points_count": "2", "comparison_baseline": "GEP/LightSource", "ranking_support": "medium", "report_grade_status": "usable_with_caveat", "gap_to_report_grade": "韩国65%依赖需二次核实", "usage_limit": "咨询估算", "caveat": "非厂侧"},
    ]


def _chart_rows(e: str) -> list[dict[str, str]]:
    return [
        {"figure_id": "FIG-01", "execution_id": e, "suggested_title": "谈判窗口半导体指数波动", "evidence_role": "primary_support", "data_candidate_ids": "DDC-01", "required_fields": "date|normalized_value", "available_fields": "date|normalized_value", "source_ids": "SRC-04", "chart_type_suggestion": "line", "chart_readiness": "partial", "report_grade_status": "usable_with_caveat", "evidence_message": "单日波动可见", "usage_limit": "代理指标", "gap_to_ready": "需多日序列"},
        {"figure_id": "FIG-02", "execution_id": e, "suggested_title": "谈判—霍尔木兹—氦气事件时间线", "evidence_role": "cross_validation", "data_candidate_ids": "DDC-02", "required_fields": "event_date|normalized_fact", "available_fields": "event_date|normalized_fact", "source_ids": "SRC-01|SRC-02|SRC-03", "chart_type_suggestion": "timeline", "chart_readiness": "partial", "report_grade_status": "usable_with_caveat", "evidence_message": "四节点时间线", "usage_limit": "报道事实", "gap_to_ready": "补官方节点"},
    ]


def _table_rows(e: str) -> list[dict[str, str]]:
    return [
        {"table_id": "TBL-01", "execution_id": e, "table_role": "evidence_summary", "suggested_title": "核心证据与限制", "row_objects": "JU-01|JU-02|JU-03", "columns_available": "claim|source|limit", "source_ids": "SRC-01|SRC-04", "linked_evidence_ids": "EV-01|EV-04|EV-06", "readiness": "partial", "ranking_support": "none", "usage_limit": "摘要表"},
        {"table_id": "TBL-02", "execution_id": e, "table_role": "scenario", "suggested_title": "谈妥谈崩情景边界", "row_objects": "deal|break", "columns_available": "direction|magnitude_bound|trigger", "source_ids": "SRC-06", "linked_evidence_ids": "EV-09", "readiness": "partial", "ranking_support": "weak", "usage_limit": "条件情景"},
        {"table_id": "TBL-03", "execution_id": e, "table_role": "gap_plan", "suggested_title": "主要证据缺口", "row_objects": "GAP-01|GAP-03|GAP-08", "columns_available": "gap|priority|next_step", "source_ids": "", "linked_evidence_ids": "", "readiness": "ready", "ranking_support": "none", "usage_limit": "缺口规划"},
    ]


def _annotation_rows(e: str) -> list[dict[str, str]]:
    return [
        {"annotation_id": "ANN-01", "execution_id": e, "source_id": "SRC-01", "evidence_ids": "EV-01|EV-02", "citation_phrase": "据美联社2026年7月9日报道，特朗普宣布因言辞破裂停火但谈判仍在继续", "source_type": "wire", "published_at": "2026-07-09T08:00:00Z", "business_time": "2026-07-09", "data_scope": "美伊谈判", "method_or_metric": "现场报道", "supports_material_unit": "main_narrative", "usage_limit": "转述需交叉", "permission_note": "公开网页"},
        {"annotation_id": "ANN-02", "execution_id": e, "source_id": "SRC-05", "evidence_ids": "EV-06|EV-08", "citation_phrase": "GEP指出停火不意味着氦气供应立即恢复，卡塔尔约占全球氦气30-40%", "source_type": "advisory", "published_at": "2026-07-08T00:00:00Z", "business_time": "2026", "data_scope": "氦气供应链", "method_or_metric": "采购咨询估算", "supports_material_unit": "supply_context", "usage_limit": "非厂侧硬数据", "permission_note": "公开摘要"},
        {"annotation_id": "ANN-03", "execution_id": e, "source_id": "SRC-06", "evidence_ids": "EV-07|EV-09", "citation_phrase": "LightSource分析氦气约束下材料制造环节优先承压并给出谈妥谈崩边界框架", "source_type": "blog", "published_at": "2026-07-07T00:00:00Z", "business_time": "2026", "data_scope": "全球半导体", "method_or_metric": "行业情景", "supports_material_unit": "scenario_table", "usage_limit": "情景非预测", "permission_note": "公开网页"},
    ]


def _material_rows(e: str) -> list[dict[str, str]]:
    return [
        {"material_unit_id": "MU-01", "execution_id": e, "target_05_archetype": "event_commentary", "material_unit": "main_narrative", "status": "usable_with_caveat", "linked_judgment_unit_ids": "JU-01|JU-03", "linked_data_candidate_ids": "DDC-02", "linked_chart_ids": "FIG-02", "linked_table_ids": "TBL-01", "source_annotation_ids": "ANN-01", "impact_on_05": "可写事件主线但需标注MOU缺口", "required_action": "补官方来源"},
        {"material_unit_id": "MU-02", "execution_id": e, "target_05_archetype": "event_commentary", "material_unit": "chart_main", "status": "partial", "linked_judgment_unit_ids": "JU-02", "linked_data_candidate_ids": "DDC-01", "linked_chart_ids": "FIG-01", "linked_table_ids": "", "source_annotation_ids": "", "impact_on_05": "主图仅单日点", "required_action": "补指数序列"},
        {"material_unit_id": "MU-03", "execution_id": e, "target_05_archetype": "event_commentary", "material_unit": "scenario_table", "status": "usable_with_caveat", "linked_judgment_unit_ids": "JU-05", "linked_data_candidate_ids": "", "linked_chart_ids": "", "linked_table_ids": "TBL-02", "source_annotation_ids": "ANN-03", "impact_on_05": "情景表可用但需限制", "required_action": "标注条件性"},
        {"material_unit_id": "MU-04", "execution_id": e, "target_05_archetype": "event_commentary", "material_unit": "supply_context", "status": "usable_with_caveat", "linked_judgment_unit_ids": "JU-03|JU-04", "linked_data_candidate_ids": "DDC-03", "linked_chart_ids": "", "linked_table_ids": "", "source_annotation_ids": "ANN-02", "impact_on_05": "氦气背景可展示", "required_action": "核实韩国依赖数据"},
    ]


def _manifest_row(e: str) -> dict[str, str]:
    objs = "美伊谈判进程|霍尔木兹通航与中东出口|全球半导体全链|中国半导体板块|中国制造环节|中国材料与设备环节|中国设计环节"
    return {
        "task_id": TASK, "execution_id": e, "plan_id": PLAN, "source_02_view_id": VIEW, "source_02_logic_id": LOGIC,
        "source_02_view_ref": F02Y, "source_02_logic_ref": F02M, "source_02_view_hash": VIEW_HASH,
        "preparation_ref": F03M, "snapshot_summary_ref": F03S,
        "execution_date": DATE, "timezone": "Asia/Shanghai", "data_cutoff": AS_OF,
        "resolved_anchor_date": DATE, "resolved_start": "2026-01-01", "resolved_end": "2027-12-31", "resolved_at": AS_OF,
        "resolved_objects": objs, "source_registry_version": "ad-hoc-public-web-20260709-v1",
        "recipe_library_version": "1.0.0", "snapshot_version": "1.2.0", "snapshot_schema_version": "1.2.0",
        "created_at": AS_OF, "state_variable_coverage_summary": f"total={COV_TOTAL}|counted={COV_COUNTED}|rate=64.29%",
        "coverage_unit_total": str(COV_TOTAL), "evidence_backed_unit_count": str(COV_COUNTED),
        "evidence_coverage_rate": COV_RATE, "required_coverage_rate": "0.95",
        "critical_node_gate_status": "partial", "judgment_unit_total": str(JU_TOTAL),
        "judgment_unit_full_reasoning_ready_count": "0", "judgment_unit_directional_only_count": str(JU_DIR),
        "judgment_unit_conditional_only_count": str(JU_COND), "judgment_unit_insufficient_count": str(JU_INSUF),
        "judgment_unit_blocked_count": "0", "judgment_unit_contested_count": "0",
        "evidence_requirements_ref": "01_plan/evidence_requirements.csv",
        "evidence_recipe_matches_ref": "01_plan/evidence_recipe_matches.csv",
        "evidence_baskets_ref": "01_plan/evidence_baskets.csv",
        "source_profiles_ref": "01_plan/source_profiles.csv",
        "acquisition_channels_ref": "01_plan/acquisition_channels.csv",
        "proxy_indicators_ref": "01_plan/proxy_indicators.csv",
        "evidence_readiness_assessments_ref": "03_gate/evidence_readiness_assessments.csv",
        "display_data_candidates_ref": "04_05_materials/display_data_candidates.csv",
        "chart_data_package_ref": "04_05_materials/chart_data_package.csv",
        "table_material_package_ref": "04_05_materials/table_material_package.csv",
        "source_annotation_package_ref": "04_05_materials/source_annotation_package.csv",
        "gaps_and_risks_ref": "03_gate/gaps_and_risks.csv",
        "05_material_readiness_ref": "04_05_materials/05_material_readiness.csv",
        "search_status": "threshold_not_met", "admission": "restricted_pass", "evidence_quality_level": "medium",
        "allowed_scope": "JU-01至JU-06可方向性或条件性推理；JU-07停止",
        "disallowed_scope": "精确fab产量收入百分比、个股评级目标价仓位建议",
        "confidence_ceiling": "medium", "quality_status": "minimum_pass",
        "deterministic_check_status": "checked", "semantic_review_status": "reviewed",
        "return_required": "false", "return_stage": "", "notes": "示例2美伊谈判半导体03快照",
    }


def build_prep_md() -> None:
    objs = [
        "美伊谈判进程", "霍尔木兹通航与中东出口", "全球半导体全链", "中国半导体板块",
        "中国制造环节", "中国材料与设备环节", "中国设计环节",
    ]
    yaml_objs = "\n".join(f"- {o}" for o in objs)
    body = f"""# {THEME}数据与证据准备

## 1. 本次范围

| 项目 | 本次取值 |
|------|----------|
| 判断任务 | {TASK} |
| 运行 ID | {EXEC} |
| 02 研究逻辑与本体视图 | `{F02M}` / {LOGIC}；`{F02Y}` / {VIEW} |
| 执行日期与数据截止时点 | {DATE}；{AS_OF} |
| 实际时间范围 | 2026-01-01 至 2027-12-31 |
| 实际对象集合 | 美伊谈判、霍尔木兹、全球半导体全链、中国板块三类环节 |
| 目标 05 原型 | event_commentary |
| 数据源与配方版本 | ad-hoc-public-web-20260709-v1；1.0.0 |
| 03 质量门引用 | `00A_高质量产出判别标准.md#5.3` |

## 2. 02 交接基线

### 2.1 状态变量交接基线

14个状态变量自02视图交接；9个已达evidence_gate counted。

### 2.2 判断单元交接基线

7个判断单元；JU-01至JU-06可受限推理，JU-07为停止节点。

## 3. 数据与证据需求

8条evidence_requirement覆盖7个判断单元；见快照 `01_plan/evidence_requirements.csv`。

## 4. 来源与取数方式

采用AP/Axios新闻、GEP/LightSource咨询、指数行情与披露检索四通道。

## 5. 处理与本体映射

新闻与咨询材料映射为谈判事件、霍尔木兹通航、氦气复产与全链暴露实例。

## 6. 核心判断单元证据门槛

| judgment_unit_id | allowed_04_output | 处理 |
|------------------|-------------------|------|
| JU-01 | directional_only | 放行 |
| JU-02 | directional_only | 放行 |
| JU-03 | directional_only | 放行 |
| JU-04 | conditional_only | 降级 |
| JU-05 | conditional_only | 降级 |
| JU-06 | directional_only | 放行 |
| JU-07 | insufficient | 停止 |

## 7. 覆盖与路径就绪状态

覆盖率 {COV_COUNTED}/{COV_TOTAL}（{float(COV_RATE)*100:.2f}%），低于95%门槛；关键路径节点部分就绪。

## 8. 05 可展示数据支持

提供谈判时间线、指数波动与氦气占比三类展示候选；图表与表格素材为usable_with_caveat或partial。

## 9. 准入结论

| 项目 | 本次结果 |
|------|----------|
| 包级准入状态 | restricted_pass |
| 证据包可信程度 | medium |
| 04 置信度上限 | medium |
| 核心判断单元门槛状态 | partial |
| 允许 04 使用范围 | JU-01/02/03/06方向性；JU-04/05条件性 |
| 不允许 04 使用范围 | JU-07精确量化 |
| 05 成稿素材状态 | usable_with_caveat |
| 主要缺口 | MOU原文、航运硬数据、fab披露 |

## 10. 快照文件索引

快照目录 `{SNAP}/` 含四层CSV与manifest；摘要见 `{F03S}`。

## 11. 03 质量门槛检查

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 数据需求绑定 02 判断单元 | pass | 8条需求对齐7单元 |
| 每个正式取证项先有 evidence_requirement 和 evidence_recipe | pass | 配方匹配已登记 |
| 必需证据篮子满足或已降级 | pass | 篮子状态已记录 |
| 核心判断单元证据门槛逐项判断 | pass | 7条ERA |
| 来源直接、独立、可复核 | partial | 咨询层转述 |
| SourceProfile、推荐来源和取数通道匹配需求 | pass | 已结构化 |
| 口径匹配 | partial | 指数代理限用 |
| 反证和竞争解释已检查 | pass | 反证篮子已查 |
| 代理指标已披露且未替代直接证据 | pass | PX-01/02已登记 |
| 04 使用上限清楚 | pass | 见ERA |
| 05 可展示数据候选可追溯 | pass | DDC-01至03 |
| 05 图表/表格/来源注释素材状态清楚 | pass | FIG/TBL/ANN已登记 |
| 未用覆盖率替代结论充分性 | pass | JU-07保持insufficient |

**质量结论：** `minimum_pass`

**返工要求：** 无需退回02；建议补MOU原文与航运硬数据。
"""
    front = f"""---
document_type: data_evidence_preparation
schema_version: 1.2.0
task_id: {TASK}
execution_id: {EXEC}
plan_id: {PLAN}
source_02_view_id: {VIEW}
source_02_logic_id: {LOGIC}
source_02_view_ref: {F02Y}
source_02_logic_ref: {F02M}
execution_date: '{DATE}'
timezone: Asia/Shanghai
data_cutoff: '{AS_OF}'
resolved_anchor_date: '{DATE}'
resolved_start: '2026-01-01'
resolved_end: '2027-12-31'
resolved_at: '{AS_OF}'
resolved_objects:
{yaml_objs}
target_05_archetype: event_commentary
target_05_quality: minimum_pass
source_registry_version: ad-hoc-public-web-20260709-v1
recipe_library_version: '1.0.0'
snapshot_ref: {SNAP}/manifest.csv
snapshot_summary_ref: {F03S}
preparation_status: completed
quality_status: minimum_pass
quality_gate_ref: 00A_高质量产出判别标准.md#5.3
admission: restricted_pass
evidence_quality_level: medium
confidence_ceiling: medium
coverage_unit_total: {COV_TOTAL}
evidence_backed_unit_count: {COV_COUNTED}
evidence_coverage_rate: {COV_RATE}
required_coverage_rate: 0.95
critical_node_gate_status: partial
judgment_unit_gate_status: partial
search_status: threshold_not_met
allowed_04_output: directional_only
allowed_05_output: limited_report
return_required: false
return_stage: null
---
"""
    (OUT / F03M).write_text(front + body, encoding="utf-8")


def build_summary_md() -> None:
    body = f"""# {THEME}数据与证据快照

## 1. 整体结果

| 项目 | 本次结果 |
|---|---|
| 证据包可信程度 | medium |
| 准入结果 | restricted_pass |
| 证据覆盖单元 | {COV_COUNTED}/{COV_TOTAL} |
| 证据覆盖率 / 门槛 | 64.29% / 95% |
| 关键节点门槛 | partial |
| 核心判断单元门槛 | directional_only=4 / conditional_only=2 / insufficient=1 |
| 搜索状态 | threshold_not_met |
| 可使用范围 | 双通道主导、情绪定价、实物流滞后、中国三类映射 |
| 不可使用范围 | 精确fab量化、个股投资建议 |
| 04 结论置信度上限 | medium |
| 能否进入 04 | 受限推理 |
| 02 研究逻辑与本体视图 | `{F02M}` / `{F02Y}` |
| 质量状态 | minimum_pass |

## 2. 为什么得到这一结果

### 2.1 支持这一等级的主要依据

- AP/Axios 2026-07-09报道：停火因言辞破裂但谈判继续，MOU因霍尔木兹条款松动，霍尔木兹为谈判焦点。
- GEP/LightSource：卡塔尔氦气约占全球30-40%，停火不意味着氦气立即恢复。

### 2.2 为什么不能更高

- 覆盖率64.3%低于95%门槛；设备/封测/设计环节与fab精确量化缺口明显。

## 3. 文件索引

见 `{SNAP}/manifest.csv` 与各层CSV。
"""
    front = f"""---
document_type: data_evidence_snapshot_summary
schema_version: 1.2.0
task_id: {TASK}
execution_id: {EXEC}
snapshot_version: 1.2.0
preparation_ref: {F03M}
snapshot_directory: {SNAP}/
admission: restricted_pass
evidence_quality_level: medium
confidence_ceiling: medium
coverage_unit_total: {COV_TOTAL}
evidence_backed_unit_count: {COV_COUNTED}
evidence_coverage_rate: {COV_RATE}
required_coverage_rate: 0.95
critical_node_gate_status: partial
judgment_unit_total: {JU_TOTAL}
search_status: threshold_not_met
quality_status: minimum_pass
quality_gate_ref: 00A_高质量产出判别标准.md#5.3
generated_at: '{AS_OF}'
---
"""
    path = OUT / SNAP / f"03-{THEME}数据与证据快照-{RUN}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(front + body, encoding="utf-8")


def main() -> None:
    snap_dir = OUT / SNAP
    if snap_dir.exists():
        import shutil
        shutil.rmtree(snap_dir)
    build_csvs()
    build_prep_md()
    build_summary_md()
    print(f"Built 03 deliverables under {OUT}")


if __name__ == "__main__":
    main()
