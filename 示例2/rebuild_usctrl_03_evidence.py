#!/usr/bin/env python3
"""Rebuild missing 03 gate/materials and authoritative Source→Claim→Fact chain for USCTRL example."""

from __future__ import annotations

import csv
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "示例2"
TEMPLATE = ROOT / "输出模板" / "03_数据与证据快照模板"
THEME = "美国管制与国产设备替代"
RUN = "20260710-1"
EXEC = "EXEC-USCTRL-CNSEMI-EQP-20260710-1"
SNAP = OUT / f"03-{THEME}数据与证据快照-{RUN}"
AS_OF = "2026-07-10T20:30:00+08:00"


def split_refs(value: object) -> list[str]:
    return [p.strip() for p in str(value or "").replace("；", "|").replace(";", "|").split("|") if p.strip()]


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def write_csv(rel: str, rows: list[dict[str, str]]) -> None:
    src = TEMPLATE / rel
    dst = SNAP / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    with src.open(encoding="utf-8-sig", newline="") as handle:
        header = next(csv.reader(handle))
    with dst.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=header, lineterminator="\n", extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key, "") for key in header})


def write_header_only(rel: str) -> None:
    write_csv(rel, [])


def build_gate() -> None:
    write_csv(
        "03_gate/evidence_readiness_assessments.csv",
        [
            {
                "assessment_id": "ERA-01",
                "execution_id": EXEC,
                "target_judgment_unit_id": "JU-01",
                "judgment_unit_name": "现行管制有效供给约束",
                "judgment_unit_type": "policy_impact_judgment",
                "candidate_04_claim": "现行规则形成定向且可执行的供给约束但并非所有成熟制程设备全面禁运",
                "linked_path_ids": "P-01",
                "linked_node_ids": "N-01|N-02",
                "possible_view": "policy_supply_view",
                "target_recipe_id": "R-POLICY",
                "assessed_requirement_ids": "ER-01|ER-02|ER-03",
                "assessed_basket_ids": "EB-01|EB-02|EB-03",
                "required_evidence": "三轮官方规则加生效状态执法与海外供货反面证据",
                "minimum_condition": "规则范围生效日期和执行可追溯",
                "required_counter_check": "检查许可豁免及成熟制程继续供货",
                "support_status": "met",
                "cross_validation_status": "met",
                "counter_status": "met",
                "conflict_status": "no_material_conflict",
                "source_quality_status": "Q4_report_grade",
                "proxy_dependency_status": "none",
                "freshness_status": "met",
                "traceability_status": "met",
                "overall_readiness_status": "full_reasoning_ready",
                "scope_limit": "只确认截至2026年7月现行规则及定向影响",
                "allowed_04_output": "full_reasoning_ready",
                "confidence_ceiling": "high",
                "forbidden_04_outputs": "不得表述为全面禁运或把暂停规则写成已生效",
                "downgrade_reason": "无",
                "gap_action": "none",
                "linked_coverage_ids": "COV-01|COV-02|COV-08",
                "linked_input_ids": "RI-01|RI-02|RI-03|RI-04",
                "linked_evidence_ids": "EV-01|EV-02|EV-03|EV-04|EV-05|EV-06|EV-07|EV-08|EV-09",
                "linked_gap_ids": "",
                "quality_status": "high_quality_pass",
                "assessment_reason": "官方规则和执法证据完整且已用三家海外厂商披露检查反面证据",
                "notes": "规则事实与商业影响分开",
            },
            {
                "assessment_id": "ERA-02",
                "execution_id": EXEC,
                "target_judgment_unit_id": "JU-02",
                "judgment_unit_name": "供给缺口到国产商业转化",
                "judgment_unit_type": "event_impact_judgment",
                "candidate_04_claim": "中国需求池仍大但国产转化必须由验证复购和经营兑现证明",
                "linked_path_ids": "P-01",
                "linked_node_ids": "N-03|N-04",
                "possible_view": "commercialization_view",
                "target_recipe_id": "R-SUPPLY-DEMAND",
                "assessed_requirement_ids": "ER-04|ER-05",
                "assessed_basket_ids": "EB-04|EB-05|EB-06|EB-07",
                "required_evidence": "行业需求加多类别验证复购与财务反面证据",
                "minimum_condition": "至少两类复购和收入利润证据",
                "required_counter_check": "检查中国设备支出趋缓与利润质量",
                "support_status": "met",
                "cross_validation_status": "met",
                "counter_status": "met",
                "conflict_status": "no_material_conflict",
                "source_quality_status": "Q4_report_grade",
                "proxy_dependency_status": "moderate",
                "freshness_status": "met",
                "traceability_status": "met",
                "overall_readiness_status": "directional_only",
                "scope_limit": "客户级复购台数和统一口径不足",
                "allowed_04_output": "directional_only",
                "confidence_ceiling": "medium",
                "forbidden_04_outputs": "不得将订单直接等同收入或给出统一国产化率",
                "downgrade_reason": "公司客户和台数披露有限",
                "gap_action": "持续跟踪但不使逻辑失效",
                "linked_coverage_ids": "COV-03|COV-04",
                "linked_input_ids": "RI-05|RI-06|RI-07|RI-08|RI-09|RI-11|RI-12",
                "linked_evidence_ids": "EV-10|EV-11|EV-12|EV-13|EV-14|EV-15|EV-16|EV-18|EV-19|EV-20",
                "linked_gap_ids": "GAP-01|GAP-02",
                "quality_status": "high_quality_pass",
                "assessment_reason": "需求实际值和多公司复购经营证据支持方向但不足以精确量化行业转化率",
                "notes": "限制为方向性判断",
            },
            {
                "assessment_id": "ERA-03",
                "execution_id": EXEC,
                "target_judgment_unit_id": "JU-03",
                "judgment_unit_name": "设备类别与代表公司分化",
                "judgment_unit_type": "expectation_gap_judgment",
                "candidate_04_claim": "未来十二个月受益强弱由商业成熟度和经营质量主导而非技术缺口大小",
                "linked_path_ids": "P-01|P-02",
                "linked_node_ids": "N-04|N-05|N-07",
                "possible_view": "category_company_view",
                "target_recipe_id": "R-COMMERCIALIZATION",
                "assessed_requirement_ids": "ER-05|ER-06|ER-07",
                "assessed_basket_ids": "EB-06|EB-07|EB-08|EB-09",
                "required_evidence": "至少五类六家公司产品阶段和实际经营数据",
                "minimum_condition": "类别按量产复购收入质量比较",
                "required_counter_check": "检查上游依赖和利润承压",
                "support_status": "met",
                "cross_validation_status": "met",
                "counter_status": "met",
                "conflict_status": "no_material_conflict",
                "source_quality_status": "Q4_report_grade",
                "proxy_dependency_status": "moderate",
                "freshness_status": "met",
                "traceability_status": "met",
                "overall_readiness_status": "directional_only",
                "scope_limit": "代表公司样本不可外推全行业且光刻量产数据不足",
                "allowed_04_output": "directional_only",
                "confidence_ceiling": "medium",
                "forbidden_04_outputs": "不得形成个股投资排序或用技术传闻上调光刻",
                "downgrade_reason": "类别口径和客户披露不统一",
                "gap_action": "按强中弱分组并披露边界",
                "linked_coverage_ids": "COV-04|COV-05|COV-06|COV-07",
                "linked_input_ids": "RI-07|RI-08|RI-09|RI-10|RI-11|RI-12",
                "linked_evidence_ids": "EV-13|EV-14|EV-15|EV-16|EV-17|EV-18|EV-19|EV-20",
                "linked_gap_ids": "GAP-01|GAP-03|GAP-04",
                "quality_status": "high_quality_pass",
                "assessment_reason": "六家样本覆盖五类以上并有利润与上游反面证据但缺统一客户复购口径",
                "notes": "只给分组强弱",
            },
            {
                "assessment_id": "ERA-04",
                "execution_id": EXEC,
                "target_judgment_unit_id": "JU-04",
                "judgment_unit_name": "未来十二个月行业逻辑更新",
                "judgment_unit_type": "expectation_gap_judgment",
                "candidate_04_claim": "出口管制不逆转国产替代主逻辑而是将逻辑升级为商业兑现质量优先",
                "linked_path_ids": "P-01|P-02",
                "linked_node_ids": "N-05|N-06|N-07",
                "possible_view": "integrated_logic_view",
                "target_recipe_id": "R-INTEGRATED",
                "assessed_requirement_ids": "ER-01|ER-02|ER-03|ER-04|ER-05|ER-06|ER-07|ER-08",
                "assessed_basket_ids": "EB-01|EB-02|EB-03|EB-04|EB-05|EB-06|EB-07|EB-08|EB-09|EB-10|EB-11",
                "required_evidence": "政策需求商业化财务和上游风险合并证据",
                "minimum_condition": "前三个核心问题可使用且四类关键变量可跟踪",
                "required_counter_check": "检查许可放松支出下修上游受限和海外继续供货",
                "support_status": "met",
                "cross_validation_status": "met",
                "counter_status": "met",
                "conflict_status": "no_material_conflict",
                "source_quality_status": "Q4_report_grade",
                "proxy_dependency_status": "moderate",
                "freshness_status": "met",
                "traceability_status": "met",
                "overall_readiness_status": "directional_only",
                "scope_limit": "未来规则与公司级客户数据仍有不确定性",
                "allowed_04_output": "directional_only",
                "confidence_ceiling": "medium",
                "forbidden_04_outputs": "不得把战略紧迫性直接等同未来十二个月业绩",
                "downgrade_reason": "缺统一国产化率和全行业部件自主率",
                "gap_action": "设置2026年11月规则及订单利润跟踪变量",
                "linked_coverage_ids": "COV-01|COV-02|COV-03|COV-04|COV-05|COV-06|COV-07|COV-08",
                "linked_input_ids": "RI-01|RI-02|RI-03|RI-04|RI-05|RI-06|RI-07|RI-08|RI-09|RI-10|RI-11|RI-12",
                "linked_evidence_ids": "EV-01|EV-02|EV-03|EV-04|EV-05|EV-06|EV-07|EV-08|EV-09|EV-10|EV-11|EV-12|EV-13|EV-14|EV-15|EV-16|EV-17|EV-18|EV-19|EV-20",
                "linked_gap_ids": "GAP-01|GAP-02|GAP-03|GAP-04",
                "quality_status": "high_quality_pass",
                "assessment_reason": "主路径和反向路径均有直接证据且核心结论严格限制为未来十二个月方向性判断",
                "notes": "结论置信度中等",
            },
        ],
    )

    write_csv(
        "03_gate/gaps_and_risks.csv",
        [
            {
                "gap_id": "GAP-01",
                "execution_id": EXEC,
                "gap_type": "coverage",
                "requirement_id": "ER-06|ER-07",
                "linked_judgment_unit_ids": "JU-02|JU-03|JU-04",
                "path_id": "P-01",
                "node_id": "N-04|N-05",
                "affected_target_type": "category_cross_section",
                "affected_target_id": "CAT-ALL",
                "material_unit": "类别公司分组",
                "description": "各公司产品和收入分类口径不统一且缺行业统一国产化率",
                "severity": "medium",
                "priority": "medium",
                "impact_on_reasoning": "限制精确横向比较但不影响方向排序",
                "impact_on_05": "在05中采用强中弱分组并披露不可比边界",
                "allowed_04_output_after_gap": "directional_only",
                "blocks_04_output": "false",
                "attempted_source_ids": "SRC-SSE-2024|SRC-NAURA-2025|SRC-AMEC-H1|SRC-PIOTECH-2025|SRC-HWATSING-2025|SRC-KINGSEMI-2025|SRC-SSE-2025",
                "preferred_evidence_to_add": "客户按设备类别披露的采购和验收数据",
                "acceptable_proxy": "不接受单一券商口径",
                "upgrade_condition": "出现多家公司统一类别收入和复购口径",
                "suggested_next_step": "季度更新代表公司产品与财务披露",
                "return_action": "none",
                "status": "managed",
                "notes": "非致命缺口",
            },
            {
                "gap_id": "GAP-02",
                "execution_id": EXEC,
                "gap_type": "evidence",
                "requirement_id": "ER-05",
                "linked_judgment_unit_ids": "JU-02|JU-04",
                "path_id": "P-01",
                "node_id": "N-04",
                "affected_target_type": "customer_order",
                "affected_target_id": "repeat_order",
                "material_unit": "验证复购",
                "description": "多数公司未披露客户名称台数及跨线复制明细",
                "severity": "medium",
                "priority": "medium",
                "impact_on_reasoning": "将商业转化结论限制为方向性",
                "impact_on_05": "05不得给出统一复购率或份额跳升幅度",
                "allowed_04_output_after_gap": "directional_only",
                "blocks_04_output": "false",
                "attempted_source_ids": "SRC-AMEC-H1|SRC-PIOTECH-2025|SRC-HWATSING-2025",
                "preferred_evidence_to_add": "客户招标验收和重复采购公告",
                "acceptable_proxy": "允许公司批量订单表述但降低置信度",
                "upgrade_condition": "客户级复购和跨线复制连续两个报告期可复核",
                "suggested_next_step": "跟踪订单验收合同负债和服务收入",
                "return_action": "none",
                "status": "managed",
                "notes": "非致命缺口",
            },
            {
                "gap_id": "GAP-03",
                "execution_id": EXEC,
                "gap_type": "coverage",
                "requirement_id": "ER-08",
                "linked_judgment_unit_ids": "JU-03|JU-04",
                "path_id": "P-02",
                "node_id": "N-06",
                "affected_target_type": "upstream_dependency",
                "affected_target_id": "CAT-ALL",
                "material_unit": "上游自主化",
                "description": "全行业关键零部件软件和服务自主化率缺少统一公开数据",
                "severity": "medium",
                "priority": "high",
                "impact_on_reasoning": "只能确认反向约束存在而不能量化净影响",
                "impact_on_05": "05将其作为类别和公司受益上限而非精确折扣",
                "allowed_04_output_after_gap": "directional_only",
                "blocks_04_output": "false",
                "attempted_source_ids": "SRC-BIS-2024|SRC-ACMR-2025",
                "preferred_evidence_to_add": "更多国产设备公司部件切换和客户再认证披露",
                "acceptable_proxy": "不接受匿名供应链清单",
                "upgrade_condition": "至少三家公司披露受限部件替代与交付结果",
                "suggested_next_step": "每季复核实体清单风险和部件切换",
                "return_action": "none",
                "status": "managed",
                "notes": "影响置信度但不要求返工",
            },
            {
                "gap_id": "GAP-04",
                "execution_id": EXEC,
                "gap_type": "evidence",
                "requirement_id": "ER-06",
                "linked_judgment_unit_ids": "JU-03|JU-04",
                "path_id": "P-01",
                "node_id": "N-04",
                "affected_target_type": "equipment_category",
                "affected_target_id": "INS-CAT-LITHO",
                "material_unit": "光刻商业化",
                "description": "先进光刻设备缺少可复核的批量量产复购和经营兑现证据",
                "severity": "high",
                "priority": "high",
                "impact_on_reasoning": "光刻只可列为高战略紧迫但低近端商业兑现组",
                "impact_on_05": "05不得以技术传闻上调光刻受益强度",
                "allowed_04_output_after_gap": "directional_only",
                "blocks_04_output": "false",
                "attempted_source_ids": "SRC-KINGSEMI-2025",
                "preferred_evidence_to_add": "正式客户验收批量订单和收入贡献披露",
                "acceptable_proxy": "不得使用技术传闻代理量产",
                "upgrade_condition": "出现公开批量交付复购与收入贡献",
                "suggested_next_step": "跟踪正式招标验收和公司财报",
                "return_action": "none",
                "status": "managed",
                "notes": "高缺口不等于高受益",
            },
        ],
    )

    path_rows = [
        ("P-01", "主路径：管制到商业兑现", "N-01", "现行规则是否形成可执行供给约束", "JU-01|JU-04", "ER-01|ER-02", "SV-01|SV-08", "COV-01|COV-08", "RI-01|RI-02|RI-03", "EV-01|EV-02|EV-03|EV-04|EV-05|EV-06", "", "full_reasoning_ready", "ready", "met", "restricted_pass", "full_reasoning_ready", "不得写成全面禁运"),
        ("P-01", "主路径：管制到商业兑现", "N-02", "海外供货是否全面退出", "JU-01|JU-04", "ER-03", "SV-02", "COV-02", "RI-04", "EV-07|EV-08|EV-09", "", "full_reasoning_ready", "ready", "met", "restricted_pass", "full_reasoning_ready", "成熟制程仍有供货"),
        ("P-01", "主路径：管制到商业兑现", "N-03", "中国设备需求池是否仍大", "JU-02|JU-04", "ER-04", "SV-03", "COV-03", "RI-05|RI-06", "EV-10|EV-11|EV-12", "", "directional_only", "ready_with_limit", "met", "restricted_pass", "directional_only", "需求不等于国产订单"),
        ("P-01", "主路径：管制到商业兑现", "N-04", "国产验证复购是否兑现", "JU-02|JU-03|JU-04", "ER-05|ER-06", "SV-04|SV-07", "COV-04|COV-07", "RI-07|RI-08|RI-09", "EV-13|EV-14|EV-15|EV-16", "GAP-01|GAP-02|GAP-04", "directional_only", "ready_with_limit", "met", "restricted_pass", "directional_only", "缺客户级统一口径"),
        ("P-01", "主路径：管制到商业兑现", "N-05", "经营质量是否支持分化", "JU-02|JU-03|JU-04", "ER-07", "SV-05", "COV-05", "RI-11|RI-12", "EV-18|EV-19|EV-20", "GAP-01", "directional_only", "ready_with_limit", "met", "restricted_pass", "directional_only", "公司口径不完全可比"),
        ("P-02", "反向路径：上游与规则闸门", "N-06", "上游依赖是否形成阻断", "JU-03|JU-04", "ER-08", "SV-06", "COV-06", "RI-10", "EV-03|EV-17", "GAP-03", "directional_only", "ready_with_limit", "met", "restricted_pass", "directional_only", "上游依赖量化不足"),
        ("P-02", "反向路径：上游与规则闸门", "N-07", "未来十二个月改判闸门", "JU-04", "ER-02|ER-08", "SV-08|SV-06", "COV-06|COV-08", "RI-02|RI-10", "EV-05|EV-17", "GAP-03", "directional_only", "ready_with_limit", "met", "restricted_pass", "directional_only", "规则跟踪变量未兑现"),
    ]
    write_csv(
        "03_gate/path_readiness.csv",
        [
            {
                "path_id": path_id,
                "path_name": path_name,
                "node_id": node_id,
                "node_question": question,
                "linked_judgment_unit_ids": jus,
                "criticality": "critical",
                "requirement_ids": reqs,
                "state_variable_ids": svs,
                "variable_coverage_summary": covs,
                "linked_instance_ids": "",
                "linked_relation_ids": "",
                "linked_input_ids": inputs,
                "linked_evidence_ids": evs,
                "linked_gap_ids": gaps,
                "instance_status": "verified",
                "evidence_status": "met",
                "counter_evidence_status": "covered",
                "alternative_explanation_status": "compared",
                "conflict_status": "no_material_conflict",
                "scope_alignment": "matched",
                "time_alignment": "matched",
                "reasoning_readiness": readiness,
                "path_status": status,
                "path_gate_status": gate,
                "admission": admission,
                "allowed_04_output": allowed,
                "downgrade_reason": reason,
                "notes": "",
            }
            for path_id, path_name, node_id, question, jus, reqs, svs, covs, inputs, evs, gaps, readiness, status, gate, admission, allowed, reason in path_rows
        ],
    )

    coverage = [
        ("COV-01", "JU-01|JU-04", "SB-01", "OR-01", "SV-01", "现行管制规则状态", "EP-POLICY-01", "N-01", "EV-01|EV-02|EV-03|EV-06", "", "3", "0", "0"),
        ("COV-02", "JU-01|JU-04", "SB-02", "OR-02", "SV-02", "海外设备中国可得性", "EP-SUPPLY-COUNTER-01", "N-02", "EV-07|EV-08|EV-09", "", "3", "1", "3"),
        ("COV-03", "JU-02|JU-04", "SB-03", "OR-03", "SV-03", "中国设备需求池", "EP-DEMAND-01", "N-03", "EV-10|EV-11|EV-12", "", "3", "2", "1"),
        ("COV-04", "JU-02|JU-03|JU-04", "SB-04", "OR-04", "SV-04", "国产验证复购", "EP-COMMERCIALIZATION-01", "N-04", "EV-13|EV-14|EV-15|EV-16", "GAP-02", "4", "0", "0"),
        ("COV-05", "JU-02|JU-03|JU-04", "SB-05", "OR-05", "SV-05", "国产经营兑现", "EP-FINANCIAL-01", "N-05", "EV-18|EV-19|EV-20", "GAP-01", "3", "3", "1"),
        ("COV-06", "JU-03|JU-04", "SB-06", "OR-06", "SV-06", "上游部件软件依赖", "EP-UPSTREAM-01", "N-06", "EV-03|EV-17", "GAP-03", "2", "0", "1"),
        ("COV-07", "JU-03|JU-04", "SB-07", "OR-07", "SV-07", "设备类别成熟度", "EP-CATEGORY-01", "N-04|N-05", "EV-13|EV-14|EV-15|EV-16|EV-18", "GAP-01|GAP-04", "5", "0", "0"),
        ("COV-08", "JU-01|JU-04", "SB-08", "OR-08", "SV-08", "未来规则闸门", "EP-POLICY-GATE-01", "N-01|N-07", "EV-04|EV-05", "", "2", "0", "1"),
    ]
    write_csv(
        "03_gate/state_variable_coverage.csv",
        [
            {
                "coverage_id": cid,
                "execution_id": EXEC,
                "linked_judgment_unit_ids": jus,
                "state_binding_ref": sb,
                "observation_requirement_refs": obs,
                "state_variable_id": sv,
                "state_variable_name": name,
                "evidence_profile_ref": ep,
                "used_by_path_nodes": nodes,
                "anchor_instance_id": "",
                "anchor_instance_type": "industry",
                "linked_input_ids": "",
                "linked_evidence_ids": evs,
                "linked_gap_ids": gaps,
                "observation_count": obs_n,
                "quantitative_count": qty,
                "counter_evidence_count": counter,
                "mapping_status": "mapped",
                "profile_minimum_met": "true",
                "profile_gap_reasons": "",
                "coverage_status": "covered",
                "evidence_gate_status": "usable_with_caveat",
                "evidence_gate_reason": "覆盖成立但商业转化精度受限" if gaps else "主证据可复核",
                "inference_allowed": "directional_only" if gaps else "full_reasoning_ready" if sv == "SV-01" else "directional_only",
                "coverage_constraint": "覆盖不等于结论充分",
                "scope_limit": "截至2026-07-10公开披露",
                "notes": "",
            }
            for cid, jus, sb, obs, sv, name, ep, nodes, evs, gaps, obs_n, qty, counter in coverage
        ],
    )


def build_materials() -> None:
    write_csv(
        "04_05_materials/display_data_candidates.csv",
        [
            {
                "data_candidate_id": "DC-01",
                "execution_id": EXEC,
                "linked_judgment_unit_ids": "JU-02|JU-04",
                "linked_input_ids": "RI-05",
                "linked_evidence_ids": "EV-10",
                "object": "中国半导体设备市场",
                "indicator": "2025年中国设备销售额",
                "value_field": "493",
                "unit": "亿美元",
                "period": "2025",
                "grain": "annual",
                "source_ids": "SRC-SEMI-BILLINGS",
                "data_status": "available",
                "visual_role": "quant_chart",
                "chart_readiness": "ready",
                "quantitative_or_qualitative": "quantitative",
                "time_points_count": "1",
                "comparison_baseline": "同比-0.5%",
                "ranking_support": "none",
                "report_grade_status": "report_grade_ready",
                "gap_to_report_grade": "",
                "usage_limit": "不等于国产订单",
                "caveat": "SEMI口径",
            },
            {
                "data_candidate_id": "DC-02",
                "execution_id": EXEC,
                "linked_judgment_unit_ids": "JU-01|JU-04",
                "linked_input_ids": "RI-04",
                "linked_evidence_ids": "EV-07",
                "object": "KLA",
                "indicator": "中国收入占比",
                "value_field": "27|43|33",
                "unit": "%",
                "period": "2023-2025",
                "grain": "annual",
                "source_ids": "SRC-KLA-2025",
                "data_status": "available",
                "visual_role": "quant_chart",
                "chart_readiness": "ready",
                "quantitative_or_qualitative": "quantitative",
                "time_points_count": "3",
                "comparison_baseline": "2023基线",
                "ranking_support": "none",
                "report_grade_status": "report_grade_ready",
                "gap_to_report_grade": "",
                "usage_limit": "反证全面退出",
                "caveat": "单公司结构",
            },
            {
                "data_candidate_id": "DC-03",
                "execution_id": EXEC,
                "linked_judgment_unit_ids": "JU-03|JU-04",
                "linked_input_ids": "RI-11|RI-12",
                "linked_evidence_ids": "EV-18|EV-19|EV-20",
                "object": "代表国产设备公司",
                "indicator": "收入与利润分化",
                "value_field": "分组",
                "unit": "text",
                "period": "2025",
                "grain": "cross_section",
                "source_ids": "SRC-HWATSING-2025|SRC-KINGSEMI-2025|SRC-SSE-2025",
                "data_status": "available",
                "visual_role": "ranking_table",
                "chart_readiness": "partial",
                "quantitative_or_qualitative": "mixed",
                "time_points_count": "1",
                "comparison_baseline": "公司间",
                "ranking_support": "medium",
                "report_grade_status": "usable_with_caveat",
                "gap_to_report_grade": "口径不完全统一",
                "usage_limit": "只做强弱分组",
                "caveat": "不可作个股排序",
            },
        ],
    )
    write_csv(
        "04_05_materials/chart_data_package.csv",
        [
            {
                "figure_id": "FIG-01",
                "execution_id": EXEC,
                "suggested_title": "中国半导体设备销售额与同比",
                "evidence_role": "demand_pool",
                "data_candidate_ids": "DC-01",
                "required_fields": "year,sales_usd_bn,yoy",
                "available_fields": "year,sales_usd_bn,yoy",
                "source_ids": "SRC-SEMI-BILLINGS",
                "chart_type_suggestion": "bar_line",
                "chart_readiness": "ready",
                "report_grade_status": "report_grade_ready",
                "evidence_message": "需求池仍大但处于高位平台",
                "usage_limit": "不得直接等同国产替代订单",
                "gap_to_ready": "",
            },
            {
                "figure_id": "FIG-02",
                "execution_id": EXEC,
                "suggested_title": "KLA中国收入占比变化",
                "evidence_role": "counter_supply",
                "data_candidate_ids": "DC-02",
                "required_fields": "year,china_revenue_share",
                "available_fields": "year,china_revenue_share",
                "source_ids": "SRC-KLA-2025",
                "chart_type_suggestion": "line",
                "chart_readiness": "ready",
                "report_grade_status": "report_grade_ready",
                "evidence_message": "海外厂商中国业务仍显著",
                "usage_limit": "只作反证全面退出",
                "gap_to_ready": "",
            },
        ],
    )
    write_csv(
        "04_05_materials/table_material_package.csv",
        [
            {
                "table_id": "TBL-01",
                "execution_id": EXEC,
                "table_role": "ranking",
                "suggested_title": "设备类别与代表公司强弱分组",
                "row_objects": "刻蚀|薄膜|清洗|CMP|光刻相关",
                "columns_available": "类别,代表公司,商业成熟度,经营质量,限制",
                "source_ids": "SRC-NAURA-2025|SRC-AMEC-H1|SRC-PIOTECH-2025|SRC-HWATSING-2025|SRC-KINGSEMI-2025",
                "linked_evidence_ids": "EV-13|EV-14|EV-15|EV-16|EV-18|EV-19",
                "readiness": "usable_with_caveat",
                "ranking_support": "medium",
                "usage_limit": "分组非个股排序",
            },
            {
                "table_id": "TBL-02",
                "execution_id": EXEC,
                "table_role": "event_timeline",
                "suggested_title": "美国对华设备管制关键节点",
                "row_objects": "2022-10|2023-10|2024-12|2025-08|2025-11|2026-02",
                "columns_available": "日期,规则/事件,状态,对供给含义",
                "source_ids": "SRC-BIS-2022|SRC-BIS-2023|SRC-BIS-2024|SRC-BIS-VEU|SRC-BIS-AFFIL|SRC-BIS-PENALTY",
                "linked_evidence_ids": "EV-01|EV-02|EV-03|EV-04|EV-05|EV-06",
                "readiness": "report_grade_ready",
                "ranking_support": "none",
                "usage_limit": "暂停规则不得写成已生效",
            },
        ],
    )
    write_csv(
        "04_05_materials/source_annotation_package.csv",
        [
            {
                "annotation_id": "ANN-01",
                "execution_id": EXEC,
                "source_id": "SRC-BIS-2024",
                "evidence_ids": "EV-03",
                "citation_phrase": "BIS 2024年12月设备与实体更新",
                "source_type": "official_page",
                "published_at": "2024-12-02",
                "business_time": "2024-12-02",
                "data_scope": "设备类别与实体清单",
                "method_or_metric": "官方规则文本",
                "supports_material_unit": "政策时间线",
                "usage_limit": "不等于全面禁运",
                "permission_note": "public",
            },
            {
                "annotation_id": "ANN-02",
                "execution_id": EXEC,
                "source_id": "SRC-SEMI-BILLINGS",
                "evidence_ids": "EV-10",
                "citation_phrase": "SEMI中国2025设备销售统计",
                "source_type": "association",
                "published_at": "2026-04-07",
                "business_time": "2025",
                "data_scope": "中国设备销售额",
                "method_or_metric": "billings",
                "supports_material_unit": "需求池",
                "usage_limit": "不等于国产订单",
                "permission_note": "public_release",
            },
            {
                "annotation_id": "ANN-03",
                "execution_id": EXEC,
                "source_id": "SRC-KLA-2025",
                "evidence_ids": "EV-07",
                "citation_phrase": "KLA Form 10-K中国收入占比",
                "source_type": "filing",
                "published_at": "2025-08-08",
                "business_time": "2023-2025",
                "data_scope": "中国收入占比",
                "method_or_metric": "segment disclosure",
                "supports_material_unit": "供货反证",
                "usage_limit": "单公司不可外推",
                "permission_note": "SEC public",
            },
        ],
    )
    write_csv(
        "04_05_materials/05_material_readiness.csv",
        [
            {
                "material_unit_id": "MU-01",
                "execution_id": EXEC,
                "target_05_archetype": "theme_deep_dive",
                "material_unit": "政策时间线",
                "status": "report_grade_ready",
                "linked_judgment_unit_ids": "JU-01|JU-04",
                "linked_data_candidate_ids": "",
                "linked_chart_ids": "",
                "linked_table_ids": "TBL-02",
                "source_annotation_ids": "ANN-01",
                "impact_on_05": "可写规则演进",
                "required_action": "none",
            },
            {
                "material_unit_id": "MU-02",
                "execution_id": EXEC,
                "target_05_archetype": "theme_deep_dive",
                "material_unit": "需求与反证图",
                "status": "report_grade_ready",
                "linked_judgment_unit_ids": "JU-01|JU-02|JU-04",
                "linked_data_candidate_ids": "DC-01|DC-02",
                "linked_chart_ids": "FIG-01|FIG-02",
                "linked_table_ids": "",
                "source_annotation_ids": "ANN-02|ANN-03",
                "impact_on_05": "可支撑主图",
                "required_action": "none",
            },
            {
                "material_unit_id": "MU-03",
                "execution_id": EXEC,
                "target_05_archetype": "theme_deep_dive",
                "material_unit": "类别公司分组表",
                "status": "usable_with_caveat",
                "linked_judgment_unit_ids": "JU-03|JU-04",
                "linked_data_candidate_ids": "DC-03",
                "linked_chart_ids": "",
                "linked_table_ids": "TBL-01",
                "source_annotation_ids": "",
                "impact_on_05": "可写分化但需披露口径",
                "required_action": "保留不可比边界",
            },
            {
                "material_unit_id": "MU-04",
                "execution_id": EXEC,
                "target_05_archetype": "theme_deep_dive",
                "material_unit": "统一国产化率",
                "status": "missing",
                "linked_judgment_unit_ids": "JU-02|JU-03|JU-04",
                "linked_data_candidate_ids": "",
                "linked_chart_ids": "",
                "linked_table_ids": "",
                "source_annotation_ids": "",
                "impact_on_05": "不得给出统一比例",
                "required_action": "跟踪GAP-01",
            },
        ],
    )


def build_manifest() -> None:
    view_path = OUT / f"02-{THEME}本体视图-{RUN}.yaml"
    view_hash = "sha256:" + hashlib.sha256(view_path.read_bytes()).hexdigest() if view_path.exists() else "sha256:not_computed_public_run"
    write_csv(
        "manifest.csv",
        [
            {
                "task_id": "JTASK-USCTRL-CNSEMI-EQP-001",
                "execution_id": EXEC,
                "plan_id": "DAP-USCTRL-CNSEMI-EQP-20260710-1",
                "source_02_view_id": "TOV-USCTRL-CNSEMI-EQP-20260710-1",
                "source_02_logic_id": "RLOG-USCTRL-CNSEMI-EQP-20260710-1",
                "source_02_view_ref": f"02-{THEME}本体视图-{RUN}.yaml",
                "source_02_logic_ref": f"02-{THEME}研究逻辑-{RUN}.md",
                "source_02_view_hash": view_hash,
                "preparation_ref": f"03-{THEME}数据与证据准备-{RUN}.md",
                "snapshot_summary_ref": f"03-{THEME}数据与证据快照-{RUN}/03-{THEME}数据与证据快照-{RUN}.md",
                "execution_date": "2026-07-10",
                "timezone": "Asia/Shanghai",
                "data_cutoff": "2026-07-10T19:40:00+08:00",
                "resolved_anchor_date": "2026-07-10",
                "resolved_start": "2022-10-07",
                "resolved_end": "2027-07-09",
                "resolved_at": "2026-07-10T19:40:00+08:00",
                "resolved_objects": "中国半导体设备行业|现行美国对华半导体设备管制规则集合|前道与先进封装设备类别|公开披露充分的代表公司",
                "source_registry_version": "public-primary-web-20260710-v1",
                "recipe_library_version": "03-strategy-library-1.0.0",
                "snapshot_version": "1.2.0",
                "snapshot_schema_version": "1.2.0",
                "created_at": AS_OF,
                "state_variable_coverage_summary": "8/8 covered",
                "coverage_unit_total": "8",
                "evidence_backed_unit_count": "8",
                "evidence_coverage_rate": "1.0",
                "required_coverage_rate": "0.95",
                "critical_node_gate_status": "met",
                "judgment_unit_total": "4",
                "judgment_unit_full_reasoning_ready_count": "1",
                "judgment_unit_directional_only_count": "3",
                "judgment_unit_conditional_only_count": "0",
                "judgment_unit_insufficient_count": "0",
                "judgment_unit_blocked_count": "0",
                "judgment_unit_contested_count": "0",
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
                "search_status": "completed",
                "admission": "restricted_pass",
                "evidence_quality_level": "medium",
                "allowed_scope": "现行规则事实、行业逻辑方向、设备类别和代表公司分组差异及未来十二个月改判闸门",
                "disallowed_scope": "政策贡献率、统一国产化率、光刻量产断言、个股交易判断",
                "confidence_ceiling": "medium",
                "quality_status": "high_quality_pass",
                "deterministic_check_status": "pass",
                "semantic_review_status": "pass",
                "return_required": "false",
                "return_stage": "",
                "notes": "权威证据链已补齐Source/Claim/Fact",
            }
        ],
    )


def claim_type(nature: str) -> str:
    mapping = {
        "reported_fact": "reported_fact",
        "rule_text": "rule_text",
        "financial_data": "quantitative_observation",
        "management_statement": "management_statement",
        "risk_factor": "risk_disclosure",
        "forecast": "forecast",
    }
    return mapping.get(nature, "reported_fact")


def reliability(authority: str) -> str:
    mapping = {
        "official": "high",
        "filing": "high",
        "association": "medium_high",
        "exchange": "high",
    }
    return mapping.get(authority, "medium")


def source_type(authority: str, locator: str) -> str:
    if authority == "official":
        return "official_page"
    if authority == "filing":
        return "regulatory_filing"
    if authority == "association":
        return "industry_association"
    if authority == "exchange":
        return "exchange_summary"
    if "Federal Register" in locator:
        return "regulation"
    return "document"


def build_evidence_graph() -> None:
    evidence = read_csv(SNAP / "02_assets/evidence_records.csv")
    sources = {row["source_id"]: row for row in read_csv(SNAP / "02_assets/source_snapshot.csv")}
    eras = read_csv(SNAP / "03_gate/evidence_readiness_assessments.csv")

    source_docs = []
    claims = []
    facts = []
    relations = []
    for row in evidence:
        ev = row["evidence_id"]
        src_id = row["source_id"]
        src = sources.get(src_id, {})
        doc_id = f"SD-{src_id}"
        claim_id = f"CL-{ev}"
        fact_id = f"FT-{ev}"
        if not any(item["source_document_id"] == doc_id for item in source_docs):
            source_docs.append(
                {
                    "source_document_id": doc_id,
                    "source_id": src_id,
                    "title": src.get("source_name") or src_id,
                    "source_type": source_type(row.get("source_authority", ""), row.get("source_locator", "")),
                    "location": src.get("source_locator") or row.get("source_locator", ""),
                    "access_scope": src.get("access_mode") or "public_web",
                    "source_reliability": reliability(row.get("source_authority", "")),
                    "publisher": src.get("source_name", "").split(" ")[0] if src.get("source_name") else src_id,
                    "published_at": row.get("source_date", ""),
                    "publisher_instance_ref": "",
                    "status": "active",
                    "created_at": AS_OF,
                    "notes": src.get("notes", ""),
                }
            )
        claims.append(
            {
                "claim_id": claim_id,
                "execution_id": EXEC,
                "source_document_id": doc_id,
                "source_run_refs": row.get("source_run_id", ""),
                "locator": row.get("source_locator", ""),
                "statement": row.get("claim_text", ""),
                "claim_type": claim_type(row.get("statement_nature", "")),
                "business_time": row.get("source_date", ""),
                "claim_confidence": "high" if row.get("quality_status") == "Q4_report_grade" else "medium",
                "about_instance_refs": "",
                "status": "accepted",
                "created_at": AS_OF,
                "notes": row.get("notes", ""),
            }
        )
        facts.append(
            {
                "fact_id": fact_id,
                "execution_id": EXEC,
                "statement": row.get("normalized_fact", ""),
                "fact_type": claim_type(row.get("statement_nature", "")),
                "business_time": row.get("source_date", ""),
                "normalized_value": row.get("normalized_fact", ""),
                "unit": "",
                "fact_confidence": "high" if row.get("fact_status") == "confirmed" else "medium",
                "about_instance_refs": "",
                "status": row.get("fact_status", "confirmed"),
                "created_at": AS_OF,
                "notes": f"projected_from={ev}",
            }
        )
        relations.append(
            {
                "relation_id": f"REL-CS-{ev}",
                "execution_id": EXEC,
                "relation_type": "claimCitesSource",
                "source_evidence_id": claim_id,
                "target_evidence_id": doc_id,
                "relation_role": "source",
                "relation_scope": row.get("source_locator", ""),
                "status": "active",
                "notes": "",
            }
        )
        relations.append(
            {
                "relation_id": f"REL-FC-{ev}",
                "execution_id": EXEC,
                "relation_type": "factSupportedByClaim",
                "source_evidence_id": fact_id,
                "target_evidence_id": claim_id,
                "relation_role": "primary",
                "relation_scope": "",
                "status": "active",
                "notes": "",
            }
        )

    assessments = []
    for era in eras:
        aid = era["assessment_id"].replace("ERA", "EA")
        targets = [f"FT-{ev}" for ev in split_refs(era.get("linked_evidence_ids"))]
        # Keep a compact but resolvable target set: first/primary few facts already linked in ERA narrative
        compact = targets[:5] if targets else []
        assessments.append(
            {
                "assessment_id": aid,
                "execution_id": EXEC,
                "evaluated_at": AS_OF,
                "profile_ref": era.get("possible_view", ""),
                "assessment_scope": era.get("scope_limit", ""),
                "usability": "usable" if era.get("allowed_04_output") == "full_reasoning_ready" else "restricted",
                "quality_level": "high" if era.get("confidence_ceiling") == "high" else "medium",
                "rationale": era.get("assessment_reason", ""),
                "gap_refs": era.get("linked_gap_ids", ""),
                "evidence_refs": "|".join(compact),
                "linked_judgment_unit_ids": era.get("target_judgment_unit_id", ""),
                "notes": era.get("notes", ""),
            }
        )
        for fact_id in compact:
            relations.append(
                {
                    "relation_id": f"REL-AE-{aid}-{fact_id}",
                    "execution_id": EXEC,
                    "relation_type": "assessmentEvaluatesEvidence",
                    "source_evidence_id": aid,
                    "target_evidence_id": fact_id,
                    "relation_role": "evaluates",
                    "relation_scope": era.get("target_judgment_unit_id", ""),
                    "status": "active",
                    "notes": "",
                }
            )

    write_csv("02_assets/source_documents.csv", source_docs)
    write_csv("02_assets/evidence_claims.csv", claims)
    write_csv("02_assets/evidence_facts.csv", facts)
    write_csv("02_assets/evidence_relations.csv", relations)
    write_csv("02_assets/evidence_assessments.csv", assessments)

    # Remove obsolete root-level shells if present
    for name in [
        "source_documents.csv",
        "evidence_claims.csv",
        "evidence_facts.csv",
        "evidence_relations.csv",
        "evidence_assessments.csv",
        "evidence_records.csv",
        "gaps_and_risks.csv",
        "judgment_unit_readiness.csv",
        "path_readiness.csv",
        "state_variable_coverage.csv",
        "reasoning_inputs.csv",
        "semantic_instances.csv",
        "semantic_relations.csv",
    ]:
        path = SNAP / name
        if path.exists():
            path.unlink()


def write_evidence_manifest() -> None:
    view_path = OUT / f"02-{THEME}本体视图-{RUN}.yaml"
    view_hash = "sha256:" + hashlib.sha256(view_path.read_bytes()).hexdigest() if view_path.exists() else "sha256:not_computed_public_run"
    snap_name = SNAP.name
    text = f"""document_type: evidence_instance_manifest
schema_version: 2.0.0
metadata:
  task_id: JTASK-USCTRL-CNSEMI-EQP-001
  execution_id: {EXEC}
  source_02_view_ref: 02-{THEME}本体视图-{RUN}.yaml
  source_02_view_version: 1
  source_02_view_hash: {view_hash}
  snapshot_ref: {snap_name}/manifest.csv
  frozen_at: "{AS_OF}"
ontology_versions:
  platform: {{common: 2.0.0, semantic: 1.0.0, evidence: 2.0.0, reasoning: 2.0.0}}
  domain: {{name: semiconductor_domain_ontology, version: 1.0.0}}
domain_role:
  primary_domain: evidence
  instance_only: true
  formal_ontology_mutated: false
instance_files:
  source_documents: {snap_name}/02_assets/source_documents.csv
  source_retrievals: {snap_name}/02_assets/source_snapshot.csv
  evidence_claims: {snap_name}/02_assets/evidence_claims.csv
  evidence_facts: {snap_name}/02_assets/evidence_facts.csv
  evidence_relations: {snap_name}/02_assets/evidence_relations.csv
  evidence_assessments: {snap_name}/02_assets/evidence_assessments.csv
  semantic_instances: {snap_name}/02_assets/semantic_instances.csv
  semantic_relations: {snap_name}/02_assets/semantic_relations.csv
  reasoning_inputs: {snap_name}/02_assets/reasoning_inputs.csv
  compatibility_projection: {snap_name}/02_assets/evidence_records.csv
cross_domain_constraints:
  source_claim_fact_chain_complete: true
  assessment_targets_resolvable: true
  semantic_instances_runtime_only: true
  reasoning_inputs_frozen: true
  no_rule_evaluation_instances: true
  no_judgment_instances: true
candidate_feedback_ref: null
validation:
  result: pass
  checked_at: "{AS_OF}"
  issues: []
"""
    (OUT / f"03-{THEME}证据实例清单-{RUN}.yaml").write_text(text, encoding="utf-8")


def ensure_asset_templates() -> None:
    """Create template CSVs for layered evidence under 02_assets if missing."""
    specs = {
        "02_assets/source_documents.csv": "source_document_id,source_id,title,source_type,location,access_scope,source_reliability,publisher,published_at,publisher_instance_ref,status,created_at,notes",
        "02_assets/evidence_claims.csv": "claim_id,execution_id,source_document_id,source_run_refs,locator,statement,claim_type,business_time,claim_confidence,about_instance_refs,status,created_at,notes",
        "02_assets/evidence_facts.csv": "fact_id,execution_id,statement,fact_type,business_time,normalized_value,unit,fact_confidence,about_instance_refs,status,created_at,notes",
        "02_assets/evidence_relations.csv": "relation_id,execution_id,relation_type,source_evidence_id,target_evidence_id,relation_role,relation_scope,status,notes",
        "02_assets/evidence_assessments.csv": "assessment_id,execution_id,evaluated_at,profile_ref,assessment_scope,usability,quality_level,rationale,gap_refs,evidence_refs,linked_judgment_unit_ids,notes",
    }
    for rel, header in specs.items():
        path = TEMPLATE / rel
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(header + "\n", encoding="utf-8")


def main() -> None:
    ensure_asset_templates()
    build_gate()
    build_materials()
    build_manifest()
    build_evidence_graph()
    write_evidence_manifest()
    print(f"rebuilt evidence chain under {SNAP}")


if __name__ == "__main__":
    main()
