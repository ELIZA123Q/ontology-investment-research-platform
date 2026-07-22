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
});
