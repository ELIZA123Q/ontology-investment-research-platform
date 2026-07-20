import "server-only";

import { getRun, upsertSource } from "../adapters/db";
import { captureSourceSnapshot } from "./source_snapshot";

const SOURCE_TIERS = new Set(["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"]);

export type SourceAcquisitionInput = {
  url: string;
  title: string;
  publisher: string;
  published_at: string;
  source_tier: string;
  source_group?: string;
  source_quote: string;
  locator: string;
};

export function normalizeSourceAcquisitionInput(value: unknown): SourceAcquisitionInput {
  const body = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const input = {
    url: String(body.url || "").trim(),
    title: String(body.title || "").trim(),
    publisher: String(body.publisher || "").trim(),
    published_at: String(body.published_at || "").trim(),
    source_tier: String(body.source_tier || "S8").trim().toUpperCase(),
    source_group: String(body.source_group || "").trim() || undefined,
    source_quote: String(body.source_quote || "").replace(/\s+/g, " ").trim(),
    locator: String(body.locator || "").trim(),
  };
  let url: URL;
  try { url = new URL(input.url); } catch { throw new Error("来源 URL 无效"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("来源 URL 只允许 http/https");
  if (!input.title) throw new Error("来源标题不能为空");
  if (!input.publisher) throw new Error("发布者不能为空");
  if (!Number.isFinite(Date.parse(input.published_at))) throw new Error("published_at 必须是可解析的发布日期");
  if (!SOURCE_TIERS.has(input.source_tier)) throw new Error("source_tier 必须是 S1—S8");
  if (input.source_quote.length < 20) throw new Error("逐字引用至少 20 个字符，不能用搜索摘要代替");
  if (!input.locator) throw new Error("必须提供页内定位或引用定位");
  return input;
}

export async function acquirePublicSource(runId: string, raw: unknown) {
  if (!getRun(runId)) throw new Error("研究任务不存在");
  const input = normalizeSourceAcquisitionInput(raw);
  const snapshot = await captureSourceSnapshot({
    url: input.url,
    locator: input.locator,
    source_quote: input.source_quote,
  });
  const source = upsertSource(runId, {
    url: input.url,
    title: input.title,
    publisher: input.publisher,
    published_at: new Date(input.published_at).toISOString(),
    source_type: "user_supplied_public_evidence",
    source_tier: input.source_tier as SourceAcquisitionInput["source_tier"] & ("S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7" | "S8"),
    source_group: input.source_group || input.publisher,
    search_excerpt: "研究者明确提供；仍须由 Stage03 形成事实草稿并逐项审阅",
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
  const accepted = source.retrieval_status === "captured"
    && source.usability_status === "usable"
    && Boolean(source.quote_verified)
    && /^[a-f0-9]{64}$/.test(source.content_hash || "");
  return {
    accepted,
    source: { ...source, snapshot_text: undefined, snapshot_length: source.snapshot_text?.length || 0 },
    boundary: "已取得来源只进入 Source Registry；必须由 Stage03 绑定为事实草稿并经人工批准后，才能参与判断。",
  };
}
