import type { FinancialModelData, NormalizedFinancialsData, ValuationAnalysisData } from "@/src/contracts/evidence";
import { FINANCIAL_MODEL_RULES } from "@/src/research/generated/financial-model-rules";

export interface FinancialContractResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
}

const timestamp = (value: string) => Number.isFinite(Date.parse(value));

export function validateNormalizedFinancials(data: NormalizedFinancialsData): FinancialContractResult {
  const errors: string[] = [];
  if (!timestamp(data.asOf)) errors.push("invalid asOf");
  if (!data.currency || !data.unit) errors.push("currency and unit are required");
  if (!timestamp(data.historicalBoundary.start) || !timestamp(data.historicalBoundary.end)) errors.push("invalid historical boundary");
  if (Date.parse(data.historicalBoundary.start) > Date.parse(data.historicalBoundary.end)) errors.push("historical boundary start exceeds end");
  if (Date.parse(data.historicalBoundary.end) > Date.parse(data.asOf)) errors.push("historical boundary exceeds asOf");
  if (data.status === "ready" && data.observations.length === 0) errors.push("ready normalized financials require observations");
  for (const observation of data.observations) {
    if (!Number.isFinite(observation.value)) errors.push("non-finite observation: " + observation.metricId);
    if (!timestamp(observation.period.start) || !timestamp(observation.period.end)) errors.push("invalid observation period: " + observation.metricId);
    if (Date.parse(observation.period.start) > Date.parse(observation.period.end)) errors.push("observation period start exceeds end: " + observation.metricId);
    if (Date.parse(observation.period.end) > Date.parse(data.asOf)) errors.push("future observation: " + observation.metricId);
    if (observation.businessTime && (!timestamp(observation.businessTime) || Date.parse(observation.businessTime) > Date.parse(data.asOf))) errors.push("future business time: " + observation.metricId);
    if (!(observation.unit || data.unit)) errors.push("missing unit: " + observation.metricId);
    if (!(observation.currency || data.currency)) errors.push("missing currency: " + observation.metricId);
    if (!observation.sourceArtifactRef) errors.push("missing source artifact: " + observation.metricId);
  }
  return { passed: errors.length === 0, errors, warnings: data.status === "insufficient" ? ["insufficient normalized financials"] : [] };
}

export function validateFinancialModel(data: FinancialModelData): FinancialContractResult {
  const errors: string[] = [];
  if (!timestamp(data.asOf)) errors.push("invalid asOf");
  if (!FINANCIAL_MODEL_RULES.model_scopes.includes(data.modelScope as never)) errors.push("invalid model scope");
  if (!data.currency || !data.unit) errors.push("currency and unit are required");
  if (Date.parse(data.historicalBoundary.end) >= Date.parse(data.forecastBoundary.start)) errors.push("forecast boundary must start after historical boundary");
  const assumptionIds = new Set(data.assumptions.map((item) => item.id));
  const outputs = new Set(data.formulaDependencies.map((item) => item.output));
  const rawObservationRefs = new Set(data.computedOutputs.flatMap((item) => item.inputObservationRefs));
  const dependencies = new Map(data.formulaDependencies.map((item) => [item.output, item.inputs.filter((input) => outputs.has(input))]));
  for (const assumption of data.assumptions) {
    if (assumption.basis !== "analyst_assumption" && !assumption.sourceArtifactRef) errors.push("missing source for assumption: " + assumption.id);
  }
  for (const formula of data.formulaDependencies) {
    if (!formula.output || formula.inputs.length === 0) errors.push("invalid formula dependency: " + (formula.output || "unknown"));
    for (const input of formula.inputs) if (!assumptionIds.has(input) && !outputs.has(input) && !rawObservationRefs.has(input)) errors.push("unknown formula input: " + input);
    if (formula.inputs.includes(formula.output)) errors.push("self-referential formula: " + formula.output);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (output: string): boolean => {
    if (visiting.has(output)) return true;
    if (visited.has(output)) return false;
    visiting.add(output);
    const cyclic = (dependencies.get(output) || []).some(visit);
    visiting.delete(output);
    visited.add(output);
    return cyclic;
  };
  if ([...outputs].some(visit)) errors.push("cyclic formula dependency");
  for (const scenario of data.scenarios) {
    if (!["base", "bull", "bear"].includes(scenario.id)) errors.push("invalid scenario: " + scenario.id);
    for (const id of scenario.assumptionIds) if (!assumptionIds.has(id)) errors.push("unknown scenario assumption: " + id);
  }
  const computedOutputIds = new Set(data.computedOutputs.map((item) => item.id));
  for (const output of data.computedOutputs) {
    if (!Number.isFinite(output.value)) errors.push("non-finite computed output: " + output.id);
    if (!output.formula || output.inputObservationRefs.length === 0) errors.push("computed output lacks formula lineage: " + output.id);
    if (!outputs.has(output.id)) errors.push("computed output lacks dependency declaration: " + output.id);
    if (output.scenario !== "historical" && data.scenarios.every((scenario) => scenario.id !== output.scenario)) errors.push("forecast output lacks scenario: " + output.id);
  }
  for (const output of outputs) if (!computedOutputIds.has(output)) errors.push("formula output was not computed: " + output);
  for (const reconciliation of data.reconciliations) if (reconciliation.status === "failed") errors.push("failed reconciliation: " + reconciliation.id);
  if (data.status === "ready" && data.computedOutputs.length === 0) errors.push("ready model requires deterministic computed outputs");
  if (data.status === "ready" && !data.audit.passed) errors.push("ready model requires a passed audit");
  if (!data.audit.passed) errors.push(...data.audit.errors.map((item) => "audit: " + item));
  return { passed: errors.length === 0, errors, warnings: [...new Set([...(data.status === "blocked" ? ["model is blocked"] : []), ...data.audit.warnings])] };
}

export function validateValuationAnalysis(data: ValuationAnalysisData, model?: FinancialModelData, modelAuditPassed = false): FinancialContractResult {
  const errors: string[] = [];
  if (!timestamp(data.asOf)) errors.push("invalid asOf");
  if (!data.financialModelRef || !data.modelAuditRef) errors.push("financial model and audit references are required");
  if (!data.currency || !data.unit) errors.push("currency and unit are required");
  if (!model || model.status !== "ready" || !model.audit.passed || !modelAuditPassed) errors.push("audited ready financial model is required");
  const requiredFields = new Set(FINANCIAL_MODEL_RULES.valuation_gate.required_fields);
  if (requiredFields.has("methods") && data.methods.length === 0) errors.push("at least one valuation method is required");
  if (requiredFields.has("assumptions") && data.assumptions.length === 0) errors.push("valuation assumptions are required");
  if (requiredFields.has("sensitivities") && data.sensitivities.length === 0) errors.push("valuation sensitivities are required");
  if (model && model.modelScope !== FINANCIAL_MODEL_RULES.valuation_gate.required_model_scope) errors.push("forecast model scope is required");
  if (model && !model.computedOutputs.some((output) => output.scenario === FINANCIAL_MODEL_RULES.valuation_gate.required_output_scenario)) errors.push("base-case forecast output is required");
  if (data.status === "ready" && errors.length) errors.push("ready valuation violates deterministic prerequisites");
  return { passed: errors.length === 0, errors: [...new Set(errors)], warnings: data.status === "blocked" ? ["valuation is blocked"] : [] };
}

export interface ConsensusComparisonInput {
  provider?: string;
  permissionScope?: "public_research_use" | "authorized_research_use" | "user_supplied" | "restricted";
  asOf?: string;
  vintage?: string;
  metricDefinition?: string;
  unit?: string;
  period?: string;
}

export function consensusComparisonStatus(input?: ConsensusComparisonInput): "authorized_vintaged" | "not_authorized_or_not_vintaged" {
  if (!input?.provider || !input.asOf || !timestamp(input.asOf) || !input.vintage || !input.metricDefinition || !input.unit || !input.period) return "not_authorized_or_not_vintaged";
  if (!["public_research_use", "authorized_research_use", "user_supplied"].includes(input.permissionScope || "")) return "not_authorized_or_not_vintaged";
  return "authorized_vintaged";
}
