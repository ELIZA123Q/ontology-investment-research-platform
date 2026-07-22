import { describe, expect, it } from "vitest";
import { mergeStage03Patch } from "@/engine/change_set";
import {
  buildSupplementBrief,
  evidenceFingerprint,
  findUnchangedEvidenceIds,
} from "@/engine/evidence_supplement_pure";
import { evaluateEvidenceStopCondition } from "@/engine/source_coverage";
import type { SourceRecord } from "@/engine/types";

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

describe("evidence_auto_supplement", () => {
  it("builds brief focused on failed sources and gap units", () => {
    const coverage = {
      authority_coverage: [],
      missing_core_types: ["official"] as Array<"official" | "company_disclosure" | "industry_provider">,
      public_secondary_count: 0,
      unit_coverage: [{
        unit_id: "JU-1",
        requirements: [],
        support_draft_count: 0,
        counter_draft_count: 0,
        gap_count: 1,
        counter_gap_count: 0,
        usable_fact_count: 0,
        direct_fact_count: 0,
        independent_source_groups: 0,
        minimum_independent_sources: 1,
        meets_independence: false,
        has_support_evidence: false,
        has_counter_evidence: false,
        counter_check_status: "not_required" as const,
        evidence_ceiling: "J0" as const,
        weakest_link: "缺少可核验的支持事实",
      }],
      coverage_gap_count: 2,
      coverage_rate: 0,
      verification_rate: 0,
    };
    const brief = buildSupplementBrief({
      coverage,
      evidence: [{
        id: "EV-1",
        statement: "库存下降",
        kind: "fact_draft",
        source_ids: ["SRC-2"],
      }],
      sources: [source({ id: "SRC-2", quote_verified: false, usability_status: "limited", retrieval_status: "limited" })],
      draftSources: [{ source_key: "SRC-02", source_id: "SRC-2" }],
    });
    expect(brief.failed_sources).toEqual([
      expect.objectContaining({ id: "SRC-2", source_key: "SRC-02" }),
    ]);
    expect(brief.gap_units).toHaveLength(1);
    expect(brief.rework_evidence[0]?.issue).toBe("all_sources_unusable");
  });

  it("merges stage03 patch without touching unaffected rows", () => {
    const base = {
      sources: [{ source_key: "SRC-01", url: "https://a.com", title: "A" }],
      evidence_drafts: [{ id: "EV-1", statement: "old", kind: "fact_draft" }],
      method_applications: [],
      unresolved_gaps: [],
    };
    const merged = mergeStage03Patch(base, {
      affected_object_refs: ["EV-1"],
      upserts: {
        evidence_drafts: [{ id: "EV-1", statement: "new", kind: "fact_draft" }],
      },
    });
    expect(merged.evidence_drafts).toEqual([{ id: "EV-1", statement: "new", kind: "fact_draft" }]);
    expect(merged.sources).toEqual(base.sources);
  });

  it("tracks unchanged evidence ids by fingerprint", () => {
    const draft = { id: "EV-1", statement: "same", kind: "fact_draft", source_ids: ["SRC-1"] };
    const fp = evidenceFingerprint(draft);
    expect(fp).toBe(evidenceFingerprint({ ...draft }));
    const unchanged = findUnchangedEvidenceIds([draft], [draft]);
    expect(unchanged.has("EV-1")).toBe(true);
    expect(findUnchangedEvidenceIds([draft], [{ ...draft, statement: "changed" }]).size).toBe(0);
  });
});

describe("evaluateEvidenceStopCondition", () => {
  it("stops when thresholds met", () => {
    expect(evaluateEvidenceStopCondition({
      coverage_gap_count: 2,
      coverage_rate: 0.8,
      verification_rate: 0.6,
    }).shouldStop).toBe(true);
  });

  it("stops when gap count does not improve", () => {
    expect(evaluateEvidenceStopCondition({
      coverage_gap_count: 3,
      coverage_rate: 0.2,
      verification_rate: 0.1,
    }, 3).shouldStop).toBe(true);
  });
});
