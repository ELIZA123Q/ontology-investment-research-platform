import "server-only";

import { createHash } from "node:crypto";

export type SourceSnapshotInput = {
  url: string;
  locator?: string;
  source_quote?: string;
};

export type SourceSnapshot = {
  final_url: string;
  captured_at: string;
  content_hash: string;
  content_mime: string;
  http_status: number | null;
  retrieval_status: "captured" | "limited" | "failed";
  snapshot_text: string;
  source_quote: string;
  quote_verified: boolean;
  locator: string;
  usability_status: "usable" | "limited" | "rejected";
  failure_category: "" | "source_acquisition_failure";
  failure_detail: string;
};

export async function captureSourceSnapshot(input: SourceSnapshotInput): Promise<SourceSnapshot> {
  const capturedAt = new Date().toISOString();
  const quote = normalizeText(input.source_quote || "");
  try {
    assertPublicSourceUrl(input.url);
    const response = await fetchWithValidatedRedirects(input.url);
    const bytes = Buffer.from(await response.arrayBuffer());
    const mime = String(response.headers.get("content-type") || "application/octet-stream").split(";")[0].trim().toLowerCase();
    const text = isTextMime(mime) ? extractReadableText(bytes.toString("utf8"), mime) : "";
    const normalizedBody = normalizeText(text);
    const quoteVerified = Boolean(quote && normalizedBody.includes(quote));
    const captured = response.ok && bytes.length > 0;
    const usable = captured && text.length >= 200 && quoteVerified;
    const detail = !response.ok
      ? `HTTP ${response.status}`
      : !text
        ? `已抓取 ${mime} 字节并计算哈希，但未提取可定位正文`
        : !quote
          ? "未提供原文引用，不能升级为可直接支撑判断的来源"
          : !quoteVerified
            ? "原文引用未能在抓取正文中精确定位"
            : "";
    return {
      final_url: response.url || input.url,
      captured_at: capturedAt,
      content_hash: createHash("sha256").update(bytes).digest("hex"),
      content_mime: mime,
      http_status: response.status,
      retrieval_status: usable ? "captured" : captured ? "limited" : "failed",
      snapshot_text: text.slice(0, 200_000),
      source_quote: input.source_quote || "",
      quote_verified: quoteVerified,
      locator: input.locator || (quote ? `quote:${(input.source_quote || "").slice(0, 120)}` : input.url),
      usability_status: usable ? "usable" : captured ? "limited" : "rejected",
      failure_category: captured ? "" : "source_acquisition_failure",
      failure_detail: detail,
    };
  } catch (error) {
    return {
      final_url: input.url,
      captured_at: capturedAt,
      content_hash: "",
      content_mime: "",
      http_status: null,
      retrieval_status: "failed",
      snapshot_text: "",
      source_quote: input.source_quote || "",
      quote_verified: false,
      locator: input.locator || input.url,
      usability_status: "rejected",
      failure_category: "source_acquisition_failure",
      failure_detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export function assertPublicSourceUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("来源抓取只允许 http/https URL");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")
    || isNonPublicIpv4(host) || isNonPublicIpv6(host)) {
    throw new Error("拒绝抓取本机或私有网络地址");
  }
}

function isNonPublicIpv4(host: string) {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  const [a, b, c] = parts;
  return a === 0 || a === 10 || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && c <= 2)
    || (a === 198 && (b === 18 || b === 19 || b === 51))
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

function isNonPublicIpv6(host: string) {
  const normalized = host.toLowerCase();
  if (!normalized.includes(":")) return false;
  if (normalized === "::" || normalized === "::1" || normalized.startsWith("ff")
    || normalized.startsWith("fc") || normalized.startsWith("fd")
    || /^fe[89ab]/.test(normalized) || normalized.startsWith("2001:db8:")) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isNonPublicIpv4(mapped[1]) : false;
}

async function fetchWithValidatedRedirects(raw: string) {
  let current = raw;
  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    assertPublicSourceUrl(current);
    const response = await fetch(current, {
      redirect: "manual",
      headers: { "user-agent": "OntologyResearchWorkbench/1.1 (+verifiable-source-snapshot)" },
      signal: AbortSignal.timeout(20_000),
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      assertPublicSourceUrl(response.url || current);
      return response;
    }
    const location = response.headers.get("location");
    if (!location) throw new Error(`HTTP ${response.status} 缺少 Location`);
    current = new URL(location, current).toString();
    assertPublicSourceUrl(current);
  }
  throw new Error("来源重定向超过 5 次");
}

function isTextMime(mime: string) {
  return mime.startsWith("text/") || mime.includes("html") || mime.includes("xml") || mime.includes("json");
}

function extractReadableText(raw: string, mime: string) {
  if (!mime.includes("html") && !mime.includes("xml")) return normalizeText(raw);
  return normalizeText(raw
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'"));
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}
