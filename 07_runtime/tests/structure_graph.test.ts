import { describe, expect, it } from "vitest";
import {
  buildStructureReviewGraph,
  summarizeMethodApplications,
  summarizeResearchScope,
  variableIdsForUnit,
} from "../app/lib/structure-graph";

describe("structure-graph", () => {
  it("无变量/路径时仍可读：问题→JU→证据/反证/竞争解释", () => {
    const graph = buildStructureReviewGraph({
      question: "库存是否去化？",
      judgment_units: [{
        id: "JU-1",
        title: "库存观察",
        question: "库存是否下降",
        judgment_type: "state_measurement",
        scope_ref: "SCOPE-1",
        ontology_node_ids: [],
        evidence_requirements: ["两项独立库存序列"],
      }],
      competing_explanations: [{ explanation_id: "CE-01", statement: "季节性", judgment_unit_ids: ["JU-1"] }],
      counter_evidence_directions: [{ direction_id: "CD-01", statement: "库存回升", judgment_unit_ids: ["JU-1"] }],
    });
    expect(graph.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(["research-question", "JU-1", "JU-1-ER-1", "CD-01", "CE-01"]),
    );
    expect(graph.nodes.some((node) => node.meta.startsWith("状态变量"))).toBe(false);
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "research-question", target: "JU-1" }),
      expect.objectContaining({ source: "JU-1", target: "CD-01", label: "反证" }),
      expect.objectContaining({ source: "JU-1", target: "CE-01", label: "竞争解释" }),
    ]));
  });

  it("变量经路径连到判断单元，并汇总范围与方法", () => {
    const graph = buildStructureReviewGraph({
      question: "价格能否继续上行？",
      questions: [{ id: "Q-1", statement: "价格能否继续上行？", failure_route: "downgrade" }],
      research_scope: {
        id: "SCOPE-MEM",
        label: "存储周期·全球",
        dimensions: { object: "DRAM", time: "2026H1" },
      },
      judgment_units: [{
        id: "JU-1",
        title: "价格压力",
        question: "合同价是否继续上行",
        judgment_type: "trend_direction",
        scope_ref: "SCOPE-MEM",
        ontology_node_ids: ["product_price_pressure"],
        evidence_requirements: ["合同价序列"],
      }],
      evidence_requirements: [{
        id: "ER-1",
        requirement: "合同价序列",
        evidence_role: "support",
        minimum_independent_sources: 2,
        judgment_unit_ids: ["JU-1"],
      }],
      variables: [{
        id: "SV-PRICE",
        name: "产品价格压力",
        category: "pricing",
        definition: "可比口径合同价方向",
        variable_kind: "observed",
        anchors: ["contract_price"],
        ontology_node_id: "product_price_pressure",
        role: "primary",
      }, {
        id: "SV-INV",
        name: "库存位置",
        category: "inventory",
        definition: "原厂库存天数",
        variable_kind: "observed",
        anchors: ["inventory_days"],
        ontology_node_id: "inventory_cycle_position",
        role: "support",
      }],
      paths: [{
        id: "PATH-1",
        statement: "库存偏紧 → 价格上行",
        variable_ids: ["SV-PRICE", "SV-INV"],
        judgment_unit_ids: ["JU-1"],
      }],
      method_applications: [
        { application_id: "MA-S1", method_id: "kb02:A01", capability_type: "judgment_structure", target_judgment_unit_refs: ["JU-1"] },
        { application_id: "MA-E1", method_id: "kb03:A01", capability_type: "evidence", target_judgment_unit_refs: ["JU-1"] },
        { application_id: "MA-J1", method_id: "kb04:A01", capability_type: "adjudication", target_judgment_unit_refs: ["JU-1"] },
      ],
      counter_evidence_directions: [],
      competing_explanations: [],
    });

    expect(graph.scopeSummary).toMatchObject({ id: "SCOPE-MEM", label: "存储周期·全球" });
    expect(graph.scopeSummary?.dimensions).toEqual([
      { key: "object", value: "DRAM" },
      { key: "time", value: "2026H1" },
    ]);
    expect(graph.methodSummary.map((group) => group.capability)).toEqual([
      "judgment_structure",
      "evidence",
      "adjudication",
    ]);
    expect(graph.nodes.some((node) => node.id === "SV-PRICE")).toBe(true);
    expect(graph.nodes.some((node) => node.id === "PATH-1")).toBe(true);
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "SV-PRICE", target: "PATH-1" }),
      expect.objectContaining({ source: "PATH-1", target: "JU-1", label: "路径" }),
      expect.objectContaining({ source: "method-MA-S1", target: "JU-1", label: "方法应用" }),
    ]));
    const questionNode = graph.nodes.find((node) => node.id === "research-question");
    expect(questionNode?.details.失败路由).toBe("降级");
    expect(questionNode?.details["范围·对象"]).toBe("DRAM");
    const unitNode = graph.nodes.find((node) => node.id === "JU-1");
    expect(unitNode?.details.判断类型).toBe("趋势方向");
    expect(unitNode?.meta).toContain("趋势方向");
    expect(unitNode?.details.关键概念).toEqual(["产品价格压力 · 正式本体"]);
    expect(unitNode?.details.本体状态变量).toBeUndefined();
    const pathNode = graph.nodes.find((node) => node.id === "PATH-1");
    expect(pathNode?.details.涉及变量).toEqual(["产品价格压力", "库存位置"]);
    const erNode = graph.nodes.find((node) => node.id === "JU-1-ER-1");
    expect(erNode?.details).toMatchObject({
      证据角色: "支持",
      最低独立来源: 2,
    });
    // 已与路径重叠时，不再额外直连变量→JU
    expect(graph.edges.some((edge) => edge.source === "SV-PRICE" && edge.target === "JU-1")).toBe(false);
  });

  it("variableIdsForUnit 同时识别变量 id 与 ontology_node_id", () => {
    const matched = variableIdsForUnit(
      {
        id: "JU-1",
        title: "t",
        question: "q",
        judgment_type: "state_measurement",
        scope_ref: "SCOPE",
        ontology_node_ids: ["SV-1", "inventory_cycle_position"],
        linked_paths: [],
        evidence_requirements: [],
      },
      [
        { id: "SV-1", name: "a", category: "", definition: "", variable_kind: "", anchors: [], ontology_node_id: "x", role: "" },
        { id: "SV-2", name: "b", category: "", definition: "", variable_kind: "", anchors: [], ontology_node_id: "inventory_cycle_position", role: "" },
        { id: "SV-3", name: "c", category: "", definition: "", variable_kind: "", anchors: [], ontology_node_id: "other", role: "" },
      ],
    );
    expect(matched).toEqual(["SV-1", "SV-2"]);
  });

  it("摘要函数对空输入安全降级", () => {
    expect(summarizeResearchScope(null)).toBeNull();
    expect(summarizeMethodApplications(undefined)).toEqual([]);
  });

  it("旧产物无路径归属时显式标记待归属，不留下孤立子图", () => {
    const graph = buildStructureReviewGraph({
      question: "价格如何传导？",
      judgment_units: [{
        id: "JU-1",
        title: "价格判断",
        question: "价格是否上行",
        judgment_type: "transmission_path",
        scope_ref: "SCOPE-1",
        ontology_node_ids: ["product:DRAM"],
        evidence_requirements: [],
      }],
      variables: [{
        id: "SV-1",
        name: "需求",
        category: "demand",
        definition: "需求状态",
        variable_kind: "observed",
        anchors: ["shipment"],
        ontology_node_id: "end_market_demand_strength",
        role: "input",
      }],
      paths: [{ id: "P-1", statement: "需求→价格", variable_ids: ["SV-1"] }],
    });
    expect(graph.edges).toContainEqual(expect.objectContaining({
      source: "research-question",
      target: "P-1",
      label: "路径待归属",
    }));
    expect(graph.nodes.find((node) => node.id === "P-1")?.details.对应判断).toBe("待归属");
  });

  it("范围摘要把数组和复数技术字段转成研究员可读信息", () => {
    expect(summarizeResearchScope({
      id: "SCOPE-1",
      label: "存储研究",
      dimensions: {
        objects: ["DRAM", "NAND"],
        indicators: ["合约价", "库存"],
      },
    })?.dimensions).toEqual([
      { key: "objects", value: "DRAM、NAND" },
      { key: "indicators", value: "合约价、库存" },
    ]);
  });

  it("正式本体状态变量 id 解析为领域中文名，task_local 走本轮变量名", () => {
    const graph = buildStructureReviewGraph({
      question: "折旧影响？",
      judgment_units: [{
        id: "JU-1",
        title: "折旧",
        question: "折旧是否抬升",
        judgment_type: "state_measurement",
        scope_ref: "SCOPE-1",
        ontology_node_ids: ["product_price_pressure", "task_local:VAR-MEM-DEPR", "input_cost_pressure"],
        evidence_requirements: [],
      }],
      variables: [{
        id: "VAR-MEM-DEPR",
        name: "存储芯片折旧强度",
        category: "cost",
        definition: "折旧强度",
        variable_kind: "observed",
        anchors: ["depreciation"],
        ontology_node_id: "task_local:VAR-MEM-DEPR",
        role: "primary",
      }],
    });
    const unitNode = graph.nodes.find((node) => node.id === "JU-1");
    expect(unitNode?.details.关键概念).toEqual([
      "产品价格压力 · 正式本体",
      "存储芯片折旧强度 · 本轮新建（待入库）",
      "投入成本压力 · 正式本体",
    ]);
  });
});
