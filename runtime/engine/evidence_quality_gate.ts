import "server-only";

/**
 * Stage 03 证据最低质量门 — 确保弱模型下不会产出空证据集
 *
 * v2 增强 (对标 governance/status_derivation.py + quality_gate_utils.py):
 * - 来源权威性分级 (source_tier: authoritative/verified/public/unverified)
 * - 证据上限跨阶段检查 (evidence × counterevidence × path_readiness → max J level)
 * - 来源多样性分析细化
 */

import type { SourceRecord } from "./types";

type EvidenceDraft = {
  id: string;
  kind?: string;
  directness?: "direct" | "indirect" | "proxy";
  source_ids?: string[];
  direction?: string;
};

type JudgmentUnit = {
  id: string;
  judgment_type?: string;
  title?: string;
};

type EvidenceGateInput = {
  evidenceDrafts: EvidenceDraft[];
  sources: SourceRecord[];
  judgmentUnits: JudgmentUnit[];
};

export type EvidenceGapDetail = {
  judgmentUnitId: string;
  judgmentType?: string;
  totalEvidence: number;
  directEvidence: number;
  sourceGroupCount: number;
  isBlocking: boolean;
  missing: string;
  suggestion: string;
};

export type EvidenceGateResult = {
  passed: boolean;
  qualityStatus: "high_quality_pass" | "minimum_pass" | "return_required" | "stop_with_gap_report";
  totalEvidence: number;
  totalSources: number;
  sourceGroups: number;
  directFacts: number;
  indirectFacts: number;
  proxyFacts: number;
  gapDetails: EvidenceGapDetail[];
  summary: string;
};

/** 最低门槛: 每个 JU 至少 1 条直接或间接事实 */
const MIN_EVIDENCE_PER_JU = 1;

/** 总体质量门槛: 总证据 < 3 且来源组 < 2 标记为需返工 */
const QUALITY_FLOOR_MIN_EVIDENCE = 3;
const QUALITY_FLOOR_MIN_GROUPS = 2;

/** "高质量通过" 门槛: 适用于正式发布 */
const HIGH_QUALITY_MIN_EVIDENCE = 5;
const HIGH_QUALITY_MIN_GROUPS = 3;
const HIGH_QUALITY_MIN_DIRECT = 2;

function sourceGroup(source: SourceRecord): string {
  const explicit = String(source.source_group || "").trim().toLowerCase();
  if (explicit) return `group:${explicit}`;
  const publisher = String(source.publisher || "").trim().toLowerCase();
  if (publisher) return `publisher:${publisher}`;
  try {
    return `host:${new URL(source.final_url || source.url).hostname.toLowerCase()}`;
  } catch {
    return `source:${source.id}`;
  }
}

function countSourceGroups(sources: SourceRecord[]): number {
  return new Set(sources.map(sourceGroup)).size;
}

export function evaluateEvidenceQuality(input: EvidenceGateInput): EvidenceGateResult {
  const { evidenceDrafts, sources, judgmentUnits } = input;
  const sourceMap = new Map(sources.map((s) => [s.id, s]));

  // 基础统计
  const allSourceIds = new Set<string>();
  const directFacts: EvidenceDraft[] = [];
  const indirectFacts: EvidenceDraft[] = [];
  const proxyFacts: EvidenceDraft[] = [];

  for (const draft of evidenceDrafts) {
    for (const sid of draft.source_ids || []) allSourceIds.add(String(sid));
    if (draft.directness === "direct") directFacts.push(draft);
    else if (draft.directness === "proxy") proxyFacts.push(draft);
    else indirectFacts.push(draft);
  }

  const boundSources = [...allSourceIds]
    .map((sid) => sourceMap.get(sid))
    .filter(Boolean) as SourceRecord[];
  const sourceGroups = countSourceGroups(boundSources);

  // 逐 JU 检查
  const gapDetails: EvidenceGapDetail[] = [];
  for (const ju of judgmentUnits) {
    const juId = String(ju.id || "");
    const juEvidence = evidenceDrafts.filter((d) => {
      // 通过 scope_ref 或 id 中包含 JU ID 来匹配
      const scopeRef = (d as any).scope_ref || "";
      return scopeRef.includes(juId) || d.id.includes(juId);
    });

    const juSources = new Set<string>();
    for (const d of juEvidence) {
      for (const sid of d.source_ids || []) juSources.add(String(sid));
    }
    const juBoundSources = [...juSources]
      .map((sid) => sourceMap.get(sid))
      .filter(Boolean) as SourceRecord[];
    const juSourceGroups = countSourceGroups(juBoundSources);
    const juDirect = juEvidence.filter((d) => d.directness === "direct").length;

    const isBlocker = juEvidence.length < MIN_EVIDENCE_PER_JU;
    if (isBlocker || juEvidence.length < 2) {
      gapDetails.push({
        judgmentUnitId: juId,
        judgmentType: ju.judgment_type,
        totalEvidence: juEvidence.length,
        directEvidence: juDirect,
        sourceGroupCount: juSourceGroups,
        isBlocking: isBlocker,
        missing: isBlocker
          ? "完全缺失证据，无法支撑任何判断"
          : "证据不足 2 条，仅供初步观察",
        suggestion: isBlocker
          ? `JU-${juId}: 需要至少 1 条直接证据，建议优先使用 ${ju.judgment_type ? methodForType(ju.judgment_type) : "MCP 数据源"}`
          : `JU-${juId}: 补充 1 条验证性证据增加来源多样性`,
      });
    }
  }

  // 判断质量状态
  const hasBlocking = gapDetails.some((d) => d.isBlocking);
  const belowFloor =
    evidenceDrafts.length < QUALITY_FLOOR_MIN_EVIDENCE || sourceGroups < QUALITY_FLOOR_MIN_GROUPS;
  const meetsHighQuality =
    evidenceDrafts.length >= HIGH_QUALITY_MIN_EVIDENCE &&
    sourceGroups >= HIGH_QUALITY_MIN_GROUPS &&
    directFacts.length >= HIGH_QUALITY_MIN_DIRECT &&
    !hasBlocking;

  let qualityStatus: EvidenceGateResult["qualityStatus"];
  let summary: string;

  if (hasBlocking) {
    qualityStatus = "return_required";
    summary = `证据不满足最低门槛：${gapDetails.filter((d) => d.isBlocking).length} 个判断单元无可用证据。总证据 ${evidenceDrafts.length} 条，来源组 ${sourceGroups}。需补证后重试。`;
  } else if (belowFloor) {
    qualityStatus = "minimum_pass";
    summary = `证据仅达最低流转标准：总证据 ${evidenceDrafts.length} 条，来源组 ${sourceGroups}，未达高质量门槛（需 >=${HIGH_QUALITY_MIN_EVIDENCE} 条）`;
  } else if (meetsHighQuality) {
    qualityStatus = "high_quality_pass";
    summary = `证据充分：总证据 ${evidenceDrafts.length} 条，${directFacts.length} 直接，${sourceGroups} 个来源组，直接事实 ${directFacts.length}>=${HIGH_QUALITY_MIN_DIRECT}`;
  } else {
    qualityStatus = "minimum_pass";
    summary = `证据基本可用：${evidenceDrafts.length} 条 / ${sourceGroups} 个来源组，存在 ${gapDetails.length} 个薄弱判断单元`;
  }

  return {
    passed: !hasBlocking,
    qualityStatus,
    totalEvidence: evidenceDrafts.length,
    totalSources: sources.length,
    sourceGroups,
    directFacts: directFacts.length,
    indirectFacts: indirectFacts.length,
    proxyFacts: proxyFacts.length,
    gapDetails,
    summary,
  };
}

/**
 * 为特定判断类型推荐最佳取证方法 (用于补证建议)
 */
function methodForType(judgmentType: string): string {
  const type = judgmentType.toLowerCase();
  if (type.includes("state") || type.includes("状态")) return "kb03:A02 状态变量测量";
  if (type.includes("trend") || type.includes("趋势")) return "kb03:A03 趋势与阶段判断";
  if (type.includes("cycle") || type.includes("周期")) return "kb03:A03 趋势与阶段判断";
  if (type.includes("mechanism") || type.includes("机制")) return "kb03:A04 机制传导验证";
  if (type.includes("attribution") || type.includes("归因")) return "kb03:A05 对象分化比较";
  if (type.includes("impact") || type.includes("影响")) return "kb03:A06 财务影响测算";
  if (type.includes("expectation") || type.includes("预期")) return "kb03:A07 市场预期与定价";
  return "kb03:A01 事实确认";
}

// =============================================================================
// v2 增强: 来源权威性分级与证据上限检查
// =============================================================================

/**
 * 来源权威性等级 — 对标 governance/02_合同/judgment_threshold_policy.yaml
 * authoritative: 官方披露/监管文件/经审计的年报
 * verified: 权威第三方/MCP 数据源/认证机构
 * public: 公开媒体/一般网络来源
 * unverified: 未验证来源/匿名/传闻
 */
export type SourceAuthorityTier = "authoritative" | "verified" | "public" | "unverified";

export const AUTHORITY_TIER_RANK: Record<SourceAuthorityTier, number> = {
  authoritative: 4,
  verified: 3,
  public: 2,
  unverified: 1,
};

const AUTHORITATIVE_PUBLISHERS = [
  "sec", "证监会", "交易所", "上交所", "深交所", "港交所",
  "公司公告", "annual report", "年报", "季报", "招股书",
  "国家统计局", "央行", "人民银行", "工信部", "发改委",
];

const VERIFIED_PUBLISHERS = [
  "通联数据", "datayes", "万得", "wind", "bloomberg", "reuters",
  "s&p", "moody", "fitch", "巨潮", "cninfo",
];

function classifySourceAuthority(source: SourceRecord): SourceAuthorityTier {
  const publisher = String(source.publisher || "").toLowerCase();
  const sourceGroup = String(source.source_group || "").toLowerCase();
  const combined = `${publisher} ${sourceGroup}`;

  if (AUTHORITATIVE_PUBLISHERS.some((p) => combined.includes(p.toLowerCase()))) {
    return "authoritative";
  }
  if (VERIFIED_PUBLISHERS.some((p) => combined.includes(p.toLowerCase()))) {
    return "verified";
  }
  // 有明确 publisher 但不在权威名单
  if (publisher && publisher.length > 3 && publisher !== "unknown") {
    return "public";
  }
  return "unverified";
}

export type AuthorityReport = {
  total: number;
  authoritative: number;
  verified: number;
  public: number;
  unverified: number;
  /** 最高权威等级 */
  maxTier: SourceAuthorityTier;
  /** 是否满足高质量要求（至少 1 authoritative + 1 verified） */
  meetsQuality: boolean;
  /** 警告 */
  warnings: string[];
};

/**
 * 评估来源权威性分布
 */
export function evaluateSourceAuthority(sources: SourceRecord[]): AuthorityReport {
  const counts: Record<SourceAuthorityTier, number> = {
    authoritative: 0,
    verified: 0,
    public: 0,
    unverified: 0,
  };

  for (const source of sources) {
    const tier = classifySourceAuthority(source);
    counts[tier]++;
  }

  let maxTier: SourceAuthorityTier = "unverified";
  if (counts.authoritative > 0) maxTier = "authoritative";
  else if (counts.verified > 0) maxTier = "verified";
  else if (counts.public > 0) maxTier = "public";

  const meetsQuality = counts.authoritative >= 1 && counts.verified >= 1;

  const warnings: string[] = [];
  if (counts.authoritative === 0) {
    warnings.push("缺少权威来源（官方披露/监管文件/审计年报），建议补充");
  }
  if (counts.verified === 0) {
    warnings.push("缺少经验证的数据源（MCP/权威第三方），建议使用通联/Wind/巨潮");
  }
  if (counts.unverified > counts.authoritative + counts.verified) {
    warnings.push("未验证来源占比过高 (>50%)，降低整体可信度");
  }

  return {
    total: sources.length,
    ...counts,
    maxTier,
    meetsQuality,
    warnings,
  };
}

// =============================================================================
// 证据上限跨阶段检查 (对标 governance/status_derivation.py derive_constraint)
// =============================================================================

type EvidenceGrade = "Q0" | "Q1" | "Q2" | "Q3" | "Q4";
type JudgmentLevel = "J0" | "J1" | "J2" | "J3" | "J4";
type CounterevidenceResult = "cleared" | "weakened" | "contested" | "decisive" | "not_checked" | "not_applicable";
type PathReadinessStatus = "ready" | "restricted" | "blocked" | "not_applicable";

const EVIDENCE_GRADE_CAPS: Record<EvidenceGrade, JudgmentLevel> = {
  Q0: "J0", Q1: "J1", Q2: "J2", Q3: "J3", Q4: "J4",
};
const COUNTEREVIDENCE_CAPS: Record<CounterevidenceResult, JudgmentLevel> = {
  cleared: "J4", weakened: "J2", contested: "J1", decisive: "J0",
  not_checked: "J1", not_applicable: "J4",
};
const PATH_READINESS_CAPS: Record<PathReadinessStatus, JudgmentLevel> = {
  ready: "J4", restricted: "J2", blocked: "J0", not_applicable: "J4",
};

const J_RANK: Record<JudgmentLevel, number> = {
  J0: 0, J1: 1, J2: 2, J3: 3, J4: 4,
};

/**
 * 唯一证据上限派生矩阵
 * max_level = min(evidence_cap, counterevidence_cap, path_readiness_cap)
 * 共 120 种组合 (5×6×4)
 */
export function deriveMaxJudgmentLevel(
  evidenceGrade: EvidenceGrade,
  counterevidenceResult: CounterevidenceResult,
  pathReadinessStatus: PathReadinessStatus,
): JudgmentLevel {
  const evidenceCap = EVIDENCE_GRADE_CAPS[evidenceGrade] || "J0";
  const counterCap = COUNTEREVIDENCE_CAPS[counterevidenceResult] || "J0";
  const pathCap = PATH_READINESS_CAPS[pathReadinessStatus] || "J0";
  const levels: JudgmentLevel[] = [evidenceCap, counterCap, pathCap];
  levels.sort((a, b) => J_RANK[a] - J_RANK[b]);
  return levels[0];
}

export type EvidenceCeilingViolation = {
  judgmentId: string;
  evidenceGrade: string;
  counterevidenceResult: string;
  pathReadiness: string;
  derivedMaxLevel: JudgmentLevel;
  actualLevel: string;
  isViolation: boolean;
  detail: string;
  suggestion: string;
};

/**
 * 检查 Stage04 判断是否超过 Stage03 证据上限
 * 对标 governance/validate_publish.py 中 "超过 03 判断上限" 的校验
 */
export function checkEvidenceCeiling(
  evidenceDraftsForJU: EvidenceDraft[],
  counterevidenceResult: CounterevidenceResult | undefined,
  pathReadiness: PathReadinessStatus | undefined,
): {
  maxLevel: JudgmentLevel;
  grade: EvidenceGrade;
  violations: EvidenceCeilingViolation[];
} {
  // 从证据质量推导 evidence_grade
  const directCount = evidenceDraftsForJU.filter((d) => d.directness === "direct").length;
  const totalCount = evidenceDraftsForJU.length;

  let grade: EvidenceGrade;
  if (totalCount === 0) grade = "Q0";
  else if (directCount >= 3 && totalCount >= 6) grade = "Q4";
  else if (directCount >= 2 && totalCount >= 4) grade = "Q3";
  else if (directCount >= 1 || totalCount >= 2) grade = "Q2";
  else grade = "Q1";

  const maxLevel = deriveMaxJudgmentLevel(
    grade,
    counterevidenceResult || "not_checked",
    pathReadiness || "not_applicable",
  );

  const violations: EvidenceCeilingViolation[] = [];
  return { maxLevel, grade, violations };
}

/**
 * 批量检查 Stage04 判断 vs Stage03 证据上限
 */
export function batchCheckEvidenceCeiling(
  judgments: Array<{
    id: string;
    strength?: string;
    evidence_refs?: string[];
    counterevidence_result?: string;
    path_readiness?: string;
  }>,
  evidenceDrafts: EvidenceDraft[],
): EvidenceCeilingViolation[] {
  const violations: EvidenceCeilingViolation[] = [];
  const evidenceMap = new Map<string, EvidenceDraft>();
  for (const ev of evidenceDrafts) {
    evidenceMap.set(String(ev.id), ev);
  }

  for (const judgment of judgments) {
    const juEvidence = (judgment.evidence_refs || [])
      .map((ref) => evidenceMap.get(String(ref)))
      .filter(Boolean) as EvidenceDraft[];

    const { maxLevel } = checkEvidenceCeiling(
      juEvidence,
      (judgment.counterevidence_result as CounterevidenceResult) || "not_checked",
      (judgment.path_readiness as PathReadinessStatus) || "not_applicable",
    );

    const actualLevel = String(judgment.strength || "J0");
    if (J_RANK[actualLevel as JudgmentLevel] > J_RANK[maxLevel]) {
      violations.push({
        judgmentId: judgment.id,
        evidenceGrade: juEvidence.length >= 5 ? "Q3+" : "Q0-Q2",
        counterevidenceResult: judgment.counterevidence_result || "not_checked",
        pathReadiness: judgment.path_readiness || "not_applicable",
        derivedMaxLevel: maxLevel,
        actualLevel,
        isViolation: true,
        detail: `判断 ${judgment.id} 强度 ${actualLevel} 超过证据上限 ${maxLevel}`,
        suggestion: `降至 ${maxLevel} 或在 Stage03 补充证据 (当前: ${juEvidence.length} 条证据)`,
      });
    }
  }

  return violations;
}
