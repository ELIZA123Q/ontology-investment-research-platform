import { describe, expect, it } from "vitest";
import { buildBusinessEntityGraph, buildLayeredEntityNetwork, buildReasoningPathGraph } from "@/app/lib/entity-relation-graph";
import { ensureStage02BusinessInstances } from "@/agents/02_structure/input_contract";

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

describe("reasoning path graph distinguishes root vs sub questions", () => {
  const multi: any = {
    authority: "formal",
    source: "test",
    provisional: false,
    graph: {
      schema_name: "ontology_business_instance_graph",
      schema_version: "1.0.0",
      authority: "test",
      objects: [
        { id: "Q-root", type: "ResearchQuestion", properties: { question: "本研究主问题" } },
        { id: "Q-01", type: "ResearchQuestion", properties: { question: "子问题一" } },
        { id: "Q-02", type: "ResearchQuestion", properties: { question: "子问题二" } },
        { id: "JU-1", type: "JudgmentUnit", properties: { statement: "判断单元" } },
      ],
      relations: [
        { id: "r1", type: "questionDecomposesIntoUnit", sourceId: "Q-root", targetId: "JU-1" },
      ],
    },
  };

  it("labels the root question and synthesizes sub-question decomposition edges", () => {
    const graph = buildReasoningPathGraph(multi);
    const root = graph.nodes.find((n) => n.id === "Q-root");
    const sub = graph.nodes.find((n) => n.id === "Q-01");
    expect(root?.meta).toContain("主问题");
    expect((root?.details as any).角色).toContain("主问题");
    expect(sub?.meta).toContain("子问题");
    expect((sub?.details as any).角色).toContain("子问题");

    const synth = graph.edges.filter((e) => e.id.startsWith("SYNTH-ROOT-SUB-"));
    expect(synth).toHaveLength(2);
    expect(synth.every((e) => e.source === "Q-root" && e.dashed)).toBe(true);
  });
});

describe("stage02 business instance enforcement", () => {
  it("extracts the listed company and its product line from the research question", () => {
    const data: any = { research_scope: { id: "RS-1", label: "某研究范围" } };
    const out = ensureStage02BusinessInstances(data, {
      question: "美国收紧出口管制后，中微公司（688012.SH）在刻蚀设备环节的国产替代进度如何？",
    });
    const instances = out.ontology_instances as any[];
    expect(instances.find((i) => i.type === "Company")?.name).toBe("中微公司（688012.SH）");
    expect(instances.find((i) => i.type === "Product")?.name).toBe("刻蚀设备");
    expect((out.research_scope as any).core_objects).toHaveLength(2);
  });

  it("does not invent entities for broad-theme questions without a listed company", () => {
    const data: any = { research_scope: { id: "RS-2", label: "宏观研究" } };
    const out = ensureStage02BusinessInstances(data, {
      question: "未来六个月DRAM与NAND价格和库存周期是否改善？",
    });
    expect((out.ontology_instances as any[]).length).toBe(0);
  });

  it("is idempotent and preserves existing instances", () => {
    const data: any = {
      research_scope: { id: "RS-3", label: "研究" },
      ontology_instances: [{ id: "company-688012", type: "Company", name: "中微公司（688012.SH）" }],
    };
    const out = ensureStage02BusinessInstances(data, {
      question: "中微公司（688012.SH）在刻蚀设备环节进展如何？",
    });
    const companies = (out.ontology_instances as any[]).filter((i) => i.type === "Company");
    expect(companies).toHaveLength(1);
  });
});
