import { GOVERNANCE_POLICY_CATALOG } from "@/src/generated/domain-catalog";
import type { AssetKind, CandidateDecision } from "@/src/contracts";

type RecordValue = Record<string, unknown>;

const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const strings = (value: unknown): string[] => Array.isArray(value) ? value.map(String) : [];

const knowledge = GOVERNANCE_POLICY_CATALOG.knowledgePromotion;

export interface KnowledgePromotionThreshold {
  minimumDistinctRuns: number;
  minimumTaskFamilies: number;
  minimumScoreDelta: number;
  maximumSevereRegressions: number;
}

export function minimumIndependentPublishers(role: string): number {
  const defaults = record(GOVERNANCE_POLICY_CATALOG.evidenceSufficiency.default_minimum_independent_publishers);
  const value = Number(defaults[role] ?? defaults.context);
  if (!Number.isFinite(value) || value < 1) throw new Error(`No governed evidence sufficiency threshold for role: ${role}`);
  return value;
}

export function knowledgeCandidateAutoReleaseAllowed(riskLevel: number): boolean {
  return strings(record(knowledge.approval_policies).automatic_risk_levels).map(Number).includes(riskLevel);
}

export function requiredKnowledgeApprovalRoles(input: { riskLevel: number; assetKind: AssetKind }): CandidateDecision["reviewerRole"][] {
  if (input.riskLevel < 2) return [];
  const policies = record(knowledge.approval_policies);
  const routes = record(policies.asset_kind_routes);
  const kind = input.assetKind;
  const route = Object.entries(routes).find(([, kinds]) => strings(kinds).includes(kind))?.[0];
  const policyKey = input.riskLevel >= 3
    ? (route === "ontology" || route === "skill" ? route : "other_L3")
    : (route || "case_or_failure");
  const roles = strings(policies[policyKey]);
  if (!roles.length) throw new Error(`No governed knowledge approval route for ${kind} at risk L${input.riskLevel}`);
  return roles as CandidateDecision["reviewerRole"][];
}

export function knowledgePromotionThreshold(assetKind: AssetKind, stewardInitiated = false): KnowledgePromotionThreshold {
  const thresholds = record(knowledge.promotion_thresholds);
  const routes = record(thresholds.asset_kind_routes);
  const route = Object.entries(routes).find(([, kinds]) => strings(kinds).includes(assetKind))?.[0];
  const selected = record(thresholds[route || "default"]);
  const fallback = record(thresholds.default);
  const distinctRuns = assetKind === "ontology" && stewardInitiated
    ? 1
    : Number(selected.minimum_distinct_runs ?? selected.minimum_distinct_tasks ?? fallback.minimum_distinct_runs);
  return {
    minimumDistinctRuns: distinctRuns,
    minimumTaskFamilies: Number(selected.minimum_task_families ?? fallback.minimum_task_families),
    minimumScoreDelta: Number(selected.minimum_score_delta ?? fallback.minimum_score_delta),
    maximumSevereRegressions: Number(selected.maximum_severe_regressions ?? fallback.maximum_severe_regressions),
  };
}

export function governedTaskOutcomes(): readonly string[] {
  return GOVERNANCE_POLICY_CATALOG.assetAuthority
    ? (GOVERNANCE_POLICY_CATALOG as unknown as { taskOutcomes?: readonly string[] }).taskOutcomes || []
    : [];
}

export function editableArtifactFields(kind: "judgment" | "report", evidenceSufficient = true): readonly string[] {
  const editing = record(GOVERNANCE_POLICY_CATALOG.artifactEditing.editable_artifacts);
  const policy = record(editing[kind]);
  if (kind === "report") return strings(policy.fields);
  return strings(policy[evidenceSufficient ? "evidence_sufficient" : "evidence_insufficient"]);
}

export function assertArtifactEditAllowed(kind: string, fields: readonly string[], evidenceSufficient = true): void {
  if (kind !== "judgment" && kind !== "report") throw new Error(`Artifact kind is not editable: ${kind}`);
  const allowed = editableArtifactFields(kind, evidenceSufficient);
  const forbidden = fields.filter((field) => !allowed.includes(field));
  if (forbidden.length) throw new Error(`Fields are not editable by governed policy: ${forbidden.join(", ")}`);
}
