import { describe, expect, it } from "vitest";
import { buildOntologyStructureReview, structureReviewActionHref } from "@/skills/ontology/structure_review";
import type { BusinessInstanceGraph } from "@/skills/ontology/instance_graph/types";

const formal = new Map([["formal_price", "产品价格"]]);

function structure(overrides: Record<string, unknown> = {}) {
  return {
    research_scope: { id: "SCOPE-1", label: "存储市场" },
    variables: [
      { id: "VAR-1", name: "产品价格", ontology_node_id: "formal_price" },
      { id: "VAR-2", name: "本轮渠道口径", ontology_node_id: "task_local:VAR-2" },
    ],
    judgment_units: [{ id: "JU-1", title: "价格是否改善", scope_ref: "SCOPE-1", ontology_node_ids: ["formal_price"] }],
    evidence_requirements: [{ id: "ER-1", requirement: "价格序列", judgment_unit_ids: ["JU-1"] }],
    competing_explanations: [],
    counter_evidence_directions: [],
    ...overrides,
  };
}

function graph(): BusinessInstanceGraph {
  return {
    schema_name: "ontology_business_instance_graph",
    schema_version: "1.0.0",
    authority: "test",
    objects: [
      { id: "JU-1", type: "JudgmentUnit", properties: { title: "价格是否改善" } },
      { id: "SCOPE-1", type: "ResearchScope", properties: { label: "存储市场" } },
      { id: "formal_price", type: "StateVariable", properties: { name: "产品价格" } },
      { id: "ER-1", type: "EvidenceRequirement", properties: { requirement: "价格序列" } },
      { id: "J-1", type: "Judgment", properties: { conclusion: "证据不足", strength: "J0", decision_status: "indeterminate", not_judgeable_reason: "缺少价格序列" } },
      { id: "H-1", type: "Hypothesis", properties: { statement: "价格改善" } },
      { id: "RULE-1", type: "RuleEvaluation", properties: { statement: "证据上限" } },
      { id: "MA-1", type: "MethodApplication", properties: { name: "状态判断" } },
      { id: "RT-1", type: "ReasoningTrace", properties: {} },
    ],
    relations: [
      { id: "r1", type: "judgmentResolvesUnit", sourceId: "J-1", targetId: "JU-1" },
      { id: "r2", type: "unitUsesScope", sourceId: "JU-1", targetId: "SCOPE-1" },
      { id: "r3", type: "unitEvaluatesStateVariable", sourceId: "JU-1", targetId: "formal_price" },
      { id: "r4", type: "requirementForJudgmentUnit", sourceId: "ER-1", targetId: "JU-1" },
      { id: "r5", type: "judgmentBasedOnHypothesis", sourceId: "J-1", targetId: "H-1" },
      { id: "r6", type: "judgmentHasRuleEvaluation", sourceId: "J-1", targetId: "RULE-1" },
      { id: "r7", type: "runtimeJudgmentUsesMethodApplication", sourceId: "J-1", targetId: "MA-1" },
      { id: "r8", type: "reasoningTraceForJudgment", sourceId: "RT-1", targetId: "J-1" },
    ],
  };
}

describe("ontology structure review", () => {
  it("keeps task-local candidates non-blocking and treats missing counterpoints as attention", () => {
    const review = buildOntologyStructureReview({ structure: structure(), formalStateVariables: formal });
    expect(review.preflight.status).toBe("attention");
    expect(review.preflight.task_local_candidates).toHaveLength(1);
    expect(review.preflight.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "unit_counter_missing", severity: "attention" }),
    ]));
  });

  it("blocks invalid formal bindings and missing evidence requirements", () => {
    const review = buildOntologyStructureReview({
      structure: structure({
        variables: [{ id: "VAR-1", name: "错误口径", ontology_node_id: "not_registered" }],
        judgment_units: [{ id: "JU-1", title: "价格是否改善", scope_ref: "SCOPE-1", ontology_node_ids: ["not_registered"] }],
        evidence_requirements: [],
      }),
      formalStateVariables: formal,
    });
    expect(review.preflight.status).toBe("blocked");
    expect(review.preflight.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "invalid_variable_binding", "unit_variable_unresolved", "unit_requirement_missing",
    ]));
  });

  it("does not mark a preflight-only run as a failed downstream adoption", () => {
    const review = buildOntologyStructureReview({ structure: structure(), formalStateVariables: formal });
    expect(review.adoption.status).toBe("not_ready");
  });

  it("treats a documented J0 stop as limited and observes a downstream formal binding", () => {
    const review = buildOntologyStructureReview({ structure: structure(), graph: graph(), formalStateVariables: formal });
    expect(review.adoption.status).toBe("limited");
    expect(review.adoption.judgment_chain).toEqual({ complete: 0, limited: 1, broken: 0 });
    expect(review.preflight.formal_bindings[0].used_downstream).toBe(true);
    expect(review.observed_contribution_count).toBeGreaterThan(0);
  });

  it("counts only blocking rule outcomes as observed interventions", () => {
    const review = buildOntologyStructureReview({
      structure: structure(),
      judgment: { rule_evaluations: [
        { id: "RE-PASS", rule_ref: "rule_pass", result: "pass" },
        { id: "RE-BLOCK", rule_ref: "rule_block", result: "blocked" },
      ] },
      formalStateVariables: formal,
    });
    const pass = review.interventions.find((item) => item.id === "constraint:rule:RE-PASS");
    const block = review.interventions.find((item) => item.id === "constraint:rule:RE-BLOCK");
    expect(pass).toMatchObject({ status: "checked", observed_contribution: false });
    expect(block).toMatchObject({ status: "applied", observed_contribution: true });
  });

  it("routes each repair action back to its owning stage", () => {
    expect(structureReviewActionHref("run-1", { repair_stage: "evidence", target_id: "ER-1" }))
      .toBe("/runs/run-1/evidence?focus=ER-1&from=structure-review");
  });

  it("routes repeated task-local candidates to knowledge governance", () => {
    const review = buildOntologyStructureReview({
      runId: "run-current",
      structure: structure(),
      formalStateVariables: formal,
      variableUsages: [{
        source: "task_local",
        run_count: 2,
        occurrences: [
          { run_id: "run-current", variable_id: "VAR-2", name: "本轮渠道口径" },
          { run_id: "run-old", variable_id: "OTHER", name: "本轮渠道口径" },
        ],
      }],
    });
    const action = review.recommended_actions.find((item) => item.code === "repeated_task_local_candidate");
    expect(action).toMatchObject({ repair_stage: "ontology", priority: "medium" });
    expect(structureReviewActionHref("run-current", action!)).toContain("/ontology?tab=governance");
  });
});
