import { createHash } from "node:crypto";
import type { NormalizedFinancialsData, ValuationAnalysisData } from "@/src/contracts/evidence";
import { buildDeterministicFinancialModel } from "@/src/research/deterministic-financial-model";
import { validateFinancialModel, validateValuationAnalysis } from "@/src/research/financial-model-contract";

export interface EarningsUpdateReplayFixture {
  schemaName: string;
  schemaVersion: string;
  id: string;
  researchQuestion: string;
  asOf: string;
  entity: { id: string; name: string; instrumentId: string };
  source: { title: string; uri: string; publisherId: string; publishedAt: string; permissionScope: string; rawContentHash: string; byteLength: number; locator: string; documentCaveat: string; metadataCaveat?: string };
  normalizedFinancials: NormalizedFinancialsData;
  expected: { outcome: "completed_with_judgment" | "stopped_insufficient_evidence"; outputs: Record<string, number>; tolerance: number; valuationStatus: "blocked"; requiredLimitations: string[] };
}

export interface EarningsUpdateReplayResult {
  fixtureId: string;
  fixtureFingerprint: string;
  passed: boolean;
  outcome: "completed_with_judgment" | "stopped_insufficient_evidence";
  judgment: string | null;
  outputChecks: Array<{ id: string; expected: number; actual?: number; passed: boolean }>;
  modelAudit: ReturnType<typeof validateFinancialModel>;
  valuationStatus: "blocked";
  valuationGate: ReturnType<typeof validateValuationAnalysis>;
  limitations: string[];
  source: EarningsUpdateReplayFixture["source"];
}

export function runEarningsUpdateReplay(fixture: EarningsUpdateReplayFixture): EarningsUpdateReplayResult {
  const sourceErrors: string[] = [];
  if (!/^sha256:[a-f0-9]{64}$/u.test(fixture.source.rawContentHash)) sourceErrors.push("invalid source hash");
  if (Date.parse(fixture.source.publishedAt) > Date.parse(fixture.asOf)) sourceErrors.push("source was published after replay asOf");
  if (fixture.source.permissionScope !== "public_research_use") sourceErrors.push("source is not approved for public research replay");
  const { model } = buildDeterministicFinancialModel(fixture.normalizedFinancials);
  const modelAudit = validateFinancialModel(model);
  const outputChecks = Object.entries(fixture.expected.outputs).map(([id, expected]) => {
    const actual = model.computedOutputs.find((output) => output.id === id)?.value;
    return { id, expected, actual, passed: actual !== undefined && Math.abs(actual - expected) <= fixture.expected.tolerance };
  });
  const revenueGrowth = model.computedOutputs.find((output) => output.id === "revenue_growth")?.value;
  const operatingProfitGrowth = model.computedOutputs.find((output) => output.id === "operating_profit_growth")?.value;
  const descriptiveJudgmentSupported = modelAudit.passed && revenueGrowth !== undefined && operatingProfitGrowth !== undefined;
  const outcome = descriptiveJudgmentSupported ? "completed_with_judgment" : "stopped_insufficient_evidence";
  const valuation: ValuationAnalysisData = {
    asOf: fixture.asOf, financialModelRef: "replay:financial-model", modelAuditRef: "replay:model-audit", currency: model.currency, unit: model.unit,
    methods: [], assumptions: [], sensitivities: [], status: "blocked", blockers: ["No explicit forecast, valuation method, assumptions or sensitivity inputs."],
  };
  const valuationGate = validateValuationAnalysis(valuation, model, modelAudit.passed);
  const limitations = [
    "unaudited", "single_issuer_source",
    model.reconciliations.find((item) => item.id === "balance_sheet_equation")?.status === "not_testable" ? "balance_sheet_not_testable" : "",
    model.reconciliations.find((item) => item.id === "cash_flow_rollforward")?.status === "not_testable" ? "cash_flow_not_testable" : "",
    "causal_claims_not_independently_corroborated", "valuation_inputs_missing",
  ].filter(Boolean);
  const passed = sourceErrors.length === 0
    && outcome === fixture.expected.outcome
    && outputChecks.every((check) => check.passed)
    && model.assumptions.length === 0
    && model.scenarios.length === 0
    && model.computedOutputs.every((output) => output.scenario === "historical")
    && !valuationGate.passed
    && fixture.expected.requiredLimitations.every((item) => limitations.includes(item));
  return {
    fixtureId: fixture.id,
    fixtureFingerprint: `sha256:${createHash("sha256").update(JSON.stringify(fixture), "utf8").digest("hex")}`,
    passed,
    outcome,
    judgment: descriptiveJudgmentSupported
      ? `截至 ${fixture.asOf.slice(0, 10)}，营业总收入同比增长 ${revenueGrowth!.toFixed(2)}%，但营业利润同比下降 ${Math.abs(operatingProfitGrowth!).toFixed(2)}%，收入增长尚未伴随营业利润同步改善。具体原因仅有公司披露，未经独立来源交叉验证。`
      : null,
    outputChecks,
    modelAudit,
    valuationStatus: "blocked",
    valuationGate,
    limitations,
    source: fixture.source,
  };
}
