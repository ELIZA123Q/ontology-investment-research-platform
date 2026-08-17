import { describe, expect, it } from "vitest";
import { AGENTS, SKILLS } from "@/src/capabilities/registry";
import { RESEARCH_NODE_CATALOG } from "@/src/runtime/node-catalog";
import { EARNINGS_UPDATE_INITIAL_NODE_LIMIT, materializeNodes, planFromProblemGraph, planResearch } from "@/src/runtime/planner";
import { compilePlannerProposal, parsePlannerProposal, type PlannerProposal } from "@/src/runtime/plan-compiler";
import { buildResearchProblemGraph } from "@/src/runtime/problem-graph";

const budget = { maxModelCalls: 12, maxToolCalls: 24, maxCostUsd: 3 };

describe("constrained dynamic planning", () => {
  it("keeps the five discipline skills, adds the professional workflow layer, and retains one active agent", () => {
    expect(SKILLS.map((skill) => skill.id)).toEqual(["research-framing", "research-design", "evidence-research", "judgment-reasoning", "research-delivery", "company-fundamental-research", "sector-cycle-research", "financial-modeling", "valuation-analysis", "earnings-update", "thesis-monitoring", "independent-research-review"]);
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
    expect(nodes.some((node) => node.capabilityType === "function" && node.capabilityId === "GenerateHypothesisCandidates")).toBe(true);
    expect(plan.parallelGroups).toEqual([["context", "method"]]);
  });

  it("repairs a proposal without allowing it to bypass source capture", () => {
    const proposal: PlannerProposal = {
      intent: "full_research",
      rationale: "直接形成判断",
      nodes: [
        { key: "unsafe", kind: "arbitrary_shell", title: "执行任意代码", dependsOn: [], budget: { maxToolCalls: 999 } },
        { key: "judge", kind: "judgment", title: "直接判断", dependsOn: [] },
      ],
      stopConditions: ["预算耗尽"],
    };
    const compiled = compilePlannerProposal(proposal, "研究 HBM 供需并形成报告", budget);
    expect(compiled.source).toBe("repaired_proposal");
    expect(compiled.plan.nodes.some((node) => node.kind === "arbitrary_shell")).toBe(false);
    expect(compiled.plan.nodes.map((node) => node.kind)).toEqual(expect.arrayContaining(["evidence_discovery", "evidence_capture", "evidence_evaluation", "judgment", "compose", "audit"]));
    const capture = compiled.plan.nodes.find((node) => node.kind === "evidence_capture")!;
    const discovery = compiled.plan.nodes.find((node) => node.kind === "evidence_discovery")!;
    expect(capture.dependsOn).toContain(discovery.key);
    const sums = compiled.plan.nodes.reduce((total, node) => ({ model: total.model + (node.budget?.maxModelCalls || 0), tool: total.tool + (node.budget?.maxToolCalls || 0), cost: total.cost + (node.budget?.maxCostUsd || 0) }), { model: 0, tool: 0, cost: 0 });
    expect(sums.model).toBeLessThanOrEqual(budget.maxModelCalls);
    expect(sums.tool).toBeLessThanOrEqual(budget.maxToolCalls);
    expect(sums.cost).toBeLessThanOrEqual(budget.maxCostUsd);
  });

  it("falls back when one deterministic repair cannot remove a cycle", () => {
    const proposal: PlannerProposal = {
      intent: "full_research",
      rationale: "循环计划",
      nodes: [
        { key: "context", kind: "semantic_context", title: "上下文", dependsOn: ["method"] },
        { key: "method", kind: "method_selection", title: "方法", dependsOn: ["context"] },
      ],
      stopConditions: [],
    };
    const compiled = compilePlannerProposal(proposal, "研究 HBM 供需并形成报告", budget);
    expect(compiled.source).toBe("deterministic_fallback");
    expect(compiled.diagnostics.some((item) => item.code === "cycle" && !item.repaired)).toBe(true);
    expect(compiled.plan.nodes.find((node) => node.kind === "semantic_context")?.dependsOn).toEqual([]);
  });

  it("parses a fenced JSON proposal but rejects non-JSON model output", () => {
    expect(parsePlannerProposal('```json\n{"intent":"clarify","rationale":"x","nodes":[],"stopConditions":[]}\n```')?.intent).toBe("clarify");
    expect(parsePlannerProposal("I think the plan should be flexible.")).toBeNull();
  });

  it("compiles earnings update into a bounded contract-specific graph with a conserved budget", () => {
    const graph = buildResearchProblemGraph({
      taskId: "earnings-task", researchCaseId: "earnings-case", intent: "full_research", reportDepth: "standard",
      goal: "截至 2026-08-14 对东微半导 688261 开展业绩更新与投资命题复核",
      lensRefs: ["fundamental", "risk_first"],
    }) as Parameters<typeof planFromProblemGraph>[0];
    const production = planFromProblemGraph(graph, budget, "production");
    const evaluation = planFromProblemGraph(graph, budget, "evaluation");
    expect(production.nodes.length).toBeLessThanOrEqual(EARNINGS_UPDATE_INITIAL_NODE_LIMIT);
    expect(evaluation.nodes.length).toBeLessThanOrEqual(EARNINGS_UPDATE_INITIAL_NODE_LIMIT);
    expect(production.nodes.filter((node) => node.kind === "judgment")).toHaveLength(3);
    expect(production.nodes.some((node) => node.kind === "valuation_analysis")).toBe(false);
    expect(production.nodes.some((node) => node.kind === "independent_review")).toBe(false);
    expect(evaluation.nodes.some((node) => node.kind === "independent_review")).toBe(true);
    const materialized = materializeNodes("earnings-task", production, budget);
    expect(materialized.reduce((sum, node) => sum + Number(node.budget.maxModelCalls || 0), 0)).toBeLessThanOrEqual(budget.maxModelCalls);
    expect(materialized.reduce((sum, node) => sum + Number(node.budget.maxToolCalls || 0), 0)).toBeLessThanOrEqual(budget.maxToolCalls);
    expect(materialized.reduce((sum, node) => sum + Number(node.budget.maxCostUsd || 0), 0)).toBeLessThanOrEqual(budget.maxCostUsd + 1e-9);
  });
});
