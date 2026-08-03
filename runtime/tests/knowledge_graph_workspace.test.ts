import { describe, expect, it } from "vitest";
import { collectRelatedNetwork, knowledgeGraphGroupId, mergeSessionNodePositions } from "@/app/components/knowledge-graph-workspace";

const node = (id: string, meta: string, type = "") => ({
  id,
  label: id,
  meta,
  tone: "neutral" as const,
  x: 0,
  y: 0,
  details: type ? { 类型: type } : {},
});

describe("knowledge graph exploration", () => {
  it("classifies task and ontology nodes in researcher-facing groups", () => {
    expect(knowledgeGraphGroupId({ ...node("company", "公司"), details: { 技术类型: "Company" } }, "entity")).toBe("company");
    expect(knowledgeGraphGroupId(node("unit", "判断单元", "JudgmentUnit"), "reasoning")).toBe("unit");
    expect(knowledgeGraphGroupId(node("judgment", "判断", "Judgment"), "reasoning")).toBe("judgment");
    expect(knowledgeGraphGroupId({ ...node("object", "核心业务 · 对象类型"), details: { 知识分组: "核心业务" } }, "ontology")).toBe("core");
    expect(knowledgeGraphGroupId({ ...node("local", "非正式候选"), details: { 建议: "建议进入本体治理" } }, "candidate")).toBe("recommend");
  });

  it("highlights direct, two-level and complete related networks deterministically", () => {
    const edges = [
      { id: "ab", source: "a", target: "b" },
      { id: "bc", source: "b", target: "c" },
      { id: "cd", source: "c", target: "d" },
      { id: "xy", source: "x", target: "y" },
    ];
    expect([...collectRelatedNetwork("a", edges, "1").nodeIds]).toEqual(["a", "b"]);
    expect([...collectRelatedNetwork("a", edges, "2").nodeIds]).toEqual(["a", "b", "c"]);
    const complete = collectRelatedNetwork("a", edges, "all");
    expect([...complete.nodeIds]).toEqual(["a", "b", "c", "d"]);
    expect([...complete.edgeIds]).toEqual(["ab", "bc", "cd"]);
  });

  it("keeps dragged positions independently for each graph during the session", () => {
    const first = mergeSessionNodePositions("entities", {}, [
      { id: "company-a", type: "position", position: { x: 180, y: 90 }, dragging: true },
    ]);
    const second = mergeSessionNodePositions("ontology", first, [
      { id: "Company", type: "position", position: { x: 640, y: 220 }, dragging: false },
    ]);
    expect(second.entities["company-a"]).toEqual({ x: 180, y: 90 });
    expect(second.ontology.Company).toEqual({ x: 640, y: 220 });
    expect(mergeSessionNodePositions("entities", second, [{ id: "company-a", type: "select", selected: true }])).toBe(second);
  });
});
