import { describe, expect, it } from "vitest";
import {
  formalOntologyRuleIds,
  repairJudgmentPreparationDraft,
} from "@/engine/judgment_draft_normalize";
import { validateReasoningTraceBindings } from "@/engine/reasoning_trace";

describe("repairJudgmentPreparationDraft", () => {
  it("exposes formal ontology rule ids from the authority registry", () => {
    const rules = formalOntologyRuleIds();
    expect(rules.has("judgment_status_consistency")).toBe(true);
    expect(rules.has("supply_constraint_to_price_delivery")).toBe(false);
  });

  it("remaps informal rule refs and demotes empty executed MAs", () => {
    const repaired: any = repairJudgmentPreparationDraft({
      method_applications: [{
        application_id: "MA-JS-01",
        method_id: "BF-SD-01",
        method_version: "1.0.0",
        capability_type: "judgment_structure",
        status: "executed",
        target_question_refs: [],
        target_judgment_unit_refs: ["JU-1"],
        target_ontology_object_refs: [],
        precondition_checks: [],
        input_evidence_refs: [],
        output_signal_refs: [],
        output_judgment_refs: ["J-1"],
        applicability_boundary: "",
        execution_summary: "假执行",
        limitations: [],
        counter_example_refs: [],
        alternatives: [],
        provenance: { stage: "stage_04", source_application_id: "MA-JS-01", recorded_at: "2026-07-23T00:00:00.000Z" },
      }, {
        application_id: "MA-AD-01",
        method_id: "kb04:A01",
        method_version: "1.0.0",
        capability_type: "adjudication",
        status: "blocked",
        target_question_refs: [],
        target_judgment_unit_refs: ["JU-1"],
        target_ontology_object_refs: [],
        precondition_checks: [{
          precondition_id: "evidence",
          result: "fail",
          evidence_refs: [],
          reason: "缺口",
        }],
        input_evidence_refs: [],
        output_signal_refs: [],
        output_judgment_refs: [],
        applicability_boundary: "",
        execution_summary: "",
        limitations: ["缺证据"],
        counter_example_refs: [],
        alternatives: ["补证后重跑"],
        provenance: { stage: "stage_04", source_application_id: "MA-AD-01", recorded_at: null },
      }],
      signals: [],
      hypotheses: [{
        id: "H-1",
        statement: "命题",
        signal_ids: [],
        falsification_conditions: ["反证"],
        judgment_unit_ids: ["JU-1"],
      }],
      competing_explanations: [],
      rule_evaluations: [{
        id: "RE-01",
        rule_ref: "supply_constraint_to_price_delivery",
        input_refs: ["J-1"],
        condition_results: [{ condition_id: "c1", input_refs: ["J-1"] }],
      }],
      judgments: [{
        id: "J-1",
        judgment_unit_id: "JU-1",
        title: "测试",
        conclusion: "暂不可判断",
        rationale: "缺证据",
        strength: "J1",
        confidence: "low",
        decision_status: "supported",
        conflict_status: "none",
        not_judgeable_reason: null,
        scope_ref: "SCOPE-1",
        cutoff_at: "2026-07-23T00:00:00.000Z",
        conditions: [],
        supporting_evidence_draft_ids: [],
        counter_evidence_draft_ids: [],
        hypothesis_ids: ["H-1"],
        rule_evaluation_ids: ["RE-01"],
        method_application_ids: ["MA-AD-01", "MA-JS-01"],
        ontology_node_ids: [],
        uncertainties: [],
        invalidation_conditions: [],
        tracking_signals: [],
      }],
      reasoning_traces: [{
        id: "RT-1",
        judgment_id: "J-1",
        node_ids: ["H-1", "RE-01", "MA-AD-01", "MA-JS-01", "J-1"],
        created_at: "2026-07-23T00:00:00.000Z",
      }],
      overall_boundary: "边界",
      document_markdown: "# 判断",
    });

    expect(repaired.method_applications[0].status).toBe("blocked");
    expect(repaired.method_applications[0].alternatives[0]).toMatchObject({
      method_id: "BF-SD-01",
      decision: expect.any(String),
      reason: expect.any(String),
    });
    expect(repaired.rule_evaluations[0].rule_ref).toBe("judgment_status_consistency");
    expect(repaired.judgments[0].strength).toBe("J0");
    expect(repaired.judgments[0].decision_status).toBe("indeterminate");
    expect(() => validateReasoningTraceBindings(repaired, new Set(), repaired.method_applications)).not.toThrow();
  });

  it("coerces string alternatives and fills executed recorded_at / trace created_at", () => {
    const repaired: any = repairJudgmentPreparationDraft({
      method_applications: [{
        application_id: "MA-AD-01",
        method_id: "kb04:A01",
        method_version: "1.0.0",
        capability_type: "adjudication",
        status: "executed",
        target_question_refs: [],
        target_judgment_unit_refs: ["JU-1"],
        target_ontology_object_refs: [],
        precondition_checks: [{
          precondition_id: "evidence",
          result: "pass",
          evidence_refs: ["ED-1"],
          reason: "ok",
        }],
        input_evidence_refs: ["ED-1"],
        output_signal_refs: [],
        output_judgment_refs: ["J-1"],
        applicability_boundary: null,
        execution_summary: "已裁决",
        limitations: [],
        counter_example_refs: [],
        alternatives: ["改走 J0"],
        provenance: { stage: "stage_03", source_application_id: "MA-AD-01", actor: "model", recorded_at: null },
      }],
      signals: [],
      hypotheses: [{ id: "H-1", statement: "命题", signal_ids: [], falsification_conditions: ["反证"], judgment_unit_ids: ["JU-1"] }],
      competing_explanations: [],
      rule_evaluations: [],
      judgments: [{
        id: "J-1",
        judgment_unit_id: "JU-1",
        title: "测试",
        conclusion: "成立",
        rationale: "有证据",
        strength: "J1",
        confidence: "low",
        decision_status: "supported",
        conflict_status: "none",
        not_judgeable_reason: null,
        scope_ref: "SCOPE-1",
        cutoff_at: "2026-07-23T00:00:00.000Z",
        conditions: [],
        supporting_evidence_draft_ids: ["ED-1"],
        counter_evidence_draft_ids: [],
        hypothesis_ids: ["H-1"],
        rule_evaluation_ids: [],
        method_application_ids: ["MA-AD-01"],
        ontology_node_ids: [],
        uncertainties: [],
        invalidation_conditions: [],
        tracking_signals: [],
      }],
      reasoning_traces: [{ id: "RT-1", judgment_id: "J-1", node_ids: ["H-1", "MA-AD-01", "J-1"], created_at: null }],
      overall_boundary: "边界",
      document_markdown: "# 判断",
    });
    expect(repaired.method_applications[0].alternatives[0]).toMatchObject({
      method_id: "kb04:A01",
      reason: "改走 J0",
    });
    expect(repaired.method_applications[0].provenance.stage).toBe("stage_04");
    expect(repaired.method_applications[0].provenance.recorded_at).toMatch(/^\d{4}-/);
    expect(repaired.reasoning_traces[0].created_at).toMatch(/^\d{4}-/);
  });
});
