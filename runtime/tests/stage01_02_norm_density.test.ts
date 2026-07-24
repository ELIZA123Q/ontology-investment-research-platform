import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { taskDefinitionSchema, judgmentStructureSchema } from "@/engine/schemas";
import {
  applyClarificationAnswer,
  assertStage01ReadyForApproval,
  ensureStage01ContractFields,
} from "@/engine/stage01_contract";
import {
  assertStage02ReadyForApproval,
  collectStage02ConsistencyIssues,
  ensureStage02DocumentFields,
  projectOntologyViewYaml,
} from "@/engine/stage02_documents";
import { syncStage01ReadableMarkdown, syncStage02ReadableMarkdown } from "@/engine/readable_markdown";

const longMd = "# 标题\n\n".padEnd(80, "正文内容足够长以通过 markdown 最小长度约束。");

function baseStage01() {
  const data: any = {
    normalized_question: "未来六个月供需是否改善？",
    core_object: "存储芯片",
    judgment_action: "趋势判断",
    time_scope: { lookback: "12个月", as_of: "2026-07-01", forward: "6个月" },
    boundaries: ["全球", "分产品"],
    exclusions: ["交易建议"],
    domain_supported: true,
    document_markdown: longMd,
  };
  ensureStage01ContractFields(data, "原始问题");
  data.task_disposition = "accepted";
  data.stage_status = "complete";
  data.quality_status = "minimum_pass";
  data.research_value_gate.status = "pass";
  data.overscope_check.status = "pass";
  data.input_resolution.mode = "direct_extract";
  data.input_resolution.status = "resolved";
  data.input_resolution.clarifications = [];
  data.input_resolution.unresolved_structural_ambiguities = [];
  syncStage01ReadableMarkdown(data, "原始问题");
  return data;
}

function baseStage02() {
  const data: any = {
    method_applications: [{
      application_id: "MA-A01-01",
      method_id: "BF-SD-01",
      method_version: "2.0.0",
      capability_type: "judgment_structure",
      target_question_refs: ["Q-01"],
      target_judgment_unit_refs: ["JU-1"],
      target_ontology_object_refs: [],
      status: "candidate",
      precondition_checks: [],
      input_evidence_refs: [],
      output_signal_refs: [],
      output_judgment_refs: [],
      execution_summary: "",
      applicability_boundary: "结构",
      limitations: [],
      counter_example_refs: [],
      provenance: { stage: "stage_02", source_application_id: null, actor: "test", recorded_at: null },
      alternatives: [],
    }, {
      application_id: "MA-A02-01",
      method_id: "kb03:A02",
      method_version: "3.2.0",
      capability_type: "evidence",
      target_question_refs: ["Q-01"],
      target_judgment_unit_refs: ["JU-1"],
      target_ontology_object_refs: [],
      status: "candidate",
      precondition_checks: [],
      input_evidence_refs: [],
      output_signal_refs: [],
      output_judgment_refs: [],
      execution_summary: "",
      applicability_boundary: "取证",
      limitations: [],
      counter_example_refs: [],
      provenance: { stage: "stage_02", source_application_id: null, actor: "test", recorded_at: null },
      alternatives: [],
    }, {
      application_id: "MA-A03-01",
      method_id: "kb04:A02",
      method_version: "1.0.0",
      capability_type: "adjudication",
      target_question_refs: ["Q-01"],
      target_judgment_unit_refs: ["JU-1"],
      target_ontology_object_refs: [],
      status: "candidate",
      precondition_checks: [],
      input_evidence_refs: [],
      output_signal_refs: [],
      output_judgment_refs: [],
      execution_summary: "",
      applicability_boundary: "裁决",
      limitations: [],
      counter_example_refs: [],
      provenance: { stage: "stage_02", source_application_id: null, actor: "test", recorded_at: null },
      alternatives: [],
    }],
    research_scope: { id: "SCOPE-1", label: "存储周期", dimensions: { object: "DRAM" } },
    judgment_units: [{
      id: "JU-1",
      title: "价格趋势",
      question: "合约价是否可持续上行？",
      judgment_type: "trend_direction",
      scope_ref: "SCOPE-1",
      ontology_node_ids: [],
      evidence_requirements: ["同口径合约价序列"],
    }],
    variables: [{
      id: "V-1",
      name: "合约价",
      category: "price",
      definition: "DRAM 合约价",
      variable_kind: "observed",
      anchors: ["合约价"],
      ontology_node_id: "task_local:V-1",
      role: "judgment_input",
    }],
    paths: [],
    questions: [],
    evidence_requirements: [{
      id: "ER-1",
      requirement: "同口径合约价序列",
      evidence_role: "support",
      minimum_independent_sources: 1,
      judgment_unit_ids: ["JU-1"],
    }],
    counter_evidence_directions: [{
      direction_id: "CD-1",
      statement: "现货价率先转弱",
      judgment_unit_ids: ["JU-1"],
    }],
    competing_explanations: [{
      explanation_id: "CE-1",
      statement: "仅为季节性补库",
      judgment_unit_ids: ["JU-1"],
      discriminating_evidence: ["连续两季库存与终端出货对照"],
    }],
    document_markdown: longMd,
    research_logic_markdown: longMd,
    ontology_view_yaml: "",
    can_enter_03: true,
  };
  ensureStage02DocumentFields(data, { question: "测试问题", taskId: "run-1" });
  syncStage02ReadableMarkdown(data);
  ensureStage02DocumentFields(data, { question: "测试问题", taskId: "run-1" });
  return data;
}

describe("stage01 clarification and quality gates", () => {
  it("accepts a dense accepted task definition", () => {
    const data = baseStage01();
    expect(() => taskDefinitionSchema.parse(data)).not.toThrow();
    expect(() => assertStage01ReadyForApproval(data)).not.toThrow();
  });

  it("blocks approval while clarification is pending", () => {
    const data = baseStage01();
    data.task_disposition = "needs_clarification";
    data.quality_status = "draft";
    data.input_resolution.mode = "direct_extract";
    data.input_resolution.status = "pending";
    data.input_resolution.clarifications = [{
      question_id: "UC-01",
      topic: "core_object",
      question: "是否分产品判断？",
      answer: null,
      answered_at: null,
    }];
    data.input_resolution.unresolved_structural_ambiguities = ["core_object"];
    syncStage01ReadableMarkdown(data, "原始问题");
    expect(() => taskDefinitionSchema.parse(data)).not.toThrow();
    expect(() => assertStage01ReadyForApproval(data)).toThrow(/accepted/);
  });

  it("rejects forged clarification answers under direct_extract", () => {
    const data = baseStage01();
    data.input_resolution.mode = "direct_extract";
    data.input_resolution.clarifications = [{
      question_id: "UC-01",
      topic: "core_object",
      question: "是否分产品？",
      answer: "伪造回答",
      answered_at: "2026-07-23T00:00:00Z",
    }];
    expect(() => taskDefinitionSchema.parse(data)).toThrow(/伪造/);
    expect(() => assertStage01ReadyForApproval(data)).toThrow(/伪造/);
  });

  it("applies one clarification answer and keeps history", () => {
    const data = baseStage01();
    data.task_disposition = "needs_clarification";
    data.input_resolution.clarifications = [{
      question_id: "UC-01",
      topic: "core_object",
      question: "是否分产品判断？",
      answer: null,
      answered_at: null,
    }];
    const next = applyClarificationAnswer(data, "分 HBM / 非 HBM DRAM / NAND");
    expect(next.input_resolution.mode).toBe("user_clarified");
    expect(next.input_resolution.clarifications[0].answer).toContain("HBM");
    expect(next.task_disposition).toBe("needs_clarification");
  });
});

describe("stage02 dual documents and gates", () => {
  it("requires research_logic_markdown and ontology_view_yaml", () => {
    const data = baseStage02();
    expect(data.research_logic_markdown.length).toBeGreaterThan(40);
    expect(data.ontology_view_yaml.length).toBeGreaterThan(20);
    expect(data.document_markdown).toBe(data.research_logic_markdown);
    expect(() => judgmentStructureSchema.parse(data)).not.toThrow();
    expect(() => assertStage02ReadyForApproval(data)).not.toThrow();
  });

  it("flags blocking_gap with can_enter_03=true", () => {
    const data = baseStage02();
    data.ontology_gap_scan_status = "blocking_gap";
    data.can_enter_03 = true;
    data.ontology_view_yaml = projectOntologyViewYaml(data);
    const issues = collectStage02ConsistencyIssues(data);
    expect(issues.some((item) => item.code === "blocking_gap_can_enter")).toBe(true);
    expect(() => judgmentStructureSchema.parse(data)).toThrow(/blocking_gap/);
  });

  it("flags judgment unit drift between JSON and YAML", () => {
    const data = baseStage02();
    data.ontology_view_yaml = projectOntologyViewYaml({
      ...data,
      judgment_units: [{ id: "JU-OTHER", title: "x", question: "y", judgment_type: "trend_direction", scope_ref: "SCOPE-1", ontology_node_ids: [], evidence_requirements: [] }],
    });
    const issues = collectStage02ConsistencyIssues(data);
    expect(issues.some((item) => item.code === "unit_missing_in_yaml")).toBe(true);
  });
});
