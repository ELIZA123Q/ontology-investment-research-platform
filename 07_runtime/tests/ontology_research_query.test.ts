import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { queryEvidenceImpact } from "@/skills/ontology/research_query";
import { traceReachableDownstream, type BusinessInstanceGraph } from "@/skills/ontology/instance_graph";

const graph: BusinessInstanceGraph = {
  schema_name: "ontology_business_instance_graph",
  schema_version: "1.0.0",
  authority: "business_parameters",
  objects: [
    { id: "EV-1", type: "EvidenceFact", properties: { statement: "库存连续下降" } },
    { id: "SIG-1", type: "Signal", properties: { statement: "去库信号" } },
    { id: "H-1", type: "Hypothesis", properties: { statement: "进入修复期" } },
    { id: "J-1", type: "Judgment", properties: { conclusion: "周期处于早期修复", strength: "J2", decision_status: "supported", judgment_unit_id: "JU-1" } },
    { id: "STABLE-1", type: "StateVariable", properties: { name: "稳定变量" } },
  ],
  relations: [
    { id: "R-1", type: "factSupportsSignal", sourceId: "EV-1", targetId: "SIG-1" },
    { id: "R-2", type: "signalEvaluatesHypothesis", sourceId: "SIG-1", targetId: "H-1" },
    { id: "R-3", type: "hypothesisSupportsJudgment", sourceId: "H-1", targetId: "J-1" },
  ],
};

describe("ontology research question queries", () => {
  it("returns the shortest formal downstream path from evidence to judgment", () => {
    const traces = traceReachableDownstream(graph, ["EV-1"]);
    expect(traces.find((trace) => trace.object_id === "J-1")?.path.map((step) => step.relation_type)).toEqual([
      "factSupportsSignal",
      "signalEvaluatesHypothesis",
      "hypothesisSupportsJudgment",
    ]);
    expect(traces.some((trace) => trace.object_id === "STABLE-1")).toBe(false);

    const result = queryEvidenceImpact(graph, "EV-1");
    expect(result.impacted_judgments).toEqual([expect.objectContaining({
      id: "J-1",
      label: "周期处于早期修复",
      strength: "J2",
      judgment_unit_id: "JU-1",
    })]);
    expect(result.impacted_object_count).toBe(3);
  });

  it("rejects a non-evidence query starting point", () => {
    expect(() => queryEvidenceImpact(graph, "STABLE-1")).toThrow(/查询起点必须/);
  });
});
