import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { taskDefinitionSchema, judgmentStructureSchema } from "@/engine/schemas";
import {
  applyClarificationAnswer,
  applyClarificationAnswers,
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
    document_markdown: "# 投研需求说明\n\n".padEnd(520, "正式需求说明正文，覆盖对象、时间、用途与交付落点。"),
  };
  ensureStage01ContractFields(data, "原始问题");
  data.task_disposition = "accepted";
  data.stage_status = "complete";
  data.quality_status = "high_quality_pass";
  data.deterministic_check_status = "checked";
  data.research_value_gate = {
    ...data.research_value_gate,
    status: "pass",
    disagreement_or_unknown: "市场把涨价等同见顶，库存口径仍分化",
    changing_variable: "合约价与有效供给",
    incremental_question: "相对常见见顶叙事，真正增量是分产品切换条件",
    decision_use: "内部行业跟踪",
  };
  data.overscope_check.status = "pass";
  data.delivery_archetype = { primary: "industry_cycle_report", secondary: [], modules: [] };
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
      title: "HBM 周期",
      question: "HBM 是否结构性扩张？",
      judgment_type: "cycle_phase",
      scope_ref: "SCOPE-1",
      ontology_node_ids: [],
      evidence_requirements: ["HBM 出货"],
    }, {
      id: "JU-2",
      title: "通用 DRAM",
      question: "通用 DRAM 是否供给约束？",
      judgment_type: "cycle_phase",
      scope_ref: "SCOPE-1",
      ontology_node_ids: [],
      evidence_requirements: ["DRAM 合约价"],
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
      requirement: "HBM 出货",
      evidence_role: "support",
      minimum_independent_sources: 1,
      judgment_unit_ids: ["JU-1"],
    }, {
      id: "ER-2",
      requirement: "DRAM 合约价",
      evidence_role: "support",
      minimum_independent_sources: 1,
      judgment_unit_ids: ["JU-2"],
    }, {
      id: "ER-3",
      requirement: "渠道库存回补证伪",
      evidence_role: "counter",
      minimum_independent_sources: 1,
      judgment_unit_ids: ["JU-1", "JU-2"],
    }],
    counter_evidence_directions: [{
      direction_id: "CD-1",
      statement: "现货价与渠道库存率先转弱",
      judgment_unit_ids: ["JU-1"],
    }],
    competing_explanations: [{
      explanation_id: "CE-1",
      statement: "仅为季节性补库而非结构性紧缺",
      judgment_unit_ids: ["JU-1"],
      discriminating_evidence: ["连续两季库存与终端出货对照"],
    }],
    document_markdown: [
      "# 研究逻辑",
      "",
      "选用供需框架并裁剪为 HBM/DRAM 分产品主线；critical 单元为通用 DRAM 供给约束。",
      "",
      "## 停止条件",
      "",
      "当关键产品线具备可核验价格与出货对照，且竞争解释可区分时停止，不再为堆材料而扩围。",
      "",
      "分产品机制叙述，覆盖 HBM 与通用 DRAM 的判断主线与竞争解释。",
      "",
    ].join("\n").padEnd(820, "机制与边界展开。"),
    research_logic_markdown: [
      "# 研究逻辑",
      "",
      "选用供需框架并裁剪为 HBM/DRAM 分产品主线；critical 单元为通用 DRAM 供给约束。",
      "",
      "## 停止条件",
      "",
      "当关键产品线具备可核验价格与出货对照，且竞争解释可区分时停止，不再为堆材料而扩围。",
      "",
      "分产品机制叙述，覆盖 HBM 与通用 DRAM 的判断主线与竞争解释。",
      "",
    ].join("\n").padEnd(820, "机制与边界展开。"),
    ontology_view_yaml: "",
    can_enter_03: true,
    judgment_spine: "区分 HBM 结构性扩张与通用 DRAM 供给约束下的卖方定价",
    quality_status: "high_quality_pass",
    deterministic_check_status: "checked",
  };
  // 同步 MA 目标到双单元
  for (const ma of data.method_applications) {
    ma.target_judgment_unit_refs = ["JU-1", "JU-2"];
  }
  ensureStage02DocumentFields(data, { question: "测试问题", taskId: "run-1" });
  syncStage02ReadableMarkdown(data);
  data.quality_status = "high_quality_pass";
  data.deterministic_check_status = "checked";
  ensureStage02DocumentFields(data, { question: "测试问题", taskId: "run-1" });
  data.quality_status = "high_quality_pass";
  data.deterministic_check_status = "checked";
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

  it("synthesizes a short human clarification when model left question empty", () => {
    const data = baseStage01();
    data.task_disposition = "needs_clarification";
    data.quality_status = "draft";
    data.original_input = "存储芯片目前处于什么周期，本轮周期什么时候结束";
    data.input_resolution.mode = "direct_extract";
    data.input_resolution.status = "pending";
    data.input_resolution.system_understanding = {
      core_object: "存储芯片中的 HBM、非 HBM DRAM 与 NAND",
      judgment_action: "周期阶段定位",
      time_window: "未来两季度",
      scope_boundary: "半导体存储",
      delivery_landing: "内部跟踪",
    };
    data.input_resolution.clarifications = [{
      question_id: "UC-01",
      topic: "structural_ambiguity",
      question: "",
      answer: null,
      answered_at: null,
    }];
    data.input_resolution.unresolved_structural_ambiguities = ["core_object"];
    ensureStage01ContractFields(data, data.original_input);
    const pending = data.input_resolution.clarifications.find((item: any) => !item.answer);
    expect(pending.question).toMatch(/拆开判断|分开判断|按整体/);
    expect(pending.question).not.toMatch(/structural_ambiguity|UC-|当前理解的|请确认本次|结构性歧义/);
    expect(pending.question.length).toBeLessThanOrEqual(80);
  });

  it("keeps 7/13-style human questions untouched", () => {
    const data = baseStage01();
    data.task_disposition = "needs_clarification";
    data.quality_status = "draft";
    data.input_resolution.mode = "direct_extract";
    data.input_resolution.status = "pending";
    data.input_resolution.clarifications = [{
      question_id: "UC-01",
      topic: "core_object",
      question: "是否把 HBM、非 HBM DRAM 与 NAND 分开判断",
      answer: null,
      answered_at: null,
    }];
    data.input_resolution.unresolved_structural_ambiguities = ["core_object"];
    ensureStage01ContractFields(data, "存储芯片目前处于什么周期");
    expect(data.input_resolution.clarifications[0].question).toBe("是否把 HBM、非 HBM DRAM 与 NAND 分开判断");
  });

  it("creates pending clarifications for all unresolved ambiguities at once", () => {
    const data = baseStage01();
    data.task_disposition = "needs_clarification";
    data.quality_status = "draft";
    data.input_resolution.mode = "direct_extract";
    data.input_resolution.status = "pending";
    data.input_resolution.clarifications = [];
    data.input_resolution.unresolved_structural_ambiguities = ["core_object", "time_scope", "delivery_landing"];
    ensureStage01ContractFields(data, "存储周期何时结束");
    expect(data.input_resolution.clarifications).toHaveLength(3);
    expect(data.input_resolution.clarifications.every((item: any) => !item.answer)).toBe(true);
    expect(data.input_resolution.clarifications.map((item: any) => item.topic)).toEqual([
      "core_object",
      "time_scope",
      "delivery_landing",
    ]);
  });

  it("applies the full clarification batch in one submit", () => {
    const data = baseStage01();
    data.task_disposition = "needs_clarification";
    data.input_resolution.clarifications = [
      {
        question_id: "UC-01",
        topic: "core_object",
        question: "是否把 HBM、非 HBM DRAM 与 NAND 分开判断",
        answer: null,
        answered_at: null,
      },
      {
        question_id: "UC-02",
        topic: "event_scope_and_time_window",
        question: "“当前”和“本轮周期结束”如何落到时间范围",
        answer: null,
        answered_at: null,
      },
      {
        question_id: "UC-03",
        topic: "delivery_landing",
        question: "是否输出行业周期判断并排除个股投资建议",
        answer: null,
        answered_at: null,
      },
    ];
    data.input_resolution.unresolved_structural_ambiguities = [
      "core_object",
      "event_scope_and_time_window",
      "delivery_landing",
    ];
    const next = applyClarificationAnswers(data, [
      { question_id: "UC-01", answer: "分产品判断，不用存储芯片整体均值替代" },
      { question_id: "UC-02", answer: "当前按每次运行数据截止时点，结束按未来 6—24 个月的条件式窗口处理" },
      { question_id: "UC-03", answer: "输出行业周期判断，不做个股评级、目标价、收益率预测或仓位建议" },
    ]);
    expect(next.input_resolution.mode).toBe("user_clarified");
    expect(next.input_resolution.clarifications.every((item: any) => Boolean(item.answer))).toBe(true);
    expect(next.input_resolution.unresolved_structural_ambiguities).toEqual([]);
  });

  it("rejects partial clarification submit when multiple questions are pending", () => {
    const data = baseStage01();
    data.task_disposition = "needs_clarification";
    data.input_resolution.clarifications = [
      {
        question_id: "UC-01",
        topic: "core_object",
        question: "是否把 HBM、非 HBM DRAM 与 NAND 分开判断",
        answer: null,
        answered_at: null,
      },
      {
        question_id: "UC-02",
        topic: "delivery_landing",
        question: "是否输出行业周期判断并排除个股投资建议",
        answer: null,
        answered_at: null,
      },
    ];
    expect(() => applyClarificationAnswer(data, "分产品判断")).toThrow(/全部澄清问题/);
  });

  it("allows all-answered needs_clarification while awaiting regenerate", () => {
    const data = baseStage01();
    data.task_disposition = "needs_clarification";
    data.quality_status = "draft";
    data.input_resolution.mode = "user_clarified";
    data.input_resolution.status = "pending";
    data.input_resolution.clarifications = [
      {
        question_id: "UC-01",
        topic: "core_object",
        question: "是否把 HBM、非 HBM DRAM 与 NAND 分开判断",
        answer: "分产品判断",
        answered_at: "2026-07-24T00:00:00Z",
      },
      {
        question_id: "UC-02",
        topic: "delivery_landing",
        question: "是否输出行业周期判断并排除个股投资建议",
        answer: "只做行业判断",
        answered_at: "2026-07-24T00:00:00Z",
      },
    ];
    data.input_resolution.unresolved_structural_ambiguities = [];
    expect(() => taskDefinitionSchema.parse(data)).not.toThrow();
  });

  it("seeds default clarification batch when needs_clarification has no questions", () => {
    const data = baseStage01();
    data.task_disposition = "needs_clarification";
    data.quality_status = "draft";
    data.original_input = "存储芯片目前处于什么周期，本轮周期什么时候结束";
    data.input_resolution.mode = "direct_extract";
    data.input_resolution.status = "pending";
    data.input_resolution.clarifications = [];
    data.input_resolution.unresolved_structural_ambiguities = [];
    ensureStage01ContractFields(data, data.original_input);
    expect(data.input_resolution.clarifications.length).toBeGreaterThanOrEqual(3);
    expect(data.input_resolution.clarifications.every((item: any) => !item.answer)).toBe(true);
    expect(() => taskDefinitionSchema.parse(data)).not.toThrow();
  });

  it("rejects template-cavity clarification questions in schema", () => {
    const data = baseStage01();
    data.task_disposition = "needs_clarification";
    data.quality_status = "draft";
    data.input_resolution.mode = "direct_extract";
    data.input_resolution.status = "pending";
    data.input_resolution.clarifications = [{
      question_id: "UC-01",
      topic: "core_object",
      question: "当前理解的研究对象是「存储芯片」。请确认本次要判断的核心对象是什么？",
      answer: null,
      answered_at: null,
    }];
    data.input_resolution.unresolved_structural_ambiguities = ["core_object"];
    expect(() => taskDefinitionSchema.parse(data)).toThrow(/短句人话|模板腔/);
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
