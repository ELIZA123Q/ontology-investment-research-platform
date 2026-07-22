import { describe, expect, it } from "vitest";
import { buildOntologyNetworkGraph, selectRelevantOntologyNodes } from "../app/lib/ontology-network-graph";

describe("ontology-network-graph", () => {
  it("关系类型节点连接源与目标类型", () => {
    const graph = buildOntologyNetworkGraph([
      {
        id: "Product",
        name: "产品",
        category: "Object",
        description: "",
        properties: [],
        source_file: "x",
        source_types: [],
        target_types: [],
      },
      {
        id: "ValueChainSegment",
        name: "产业链环节",
        category: "Object",
        description: "",
        properties: [],
        source_file: "x",
        source_types: [],
        target_types: [],
      },
      {
        id: "productBelongsToSegment",
        name: "产品归属环节",
        category: "Relation",
        description: "",
        properties: [],
        source_file: "x",
        source_types: ["Product"],
        target_types: ["ValueChainSegment"],
      },
    ]);
    expect(graph.nodes.length).toBe(3);
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "Product", target: "productBelongsToSegment", label: "源类型" }),
      expect.objectContaining({ source: "productBelongsToSegment", target: "ValueChainSegment", label: "目标类型" }),
    ]));
  });

  it("任务视图只保留触及节点及其一跳关系端点", () => {
    const nodes = [
      {
        id: "Product", name: "产品", category: "Object", description: "", properties: [], source_file: "x", source_types: [], target_types: [],
      },
      {
        id: "Industry", name: "行业", category: "Object", description: "", properties: [], source_file: "x", source_types: [], target_types: [],
      },
      {
        id: "Company", name: "公司", category: "Object", description: "", properties: [], source_file: "x", source_types: [], target_types: [],
      },
      {
        id: "productBelongsToIndustry", name: "产品属于行业", category: "Relation", description: "", properties: [], source_file: "x", source_types: ["Product"], target_types: ["Industry"],
      },
    ];
    const relevant = selectRelevantOntologyNodes(nodes, ["productBelongsToIndustry"]);
    expect(relevant.map((node) => node.id)).toEqual(["Product", "Industry", "productBelongsToIndustry"]);
    expect(relevant.some((node) => node.id === "Company")).toBe(false);
    expect(selectRelevantOntologyNodes(nodes, ["Product"]).map((node) => node.id)).toEqual(["Product"]);
  });
});
