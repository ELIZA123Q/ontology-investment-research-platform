import type { FinancialModelData, NormalizedFinancialsData } from "@/src/contracts";

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
  if (Date.parse(data.historicalBoundary.end) > Date.parse(data.asOf)) errors.push("historical boundary exceeds asOf");
  for (const observation of data.observations) {
    if (!Number.isFinite(observation.value)) errors.push("non-finite observation: " + observation.metricId);
    if (Date.parse(observation.period.end) > Date.parse(data.asOf)) errors.push("future observation: " + observation.metricId);
    if (!observation.sourceArtifactRef) errors.push("missing source artifact: " + observation.metricId);
  }
  return { passed: errors.length === 0, errors, warnings: data.status === "insufficient" ? ["insufficient normalized financials"] : [] };
}

export function validateFinancialModel(data: FinancialModelData): FinancialContractResult {
  const errors: string[] = [];
  if (!timestamp(data.asOf)) errors.push("invalid asOf");
  if (!data.currency || !data.unit) errors.push("currency and unit are required");
  if (Date.parse(data.historicalBoundary.end) >= Date.parse(data.forecastBoundary.start)) errors.push("forecast boundary must start after historical boundary");
  const assumptionIds = new Set(data.assumptions.map((item) => item.id));
  const outputs = new Set(data.formulaDependencies.map((item) => item.output));
  const dependencies = new Map(data.formulaDependencies.map((item) => [item.output, item.inputs.filter((input) => outputs.has(input))]));
  for (const assumption of data.assumptions) {
    if (assumption.basis !== "analyst_assumption" && !assumption.sourceArtifactRef) errors.push("missing source for assumption: " + assumption.id);
  }
  for (const formula of data.formulaDependencies) {
    if (!formula.output || formula.inputs.length === 0) errors.push("invalid formula dependency: " + (formula.output || "unknown"));
    for (const input of formula.inputs) if (!assumptionIds.has(input) && !outputs.has(input)) errors.push("unknown formula input: " + input);
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
  if (!data.audit.passed) errors.push(...data.audit.errors.map((item) => "audit: " + item));
  return { passed: errors.length === 0, errors, warnings: data.status === "blocked" ? ["model is blocked"] : [] };
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
