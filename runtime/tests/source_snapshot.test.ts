import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { captureSourceSnapshot } from "@/engine/source_snapshot";

describe("verifiable source snapshots", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("hashes fetched body and verifies an exact quote", async () => {
    const body = `<html><body><article>${"公司披露本季度渠道库存同比下降。".repeat(20)}</article></body></html>`;
    const quote = "公司披露本季度渠道库存同比下降。";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200, headers: { "content-type": "text/html;charset=utf-8" } })));
    const snapshot = await captureSourceSnapshot({
      url: "https://example.com/source",
      source_quote: quote,
      locator: `quote:${quote}`,
    });
    expect(snapshot).toMatchObject({ retrieval_status: "captured", usability_status: "usable", quote_verified: true });
    expect(snapshot.content_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.snapshot_text).toContain(quote);
  });

  it("does not mark a fetched page usable when the quote cannot be located", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`<p>${"available body ".repeat(40)}</p>`, { status: 200, headers: { "content-type": "text/html" } })));
    const snapshot = await captureSourceSnapshot({
      url: "https://example.com/source",
      source_quote: "missing exact quote",
    });
    expect(snapshot.usability_status).toBe("limited");
    expect(snapshot.quote_verified).toBe(false);
  });

  it("rejects local and private network targets", async () => {
    const snapshot = await captureSourceSnapshot({ url: "http://127.0.0.1/internal", source_quote: "x" });
    expect(snapshot).toMatchObject({ retrieval_status: "failed", usability_status: "rejected" });
    expect(snapshot.failure_detail).toMatch(/私有网络/);
    const mapped = await captureSourceSnapshot({ url: "http://[::ffff:127.0.0.1]/internal", source_quote: "x" });
    expect(mapped).toMatchObject({ retrieval_status: "failed", usability_status: "rejected" });
  });

  it("revalidates every redirect target and blocks a public-to-private redirect", async () => {
    const fetchMock = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/internal" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const snapshot = await captureSourceSnapshot({
      url: "https://example.com/redirect",
      source_quote: "x",
    });
    expect(snapshot).toMatchObject({ retrieval_status: "failed", usability_status: "rejected" });
    expect(snapshot.failure_detail).toMatch(/私有网络/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
