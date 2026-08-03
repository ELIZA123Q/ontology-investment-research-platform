import { describe, expect, it } from "vitest";
import { buildBusinessEntityGraph, buildLayeredEntityNetwork, buildReasoningPathGraph } from "@/app/lib/entity-relation-graph";

const loaded: any = {
  authority: "formal",
  source: "test",
  provisional: false,
  graph: {
    schema_name: "ontology_business_instance_graph",
    schema_version: "1.0.0",
    authority: "test",
    objects: [
      { id: "C-1", type: "Company", properties: { name: "示例公司" } },
      { id: "P-1", type: "Product", properties: { name: "存储产品" } },
      { id: "EV-1", type: "EvidenceFact", properties: { statement: "收入增长" } },
      { id: "Q-1", type: "ResearchQuestion", properties: { question: "景气是否改善" } },
      { id: "JU-1", type: "JudgmentUnit", properties: { statement: "验证景气" } },
      { id: "S-1", type: "Signal", properties: { statement: "收入信号", role: "support" } },
      { id: "H-1", type: "Hypothesis", properties: { statement: "需求回升" } },
      { id: "J-1", type: "Judgment", properties: { conclusion: "景气改善" } },
      { id: "RE-1", type: "RuleEvaluation", properties: { rule_ref: "threshold", result: "pass" } },
      { id: "RT-1", type: "ReasoningTrace", properties: {} },
    ],
    relations: [
      { id: "r1", type: "produces", sourceId: "C-1", targetId: "P-1" },
      { id: "r2", type: "reasoningTraceForJudgment", sourceId: "RT-1", targetId: "J-1" },
      { id: "r3", type: "questionDecomposesIntoUnit", sourceId: "Q-1", targetId: "JU-1" },
      { id: "r4", type: "unitHasHypothesis", sourceId: "JU-1", targetId: "H-1" },
      { id: "r5", type: "signalEvaluatesHypothesis", sourceId: "S-1", targetId: "H-1", properties: { role: "support" } },
      { id: "r6", type: "judgmentBasedOnHypothesis", sourceId: "J-1", targetId: "H-1" },
      { id: "r7", type: "judgmentHasRuleEvaluation", sourceId: "J-1", targetId: "RE-1" },
      { id: "r8", type: "factSupportsSignal", sourceId: "EV-1", targetId: "S-1", properties: { role: "support" } },
    ],
  },
};

describe("layered entity network", () => {
  it("shows business objects by default and expands only selected layers", () => {
    const business = buildLayeredEntityNetwork(loaded);
    expect(business.nodes.map((node) => node.id)).toEqual(["C-1", "P-1"]);
    expect(business.edges).toHaveLength(1);

    const expanded = buildLayeredEntityNetwork(loaded, { layers: ["business", "evidence", "reasoning", "technical"] });
    expect(expanded.nodes).toHaveLength(10);
  });

  it("searches by researcher-facing object label and keeps its neighborhood", () => {
    const result = buildLayeredEntityNetwork(loaded, { query: "示例公司" });
    expect(result.nodes.map((node) => node.id)).toEqual(expect.arrayContaining(["C-1", "P-1"]));
  });

  it("separates business entities from reasoning and keeps relationships as edges", () => {
    const entities = buildBusinessEntityGraph(loaded);
    expect(entities.nodes.map((node) => node.id)).toEqual(["C-1", "P-1"]);
    expect(entities.edges).toEqual([expect.objectContaining({ source: "C-1", target: "P-1" })]);
    const reasoning = buildReasoningPathGraph(loaded);
    expect(reasoning.nodes.map((node) => node.id)).not.toContain("RE-1");
    expect(reasoning.nodes.find((node) => node.id === "J-1")?.details.规则评估).toEqual([expect.objectContaining({ 规则: "threshold", 结果: "pass" })]);
    expect(reasoning.edges.find((edge) => edge.id === "r6")).toMatchObject({ source: "H-1", target: "J-1", tone: "support" });
  });
});
