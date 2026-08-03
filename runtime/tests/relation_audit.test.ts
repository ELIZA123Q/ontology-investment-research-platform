import { describe, expect, it } from "vitest";
import { buildJudgmentRelationAudits, relationRepairHref } from "@/engine/relation_audit";
import type { BusinessInstanceGraph, GraphObject, GraphRelation } from "@/engine/instance_graph/types";

function graph(objects: GraphObject[], relations: GraphRelation[]): BusinessInstanceGraph {
  return { schema_name: "ontology_business_instance_graph", schema_version: "1.0.0", authority: "test", objects, relations };
}

const baseObjects: GraphObject[] = [
  { id: "JU-1", type: "JudgmentUnit", properties: { title: "周期判断" } },
  { id: "SCOPE-1", type: "ResearchScope", properties: { name: "全球存储" } },
  { id: "SV-1", type: "StateVariable", properties: { name: "库存状态" } },
  { id: "H-1", type: "Hypothesis", properties: { statement: "库存下降" } },
  { id: "RULE-1", type: "RuleEvaluation", properties: { statement: "证据上限" } },
  { id: "MA-1", type: "MethodApplication", properties: { name: "周期判断" } },
  { id: "RT-1", type: "ReasoningTrace", properties: {} },
];
const baseRelations: GraphRelation[] = [
  { id: "r1", type: "judgmentResolvesUnit", sourceId: "J-1", targetId: "JU-1" },
  { id: "r2", type: "unitUsesScope", sourceId: "JU-1", targetId: "SCOPE-1" },
  { id: "r2b", type: "unitEvaluatesStateVariable", sourceId: "JU-1", targetId: "SV-1" },
  { id: "r3", type: "judgmentBasedOnHypothesis", sourceId: "J-1", targetId: "H-1" },
  { id: "r4", type: "judgmentHasRuleEvaluation", sourceId: "J-1", targetId: "RULE-1" },
  { id: "r5", type: "runtimeJudgmentUsesMethodApplication", sourceId: "J-1", targetId: "MA-1" },
  { id: "r6", type: "reasoningTraceForJudgment", sourceId: "RT-1", targetId: "J-1" },
];

describe("judgment relation audit", () => {
  it("treats a documented J0 stop as limited instead of a broken evidence chain", () => {
    const result = buildJudgmentRelationAudits(graph([
      ...baseObjects,
      { id: "J-1", type: "Judgment", properties: { conclusion: "暂不可判断", level: "J0", not_judgeable_reason: "库存数据不足" } },
    ], baseRelations));
    expect(result[0].status).toBe("limited");
    expect(result[0].issues.some((issue) => issue.code === "missing_fact_path")).toBe(false);
  });

  it("marks a directional judgment without fact-signal provenance as broken", () => {
    const result = buildJudgmentRelationAudits(graph([
      ...baseObjects,
      { id: "J-1", type: "Judgment", properties: { conclusion: "周期改善", level: "J2" } },
    ], baseRelations));
    expect(result[0].status).toBe("broken");
    expect(result[0].issues.some((issue) => issue.code === "missing_fact_path")).toBe(true);
  });

  it("treats a missing state-variable binding as a structure relation error", () => {
    const result = buildJudgmentRelationAudits(graph([
      ...baseObjects.filter((item) => item.id !== "SV-1"),
      { id: "J-1", type: "Judgment", properties: { conclusion: "暂不可判断", level: "J0", not_judgeable_reason: "库存数据不足" } },
    ], baseRelations.filter((item) => item.id !== "r2b")));
    expect(result[0].status).toBe("broken");
    expect(result[0].issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing_state_variable", repairStage: "structure" }),
    ]));
  });

  it("maps repair issues back to the owning research stage", () => {
    const issue = { code: "missing_fact", severity: "error" as const, title: "缺事实", impact: "无法判断", targetId: "ER-1", repairStage: "evidence" as const };
    expect(relationRepairHref("run-1", issue)).toBe("/runs/run-1/evidence?focus=ER-1&from=audit");
  });
});
