import { describe, expect, it } from "vitest";
import type { FinancialModelData, NormalizedFinancialsData, ValuationAnalysisData } from "@/src/contracts/evidence";
import { AGENTS, SKILLS } from "@/src/capabilities/registry";
import { buildResearchProblemGraph } from "@/src/runtime/problem-graph";
import { COMPANY_COVERAGE_INITIAL_NODE_LIMIT, planFromProblemGraph } from "@/src/runtime/planner";
import { consensusComparisonStatus, validateFinancialModel, validateValuationAnalysis } from "@/src/research/financial-model-contract";
import { buildDeterministicFinancialModel } from "@/src/research/deterministic-financial-model";

const currentPeriod = { start: "2025-01-01T00:00:00Z", end: "2025-12-31T00:00:00Z" };
const priorPeriod = { start: "2024-01-01T00:00:00Z", end: "2024-12-31T00:00:00Z" };
const revenueCurrentRef = `revenue@${currentPeriod.start}/${currentPeriod.end}:reported`;
const revenuePriorRef = `revenue@${priorPeriod.start}/${priorPeriod.end}:reported`;

const model = (): FinancialModelData => ({
  modelScope: "historical_earnings_update", asOf: "2026-08-11T00:00:00Z", entityRef: "case-1", accountingBasis: "PRC_GAAP", currency: "CNY", unit: "元",
  historicalBoundary: { start: "2025-01-01T00:00:00Z", end: "2026-06-30T00:00:00Z" },
  forecastBoundary: { start: "2026-07-01T00:00:00Z", end: "2027-12-31T00:00:00Z" },
  assumptions: [],
  formulaDependencies: [{ output: "revenue_growth", inputs: [revenueCurrentRef, revenuePriorRef] }],
  scenarios: [],
  computedOutputs: [{ id: "revenue_growth", label: "收入同比增速", value: 25, unit: "%", formula: "(current-prior)/prior*100", inputObservationRefs: [revenueCurrentRef, revenuePriorRef], scenario: "historical" }],
  reconciliations: [{ id: "balance_sheet_equation", status: "not_testable", inputObservationRefs: [], message: "inputs missing" }],
  audit: { passed: true, checks: ["deterministic formula execution"], errors: [], warnings: ["balance sheet not testable"] }, sourceArtifactRefs: ["normalized-1"], status: "ready",
});

const normalized = (): NormalizedFinancialsData => ({
  asOf: "2026-02-28T00:00:00Z", entityRef: "company:688261.SH", accountingBasis: "PRC_GAAP", currency: "CNY", unit: "元",
  historicalBoundary: { start: priorPeriod.start, end: currentPeriod.end }, sourceArtifactRefs: ["announcement-1"], status: "ready",
  observations: [
    { metricId: "revenue", period: currentPeriod, value: 125268.76, unit: "万元", currency: "CNY", basis: "reported", dimensions: { periodRole: "current" }, sourceArtifactRef: "announcement-1" },
    { metricId: "revenue", period: priorPeriod, value: 100322, unit: "万元", currency: "CNY", basis: "reported", dimensions: { periodRole: "prior" }, sourceArtifactRef: "announcement-1" },
    { metricId: "operating_profit", period: currentPeriod, value: 3037.49, unit: "万元", currency: "CNY", basis: "reported", dimensions: { periodRole: "current" }, sourceArtifactRef: "announcement-1" },
    { metricId: "operating_profit", period: priorPeriod, value: 3317.33, unit: "万元", currency: "CNY", basis: "reported", dimensions: { periodRole: "prior" }, sourceArtifactRef: "announcement-1" },
    { metricId: "net_profit", period: currentPeriod, value: 4405.63, unit: "万元", currency: "CNY", basis: "reported", dimensions: { periodRole: "current" }, sourceArtifactRef: "announcement-1" },
    { metricId: "net_profit", period: priorPeriod, value: 4023.51, unit: "万元", currency: "CNY", basis: "reported", dimensions: { periodRole: "prior" }, sourceArtifactRef: "announcement-1" },
    { metricId: "adjusted_net_profit", period: currentPeriod, value: 3600, unit: "万元", currency: "CNY", basis: "adjusted", dimensions: { periodRole: "current" }, sourceArtifactRef: "announcement-1" },
  ],
});

describe("A 股基本面能力", () => {
  it("registers the professional workflow layer and the financial modeler boundary", () => {
    for (const id of ["company-fundamental-research", "sector-cycle-research", "financial-modeling", "valuation-analysis", "earnings-update", "thesis-monitoring", "independent-research-review"]) {
      expect(SKILLS.some((skill) => skill.id === id)).toBe(true);
    }
    const modeler = AGENTS.find((agent) => agent.id === "financial-modeler")!;
    expect(modeler.canWriteArtifactKinds).toEqual(["normalized_financials", "financial_model", "valuation_analysis"]);
    expect(modeler.lifecycle).toBe("candidate");
  });

  it("plans audited model, valuation, thesis and isolated review for first coverage while preserving Research Lead control", () => {
    const graph = buildResearchProblemGraph({ taskId: "task-1", researchCaseId: "case-1", goal: "首次覆盖某 A 股公司，建立财务模型和估值", intent: "full_research" }) as Parameters<typeof planFromProblemGraph>[0];
    const plan = planFromProblemGraph(graph, { maxModelCalls: 24, maxToolCalls: 60, maxCostUsd: 6 }, "evaluation");
    for (const kind of ["financial_normalization", "model_build_or_update", "model_audit", "valuation_analysis", "thesis_update", "independent_review"]) {
      expect(plan.nodes.some((node) => node.kind === kind)).toBe(true);
    }
    expect(plan.nodes.length).toBeLessThanOrEqual(COMPANY_COVERAGE_INITIAL_NODE_LIMIT);
    expect(plan.nodes.filter((node) => node.kind === "financial_normalization" || node.kind === "model_build_or_update").every((node) => node.agent === "research-lead")).toBe(true);
  });

  it("blocks invalid models and consensus comparisons without an authorized vintage", () => {
    expect(validateFinancialModel(model()).passed).toBe(true);
    expect(validateFinancialModel({ ...model(), forecastBoundary: { start: "2026-01-01T00:00:00Z", end: "2027-12-31T00:00:00Z" } }).passed).toBe(false);
    expect(validateFinancialModel({ ...model(), formulaDependencies: [{ output: "a", inputs: ["b"] }, { output: "b", inputs: ["a"] }] }).passed).toBe(false);
    expect(consensusComparisonStatus()).toBe("not_authorized_or_not_vintaged");
    expect(consensusComparisonStatus({ provider: "licensed-provider", permissionScope: "authorized_research_use", asOf: "2026-08-11T00:00:00Z", vintage: "2026-08-10", metricDefinition: "EPS", unit: "CNY/share", period: "FY2026" })).toBe("authorized_vintaged");
  });

  it("executes historical formulas deterministically, normalizes units and keeps unavailable reconciliations explicit", () => {
    const result = buildDeterministicFinancialModel(normalized());
    expect(result.model.status).toBe("ready");
    expect(result.model.audit.passed).toBe(true);
    expect(result.model.computedOutputs.find((item) => item.id === "revenue_growth")?.value).toBeCloseTo(24.8667, 4);
    expect(result.model.computedOutputs.find((item) => item.id === "operating_profit_growth")?.value).toBeCloseTo(-8.4357, 4);
    expect(result.model.computedOutputs.find((item) => item.id === "reported_adjusted_net_profit_gap")?.value).toBe(8056300);
    expect(result.normalizedObservations[0].normalizedValue).toBe(1_252_687_600);
    expect(result.model.reconciliations.every((item) => item.status === "not_testable")).toBe(true);
    expect(validateFinancialModel(result.model).passed).toBe(true);
    expect(result.model.assumptions).toEqual([]);
    expect(result.model.scenarios).toEqual([]);
    expect(result.model.computedOutputs.every((item) => item.scenario === "historical")).toBe(true);
  });

  it("fails mixed-currency inputs and failed three-statement reconciliation instead of silently passing", () => {
    const mixedCurrency = normalized();
    mixedCurrency.observations[0] = { ...mixedCurrency.observations[0], currency: "USD" };
    expect(buildDeterministicFinancialModel(mixedCurrency).model).toMatchObject({ status: "blocked", audit: { passed: false } });

    const unbalanced = normalized();
    unbalanced.observations.push(
      { metricId: "total_assets", period: currentPeriod, value: 100, unit: "万元", currency: "CNY", basis: "reported", sourceArtifactRef: "announcement-1" },
      { metricId: "total_liabilities", period: currentPeriod, value: 60, unit: "万元", currency: "CNY", basis: "reported", sourceArtifactRef: "announcement-1" },
      { metricId: "total_equity", period: currentPeriod, value: 30, unit: "万元", currency: "CNY", basis: "reported", sourceArtifactRef: "announcement-1" },
    );
    const result = buildDeterministicFinancialModel(unbalanced).model;
    expect(result.reconciliations.find((item) => item.id === "balance_sheet_equation")?.status).toBe("failed");
    expect(result.status).toBe("blocked");
  });

  it("rejects an empty valuation even after model audit and requires explicit forecast lineage", () => {
    const valuation: ValuationAnalysisData = {
      asOf: model().asOf, financialModelRef: "model-1", modelAuditRef: "audit-1", currency: "CNY", unit: "元",
      methods: [], assumptions: [], sensitivities: [], status: "ready",
    };
    const check = validateValuationAnalysis(valuation, model(), true);
    expect(check.passed).toBe(false);
    expect(check.errors).toEqual(expect.arrayContaining(["at least one valuation method is required", "forecast model scope is required", "base-case forecast output is required"]));
  });
});
