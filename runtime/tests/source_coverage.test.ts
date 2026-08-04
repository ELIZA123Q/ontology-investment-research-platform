import { describe, expect, it } from "vitest";
import { computeSourceCoverage, deriveSourceResearchLifecycle } from "@/engine/source_coverage";
import type { SourceRecord } from "@/engine/types";

function source(overrides: Partial<SourceRecord> = {}): SourceRecord {
  return {
    id: overrides.id || "SRC-1",
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

describe("source_coverage", () => {
  it("derives the monotonic clue-to-EvidenceFact research lifecycle", () => {
    expect(deriveSourceResearchLifecycle({ retrievalStatus: "not_attempted", factStatus: "none" }).stage).toBe("clue");
    expect(deriveSourceResearchLifecycle({ retrievalStatus: "captured", factStatus: "none" }).stage).toBe("captured");
    expect(deriveSourceResearchLifecycle({ retrievalStatus: "captured", quoteVerified: true, factStatus: "none" }).stage).toBe("quote_verified");
    expect(deriveSourceResearchLifecycle({ retrievalStatus: "captured", quoteVerified: true, factStatus: "draft" }).stage).toBe("fact_draft");
    expect(deriveSourceResearchLifecycle({ retrievalStatus: "captured", quoteVerified: true, factStatus: "approved" }).stage).toBe("evidence_fact");
  });

  it("does not display an approved fact when capture or quote verification is missing", () => {
    expect(deriveSourceResearchLifecycle({ retrievalStatus: "not_attempted", quoteVerified: true, factStatus: "approved" }).stage).toBe("clue");
    expect(deriveSourceResearchLifecycle({ retrievalStatus: "captured", quoteVerified: false, factStatus: "approved" }).stage).toBe("captured");
  });

  it("flags missing core authority types", () => {
    const coverage = computeSourceCoverage({
      sources: [source()],
      evidence: [{
        id: "EV-1",
        kind: "fact_draft",
        direction: "support",
        directness: "direct",
        source_ids: ["SRC-1"],
        judgment_unit_ids: ["JU-1"],
      }],
      boundSourceIds: new Set(["SRC-1"]),
      requirements: [{
        id: "ER-1",
        requirement: "产能",
        evidence_role: "support",
        minimum_independent_sources: 1,
        judgment_unit_ids: ["JU-1"],
        source: "unit_requirement",
      }],
    });
    expect(coverage.missing_core_types).toEqual(["official", "industry_provider"]);
    expect(coverage.authority_coverage.find((cell) => cell.authority_type === "company_disclosure")?.present).toBe(true);
    expect(coverage.coverage_rate).toBe(1);
    expect(coverage.verification_rate).toBe(1);
    expect(coverage.unit_coverage[0]).toMatchObject({
      usable_fact_count: 1,
      direct_fact_count: 1,
      evidence_ceiling: "J1",
      counter_check_status: "not_required",
    });
  });

  it("does not count unverified sources as evidence coverage or independent groups", () => {
    const coverage = computeSourceCoverage({
      sources: [source({ quote_verified: false })],
      evidence: [{
        id: "EV-1",
        kind: "fact_draft",
        direction: "support",
        directness: "direct",
        source_ids: ["SRC-1"],
        judgment_unit_ids: ["JU-1"],
      }],
      requirements: [{
        id: "ER-1",
        requirement: "产能",
        evidence_role: "support",
        minimum_independent_sources: 1,
        judgment_unit_ids: ["JU-1"],
        source: "unit_requirement",
      }],
    });
    expect(coverage.unit_coverage[0]).toMatchObject({
      usable_fact_count: 0,
      has_support_evidence: false,
      independent_source_groups: 0,
      evidence_ceiling: "J0",
    });
  });

  it("counts multiple sources in the same source group as one independent source", () => {
    const coverage = computeSourceCoverage({
      sources: [
        source({ id: "SRC-1", source_group: "same-owner", normalized_url: "https://example.com/a" }),
        source({ id: "SRC-2", source_group: "same-owner", normalized_url: "https://mirror.example.com/b" }),
      ],
      evidence: [{
        id: "EV-1",
        kind: "fact_draft",
        direction: "support",
        directness: "direct",
        source_ids: ["SRC-1"],
        judgment_unit_ids: ["JU-1"],
      }, {
        id: "EV-2",
        kind: "fact_draft",
        direction: "support",
        directness: "direct",
        source_ids: ["SRC-2"],
        judgment_unit_ids: ["JU-1"],
      }],
      requirements: [{
        id: "ER-1",
        requirement: "至少两组独立来源交叉验证产能",
        evidence_role: "support",
        minimum_independent_sources: 2,
        judgment_unit_ids: ["JU-1"],
        source: "unit_requirement",
      }],
    });
    expect(coverage.unit_coverage[0]).toMatchObject({
      usable_fact_count: 2,
      independent_source_groups: 1,
      meets_independence: false,
      evidence_ceiling: "J1",
      weakest_link: "独立来源组不足（1/2）",
    });
  });

  it("separates a required counter check from actual counter evidence", () => {
    const coverage = computeSourceCoverage({
      sources: [source()],
      evidence: [{
        id: "EV-1",
        kind: "fact_draft",
        direction: "support",
        directness: "direct",
        source_ids: ["SRC-1"],
        judgment_unit_ids: ["JU-1"],
      }, {
        id: "GAP-1",
        kind: "gap",
        direction: "unknown",
        evidence_role: "counter",
        source_ids: [],
        judgment_unit_ids: ["JU-1"],
      }],
      requirements: [{
        id: "ER-C-1",
        requirement: "检查需求转弱",
        evidence_role: "counter",
        minimum_independent_sources: 1,
        judgment_unit_ids: ["JU-1"],
        source: "counter_direction",
      }],
    });
    expect(coverage.unit_coverage[0]).toMatchObject({
      has_counter_evidence: false,
      counter_gap_count: 1,
      counter_check_status: "gap",
    });
  });

  it("computes zero verification rate when no sources have urls", () => {
    const coverage = computeSourceCoverage({ sources: [], evidence: [] });
    expect(coverage.verification_rate).toBe(0);
    expect(coverage.coverage_rate).toBe(0);
  });
});
