import { describe, expect, it } from "vitest";
import { AGENTS, SKILLS } from "@/src/capabilities/registry";
import { RESEARCH_NODE_CATALOG } from "@/src/runtime/node-catalog";
import { materializeNodes, planResearch } from "@/src/runtime/planner";

describe("constrained dynamic planning", () => {
  it("keeps vNext.1 to five procedural skills and one active agent", () => {
    expect(SKILLS.map((skill) => skill.id)).toEqual(["research-framing", "research-method", "evidence-assessment", "hypothesis-analysis", "research-writing"]);
    expect(AGENTS.filter((agent) => agent.lifecycle === "active").map((agent) => agent.id)).toEqual(["research-lead"]);
  });

  it("chooses materially different graphs instead of a hidden 01-05 pipeline", () => {
    const evidence = planResearch("只补充现有判断的一手来源，并核验引用");
    const update = planResearch("新材料出现，请更新判断并只重跑受影响部分");
    const report = planResearch("只写报告并复用已有正式判断");
    expect(evidence.intent).toBe("evidence_only");
    expect(evidence.nodes.map((node) => node.kind)).toEqual(["semantic_context", "evidence_discovery", "evidence_capture", "evidence_evaluation"]);
    expect(update.nodes.some((node) => node.kind === "impact_analysis")).toBe(true);
    expect(report.nodes.map((node) => node.kind)).toEqual(["compose", "audit"]);
  });

  it("only materializes typed catalog nodes with deterministic invariants", () => {
    const plan = planResearch("分析先进封装需求的产业链传导和竞争解释，时间范围未来六个月");
    const nodes = materializeNodes("task", plan, { maxModelCalls: 12, maxToolCalls: 24, maxCostUsd: 3 });
    const allowed = new Set(RESEARCH_NODE_CATALOG.map((type) => type.kind));
    expect(nodes.every((node) => allowed.has(node.kind))).toBe(true);
    expect(nodes.every((node) => node.assignedAgent === "research-lead")).toBe(true);
    expect(nodes.some((node) => node.capabilityId === "hypothesis-analysis")).toBe(true);
    expect(plan.parallelGroups).toEqual([["context", "method"]]);
  });
});
