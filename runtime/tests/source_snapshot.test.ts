import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { captureSourceSnapshot, parsePublicDohAnswers, quoteMatchesBody } from "@/engine/source_snapshot";

type TestAddress = { address: string; family: 4 | 6 };
const publicAddress: TestAddress = { address: "93.184.216.34", family: 4 };
function dependencies(requestResolved: (url: string, addresses: TestAddress[]) => Promise<Response>) {
  return {
    resolveHost: async (host: string) => [{
      address: host === "private.example" ? "127.0.0.1" : publicAddress.address,
      family: 4 as const,
    }],
    requestResolved,
  };
}

describe("verifiable source snapshots", () => {
  it("accepts only globally routable A/AAAA records from the trusted DoH fallback", () => {
    expect(parsePublicDohAnswers([
      { Answer: [{ type: 5, data: "alias.example" }, { type: 1, data: "52.195.104.153" }] },
      { Answer: [{ type: 28, data: "2606:4700::6810:1" }] },
    ])).toEqual([
      { address: "52.195.104.153", family: 4 },
      { address: "2606:4700::6810:1", family: 6 },
    ]);
    expect(() => parsePublicDohAnswers([{ Answer: [{ type: 1, data: "127.0.0.1" }] }])).toThrow(/非公网地址/);
    expect(() => parsePublicDohAnswers([{ Answer: [{ type: 1, data: "198.18.0.30" }] }])).toThrow(/非公网地址/);
  });

  it("hashes fetched body and verifies an exact quote", async () => {
    const body = `<html><body><article>${"公司披露本季度渠道库存同比下降。".repeat(20)}</article></body></html>`;
    const quote = "公司披露本季度渠道库存同比下降。";
    const request = vi.fn(async () => new Response(body, { status: 200, headers: { "content-type": "text/html;charset=utf-8" } }));
    const snapshot = await captureSourceSnapshot({
      url: "https://example.com/source",
      source_quote: quote,
      locator: `quote:${quote}`,
    }, dependencies(request));
    expect(snapshot).toMatchObject({ retrieval_status: "captured", usability_status: "usable", quote_verified: true });
    expect(snapshot.content_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.snapshot_text).toContain(quote);
    expect(request).toHaveBeenCalledWith("https://example.com/source", [publicAddress]);
  });

  it("rejects an exactly matched quote when the frozen text contains encoding damage", async () => {
    const damaged = "��˾2024��Ӫҵ����Լ90.65��Ԫ";
    const snapshot = await captureSourceSnapshot({
      url: "https://example.com/source",
      source_quote: damaged,
    }, dependencies(async () => new Response(`<p>${damaged.repeat(20)}</p>`, {
      status: 200,
      headers: { "content-type": "text/html" },
    })));
    expect(snapshot.quote_verified).toBe(false);
    expect(snapshot.usability_status).toBe("limited");
    expect(snapshot.failure_detail).toContain("编码乱码");
  });

  it("does not mark a fetched page usable when the quote cannot be located", async () => {
    const snapshot = await captureSourceSnapshot({
      url: "https://example.com/source",
      source_quote: "missing exact quote",
    }, dependencies(async () => new Response(`<p>${"available body ".repeat(40)}</p>`, { status: 200, headers: { "content-type": "text/html" } })));
    expect(snapshot.retrieval_status).toBe("captured");
    expect(snapshot.usability_status).toBe("limited");
    expect(snapshot.quote_verified).toBe(false);
  });

  it("records body capture separately from quote verification when no quote is supplied", async () => {
    const snapshot = await captureSourceSnapshot({
      url: "https://example.com/source",
    }, dependencies(async () => new Response(`<p>${"captured body ".repeat(40)}</p>`, {
      status: 200,
      headers: { "content-type": "text/html" },
    })));
    expect(snapshot).toMatchObject({
      retrieval_status: "captured",
      usability_status: "limited",
      quote_verified: false,
    });
    expect(snapshot.snapshot_text.length).toBeGreaterThan(200);
  });

  it("decodes decimal and hexadecimal HTML entities before exact-quote verification", async () => {
    const sentence = "Our net revenue in 2024 increased by 33.9% from 2023.";
    const body = `<html><body>${"context &#160;".repeat(30)}Our net revenue in 2024 increased by 33.9&#37; from 2023.${" &#x20;context".repeat(30)}</body></html>`;
    const snapshot = await captureSourceSnapshot(
      { url: "https://example.com/filing", source_quote: sentence },
      dependencies(async () => new Response(body, { status: 200, headers: { "content-type": "text/html" } })),
    );
    expect(snapshot).toMatchObject({ retrieval_status: "captured", usability_status: "usable", quote_verified: true });
    expect(snapshot.snapshot_text).toContain(sentence);
  });

  it("rejects local and private network targets", async () => {
    const snapshot = await captureSourceSnapshot({ url: "http://127.0.0.1/internal", source_quote: "x" });
    expect(snapshot).toMatchObject({ retrieval_status: "failed", usability_status: "rejected" });
    expect(snapshot.failure_detail).toMatch(/私有网络/);
    const mapped = await captureSourceSnapshot({ url: "http://[::ffff:127.0.0.1]/internal", source_quote: "x" });
    expect(mapped).toMatchObject({ retrieval_status: "failed", usability_status: "rejected" });
    const resolvedPrivate = await captureSourceSnapshot(
      { url: "https://private.example/internal", source_quote: "x" },
      dependencies(async () => new Response("should not be called")),
    );
    expect(resolvedPrivate).toMatchObject({ retrieval_status: "failed", usability_status: "rejected" });
    expect(resolvedPrivate.failure_detail).toMatch(/解析到本机或私有网络/);
  });

  it("revalidates every redirect target and blocks a public-to-private redirect", async () => {
    const requestMock = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/internal" },
    }));
    const snapshot = await captureSourceSnapshot({
      url: "https://example.com/redirect",
      source_quote: "x",
    }, dependencies(requestMock));
    expect(snapshot).toMatchObject({ retrieval_status: "failed", usability_status: "rejected" });
    expect(snapshot.failure_detail).toMatch(/私有网络/);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("accepts quotes that only differ by punctuation or quotes from the body", async () => {
    const bodyCore = "Revenue US$ 37.4 billion (2025) Operating income US$ 8.3 billion";
    const body = `<html><body><article>${"pad ".repeat(40)}${bodyCore}${" pad".repeat(40)}</article></body></html>`;
    const quoteWithComma = "Revenue US$ 37.4 billion (2025), Operating income US$ 8.3 billion";
    const snapshot = await captureSourceSnapshot({
      url: "https://example.com/wiki",
      source_quote: quoteWithComma,
    }, dependencies(async () => new Response(body, { status: 200, headers: { "content-type": "text/html" } })));
    expect(snapshot).toMatchObject({ quote_verified: true, usability_status: "usable" });
    // 对齐后应存正文逐字片段（无自造逗号）
    expect(snapshot.source_quote).toContain("Revenue US$ 37.4 billion (2025)");
    expect(snapshot.source_quote).not.toContain("billion (2025), Operating");

    const quotedBody = `<html><body>${"x ".repeat(80)}"experienced sharp HBM price increases"${" y".repeat(80)}</body></html>`;
    const paraphrasedOpen = await captureSourceSnapshot({
      url: "https://example.com/hbm",
      source_quote: "experienced sharp HBM price increases",
    }, dependencies(async () => new Response(quotedBody, { status: 200, headers: { "content-type": "text/html" } })));
    expect(paraphrasedOpen).toMatchObject({ quote_verified: true, usability_status: "usable" });
  });

  it("aligns Micron-style comma-joined table quotes to continuous body text", async () => {
    const { alignQuoteToBody, recoverQuoteSpanFromBody } = await import("@/engine/source_snapshot");
    const body = "Revenue US$ 37.4 billion (2025) Operating income US$9.77 billion (2025) Net income US$8.54 billion (2025) Total assets US$82.8 billion (2025)";
    const quote = "Revenue US$ 37.4 billion (2025), Operating income US$9.77 billion (2025), Net income US$8.54 billion (2025), Total assets US$82.8 billion (2025)";
    expect(quoteMatchesBody(quote, body)).toBe(true);
    const aligned = alignQuoteToBody(quote, body);
    expect(aligned.verified).toBe(true);
    expect(aligned.alignedQuote).toBe(body);
    expect(recoverQuoteSpanFromBody(quote, body)).toBe(body);
  });

  it("still rejects rewritten quotes that are not continuous substrings", async () => {
    expect(quoteMatchesBody(
      "DRAM price has risen sharply this quarter",
      "HBM contract prices increased significantly during the quarter",
    )).toBe(false);
    const body = `<html><body>${"available body ".repeat(40)}</body></html>`;
    const snapshot = await captureSourceSnapshot({
      url: "https://example.com/source",
      source_quote: "DRAM price has risen sharply this quarter",
    }, dependencies(async () => new Response(body, { status: 200, headers: { "content-type": "text/html" } })));
    expect(snapshot.quote_verified).toBe(false);
    expect(snapshot.usability_status).toBe("limited");
  });
});
