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
      const excerpt = snapshot.slice(0, 1200);
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
