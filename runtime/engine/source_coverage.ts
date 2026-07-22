import type { AuthorityType, CoreAuthorityType } from "./authority_types";
import { CORE_AUTHORITY_TYPES, authorityTypeLabel } from "./authority_types";
import type { EvidenceRequirementProjection } from "./structure_candidates";
import type { SourceRecord } from "./types";

export type AuthorityCoverageCell = {
  authority_type: CoreAuthorityType;
  label: string;
  required: boolean;
  present: boolean;
  usable_count: number;
  bound_count: number;
};

export type UnitEvidenceCoverage = {
  unit_id: string;
  requirements: Array<{
    id: string;
    requirement: string;
    evidence_role: EvidenceRequirementProjection["evidence_role"];
    minimum_independent_sources: number;
  }>;
  support_draft_count: number;
  counter_draft_count: number;
  gap_count: number;
  counter_gap_count: number;
  usable_fact_count: number;
  direct_fact_count: number;
  independent_source_groups: number;
  minimum_independent_sources: number;
  meets_independence: boolean;
  has_support_evidence: boolean;
  has_counter_evidence: boolean;
  counter_check_status: "observed" | "gap" | "not_recorded" | "not_required";
  evidence_ceiling: "J0" | "J1" | "J2" | "J3";
  weakest_link: string;
};

export type SourceCoverageSummary = {
  authority_coverage: AuthorityCoverageCell[];
  missing_core_types: CoreAuthorityType[];
  public_secondary_count: number;
  unit_coverage: UnitEvidenceCoverage[];
  coverage_gap_count: number;
  coverage_rate: number;
  verification_rate: number;
};

export type EvidenceStopThresholds = {
  coverageRate: number;
  verificationRate: number;
};

export const DEFAULT_EVIDENCE_STOP_THRESHOLDS: EvidenceStopThresholds = {
  coverageRate: 0.7,
  verificationRate: 0.5,
};

export type EvidenceStopEvaluation = {
  shouldStop: boolean;
  reason: "coverage_gap_count_zero" | "thresholds_met" | "no_gap_improvement" | "continue";
};

export type SourceFactStatus = "none" | "draft" | "approved";
export type SourceResearchLifecycle = {
  stage: "clue" | "captured" | "quote_verified" | "fact_draft" | "evidence_fact";
  label: string;
  bodyCaptured: boolean;
  quoteVerified: boolean;
  factDraft: boolean;
  evidenceFact: boolean;
};

/**
 * 研究员可读的来源生命周期。高阶状态只在前置状态真实成立时出现，
 * 避免数据库中的孤立布尔值让来源看起来比实际更可用。
 */
export function deriveSourceResearchLifecycle(input: {
  retrievalStatus?: string;
  quoteVerified?: boolean;
  factStatus?: SourceFactStatus;
}): SourceResearchLifecycle {
  const bodyCaptured = input.retrievalStatus === "captured";
  const quoteVerified = bodyCaptured && Boolean(input.quoteVerified);
  const factDraft = quoteVerified && input.factStatus === "draft";
  const evidenceFact = quoteVerified && input.factStatus === "approved";
  if (evidenceFact) {
    return { stage: "evidence_fact", label: "EvidenceFact 已确认", bodyCaptured, quoteVerified, factDraft: false, evidenceFact };
  }
  if (factDraft) {
    return { stage: "fact_draft", label: "事实草稿待审", bodyCaptured, quoteVerified, factDraft, evidenceFact: false };
  }
  if (quoteVerified) {
    return { stage: "quote_verified", label: "引文已核验", bodyCaptured, quoteVerified, factDraft: false, evidenceFact: false };
  }
  if (bodyCaptured) {
    return { stage: "captured", label: "正文已抓取", bodyCaptured, quoteVerified: false, factDraft: false, evidenceFact: false };
  }
  return { stage: "clue", label: "仅作线索", bodyCaptured: false, quoteVerified: false, factDraft: false, evidenceFact: false };
}

type EvidenceDraftLike = {
  id: string;
  kind: string;
  direction?: string;
  directness?: string;
  evidence_role?: string;
  source_ids?: string[];
  judgment_unit_ids?: string[];
};

function sourceTierNumber(value: SourceRecord["source_tier"]): number {
  const parsed = Number(String(value || "S8").replace(/^S/i, ""));
  return Number.isFinite(parsed) ? parsed : 8;
}

function sourceGroup(source: SourceRecord): string {
  return String(source.source_group || source.publisher || source.normalized_url || source.id);
}

function isUsableSource(source: SourceRecord) {
  return source.usability_status === "usable"
    && source.retrieval_status === "captured"
    && Boolean(source.quote_verified);
}

export function computeSourceCoverage(input: {
  sources: SourceRecord[];
  evidence: EvidenceDraftLike[];
  boundSourceIds?: Set<string>;
  requirements?: EvidenceRequirementProjection[];
  cutoffMs?: number;
}): SourceCoverageSummary {
  const { sources, evidence } = input;
  const boundSourceIds = input.boundSourceIds || new Set(
    evidence.filter((item) => item.kind !== "gap").flatMap((item) => (item.source_ids || []).map(String)),
  );
  const cutoffMs = input.cutoffMs;

  const usableSources = sources.filter((source) => {
    if (!isUsableSource(source)) return false;
    if (Number.isFinite(cutoffMs) && source.published_at && Date.parse(String(source.published_at)) > cutoffMs!) return false;
    return true;
  });
  const usableSourceById = new Map(usableSources.map((source) => [source.id, source]));

  const authority_coverage: AuthorityCoverageCell[] = CORE_AUTHORITY_TYPES.map((authority_type) => {
    const ofType = usableSources.filter((source) => (source.authority_type || "unknown") === authority_type);
    const boundOfType = ofType.filter((source) => boundSourceIds.has(source.id));
    return {
      authority_type,
      label: authorityTypeLabel(authority_type),
      required: true,
      present: ofType.length > 0,
      usable_count: ofType.length,
      bound_count: boundOfType.length,
    };
  });

  const missing_core_types = authority_coverage.filter((cell) => !cell.present).map((cell) => cell.authority_type);
  const public_secondary_count = usableSources.filter((source) => source.authority_type === "public_secondary").length;

  const requirements = input.requirements || [];
  const unitIds = [...new Set([
    ...evidence.flatMap((item) => item.judgment_unit_ids || []),
    ...requirements.flatMap((item) => item.judgment_unit_ids),
  ])];

  const unit_coverage: UnitEvidenceCoverage[] = unitIds.map((unit_id) => {
    const unitDrafts = evidence.filter((item) => (item.judgment_unit_ids || []).includes(unit_id));
    const usableDrafts = unitDrafts.filter((item) => item.kind !== "gap"
      && (item.source_ids || []).some((sourceId) => usableSourceById.has(sourceId)));
    const supportDrafts = usableDrafts.filter((item) => item.kind !== "conflict" && item.direction !== "weaken" && item.kind !== "counter");
    const counterDrafts = usableDrafts.filter((item) => item.kind === "counter" || item.direction === "weaken");
    const support_draft_count = supportDrafts.length;
    const counter_draft_count = counterDrafts.length;
    const gap_count = unitDrafts.filter((item) => item.kind === "gap").length;
    const counter_gap_count = unitDrafts.filter((item) => item.kind === "gap" && item.evidence_role === "counter").length;
    const sourceGroups = new Set<string>();
    const qualifiedGroups = new Set<string>();
    const highTierGroups = new Set<string>();
    for (const draft of usableDrafts) {
      for (const sourceId of draft.source_ids || []) {
        const source = usableSourceById.get(sourceId);
        if (!source) continue;
        const group = sourceGroup(source);
        sourceGroups.add(group);
        if (sourceTierNumber(source.source_tier) <= 6) qualifiedGroups.add(group);
        if (sourceTierNumber(source.source_tier) <= 3) highTierGroups.add(group);
      }
    }
    const unitRequirements = requirements.filter((item) => item.judgment_unit_ids.includes(unit_id));
    const minimum_independent_sources = unitRequirements.length
      ? Math.max(...unitRequirements.map((item) => item.minimum_independent_sources))
      : 1;
    const direct_fact_count = usableDrafts.filter((item) => item.directness === "direct").length;
    let ceiling = 0;
    if (usableDrafts.length && sourceGroups.size >= 1) ceiling = 1;
    if (usableDrafts.length >= 2 && qualifiedGroups.size >= 2 && direct_fact_count >= 1) ceiling = 2;
    if (usableDrafts.length >= 3 && qualifiedGroups.size >= 3 && highTierGroups.size >= 1 && direct_fact_count >= 2) ceiling = 3;
    const evidence_ceiling = `J${ceiling}` as UnitEvidenceCoverage["evidence_ceiling"];
    const counterRequired = unitRequirements.some((item) => item.evidence_role === "counter");
    const counter_check_status: UnitEvidenceCoverage["counter_check_status"] = !counterRequired
      ? "not_required"
      : counter_draft_count > 0
        ? "observed"
        : counter_gap_count > 0
          ? "gap"
          : "not_recorded";
    const weakest_link = !support_draft_count
      ? "缺少可核验的支持事实"
      : sourceGroups.size < minimum_independent_sources
        ? `独立来源组不足（${sourceGroups.size}/${minimum_independent_sources}）`
        : counterRequired && counter_check_status !== "observed"
          ? "反证方向尚未形成可核验记录"
          : gap_count > 0
            ? `${gap_count} 个证据缺口仍开放`
            : `证据侧已达到 ${evidence_ceiling}，仍待判断阶段裁决`;
    return {
      unit_id,
      requirements: unitRequirements.map((item) => ({
        id: item.id,
        requirement: item.requirement,
        evidence_role: item.evidence_role,
        minimum_independent_sources: item.minimum_independent_sources,
      })),
      support_draft_count,
      counter_draft_count,
      gap_count,
      counter_gap_count,
      usable_fact_count: usableDrafts.length,
      direct_fact_count,
      independent_source_groups: sourceGroups.size,
      minimum_independent_sources,
      meets_independence: sourceGroups.size >= minimum_independent_sources,
      has_support_evidence: support_draft_count > 0,
      has_counter_evidence: counter_draft_count > 0,
      counter_check_status,
      evidence_ceiling,
      weakest_link,
    };
  });

  const unitGapCount = unit_coverage.filter((item) => !item.has_support_evidence || !item.meets_independence).length;
  const coverage_gap_count = missing_core_types.length + unitGapCount;
  const coverage_rate = computeCoverageRate(unit_coverage, authority_coverage);
  const verification_rate = computeVerificationRate(sources);

  return {
    authority_coverage,
    missing_core_types,
    public_secondary_count,
    unit_coverage,
    coverage_gap_count,
    coverage_rate,
    verification_rate,
  };
}

function computeCoverageRate(
  unit_coverage: UnitEvidenceCoverage[],
  authority_coverage: AuthorityCoverageCell[],
): number {
  if (unit_coverage.length > 0) {
    const satisfied = unit_coverage.filter((item) => item.has_support_evidence && item.meets_independence).length;
    return satisfied / unit_coverage.length;
  }
  const present = authority_coverage.filter((item) => item.present).length;
  return present / CORE_AUTHORITY_TYPES.length;
}

function computeVerificationRate(sources: SourceRecord[]): number {
  const withUrl = sources.filter((source) => Boolean(source.url));
  if (!withUrl.length) return 0;
  const verified = withUrl.filter((source) => isUsableSource(source));
  return verified.length / withUrl.length;
}

export function evaluateEvidenceStopCondition(
  coverage: Pick<SourceCoverageSummary, "coverage_gap_count" | "coverage_rate" | "verification_rate">,
  previousGapCount?: number,
  thresholds: EvidenceStopThresholds = DEFAULT_EVIDENCE_STOP_THRESHOLDS,
): EvidenceStopEvaluation {
  if (coverage.coverage_gap_count === 0) {
    return { shouldStop: true, reason: "coverage_gap_count_zero" };
  }
  if (coverage.coverage_rate >= thresholds.coverageRate && coverage.verification_rate >= thresholds.verificationRate) {
    return { shouldStop: true, reason: "thresholds_met" };
  }
  if (previousGapCount !== undefined && coverage.coverage_gap_count >= previousGapCount) {
    return { shouldStop: true, reason: "no_gap_improvement" };
  }
  return { shouldStop: false, reason: "continue" };
}

export function suggestAuthorityTypeForGap(missing: CoreAuthorityType[]): AuthorityType | null {
  return missing[0] || null;
}
