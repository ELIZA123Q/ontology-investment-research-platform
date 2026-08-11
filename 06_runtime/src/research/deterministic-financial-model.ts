import type {
  DeterministicFinancialOutput,
  FinancialModelData,
  FinancialObservationValue,
  FinancialReconciliationCheck,
  NormalizedFinancialsData,
} from "@/src/contracts";
import { validateNormalizedFinancials } from "@/src/research/financial-model-contract";
import { FINANCIAL_MODEL_RULES } from "@/src/research/generated/financial-model-rules";

const DAY_MS = 86_400_000;
const rules = FINANCIAL_MODEL_RULES;
const monetaryUnits = rules.unit_normalization.monetary.supported as Record<string, Record<string, number>>;
const aliases = rules.metric_aliases as Record<string, readonly string[]>;

interface NormalizedObservation extends FinancialObservationValue {
  normalizedValue: number;
  normalizedUnit: string;
  ref: string;
}

export interface DeterministicFinancialModelResult {
  model: FinancialModelData;
  normalizedObservations: NormalizedObservation[];
}

/** Executes only the projection of the governed financial_model_integrity_policy. */
export function buildDeterministicFinancialModel(data: NormalizedFinancialsData): DeterministicFinancialModelResult {
  const normalizedCheck = validateNormalizedFinancials(data);
  const errors = [...normalizedCheck.errors];
  const warnings = [...normalizedCheck.warnings];
  if (data.status !== "ready") errors.push("normalized financials are insufficient");
  const normalizedObservations: NormalizedObservation[] = [];

  for (const observation of data.observations) {
    const unit = observation.unit || data.unit;
    const currency = observation.currency || data.currency;
    const isNonMonetary = rules.unit_normalization.non_monetary_units.includes(unit as never) || unit.endsWith(rules.unit_normalization.per_share_suffix);
    const factor = monetaryUnits[currency]?.[unit];
    if (!isNonMonetary && factor === undefined) {
      errors.push(`unsupported financial unit: ${observation.metricId} (${currency} ${unit})`);
      continue;
    }
    if (!isNonMonetary && currency !== data.currency) {
      errors.push(`mixed currency without frozen FX rate: ${observation.metricId} (${currency}/${data.currency})`);
      continue;
    }
    normalizedObservations.push({
      ...observation,
      normalizedValue: isNonMonetary ? observation.value : observation.value * factor,
      normalizedUnit: isNonMonetary ? unit : rules.unit_normalization.monetary.canonical_unit,
      ref: observationRef(observation),
    });
  }

  const grouped = groupByCanonicalMetric(normalizedObservations);
  const outputs = executeDerivedOutputs(grouped, warnings);
  const reconciliations = rules.reconciliations.map((definition) => executeReconciliation(definition, grouped));
  for (const check of reconciliations) {
    if (check.status === "failed") errors.push(check.message);
    if (check.status === "not_testable") warnings.push(check.message);
  }

  const passed = errors.length === 0 && outputs.length > 0;
  if (!outputs.length) errors.push("no deterministic financial output could be computed");
  const nextDay = new Date(Date.parse(data.historicalBoundary.end) + DAY_MS).toISOString();
  const nextYear = new Date(Date.parse(nextDay) + 365 * DAY_MS).toISOString();
  const model: FinancialModelData = {
    modelScope: "historical_earnings_update",
    asOf: data.asOf,
    entityRef: data.entityRef,
    accountingBasis: data.accountingBasis,
    currency: data.currency,
    unit: rules.unit_normalization.monetary.canonical_unit,
    historicalBoundary: data.historicalBoundary,
    forecastBoundary: { start: nextDay, end: nextYear },
    assumptions: [],
    formulaDependencies: outputs.map((output) => ({ output: output.id, inputs: output.inputObservationRefs })),
    scenarios: [],
    computedOutputs: outputs,
    reconciliations,
    audit: {
      passed,
      checks: [
        "point-in-time boundary",
        "governed currency and unit normalization",
        "governed deterministic formula execution",
        ...rules.reconciliations.map((item) => item.id),
      ],
      errors: [...new Set(errors)],
      warnings: [...new Set(warnings)],
    },
    sourceArtifactRefs: data.sourceArtifactRefs,
    status: passed ? "ready" : "blocked",
  };
  return { model, normalizedObservations };
}

function groupByCanonicalMetric(observations: NormalizedObservation[]): Map<string, NormalizedObservation[]> {
  const grouped = new Map<string, NormalizedObservation[]>();
  for (const [canonical, ids] of Object.entries(aliases)) {
    const matches = observations.filter((item) => ids.includes(item.metricId)).sort((left, right) => Date.parse(right.period.end) - Date.parse(left.period.end));
    if (matches.length) grouped.set(canonical, matches);
  }
  return grouped;
}

function executeDerivedOutputs(grouped: Map<string, NormalizedObservation[]>, warnings: string[]): DeterministicFinancialOutput[] {
  const outputs: DeterministicFinancialOutput[] = [];
  for (const definition of rules.derived_outputs.growth) {
    const observations = grouped.get(definition.metric) || [];
    const current = selectPeriodRole(observations, "current") || observations[0];
    const prior = selectPeriodRole(observations, "prior") || observations.find((item) => item.ref !== current?.ref);
    if (!current || !prior) {
      if (current) warnings.push(`${definition.id} not testable: prior-period observation is missing`);
      continue;
    }
    if (prior.normalizedValue === 0) {
      warnings.push(`${definition.id} not testable: prior-period value is zero`);
      continue;
    }
    outputs.push({
      id: definition.id, label: definition.label,
      value: round(((current.normalizedValue - prior.normalizedValue) / Math.abs(prior.normalizedValue)) * 100, 4),
      unit: definition.unit, formula: definition.formula, inputObservationRefs: [current.ref, prior.ref], scenario: "historical",
    });
  }
  for (const definition of rules.derived_outputs.ratios) {
    const numerator = currentOf(grouped, definition.numerator);
    const denominator = currentOf(grouped, definition.denominator);
    if (!numerator || !denominator || denominator.normalizedValue === 0) continue;
    outputs.push({
      id: definition.id, label: definition.label, value: round((numerator.normalizedValue / denominator.normalizedValue) * 100, 4),
      unit: definition.unit, formula: definition.formula, inputObservationRefs: [numerator.ref, denominator.ref], scenario: "historical",
    });
  }
  for (const definition of rules.derived_outputs.differences) {
    const minuend = currentOf(grouped, definition.minuend);
    const subtrahend = currentOf(grouped, definition.subtrahend);
    if (minuend && subtrahend) {
      outputs.push({
        id: definition.id, label: definition.label, value: round(minuend.normalizedValue - subtrahend.normalizedValue, 2),
        unit: definition.unit, formula: definition.formula, inputObservationRefs: [minuend.ref, subtrahend.ref], scenario: "historical",
      });
    } else if (minuend) {
      warnings.push(`${definition.id} not testable: ${definition.subtrahend} is missing; ${definition.interpretation_boundary}`);
    }
  }
  return outputs;
}

function executeReconciliation(
  definition: (typeof rules.reconciliations)[number],
  grouped: Map<string, NormalizedObservation[]>,
): FinancialReconciliationCheck {
  const required = definition.inputs.map((metric) => currentOf(grouped, metric));
  const optional = ("optional_inputs" in definition ? definition.optional_inputs : []).map((metric) => currentOf(grouped, metric));
  if (required.some((item) => !item)) {
    return notTestable(definition.id, `${definition.id} not testable: required inputs are incomplete`, [...required, ...optional]);
  }
  const values = new Map<string, number>(definition.inputs.map((metric, index) => [metric, required[index]!.normalizedValue]));
  for (const [index, metric] of (("optional_inputs" in definition ? definition.optional_inputs : []) || []).entries()) values.set(metric, optional[index]?.normalizedValue || 0);
  const difference = definition.kind === "balance_sheet"
    ? values.get("total_assets")! - values.get("total_liabilities")! - values.get("total_equity")!
    : values.get("ending_cash")! - (values.get("beginning_cash")! + values.get("operating_cash_flow")! + values.get("investing_cash_flow")! + values.get("financing_cash_flow")! + (values.get("fx_effect") || 0));
  const relativeBase = values.get(definition.tolerance.relative_to)!;
  const tolerance = Math.max(definition.tolerance.absolute, Math.abs(relativeBase) * definition.tolerance.relative);
  const passed = Math.abs(difference) <= tolerance;
  return {
    id: definition.id, status: passed ? "passed" : "failed",
    inputObservationRefs: [...required, ...optional].filter(Boolean).map((item) => item!.ref),
    difference: round(difference, 2), tolerance: round(tolerance, 2), unit: rules.unit_normalization.monetary.canonical_unit,
    message: passed ? `${definition.id} reconciles within governed tolerance` : `${definition.id} does not reconcile: difference ${round(difference, 2)} ${rules.unit_normalization.monetary.canonical_unit}`,
  };
}

function currentOf(grouped: Map<string, NormalizedObservation[]>, metric: string): NormalizedObservation | undefined {
  const values = grouped.get(metric) || [];
  return selectPeriodRole(values, "current") || values[0];
}

function selectPeriodRole(values: NormalizedObservation[], role: "current" | "prior"): NormalizedObservation | undefined {
  return values.find((item) => String(item.dimensions?.periodRole || item.dimensions?.period_role || "").toLowerCase() === role);
}

function observationRef(observation: FinancialObservationValue): string {
  return `${observation.metricId}@${observation.period.start}/${observation.period.end}:${observation.basis}`;
}

function notTestable(id: string, message: string, inputs: Array<NormalizedObservation | undefined>): FinancialReconciliationCheck {
  return { id, status: "not_testable", inputObservationRefs: inputs.filter(Boolean).map((item) => item!.ref), message };
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
