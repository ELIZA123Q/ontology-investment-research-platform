import { describe, expect, it } from "vitest";
import {
  addTaskLocalCandidatesToOntologyGraph,
  applyUsageHeatToOntologyGraph,
  buildCandidateGapGraph,
  buildOntologyNetworkGraph,
  selectRelevantOntologyNodes,
} from "../app/lib/ontology-network-graph";

describe("ontology-network-graph", () => {
  it("关系类型直接生成对象类型之间的 Link，不再生成关系节点", () => {
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
    expect(graph.nodes.map((node) => node.id)).toEqual(["Product", "ValueChainSegment"]);
    expect(graph.edges).toEqual([expect.objectContaining({ source: "Product", target: "ValueChainSegment", label: "产品归属环节" })]);
  });

  it("正反向定义在展示层合并，同时保留双方定义", () => {
    const base = (id: string, name: string) => ({ id, name, category: "Object", description: "", properties: [], source_file: "x", source_types: [], target_types: [] });
    const graph = buildOntologyNetworkGraph([
      base("Company", "公司"), base("Product", "产品"),
      { id: "produces", name: "生产", category: "Relation", description: "公司生产产品", properties: [], source_file: "x", source_types: ["Company"], target_types: ["Product"], inverse_of: "producedBy" },
      { id: "producedBy", name: "由公司生产", category: "Relation", description: "产品由公司生产", properties: [], source_file: "x", source_types: ["Product"], target_types: ["Company"], inverse_of: "produces" },
    ]);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].details).toMatchObject({ 关系ID: expect.any(String), 反向关系ID: expect.any(String) });
    expect(new Set([graph.edges[0].details?.关系ID, graph.edges[0].details?.反向关系ID])).toEqual(new Set(["produces", "producedBy"]));
  });

  it("规则和情景成为语义控制，不生成孤立节点", () => {
    const graph = buildOntologyNetworkGraph([
      { id: "Judgment", name: "判断", category: "Object", description: "", properties: [], source_file: "x", source_types: [], target_types: [], model: "judgment" },
      { id: "judgment_rule", name: "判断约束", category: "Rule", description: "约束判断", properties: [], source_file: "x", source_types: [], target_types: [], applies_to: ["Judgment"] },
      { id: "CompanyResearch", name: "公司研究", category: "Scenario", description: "研究公司", properties: [], source_file: "x", source_types: [], target_types: [], required_judgment_types: ["Judgment"], entry_conditions: ["scope_frozen"], completion_conditions: ["resolved"] },
    ]);
    expect(graph.nodes.map((node) => node.id)).toEqual(["Judgment"]);
    expect(graph.rules[0]).toMatchObject({ id: "judgment_rule", targetNodeIds: ["Judgment"] });
    expect(graph.presets[0]).toMatchObject({ id: "CompanyResearch", nodeIds: ["Judgment"] });
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

  it("keeps task-local nodes visually separate and connected to their judgment unit", () => {
    const graph = addTaskLocalCandidatesToOntologyGraph({ nodes: [{ id: "Company", label: "公司", meta: "核心业务 · 对象类型", tone: "neutral", x: 0, y: 0, details: {} }], edges: [] }, [{
      id: "VAR-1",
      ontology_node_id: "task_local:VAR-1",
      name: "局部变量",
      definition: "任务内定义",
      category: "cost",
      variable_kind: "observed",
      anchors: ["Company"],
      judgment_unit_ids: ["JU-1"],
      source_status: "needs_review",
    }]);
    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "task_local:VAR-1", tone: "weaken", meta: "非正式候选 · 任务专用概念" }),
    ]));
    expect(graph.edges[0]).toMatchObject({ source: "Company", target: "task_local:VAR-1", label: "任务内扩展", dashed: true, authority: "task_local" });
  });

  it("projects usage heat and high-confidence gap links without mixing layers", () => {
    const heated = applyUsageHeatToOntologyGraph({
      nodes: [{ id: "Company", label: "公司", meta: "Object", tone: "neutral", x: 0, y: 0, details: {} }],
      edges: [],
    }, new Map([["Company", { run_count: 3, occurrence_count: 7 }]]));
    expect(heated.nodes[0]).toMatchObject({ tone: "support", meta: "Object · 3 个研究 / 7 次" });
    const gaps = buildCandidateGapGraph([
      { candidate_key: "a", name: "折旧强度", category: "cost", variable_kind: "observed", run_count: 2, occurrence_count: 3, definitions: ["定义"], anchors: ["Company"], similarities: [{ candidate_key: "b", name: "折旧费用强度", score: .9, confidence: "high" }] },
      { candidate_key: "b", name: "折旧费用强度", category: "cost", variable_kind: "observed", run_count: 1, occurrence_count: 1, definitions: ["定义"], anchors: ["Company"] },
    ]);
    expect(gaps.edges).toHaveLength(1);
    expect(gaps.edges[0].label).toContain("高置信近义");
  });
});
