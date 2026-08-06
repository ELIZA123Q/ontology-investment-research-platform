import { describe, expect, it } from "vitest";
import { buildEvidenceReviewSuggestions, prioritizeEvidenceGaps, suggestionToDecision } from "@/skills/evidence_evaluation/review_assist";
import type { SourceRecord } from "@/schemas/types";

function source(overrides: Partial<SourceRecord> = {}): SourceRecord {
  return {
    id: "SRC-1",
    run_id: "run-1",
    normalized_url: "https://example.com/a",
    url: "https://example.com/a",
    title: "公告",
    publisher: "Example",
    published_at: "2026-01-01T00:00:00.000Z",
    accessed_at: "2026-01-02T00:00:00.000Z",
    source_type: "disclosure",
    source_tier: "S2",
    authority_type: "company_disclosure",
    source_group: "example.com",
    search_excerpt: "",
    locator: "quote:test",
    captured_at: "2026-01-02T00:00:00.000Z",
    content_hash: "a".repeat(64),
    usability_status: "usable",
    retrieval_status: "captured",
    quote_verified: true,
    ...overrides,
  };
}

describe("evidence_review_assist", () => {
  it("suggests accepting gaps without sources", () => {
    const suggestions = buildEvidenceReviewSuggestions({
      evidence: [{
        id: "GAP-1",
        statement: "缺少产能数据",
        kind: "gap",
        direction: "unknown",
        source_ids: [],
        judgment_unit_ids: ["JU-1"],
        limitations: ["无公开数据"],
        requirement: "需要两条独立产能证据",
      }],
      sources: [],
      workItems: [],
    });
    expect(suggestions[0]?.suggestion).toBe("accept_gap");
    expect(suggestions[0]?.confidence).toBe("high");
    expect(suggestions[0]?.note.length).toBeGreaterThanOrEqual(8);
  });

  it("suggests manual review when source quote is not verified", () => {
    const suggestions = buildEvidenceReviewSuggestions({
      evidence: [{
        id: "EV-1",
        statement: "库存下降",
        kind: "fact_draft",
        direction: "support",
        source_ids: ["SRC-1"],
        judgment_unit_ids: ["JU-1"],
        limitations: ["样本有限"],
      }],
      sources: [source({ quote_verified: false })],
      workItems: [],
      cutoffMs: Date.parse("2026-07-01T00:00:00.000Z"),
    });
    expect(suggestions[0]?.suggestion).toBe("review_manually");
    expect(suggestions[0]?.confidence).toBe("medium");
  });

  it("suggests accepting verified evidence", () => {
    const suggestions = buildEvidenceReviewSuggestions({
      evidence: [{
        id: "EV-1",
        statement: "库存下降",
        kind: "fact_draft",
        direction: "support",
        source_ids: ["SRC-1"],
        judgment_unit_ids: ["JU-1"],
        limitations: ["样本有限"],
      }],
      sources: [source()],
      workItems: [],
      cutoffMs: Date.parse("2026-07-01T00:00:00.000Z"),
    });
    expect(suggestions[0]?.suggestion).toBe("accept_evidence");
    expect(suggestionToDecision(suggestions[0]!, "fact_draft")).toEqual({
      status: "approved",
      resolution: "accepted_evidence",
    });
  });

  it("ranks unresolved judgment-bound gaps before accepted supplementary gaps", () => {
    const priorities = prioritizeEvidenceGaps({
      evidence: [
        { id: "GAP-2", statement: "ER-02：补充行业背景", kind: "gap", judgment_unit_ids: [], minimum_independent_sources: 1 },
        { id: "GAP-1", statement: "ER-01：需要两条库存序列", kind: "gap", judgment_unit_ids: ["JU-1"], minimum_independent_sources: 2 },
      ],
      workItems: [{ target_id: "GAP-2", status: "approved" } as any],
    });

    expect(priorities.map((item) => item.evidence_id)).toEqual(["GAP-1", "GAP-2"]);
    expect(priorities[0]).toMatchObject({ label: "阻断主判断", statement: "需要两条库存序列" });
    expect(priorities[0]?.reason).toContain("必须保持暂不可判断");
    expect(priorities[0]?.reason).not.toContain("J0");
    expect(priorities[1]?.label).toBe("补充完善");
  });
});
