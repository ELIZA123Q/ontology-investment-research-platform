import "server-only";

import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isReadableEvidenceText } from "../expression_audit/text_quality";

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

type PublicAddress = { address: string; family: 4 | 6 };
type PinnedResponse = {
  status: number;
  ok: boolean;
  headers: Headers;
  url: string;
  arrayBuffer(): Promise<ArrayBuffer>;
};
type SourceSnapshotDependencies = {
  resolveHost: (host: string) => Promise<PublicAddress[]>;
  requestResolved: (url: string, addresses: PublicAddress[]) => Promise<PinnedResponse>;
};

const defaultDependencies: SourceSnapshotDependencies = {
  resolveHost: resolveHostWithoutSyntheticProxyMapping,
  requestResolved: requestPinnedPublicUrl,
};
let testDependencies: SourceSnapshotDependencies | null = null;

export function setSourceSnapshotDependenciesForTests(dependencies: SourceSnapshotDependencies | null) {
  if (process.env.NODE_ENV !== "test") throw new Error("来源传输依赖只能在测试环境替换");
  testDependencies = dependencies;
}

export async function captureSourceSnapshot(
  input: SourceSnapshotInput,
  dependencies: SourceSnapshotDependencies = testDependencies || defaultDependencies,
): Promise<SourceSnapshot> {
  const capturedAt = new Date().toISOString();
  const quote = normalizeText(input.source_quote || "");
  try {
    assertPublicSourceUrl(input.url);
    const response = await fetchWithValidatedRedirects(input.url, dependencies);
    const bytes = Buffer.from(await response.arrayBuffer());
    const mime = String(response.headers.get("content-type") || "application/octet-stream").split(";")[0].trim().toLowerCase();
    const text = isTextMime(mime) ? extractReadableText(bytes.toString("utf8"), mime) : "";
    const normalizedBody = normalizeText(text);
    const aligned = alignQuoteToBody(quote, normalizedBody);
    const quoteReadable = isReadableEvidenceText(quote);
    const quoteVerified = quoteReadable && aligned.verified;
    const alignedQuote = aligned.alignedQuote || quote;
    const captured = response.ok && bytes.length > 0;
    const usable = captured && text.length >= 200 && quoteVerified;
    const detail = !response.ok
      ? `HTTP ${response.status}`
      : !text
        ? `已抓取 ${mime} 字节并计算哈希，但未提取可定位正文`
        : !quote
          ? "未提供原文引用，不能升级为可直接支撑判断的来源"
          : !quoteReadable
            ? "原文引用含编码乱码或不可读控制字符，不能作为可核验证据"
          : !quoteVerified
            ? "原文引用未能在抓取正文中精确定位"
            : "";
    return {
      final_url: response.url || input.url,
      captured_at: capturedAt,
      content_hash: createHash("sha256").update(bytes).digest("hex"),
      content_mime: mime,
      http_status: response.status,
      // retrieval_status 只表达传输/正文冻结是否成功；引文是否可用由
      // quote_verified + usability_status 表达。过去把“已抓正文但没引文”
      // 记成 limited，导致 Runtime 误判为 fetch=0/正文未取得。
      retrieval_status: captured ? "captured" : "failed",
      snapshot_text: text.slice(0, 200_000),
      // 标点折叠命中时改存正文逐字片段，避免后续重核验/展示仍用“带逗号的改写句”。
      source_quote: quoteVerified ? alignedQuote : (input.source_quote || ""),
      quote_verified: quoteVerified,
      locator: input.locator || (alignedQuote ? `quote:${alignedQuote.slice(0, 120)}` : input.url),
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

async function resolvePublicDns(raw: string, resolveHost: SourceSnapshotDependencies["resolveHost"]) {
  assertPublicSourceUrl(raw);
  const url = new URL(raw);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const addresses = await resolveHost(host);
  if (!addresses.length) throw new Error("来源域名没有可用 DNS 记录");
  const nonPublic = addresses.find(({ address, family }) => family === 4 ? isNonPublicIpv4(address) : isNonPublicIpv6(address));
  if (nonPublic) throw new Error(`拒绝抓取解析到本机或私有网络的域名（${nonPublic.address}）`);
  return addresses;
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

function isSyntheticProxyIpv4(host: string) {
  const parts = host.split(".").map(Number);
  return parts.length === 4 && parts[0] === 198 && (parts[1] === 18 || parts[1] === 19);
}

async function resolveHostWithoutSyntheticProxyMapping(host: string): Promise<PublicAddress[]> {
  const system = (await lookup(host, { all: true, verbatim: true })) as PublicAddress[];
  // Some local network agents deliberately synthesize 198.18/15 for every
  // public hostname. It is unsafe to allow that reserved range as a target.
  // Resolve the same hostname through a fixed DoH service and pin only the
  // returned globally routable addresses instead.
  if (system.length && system.every((item) => item.family === 4 && isSyntheticProxyIpv4(item.address))) {
    return resolveViaTrustedDoh(host);
  }
  return system;
}

async function resolveViaTrustedDoh(host: string): Promise<PublicAddress[]> {
  const endpoint = "https://cloudflare-dns.com/dns-query";
  const payloads = await Promise.all(["A", "AAAA"].map(async (type) => {
    const response = await fetch(`${endpoint}?name=${encodeURIComponent(host)}&type=${type}`, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`可信 DoH 查询失败 (${response.status})`);
    return response.json();
  }));
  const addresses = parsePublicDohAnswers(payloads);
  if (!addresses.length) throw new Error("可信 DoH 未返回可用公网 A/AAAA 记录");
  return addresses;
}

export function parsePublicDohAnswers(payloads: unknown[]): PublicAddress[] {
  const result: PublicAddress[] = [];
  for (const payload of payloads) {
    const answers = payload && typeof payload === "object" && Array.isArray((payload as any).Answer)
      ? (payload as any).Answer : [];
    for (const answer of answers) {
      if (answer?.type === 1 && typeof answer.data === "string") result.push({ address: answer.data, family: 4 });
      if (answer?.type === 28 && typeof answer.data === "string") result.push({ address: answer.data, family: 6 });
    }
  }
  const unique = [...new Map(result.map((item) => [`${item.family}:${item.address}`, item])).values()];
  const forbidden = unique.find((item) => item.family === 4 ? isNonPublicIpv4(item.address) : isNonPublicIpv6(item.address));
  if (forbidden) throw new Error(`可信 DoH 返回非公网地址（${forbidden.address}）`);
  return unique;
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

async function fetchWithValidatedRedirects(raw: string, dependencies: SourceSnapshotDependencies) {
  let current = raw;
  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    const addresses = await resolvePublicDns(current, dependencies.resolveHost);
    // The actual socket is opened through the exact addresses validated above.
    // This closes the DNS-rebinding/TOCTOU gap that exists when validation and
    // `fetch()` perform two independent DNS lookups.
    const response = await dependencies.requestResolved(current, addresses);
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response;
    }
    const location = response.headers.get("location");
    if (!location) throw new Error(`HTTP ${response.status} 缺少 Location`);
    current = new URL(location, current).toString();
    assertPublicSourceUrl(current);
  }
  throw new Error("来源重定向超过 5 次");
}

async function requestPinnedPublicUrl(raw: string, addresses: PublicAddress[]): Promise<PinnedResponse> {
  let lastError: unknown;
  for (const address of addresses) {
    try {
      return await requestSingleAddress(raw, address);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`已验证公网地址均无法连接：${lastError instanceof Error ? lastError.message : String(lastError || "未知错误")}`);
}

function requestSingleAddress(raw: string, pinned: PublicAddress): Promise<PinnedResponse> {
  const url = new URL(raw);
  const requestFunction = url.protocol === "https:" ? https.request : http.request;
  return new Promise((resolve, reject) => {
    const request = requestFunction(url, {
      method: "GET",
      headers: {
        "user-agent": "OntologyResearchWorkbench/1.2 (+pinned-verifiable-source-snapshot)",
        "accept-encoding": "identity",
      },
      // Preserve the URL hostname for TLS/SNI while forcing the validated IP
      // into the socket. Node may request either one result or an `all` array.
      lookup: (_hostname, options, callback) => {
        const wantsAll = typeof options === "object" && Boolean(options?.all);
        if (wantsAll) (callback as any)(null, [pinned]);
        else (callback as any)(null, pinned.address, pinned.family);
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      let byteLength = 0;
      const maximumBytes = 10 * 1024 * 1024;
      response.on("data", (chunk: Buffer | string) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        byteLength += bytes.length;
        if (byteLength > maximumBytes) {
          request.destroy(new Error(`来源正文超过 ${maximumBytes} 字节安全上限`));
          return;
        }
        chunks.push(bytes);
      });
      response.on("end", () => {
        const body = Buffer.concat(chunks);
        const headers = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) headers.append(name, String(item));
        }
        const status = response.statusCode || 0;
        resolve({
          status,
          ok: status >= 200 && status < 300,
          headers,
          url: raw,
          arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
        });
      });
    });
    request.setTimeout(20_000, () => request.destroy(new Error("来源连接超过 20000ms")));
    request.on("error", reject);
    request.end();
  });
}

function isTextMime(mime: string) {
  return mime.startsWith("text/") || mime.includes("html") || mime.includes("xml") || mime.includes("json");
}

function extractReadableText(raw: string, mime: string) {
  if (!mime.includes("html") && !mime.includes("xml")) return normalizeText(raw);
  return normalizeText(decodeHtmlEntities(raw
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")));
}

function decodeHtmlEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: "\"",
    ensp: " ", emsp: " ", thinsp: " ", ndash: "–", mdash: "—",
  };
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, digits: string) => safeCodePoint(Number.parseInt(digits, 16)))
    .replace(/&#(\d+);/g, (_match, digits: string) => safeCodePoint(Number.parseInt(digits, 10)))
    .replace(/&([a-z]+);/gi, (match, entity: string) => named[entity.toLowerCase()] ?? match);
}

function safeCodePoint(value: number) {
  try { return Number.isInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : " "; }
  catch { return " "; }
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * 轻量标点折叠：去掉中英文逗号/句号差异与引号差异后再比连续子串。
 * 不做语义模糊匹配——改写后的句子仍应失败。
 */
function foldPunctuation(value: string) {
  return normalizeText(value)
    .replace(/[\u201c\u201d\u2018\u2019"'「」『』]/g, "")
    .replace(/[,，.。;；:：!！?？、]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 用 quote 中的数字/长词锚点，从正文切回一段连续原文。
 * 解决维基信息框「模型加了逗号、正文无逗号」这类近失配。
 */
export function recoverQuoteSpanFromBody(quote: string, body: string): string | null {
  const normalizedQuote = normalizeText(quote);
  const normalizedBody = normalizeText(body);
  if (!normalizedQuote || !normalizedBody) return null;
  if (normalizedBody.includes(normalizedQuote)) return normalizedQuote;

  const tokens = normalizedQuote
    .split(/[\s,，/|]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  if (tokens.length < 2) return null;

  const digitTokens = tokens.filter((token) => /\d/.test(token));
  const significantDigits = digitTokens.filter((token) => !/^\(?20\d{2}\)?$/.test(token) && !/^20\d{2}$/.test(token));
  const anchors = significantDigits.length >= 2
    ? significantDigits
    : digitTokens.length >= 2
      ? digitTokens
      : tokens;
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  let start = normalizedBody.indexOf(first);
  if (start < 0) return null;
  let end = normalizedBody.indexOf(last, start + first.length);
  if (end < 0) return null;
  end = end + last.length;

  // 向左扩展：把 “Revenue US$” 这类非数字前缀也纳入正文切片。
  const firstAnchorIdx = Math.max(0, tokens.indexOf(first));
  for (let index = firstAnchorIdx - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    const probe = normalizedBody.lastIndexOf(token, start);
    if (probe < 0 || start - (probe + token.length) > 2) break;
    start = probe;
  }
  // 向右扩展：纳入末尾单位词等。
  const lastAnchorIdx = Math.max(0, tokens.lastIndexOf(last));
  for (let index = lastAnchorIdx + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    const probe = normalizedBody.indexOf(token, end);
    if (probe < 0 || probe - end > 2) break;
    end = probe + token.length;
  }

  const span = normalizedBody.slice(start, end).trim();
  if (span.length < 20 || span.length > Math.max(normalizedQuote.length * 4, 480)) return null;

  const requiredDigits = significantDigits.length ? significantDigits : digitTokens;
  if (requiredDigits.length) {
    const hits = requiredDigits.filter((token) => span.includes(token)).length;
    if (hits < Math.ceil(requiredDigits.length * 0.7)) return null;
  }

  const foldedQuote = foldPunctuation(normalizedQuote);
  const foldedSpan = foldPunctuation(span);
  if (!foldedQuote || (!foldedSpan.includes(foldedQuote) && !foldedQuote.includes(foldedSpan))) {
    // 数字锚点命中且跨度合理时也接受；否则要求折叠后互含。
    if (!requiredDigits.length || requiredDigits.filter((token) => span.includes(token)).length < requiredDigits.length) {
      return null;
    }
  }
  return span;
}

export function alignQuoteToBody(quote: string, body: string): { verified: boolean; alignedQuote: string } {
  const normalizedQuote = normalizeText(quote);
  const normalizedBody = normalizeText(body);
  if (!normalizedQuote) return { verified: false, alignedQuote: quote };
  if (normalizedBody.includes(normalizedQuote)) {
    return { verified: true, alignedQuote: normalizedQuote };
  }

  const foldedQuote = foldPunctuation(normalizedQuote);
  const foldedBody = foldPunctuation(normalizedBody);
  if (foldedQuote && foldedBody.includes(foldedQuote)) {
    const recovered = recoverQuoteSpanFromBody(normalizedQuote, normalizedBody);
    return { verified: true, alignedQuote: recovered || normalizedQuote };
  }

  const recovered = recoverQuoteSpanFromBody(normalizedQuote, normalizedBody);
  if (recovered && quoteMatchesBody(recovered, normalizedBody)) {
    return { verified: true, alignedQuote: recovered };
  }
  return { verified: false, alignedQuote: quote };
}

/** 先精确子串，再标点折叠后子串；仍要求连续命中。 */
export function quoteMatchesBody(quote: string, body: string): boolean {
  return alignQuoteToBody(quote, body).verified;
}
