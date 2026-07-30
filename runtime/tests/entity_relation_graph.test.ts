import { describe, expect, it } from "vitest";
import { buildEntityRelationGraph } from "../app/lib/entity-relation-graph";

describe("entity-relation-graph", () => {
  it("默认业务对象视图隐藏研究过程对象", () => {
    const result = buildEntityRelationGraph({
      graph: {
        schema_name: "ontology_business_instance_graph",
        schema_version: "1.0.0",
        authority: "business_parameters",
        objects: [
          { id: "P-1", type: "Product", properties: { name: "HBM" } },
          { id: "J-1", type: "Judgment", properties: { conclusion: "上行" } },
          { id: "MA-1", type: "MethodApplication", properties: {} },
          { id: "RS-1", type: "ResearchScope", properties: {} },
          { id: "RP-1", type: "ResearchPath", properties: {} },
        ],
        relations: [
          { id: "R-1", type: "productBelongsToSegment", sourceId: "P-1", targetId: "J-1" },
        ],
      },
      source: "artifact",
      authority: "formal",
      provisional: false,
    });
    expect(result.nodes.map((n) => n.id)).toEqual(["P-1"]);
    expect(result.edges.length).toBe(0);
  });

  it("决策主链只显示有正式关系的本轮实例，并报告缺失变量绑定", () => {
    const result = buildEntityRelationGraph({
      graph: {
        schema_name: "ontology_business_instance_graph",
        schema_version: "1.0.0",
        authority: "business_parameters",
        objects: [
          { id: "Q-1", type: "ResearchQuestion", properties: { question: "需求是否改善" } },
          { id: "JU-1", type: "JudgmentUnit", properties: { title: "需求判断" } },
          { id: "SV-1", type: "StateVariable", properties: { name: "需求强度" } },
          { id: "P-1", type: "Product", properties: { name: "HBM" } },
        ],
        relations: [
          { id: "R-1", type: "questionDecomposesIntoUnit", sourceId: "Q-1", targetId: "JU-1" },
        ],
      },
      source: "artifact",
      authority: "formal",
      provisional: false,
    }, { scope: "decision" });
    expect(result.nodes.map((node) => node.id)).toEqual(["Q-1", "JU-1"]);
    expect(result.edges).toEqual([
      expect.objectContaining({ source: "Q-1", target: "JU-1", label: "拆分为判断单元" }),
    ]);
    expect(result.stats).toEqual(expect.objectContaining({
      totalObjects: 4,
      totalRelations: 1,
      visibleObjects: 2,
      visibleRelations: 1,
      judgmentUnitsWithoutVariableBindings: 1,
      unboundStateVariables: 1,
    }));
  });

  it("可选择展示研究过程对象", () => {
    const result = buildEntityRelationGraph({
      graph: {
        schema_name: "ontology_business_instance_graph",
        schema_version: "1.0.0",
        authority: "business_parameters",
        objects: [
          { id: "P-1", type: "Product", properties: { name: "HBM" } },
          { id: "J-1", type: "Judgment", properties: { conclusion: "上行" } },
        ],
        relations: [
          { id: "R-1", type: "supports", sourceId: "P-1", targetId: "J-1" },
        ],
      },
      source: "artifact",
      authority: "formal",
      provisional: false,
    }, { includeProcessObjects: true });
    expect(result.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(["P-1", "J-1"]));
    expect(result.edges.length).toBe(1);
  });
});
