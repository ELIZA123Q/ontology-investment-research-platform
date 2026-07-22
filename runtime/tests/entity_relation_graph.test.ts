import { describe, expect, it } from "vitest";
import { buildEntityRelationGraph } from "../app/lib/entity-relation-graph";

describe("entity-relation-graph", () => {
  it("默认隐藏研究过程对象", () => {
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
