import { listSources, normalizeUrl, upsertSource } from "../../storage/db";
import { demoteUnverifiedEvidenceDrafts } from "./draft_normalize";
import {
  applyRegistryFreezeFields,
  orderByCapturePriority,
  syncStage03DraftSourcesFromRegistry,
} from "../gap_detection/supplement_pure";
import { captureSourceSnapshot } from "./source_snapshot";
import type { SourceRecord } from "../../schemas/types";
import { repairEvidencePreparationDraft } from "../../workflow/projections";

/**
 * Source Registry 是抓取冻结字段的唯一权威。
 * 补证/重新取得来源/upsert 拒绝降级后，草稿常残留旧 locator/quote/captured_at，
 * 确认时会被校验打成「与 Source Registry 不一致」。确认前与抓取后都必须投影回草稿。
 */
export async function applyStage03SourceSnapshots(input: {
  runId: string;
  data: any;
  affectedRefs: Set<string>;
  existingSources: SourceRecord[];
  maxNewSources?: number;
  cutoffMs?: number;
  /** 抓取预算按补证优先级消耗；缺省时保持原顺序 */
  capturePriorityKeys?: string[];
  assertRunning: () => void;
  onCaptureProgress?: (index: number, total: number) => void;
}) {
  const keyMap = new Map<string, string>();
  const sources = input.data.sources || [];
  // MCP 虚拟快照可能在模型工具环内刚写入 Registry，晚于调用方传入的
  // existingSources；抓取前必须重读，避免把已冻结 mcp:// 响应当公网 URL 重抓。
  const registrySources = listSources(input.runId);
  const allCaptureTargetsRaw = sources.filter((source: any) => {
    if (!source?.source_key || !source?.url) return false;
    // Registry 冻结值是已核验状态的权威，但对尚未核验/待修复来源，
    // 本轮补证带来的候选逐字引文必须保留到 captureSourceSnapshot 做正文对齐。
    // 否则旧的空 quote 会覆盖新 quote，形成重复抓取或“空引文已核验”。
    const proposedQuote = String(source.source_quote || "").trim();
    const proposedLocator = String(source.locator || "").trim();
    if (source.source_id) {
      const known = registrySources.find((item) => item.id === source.source_id);
      if (known) {
        Object.assign(source, applyRegistryFreezeFields(source, known));
        keyMap.set(source.source_key, source.source_id);
        if (
          known.usability_status === "usable"
          && known.retrieval_status === "captured"
          && Boolean(known.quote_verified)
        ) return false;
        if (input.affectedRefs.has(source.source_key)) {
          if (proposedQuote) source.source_quote = proposedQuote;
          if (proposedLocator) source.locator = proposedLocator;
          return true;
        }
        return Boolean(source.source_quote)
          && !(known.usability_status === "usable" && known.retrieval_status === "captured" && Boolean(known.quote_verified));
      }
      keyMap.set(source.source_key, source.source_id);
      return false;
    }
    if (input.affectedRefs.has(source.source_key)) return true;
    let normalized = "";
    try { normalized = normalizeUrl(source.url); } catch { normalized = source.url; }
    const existing = registrySources.find((item) => item.normalized_url === normalized);
    if (existing) {
      source.source_id = existing.id;
      Object.assign(source, applyRegistryFreezeFields(source, existing));
      keyMap.set(source.source_key, existing.id);
      if (proposedQuote) source.source_quote = proposedQuote;
      if (proposedLocator) source.locator = proposedLocator;
      return Boolean(source.source_quote)
        && !(existing.usability_status === "usable" && existing.retrieval_status === "captured" && Boolean(existing.quote_verified));
    }
    return true;
  });
  const allCaptureTargets = input.capturePriorityKeys?.length
    ? orderByCapturePriority(allCaptureTargetsRaw, input.capturePriorityKeys)
    : allCaptureTargetsRaw;
  const existingNormalizedUrls = new Set(registrySources.map((source) => source.normalized_url));
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
    // 单条来源抓取失败不应拖垮整批取证：隔离该来源、继续其余，
    // 避免一个坏链接/超时让已付费的整批模型调用作废并重放。失败源在后续
    // 轮次作为 failed / needs-repair 重新进入补证优先级队列。
    try {
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
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      Object.assign(source, {
        source_id: source.source_id ?? null,
        retrieval_status: "failed",
        usability_status: "rejected",
        quote_verified: false,
        captured_at: null,
        content_hash: null,
        failure_category: "source_acquisition_failure",
        failure_detail: `抓取中断（已隔离，不阻断其余来源）：${detail}`,
      });
      input.data.unresolved_gaps = [
        ...new Set([
          ...(Array.isArray(input.data.unresolved_gaps) ? input.data.unresolved_gaps.map(String) : []),
          `来源抓取失败已隔离：${source.source_key || source.url} — ${detail}`,
        ]),
      ];
    }
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
  return repairEvidencePreparationDraft(demoteUnverifiedEvidenceDrafts(projected.data, {
    cutoffMs: input.cutoffMs,
    registrySources: listSources(input.runId),
  }));
}
