import { normalizeAuthorityType } from "./authority_types";

const SOURCE_TIERS = new Set(["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"]);

export type SourceAcquisitionInput = {
  url: string;
  title: string;
  publisher: string;
  published_at: string;
  source_tier: string;
  authority_type: string;
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
    authority_type: String(body.authority_type || "").trim(),
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
  const authority = normalizeAuthorityType(input.authority_type);
  if (authority === "unknown") {
    throw new Error("必须选择来源权威类型（官方 / 公司披露 / 行业数据 / 公开二手）");
  }
  input.authority_type = authority;
  if (input.source_quote.length < 20) throw new Error("逐字引用至少 20 个字符，不能用搜索摘要代替");
  if (!input.locator) throw new Error("必须提供页内定位或引用定位");
  return input;
}
