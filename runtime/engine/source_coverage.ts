import type { EvidenceRequirementProjection } from "./structure_candidates";
import type { SourceRecord } from "./types";

export type UnitGapSourceRef = {
  id: string;
  title: string;
  failure_detail?: string;
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
  /** 无可用支持事实时的细分原因，便于工作台给出匹配动作。 */
  support_gap_kind: "none" | "unverified_bound_sources" | "no_support_draft";
  /** 已绑到本单元但未通过核验的来源。 */
  blocked_sources: UnitGapSourceRef[];
  /** 已 usable、尚未挂到本单元的候选来源。 */
  candidate_sources: UnitGapSourceRef[];
};

export type SourceCoverageSummary = {
  public_secondary_count: number;
  unit_coverage: UnitEvidenceCoverage[];
  /** 不满足支持证据或独立性的判断单元数；不以权威类型缺席计缺口。 */
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
  reason:
    | "coverage_gap_count_zero"
    | "no_gap_improvement"
    | "no_gap_improvement_but_coverage_ok"
    | "no_gap_improvement_continue"
    | "continue";
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
  evidence_requirement_ids?: string[];
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

function evidenceRole(item: EvidenceDraftLike): EvidenceRequirementProjection["evidence_role"] {
  if (["support", "counter", "context", "boundary"].includes(String(item.evidence_role || ""))) {
    return item.evidence_role as EvidenceRequirementProjection["evidence_role"];
  }
  if (item.kind === "counter" || item.kind === "conflict" || item.direction === "weaken") return "counter";
  if (item.direction === "neutral") return "context";
  return "support";
}

function toGapSourceRef(source: SourceRecord): UnitGapSourceRef {
  return {
    id: source.id,
    title: source.title || source.url || source.id,
    failure_detail: source.failure_detail ? String(source.failure_detail) : undefined,
  };
}

/**
 * 覆盖计算结果缓存（best-effort）。补证路径中 runStage03BatchSequence 会以「相同来源/证据、
 * 仅提示文案不同」的条件多次调用本函数，内循环为 O(单元×(来源+证据))。用来源覆盖相关状态 +
 * 证据 source_ids + 需求 id 的紧凑签名做 key，输入未变时直接命中，避免重复重算。
 * 来源可用性变化会改变签名 → 自然失效，不会返回陈旧覆盖。
 */
let coverageCache: { key: string; result: SourceCoverageSummary } | null = null;

function sourceCoverageSignature(source: SourceRecord): string {
  return [
    source.id,
    source.usability_status,
    source.retrieval_status,
    source.quote_verified ? 1 : 0,
    source.source_tier,
    source.source_group || source.publisher || source.normalized_url || "",
  ].join("|");
}

function buildCoverageKey(input: {
  sources: SourceRecord[];
  evidence: EvidenceDraftLike[];
  requirements?: EvidenceRequirementProjection[];
  cutoffMs?: number;
}): string {
  const src = input.sources.map(sourceCoverageSignature).sort().join(";");
  const ev = input.evidence
    .map((e) => `${e.id}:${(e.source_ids || []).slice().sort().join("|")}`)
    .sort()
    .join(";");
  const req = (input.requirements || []).map((r) => r.id).sort().join(",");
  return `${src}#${ev}#${req}#${input.cutoffMs ?? ""}`;
}

export function computeSourceCoverage(input: {
  sources: SourceRecord[];
  evidence: EvidenceDraftLike[];
  requirements?: EvidenceRequirementProjection[];
  cutoffMs?: number;
}): SourceCoverageSummary {
  const cacheKey = buildCoverageKey(input);
  if (coverageCache && coverageCache.key === cacheKey) return coverageCache.result;
  const { sources, evidence } = input;
  const cutoffMs = input.cutoffMs;
  const sourceById = new Map(sources.map((source) => [source.id, source]));

  const usableSources = sources.filter((source) => {
    if (!isUsableSource(source)) return false;
    if (Number.isFinite(cutoffMs) && source.published_at && Date.parse(String(source.published_at)) > cutoffMs!) return false;
    return true;
  });
  const usableSourceById = new Map(usableSources.map((source) => [source.id, source]));
  const public_secondary_count = usableSources.filter((source) => source.authority_type === "public_secondary").length;

  const requirements = input.requirements || [];
  const unitIds = [...new Set([
    ...evidence.flatMap((item) => item.judgment_unit_ids || []),
    ...requirements.flatMap((item) => item.judgment_unit_ids),
  ])];

  const unit_coverage: UnitEvidenceCoverage[] = unitIds.map((unit_id) => {
    const unitDrafts = evidence.filter((item) => (item.judgment_unit_ids || []).includes(unit_id));
    const nonGapDrafts = unitDrafts.filter((item) => item.kind !== "gap");
    const usableDrafts = nonGapDrafts.filter((item) => (item.source_ids || []).some((sourceId) => usableSourceById.has(sourceId)));
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
    const requirementCoverage = unitRequirements.map((requirement) => {
      const sameRoleRequirements = unitRequirements.filter((item) => item.evidence_role === requirement.evidence_role);
      const matches = unitDrafts.filter((draft) => {
        const explicit = Array.isArray(draft.evidence_requirement_ids)
          ? draft.evidence_requirement_ids.map(String)
          : [];
        if (explicit.length) return explicit.includes(requirement.id);
        return sameRoleRequirements.length === 1 && evidenceRole(draft) === requirement.evidence_role;
      });
      const usable = matches.filter((draft) =>
        draft.kind !== "gap"
        && (draft.source_ids || []).some((sourceId) => usableSourceById.has(sourceId)),
      );
      const groups = new Set<string>();
      for (const draft of usable) {
        for (const sourceId of draft.source_ids || []) {
          const source = usableSourceById.get(sourceId);
          if (source) groups.add(sourceGroup(source));
        }
      }
      return {
        requirement,
        usable,
        gaps: matches.filter((draft) => draft.kind === "gap"),
        sourceGroupCount: groups.size,
        met: usable.length > 0 && groups.size >= Math.max(1, requirement.minimum_independent_sources),
      };
    });
    const unmetRequirements = requirementCoverage.filter((item) => !item.met);
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
    const counterCoverage = requirementCoverage.filter((item) => item.requirement.evidence_role === "counter");
    const counter_check_status: UnitEvidenceCoverage["counter_check_status"] = !counterRequired
      ? "not_required"
      : counterCoverage.some((item) => item.met)
        ? "observed"
        : counterCoverage.some((item) => item.gaps.length > 0)
          ? "gap"
          : "not_recorded";

    const boundSourceIds = new Set(nonGapDrafts.flatMap((item) => (item.source_ids || []).map(String)));
    const blocked_sources: UnitGapSourceRef[] = [];
    for (const sourceId of boundSourceIds) {
      if (usableSourceById.has(sourceId)) continue;
      const source = sourceById.get(sourceId);
      if (source) blocked_sources.push(toGapSourceRef(source));
    }
    const candidate_sources = usableSources
      .filter((source) => !boundSourceIds.has(source.id))
      .slice(0, 5)
      .map(toGapSourceRef);

    let support_gap_kind: UnitEvidenceCoverage["support_gap_kind"] = "none";
    let weakest_link: string;
    const unmetMainRequirements = unmetRequirements.filter((item) =>
      item.requirement.evidence_role === "support" || item.requirement.evidence_role === "boundary",
    );
    if (unmetMainRequirements.length) {
      const first = unmetMainRequirements[0];
      if (first.usable.length > 0) {
        weakest_link = `${first.requirement.id} 独立来源组不足（${first.sourceGroupCount}/${first.requirement.minimum_independent_sources}）`;
      } else {
        support_gap_kind = nonGapDrafts.length > 0 && blocked_sources.length > 0
          ? "unverified_bound_sources"
          : "no_support_draft";
        weakest_link = `${first.requirement.id} 缺少可核验的主证据`;
      }
    } else if (!support_draft_count) {
      if (nonGapDrafts.length > 0 && blocked_sources.length > 0) {
        support_gap_kind = "unverified_bound_sources";
        weakest_link = "已有草稿，但来源引文未核验通过";
      } else {
        support_gap_kind = "no_support_draft";
        weakest_link = "缺少可核验的支持事实";
      }
    } else if (unmetRequirements.length) {
      weakest_link = `${unmetRequirements[0].requirement.id} 尚未满足：${unmetRequirements[0].requirement.requirement}`;
    } else if (gap_count > 0) {
      weakest_link = `${gap_count} 个证据缺口仍开放`;
    } else {
      weakest_link = `证据侧已达到 ${evidence_ceiling}，仍待判断阶段裁决`;
    }

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
      meets_independence: unitRequirements.length > 0
        ? requirementCoverage.every((item) => item.met)
        : sourceGroups.size >= minimum_independent_sources,
      has_support_evidence: unitRequirements.some((item) =>
        item.evidence_role === "support" || item.evidence_role === "boundary",
      )
        ? unmetMainRequirements.length === 0
        : support_draft_count > 0,
      has_counter_evidence: counter_draft_count > 0,
      counter_check_status,
      evidence_ceiling,
      weakest_link,
      support_gap_kind,
      blocked_sources,
      candidate_sources: support_gap_kind === "no_support_draft" ? candidate_sources : [],
    };
  });

  const coverage_gap_count = unit_coverage.filter((item) => !item.has_support_evidence || !item.meets_independence).length;
  const coverage_rate = computeCoverageRate(unit_coverage);
  const verification_rate = computeVerificationRate(sources);

  const result: SourceCoverageSummary = {
    public_secondary_count,
    unit_coverage,
    coverage_gap_count,
    coverage_rate,
    verification_rate,
  };
  coverageCache = { key: cacheKey, result };
  return result;
}

function computeCoverageRate(unit_coverage: UnitEvidenceCoverage[]): number {
  if (unit_coverage.length === 0) return 0;
  const satisfied = unit_coverage.filter((item) => item.has_support_evidence && item.meets_independence).length;
  return satisfied / unit_coverage.length;
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
  // 有单元缺口时不得仅凭「缺口数未降」早停；覆盖/核验已达标才允许停。
  if (previousGapCount !== undefined && coverage.coverage_gap_count >= previousGapCount) {
    if (
      coverage.coverage_rate >= thresholds.coverageRate
      && coverage.verification_rate >= thresholds.verificationRate
    ) {
      return { shouldStop: true, reason: "no_gap_improvement_but_coverage_ok" };
    }
    return { shouldStop: false, reason: "no_gap_improvement_continue" };
  }
  return { shouldStop: false, reason: "continue" };
}
