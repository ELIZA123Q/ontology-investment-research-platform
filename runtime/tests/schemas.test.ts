import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  evidencePreparationSchema,
  independentReviewSchema,
  judgmentDecisionSchema,
  researchExpressionSchema,
  taskDefinitionSchema,
} from "@/engine/schemas";
import { ensureStage01ContractFields } from "@/engine/stage01_contract";
import { ensureStage03DocumentFields } from "@/engine/stage03_documents";
import { ensureStage05DocumentFields } from "@/engine/stage05_documents";
import { syncStage01ReadableMarkdown, syncStage03ReadableMarkdown, syncStage04ReadableMarkdown } from "@/engine/readable_markdown";
import {
  validateExpressionMethodBindings,
  validateJudgmentCapabilityCoverage,
  validateJudgmentMethodBindings,
  validateMethodApplications,
} from "@/engine/method_application";
import type { MethodApplication } from "@/engine/types";
import { validateReasoningTraceBindings } from "@/engine/reasoning_trace";
import { applyDeterministicRuleEvaluations } from "@/engine/semantic_execution";
import { emptyGraph, materializeStageIntoGraph } from "@/engine/instance_graph";
import { validateRuntimeGraph } from "@/engine/graph_contract";

function application(status: MethodApplication["status"], stage: MethodApplication["provenance"]["stage"]): MethodApplication {
  return {
    application_id: "MA-01",
    method_id: "kb04:A02",
    method_version: "1.0.0",
    capability_type: "adjudication",
    target_question_refs: ["Q-01"],
    target_judgment_unit_refs: ["JU-1"],
    target_ontology_object_refs: ["StateVariable"],
    status,
    precondition_checks: status === "candidate" ? [] : [{ precondition_id: "PC-01", result: "pass", evidence_refs: ["EV-1"], reason: "直接证据存在" }],
    input_evidence_refs: status === "candidate" ? [] : ["EV-1"],
    output_signal_refs: [],
    output_judgment_refs: status === "executed" ? ["J-1"] : [],
    execution_summary: status === "executed" ? "完成有边界裁决" : "",
    applicability_boundary: "趋势方向裁决",
    limitations: [],
    counter_example_refs: [],
    provenance: { stage, source_application_id: stage === "stage_02" ? null : "MA-01", actor: "runtime-test", recorded_at: status === "executed" ? "2026-07-18T08:00:00Z" : null },
    alternatives: [],
  };
}

describe("stage contracts", () => {
  it("requires every judgment unit to register structure, evidence and adjudication capabilities", () => {
    const adjudication = application("candidate", "stage_02");
    expect(() => validateJudgmentCapabilityCoverage([adjudication], [{ id: "JU-1" }]))
      .toThrow(/judgment_structure, evidence/);
    const structure = { ...adjudication, application_id: "MA-STRUCTURE", method_id: "BF-SD-01", method_version: "2.0.0", capability_type: "judgment_structure" as const };
    const evidence = { ...adjudication, application_id: "MA-EVIDENCE", method_id: "kb03:A02", method_version: "3.2.0", capability_type: "evidence" as const };
    expect(() => validateJudgmentCapabilityCoverage([structure, evidence, adjudication], [{ id: "JU-1" }])).not.toThrow();
  });

  it("accepts a valid task definition", () => {
    const data: any = {
      normalized_question: "未来六个月供需是否改善？",
      core_object: "存储芯片",
      judgment_action: "趋势判断",
      time_scope: { lookback: "12个月", as_of: "当前", forward: "6个月" },
      boundaries: ["全球"],
      exclusions: ["交易建议"],
      domain_supported: true,
      document_markdown: "# 任务定义\n\n这是一个具有明确范围、时间和反证条件的研究问题，需要检查供给、需求、库存和价格变化。",
    };
    ensureStage01ContractFields(data, "未来六个月供需是否改善？");
    data.task_disposition = "accepted";
    data.quality_status = "minimum_pass";
    data.research_value_gate.status = "pass";
    data.overscope_check.status = "pass";
    data.input_resolution.mode = "direct_extract";
    data.input_resolution.status = "resolved";
    data.input_resolution.clarifications = [];
    data.input_resolution.unresolved_structural_ambiguities = [];
    syncStage01ReadableMarkdown(data, "未来六个月供需是否改善？");
    expect(taskDefinitionSchema.parse(data)).toBeTruthy();
  });

  it("allows a source-free explicit gap but rejects source-free facts", () => {
    const gapApplication = {
      ...application("selected", "stage_03"),
      status: "blocked" as const,
      precondition_checks: [{ precondition_id: "source_available", result: "fail" as const, evidence_refs: ["GAP-1"], reason: "正式来源取得失败" }],
      input_evidence_refs: ["GAP-1"],
      limitations: ["当前无可核验来源"],
      alternatives: [{ method_id: "kb03:B01", decision: "retry", reason: "等待正式披露" }],
    };
    const gapDraft: any = {
      method_applications: [gapApplication],
      sources: [],
      evidence_drafts: [{
        id: "GAP-1", statement: "缺少可核验库存披露", kind: "gap", direction: "unknown", source_keys: [], source_ids: [],
        judgment_unit_ids: ["JU-1"], ontology_node_ids: ["SV-1"], requirement: "取得可定位库存披露",
        evidence_role: "boundary", minimum_independent_sources: 1, limitations: ["来源取得失败"],
      }],
      unresolved_gaps: ["缺少可核验库存披露"],
      document_markdown: "# 证据准备\n\n正式来源取得失败，未形成任何事实草稿；仅登记阻断性缺口和下一步回退路线，不使用搜索摘要替代证据。",
    };
    syncStage03ReadableMarkdown(gapDraft);
    expect(evidencePreparationSchema.parse(gapDraft)).toBeTruthy();
    const invalidFact: any = {
      method_applications: [application("selected", "stage_03")],
      sources: [],
      evidence_drafts: [{
        id: "EV-1", statement: "无来源事实", kind: "fact_draft", direction: "support", source_keys: ["SRC-X"], source_ids: [],
        judgment_unit_ids: ["JU-1"], ontology_node_ids: ["SV-1"], subject_ref: "SV-1", time_basis: "observation_time",
        scope_ref: "SCOPE-1", observed_at: "2026-07-18T00:00:00Z", valid_from: "2026-07-18T00:00:00Z", valid_to: null,
        published_at: "2026-07-18T00:00:00Z", cutoff_at: "2026-07-18T08:00:00Z", directness: "direct", limitations: [],
      }],
      unresolved_gaps: ["来源缺失"],
      document_markdown: "# 证据准备\n\n没有来源时不得生成事实草稿；该负向样例必须由合同拒绝，以防为了填满结构而制造证据。",
    };
    ensureStage03DocumentFields(invalidFact);
    expect(() => evidencePreparationSchema.parse(invalidFact)).toThrow(/无来源时只能登记显式 gap/);
  });

  it("accepts J0 with an executed method application", () => {
    const executed = application("executed", "stage_04");
    const judgmentDraft: any = {
      method_applications: [executed],
      signals: [{
        id: "S-1",
        statement: "库存数据构成观察信号",
        role: "support",
        evidence_draft_ids: ["EV-1"],
        judgment_unit_ids: ["JU-1"],
        target_hypothesis_ids: ["H-1"],
      }],
      hypotheses: [{
        id: "H-1",
        statement: "库存变化可能代表趋势改善",
        signal_ids: ["S-1"],
        falsification_conditions: ["库存重新上升"],
        time_horizon: "未来一个季度",
      }],
      competing_explanations: [{
        id: "CE-1",
        statement: "库存下降来自季节性备货而非趋势改善",
        signal_ids: ["S-1"],
        discriminating_evidence: ["跨周期库存与终端需求对照"],
        status: "active",
        elimination_rationale: "尚无足够跨周期证据排除",
      }],
      rule_evaluations: [{
        id: "RE-1",
        rule_ref: "evidence_scope_time_alignment",
        input_refs: ["EV-1"],
        condition_results: [{
          condition_id: "scope_match",
          expression: "evidence.scope == judgment.scope",
          input_refs: ["EV-1"],
          outcome: "pass",
          rationale: "证据与判断范围一致",
        }],
        result: "pass",
        deterministic_result: null,
      }],
      judgments: [{
        id: "J-1",
        judgment_unit_id: "JU-1",
        title: "当前不可判断",
        conclusion: "关键证据不足",
        rationale: "缺少足够的交叉验证，方法执行结果只能停在 J0",
        strength: "J0",
        confidence: "low",
        decision_status: "indeterminate",
        conflict_status: "unresolved",
        not_judgeable_reason: "交叉验证不足",
        scope_ref: "SCOPE-1",
        cutoff_at: "2026-07-18T08:00:00Z",
        conditions: [],
        supporting_evidence_draft_ids: ["EV-1"],
        counter_evidence_draft_ids: [],
        hypothesis_ids: ["H-1"],
        rule_evaluation_ids: ["RE-1"],
        method_application_ids: ["MA-01"],
        ontology_node_ids: ["StateVariable"],
        uncertainties: ["供给"],
        invalidation_conditions: ["获得产能数据"],
        tracking_signals: ["库存"],
      }],
      reasoning_traces: [{
        id: "RT-1",
        judgment_id: "J-1",
        node_ids: ["EV-1", "S-1", "H-1", "RE-1", "MA-01", "J-1"],
        created_at: "2026-07-17T12:00:00+08:00",
      }],
      overall_boundary: "不外推",
      document_markdown: "# 判断\n\n由于关键证据不足，目前暂不可判断，不能把局部价格信号外推为全行业改善，需要继续跟踪库存和产能。",
    };
    syncStage04ReadableMarkdown(judgmentDraft);
    expect(judgmentDecisionSchema.parse(judgmentDraft)).toBeTruthy();
    expect(() => validateMethodApplications("stage_04", [executed], {
      prior: [application("selected", "stage_03")],
      evidenceIds: new Set(["EV-1"]),
      judgmentIds: new Set(["J-1"]),
      signalIds: new Set(),
    })).not.toThrow();
    expect(() => validateJudgmentMethodBindings([{ id: "J-1", method_application_ids: ["MA-01"] }], [executed])).not.toThrow();
  });

  it("runs a genuine no-source J0 path without fabricating facts or signals", () => {
    const candidate = application("candidate", "stage_02");
    const blocked03: MethodApplication = {
      ...candidate,
      status: "blocked",
      precondition_checks: [{ precondition_id: "source_available", result: "fail", evidence_refs: ["GAP-1"], reason: "正式来源取得失败" }],
      input_evidence_refs: ["GAP-1"],
      limitations: ["当前没有可核验来源"],
      provenance: { stage: "stage_03", source_application_id: "MA-01", actor: "runtime-test", recorded_at: null },
      alternatives: [{ method_id: "kb03:B01", decision: "retry", reason: "等待正式披露后重试" }],
    };
    const blocked04: MethodApplication = {
      ...blocked03,
      provenance: { ...blocked03.provenance, stage: "stage_04" },
    };
    const gap = {
      id: "GAP-1", statement: "缺少可核验库存披露", kind: "gap" as const, direction: "unknown" as const,
      source_keys: [], source_ids: [], judgment_unit_ids: ["JU-1"], ontology_node_ids: ["SV-1"],
      requirement: "取得可定位的库存披露", evidence_role: "boundary" as const, minimum_independent_sources: 1,
      limitations: ["来源取得失败"],
    };
    const decision: any = {
      method_applications: [blocked04],
      signals: [],
      hypotheses: [{ id: "H-EMPTY", statement: "库存改善假设尚未获得可评价输入", signal_ids: [], falsification_conditions: ["取得的正式数据否定库存改善"], time_horizon: "下一次正式披露前" }],
      competing_explanations: [{ id: "CE-EMPTY", statement: "现有线索可能来自口径或时点差异", signal_ids: [], discriminating_evidence: ["同口径正式库存披露"], status: "unknown", elimination_rationale: "无事实输入，不能排除" }],
      rule_evaluations: [],
      judgments: [{
        id: "J-EMPTY", judgment_unit_id: "JU-1", title: "暂不可判断", conclusion: "当前不能判断库存是否改善",
        rationale: "正式来源取得失败，未形成任何 EvidenceFact", strength: "J0", confidence: "low",
        decision_status: "indeterminate", conflict_status: "none", not_judgeable_reason: "缺少可核验事实来源",
        scope_ref: "SCOPE-1", cutoff_at: "2026-07-18T08:00:00Z", conditions: [], supporting_evidence_draft_ids: [],
        counter_evidence_draft_ids: [], hypothesis_ids: ["H-EMPTY"], rule_evaluation_ids: [], method_application_ids: ["MA-01"],
        ontology_node_ids: ["SV-1"], uncertainties: ["库存真实状态未知"], invalidation_conditions: ["取得正式库存披露"], tracking_signals: ["正式库存披露"],
      }],
      reasoning_traces: [{ id: "RT-EMPTY", judgment_id: "J-EMPTY", node_ids: ["SCOPE-1", "JU-1", "H-EMPTY", "MA-01", "J-EMPTY"], created_at: "2026-07-18T08:00:00Z" }],
      overall_boundary: "无事实输入，不输出方向判断",
      document_markdown: "# 暂不可判断\n\n截至信息截止时点没有取得可核验来源，因此不生成事实或信号，不输出方向结论；仅保留待检验假设、阻断原因和后续跟踪条件。",
    };
    applyDeterministicRuleEvaluations(decision, [gap], [], { judgment_units: [{ id: "JU-1" }] });
    syncStage04ReadableMarkdown(decision);
    const parsed = judgmentDecisionSchema.parse(decision);
    expect(parsed.signals).toHaveLength(0);
    expect(parsed.judgments[0].supporting_evidence_draft_ids).toHaveLength(0);
    expect(() => validateMethodApplications("stage_03", [blocked03], { prior: [candidate], evidenceIds: new Set(["GAP-1"]) })).not.toThrow();
    expect(() => validateMethodApplications("stage_04", [blocked04], {
      prior: [blocked03], evidenceIds: new Set(["GAP-1"]), judgmentIds: new Set(["J-EMPTY"]), signalIds: new Set(),
      evidenceDrafts: [gap], sourceGroupById: new Map(),
    })).not.toThrow();
    expect(() => validateJudgmentMethodBindings(parsed.judgments, [blocked04])).not.toThrow();
    expect(() => validateReasoningTraceBindings(parsed, new Set(["GAP-1"]), [blocked04])).not.toThrow();

    const structure = {
      method_applications: [candidate], research_scope: { id: "SCOPE-1", label: "库存范围", dimensions: { domain: "semiconductor" } },
      judgment_units: [{ id: "JU-1", question: "库存是否改善", judgment_type: "state_measurement", scope_ref: "SCOPE-1" }],
      variables: [{ id: "SV-1", name: "inventory", category: "operations", definition: "可比口径库存", variable_kind: "observed", anchors: ["inventory"] }],
    };
    const evidence = { method_applications: [blocked03], sources: [], evidence_drafts: [gap] };
    let graph = materializeStageIntoGraph(emptyGraph(), "stage_02", structure);
    graph = materializeStageIntoGraph(graph, "stage_03", evidence);
    graph = materializeStageIntoGraph(graph, "stage_04", parsed);
    expect(() => validateRuntimeGraph(graph)).not.toThrow();
  });

  it("rejects executed method without evidence", () => {
    const invalid = { ...application("executed", "stage_04"), input_evidence_refs: [] };
    expect(() => validateMethodApplications("stage_04", [invalid], {
      prior: [application("selected", "stage_03")],
      evidenceIds: new Set(["EV-1"]),
      judgmentIds: new Set(["J-1"]),
    })).toThrow(/绑定输入证据/);
  });

  it("enforces MethodApplication stage ownership and inheritance", () => {
    expect(() => validateMethodApplications("stage_02", [
      application("selected", "stage_02"),
    ])).toThrow(/stage_02 只能是 candidate/);

    expect(() => validateMethodApplications("stage_03", [], {
      prior: [application("candidate", "stage_02")],
    })).toThrow(/至少需要一项 MethodApplication|不得静默删除/);

    const drifted = application("selected", "stage_03");
    drifted.target_judgment_unit_refs = ["JU-2"];
    expect(() => validateMethodApplications("stage_03", [drifted], {
      prior: [application("candidate", "stage_02")],
    })).toThrow(/target_judgment_unit_refs 不得跨阶段漂移/);

    const removedTarget = application("selected", "stage_03");
    removedTarget.target_ontology_object_refs = [];
    expect(() => validateMethodApplications("stage_03", [removedTarget], {
      prior: [application("candidate", "stage_02")],
    })).toThrow(/只允许追加/);

    const invalidProvenance = application("selected", "stage_03");
    invalidProvenance.provenance.source_application_id = null;
    expect(() => validateMethodApplications("stage_03", [invalidProvenance], {
      prior: [application("candidate", "stage_02")],
    })).toThrow(/必须沿用自身 MA ID/);
  });

  it("requires report claim traceability through judgments and methods", () => {
    const executed = application("executed", "stage_04");
    const expression: any = {
      title: "报告",
      executive_points: ["当前只能形成受限判断"],
      report_claims: [{ id: "RC-1", statement: "结论", judgment_ids: ["J-1"], method_application_ids: ["MA-01"], evidence_draft_ids: ["EV-1"], source_ids: [] }],
      limitations: ["证据范围有限"],
      document_markdown: "# 报告\n\n当前结论严格继承判断与方法应用，不新增事实、方法调用或方向性判断；证据不足部分继续保留限制并等待后续更新。",
    };
    ensureStage05DocumentFields(expression);
    expect(researchExpressionSchema.parse(expression)).toBeTruthy();
    expect(() => validateExpressionMethodBindings(
      [{ id: "RC-1", judgment_ids: ["J-1"], method_application_ids: ["MA-01"], evidence_draft_ids: ["EV-1"] }],
      [executed],
      [{ id: "J-1", strength: "J1", decision_status: "supported", method_application_ids: ["MA-01"] }],
    )).not.toThrow();
  });

  it("does not let structure or evidence applications impersonate adjudication", () => {
    const evidenceOnly = { ...application("executed", "stage_04"), capability_type: "evidence" as const };
    const judgment = { id: "J-1", strength: "J1", decision_status: "supported", method_application_ids: ["MA-01"] };
    expect(() => validateJudgmentMethodBindings([judgment], [evidenceOnly])).toThrow(/不能代替裁决/);
    expect(() => validateExpressionMethodBindings(
      [{ id: "EX-1", judgment_ids: ["J-1"], method_application_ids: ["MA-01"] }],
      [evidenceOnly], [judgment],
    )).toThrow(/adjudication/);
  });

  it("rejects evidence that bypasses signals and non-formal support rules", () => {
    const executed = application("executed", "stage_04");
    const base = {
      signals: [{ id: "S-1", evidence_draft_ids: ["EV-1"], target_hypothesis_ids: ["H-1"] }],
      hypotheses: [{ id: "H-1", signal_ids: ["S-1"], falsification_conditions: ["库存反转"] }],
      rule_evaluations: [{
        id: "RE-1",
        rule_ref: "evidence_scope_time_alignment",
        input_refs: ["EV-1"],
        condition_results: [{ condition_id: "scope", input_refs: ["EV-1"] }],
      }],
      judgments: [{
        id: "J-1",
        supporting_evidence_draft_ids: ["EV-1"],
        counter_evidence_draft_ids: [],
        hypothesis_ids: ["H-1"],
        rule_evaluation_ids: ["RE-1"],
        method_application_ids: ["MA-01"],
      }],
      reasoning_traces: [{ id: "RT-1", judgment_id: "J-1", node_ids: ["EV-1", "S-1", "H-1", "RE-1", "MA-01", "J-1"] }],
    };
    expect(() => validateReasoningTraceBindings(base, new Set(["EV-1"]), [executed])).not.toThrow();
    expect(() => validateReasoningTraceBindings({
      ...base,
      judgments: [{ ...base.judgments[0], supporting_evidence_draft_ids: ["EV-2"] }],
    }, new Set(["EV-1", "EV-2"]), [executed])).toThrow(/绕过了 Signal\/Hypothesis/);
    expect(() => validateReasoningTraceBindings({
      ...base,
      rule_evaluations: [{ ...base.rule_evaluations[0], rule_ref: "reasoning_trace_required" }],
    }, new Set(["EV-1"]), [executed])).toThrow(/非正式本体规则/);
  });

  it("computes formal rule outcomes instead of trusting model declarations", () => {
    const source = {
      id: "SRC-DB-1", run_id: "RUN-1", normalized_url: "https://example.com/source", url: "https://example.com/source",
      title: "source", publisher: "publisher", published_at: "2026-07-18", accessed_at: "2026-07-18T00:00:00Z",
      source_type: "disclosure", search_excerpt: "inventory declined", content_hash: "a".repeat(64),
      source_tier: "S2" as const, source_group: "publisher",
      usability_status: "usable" as const, retrieval_status: "captured" as const, quote_verified: true,
    };
    const base = {
      signals: [{ id: "S-1", evidence_draft_ids: ["EV-1"], target_hypothesis_ids: ["H-1"] }],
      hypotheses: [{ id: "H-1", signal_ids: ["S-1"] }],
      competing_explanations: [{ id: "CE-1", signal_ids: ["S-1"], status: "eliminated" }],
      rule_evaluations: [],
      judgments: [{
        id: "J-1", strength: "J1", supporting_evidence_draft_ids: ["EV-1"], counter_evidence_draft_ids: [],
        hypothesis_ids: ["H-1"], rule_evaluation_ids: [], judgment_unit_id: "JU-1",
        scope_ref: "SCOPE-1", cutoff_at: "2026-07-18T08:00:00Z", decision_status: "supported", conflict_status: "none",
      }],
      reasoning_traces: [{ id: "RT-1", judgment_id: "J-1", node_ids: ["EV-1", "S-1", "H-1", "J-1"] }],
    };
    const evidence = [{
      id: "EV-1", source_ids: [source.id], limitations: [], scope_ref: "SCOPE-1", directness: "direct" as const,
      observed_at: "2026-07-17T00:00:00Z", valid_from: "2026-07-17T00:00:00Z",
      published_at: "2026-07-18T00:00:00Z", cutoff_at: "2026-07-18T08:00:00Z",
    }];
    const structure = { judgment_units: [{ id: "JU-1" }] };
    expect(() => applyDeterministicRuleEvaluations(structuredClone(base), evidence, [source], structure)).not.toThrow();
    const overclaim = structuredClone(base);
    overclaim.judgments[0].strength = "J3";
    overclaim.competing_explanations[0].status = "active";
    const demoted = applyDeterministicRuleEvaluations(overclaim, evidence, [source], structure);
    expect(demoted.judgments[0]).toMatchObject({
      strength: "J0",
      decision_status: "indeterminate",
      supporting_evidence_draft_ids: [],
    });
  });

  it("accepts an independent review with an explicit return stage", () => {
    expect(independentReviewSchema.parse({
      reviewed_stage04_artifact_id: "artifact-04",
      reviewed_stage04_artifact_hash: null,
      verdict: "rework",
      issues: [{
        issue_type: "overclaim",
        judgment_id: "J-1",
        description: "当前结论超过证据可支持的强度",
        evidence_refs: ["EV-1"],
        required_action: "将判断降级或补充直接证据",
        return_stage: "stage_04",
      }],
      strengths: ["保留了反证"],
      overall_assessment: "需要在 04 降低结论强度后重新审阅。",
      document_markdown: "# 独立审阅\n\n当前判断保留了反证，但结论强度超过现有证据边界，需要退回阶段 04 调整。",
      reviewer_model: null,
      producer_model: null,
      independence_level: null,
    })).toBeTruthy();
  });

  it("materializes scopeIncludesObject from core_object and typed ontology instances", () => {
    const structure = {
      research_scope: {
        id: "SCOPE-1",
        label: "存储芯片范围",
        dimensions: { domain: "semiconductor", core_object: "存储芯片行业" },
      },
      ontology_instances: [
        { id: "OBJ-PROD-1", type: "Product", name: "DRAM", dimension: "product" },
        { id: "OBJ-METRIC-1", type: "Metric", name: "库存天数", time_basis: "quarter_end", dimension: "metric" },
      ],
      judgment_units: [{
        id: "JU-1",
        question: "库存是否改善",
        judgment_type: "state_measurement",
        scope_ref: "SCOPE-1",
        ontology_node_ids: ["OBJ-PROD-1"],
      }],
      variables: [{ id: "SV-1", name: "inventory", category: "operations", definition: "可比口径库存", variable_kind: "observed", anchors: ["inventory"] }],
    };
    const graph = materializeStageIntoGraph(emptyGraph(), "stage_02", structure);
    const includes = graph.relations.filter((relation) => relation.type === "scopeIncludesObject");
    expect(includes.map((relation) => relation.targetId).sort()).toEqual(["OBJ-METRIC-1", "OBJ-PROD-1", "OBJ-SCOPE-CORE"]);
    expect(includes.every((relation) => typeof relation.properties?.dimension === "string" && relation.properties.dimension)).toBe(true);
    expect(graph.objects.find((object) => object.id === "OBJ-SCOPE-CORE")?.type).toBe("Industry");
    expect(graph.objects.find((object) => object.id === "OBJ-PROD-1")?.type).toBe("Product");
    expect(() => validateRuntimeGraph(graph)).not.toThrow();
  });

  it("Stage02 CompetingExplanation 投影补齐 Ontology 必填 discriminating_evidence", () => {
    const structure = {
      method_applications: [],
      research_scope: { id: "SCOPE-1", label: "测试范围", dimensions: { domain: "semiconductor" } },
      judgment_units: [{
        id: "JU-1",
        question: "库存是否改善",
        judgment_type: "state_measurement",
        scope_ref: "SCOPE-1",
        evidence_requirements: ["两项独立库存序列"],
      }],
      variables: [{ id: "SV-1", name: "inventory", category: "operations", definition: "可比口径库存", variable_kind: "observed", anchors: ["inventory"] }],
      competing_explanations: [{
        explanation_id: "CE-EXP-01",
        statement: "季节性波动造成假象",
        judgment_unit_ids: ["JU-1"],
      }],
    };
    const graph = materializeStageIntoGraph(emptyGraph(), "stage_02", structure);
    const competing = graph.objects.find((object) => object.id === "CE-EXP-01");
    expect(competing?.type).toBe("CompetingExplanation");
    expect(competing?.properties?.discriminating_evidence).toEqual(["两项独立库存序列"]);
    expect(() => validateRuntimeGraph(graph)).not.toThrow();
  });
});
