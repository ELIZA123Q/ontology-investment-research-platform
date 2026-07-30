import { normalizeUrl, upsertSource } from "../adapters/db";
import { buildStage03AcquisitionQueries } from "./evidence_acquisition_planning";
import { selectEvidenceSnapshotExcerpt } from "./evidence_supplement_pure";
import {
  compileEvidenceAcquisitionPlan,
  governedProducerForUrl,
  type EvidenceAcquisitionPlan,
} from "./evidence_source_routes";
import type { EvidenceRequirementProjection } from "./structure_candidates";
import type { SourceRecord } from "./types";

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

function governedDiscoveredSourceFromPlan(
  url: string,
  plan?: EvidenceAcquisitionPlan,
): {
  sourceTier: "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7" | "S8";
  authorityType: "official" | "company_disclosure" | "industry_provider" | "public_secondary" | "unknown";
  sourceType: "official_document" | "company_disclosure" | "industry_research" | "public_secondary";
} | undefined {
  const producer = governedProducerForUrl(url, plan);
  if (producer) {
    return {
      sourceTier: producer.tier,
      authorityType: producer.authority_type,
      sourceType: producer.authority_type === "official"
        ? "official_document"
        : producer.authority_type === "company_disclosure"
          ? "company_disclosure"
          : producer.authority_type === "industry_provider"
            ? "industry_research"
            : "public_secondary",
    };
  }
  if (plan?.allowed_producers.length) return undefined;
  return governedDiscoveredSource(url);
}

function inferPublishedAt(result: Record<string, unknown>): string | null {
  const explicit = String(result.published_at || "").trim();
  if (explicit && Number.isFinite(Date.parse(explicit))) return new Date(Date.parse(explicit)).toISOString();
  const text = `${String(result.url || "")} ${String(result.title || "")} ${String(result.content_excerpt || "").slice(0, 2_000)}`;
  const iso = text.match(/\b(20\d{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])\b/);
  if (iso) {
    const parsed = Date.parse(`${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}T00:00:00Z`);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  const english = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+([0-3]?\d),?\s+(20\d{2})\b/i);
  if (english) {
    const parsed = Date.parse(`${english[1]} ${english[2]}, ${english[3]} UTC`);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return null;
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
  structure?: any;
  cutoffMs?: number;
  search?: (
    args: Record<string, unknown>,
    citations: Array<{ url: string; title: string }>,
  ) => Promise<{ results: Array<Record<string, unknown>> }>;
}) {
  const acquisitionPlan = compileEvidenceAcquisitionPlan({
    question: input.question,
    structure: input.structure,
    requirements: input.requirements,
    targetUnitIds: input.targetUnitIds,
    cutoffMs: input.cutoffMs,
    maxQueries: 4,
  });
  const queries = acquisitionPlan.tasks.length
    ? acquisitionPlan.queries
    : buildStage03AcquisitionQueries(input);
  const activeExistingSourceCount = input.existingSources.filter((source) => source.usability_status !== "rejected").length;
  const availableBudget = input.maxSourceCount === undefined
    ? 4
    : Math.max(0, input.maxSourceCount - activeExistingSourceCount);
  const sourceBudget = Math.min(4, availableBudget);
  if (!queries.length || sourceBudget < 1) {
    return {
      plan: acquisitionPlan,
      queries,
      sources: [] as SourceRecord[],
      error: sourceBudget < 1
        ? "来源预算已用尽"
        : acquisitionPlan.gap_details.map((gap) => gap.detail).join("；"),
    };
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
      const governed = governedDiscoveredSourceFromPlan(normalizedUrl, acquisitionPlan);
      if (!governed) continue;
      priorUrls.add(normalizedUrl);
      let publisher = "公开网页";
      try { publisher = new URL(normalizedUrl).hostname.replace(/^www\./, ""); } catch { /* keep fallback */ }
      const excerpt = String(result.content_excerpt || "");
      const captured = excerpt.length > 0 && String(result.retrieval_status || "") !== "failed";
      const publishedAt = inferPublishedAt(result);
      const exactQuote = captured
        ? selectEvidenceSnapshotExcerpt({
          snapshotText: excerpt,
          title: String(result.title || normalizedUrl),
          requirements: input.requirements,
          maxChars: 900,
        }).trim()
        : "";
      const quoteVerified = exactQuote.length >= 20;
      const beforeCutoff = !publishedAt
        || !Number.isFinite(input.cutoffMs)
        || Date.parse(publishedAt) <= input.cutoffMs!;
      const usable = captured && quoteVerified && Boolean(publishedAt) && beforeCutoff;
      sources.push(upsertSource(input.runId, {
        url: normalizedUrl,
        title: String(result.title || normalizedUrl),
        publisher,
        published_at: publishedAt,
        source_type: governed.sourceType,
        source_tier: governed.sourceTier,
        authority_type: governed.authorityType,
        search_excerpt: String(result.summary || ""),
        locator: quoteVerified ? `snapshot:${exactQuote.slice(0, 120)}` : String(result.locator_hint || result.final_url || normalizedUrl),
        captured_at: new Date().toISOString(),
        content_hash: String(result.content_hash || ""),
        usability_status: usable ? "usable" : captured ? "limited" : "rejected",
        failure_category: captured ? "" : "source_acquisition_failure",
        failure_detail: String(result.retrieval_error || (
          !captured
            ? "候选正文抓取失败"
            : !quoteVerified
              ? "正文已抓取，但未找到足够长的逐字引文"
              : !publishedAt
                ? "正文与逐字引文已冻结，但无法确定公开时间"
                : !beforeCutoff
                  ? "来源发布时间晚于研究截止时间"
                  : ""
        )),
        final_url: String(result.final_url || normalizedUrl),
        content_mime: "text/html",
        http_status: null,
        retrieval_status: captured ? "captured" : "failed",
        snapshot_text: excerpt,
        source_quote: quoteVerified ? exactQuote : "",
        quote_verified: quoteVerified,
      }));
    }
    return { plan: acquisitionPlan, queries, sources, error: "" };
  } catch (error) {
    return {
      plan: acquisitionPlan,
      queries,
      sources: [] as SourceRecord[],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
