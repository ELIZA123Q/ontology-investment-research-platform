/**
 * Stage 03 证据最低质量门 — 确保弱模型下不会产出空证据集
 *
 * v2 增强 (对标 05_governance/status_derivation.py + quality_gate_utils.py):
 * - 来源权威性分级 (source_tier: authoritative/verified/public/unverified)
 * - 证据上限跨阶段检查 (evidence × counterevidence × path_readiness → max J level)
 * - 来源多样性分析细化
 */

import type { SourceRecord } from "../../schemas/types";
import { isReadableEvidenceText } from "../expression_audit/text_quality";

type EvidenceDraft = {
  id: string;
  kind?: string;
  directness?: "direct" | "indirect" | "proxy";
  source_ids?: string[];
  direction?: string;
  evidence_role?: string;
  judgment_unit_ids?: string[];
  evidence_requirement_ids?: string[];
  scope_ref?: string;
  statement?: string;
  limitations?: string[];
};

type JudgmentUnit = {
  id: string;
  judgment_type?: string;
  title?: string;
};

type EvidenceRequirementLite = {
  id?: string;
  requirement?: string;
  evidence_role?: string;
  minimum_independent_sources?: number;
  judgment_unit_ids?: string[];
};

type EvidenceGateInput = {
  evidenceDrafts: EvidenceDraft[];
  sources: SourceRecord[];
  judgmentUnits: JudgmentUnit[];
  /** Stage02 投影的逐单元证据需求；确认/生成门禁消费独立性与反证角色。 */
  evidenceRequirements?: EvidenceRequirementLite[];
};

export type EvidenceGapDetail = {
  requirementId?: string;
  judgmentUnitId: string;
  judgmentType?: string;
  totalEvidence: number;
  directEvidence: number;
  sourceGroupCount: number;
  isBlocking: boolean;
  missing: string;
  suggestion: string;
};

export type EvidenceRequirementAssessment = {
  requirement_id: string;
  judgment_unit_id: string;
  evidence_role: "support" | "counter" | "context" | "boundary";
  evidence_ids: string[];
  gap_ids: string[];
  independent_source_groups: number;
  minimum_independent_sources: number;
  status: "met" | "partial" | "missing" | "blocked";
  limitations: string[];
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
  requirementAssessments: EvidenceRequirementAssessment[];
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

type EvidenceRoleDraft = Pick<
  EvidenceDraft,
  "kind" | "evidence_role" | "direction" | "statement" | "limitations"
>;

function draftRole(draft: EvidenceRoleDraft): EvidenceRequirementAssessment["evidence_role"] {
  const explicit = String(draft.evidence_role || "");
  if (["support", "counter", "context", "boundary"].includes(explicit)) {
    // 显式 evidence_role 与 kind/direction 冲突时，以 kind 为准（LLM 常见误填）
    if (explicit === "support" && (draft.kind === "counter" || draft.kind === "conflict" || draft.direction === "weaken")) {
      return "counter";
    }
    return explicit as EvidenceRequirementAssessment["evidence_role"];
  }
  if (draft.kind === "counter" || draft.kind === "conflict" || draft.direction === "weaken") return "counter";
  if (draft.direction === "neutral") return "context";
  return "support";
}

export function documentsCounterSearch(
  draft: EvidenceRoleDraft,
): boolean {
  if (String(draft.kind || "") !== "gap" || draftRole(draft) !== "counter") return false;
  const text = [draft.statement || "", ...(draft.limitations || [])].join(" ");
  // 只有留下检索动作/范围及“未找到”的明确记录才算反证检查完成。
  // 初始 gap 底稿只有“未取得来源”，仍应触发一次补证；不能靠占位 gap 过门。
  const attempted = /检索|查询|搜索|公开来源|公告|数据库|当前权限|search|quer/i.test(text);
  const noResult = /未发现|未找到|未取得.{0,30}核验|无可核验|未检出|no\s+(?:result|evidence)|not\s+found/i.test(text);
  return attempted && noResult;
}

/**
 * 新产物必须显式绑定 ER。旧产物只在“同 JU + 同角色恰好一条 ER”时做无歧义
 * 兼容推断；存在多个候选时保持未绑定，避免一条宽泛事实替全部要求过门。
 */
function requirementIdsForDraft(
  draft: EvidenceDraft,
  requirements: EvidenceRequirementLite[],
): string[] {
  const knownIds = new Set(requirements.map((item) => String(item.id || "")).filter(Boolean));
  const explicit = Array.isArray(draft.evidence_requirement_ids)
    ? [...new Set(draft.evidence_requirement_ids.map(String).filter((id) => knownIds.has(id)))]
    : [];
  if (explicit.length) return explicit;
  const unitIds = new Set((draft.judgment_unit_ids || []).map(String));
  const role = draftRole(draft);
  const candidates = requirements.filter((requirement) =>
    String(requirement.evidence_role || "support") === role
    && (requirement.judgment_unit_ids || []).some((unitId) => unitIds.has(String(unitId))),
  );
  return candidates.length === 1 && candidates[0].id ? [String(candidates[0].id)] : [];
}

export function evaluateEvidenceQuality(input: EvidenceGateInput): EvidenceGateResult {
  const { evidenceDrafts, sources, judgmentUnits, evidenceRequirements = [] } = input;
  const usableSourceMap = new Map(
    sources
      .filter((source) =>
        source.usability_status === "usable"
        && source.retrieval_status === "captured"
        // SQLite stores booleans as 0/1. Strict `=== true` silently erased
        // every genuinely verified persisted source from the quality gate.
        && Boolean(source.quote_verified)
        && (source.source_quote === undefined || isReadableEvidenceText(source.source_quote)),
      )
      .map((source) => [source.id, source]),
  );

  // gap 不算「可用证据」；不得用缺口条数抬高质量门槛
  const nonGapDrafts = evidenceDrafts.filter((d) => String(d.kind || "") !== "gap");
  const usableDrafts = nonGapDrafts.filter((draft) =>
    (draft.source_ids || []).some((sourceId) => usableSourceMap.has(String(sourceId))),
  );
  const gapDrafts = evidenceDrafts.filter((d) => String(d.kind || "") === "gap");
  const gapOnlyCount = gapDrafts.length;
  const requirementIdsByDraft = new Map(
    evidenceDrafts.map((draft) => [draft.id, requirementIdsForDraft(draft, evidenceRequirements)]),
  );

  // 基础统计（仅非 gap）
  const allSourceIds = new Set<string>();
  const directFacts: EvidenceDraft[] = [];
  const indirectFacts: EvidenceDraft[] = [];
  const proxyFacts: EvidenceDraft[] = [];

  for (const draft of usableDrafts) {
    for (const sid of draft.source_ids || []) allSourceIds.add(String(sid));
    if (draft.directness === "direct") directFacts.push(draft);
    else if (draft.directness === "proxy") proxyFacts.push(draft);
    else indirectFacts.push(draft);
  }

  const boundSources = [...allSourceIds]
    .map((sid) => usableSourceMap.get(sid))
    .filter(Boolean) as SourceRecord[];
  const sourceGroups = countSourceGroups(boundSources);

  // 逐 ER 检查。取证任务和质量门必须在同一粒度闭环，不能退化为“JU 有材料即可”。
  const gapDetails: EvidenceGapDetail[] = [];
  const requirementAssessments: EvidenceRequirementAssessment[] = [];
  const blockingRequirementIds = new Set<string>();
  for (const [index, requirement] of evidenceRequirements.entries()) {
    const requirementId = String(requirement.id || `ER-UNRESOLVED-${index + 1}`);
    const unitIds = (requirement.judgment_unit_ids || []).map(String).filter(Boolean);
    const unitId = unitIds[0] || "JU-UNRESOLVED";
    const role = (["support", "counter", "context", "boundary"].includes(String(requirement.evidence_role || ""))
      ? String(requirement.evidence_role)
      : "support") as EvidenceRequirementAssessment["evidence_role"];
    const minimumSources = Math.max(1, Number(requirement.minimum_independent_sources || 1) || 1);
    const evidence = usableDrafts.filter((draft) =>
      (requirementIdsByDraft.get(draft.id) || []).includes(requirementId)
      && draftRole(draft) === role,
    );
    const gaps = gapDrafts.filter((draft) =>
      (requirementIdsByDraft.get(draft.id) || []).includes(requirementId),
    );
    const sourceIds = new Set(evidence.flatMap((draft) => (draft.source_ids || []).map(String)));
    const sourceGroupsForRequirement = countSourceGroups(
      [...sourceIds].map((sourceId) => usableSourceMap.get(sourceId)).filter(Boolean) as SourceRecord[],
    );
    const enoughSources = evidence.length > 0 && sourceGroupsForRequirement >= minimumSources;
    const ambiguousUnitBinding = unitIds.length !== 1;
    const documentedCounterGap = role === "counter" && gaps.some(documentsCounterSearch);
    const status: EvidenceRequirementAssessment["status"] = ambiguousUnitBinding
      ? "blocked"
      : enoughSources
        ? "met"
        : evidence.length > 0
          ? "partial"
          : gaps.length > 0
            ? documentedCounterGap ? "partial" : "missing"
            : "blocked";
    const limitations = [
      ...(ambiguousUnitBinding ? ["一条 EvidenceRequirement 必须且只能绑定一个 JudgmentUnit"] : []),
      ...(evidence.length && !enoughSources
        ? [`独立来源组不足（${sourceGroupsForRequirement}/${minimumSources}）`]
        : []),
      ...(!evidence.length && gaps.length
        ? [role === "counter"
          ? documentedCounterGap
            ? "反证检索已完成并显式登记为 gap；当前范围内未取得可核验反证材料"
            : "反证要求已显式登记为 gap，但尚未留下完整检索记录"
          : "已显式登记缺口，尚未取得可核验证据"]
        : []),
      ...(!evidence.length && !gaps.length
        ? [role === "counter"
          ? "结构要求的反证角色未登记（需 counter/conflict 或显式 gap）"
          : "既无匹配证据，也无显式缺口登记"]
        : []),
    ];
    requirementAssessments.push({
      requirement_id: requirementId,
      judgment_unit_id: unitId,
      evidence_role: role,
      evidence_ids: evidence.map((draft) => draft.id),
      gap_ids: gaps.map((draft) => draft.id),
      independent_source_groups: sourceGroupsForRequirement,
      minimum_independent_sources: minimumSources,
      status,
      limitations,
    });
    const blocksMinimum = ambiguousUnitBinding
      || ((role === "support" || role === "boundary") && status !== "met")
      || (role === "counter" && status === "blocked");
    if (blocksMinimum) blockingRequirementIds.add(requirementId);
    if (status !== "met") {
      gapDetails.push({
        requirementId,
        judgmentUnitId: unitId,
        judgmentType: judgmentUnits.find((unit) => String(unit.id) === unitId)?.judgment_type,
        totalEvidence: evidence.length,
        directEvidence: evidence.filter((draft) => draft.directness === "direct").length,
        sourceGroupCount: sourceGroupsForRequirement,
        isBlocking: blocksMinimum,
        missing: limitations.join("；") || "证据要求尚未满足",
        suggestion: `${requirementId}: 按该 ER 的主体、时间、口径和角色补取可核验原文；不得用同 JU 的其他材料替代`,
      });
    }
  }

  // 再做 JU 兜底检查：即使旧结构没有 ER，也不能让判断单元空转。
  for (const ju of judgmentUnits) {
    const juId = String(ju.id || "");
    const juEvidence = usableDrafts.filter((d) => draftBelongsToJudgmentUnit(d, juId));
    const juRequirements = evidenceRequirements.filter((req) =>
      (Array.isArray(req.judgment_unit_ids) ? req.judgment_unit_ids.map(String) : []).includes(juId),
    );
    const juSources = new Set<string>();
    for (const d of juEvidence) {
      for (const sid of d.source_ids || []) juSources.add(String(sid));
    }
    const juBoundSources = [...juSources]
      .map((sid) => usableSourceMap.get(sid))
      .filter(Boolean) as SourceRecord[];
    const juSourceGroups = countSourceGroups(juBoundSources);
    const juDirect = juEvidence.filter((d) => d.directness === "direct").length;
    const missingSupport = juEvidence.length < MIN_EVIDENCE_PER_JU;
    const missingRequirements = juRequirements.length === 0;
    // 旧结构缺 ER 时仍按 JU 做兼容兜底；有可用事实就不把“结构缺 ER”
    // 误判为证据缺失。新正式产物会在 Stage02 门禁处直接阻止缺 ER。
    const isBlocker = missingSupport;
    if (isBlocker || juEvidence.length < 2) {
      const missingParts = [
        missingSupport ? "完全缺失可用证据（gap 不计），无法支撑任何判断" : "",
        missingRequirements ? "Stage02 未提供该单元的原子 EvidenceRequirement" : "",
        !isBlocker ? "可用证据不足 2 条，仅供初步观察" : "",
      ].filter(Boolean);
      gapDetails.push({
        judgmentUnitId: juId,
        judgmentType: ju.judgment_type,
        totalEvidence: juEvidence.length,
        directEvidence: juDirect,
        sourceGroupCount: juSourceGroups,
        isBlocking: isBlocker,
        missing: missingParts.join("；") || "证据薄弱",
        suggestion: isBlocker
          ? `JU-${juId}: ${missingParts[0]}；建议优先按 ${ju.judgment_type ? methodForType(ju.judgment_type) : "B01/B03 推荐主源"} 取公开原文，经注册通道或 Web 回退获取并核验`
          : `JU-${juId}: 补充 1 条验证性证据增加来源多样性`,
      });
    }
  }

  // 判断质量状态（条数门槛只看可用证据）
  const hasBlocking = blockingRequirementIds.size > 0
    || gapDetails.some((detail) => detail.isBlocking && !detail.requirementId);
  const hasOpenCounterGap = requirementAssessments.some((assessment) =>
    assessment.evidence_role === "counter" && (assessment.status === "missing" || assessment.status === "blocked"),
  );
  const belowFloor =
    usableDrafts.length < QUALITY_FLOOR_MIN_EVIDENCE || sourceGroups < QUALITY_FLOOR_MIN_GROUPS;
  const meetsHighQuality =
    usableDrafts.length >= HIGH_QUALITY_MIN_EVIDENCE &&
    sourceGroups >= HIGH_QUALITY_MIN_GROUPS &&
    directFacts.length >= HIGH_QUALITY_MIN_DIRECT &&
    !hasBlocking &&
    !hasOpenCounterGap;

  let qualityStatus: EvidenceGateResult["qualityStatus"];
  let summary: string;

  if (hasBlocking) {
    qualityStatus = "return_required";
    summary = `证据不满足最低门槛：${gapDetails.filter((d) => d.isBlocking).length} 个判断单元无可用证据。可用证据 ${usableDrafts.length} 条（另有 gap ${gapOnlyCount}），来源组 ${sourceGroups}。需补证后重试。`;
  } else if (belowFloor) {
    qualityStatus = "minimum_pass";
    summary = `证据仅达最低流转标准：可用证据 ${usableDrafts.length} 条，来源组 ${sourceGroups}，未达高质量门槛（需 >=${HIGH_QUALITY_MIN_EVIDENCE} 条非 gap）`;
  } else if (meetsHighQuality) {
    qualityStatus = "high_quality_pass";
    summary = `证据充分：可用证据 ${usableDrafts.length} 条，${directFacts.length} 直接，${sourceGroups} 个来源组，直接事实 ${directFacts.length}>=${HIGH_QUALITY_MIN_DIRECT}`;
  } else {
    qualityStatus = "minimum_pass";
    summary = `证据基本可用：${usableDrafts.length} 条非 gap / ${sourceGroups} 个来源组，存在 ${gapDetails.length} 个薄弱判断单元`;
  }

  return {
    passed: !hasBlocking,
    qualityStatus,
    totalEvidence: usableDrafts.length,
    totalSources: sources.length,
    sourceGroups,
    directFacts: directFacts.length,
    indirectFacts: indirectFacts.length,
    proxyFacts: proxyFacts.length,
    gapDetails,
    requirementAssessments,
    summary,
  };
}

function draftBelongsToJudgmentUnit(draft: EvidenceDraft, juId: string): boolean {
  if (!juId) return false;
  const unitIds = Array.isArray((draft as any).judgment_unit_ids)
    ? (draft as any).judgment_unit_ids.map(String)
    : [];
  if (unitIds.includes(juId)) return true;
  const scopeRef = String((draft as any).scope_ref || "");
  if (scopeRef.includes(juId)) return true;
  return String(draft.id || "").includes(juId);
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
 * 来源权威性等级 — 对标 90_compat/governance_mirrors/contracts/judgment_threshold_policy.yaml
 * authoritative: 官方披露/监管文件/经审计的年报
 * verified: 权威第三方/经核验的一手公开原文生产者/认证机构
 * （MCP 是获取通道，不是来源等级）
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
// 证据上限跨阶段检查 (对标 05_governance/status_derivation.py derive_constraint)
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
 * 对标 05_governance/validate_publish.py 中 "超过 03 判断上限" 的校验
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
