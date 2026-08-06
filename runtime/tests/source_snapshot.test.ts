import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { captureSourceSnapshot, parsePublicDohAnswers } from "@/skills/evidence_evaluation/source_snapshot";

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

  it("does not mark a fetched page usable when the quote cannot be located", async () => {
    const snapshot = await captureSourceSnapshot({
      url: "https://example.com/source",
      source_quote: "missing exact quote",
    }, dependencies(async () => new Response(`<p>${"available body ".repeat(40)}</p>`, { status: 200, headers: { "content-type": "text/html" } })));
    expect(snapshot.usability_status).toBe("limited");
    expect(snapshot.quote_verified).toBe(false);
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
});
