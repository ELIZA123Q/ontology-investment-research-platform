export interface OntologyAblationMetrics {
  judgmentOmissionRate: number;
  sourceErrorRate: number;
  basisDriftRate: number;
  manualInterventions: number;
  latencyMs: number;
  costUsd: number;
  researcherUtility?: number;
}

export interface OntologyAblationCase {
  caseId: string;
  evidenceBundleHashP1: string;
  evidenceBundleHashP2: string;
  p1: OntologyAblationMetrics;
  p2: OntologyAblationMetrics;
  blinded: boolean;
  humanReviewed: boolean;
}

export interface OntologyAblationResult {
  status: "ready_for_release_review" | "engineering_only" | "invalid";
  comparableCases: number;
  improvedCoreMetrics: string[];
  regressions: string[];
  aggregate: { p1: OntologyAblationMetrics; p2: OntologyAblationMetrics };
  checks: Array<{ id: string; passed: boolean; message: string }>;
}

const metricKeys = [
  "judgmentOmissionRate", "sourceErrorRate", "basisDriftRate", "manualInterventions", "latencyMs", "costUsd",
] as const;
const coreMetricKeys = ["judgmentOmissionRate", "sourceErrorRate", "basisDriftRate", "manualInterventions"] as const;

function mean(cases: OntologyAblationCase[], track: "p1" | "p2"): OntologyAblationMetrics {
  const value = {} as Record<string, number>;
  for (const key of metricKeys) value[key] = cases.reduce((sum, item) => sum + item[track][key], 0) / Math.max(1, cases.length);
  const utility = cases.map((item) => item[track].researcherUtility).filter((item): item is number => item !== undefined);
  if (utility.length) value.researcherUtility = utility.reduce((sum, item) => sum + item, 0) / utility.length;
  return value as unknown as OntologyAblationMetrics;
}

export function evaluateOntologyAblation(cases: OntologyAblationCase[], minimumComparableCases = 12): OntologyAblationResult {
  const ids = new Set<string>();
  const invalid: string[] = [];
  for (const item of cases) {
    if (!item.caseId.trim() || ids.has(item.caseId)) invalid.push(`duplicate or empty caseId: ${item.caseId}`);
    ids.add(item.caseId);
    if (item.evidenceBundleHashP1 !== item.evidenceBundleHashP2) invalid.push(`${item.caseId}: P1/P2 evidence bundles differ`);
    for (const track of [item.p1, item.p2]) for (const key of metricKeys) if (!Number.isFinite(track[key]) || track[key] < 0) invalid.push(`${item.caseId}: invalid ${key}`);
  }
  const p1 = mean(cases, "p1");
  const p2 = mean(cases, "p2");
  const improvedCoreMetrics = coreMetricKeys.filter((key) => p2[key] < p1[key]).map(String);
  const regressions = coreMetricKeys.filter((key) => p2[key] > p1[key] + 1e-12).map((key) => `${key}: ${p1[key]} -> ${p2[key]}`);
  const checks = [
    { id: "valid_pairs", passed: invalid.length === 0, message: invalid.length ? invalid.join("; ") : "all pairs share the same evidence bundle and valid metrics" },
    { id: "minimum_cases", passed: cases.length >= minimumComparableCases, message: `${cases.length}/${minimumComparableCases} comparable cases` },
    { id: "two_core_improvements", passed: improvedCoreMetrics.length >= 2, message: `improved: ${improvedCoreMetrics.join(", ") || "none"}` },
    { id: "no_source_regression", passed: p2.sourceErrorRate <= p1.sourceErrorRate, message: `source errors ${p1.sourceErrorRate} -> ${p2.sourceErrorRate}` },
    { id: "blind_human_review", passed: cases.length > 0 && cases.every((item) => item.blinded && item.humanReviewed), message: "every pair requires blind assignment and human utility review" },
  ];
  const status = invalid.length ? "invalid" : checks.every((item) => item.passed) ? "ready_for_release_review" : "engineering_only";
  return { status, comparableCases: cases.length, improvedCoreMetrics, regressions, aggregate: { p1, p2 }, checks };
}
