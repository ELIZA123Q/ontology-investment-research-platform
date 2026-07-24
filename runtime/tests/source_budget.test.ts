import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
process.env.WORKBENCH_DB_PATH = `/tmp/ontology-workbench-source-budget-${process.pid}.sqlite`;

describe("run-level source budget", () => {
  it("keeps over-budget candidates as explicit gaps without fetching or registering them", async () => {
    const { applyStage03SourceSnapshots } = await import("@/engine/evidence_auto_supplement");
    const data = {
      sources: [{
        source_id: null,
        source_key: "SRC-CANDIDATE",
        url: "https://example.com/new",
        title: "候选来源",
        publisher: "Example",
        published_at: "2026-01-01T00:00:00.000Z",
        source_tier: "S2",
        authority_type: "public_secondary",
        source_type: "web_citation",
        search_excerpt: "candidate",
        locator: "https://example.com/new",
        source_quote: "candidate quote",
        captured_at: null,
        content_hash: null,
        final_url: null,
        retrieval_status: null,
        quote_verified: null,
      }],
      evidence_drafts: [{ source_keys: ["SRC-CANDIDATE"], source_ids: [] }],
      unresolved_gaps: [],
    };

    const result = await applyStage03SourceSnapshots({
      runId: "run-source-budget",
      data,
      affectedRefs: new Set(["SRC-CANDIDATE"]),
      existingSources: [],
      maxNewSources: 0,
      assertRunning: () => undefined,
    });

    expect(result.sources[0]).toMatchObject({
      source_id: null,
      retrieval_status: "not_attempted",
      quote_verified: false,
    });
    expect(result.evidence_drafts[0].source_ids).toEqual([]);
    expect(result.unresolved_gaps[0]).toContain("来源预算已用尽");
  });

  it("captures higher-priority keys first when budget is tight", async () => {
    const captureOrder: string[] = [];
    vi.resetModules();
    vi.doMock("@/engine/source_snapshot", () => ({
      captureSourceSnapshot: async (input: { url: string }) => {
        captureOrder.push(input.url);
        return {
          locator: input.url,
          captured_at: "2026-01-02T00:00:00.000Z",
          content_hash: "b".repeat(64),
          usability_status: "usable",
          failure_category: null,
          failure_detail: null,
          final_url: input.url,
          content_mime: "text/html",
          http_status: 200,
          retrieval_status: "captured",
          snapshot_text: "ok",
          source_quote: "quote",
          quote_verified: true,
        };
      },
    }));
    const db = await import("@/adapters/db");
    const run = db.createRun("来源预算优先级测试", "semiconductor");
    const { applyStage03SourceSnapshots } = await import("@/engine/evidence_auto_supplement");
    const mk = (key: string, url: string) => ({
      source_id: null,
      source_key: key,
      url,
      title: key,
      publisher: "Example",
      published_at: "2026-01-01T00:00:00.000Z",
      source_tier: "S2",
      authority_type: "public_secondary",
      source_type: "web_citation",
      search_excerpt: "candidate",
      locator: url,
      source_quote: "candidate quote",
      captured_at: null,
      content_hash: null,
      final_url: null,
      retrieval_status: null,
      quote_verified: null,
    });
    const data = {
      sources: [
        mk("SRC-NEW", "https://example.com/new"),
        mk("SRC-FAIL", "https://example.com/fail"),
        mk("SRC-UNIT", "https://example.com/unit"),
      ],
      evidence_drafts: [],
      unresolved_gaps: [],
    };

    await applyStage03SourceSnapshots({
      runId: run.id,
      data,
      affectedRefs: new Set(["SRC-NEW", "SRC-FAIL", "SRC-UNIT"]),
      existingSources: [],
      maxNewSources: 1,
      capturePriorityKeys: ["SRC-FAIL", "SRC-UNIT", "SRC-NEW"],
      assertRunning: () => undefined,
    });

    expect(captureOrder).toEqual(["https://example.com/fail"]);
    expect(data.sources.find((item) => item.source_key === "SRC-FAIL")?.retrieval_status).toBe("captured");
    expect(data.sources.find((item) => item.source_key === "SRC-NEW")?.retrieval_status).toBe("not_attempted");
    expect(data.unresolved_gaps[0]).toContain("来源预算已用尽");
  });
});
