import { describe, expect, it } from "vitest";
import type { FinancialModelData } from "@/src/contracts";
import { AGENTS, SKILLS } from "@/src/capabilities/registry";
import { buildResearchProblemGraph } from "@/src/runtime/problem-graph";
import { planFromProblemGraph } from "@/src/runtime/planner";
import { consensusComparisonStatus, validateFinancialModel } from "@/src/research/financial-model-contract";

const model = (): FinancialModelData => ({
  asOf: "2026-08-11T00:00:00Z", entityRef: "case-1", accountingBasis: "PRC_GAAP", currency: "CNY", unit: "元",
  historicalBoundary: { start: "2025-01-01T00:00:00Z", end: "2026-06-30T00:00:00Z" },
  forecastBoundary: { start: "2026-07-01T00:00:00Z", end: "2027-12-31T00:00:00Z" },
  assumptions: [{ id: "revenue_anchor", value: 100, basis: "reported", sourceArtifactRef: "normalized-1" }],
  formulaDependencies: [{ output: "forecast_revenue", inputs: ["revenue_anchor"] }],
  scenarios: [{ id: "base", assumptionIds: ["revenue_anchor"] }, { id: "bull", assumptionIds: ["revenue_anchor"] }, { id: "bear", assumptionIds: ["revenue_anchor"] }],
  audit: { passed: true, checks: ["balance"], errors: [] }, sourceArtifactRefs: ["normalized-1"], status: "ready",
});

describe("A 股基本面能力", () => {
  it("registers the professional workflow layer and the financial modeler boundary", () => {
    for (const id of ["company-fundamental-research", "sector-cycle-research", "financial-modeling", "valuation-analysis", "earnings-update", "thesis-monitoring", "independent-research-review"]) {
      expect(SKILLS.some((skill) => skill.id === id)).toBe(true);
    }
    const modeler = AGENTS.find((agent) => agent.id === "financial-modeler")!;
    expect(modeler.canWriteArtifactKinds).toEqual(["normalized_financials", "financial_model", "valuation_analysis"]);
    expect(modeler.lifecycle).toBe("planned");
  });

  it("plans audited model, valuation, thesis and isolated review for first coverage while preserving Research Lead control", () => {
    const graph = buildResearchProblemGraph({ taskId: "task-1", researchCaseId: "case-1", goal: "首次覆盖某 A 股公司，建立财务模型和估值", intent: "full_research" }) as Parameters<typeof planFromProblemGraph>[0];
    const plan = planFromProblemGraph(graph, { maxModelCalls: 24, maxToolCalls: 60, maxCostUsd: 6 });
    for (const kind of ["financial_normalization", "model_build_or_update", "model_audit", "valuation_analysis", "thesis_update", "independent_review"]) {
      expect(plan.nodes.some((node) => node.kind === kind)).toBe(true);
    }
    expect(plan.nodes.filter((node) => node.kind === "financial_normalization" || node.kind === "model_build_or_update").every((node) => node.agent === "research-lead")).toBe(true);
  });

  it("blocks invalid models and consensus comparisons without an authorized vintage", () => {
    expect(validateFinancialModel(model()).passed).toBe(true);
    expect(validateFinancialModel({ ...model(), forecastBoundary: { start: "2026-01-01T00:00:00Z", end: "2027-12-31T00:00:00Z" } }).passed).toBe(false);
    expect(validateFinancialModel({ ...model(), formulaDependencies: [{ output: "a", inputs: ["b"] }, { output: "b", inputs: ["a"] }] }).passed).toBe(false);
    expect(consensusComparisonStatus()).toBe("not_authorized_or_not_vintaged");
    expect(consensusComparisonStatus({ provider: "licensed-provider", permissionScope: "authorized_research_use", asOf: "2026-08-11T00:00:00Z", vintage: "2026-08-10", metricDefinition: "EPS", unit: "CNY/share", period: "FY2026" })).toBe("authorized_vintaged");
  });
});
