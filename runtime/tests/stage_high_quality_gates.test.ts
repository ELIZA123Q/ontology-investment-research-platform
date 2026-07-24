import { describe, expect, it } from "vitest";
import {
  assertStage01ReadyForApproval,
  collectStage01HighQualityIssues,
  ensureStage01ContractFields,
} from "@/engine/stage01_contract";
import {
  assertStage02ReadyForApproval,
  collectStage02HighQualityIssues,
  ensureStage02DocumentFields,
} from "@/engine/stage02_documents";
import {
  collectStage03HighQualityIssues,
  collectStage03ConsistencyIssues,
} from "@/engine/stage03_documents";
import {
  collectStage04HighQualityIssues,
  collectStage04ConsistencyIssues,
  ensureStage04DocumentFields,
} from "@/engine/stage04_documents";
import { syncStage01ReadableMarkdown } from "@/engine/readable_markdown";

describe("per-stage high_quality_pass gates", () => {
  it("stage01: placeholder value gate cannot stay high_quality_pass", () => {
    const data: any = {
      normalized_question: "存储周期是否见顶",
      core_object: "存储芯片",
      judgment_action: "周期判断",
      time_scope: { as_of: "2026-07-01", forward: "12个月" },
      document_markdown: "# 需求\n\n".padEnd(520, "正式需求说明正文。"),
    };
    ensureStage01ContractFields(data, "存储周期是否见顶");
    data.task_disposition = "accepted";
    data.quality_status = "high_quality_pass";
    data.research_value_gate.status = "pass";
    data.overscope_check.status = "pass";
    data.input_resolution.mode = "direct_extract";
    data.input_resolution.clarifications = [];
    data.input_resolution.unresolved_structural_ambiguities = [];
    syncStage01ReadableMarkdown(data, "存储周期是否见顶");
    ensureStage01ContractFields(data, "存储周期是否见顶");
    expect(data.quality_status).toBe("minimum_pass");
    expect(collectStage01HighQualityIssues({
      ...data,
      quality_status: "high_quality_pass",
      deterministic_check_status: "checked",
      research_value_gate: {
        ...data.research_value_gate,
        status: "pass",
        disagreement_or_unknown: "市场把涨价等同见顶",
        changing_variable: "HBM 挤占与合约价斜率",
        incremental_question: "分产品稀缺是否仍强化",
      },
      document_markdown: "# 需求\n\n".padEnd(520, "正式需求说明正文。"),
    })).toEqual([]);
  });

  it("stage01 minimum_pass is no longer approvable", () => {
    const data: any = {
      normalized_question: "供需是否改善",
      core_object: "存储芯片",
      judgment_action: "趋势",
      time_scope: { as_of: "2026-07-01", forward: "6个月" },
      document_markdown: "# 需求\n\n".padEnd(80, "正文。"),
    };
    ensureStage01ContractFields(data, "原始问题");
    data.task_disposition = "accepted";
    data.quality_status = "minimum_pass";
    data.research_value_gate.status = "pass";
    data.overscope_check.status = "pass";
    data.input_resolution.mode = "direct_extract";
    data.input_resolution.clarifications = [];
    data.input_resolution.unresolved_structural_ambiguities = [];
    syncStage01ReadableMarkdown(data, "原始问题");
    expect(() => assertStage01ReadyForApproval(data)).toThrow(/可交接密度/);
  });

  it("stage02: single unit cannot high_quality_pass", () => {
    const data = ensureStage02DocumentFields({
      judgment_units: [{ id: "JU-1", title: "总供需", question: "是否改善", judgment_type: "trend_direction", scope_ref: "S1", ontology_node_ids: [], evidence_requirements: [] }],
      method_applications: [
        { capability_type: "judgment_structure", method_id: "BF-SD-01" },
        { capability_type: "evidence", method_id: "kb03:A02" },
        { capability_type: "adjudication", method_id: "kb04:A02" },
      ],
      competing_explanations: [],
      research_scope: { id: "S1", label: "DRAM" },
      judgment_spine: "短",
      research_logic_markdown: "# 逻辑\n\n短",
      ontology_view_yaml: "judgment_units:\n  - id: JU-1\n",
      can_enter_03: true,
      quality_status: "high_quality_pass",
    });
    expect(data.quality_status).toBe("minimum_pass");
    expect(collectStage02HighQualityIssues({
      ...data,
      quality_status: "high_quality_pass",
      deterministic_check_status: "checked",
    }).some((item) => item.code === "judgment_units_thin")).toBe(true);
  });

  it("stage03: ungrounded numbers block high_quality_pass", () => {
    const data = {
      preparation_markdown: "# 准备\n\n".padEnd(820, "证据准备正文。"),
      document_markdown: "# 准备\n\n".padEnd(820, "证据准备正文。"),
      instance_manifest_yaml: "metadata:\n  task_id: T\n",
      evidence_drafts: [{
        id: "EV-1",
        kind: "fact_draft",
        statement: "DRAM 合约价上涨 55%",
        source_keys: ["SRC-01"],
        source_ids: ["s1"],
        judgment_unit_ids: ["JU-1"],
      }, {
        id: "EV-GAP-1",
        kind: "gap",
        direction: "unknown",
        statement: "缺少独立产能交叉验证",
        source_keys: [],
        source_ids: [],
        judgment_unit_ids: ["JU-1"],
      }],
      evidence_summaries: [{ id: "ES-1", title: "价", numeric_values: [] }],
      evidence_bundles: [{ judgment_unit_id: "JU-1", support_evidence_ids: ["EV-1"] }],
      sources: [{ source_key: "SRC-01", source_quote: "价格上涨但无具体数字" }],
      evidence_quality_gate: {
        passed: true,
        quality_status: "high_quality_pass",
      },
      quality_status: "high_quality_pass",
      deterministic_check_status: "checked",
    };
    const hq = collectStage03HighQualityIssues(data);
    expect(hq.some((item) => item.code === "numeric_ungrounded")).toBe(true);
    const issues = collectStage03ConsistencyIssues(data);
    expect(issues.some((item) => item.severity === "error" && item.code === "numeric_ungrounded")).toBe(true);
  });

  it("stage03: evidence quality gate failure blocks approval", () => {
    const data = {
      preparation_markdown: "# 准备\n\n".padEnd(820, "证据准备正文。"),
      document_markdown: "# 准备\n\n".padEnd(820, "证据准备正文。"),
      instance_manifest_yaml: "metadata:\n  task_id: T\n",
      evidence_drafts: [{ id: "EV-1", kind: "gap", direction: "unknown", statement: "无证据", source_keys: [], source_ids: [] }],
      evidence_summaries: [],
      evidence_bundles: [],
      sources: [],
      evidence_quality_gate: {
        passed: false,
        quality_status: "return_required",
      },
      evidence_quality_summary: "判断单元无可用证据",
      quality_status: "high_quality_pass",
      deterministic_check_status: "checked",
    };
    expect(collectStage03ConsistencyIssues(data).some((item) => item.code === "evidence_quality_gate")).toBe(true);
    expect(collectStage03HighQualityIssues(data).some((item) => item.code === "evidence_quality_gate_failed")).toBe(true);
  });

  it("stage04: thin expression_permission cannot high_quality_pass", () => {
    const data = ensureStage04DocumentFields({
      judgments: [{ id: "J1", title: "主判断", conclusion: "有条件上行", strength: "J2" }],
      competing_explanations: [],
      judgment_brief_markdown: "# 简报\n\n短",
      quality_status: "high_quality_pass",
      brief_quality_check_result: "pass",
      expression_permission: {
        allowed_core_claims: [],
        allowed_mechanisms: [],
        prohibited_claims: [],
        restricted_phrasing: [],
      },
    });
    expect(data.quality_status).toBe("minimum_pass");
    const rich = {
      ...data,
      quality_status: "high_quality_pass",
      deterministic_check_status: "checked",
      judgment_brief_markdown: "# 简报\n\n".padEnd(820, "对象分化与主路径裁决正文，含改判条件说明。"),
      document_markdown: "# 简报\n\n".padEnd(820, "对象分化与主路径裁决正文，含改判条件说明。"),
      object_differentiation: "HBM 与通用 DRAM 机制不同",
      primary_path_ruling: "采纳供给约束主路径",
      investment_proposition: "跟踪验证窗口；改判条件为合约价斜率转负",
      competing_explanations: [{ explanation_id: "CE-1", statement: "需求一次性脉冲", status: "active" }],
      expression_permission: {
        allowed_core_claims: ["J1"],
        allowed_mechanisms: ["供给约束下的卖方定价"],
        prohibited_claims: ["确定见顶日"],
        restricted_phrasing: ["不得写成已确认反转"],
        max_expression_level: "J2",
        notes: "不抬升",
      },
    };
    expect(collectStage04HighQualityIssues(rich)).toEqual([]);
    const minIssues = collectStage04ConsistencyIssues({ ...rich, quality_status: "minimum_pass" });
    expect(minIssues.some((item) => item.code === "quality_status")).toBe(true);
  });

  it("stage02 minimum is no longer approvable", () => {
    const data = ensureStage02DocumentFields({
      judgment_units: [
        { id: "JU-1", title: "HBM", question: "是否扩张", judgment_type: "cycle_phase", scope_ref: "S1", ontology_node_ids: [], evidence_requirements: ["ER-1"] },
        { id: "JU-2", title: "DRAM", question: "是否紧缺", judgment_type: "cycle_phase", scope_ref: "S1", ontology_node_ids: [], evidence_requirements: ["ER-2"] },
      ],
      evidence_requirements: [
        { id: "ER-1", requirement: "HBM 出货", evidence_role: "support", judgment_unit_ids: ["JU-1"] },
        { id: "ER-2", requirement: "DRAM 价格", evidence_role: "support", judgment_unit_ids: ["JU-2"] },
      ],
      method_applications: [
        { capability_type: "judgment_structure", method_id: "BF-SD-01", application_id: "MA1", method_version: "1", target_question_refs: [], target_judgment_unit_refs: ["JU-1"], target_ontology_object_refs: [], status: "candidate", precondition_checks: [], input_evidence_refs: [], output_signal_refs: [], output_judgment_refs: [], execution_summary: "", applicability_boundary: "", limitations: [], counter_example_refs: [], provenance: { stage: "stage_02", source_application_id: null, actor: "t", recorded_at: null }, alternatives: [] },
        { capability_type: "evidence", method_id: "kb03:A02", application_id: "MA2", method_version: "1", target_question_refs: [], target_judgment_unit_refs: ["JU-1"], target_ontology_object_refs: [], status: "candidate", precondition_checks: [], input_evidence_refs: [], output_signal_refs: [], output_judgment_refs: [], execution_summary: "", applicability_boundary: "", limitations: [], counter_example_refs: [], provenance: { stage: "stage_02", source_application_id: null, actor: "t", recorded_at: null }, alternatives: [] },
        { capability_type: "adjudication", method_id: "kb04:A02", application_id: "MA3", method_version: "1", target_question_refs: [], target_judgment_unit_refs: ["JU-1"], target_ontology_object_refs: [], status: "candidate", precondition_checks: [], input_evidence_refs: [], output_signal_refs: [], output_judgment_refs: [], execution_summary: "", applicability_boundary: "", limitations: [], counter_example_refs: [], provenance: { stage: "stage_02", source_application_id: null, actor: "t", recorded_at: null }, alternatives: [] },
      ],
      competing_explanations: [],
      research_scope: { id: "S1", label: "存储周期 HBM/DRAM" },
      judgment_spine: "区分 HBM 结构性扩张与通用 DRAM 供给约束",
      research_logic_markdown: "# 研究逻辑\n\n".padEnd(80, "分产品机制叙述。"),
      can_enter_03: true,
      quality_status: "minimum_pass",
      ontology_gap_scan_status: "minor_gap",
    });
    data.ontology_view_yaml = `judgment_units:\n  - id: JU-1\n  - id: JU-2\nquality_control:\n  can_enter_03: true\n`;
    expect(() => assertStage02ReadyForApproval(data)).toThrow(/可交接密度/);
  });
});
