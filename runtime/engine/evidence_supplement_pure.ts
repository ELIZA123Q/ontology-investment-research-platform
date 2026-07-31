import { createHash } from "node:crypto";
import type { EvidenceRequirementProjection } from "./structure_candidates";
import {
  computeSourceCoverage,
  type SourceCoverageSummary,
} from "./source_coverage";
import type { SourceRecord } from "./types";

type EvidenceDraftLike = {
  id: string;
  statement: string;
  kind: string;
  direction?: string;
  source_ids?: string[];
  source_keys?: string[];
  judgment_unit_ids?: string[];
};

type MethodApplicationLike = {
  application_id?: string;
  status?: string;
  input_evidence_refs?: string[];
};

export type SupplementPriorityTierKey =
  | "blocked_method_or_orphan_evidence"
  | "failed_source_repair"
  | "unit_coverage_gap"
  | "open_new_clue";

export type SupplementPriorityItem = {
  /** 1=最高优先，4=最低（仅在更高档耗尽后才开新线索） */
  tier: 1 | 2 | 3 | 4;
  tier_key: SupplementPriorityTierKey;
  action: string;
  refs: string[];
  detail: Record<string, unknown>;
};

function isUsableSource(source: SourceRecord) {
  return source.usability_status === "usable"
    && source.retrieval_status === "captured"
    && Boolean(source.quote_verified);
}

function uniquePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function selectEvidenceSnapshotExcerpt(input: {
  snapshotText: string;
  title?: string;
  requirements?: EvidenceRequirementProjection[];
  maxChars?: number;
}) {
  const text = String(input.snapshotText || "");
  const maxChars = Math.max(400, Math.min(8_000, Math.floor(input.maxChars || 2_400)));
  if (text.length <= maxChars) return text;
  const stop = new Set([
    "about", "after", "before", "company", "global", "industry", "latest", "market",
    "news", "report", "reports", "research", "results", "technology", "with",
  ]);
  const titleTokens = (String(input.title || "").toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) || [])
    .filter((token) => !stop.has(token));
  const requirementText = (input.requirements || []).map((item) => item.requirement).join(" ");
  const mappedFocus = ([
    [/库存/i, "inventory"],
    [/价格|报价|涨价|跌幅/i, "price"],
    [/合约/i, "contract"],
    [/需求|出货|部署|订单/i, "demand"],
    [/供给|产能|投片|产出/i, "supply"],
    [/良率/i, "yield"],
    [/封装/i, "packaging"],
    [/客户/i, "customer"],
    [/企业级/i, "enterprise"],
    [/消费级|手机|PC|笔记本/i, "consumer"],
    [/HBM/i, "hbm"],
    [/DRAM/i, "dram"],
    [/NAND/i, "nand"],
    [/SSD/i, "ssd"],
    [/UFS/i, "ufs"],
    [/手机/i, "smartphone"],
    [/PC|笔记本/i, "pc"],
  ] as Array<[RegExp, string]>).flatMap(([pattern, token]) => pattern.test(requirementText) ? [token] : []);
  const focusTokens = uniquePreserveOrder([
    ...titleTokens,
    ...mappedFocus,
    "inventory", "price", "pricing", "contract", "demand", "supply", "capacity",
    "shipment", "shipments", "revenue", "yield", "quarter",
  ]);
  const bodyAnchors = [
    /Last Modified\s+20\d{2}-\d{2}-\d{2}/i,
    /Press Release PDF Version/i,
    /Samsung Electronics,\s+a global/i,
    /Press Center Home Press Center/i,
    /\bBOISE,\s+Idaho\b/i,
  ].flatMap((pattern) => {
    const match = pattern.exec(text);
    return match?.index === undefined ? [] : [match.index];
  });
  const bodyStart = bodyAnchors.length ? Math.min(...bodyAnchors) : 0;
  const bodyEndCandidates = [
    /\bSpotlight Report\b/i,
    /\bPress Resources Press Releases Products\b/i,
  ].flatMap((pattern) => {
    const match = pattern.exec(text.slice(bodyStart + 200));
    return match?.index === undefined ? [] : [bodyStart + 200 + match.index];
  });
  const bodyEnd = bodyEndCandidates.length ? Math.min(...bodyEndCandidates) : text.length;
  const stride = Math.max(300, Math.floor(maxChars / 4));
  let bestStart = bodyStart;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let start = bodyStart; start < bodyEnd; start += stride) {
    const window = text.slice(start, Math.min(start + maxChars, bodyEnd));
    const haystack = window.toLowerCase();
    let score = 0;
    for (const token of focusTokens) {
      const weight = mappedFocus.includes(token) ? 4 : titleTokens.includes(token) ? 3 : 1;
      const count = haystack.split(token).length - 1;
      score += Math.min(count, 5) * weight;
    }
    if (/key highlights|business outlook|news summary|reported|announced|quarterly|q[1-4]\s*20\d{2}/i.test(window)) score += 8;
    if (/\b(?:revenue|shipments?|inventory|contract price|capacity|yield)\b.{0,80}(?:%|billion|million|quarter|year-over-year)/i.test(window)) {
      score += 12;
    }
    const navigationMarkers = [
      /popular keywords/i,
      /shopping list/i,
      /view cart/i,
      /sign in/i,
      /main navigation/i,
      /skip to main navigation/i,
      /part number look up/i,
      /power calculators/i,
      /firmware downloads/i,
      /software\s*&\s*drivers/i,
      /selected topics membership/i,
      /customer support page/i,
      /media inquiries/i,
      /\bsitemap\b/i,
      /download files/i,
      /copied to clipboard/i,
      /copyright©/i,
    ];
    score -= navigationMarkers.filter((pattern) => pattern.test(window)).length * 16;
    // Later windows win ties so a repeated page title after navigation is
    // preferred over the <title>/menu copy at the top of the snapshot.
    if (score >= bestScore) {
      bestScore = score;
      bestStart = start;
    }
  }
  // Sliding windows can land halfway through the first useful sentence when a
  // long navigation block precedes the article. If a nearby article-body
  // marker exists, backtrack to it so the quote candidate remains continuous
  // and intelligible rather than returning only the tail of the evidence.
  const anchorSearchStart = Math.max(0, bestStart - maxChars);
  const anchorContext = text.slice(anchorSearchStart, bestStart + Math.min(400, maxChars));
  const anchors = [...anchorContext.matchAll(
    /key highlights|business outlook|news summary|press release|financial results|reported|announced/gi,
  )];
  const lastAnchor = anchors.at(-1);
  if (lastAnchor?.index !== undefined) {
    const anchoredStart = anchorSearchStart + lastAnchor.index;
    if (Math.abs(bestStart - anchoredStart) <= maxChars / 2) {
      bestStart = anchoredStart;
    }
  }
  return text.slice(bestStart, Math.min(bestStart + maxChars, bodyEnd));
}

export function evidenceFingerprint(draft: EvidenceDraftLike): string {
  return createHash("sha256").update(JSON.stringify({
    statement: draft.statement,
    kind: draft.kind,
    direction: draft.direction || "",
    source_ids: [...(draft.source_ids || [])].sort(),
    source_keys: [...(draft.source_keys || [])].sort(),
    judgment_unit_ids: [...(draft.judgment_unit_ids || [])].sort(),
  })).digest("hex");
}

export function findUnchangedEvidenceIds(baseEvidence: EvidenceDraftLike[], mergedEvidence: EvidenceDraftLike[]): Set<string> {
  const baseById = new Map(baseEvidence.map((item) => [item.id, evidenceFingerprint(item)]));
  const unchanged = new Set<string>();
  for (const draft of mergedEvidence) {
    const prior = baseById.get(draft.id);
    if (prior && prior === evidenceFingerprint(draft)) unchanged.add(draft.id);
  }
  return unchanged;
}

function clampPositiveInt(raw: string | undefined, dflt: number, floor: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return dflt;
  return Math.max(floor, Math.floor(n));
}

function stripSnapshotTextFromDraftSource(source: unknown): unknown {
  if (source && typeof source === "object" && "snapshot_text" in (source as Record<string, unknown>)) {
    const { snapshot_text: _omit, ...cleaned } = source as Record<string, unknown>;
    void _omit;
    return cleaned;
  }
  return source;
}

/**
 * 把送模的 current_evidence_draft 收敛到“本批必需 + 最近 N 条”（delta 风格）：
 *
 * - method_applications / unresolved_gaps：本就批内裁剪且体量小，原样保留（质量需要）。
 * - evidence_drafts：本批证据，用于避免重复生成；仅作极端体量下的“最近 N 条”兜底。
 * - sources：核心优化点。绑定到本批证据的来源，以及失败/返工/缺口必须修复的来源，
 *   一律**钉住**（绝不裁剪，避免重复抓取或丢失修复上下文）；其余“未绑定/溢出”来源
 *   按草稿顺序（越靠后越新）保留最近的，超出 STAGE03_DRAFT_MAX_SOURCES 的部分丢弃。
 *
 * 这样既防止“被反复补证的单元把整份历史来源逐轮重发”（当前证据草稿的最大乘数），
 * 又不牺牲取证质量：模型始终能看到本批已绑定来源与必须修复的失败源。
 */
export function trimStage03DraftForModel(input: {
  methodApplications?: unknown[];
  sources?: unknown[];
  evidenceDrafts?: unknown[];
  unresolvedGaps?: unknown[];
  mustIncludeSourceKeys?: string[];
  maxSources?: number;
  maxEvidence?: number;
}): {
  method_applications: unknown[];
  sources: unknown[];
  evidence_drafts: unknown[];
  unresolved_gaps: unknown[];
} {
  const maxSources = input.maxSources
    ?? clampPositiveInt(process.env.STAGE03_DRAFT_MAX_SOURCES, 40, 8);
  const maxEvidence = input.maxEvidence
    ?? clampPositiveInt(process.env.STAGE03_DRAFT_MAX_EVIDENCE, 80, 8);
  const method_applications = Array.isArray(input.methodApplications) ? input.methodApplications : [];
  const evidence_drafts = Array.isArray(input.evidenceDrafts) ? input.evidenceDrafts : [];
  const unresolved_gaps = Array.isArray(input.unresolvedGaps) ? input.unresolvedGaps : [];

  // 本批证据已绑定的来源 key/id 必须保留，否则模型会重复登记或重复抓取。
  const boundKeys = new Set<string>();
  for (const ev of evidence_drafts) {
    const draft = ev as Record<string, unknown>;
    for (const k of Array.isArray(draft?.source_keys) ? (draft.source_keys as unknown[]) : []) {
      const s = String(k);
      if (s) boundKeys.add(s);
    }
    for (const id of Array.isArray(draft?.source_ids) ? (draft.source_ids as unknown[]) : []) {
      const s = String(id);
      if (s) boundKeys.add(s);
    }
  }
  const mustInclude = new Set<string>(
    (Array.isArray(input.mustIncludeSourceKeys) ? input.mustIncludeSourceKeys : [])
      .map(String)
      .filter(Boolean),
  );
  const isPinned = (source: unknown): boolean => {
    const draft = source as Record<string, unknown>;
    const key = draft?.source_key ? String(draft.source_key) : "";
    const id = draft?.source_id ? String(draft.source_id) : "";
    if (key && (boundKeys.has(key) || mustInclude.has(key))) return true;
    if (id && (boundKeys.has(id) || mustInclude.has(id))) return true;
    return false;
  };

  const allSources = Array.isArray(input.sources) ? input.sources : [];
  const pinned = allSources.filter(isPinned).map(stripSnapshotTextFromDraftSource);
  const extra = allSources.filter((source) => !isPinned(source));
  const extraBudget = Math.max(0, maxSources - pinned.length);
  // 未绑定/溢出来源按草稿顺序保留最近的（末尾更晚加入）。
  const keptExtra = extra
    .slice(Math.max(0, extra.length - extraBudget))
    .map(stripSnapshotTextFromDraftSource);
  const sources = [...pinned, ...keptExtra];

  // evidence_drafts 仅在病理级体量下作“最近 N 条”兜底，不直接删证据以免重复生成。
  const evidenceTrimmed = evidence_drafts.length > maxEvidence
    ? evidence_drafts.slice(Math.max(0, evidence_drafts.length - maxEvidence))
    : evidence_drafts;

  return { method_applications, sources, evidence_drafts: evidenceTrimmed, unresolved_gaps };
}

/**
 * 补证确定性调度顺序：
 * 1) 阻塞/降级方法与无可用来源的证据
 * 2) 失败可修复来源
 * 3) 判断单元覆盖/独立性缺口
 * 4) 才开新线索
 */
export function buildSupplementPriorityQueue(input: {
  blockedMethods: Array<{ application_id: string; status: string; input_evidence_refs: string[] }>;
  reworkEvidence: Array<{ evidence_id: string; issue: string; statement: string }>;
  failedSources: Array<{ id: string; source_key: string | null }>;
  gapUnits: Array<{
    unit_id: string;
    has_support_evidence: boolean;
    meets_independence: boolean;
    independent_source_groups: number;
    minimum_independent_sources: number;
  }>;
  coverageGapCount: number;
}): SupplementPriorityItem[] {
  const queue: SupplementPriorityItem[] = [];

  for (const method of input.blockedMethods) {
    queue.push({
      tier: 1,
      tier_key: "blocked_method_or_orphan_evidence",
      action: "unblock_or_replace_method_inputs",
      refs: [method.application_id],
      detail: {
        status: method.status,
        input_evidence_refs: method.input_evidence_refs,
      },
    });
  }

  for (const item of input.reworkEvidence) {
    queue.push({
      tier: 1,
      tier_key: "blocked_method_or_orphan_evidence",
      action: item.issue === "missing_sources" ? "bind_usable_sources" : "replace_unusable_sources",
      refs: [item.evidence_id],
      detail: item,
    });
  }

  for (const source of input.failedSources) {
    queue.push({
      tier: 2,
      tier_key: "failed_source_repair",
      action: "repair_or_replace_failed_source",
      refs: [source.source_key || source.id],
      detail: source,
    });
  }

  for (const unit of input.gapUnits) {
    queue.push({
      tier: 3,
      tier_key: "unit_coverage_gap",
      action: !unit.has_support_evidence ? "add_support_evidence" : "add_independent_sources",
      refs: [unit.unit_id],
      detail: unit,
    });
  }

  if (input.coverageGapCount > 0) {
    queue.push({
      tier: 4,
      tier_key: "open_new_clue",
      action: "only_after_higher_tiers_addressed",
      refs: [],
      detail: {
        coverage_gap_count: input.coverageGapCount,
        note: "更高档未处理完前，禁止仅为开新线索而新增无关来源",
      },
    });
  }

  return queue.sort((a, b) => a.tier - b.tier);
}

/** 抓取预算消耗顺序：先修失败源/返工证据绑定，再补一手权威与单元缺口，最后才是其余新线索 */
export function authorityCaptureRank(authorityType?: string | null): number {
  switch (authorityType) {
    case "official": return 0;
    case "company_disclosure": return 1;
    case "industry_provider": return 2;
    case "unknown": return 3;
    case "public_secondary": return 4;
    default: return 3;
  }
}

function isPrimaryAuthority(authorityType?: string | null) {
  return authorityCaptureRank(authorityType) <= 2;
}

export function buildCapturePriorityKeys(input: {
  draftSources: Array<{ source_key?: string; authority_type?: string; source_id?: string | null }>;
  evidence: EvidenceDraftLike[];
  failedSourceKeys: string[];
  reworkEvidenceIds: string[];
  gapUnitIds: string[];
}): string[] {
  const evidenceById = new Map(input.evidence.map((item) => [item.id, item]));
  const authorityByKey = new Map(
    input.draftSources
      .filter((source) => source.source_key)
      .map((source) => [String(source.source_key), source.authority_type || "unknown"]),
  );
  const ordered: string[] = [];

  ordered.push(...input.failedSourceKeys);

  for (const evidenceId of input.reworkEvidenceIds) {
    const draft = evidenceById.get(evidenceId);
    const keys = (draft?.source_keys || []).map(String);
    keys.sort((a, b) => authorityCaptureRank(authorityByKey.get(a)) - authorityCaptureRank(authorityByKey.get(b)));
    ordered.push(...keys);
  }

  // 有单元缺口时，先消耗一手权威来源（官方/公司披露/行业），再处理已绑到单元的候选。
  if (input.gapUnitIds.length) {
    const primaryKeys = input.draftSources
      .filter((source) => source.source_key && isPrimaryAuthority(source.authority_type))
      .sort((a, b) => authorityCaptureRank(a.authority_type) - authorityCaptureRank(b.authority_type))
      .map((source) => String(source.source_key));
    ordered.push(...primaryKeys);

    for (const unitId of input.gapUnitIds) {
      const keys: string[] = [];
      for (const draft of input.evidence) {
        if (!(draft.judgment_unit_ids || []).includes(unitId)) continue;
        for (const key of draft.source_keys || []) keys.push(String(key));
      }
      keys.sort((a, b) => authorityCaptureRank(authorityByKey.get(a)) - authorityCaptureRank(authorityByKey.get(b)));
      ordered.push(...keys);
    }
  }

  const remaining = [...input.draftSources]
    .filter((source) => source.source_key)
    .sort((a, b) => authorityCaptureRank(a.authority_type) - authorityCaptureRank(b.authority_type));
  for (const source of remaining) {
    ordered.push(String(source.source_key));
  }

  return uniquePreserveOrder(ordered);
}

export function orderByCapturePriority<T extends { source_key?: string }>(
  targets: T[],
  priorityKeys: string[],
): T[] {
  const rank = new Map(priorityKeys.map((key, index) => [key, index]));
  return targets
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const keyA = String(a.item.source_key || "");
      const keyB = String(b.item.source_key || "");
      const rankA = rank.has(keyA) ? rank.get(keyA)! : Number.MAX_SAFE_INTEGER;
      const rankB = rank.has(keyB) ? rank.get(keyB)! : Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB) return rankA - rankB;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

/**
 * Source Registry 是抓取冻结字段的唯一权威。
 * 补证/重新取得来源/upsert 拒绝降级后，草稿常残留旧 locator/quote/captured_at。
 */
export function syncStage03DraftSourcesFromRegistry(data: any, records: SourceRecord[]): { data: any; changed: boolean } {
  if (!data || typeof data !== "object" || !Array.isArray(data.sources)) {
    return { data, changed: false };
  }
  const byId = new Map(records.map((record) => [record.id, record]));
  let changed = false;
  const sources = data.sources.map((source: any) => {
    if (!source || typeof source !== "object") return source;
    const record = byId.get(String(source.source_id || ""));
    if (!record) return source;
    const next = applyRegistryFreezeFields(source, record);
    if (!changed && freezeFieldsDiffer(source, next)) changed = true;
    return next;
  });
  const synced = changed ? { ...data, sources } : data;
  const deduped = dedupeStage03DraftSources(synced);
  return { data: deduped.data, changed: changed || deduped.changed };
}

export function applyRegistryFreezeFields(source: Record<string, unknown>, record: SourceRecord): Record<string, unknown> {
  return {
    ...source,
    // url 保留草稿值，确认时与 Registry 做归一化身份核对；禁止静默改绑到其他页面。
    locator: record.locator || "",
    source_quote: record.source_quote || "",
    captured_at: record.captured_at || null,
    content_hash: record.content_hash || "",
    final_url: record.final_url || record.url,
    retrieval_status: record.retrieval_status,
    quote_verified: Boolean(record.quote_verified),
    usability_status: record.usability_status,
    source_tier: record.source_tier || "S8",
    published_at: record.published_at || source.published_at || null,
    failure_detail: record.failure_detail || "",
  };
}

function freezeFieldsDiffer(left: Record<string, unknown>, right: Record<string, unknown>) {
  const keys = [
    "locator", "source_quote", "captured_at", "content_hash", "final_url",
    "retrieval_status", "quote_verified", "usability_status", "source_tier", "published_at",
  ] as const;
  return keys.some((key) => {
    if (key === "quote_verified") return Boolean(left[key]) !== Boolean(right[key]);
    return String(left[key] ?? "") !== String(right[key] ?? "");
  });
}

/**
 * Registry 按 (run_id, normalized_url) 唯一；模型却常给同一 URL 建多个 SRC-*。
 * 抓取后它们会共用同一 source_id，确认时报「缺少唯一 source_id」。
 * 这里折叠为一条权威草稿，并把证据绑定改写到保留的 source_key。
 */
export function dedupeStage03DraftSources(data: any): { data: any; changed: boolean; aliasToCanonical: Record<string, string> } {
  if (!data || typeof data !== "object" || !Array.isArray(data.sources)) {
    return { data, changed: false, aliasToCanonical: {} };
  }

  const referencedKeys = new Set<string>();
  for (const draft of data.evidence_drafts || []) {
    for (const key of draft?.source_keys || []) referencedKeys.add(String(key));
  }

  const groups = new Map<string, any[]>();
  for (const source of data.sources) {
    if (!source || typeof source !== "object") continue;
    const identity = draftSourceIdentity(source);
    const bucket = groups.get(identity) || [];
    bucket.push(source);
    groups.set(identity, bucket);
  }

  const aliasToCanonical: Record<string, string> = {};
  const kept: any[] = [];
  let changed = false;

  for (const bucket of groups.values()) {
    if (bucket.length === 1) {
      kept.push(bucket[0]);
      continue;
    }
    changed = true;
    const canonical = pickCanonicalDraftSource(bucket, referencedKeys);
    const canonicalKey = String(canonical.source_key || "");
    kept.push(canonical);
    for (const source of bucket) {
      const key = String(source.source_key || "");
      if (key && key !== canonicalKey) aliasToCanonical[key] = canonicalKey;
    }
  }

  if (!changed) return { data, changed: false, aliasToCanonical: {} };

  const evidence_drafts = Array.isArray(data.evidence_drafts)
    ? data.evidence_drafts.map((draft: any) => {
      if (!draft || typeof draft !== "object") return draft;
      const source_keys = uniquePreserveOrder(
        (Array.isArray(draft.source_keys) ? draft.source_keys : []).map((key: string) => (
          aliasToCanonical[String(key)] || String(key)
        )),
      );
      const sourceByKey = new Map(kept.map((source) => [String(source.source_key || ""), source]));
      const source_ids = source_keys
        .map((key) => sourceByKey.get(key)?.source_id)
        .filter(Boolean)
        .map(String);
      return { ...draft, source_keys, source_ids };
    })
    : data.evidence_drafts;

  const unresolved = [
    ...new Set([
      ...(Array.isArray(data.unresolved_gaps) ? data.unresolved_gaps.map(String) : []),
      ...Object.entries(aliasToCanonical).map(([alias, canonical]) => (
        `${alias}: 与 ${canonical} 指向同一 Registry 来源，已合并，避免重复 source_id`
      )),
    ]),
  ];

  return {
    data: { ...data, sources: kept, evidence_drafts, unresolved_gaps: unresolved },
    changed: true,
    aliasToCanonical,
  };
}

function draftSourceIdentity(source: Record<string, unknown>): string {
  const sourceId = String(source.source_id || "").trim();
  if (sourceId) return `id:${sourceId}`;
  const url = String(source.url || "").trim().toLowerCase().replace(/\/+$/, "");
  if (url) return `url:${url}`;
  return `key:${String(source.source_key || "")}`;
}

function pickCanonicalDraftSource(bucket: any[], referencedKeys: Set<string>) {
  return [...bucket].sort((left, right) => {
    const score = (source: any) => {
      let value = 0;
      if (referencedKeys.has(String(source.source_key || ""))) value += 100;
      if (source.quote_verified) value += 20;
      if (source.usability_status === "usable") value += 10;
      if (source.retrieval_status === "captured") value += 5;
      value += Math.min(String(source.source_quote || "").length, 50) / 50;
      return value;
    };
    const delta = score(right) - score(left);
    if (delta) return delta;
    return String(left.source_key || "").localeCompare(String(right.source_key || ""));
  })[0];
}

export function buildSupplementBrief(input: {
  coverage: SourceCoverageSummary;
  evidence: EvidenceDraftLike[];
  sources: SourceRecord[];
  /** stage_03 稿件中的 sources（含 source_key）；用于把 registry UUID 映射回 SRC-xx */
  draftSources?: Array<{ source_key?: string; source_id?: string | null; url?: string; authority_type?: string }>;
  requirements?: EvidenceRequirementProjection[];
  methodApplications?: MethodApplicationLike[];
}) {
  const sourceKeyById = new Map<string, string>();
  const sourceKeyByUrl = new Map<string, string>();
  for (const draft of input.draftSources || []) {
    const key = draft.source_key ? String(draft.source_key) : "";
    if (!key) continue;
    if (draft.source_id) sourceKeyById.set(String(draft.source_id), key);
    if (draft.url) sourceKeyByUrl.set(String(draft.url), key);
  }

  const sourceById = new Map(input.sources.map((source) => [source.id, source]));
  const failedSources = input.sources
    .filter((source) => Boolean(source.url))
    .filter((source) => !isUsableSource(source))
    .map((source) => {
      const snapshot = String(source.snapshot_text || "");
      const excerpt = selectEvidenceSnapshotExcerpt({
        snapshotText: snapshot,
        title: source.title,
        requirements: input.requirements,
        // Plan A：失败源修复只需一个能照抄 ≥20 字原文的窗口，400 字足够，
        // 不再把 2.4k 正文片段塞进补证 brief。
        maxChars: 400,
      });
      return {
        id: source.id,
        source_key: sourceKeyById.get(source.id) || sourceKeyByUrl.get(source.url) || null,
        title: source.title,
        url: source.url,
        retrieval_status: source.retrieval_status,
        quote_verified: source.quote_verified,
        usability_status: source.usability_status,
        failure_detail: source.failure_detail || "",
        prior_source_quote: source.source_quote || "",
        // 给模型可直接改写的正文片段，避免再凭记忆编造 quote。
        snapshot_excerpt: excerpt,
        repair_hint: excerpt
          ? "请从 snapshot_excerpt 逐字复制一段 ≥20 字的连续原文作为新的 source_quote；若摘录与主张无关，则换 URL 或把对应证据降为 gap。"
          : "正文未抓取成功：更换可公开访问的原文 URL，或将绑定证据降为 gap。",
      };
    });

  const gapUnits = input.coverage.unit_coverage
    .filter((unit) => !unit.has_support_evidence || !unit.meets_independence)
    .map((unit) => ({
      unit_id: unit.unit_id,
      has_support_evidence: unit.has_support_evidence,
      meets_independence: unit.meets_independence,
      independent_source_groups: unit.independent_source_groups,
      minimum_independent_sources: unit.minimum_independent_sources,
    }));

  const reworkEvidence = input.evidence
    .filter((draft) => draft.kind !== "gap")
    .map((draft) => {
      const bound = (draft.source_ids || [])
        .map((id) => sourceById.get(id))
        .filter((source): source is SourceRecord => Boolean(source));
      if (!bound.length) {
        return { evidence_id: draft.id, issue: "missing_sources", statement: draft.statement };
      }
      if (bound.every((source) => !isUsableSource(source))) {
        return { evidence_id: draft.id, issue: "all_sources_unusable", statement: draft.statement };
      }
      return null;
    })
    .filter((item): item is { evidence_id: string; issue: string; statement: string } => Boolean(item));

  const blockedMethods = (input.methodApplications || [])
    .filter((method) => {
      const status = String(method.status || "").toLowerCase();
      return status === "blocked" || status === "degraded" || status === "rejected";
    })
    .map((method) => ({
      application_id: String(method.application_id || ""),
      status: String(method.status || ""),
      input_evidence_refs: (method.input_evidence_refs || []).map(String),
    }))
    .filter((method) => Boolean(method.application_id));

  const priority_queue = buildSupplementPriorityQueue({
    blockedMethods,
    reworkEvidence,
    failedSources,
    gapUnits,
    coverageGapCount: input.coverage.coverage_gap_count,
  });

  const capture_priority_keys = buildCapturePriorityKeys({
    draftSources: input.draftSources || [],
    evidence: input.evidence,
    failedSourceKeys: failedSources.map((item) => item.source_key).filter((key): key is string => Boolean(key)),
    reworkEvidenceIds: reworkEvidence.map((item) => item.evidence_id),
    gapUnitIds: gapUnits.map((item) => item.unit_id),
  });

  return {
    schedule_policy: {
      order: [
        "blocked_method_or_orphan_evidence",
        "failed_source_repair",
        "unit_coverage_gap",
        "open_new_clue",
      ],
      note: "必须严格按 priority_queue 的 tier 升序处理；更高档未覆盖前不得仅为 open_new_clue 新增无关来源。单元覆盖缺口优先一手 MCP/官方披露，Bing 公开网页仅作补充。",
    },
    priority_queue,
    capture_priority_keys,
    preferred_acquisition_channels: [
      "query_cninfo",
      "query_datayes_finoper",
      "query_datayes_stock",
      "query_macro_data",
      "query_market_index",
      "query_fund_data",
      "query_china_policy",
      "query_research_reports",
      "query_caixin_news",
      "fetch_public_pages",
      "search_public_web",
    ],
    coverage_gap_count: input.coverage.coverage_gap_count,
    coverage_rate: input.coverage.coverage_rate,
    verification_rate: input.coverage.verification_rate,
    gap_units: gapUnits,
    failed_sources: failedSources,
    rework_evidence: reworkEvidence,
    blocked_methods: blockedMethods,
    requirements: input.requirements || [],
  };
}

export function buildSupplementCoverage(input: {
  sources: SourceRecord[];
  evidence: EvidenceDraftLike[];
  requirements?: EvidenceRequirementProjection[];
  cutoffMs?: number;
}) {
  return computeSourceCoverage(input);
}
