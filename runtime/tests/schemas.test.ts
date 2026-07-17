import { describe, expect, it } from "vitest";
import {
  evidencePreparationSchema,
  independentReviewSchema,
  judgmentDecisionSchema,
  researchExpressionSchema,
  taskDefinitionSchema,
} from "@/engine/schemas";
import {
  validateExpressionMethodBindings,
  validateJudgmentMethodBindings,
  validateMethodApplications,
} from "@/engine/method_application";
import type { MethodApplication } from "@/engine/types";

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
    provenance: { stage, source_application_id: stage === "stage_02" ? null : "MA-01", actor: "runtime-test", recorded_at: null },
    alternatives: [],
  };
}

describe("stage contracts", () => {
  it("accepts a valid task definition", () => {
    expect(taskDefinitionSchema.parse({
      normalized_question: "未来六个月供需是否改善？",
      core_object: "存储芯片",
      judgment_action: "趋势判断",
      time_scope: { lookback: "12个月", as_of: "当前", forward: "6个月" },
      boundaries: ["全球"],
      exclusions: ["交易建议"],
      report_type: "行业周期判断",
      domain_supported: true,
      document_markdown: "# 任务定义\n\n这是一个具有明确范围、时间和反证条件的研究问题，需要检查供给、需求、库存和价格变化。",
    })).toBeTruthy();
  });

  it("rejects evidence without sources", () => {
    expect(() => evidencePreparationSchema.parse({
      method_applications: [application("selected", "stage_03")],
      sources: [],
      evidence_drafts: [],
      unresolved_gaps: [],
      document_markdown: "# 证据准备\n\n没有来源不能形成可确认的证据草稿。",
    })).toThrow();
  });

  it("accepts J0 with an executed method application", () => {
    const executed = application("executed", "stage_04");
    expect(judgmentDecisionSchema.parse({
      method_applications: [executed],
      signals: [],
      judgments: [{
        id: "J-1",
        judgment_unit_id: "JU-1",
        title: "当前不可判断",
        conclusion: "关键证据不足",
        rationale: "缺少足够的交叉验证，方法执行结果只能停在 J0",
        strength: "J0",
        supporting_evidence_draft_ids: ["EV-1"],
        counter_evidence_draft_ids: [],
        method_application_ids: ["MA-01"],
        ontology_node_ids: ["StateVariable"],
        uncertainties: ["供给"],
        invalidation_conditions: ["获得产能数据"],
        tracking_signals: ["库存"],
      }],
      overall_boundary: "不外推",
      document_markdown: "# 判断\n\n由于关键证据不足，目前暂不可判断，不能把局部价格信号外推为全行业改善，需要继续跟踪库存和产能。",
    })).toBeTruthy();
    expect(() => validateMethodApplications("stage_04", [executed], {
      prior: [application("selected", "stage_03")],
      evidenceIds: new Set(["EV-1"]),
      judgmentIds: new Set(["J-1"]),
      signalIds: new Set(),
    })).not.toThrow();
    expect(() => validateJudgmentMethodBindings([{ id: "J-1", method_application_ids: ["MA-01"] }], [executed])).not.toThrow();
  });

  it("rejects executed method without evidence", () => {
    const invalid = { ...application("executed", "stage_04"), input_evidence_refs: [] };
    expect(() => validateMethodApplications("stage_04", [invalid], {
      prior: [application("selected", "stage_03")],
      evidenceIds: new Set(["EV-1"]),
      judgmentIds: new Set(["J-1"]),
    })).toThrow(/绑定输入证据/);
  });

  it("requires report claim traceability through judgments and methods", () => {
    const executed = application("executed", "stage_04");
    expect(researchExpressionSchema.parse({
      title: "报告",
      executive_points: ["当前只能形成受限判断"],
      report_claims: [{ id: "RC-1", statement: "结论", judgment_ids: ["J-1"], method_application_ids: ["MA-01"], source_ids: [] }],
      limitations: ["证据范围有限"],
      document_markdown: "# 报告\n\n当前结论严格继承判断与方法应用，不新增事实、方法调用或方向性判断；证据不足部分继续保留限制并等待后续更新。",
    })).toBeTruthy();
    expect(() => validateExpressionMethodBindings([{ id: "RC-1", method_application_ids: ["MA-01"] }], [executed])).not.toThrow();
  });

  it("accepts an independent review with an explicit return stage", () => {
    expect(independentReviewSchema.parse({
      reviewed_stage04_artifact_id: "artifact-04",
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
    })).toBeTruthy();
  });
});
