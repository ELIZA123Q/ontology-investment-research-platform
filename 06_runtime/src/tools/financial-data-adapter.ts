import { createHash } from "node:crypto";
import type { EvidenceFact, PointInTimeEvidenceEnvelope, SourceSnapshot } from "@/src/contracts";
import { adaptSourceToolResult, type AdaptedSourceResult, type UnifiedSourceToolResult } from "@/src/tools/source-result-adapter";

type JsonScalar = string | number | boolean | null;
export type FinancialValueBasis = "reported" | "restated" | "consensus" | "market" | "provider_measurement" | "calculated";

export interface FinancialObservationInput {
  metricId: string;
  metricName: string;
  value: string | number;
  unit: string;
  currency?: string;
  businessTime: string;
  periodStart?: string;
  periodEnd?: string;
  basis: FinancialValueBasis;
  dimensions?: Record<string, JsonScalar>;
  locator: string;
}

export interface FinancialDataToolResult {
  connectorId: string;
  operation: string;
  requestParameters: Record<string, JsonScalar | JsonScalar[]>;
  requestedAt: string;
  retrievedAt: string;
  asOf: string;
  entity: { id: string; name: string; instrumentId?: string };
  upstream: UnifiedSourceToolResult["upstream"];
  permissionScope: SourceSnapshot["permissionScope"];
  providerResponse?: {
    body: string;
    contentHash: string;
    replayability: "replayable" | "time_sensitive" | "non_replayable";
    usageRestriction: string;
    riskDisclosure?: string;
  };
  observations: FinancialObservationInput[];
}

export interface AdaptedFinancialObservation {
  key: string;
  metricId: string;
  metricName: string;
  statement: string;
  value: string | number;
  unit: string;
  currency?: string;
  businessTime: string;
  periodStart?: string;
  periodEnd?: string;
  basis: FinancialValueBasis;
  dimensions: Record<string, JsonScalar>;
  factType: EvidenceFact["factType"];
  source: AdaptedSourceResult;
  pointInTime: PointInTimeEvidenceEnvelope;
}

export interface AdaptedFinancialDataResult {
  entity: FinancialDataToolResult["entity"];
  asOf: string;
  observations: AdaptedFinancialObservation[];
  providerResponse?: {
    contentHash: string;
    byteLength: number;
    replayability: "replayable" | "time_sensitive" | "non_replayable";
    usageRestriction: string;
    riskDisclosure?: string;
  };
}

export function adaptFinancialDataResult(result: FinancialDataToolResult): AdaptedFinancialDataResult {
  const asOf = requireTimestamp(result.asOf, "asOf");
  const requestedAt = requireTimestamp(result.requestedAt, "requestedAt");
  const retrievedAt = requireTimestamp(result.retrievedAt, "retrievedAt");
  if (Date.parse(retrievedAt) < Date.parse(requestedAt)) throw new Error("retrievedAt cannot precede requestedAt");
  if (Date.parse(asOf) > Date.parse(retrievedAt)) throw new Error("asOf cannot be later than retrievedAt");
  const entity = { id: requireText(result.entity.id, "entity.id"), name: requireText(result.entity.name, "entity.name"), instrumentId: result.entity.instrumentId?.trim() || undefined };
  if (!result.observations.length) throw new Error("at least one financial observation is required");
  const providerResponse = validateProviderResponse(result);
  const seen = new Set<string>();
  const observations = result.observations.map((input) => {
    const metricId = requireText(input.metricId, "observation.metricId");
    const metricName = requireText(input.metricName, "observation.metricName");
    const unit = requireText(input.unit, "observation.unit");
    const locator = requireText(input.locator, "observation.locator");
    const businessTime = requireTimestamp(input.businessTime, "observation.businessTime");
    const periodStart = input.periodStart ? requireTimestamp(input.periodStart, "observation.periodStart") : undefined;
    const periodEnd = input.periodEnd ? requireTimestamp(input.periodEnd, "observation.periodEnd") : undefined;
    if (periodStart && periodEnd && Date.parse(periodStart) > Date.parse(periodEnd)) throw new Error("observation periodStart cannot be later than periodEnd");
    if (periodEnd && Date.parse(periodEnd) > Date.parse(businessTime)) throw new Error("observation periodEnd cannot be later than businessTime");
    if (["reported", "restated", "market", "provider_measurement"].includes(input.basis) && Date.parse(businessTime) > Date.parse(asOf)) throw new Error("observed financial data cannot be later than asOf");
    if (typeof input.value === "number" && !Number.isFinite(input.value)) throw new Error("observation.value must be finite");
    if (typeof input.value === "string" && !input.value.trim()) throw new Error("observation.value is required");
    const dimensions = input.dimensions || {};
    const key = `${metricId}:${businessTime}:${canonicalize(dimensions)}`;
    if (seen.has(key)) throw new Error(`duplicate financial observation: ${key}`);
    seen.add(key);
    const value = typeof input.value === "string" ? input.value.trim() : input.value;
    const displayedUnit = input.currency ? `${input.currency} ${unit}` : unit;
    const statement = `${entity.name}｜${metricName}｜${businessTime.slice(0, 10)}｜${value} ${displayedUnit}｜口径：${input.basis}`;
    const normalizedEnvelope = canonicalize({
      entity, asOf, observation: { ...input, metricId, metricName, value, unit, businessTime, periodStart, periodEnd, dimensions }, normalizedStatement: statement,
    });
    const source = adaptSourceToolResult({
      connectorId: result.connectorId,
      operation: result.operation,
      requestParameters: result.requestParameters,
      requestedAt,
      retrievedAt,
      upstream: { ...result.upstream, sourceId: `${result.upstream.sourceId}:${key}`, title: `${result.upstream.title} · ${metricName}` },
      capture: { body: normalizedEnvelope, locator, quote: statement, permissionScope: result.permissionScope },
    });
    return {
      key, metricId, metricName, statement, value, unit, currency: input.currency, businessTime, periodStart, periodEnd,
      basis: input.basis, dimensions, factType: input.basis === "consensus" ? "forecast" as const : ["market", "provider_measurement"].includes(input.basis) ? "measurement" as const : "reported_fact" as const,
      source,
      pointInTime: { ...source.pointInTime, subjectRef: entity.id, businessTime, asOf, accountingBasis: String(dimensions.accountingBasis || dimensions.accounting_basis || "unspecified"), currency: input.currency, unit },
    };
  });
  return { entity, asOf, observations, providerResponse };
}

function validateProviderResponse(result: FinancialDataToolResult): AdaptedFinancialDataResult["providerResponse"] {
  if (!result.providerResponse) return undefined;
  const contentHash = requireText(result.providerResponse.contentHash, "providerResponse.contentHash");
  if (!/^sha256:[a-f0-9]{64}$/u.test(contentHash)) throw new Error("providerResponse.contentHash must be sha256");
  const calculated = `sha256:${createHash("sha256").update(result.providerResponse.body, "utf8").digest("hex")}`;
  if (calculated !== contentHash) throw new Error("providerResponse body does not match contentHash");
  const responseFingerprint = result.requestParameters.responseFingerprint;
  if (responseFingerprint !== undefined && responseFingerprint !== contentHash) throw new Error("providerResponse contentHash does not match responseFingerprint");
  return {
    contentHash,
    byteLength: Buffer.byteLength(result.providerResponse.body, "utf8"),
    replayability: result.providerResponse.replayability,
    usageRestriction: requireText(result.providerResponse.usageRestriction, "providerResponse.usageRestriction"),
    riskDisclosure: result.providerResponse.riskDisclosure?.trim() || undefined,
  };
}

function requireText(value: string, field: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function requireTimestamp(value: string, field: string): string {
  requireText(value, field);
  if (Number.isNaN(Date.parse(value))) throw new Error(`${field} must be an ISO timestamp`);
  return new Date(value).toISOString();
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
