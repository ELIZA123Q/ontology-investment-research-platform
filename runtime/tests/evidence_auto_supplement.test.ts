import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { mergeStage03Patch } from "@/engine/change_set";
import { syncStage03DraftSourcesFromRegistry, dedupeStage03DraftSources } from "@/engine/evidence_supplement_pure";
import {
  buildCapturePriorityKeys,
  buildSupplementBrief,
  buildSupplementPriorityQueue,
  evidenceFingerprint,
  findUnchangedEvidenceIds,
  orderByCapturePriority,
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
  it("projects stale draft freeze fields from Source Registry", () => {
    const registry = source({
      id: "uuid-1",
      locator: "registry-locator",
      source_quote: "registry quote verbatim",
      captured_at: "2026-07-23T00:00:00.000Z",
      content_hash: "b".repeat(64),
      final_url: "https://example.com/a#final",
    });
    const synced = syncStage03DraftSourcesFromRegistry({
      sources: [{
        source_key: "SRC-01",
        source_id: "uuid-1",
        url: "https://example.com/a",
        locator: "stale",
        source_quote: "old",
        captured_at: "2020-01-01T00:00:00.000Z",
        content_hash: "a".repeat(64),
        final_url: "https://example.com/a",
        retrieval_status: "limited",
        quote_verified: false,
      }],
    }, [registry]);
    expect(synced.changed).toBe(true);
    expect(synced.data.sources[0]).toMatchObject({
      source_key: "SRC-01",
      url: "https://example.com/a",
      locator: "registry-locator",
      source_quote: "registry quote verbatim",
      captured_at: "2026-07-23T00:00:00.000Z",
      content_hash: "b".repeat(64),
      final_url: "https://example.com/a#final",
      quote_verified: true,
      retrieval_status: "captured",
    });
  });

  it("merges draft sources that share one Registry source_id", () => {
    const deduped = dedupeStage03DraftSources({
      sources: [
        { source_key: "SRC-05", source_id: "uuid-tf", url: "https://www.trendforce.cn/", source_quote: "a", quote_verified: false },
        { source_key: "SRC-06", source_id: "uuid-tf", url: "https://www.trendforce.cn/", source_quote: "b", quote_verified: false },
        { source_key: "SRC-07", source_id: "uuid-tf", url: "https://www.trendforce.cn/", source_quote: "c", quote_verified: true },
        { source_key: "SRC-08", source_id: "uuid-other", url: "https://other.example/", source_quote: "d", quote_verified: true },
      ],
      evidence_drafts: [
        { id: "EV-1", kind: "source_claim", source_keys: ["SRC-05", "SRC-06"], source_ids: ["uuid-tf", "uuid-tf"] },
        { id: "EV-2", kind: "fact_draft", source_keys: ["SRC-08"], source_ids: ["uuid-other"] },
      ],
      unresolved_gaps: [],
    });
    expect(deduped.changed).toBe(true);
    // 被证据引用的 SRC-05 优先保留；其余同 Registry id 的 SRC 折叠并改写绑定。
    expect(deduped.data.sources.map((item: any) => item.source_key).sort()).toEqual(["SRC-05", "SRC-08"]);
    expect(deduped.aliasToCanonical).toEqual({ "SRC-06": "SRC-05", "SRC-07": "SRC-05" });
    expect(deduped.data.evidence_drafts[0]).toMatchObject({
      source_keys: ["SRC-05"],
      source_ids: ["uuid-tf"],
    });
  });

  it("builds brief focused on failed sources and gap units", () => {
    const coverage = {
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
        support_gap_kind: "no_support_draft" as const,
        blocked_sources: [],
        candidate_sources: [],
      }],
      coverage_gap_count: 1,
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
      methodApplications: [{
        application_id: "MA-EV-01",
        status: "blocked",
        input_evidence_refs: ["EV-1"],
      }],
    });
    expect(brief.failed_sources).toEqual([
      expect.objectContaining({ id: "SRC-2", source_key: "SRC-02" }),
    ]);
    expect(brief.gap_units).toHaveLength(1);
    expect(brief.rework_evidence[0]?.issue).toBe("all_sources_unusable");
    expect(brief.blocked_methods[0]?.application_id).toBe("MA-EV-01");
    expect(brief.priority_queue.map((item) => item.tier)).toEqual([1, 1, 2, 3, 4]);
    expect(brief.priority_queue[0]).toMatchObject({
      tier: 1,
      tier_key: "blocked_method_or_orphan_evidence",
      refs: ["MA-EV-01"],
    });
    expect(brief.capture_priority_keys[0]).toBe("SRC-02");
  });

  it("orders priority queue as blocked/orphan → failed source → unit gap → new clue", () => {
    const queue = buildSupplementPriorityQueue({
      blockedMethods: [],
      reworkEvidence: [{ evidence_id: "EV-1", issue: "missing_sources", statement: "x" }],
      failedSources: [{ id: "uuid-1", source_key: "SRC-01" }],
      gapUnits: [{
        unit_id: "JU-1",
        has_support_evidence: false,
        meets_independence: false,
        independent_source_groups: 0,
        minimum_independent_sources: 1,
      }],
      coverageGapCount: 1,
    });
    expect(queue.map((item) => item.tier_key)).toEqual([
      "blocked_method_or_orphan_evidence",
      "failed_source_repair",
      "unit_coverage_gap",
      "open_new_clue",
    ]);
  });

  it("consumes capture budget by priority keys instead of array order", () => {
    const ordered = orderByCapturePriority(
      [
        { source_key: "SRC-NEW" },
        { source_key: "SRC-FAIL" },
        { source_key: "SRC-UNIT" },
      ],
      ["SRC-FAIL", "SRC-UNIT", "SRC-NEW"],
    );
    expect(ordered.map((item) => item.source_key)).toEqual(["SRC-FAIL", "SRC-UNIT", "SRC-NEW"]);

    const keys = buildCapturePriorityKeys({
      draftSources: [
        { source_key: "SRC-NEW", authority_type: "public_secondary" },
        { source_key: "SRC-FAIL" },
        { source_key: "SRC-OFFICIAL", authority_type: "official" },
        { source_key: "SRC-UNIT" },
      ],
      evidence: [{
        id: "EV-1",
        statement: "x",
        kind: "fact_draft",
        source_keys: ["SRC-UNIT", "SRC-NEW"],
        judgment_unit_ids: ["JU-1"],
      }],
      failedSourceKeys: ["SRC-FAIL"],
      reworkEvidenceIds: [],
      gapUnitIds: ["JU-1"],
    });
    // 失败源 → 一手权威 → 单元绑定源（同档内权威优先）
    expect(keys.slice(0, 3)).toEqual(["SRC-FAIL", "SRC-OFFICIAL", "SRC-UNIT"]);
    expect(keys.indexOf("SRC-OFFICIAL")).toBeLessThan(keys.indexOf("SRC-NEW"));
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
  it("does not stop on coverage thresholds while unit gaps remain", () => {
    expect(evaluateEvidenceStopCondition({
      coverage_gap_count: 2,
      coverage_rate: 0.8,
      verification_rate: 0.6,
    }).shouldStop).toBe(false);
    expect(evaluateEvidenceStopCondition({
      coverage_gap_count: 2,
      coverage_rate: 0.8,
      verification_rate: 0.6,
    }).reason).toBe("continue");
  });

  it("stops when gap count reaches zero", () => {
    expect(evaluateEvidenceStopCondition({
      coverage_gap_count: 0,
      coverage_rate: 0.2,
      verification_rate: 0.1,
    })).toEqual({ shouldStop: true, reason: "coverage_gap_count_zero" });
  });

  it("stops when gap count does not improve", () => {
    expect(evaluateEvidenceStopCondition({
      coverage_gap_count: 3,
      coverage_rate: 0.2,
      verification_rate: 0.1,
    }, 3).shouldStop).toBe(true);
  });

  it("injects selected_method_guidance into supplement model payload", async () => {
    const { runEvidenceSupplementRound } = await import("@/engine/evidence_auto_supplement");
    let capturedInput = "";
    const client = {
      generateStructured: async (
        _kind: string,
        _schema: unknown,
        _prompt: string,
        input: string,
      ) => {
        capturedInput = input;
        return {
          data: {
            affected_object_refs: [],
            upserts: { sources: [], evidence_drafts: [], method_applications: [], unresolved_gaps: [] },
            removals: {},
            revision_summary: "no-op",
          },
          usage: {},
          toolUsage: {},
        };
      },
    };
    await runEvidenceSupplementRound({
      client: client as any,
      runId: "run-guidance",
      baseData: {
        method_applications: [{
          application_id: "MA-EV",
          method_id: "kb03:A03",
          method_version: "3.2.0",
          capability_type: "evidence",
          status: "selected",
          target_judgment_unit_refs: ["JU-1"],
        }],
        sources: [],
        evidence_drafts: [{
          id: "EV-GAP-1",
          kind: "gap",
          statement: "缺口",
          direction: "unknown",
          judgment_unit_ids: ["JU-1"],
          source_keys: [],
          source_ids: [],
          requirement: "缺主证据",
          evidence_role: "primary",
          minimum_independent_sources: 1,
        }],
        unresolved_gaps: [],
        preparation_markdown: "补证基座",
        instance_manifest_yaml: "manifest: test",
        document_markdown: "补证基座",
        stage_status: "in_progress",
        quality_status: "draft",
        quality_gate_ref: "workflow/stages/03_证据/03_数据与证据准备规范.md",
        deterministic_check_status: "not_checked",
        semantic_review_status: "not_reviewed",
        confidence_ceiling: "low",
        coverage_unit_total: 1,
        evidence_backed_unit_count: 0,
        evidence_coverage_rate: 0,
        required_coverage_rate: 0.8,
        critical_node_gate_status: "not_met",
        judgment_unit_gate_status: "insufficient",
        search_status: "in_progress",
        allowed_05_output: "gap_report_only",
        evidence_readiness: "not_ready",
        delivery_readiness: "not_ready",
        snapshot_ref: "snap-test",
        return_required: false,
        return_stage: "",
        delivery_materials: {
          chart_candidates: [],
          table_candidates: [],
          source_annotation_candidates: [],
        },
      },
      supplementContext: { judgmentTypes: ["cycle_phase"] },
      assertRunning: () => undefined,
      existingSources: [],
    }).catch(() => undefined);
    expect(capturedInput).toBeTruthy();
    const payload = JSON.parse(capturedInput);
    expect(payload.selected_method_guidance?.length).toBeGreaterThan(0);
    expect(payload.selected_method_guidance[0].method_id).toBe("kb03:A03");
    expect(payload.evidence_judgment_type_cards.cycle_phase.method).toBe("kb03:A03");
    expect(payload.mcp_channel_hints.length).toBeGreaterThan(0);
  });
});
