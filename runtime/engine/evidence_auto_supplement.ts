import type { ResearchModelClient } from "../adapters/deepseek";
import { listSources, normalizeUrl, upsertSource } from "../adapters/db";
import {
  expandAffectedObjectRefs,
  mergeStage03Patch,
  normalizeStage03Patch,
  objectId,
  type Stage03Patch,
} from "./change_set";
import { captureSourceSnapshot } from "./source_snapshot";
import { computeSourceCoverage } from "./source_coverage";
import type { EvidenceRequirementProjection } from "./structure_candidates";
import type { SourceRecord } from "./types";
import { controlledEvidencePatchSchema } from "./revise_schemas";
import { repairEvidencePreparationDraft } from "./workflow_projections";
import {
  demoteUnverifiedEvidenceDrafts,
  normalizeEvidenceDraftNulls,
} from "./evidence_draft_normalize";
import { schemas } from "./schemas";
import { promptForEvidenceSupplement } from "./prompts";
import {
  evidenceJudgmentTypeCardsForPrompt,
  evidenceMethodIdsFromApplications,
  loadSelectedMethodGuidance,
  mcpChannelHintsForPrompt,
} from "./method_guidance";
import { CONTEXT_SLOT_BUDGETS } from "./context_assembler";
import {
  buildCapturePriorityKeys,
  buildSupplementBrief,
  findUnchangedEvidenceIds,
  orderByCapturePriority,
  applyRegistryFreezeFields,
  syncStage03DraftSourcesFromRegistry,
  dedupeStage03DraftSources,
  selectEvidenceSnapshotExcerpt,
} from "./evidence_supplement_pure";

export {
  buildCapturePriorityKeys,
  buildSupplementBrief,
  buildSupplementCoverage,
  evidenceFingerprint,
  findUnchangedEvidenceIds,
  orderByCapturePriority,
  applyRegistryFreezeFields,
  syncStage03DraftSourcesFromRegistry,
  dedupeStage03DraftSources,
  selectEvidenceSnapshotExcerpt,
} from "./evidence_supplement_pure";

/**
 * Source Registry 是抓取冻结字段的唯一权威。
 * 补证/重新取得来源/upsert 拒绝降级后，草稿常残留旧 locator/quote/captured_at，
 * 确认时会被校验打成「与 Source Registry 不一致」。确认前与抓取后都必须投影回草稿。
 */
export function stage03AutoSupplementMaxRounds(): number {
  const raw = process.env.STAGE03_AUTO_SUPPLEMENT_MAX_ROUNDS;
  const parsed = raw ? Number(raw) : 3;
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 3;
}

export type Stage03EvidenceBatch = {
  batch_id: string;
  unit_ids: string[];
  requirements: EvidenceRequirementProjection[];
};

/**
 * Stage03 不再把全部判断单元压进一次工具环。批次上限不是丢弃上限：
 * 当单元很多时自动增大每批大小，确保所有单元仍被覆盖。
 */
export function partitionStage03EvidenceBatches(input: {
  judgmentUnitIds: string[];
  requirements?: EvidenceRequirementProjection[];
  preferredUnitsPerBatch?: number;
  maxBatches?: number;
}): Stage03EvidenceBatch[] {
  const unitIds = [...new Set(input.judgmentUnitIds.map(String).filter(Boolean))];
  if (!unitIds.length) return [];
  const preferred = Math.max(1, Math.floor(input.preferredUnitsPerBatch || 2));
  const maxBatches = Math.max(1, Math.floor(input.maxBatches || 4));
  const unitsPerBatch = Math.max(preferred, Math.ceil(unitIds.length / maxBatches));
  const requirements = input.requirements || [];
  const batches: Stage03EvidenceBatch[] = [];
  for (let index = 0; index < unitIds.length; index += unitsPerBatch) {
    const selected = unitIds.slice(index, index + unitsPerBatch);
    const selectedSet = new Set(selected);
    batches.push({
      batch_id: `EB-${String(batches.length + 1).padStart(2, "0")}`,
      unit_ids: selected,
      requirements: requirements.filter((item) =>
        item.judgment_unit_ids.some((id) => selectedSet.has(String(id))),
      ),
    });
  }
  return batches;
}

export function stage03EvidenceBatchConfig() {
  const unitsRaw = Number(process.env.STAGE03_EVIDENCE_UNITS_PER_BATCH || 2);
  const batchesRaw = Number(process.env.STAGE03_EVIDENCE_MAX_BATCHES || 4);
  return {
    preferredUnitsPerBatch: Number.isFinite(unitsRaw) && unitsRaw > 0 ? Math.floor(unitsRaw) : 2,
    maxBatches: Number.isFinite(batchesRaw) && batchesRaw > 0 ? Math.floor(batchesRaw) : 4,
  };
}

export function stage03AcquisitionCallCount(toolUsage: unknown): number {
  if (!toolUsage || typeof toolUsage !== "object" || Array.isArray(toolUsage)) return 0;
  const usage = toolUsage as Record<string, unknown>;
  return ["web_search_calls", "public_page_fetch_calls", "mcp_evidence_calls", "runtime_preacquired_sources"]
    .reduce((sum, key) => {
      const value = Number(usage[key] || 0);
      return sum + (Number.isFinite(value) && value > 0 ? value : 0);
    }, 0);
}

function stage03ModelAcquisitionCallCount(toolUsage: unknown): number {
  if (!toolUsage || typeof toolUsage !== "object" || Array.isArray(toolUsage)) return 0;
  const usage = toolUsage as Record<string, unknown>;
  return ["web_search_calls", "public_page_fetch_calls", "mcp_evidence_calls"]
    .reduce((sum, key) => sum + Math.max(0, Number(usage[key] || 0) || 0), 0);
}

export function buildStage03AcquisitionQueries(input: {
  question: string;
  requirements?: EvidenceRequirementProjection[];
  targetUnitIds?: string[];
  maxQueries?: number;
}): string[] {
  const target = new Set((input.targetUnitIds || []).map(String));
  const requirements = (input.requirements || [])
    .filter((item) => !target.size || item.judgment_unit_ids.some((id) => target.has(String(id))))
    .sort((a, b) => a.id.localeCompare(b.id));
  const question = String(input.question || "").replace(/\s+/g, " ").trim().slice(0, 180);
  const maxQueries = Math.max(1, Math.min(4, Math.floor(input.maxQueries || 4)));
  const support = requirements.filter((item) => item.evidence_role !== "counter");
  const counter = requirements.filter((item) => item.evidence_role === "counter");
  const balanced = [
    support[0],
    ...(maxQueries > 1 ? [counter[0]] : []),
    ...support.slice(1),
    ...counter.slice(1),
  ].filter((item): item is EvidenceRequirementProjection => Boolean(item));
  const queries = balanced.map((item) => {
    const requirement = item.requirement.replace(/\s+/g, " ").trim().slice(0, 180);
    const translated = semiconductorSearchKeywords(requirement, item.evidence_role);
    // 顶层 EvidenceRequirement 是研究语言，不是检索语言。半导体场景优先压缩为
    // 英文产品/指标词，保留年份和一手/行业来源提示；未命中词典时才回退中文。
    return translated || `${requirement} 数据 原文`.trim().slice(0, 240);
  });
  if (!queries.length && question) queries.push(`${question} 数据 原文`);
  return [...new Set(queries)].slice(0, maxQueries);
}

export function semiconductorSearchKeywords(
  requirement: string,
  role: EvidenceRequirementProjection["evidence_role"] = "support",
): string {
  const text = String(requirement || "");
  const isDisplacement = /转换|挤占|挤压|晶圆面积占比|HBM晶圆投片/i.test(text);
  const product = /企业级\s*(?:SSD|NAND)|enterprise/i.test(text)
    ? "enterprise SSD NAND"
    : /消费级\s*(?:SSD|NAND)|客户端\s*SSD|UFS|client/i.test(text)
      ? "client SSD NAND UFS"
      : /通用\s*DRAM|非\s*HBM\s*DRAM/i.test(text)
        ? "conventional DRAM"
        : isDisplacement && /HBM/i.test(text) && /DRAM/i.test(text)
          ? "HBM DRAM"
        : /HBM/i.test(text)
          ? "HBM"
          : /DRAM/i.test(text)
            ? "DRAM"
            : /NAND|SSD/i.test(text) ? "NAND SSD" : "";
  const terms: string[] = [];
  const add = (term: string) => {
    if (term && !terms.includes(term)) terms.push(term);
  };
  const mappings: Array<[RegExp, string]> = [
    [/合约价/i, "contract price"],
    [/现货价/i, "spot price"],
    [/报价|价格|涨价|跌幅/i, "pricing"],
    [/库存天数|库存/i, "inventory"],
    [/渠道/i, "channel inventory"],
    [/客户/i, "customer inventory"],
    [/AI\s*系统|AI\s*服务器|加速卡/i, "AI server accelerator shipments"],
    [/终端出货|PC|手机|笔记本/i, "PC smartphone shipments"],
    [/资本开支|数据中心/i, "data center capex"],
    [/晶圆投片|晶圆投入|晶圆面积|晶圆厂/i, "wafer allocation"],
    [/产能利用率|有效产出|产能/i, "capacity utilization"],
    [/良率/i, "yield"],
    [/封装|CoWoS/i, "advanced packaging capacity"],
    [/代际切换|层数|die|世代/i, "generation transition die density"],
    [/减产/i, "production cuts"],
    [/需求下修|需求持续低迷|需求转弱|部署受限/i, "demand slowdown"],
    [/订单|覆盖期|长协/i, "orders"],
    [/转换|挤占|挤压/i, "capacity conversion displacement"],
    [/促销/i, "promotion"],
  ];
  for (const [pattern, term] of mappings) {
    if (pattern.test(text)) add(term);
  }
  if (!product && !terms.length) return "";
  const preferredSite = product === "HBM DRAM"
    ? role === "support" ? "site:investors.micron.com" : "site:trendforce.com"
    : product.startsWith("HBM")
    ? role === "support" ? "site:news.samsung.com" : "site:trendforce.com"
    : product.startsWith("conventional DRAM") || product === "DRAM"
      ? role === "support" ? "site:investors.micron.com" : "site:trendforce.com"
      : product.startsWith("enterprise")
        ? role === "support" ? "site:investor.sandisk.com" : "site:trendforce.com"
        : product.startsWith("client")
          ? role === "support" ? "site:trendforce.com" : "site:counterpointresearch.com"
          : role === "support" ? "site:investors.micron.com" : "site:trendforce.com";
  const hasPricing = terms.some((term) => ["contract price", "spot price", "pricing"].includes(term));
  const hasInventory = terms.some((term) => term.includes("inventory"));
  const hasDemand = terms.some((term) =>
    ["demand slowdown", "AI server accelerator shipments", "PC smartphone shipments", "data center capex", "orders"].includes(term),
  );
  const hasCapacity = terms.some((term) =>
    ["wafer allocation", "capacity utilization", "yield", "advanced packaging capacity", "capacity conversion displacement"].includes(term),
  );
  // 搜索引擎对把整个 EvidenceRequirement 塞进 query 的召回很差。
  // 这里保留产品、来源、年份和至多两个判别维度；详细指标仍留在
  // EvidenceRequirement 与模型取证 brief 中，不因压缩检索式而丢失。
  const dimensions = [
    ...(hasPricing ? ["pricing"] : []),
    ...(hasInventory ? ["inventory"] : []),
    ...(hasDemand ? [role === "counter" ? "demand slowdown" : "demand"] : []),
    ...(hasCapacity ? ["capacity"] : []),
  ].slice(0, 2);
  const canonical = product === "HBM DRAM"
    ? ["HBM", "DRAM", "wafer", "capacity"]
    : product.startsWith("HBM")
      ? role === "support" ? ["HBM4", "mass production"] : ["HBM", "demand", "inventory"]
      : product.startsWith("conventional DRAM")
        ? role === "support" ? ["DRAM", "supply", "inventory"] : ["DRAM", "contract price", "inventory"]
        : product === "DRAM"
          ? [
              "DRAM",
              terms.includes("contract price") ? "contract price" : hasPricing ? "pricing" : "supply",
              hasInventory ? "inventory" : role === "counter" ? "demand slowdown" : "demand",
            ]
        : product.startsWith("enterprise")
          ? role === "support" ? ["enterprise SSD", "demand"] : ["enterprise SSD", "inventory"]
          : product.startsWith("client")
            ? role === "support" ? ["client SSD", "NAND", "price"] : ["smartphone", "PC", "demand"]
            : dimensions;
  return [...new Set([preferredSite, ...canonical, "2026"])]
    .join(" ")
    .slice(0, 180);
}

function governedDiscoveredSource(url: string): {
  sourceTier: "S2" | "S4";
  authorityType: "company_disclosure" | "industry_provider";
  sourceType: "company_disclosure" | "industry_research";
} | undefined {
  let host = "";
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return undefined; }
  const companyHosts = [
    "investors.micron.com",
    "news.samsung.com",
    "news.skhynix.com",
    "news.skhynix.com.cn",
    "investor.sandisk.com",
  ];
  if (companyHosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`))) {
    return { sourceTier: "S2", authorityType: "company_disclosure", sourceType: "company_disclosure" };
  }
  const industryHosts = ["trendforce.com", "counterpointresearch.com"];
  if (industryHosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`))) {
    return { sourceTier: "S4", authorityType: "industry_provider", sourceType: "industry_research" };
  }
  return undefined;
}

export function selectFrozenStage03CandidateSources(input: {
  sources: SourceRecord[];
  requirements?: EvidenceRequirementProjection[];
  maxCandidates?: number;
}) {
  const requirementText = (input.requirements || []).map((item) => item.requirement).join(" ");
  const primaryProductTokens = [
    ...(/HBM/i.test(requirementText) ? ["hbm"] : []),
    ...(/通用\s*DRAM|非\s*HBM\s*DRAM|DRAM/i.test(requirementText) ? ["dram"] : []),
    ...(/NAND|SSD|UFS/i.test(requirementText) ? ["nand", "ssd", "ufs"] : []),
  ];
  const segmentTokens = [
    ...(/企业级/i.test(requirementText) ? ["enterprise", "datacenter"] : []),
    ...(/消费级|客户端/i.test(requirementText) ? ["client", "consumer"] : []),
    ...(/手机/i.test(requirementText) ? ["smartphone", "mobile"] : []),
    ...(/PC|笔记本/i.test(requirementText) ? ["pc", "notebook"] : []),
  ];
  const evidenceTokens = [
    ...(/库存/i.test(requirementText) ? ["inventory"] : []),
    ...(/价格|报价|合约价|现货价/i.test(requirementText) ? ["price", "pricing", "contract", "spot"] : []),
    ...(/需求|出货|部署|订单/i.test(requirementText) ? ["demand", "shipment", "shipments", "orders"] : []),
    ...(/供给|产能|投片|产出|挤占|转换/i.test(requirementText) ? ["supply", "capacity", "wafer", "output"] : []),
    ...(/良率/i.test(requirementText) ? ["yield"] : []),
  ];
  const scored = input.sources
    .filter((source) => source.usability_status !== "rejected")
    .filter((source) => String(source.snapshot_text || "").length >= 200)
    .map((source) => {
      const relevantWindow = selectEvidenceSnapshotExcerpt({
        snapshotText: source.snapshot_text || "",
        title: source.title,
        requirements: input.requirements,
        maxChars: 5_000,
      });
      const haystack = `${source.title} ${source.search_excerpt} ${relevantWindow}`.toLowerCase();
      const primaryProductScore = primaryProductTokens.reduce(
        (sum, token) => sum + Math.min(5, haystack.split(token).length - 1) * 8,
        0,
      );
      const segmentScore = segmentTokens.reduce(
        (sum, token) => sum + Math.min(5, haystack.split(token).length - 1) * 3,
        0,
      );
      const evidenceScore = evidenceTokens.reduce(
        (sum, token) => sum + Math.min(5, haystack.split(token).length - 1) * 2,
        0,
      );
      const tierBonus = source.source_tier === "S2" ? 5 : source.source_tier === "S4" ? 3 : 0;
      return {
        source,
        primaryProductScore,
        score: primaryProductScore + segmentScore + evidenceScore + tierBonus,
      };
    })
    // 来源等级只能给“已命中本批研究对象”的候选加权，不能让一个完全
    // 无关但等级高的页面挤进付费模型上下文。
    .filter((item) => item.primaryProductScore > 0)
    .sort((left, right) => right.score - left.score || left.source.id.localeCompare(right.source.id));
  const maxCandidates = Math.max(1, Math.min(10, Math.floor(input.maxCandidates || 6)));
  const selected: SourceRecord[] = [];
  const groups = new Set<string>();
  for (const item of scored) {
    const group = String(item.source.source_group || item.source.publisher || item.source.normalized_url);
    if (groups.has(group)) continue;
    selected.push(item.source);
    groups.add(group);
    if (selected.length >= maxCandidates) return selected;
  }
  for (const item of scored) {
    if (selected.includes(item.source)) continue;
    selected.push(item.source);
    if (selected.length >= maxCandidates) break;
  }
  return selected;
}

export function materializeFrozenStage03CandidateDrafts(input: {
  sources: SourceRecord[];
  requirements?: EvidenceRequirementProjection[];
  existingDraftSources?: any[];
  maxQuoteChars?: number;
}) {
  const existingBySourceId = new Map(
    (input.existingDraftSources || [])
      .filter((source: any) => source?.source_id && source?.source_key)
      .map((source: any) => [String(source.source_id), source]),
  );
  return input.sources.flatMap((source) => {
    if (!source.published_at || !source.source_tier || !source.source_type) return [];
    const prior = existingBySourceId.get(source.id);
    const sourceKey = String(prior?.source_key || `SRC-R-${source.id.replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase()}`);
    const selectedQuote = source.quote_verified && String(source.source_quote || "").trim()
      ? String(source.source_quote).trim()
      : selectEvidenceSnapshotExcerpt({
        snapshotText: source.snapshot_text || "",
        title: source.title,
        requirements: input.requirements,
        maxChars: input.maxQuoteChars || 1_200,
      }).trim();
    if (selectedQuote.length < 20) return [];
    return [{
      source_id: source.id,
      source_key: sourceKey,
      url: source.url,
      title: source.title,
      publisher: source.publisher,
      published_at: source.published_at,
      source_tier: source.source_tier,
      authority_type: source.authority_type || "unknown",
      source_type: source.source_type,
      search_excerpt: source.search_excerpt || "",
      locator: source.locator || source.final_url || source.url,
      source_quote: selectedQuote,
      captured_at: source.captured_at || null,
      content_hash: source.content_hash || null,
      final_url: source.final_url || source.url,
      retrieval_status: source.retrieval_status || null,
      quote_verified: Boolean(source.quote_verified),
    }];
  });
}

export async function preAcquireStage03CandidateSources(input: {
  runId: string;
  question: string;
  requirements?: EvidenceRequirementProjection[];
  targetUnitIds?: string[];
  existingSources: SourceRecord[];
  maxSourceCount?: number;
  search?: (
    args: Record<string, unknown>,
    citations: Array<{ url: string; title: string }>,
  ) => Promise<{ results: Array<Record<string, unknown>> }>;
}) {
  const queries = buildStage03AcquisitionQueries(input);
  const activeExistingSourceCount = input.existingSources.filter((source) => source.usability_status !== "rejected").length;
  const availableBudget = input.maxSourceCount === undefined
    ? 4
    : Math.max(0, input.maxSourceCount - activeExistingSourceCount);
  const sourceBudget = Math.min(4, availableBudget);
  if (!queries.length || sourceBudget < 1) {
    return { queries, sources: [] as SourceRecord[], error: sourceBudget < 1 ? "来源预算已用尽" : "" };
  }
  try {
    const search = input.search || (await import("../adapters/deepseek")).searchPublicWeb;
    const discovered = await search(
      { queries, limit_per_query: Math.min(2, sourceBudget) },
      [],
    );
    const priorUrls = new Set(input.existingSources.map((source) => source.normalized_url));
    const sources: SourceRecord[] = [];
    const discoveredResults = discovered.results || [];
    const firstByQuery = new Map<string, Record<string, unknown>>();
    for (const result of discoveredResults) {
      const query = String(result.query || "");
      if (queries.includes(query) && !firstByQuery.has(query)) firstByQuery.set(query, result);
    }
    const selectedFirsts = queries
      .map((query) => firstByQuery.get(query))
      .filter((item): item is Record<string, unknown> => Boolean(item));
    const diversifiedResults = [
      ...selectedFirsts,
      ...discoveredResults.filter((item) => !selectedFirsts.includes(item)),
    ];
    for (const result of diversifiedResults) {
      if (sources.length >= sourceBudget) break;
      let normalizedUrl = "";
      try { normalizedUrl = normalizeUrl(String(result.url || "")); } catch { continue; }
      if (!normalizedUrl || priorUrls.has(normalizedUrl)) continue;
      const governed = governedDiscoveredSource(normalizedUrl);
      if (!governed) continue;
      priorUrls.add(normalizedUrl);
      let publisher = "公开网页";
      try { publisher = new URL(normalizedUrl).hostname.replace(/^www\./, ""); } catch { /* keep fallback */ }
      const excerpt = String(result.content_excerpt || "");
      const captured = excerpt.length > 0 && String(result.retrieval_status || "") !== "failed";
      sources.push(upsertSource(input.runId, {
        url: normalizedUrl,
        title: String(result.title || normalizedUrl),
        publisher,
        published_at: result.published_at ? String(result.published_at) : null,
        source_type: governed.sourceType,
        source_tier: governed.sourceTier,
        authority_type: governed.authorityType,
        search_excerpt: String(result.summary || ""),
        locator: String(result.locator_hint || result.final_url || normalizedUrl),
        captured_at: new Date().toISOString(),
        content_hash: String(result.content_hash || ""),
        usability_status: captured ? "limited" : "rejected",
        failure_category: captured ? "" : "source_acquisition_failure",
        failure_detail: String(result.retrieval_error || (captured ? "候选正文待逐字摘录核验" : "候选正文抓取失败")),
        final_url: String(result.final_url || normalizedUrl),
        content_mime: "text/html",
        http_status: null,
        retrieval_status: captured ? "limited" : "failed",
        snapshot_text: excerpt,
        source_quote: "",
        quote_verified: false,
      }));
    }
    return { queries, sources, error: "" };
  } catch (error) {
    return {
      queries,
      sources: [] as SourceRecord[],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 模型没有调用任何取证工具时，patch 只能表达“仍有缺口”，不能创造来源或事实。
 * 已有非 gap 事实的修改会被丢弃以避免误伤已核验证据；新事实/旧 gap 则显式退化为 gap。
 */
export function enforceStage03AcquisitionHonesty(input: {
  patch: Stage03Patch;
  baseData: any;
  toolUsage: unknown;
  targetUnitIds?: string[];
  runtimeAcquiredSourceUrls?: string[];
}): Stage03Patch {
  const normalized = normalizeStage03Patch(structuredClone(input.patch));
  if (stage03ModelAcquisitionCallCount(input.toolUsage) > 0) return normalized;
  const runtimeUrls = new Set((input.runtimeAcquiredSourceUrls || []).flatMap((url) => {
    try { return [normalizeUrl(String(url))]; } catch { return []; }
  }));
  if (runtimeUrls.size) {
    const allowedBaseKeys = new Set(
      (Array.isArray(input.baseData?.sources) ? input.baseData.sources : [])
        .map((source: any) => String(source?.source_key || ""))
        .filter(Boolean),
    );
    const allowedRuntimeSources = (normalized.upserts.sources || []).filter((source: any) => {
      try { return runtimeUrls.has(normalizeUrl(String(source?.url || ""))); } catch { return false; }
    });
    const allowedKeys = new Set([
      ...allowedBaseKeys,
      ...allowedRuntimeSources.map((source: any) => String(source?.source_key || "")).filter(Boolean),
    ]);
    const removedKeys = (normalized.upserts.sources || [])
      .map((source: any) => String(source?.source_key || ""))
      .filter((key: string) => key && !allowedKeys.has(key));
    const runtimeGaps: string[] = removedKeys.map((key: string) =>
      `${key}: 模型未调用额外取证工具，该来源不在 Runtime 确定性预取集合中，已拒绝登记`,
    );
    normalized.upserts.sources = allowedRuntimeSources;
    normalized.upserts.evidence_drafts = (normalized.upserts.evidence_drafts || []).map((item: any) => {
      if (item?.kind === "gap") return item;
      const sourceKeys = (Array.isArray(item?.source_keys) ? item.source_keys : [])
        .map(String)
        .filter((key: string) => allowedKeys.has(key));
      if (sourceKeys.length) return { ...item, source_keys: sourceKeys };
      runtimeGaps.push(`${String(item?.id || "EvidenceDraft")}: 未绑定 Runtime 预取或既有来源，已降级为 gap`);
      return normalizeEvidenceDraftNulls({
        ...item,
        kind: "gap",
        direction: "unknown",
        source_keys: [],
        source_ids: [],
        limitations: [
          ...(Array.isArray(item?.limitations) ? item.limitations.map(String) : []),
          "模型未调用额外取证工具，且未绑定 Runtime 确定性预取来源",
        ],
      });
    });
    normalized.upserts.unresolved_gaps = [
      ...new Set([...(normalized.upserts.unresolved_gaps || []).map(String), ...runtimeGaps]),
    ];
    normalized.revision_summary = [
      String(normalized.revision_summary || "").trim(),
      "Runtime acquisition honesty gate：本批只允许既有来源与确定性预取候选；模型未调用工具时不得扩展来源边界。",
    ].filter(Boolean).join(" ");
    normalized.affected_object_refs = expandAffectedObjectRefs(normalized);
    return normalized;
  }

  const baseEvidence = new Map<string, any>(
    (Array.isArray(input.baseData?.evidence_drafts) ? input.baseData.evidence_drafts : [])
      .map((item: any) => [String(item?.id || ""), item])
      .filter(([id]: [string, any]) => Boolean(id)),
  );
  const targetUnitIds = [...new Set((input.targetUnitIds || []).map(String).filter(Boolean))];
  const honestyGaps: string[] = [];
  const evidenceUpserts = (normalized.upserts.evidence_drafts || []).flatMap((item: any) => {
    const id = String(item?.id || "");
    if (!id) return [];
    const prior = baseEvidence.get(id);
    if (prior && prior.kind !== "gap") {
      honestyGaps.push(`${id}: 本批未调用取证工具，已忽略对既有事实的修改`);
      return [];
    }
    const unitIds = Array.isArray(item?.judgment_unit_ids) && item.judgment_unit_ids.length
      ? item.judgment_unit_ids.map(String).filter(Boolean)
      : Array.isArray(prior?.judgment_unit_ids) && prior.judgment_unit_ids.length
        ? prior.judgment_unit_ids.map(String).filter(Boolean)
        : targetUnitIds;
    const statement = String(item?.statement || prior?.statement || `证据候选 ${id} 尚未取得可核验正文`);
    const limitations = [
      ...(Array.isArray(prior?.limitations) ? prior.limitations.map(String).filter(Boolean) : []),
      ...(Array.isArray(item?.limitations) ? item.limitations.map(String).filter(Boolean) : []),
      "本批未调用 search/fetch/MCP 取证工具；Runtime 禁止把模型内生知识登记为事实",
    ];
    honestyGaps.push(`${id}: 本批无取证工具调用，只保留为显式缺口`);
    return [normalizeEvidenceDraftNulls({
      ...prior,
      ...item,
      id,
      statement,
      kind: "gap",
      direction: "unknown",
      source_keys: [],
      source_ids: [],
      judgment_unit_ids: unitIds,
      ontology_node_ids: Array.isArray(item?.ontology_node_ids)
        ? item.ontology_node_ids.map(String)
        : Array.isArray(prior?.ontology_node_ids) ? prior.ontology_node_ids.map(String) : [],
      requirement: String(
        item?.requirement
        || prior?.requirement
        || `取得可定位、可逐字核验的公开正文以支撑：${statement.slice(0, 120)}`,
      ),
      evidence_role: ["support", "counter", "context", "boundary"].includes(String(item?.evidence_role || prior?.evidence_role || ""))
        ? String(item?.evidence_role || prior?.evidence_role)
        : String(item?.direction || "") === "weaken" ? "counter" : "support",
      minimum_independent_sources: Number.isFinite(Number(item?.minimum_independent_sources ?? prior?.minimum_independent_sources))
        ? Math.max(0, Math.floor(Number(item?.minimum_independent_sources ?? prior?.minimum_independent_sources)))
        : 1,
      limitations: [...new Set(limitations)],
    })];
  });

  normalized.upserts.sources = [];
  normalized.upserts.evidence_drafts = evidenceUpserts;
  normalized.upserts.method_applications = (normalized.upserts.method_applications || []).map((item: any) => {
    const capability = String(item?.capability_type || "");
    if (capability && capability !== "evidence") return item;
    return {
      ...item,
      status: "blocked",
      execution_summary: "本批未发生可审计的外部取证调用；不得宣称方法已执行成功",
      limitations: [
        ...(Array.isArray(item?.limitations) ? item.limitations.map(String).filter(Boolean) : []),
        "无取证工具调用，方法状态由 Runtime 保守降为 blocked",
      ],
      alternatives: Array.isArray(item?.alternatives) && item.alternatives.length
        ? item.alternatives
        : [{
          method_id: String(item?.method_id || "unknown"),
          decision: "retry_with_source_acquisition",
          reason: "仅在可用搜索、正文抓取或证据 MCP 通道恢复后重试",
        }],
    };
  });
  normalized.upserts.unresolved_gaps = [
    ...new Set([
      ...(normalized.upserts.unresolved_gaps || []).map(String),
      ...honestyGaps,
      ...(honestyGaps.length || (normalized.upserts.sources || []).length
        ? []
        : ["本批未调用取证工具，未形成任何新增可核验证据"]),
    ]),
  ];
  normalized.removals = {
    ...(normalized.removals || {}),
    sources: [],
    evidence_drafts: [],
  };
  normalized.revision_summary = [
    String(normalized.revision_summary || "").trim(),
    "Runtime acquisition honesty gate：本批无取证工具调用；未登记新增来源或事实，仅保留/补充 gap。",
  ].filter(Boolean).join(" ");
  normalized.affected_object_refs = expandAffectedObjectRefs(normalized);
  return normalized;
}

/** 只把本批相关对象送给模型，但 patch 始终合并回完整 baseData。 */
export function scopeStage03DataForBatch(baseData: any, targetUnitIds: string[]) {
  const target = new Set(targetUnitIds.map(String));
  const intersects = (ids: unknown) =>
    Array.isArray(ids) && ids.some((id) => target.has(String(id)));
  const evidence = (baseData.evidence_drafts || []).filter((item: any) =>
    intersects(item?.judgment_unit_ids),
  );
  const evidenceIds = new Set<string>(
    evidence.map((item: any) => String(item?.id || "")).filter(Boolean),
  );
  return {
    method_applications: (baseData.method_applications || []).filter((item: any) =>
      intersects(item?.target_judgment_unit_refs),
    ),
    sources: (baseData.sources || []).filter((source: any) =>
      (evidence || []).some((item: any) =>
        (item?.source_keys || []).includes(source?.source_key)
        || (item?.source_ids || []).includes(source?.source_id),
      ),
    ),
    evidence_drafts: evidence,
    unresolved_gaps: (baseData.unresolved_gaps || []).filter((item: unknown) =>
      [...evidenceIds].some((id) => String(item).includes(id)),
    ),
  };
}

function stableObjectId(item: unknown): string {
  if (!item || typeof item !== "object" || Array.isArray(item)) return "";
  const value = item as Record<string, unknown>;
  return String(value.source_key || value.id || value.application_id || "");
}

function uniqueStableIds(items: unknown[]): Set<string> {
  return new Set(items.map(stableObjectId).filter(Boolean));
}

function nextNamespacedId(
  original: string,
  namespace: string,
  occupied: Set<string>,
): string {
  const cleanNamespace = namespace.replace(/[^A-Za-z0-9_-]+/g, "-") || "BATCH";
  const cleanOriginal = original.replace(/[^A-Za-z0-9_-]+/g, "-") || "NEW";
  const stem = `${cleanOriginal}-${cleanNamespace}`;
  let candidate = stem;
  let suffix = 2;
  while (occupied.has(candidate)) {
    candidate = `${stem}-${suffix}`;
    suffix += 1;
  }
  occupied.add(candidate);
  return candidate;
}

function replaceRefs(value: unknown, refMap: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map((item) => replaceRefs(item, refMap));
  if (!value || typeof value !== "object") {
    if (typeof value !== "string") return value;
    if (refMap.has(value)) return refMap.get(value);
    for (const [prior, next] of refMap) {
      if (value.startsWith(`${prior}:`) || value.startsWith(`${prior} `)) {
        return `${next}${value.slice(prior.length)}`;
      }
    }
    return value;
  }
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    next[key] = replaceRefs(item, refMap);
  }
  return next;
}

/**
 * 将模型 patch 限制在当前批次，避免不同批次复用 SRC/EV ID 覆盖彼此，
 * 并让 unresolved_gaps 只替换当前批次对应的缺口。
 */
export function isolateStage03BatchPatch(input: {
  baseData: any;
  patch: Stage03Patch;
  targetUnitIds: string[];
  namespace: string;
}): Stage03Patch {
  const targetUnits = new Set(input.targetUnitIds.map(String).filter(Boolean));
  if (!targetUnits.size) return normalizeStage03Patch(input.patch);

  const scoped = scopeStage03DataForBatch(input.baseData, [...targetUnits]);
  const globalSources = Array.isArray(input.baseData?.sources) ? input.baseData.sources : [];
  const globalEvidence = Array.isArray(input.baseData?.evidence_drafts) ? input.baseData.evidence_drafts : [];
  const globalMethods = Array.isArray(input.baseData?.method_applications) ? input.baseData.method_applications : [];
  const scopedSourceIds = uniqueStableIds(scoped.sources || []);
  const scopedEvidenceIds = uniqueStableIds(scoped.evidence_drafts || []);
  const scopedMethodIds = uniqueStableIds(scoped.method_applications || []);
  const occupiedSourceIds = uniqueStableIds(globalSources);
  const occupiedEvidenceIds = uniqueStableIds(globalEvidence);
  const sourceRefsOutsideBatch = new Set<string>();
  for (const evidence of globalEvidence) {
    const unitIds = Array.isArray(evidence?.judgment_unit_ids)
      ? evidence.judgment_unit_ids.map(String)
      : [];
    if (unitIds.some((id: string) => !targetUnits.has(id))) {
      for (const sourceKey of evidence?.source_keys || []) sourceRefsOutsideBatch.add(String(sourceKey));
    }
  }

  const normalized = normalizeStage03Patch(structuredClone(input.patch));
  const sourceRefMap = new Map<string, string>();
  const evidenceRefMap = new Map<string, string>();
  const sourceUpserts = Array.isArray(normalized.upserts.sources)
    ? normalized.upserts.sources
    : [];
  for (const source of sourceUpserts as any[]) {
    const sourceKey = String(source?.source_key || "");
    if (!sourceKey) continue;
    const collidesOutsideBatch = occupiedSourceIds.has(sourceKey)
      && (!scopedSourceIds.has(sourceKey) || sourceRefsOutsideBatch.has(sourceKey));
    if (collidesOutsideBatch) {
      const nextId = nextNamespacedId(sourceKey, input.namespace, occupiedSourceIds);
      sourceRefMap.set(sourceKey, nextId);
      source.source_key = nextId;
    } else {
      occupiedSourceIds.add(sourceKey);
    }
  }

  const evidenceUpserts = Array.isArray(normalized.upserts.evidence_drafts)
    ? normalized.upserts.evidence_drafts
    : [];
  for (const evidence of evidenceUpserts as any[]) {
    const evidenceId = String(evidence?.id || "");
    if (!evidenceId) continue;
    const baseEvidence = globalEvidence.find((item: any) => String(item?.id || "") === evidenceId);
    const unitIds = Array.isArray(evidence?.judgment_unit_ids)
      ? evidence.judgment_unit_ids.map(String)
      : Array.isArray(baseEvidence?.judgment_unit_ids)
        ? baseEvidence.judgment_unit_ids.map(String)
        : [];
    if (!unitIds.length || unitIds.some((id: string) => !targetUnits.has(id))) {
      throw new Error(`${evidenceId} 超出当前 Stage03 批次判断单元范围`);
    }
    if (occupiedEvidenceIds.has(evidenceId) && !scopedEvidenceIds.has(evidenceId)) {
      const nextId = nextNamespacedId(evidenceId, input.namespace, occupiedEvidenceIds);
      evidenceRefMap.set(evidenceId, nextId);
      evidence.id = nextId;
    } else {
      occupiedEvidenceIds.add(evidenceId);
    }
  }

  const allRefMap = new Map([...sourceRefMap, ...evidenceRefMap]);
  normalized.upserts = replaceRefs(normalized.upserts, allRefMap) as Record<string, unknown[]>;

  for (const method of normalized.upserts.method_applications || []) {
    const methodId = stableObjectId(method);
    if (!methodId || !scopedMethodIds.has(methodId)) {
      throw new Error(`${methodId || "未命名 MethodApplication"} 不属于当前 Stage03 批次；禁止新建或跨批修改方法身份`);
    }
  }

  const removals = normalized.removals || {};
  const allowedRemovalIds = new Set([
    ...scopedEvidenceIds,
    ...scopedMethodIds,
    ...[...scopedSourceIds].filter((id) => !sourceRefsOutsideBatch.has(id)),
  ]);
  for (const [section, ids] of Object.entries(removals)) {
    if (section === "unresolved_gaps") {
      for (const id of ids || []) {
        if (![...scopedEvidenceIds].some((evidenceId) =>
          String(id) === evidenceId || String(id).startsWith(`${evidenceId}:`))) {
          throw new Error(`缺口删除 ${id} 不属于当前 Stage03 批次`);
        }
      }
      continue;
    }
    for (const id of ids || []) {
      if (!allowedRemovalIds.has(String(id))) {
        throw new Error(`${section} 删除 ${id} 超出当前 Stage03 批次范围`);
      }
    }
  }

  if (Array.isArray(normalized.upserts.unresolved_gaps)) {
    const targetEvidenceIds = scopedEvidenceIds;
    const nonTargetGaps = (Array.isArray(input.baseData?.unresolved_gaps)
      ? input.baseData.unresolved_gaps
      : []
    ).map(String).filter((gap: string) =>
      ![...targetEvidenceIds].some((id) =>
        gap === id || gap.startsWith(`${id}:`) || gap.startsWith(`${id} `)),
    );
    normalized.upserts.unresolved_gaps = [
      ...new Set([...nonTargetGaps, ...normalized.upserts.unresolved_gaps.map(String)]),
    ];
  }

  normalized.affected_object_refs = expandAffectedObjectRefs(normalized);
  return normalized;
}

export async function applyStage03SourceSnapshots(input: {
  runId: string;
  data: any;
  affectedRefs: Set<string>;
  existingSources: SourceRecord[];
  maxNewSources?: number;
  /** 抓取预算按补证优先级消耗；缺省时保持原顺序 */
  capturePriorityKeys?: string[];
  assertRunning: () => void;
  onCaptureProgress?: (index: number, total: number) => void;
}) {
  const keyMap = new Map<string, string>();
  const sources = input.data.sources || [];
  const allCaptureTargetsRaw = sources.filter((source: any) => {
    if (!source?.source_key || !source?.url) return false;
    if (input.affectedRefs.has(source.source_key)) return true;
    if (source.source_id) {
      const known = input.existingSources.find((item) => item.id === source.source_id);
      if (known) {
        Object.assign(source, applyRegistryFreezeFields(source, known));
        keyMap.set(source.source_key, source.source_id);
        return Boolean(source.source_quote)
          && !(known.usability_status === "usable" && known.retrieval_status === "captured" && Boolean(known.quote_verified));
      }
      keyMap.set(source.source_key, source.source_id);
      return false;
    }
    let normalized = "";
    try { normalized = normalizeUrl(source.url); } catch { normalized = source.url; }
    const existing = input.existingSources.find((item) => item.normalized_url === normalized);
    if (existing) {
      source.source_id = existing.id;
      Object.assign(source, applyRegistryFreezeFields(source, existing));
      keyMap.set(source.source_key, existing.id);
      return Boolean(source.source_quote)
        && !(existing.usability_status === "usable" && existing.retrieval_status === "captured" && Boolean(existing.quote_verified));
    }
    return true;
  });
  const allCaptureTargets = input.capturePriorityKeys?.length
    ? orderByCapturePriority(allCaptureTargetsRaw, input.capturePriorityKeys)
    : allCaptureTargetsRaw;
  const existingNormalizedUrls = new Set(input.existingSources.map((source) => source.normalized_url));
  const recaptureTargets = allCaptureTargets.filter((source: any) => {
    try { return Boolean(source.source_id) || existingNormalizedUrls.has(normalizeUrl(source.url)); } catch { return Boolean(source.source_id); }
  });
  const newTargets = allCaptureTargets.filter((source: any) => !recaptureTargets.includes(source));
  const allowedNewTargets = input.maxNewSources === undefined
    ? newTargets
    : newTargets.slice(0, Math.max(0, input.maxNewSources));
  const captureTargets = [...recaptureTargets, ...allowedNewTargets];
  const deferredTargets = newTargets.slice(allowedNewTargets.length);

  if (deferredTargets.length) {
    for (const source of deferredTargets) {
      Object.assign(source, {
        source_id: null,
        captured_at: null,
        content_hash: null,
        final_url: null,
        retrieval_status: "not_attempted",
        quote_verified: false,
      });
    }
    input.data.unresolved_gaps = [
      ...new Set([
        ...(Array.isArray(input.data.unresolved_gaps) ? input.data.unresolved_gaps.map(String) : []),
        `来源预算已用尽：${deferredTargets.length} 个候选来源未抓取，需人工提高预算或收窄问题`,
      ]),
    ];
  }

  for (const [index, source] of captureTargets.entries()) {
    input.assertRunning();
    input.onCaptureProgress?.(index + 1, captureTargets.length);
    const snapshot = await captureSourceSnapshot({
      url: source.url,
      locator: source.locator,
      source_quote: source.source_quote,
    });
    input.assertRunning();
    const saved = upsertSource(input.runId, {
      url: source.url,
      title: source.title,
      publisher: source.publisher,
      published_at: source.published_at,
      source_type: source.source_type,
      source_tier: source.source_tier,
      authority_type: source.authority_type || "unknown",
      search_excerpt: source.search_excerpt,
      locator: snapshot.locator,
      captured_at: snapshot.captured_at,
      content_hash: snapshot.content_hash,
      usability_status: snapshot.usability_status,
      failure_category: snapshot.failure_category,
      failure_detail: snapshot.failure_detail,
      final_url: snapshot.final_url,
      content_mime: snapshot.content_mime,
      http_status: snapshot.http_status,
      retrieval_status: snapshot.retrieval_status,
      snapshot_text: snapshot.snapshot_text,
      source_quote: snapshot.source_quote,
      quote_verified: snapshot.quote_verified,
    });
    Object.assign(source, applyRegistryFreezeFields(source, saved));
    keyMap.set(source.source_key, saved.id);
  }

  for (const source of sources) {
    if (!keyMap.has(source.source_key) && source.source_id) {
      keyMap.set(source.source_key, source.source_id);
    }
  }
  for (const evidence of input.data.evidence_drafts || []) {
    evidence.source_ids = (evidence.source_keys || []).map((key: string) => keyMap.get(key)).filter(Boolean);
  }
  // 再按当前 Registry 全量投影：覆盖 upsert 拒绝降级返回 prior、以及未重抓的已绑定源。
  const projected = syncStage03DraftSourcesFromRegistry(input.data, listSources(input.runId));
  return repairEvidencePreparationDraft(demoteUnverifiedEvidenceDrafts(projected.data));
}

export async function runEvidenceSupplementRound(input: {
  client: ResearchModelClient;
  runId: string;
  baseData: any;
  supplementContext: Record<string, unknown>;
  assertRunning: () => void;
  onProgress?: (event: { round: number; message: string }) => void;
  existingSources: SourceRecord[];
  maxSourceCount?: number;
  requirements?: EvidenceRequirementProjection[];
  cutoffMs?: number;
  targetUnitIds?: string[];
  maxToolRounds?: number;
  idNamespace?: string;
}) {
  const targetUnitIds = [...new Set((input.targetUnitIds || []).map(String).filter(Boolean))];
  const targetSet = new Set(targetUnitIds);
  const scopedRequirements = targetSet.size
    ? (input.requirements || []).filter((item) =>
      item.judgment_unit_ids.some((id) => targetSet.has(String(id))),
    )
    : input.requirements;
  input.onProgress?.({ round: 0, message: "Runtime 正在按 EvidenceRequirement 预取并冻结候选来源…" });
  const runtimeAcquisition = await preAcquireStage03CandidateSources({
    runId: input.runId,
    question: String((input.supplementContext as any)?.question || ""),
    requirements: scopedRequirements,
    targetUnitIds,
    existingSources: input.existingSources,
    maxSourceCount: input.maxSourceCount,
  });
  input.assertRunning();
  const sourcesAfterRuntimeAcquisition = listSources(input.runId);
  const frozenCandidates = selectFrozenStage03CandidateSources({
    sources: sourcesAfterRuntimeAcquisition,
    requirements: scopedRequirements,
    maxCandidates: 6,
  });
  const frozenDraftSources = materializeFrozenStage03CandidateDrafts({
    sources: frozenCandidates,
    requirements: scopedRequirements,
    existingDraftSources: input.baseData.sources || [],
  });
  const workingBase = dedupeStage03DraftSources({
    ...input.baseData,
    sources: [
      ...(Array.isArray(input.baseData.sources) ? input.baseData.sources : []),
      ...frozenDraftSources,
    ],
  }).data;
  const scopedBase = targetSet.size
    ? scopeStage03DataForBatch(workingBase, targetUnitIds)
    : workingBase;
  const brief = buildSupplementBrief({
    coverage: computeSourceCoverage({
      sources: sourcesAfterRuntimeAcquisition,
      evidence: scopedBase.evidence_drafts || [],
      requirements: scopedRequirements,
      cutoffMs: input.cutoffMs,
    }),
    evidence: scopedBase.evidence_drafts || [],
    sources: sourcesAfterRuntimeAcquisition,
    draftSources: scopedBase.sources || [],
    requirements: scopedRequirements,
    methodApplications: scopedBase.method_applications || [],
  });

  input.onProgress?.({ round: 0, message: "正在按优先级队列针对缺口与失败来源生成补证 patch…" });
  const judgmentTypes = Array.isArray((input.supplementContext as any)?.judgmentTypes)
    ? [...(input.supplementContext as any).judgmentTypes].map(String)
    : [];
  const kb03Ids = evidenceMethodIdsFromApplications(scopedBase.method_applications || []);
  const result = await input.client.generateStructured(
    "evidence_supplement",
    controlledEvidencePatchSchema,
    promptForEvidenceSupplement(),
    JSON.stringify({
      supplement_brief: brief,
      target_batch: targetSet.size ? {
        judgment_unit_ids: targetUnitIds,
        requirement_ids: (scopedRequirements || []).map((item) => item.id),
        new_id_namespace: input.idNamespace || "BATCH",
        reserved_source_keys: (input.baseData.sources || []).map((item: any) => item?.source_key).filter(Boolean),
        reserved_evidence_ids: (input.baseData.evidence_drafts || []).map((item: any) => item?.id).filter(Boolean),
        instruction: "本轮只处理这些判断单元；其他单元由其他批次负责，不得扩展。",
      } : null,
      current_evidence_draft: {
        method_applications: scopedBase.method_applications || [],
        sources: scopedBase.sources || [],
        evidence_drafts: scopedBase.evidence_drafts || [],
        unresolved_gaps: scopedBase.unresolved_gaps || [],
      },
      selected_method_guidance: loadSelectedMethodGuidance(kb03Ids, {
        totalChars: CONTEXT_SLOT_BUDGETS.method_guidance,
      }),
      evidence_judgment_type_cards: evidenceJudgmentTypeCardsForPrompt(judgmentTypes),
      mcp_channel_hints: mcpChannelHintsForPrompt(),
      patch_contract: {
        id_space: "source_key/application_id/evidence_id",
        note: "affected_object_refs 与 upserts/removals 使用同一套稳定业务 ID（如 SRC-09、MA-EV-01、EV-1），不是 registry UUID。新增对象只需出现在 upserts；Runtime 会自动补齐 affected_object_refs。",
      },
      runtime_acquired_candidates: frozenCandidates.map((source) => ({
        source_id: source.id,
        source_key: frozenDraftSources.find((draft: any) => draft.source_id === source.id)?.source_key,
        url: source.url,
        title: source.title,
        publisher: source.publisher,
        published_at: source.published_at,
        search_excerpt: source.search_excerpt,
        source_quote: frozenDraftSources.find((draft: any) => draft.source_id === source.id)?.source_quote,
        content_hash: source.content_hash,
        retrieval_status: source.retrieval_status,
        instruction: "该候选已由 Runtime 物化进 current_evidence_draft.sources。直接绑定既有 source_key；不要重复 upsert 来源，也不得改写 source_quote。",
      })),
      runtime_acquisition_trace: {
        deterministic_queries: runtimeAcquisition.queries,
        registered_candidate_count: runtimeAcquisition.sources.length,
        registry_reused_candidate_count: frozenCandidates.filter((source) =>
          !runtimeAcquisition.sources.some((candidate) => candidate.id === source.id),
        ).length,
        error: runtimeAcquisition.error || null,
      },
      ...input.supplementContext,
    }, null, 2),
    {
      // 冻结候选已足够时只保留结构化 submit 工具；禁止模型重复搜索并在
      // 每轮重放整份上下文。只有无候选时才开放取证工具。
      webSearch: frozenDraftSources.length === 0,
      requireEvidenceAcquisition: frozenCandidates.length === 0,
      // 本轮目标是调用工具取得并冻结来源，不是形成最终判断。关闭 thinking
      // 可显著降低“检索前长思考”，推理质量由后续证据结构化/Stage04 承担。
      disableReasoning: true,
      // 本批目标和本体节点已由 Stage02 固定；关闭 ontology 工具避免在取证环空转。
      ontologyTools: false,
      maxToolRounds: input.maxToolRounds || 8,
      runId: input.runId,
      // 提交时即把 upserts/removals ID 并入 affected，避免 schema 过关后 merge 再因漏声明失败。
      repairOutput: (data) => {
        const normalized = normalizeStage03Patch(data as Stage03Patch);
        return targetSet.size
          ? isolateStage03BatchPatch({
            baseData: workingBase,
            patch: normalized,
            targetUnitIds,
            namespace: input.idNamespace || "BATCH",
          })
          : normalized;
      },
    },
  );
  input.assertRunning();

  const combinedToolUsage = {
    ...(result.toolUsage && typeof result.toolUsage === "object" ? result.toolUsage as Record<string, unknown> : {}),
    runtime_preacquired_sources: frozenCandidates.length,
    runtime_acquisition_queries: runtimeAcquisition.queries,
    ...(runtimeAcquisition.error ? { runtime_acquisition_error: runtimeAcquisition.error } : {}),
  };
  const patch = enforceStage03AcquisitionHonesty({
    patch: normalizeStage03Patch(result.data),
    baseData: workingBase,
    toolUsage: combinedToolUsage,
    targetUnitIds,
    runtimeAcquiredSourceUrls: frozenCandidates.map((source) => source.url),
  });
  const merged = mergeStage03Patch(workingBase, patch);
  const repaired = repairEvidencePreparationDraft(merged);
  // 抓取前先过契约：避免 gap 残留 source_keys / 非法 kind 烧完一轮抓取才失败。
  const precheck = schemas.stage_03.safeParse(repaired);
  if (!precheck.success) {
    throw new Error(JSON.stringify(precheck.error.issues));
  }
  const affectedRefs = new Set([
    ...patch.affected_object_refs,
    ...frozenDraftSources.map((source: any) => String(source.source_key)),
  ]);
  // 合并后按“失败源/返工绑定/单元缺口/其余新线索”重排抓取顺序，预算先喂高优先项。
  const capturePriorityKeys = buildCapturePriorityKeys({
    draftSources: repaired.sources || [],
    evidence: repaired.evidence_drafts || [],
    failedSourceKeys: brief.failed_sources
      .map((item) => item.source_key)
      .filter((key): key is string => Boolean(key)),
    reworkEvidenceIds: brief.rework_evidence.map((item) => item.evidence_id),
    gapUnitIds: brief.gap_units.map((item) => item.unit_id),
  });
  const withSnapshots = await applyStage03SourceSnapshots({
    runId: input.runId,
    data: repaired,
    affectedRefs,
    existingSources: sourcesAfterRuntimeAcquisition,
    maxNewSources: input.maxSourceCount === undefined
      ? undefined
      : Math.max(
        0,
        input.maxSourceCount
          - sourcesAfterRuntimeAcquisition.filter((source) => source.usability_status !== "rejected").length,
      ),
    capturePriorityKeys,
    assertRunning: input.assertRunning,
    onCaptureProgress: (index, total) => {
      input.onProgress?.({ round: index, message: `补证来源抓取 ${index}/${total}` });
    },
  });
  schemas.stage_03.parse(withSnapshots);
  return {
    data: withSnapshots,
    patch,
    usage: result.usage,
    toolUsage: combinedToolUsage,
    unchangedEvidenceIds: findUnchangedEvidenceIds(workingBase.evidence_drafts || [], withSnapshots.evidence_drafts || []),
  };
}

export function collectAffectedSourceKeys(patch: { affected_object_refs: string[]; upserts: Record<string, unknown[]> }) {
  const keys = new Set<string>();
  for (const source of patch.upserts.sources || []) {
    const id = objectId(source);
    if (id) keys.add(id);
  }
  for (const ref of patch.affected_object_refs) {
    if (ref.startsWith("SRC-")) keys.add(ref);
  }
  return keys;
}
