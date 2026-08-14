import { describe, expect, it } from "vitest";
import { RuntimeStore } from "@/src/runtime/store";
import { ResearchProvenanceStore } from "@/src/semantic/provenance-store";
import { adaptSourceToolResult, type UnifiedSourceToolResult } from "@/src/tools/source-result-adapter";
import { verifySourceSnapshot } from "@/src/governance/provenance-verifier";

function financialResult(overrides: Partial<UnifiedSourceToolResult> = {}): UnifiedSourceToolResult {
  return {
    connectorId: "web.capture",
    operation: "company_guidance",
    requestParameters: { ticker: "2330.TW", asOf: "2026-08-09" },
    requestedAt: "2026-08-09T04:00:00.000Z",
    retrievedAt: "2026-08-09T04:00:01.000Z",
    upstream: {
      sourceId: "tsmc:2026-q2-earnings-call",
      uri: "https://investor.tsmc.com/english/quarterly-results/2026/q2",
      title: "TSMC 2026 Q2 Earnings Call",
      publisherId: "TSMC",
      publishedAt: "2026-07-17T06:00:00.000Z",
      sourceType: "primary",
    },
    capture: {
      body: JSON.stringify({ statement: "Management expects AI accelerator demand to remain robust." }),
      locator: "earnings-call:outlook:paragraph-4",
      quote: "Management expects AI accelerator demand to remain robust.",
      permissionScope: "public_research_use",
    },
    ...overrides,
  };
}

describe("unified source tool result adapter", () => {
  it("keeps the connector separate from the upstream source and persists a verifiable capture", () => {
    const store = new RuntimeStore(":memory:");
    try {
      const provenance = new ResearchProvenanceStore(store.db);
      const adapted = adaptSourceToolResult(financialResult());
      expect(adapted.candidate.discoveryReason).toContain("web.capture");
      expect(adapted.snapshot).toMatchObject({
        publisherId: "TSMC",
        acquisition: { connectorId: "web.capture", upstreamSourceId: "tsmc:2026-q2-earnings-call" },
      });
      expect(adapted.snapshot.acquisition.requestFingerprint).toMatch(/^sha256:/);
      expect(adapted.snapshot.acquisition.rawResponseHash).toBe(adapted.snapshot.contentHash);

      const snapshot = provenance.saveSnapshot(adapted.snapshot);
      expect(verifySourceSnapshot(snapshot).passed).toBe(true);
      expect(provenance.getSnapshot(snapshot.id)).toEqual(snapshot);
      expect(provenance.promoteFact({ snapshotId: snapshot.id, statement: snapshot.quote, factType: "forecast", confidence: "medium" }).status).toBe("verified");
    } finally {
      store.close();
    }
  });

  it("uses canonical request fingerprints and rejects incomplete capture boundaries", () => {
    const first = adaptSourceToolResult(financialResult()).snapshot.acquisition.requestFingerprint;
    const reordered = financialResult({ requestParameters: { asOf: "2026-08-09", ticker: "2330.TW" } });
    expect(adaptSourceToolResult(reordered).snapshot.acquisition.requestFingerprint).toBe(first);
    expect(() => adaptSourceToolResult(financialResult({
      capture: { body: "different body", quote: "unlocatable quote", locator: "p1", permissionScope: "public_research_use" },
    }))).toThrow(/cannot be located/);
    expect(() => adaptSourceToolResult(financialResult({ retrievedAt: "2026-08-09T03:59:59.000Z" }))).toThrow(/cannot precede/);
  });

  it("keeps a full public-document fingerprint separate from the located excerpt hash", () => {
    const rawHash = `sha256:${"a".repeat(64)}`;
    const adapted = adaptSourceToolResult(financialResult({
      capture: {
        body: "公告原文摘录：Management expects AI accelerator demand to remain robust.",
        locator: "page 3 / outlook",
        quote: "Management expects AI accelerator demand to remain robust.",
        permissionScope: "public_research_use",
        documentAttestation: { rawContentHash: rawHash, byteLength: 93_572, mimeType: "application/pdf" },
      },
    }));
    expect(adapted.snapshot.documentAttestation).toEqual({ rawContentHash: rawHash, byteLength: 93_572, mimeType: "application/pdf" });
    expect(adapted.snapshot.contentHash).not.toBe(rawHash);
    expect(verifySourceSnapshot({ ...adapted.snapshot, id: "snapshot:attested", verification: "verified" }).passed).toBe(true);
  });

  it("rejects partial, malformed, or conflated full-document attestations", () => {
    const base = financialResult();
    expect(() => adaptSourceToolResult({ ...base, capture: { ...base.capture, documentAttestation: { rawContentHash: `sha256:${"a".repeat(64)}`, mimeType: "application/pdf" } as never } })).toThrow(/byte_length/);
    expect(() => adaptSourceToolResult({ ...base, capture: { ...base.capture, documentAttestation: { rawContentHash: "sha256:not-a-hash", byteLength: 1, mimeType: "application/pdf" } } })).toThrow(/rawContentHash/);
    const conflated = adaptSourceToolResult(base);
    expect(verifySourceSnapshot({ ...conflated.snapshot, id: "snapshot:conflated", verification: "verified", documentAttestation: { rawContentHash: conflated.snapshot.contentHash, byteLength: 10, mimeType: "application/pdf" } }).passed).toBe(false);
  });
});
