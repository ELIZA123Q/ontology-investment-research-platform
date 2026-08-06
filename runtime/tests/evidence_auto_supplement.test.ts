import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { mergeStage03Patch } from "@/skills/replan/change_set";
import { syncStage03DraftSourcesFromRegistry, dedupeStage03DraftSources } from "@/skills/gap_detection/supplement_pure";
import {
  buildCapturePriorityKeys,
  buildSupplementBrief,
  buildSupplementPriorityQueue,
  evidenceFingerprint,
  findUnchangedEvidenceIds,
  orderByCapturePriority,
  selectEvidenceSnapshotExcerpt,
} from "@/skills/gap_detection/supplement_pure";
import { evaluateEvidenceStopCondition } from "@/skills/evidence_evaluation/source_coverage";
import type { SourceRecord } from "@/schemas/types";
import {
  enforceStage03AcquisitionHonesty,
  buildStage03AcquisitionQueries,
  isolateStage03BatchPatch,
  materializeFrozenStage03CandidateDrafts,
  partitionStage03EvidenceBatches,
  selectFrozenStage03CandidateSources,
  scopeStage03DataForBatch,
  stage03AcquisitionCallCount,
} from "@/skills/gap_detection/gap_analyzer";

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

describe("Stage03 judgment-unit batching", () => {
  it("covers every unit without exceeding the configured batch count", () => {
    const unitIds = Array.from({ length: 9 }, (_, index) => `JU-${index + 1}`);
    const requirements = unitIds.map((id, index) => ({
      id: `ER-${index + 1}`,
      requirement: `requirement ${index + 1}`,
      evidence_role: "support" as const,
      minimum_independent_sources: 2,
      judgment_unit_ids: [id],
      source: "unit_requirement" as const,
      source_ref: id,
    }));
    const batches = partitionStage03EvidenceBatches({
      judgmentUnitIds: unitIds,
      requirements,
      preferredUnitsPerBatch: 2,
      maxBatches: 4,
    });
    expect(batches).toHaveLength(3);
    expect(batches.flatMap((batch) => batch.unit_ids)).toEqual(unitIds);
    expect(batches.flatMap((batch) => batch.requirements.map((item) => item.id))).toEqual(
      requirements.map((item) => item.id),
    );
  });

  it("sends only the target units to a batch while retaining the global merge base", () => {
    const scoped = scopeStage03DataForBatch({
      method_applications: [
        { application_id: "MA-1", target_judgment_unit_refs: ["JU-1"] },
        { application_id: "MA-2", target_judgment_unit_refs: ["JU-2"] },
      ],
      sources: [
        { source_key: "SRC-1" },
        { source_key: "SRC-2" },
      ],
      evidence_drafts: [
        { id: "EV-1", judgment_unit_ids: ["JU-1"], source_keys: ["SRC-1"] },
        { id: "EV-2", judgment_unit_ids: ["JU-2"], source_keys: ["SRC-2"] },
      ],
      unresolved_gaps: ["EV-1 missing", "EV-2 missing"],
    }, ["JU-2"]);
    expect(scoped.method_applications.map((item: any) => item.application_id)).toEqual(["MA-2"]);
    expect(scoped.evidence_drafts.map((item: any) => item.id)).toEqual(["EV-2"]);
    expect(scoped.sources.map((item: any) => item.source_key)).toEqual(["SRC-2"]);
    expect(scoped.unresolved_gaps).toEqual(["EV-2 missing"]);
  });

  it("namespaces cross-batch source/evidence collisions and preserves other-unit gaps", () => {
    const isolated = isolateStage03BatchPatch({
      baseData: {
        method_applications: [
          { application_id: "MA-1", target_judgment_unit_refs: ["JU-1"] },
          { application_id: "MA-2", target_judgment_unit_refs: ["JU-2"] },
        ],
        sources: [{ source_key: "SRC-01" }],
        evidence_drafts: [
          { id: "EV-01", judgment_unit_ids: ["JU-1"], source_keys: ["SRC-01"] },
          { id: "GAP-02", judgment_unit_ids: ["JU-2"], source_keys: [] },
        ],
        unresolved_gaps: ["EV-01: JU-1 remains unresolved", "GAP-02: old JU-2 gap"],
      },
      patch: {
        affected_object_refs: ["SRC-01", "EV-01", "MA-2"],
        upserts: {
          sources: [{ source_key: "SRC-01", url: "https://example.com/new" }],
          evidence_drafts: [{
            id: "EV-01",
            judgment_unit_ids: ["JU-2"],
            source_keys: ["SRC-01"],
          }],
          method_applications: [{
            application_id: "MA-2",
            input_evidence_refs: ["EV-01"],
          }],
          unresolved_gaps: ["EV-01: new JU-2 follow-up"],
        },
        removals: {},
      },
      targetUnitIds: ["JU-2"],
      namespace: "EB-02",
    });
    const sourceKey = String((isolated.upserts.sources[0] as any).source_key);
    const evidenceId = String((isolated.upserts.evidence_drafts[0] as any).id);
    expect(sourceKey).not.toBe("SRC-01");
    expect(evidenceId).not.toBe("EV-01");
    expect((isolated.upserts.evidence_drafts[0] as any).source_keys).toEqual([sourceKey]);
    expect((isolated.upserts.method_applications[0] as any).input_evidence_refs).toEqual([evidenceId]);
    expect(isolated.upserts.unresolved_gaps).toEqual([
      "EV-01: JU-1 remains unresolved",
      `${evidenceId}: new JU-2 follow-up`,
    ]);
  });

  it("rejects cross-batch removals and evidence leakage", () => {
    const baseData = {
      method_applications: [
        { application_id: "MA-1", target_judgment_unit_refs: ["JU-1"] },
        { application_id: "MA-2", target_judgment_unit_refs: ["JU-2"] },
      ],
      sources: [{ source_key: "SRC-01" }],
      evidence_drafts: [
        { id: "EV-01", judgment_unit_ids: ["JU-1"], source_keys: ["SRC-01"] },
        { id: "GAP-02", judgment_unit_ids: ["JU-2"], source_keys: [] },
      ],
      unresolved_gaps: ["EV-01: JU-1 gap", "GAP-02: JU-2 gap"],
    };
    expect(() => isolateStage03BatchPatch({
      baseData,
      patch: {
        affected_object_refs: ["EV-01"],
        upserts: {},
        removals: { evidence_drafts: ["EV-01"] },
      },
      targetUnitIds: ["JU-2"],
      namespace: "EB-02",
    })).toThrow(/超出当前 Stage03 批次范围/);
    expect(() => isolateStage03BatchPatch({
      baseData,
      patch: {
        affected_object_refs: ["EV-NEW"],
        upserts: {
          evidence_drafts: [{
            id: "EV-NEW",
            judgment_unit_ids: ["JU-1", "JU-2"],
            source_keys: [],
          }],
        },
        removals: {},
      },
      targetUnitIds: ["JU-2"],
      namespace: "EB-02",
    })).toThrow(/超出当前 Stage03 批次判断单元范围/);
  });
});

describe("evidence_auto_supplement", () => {
  it("reuses only relevant captured registry sources and diversifies publishers first", () => {
    const candidates = selectFrozenStage03CandidateSources({
      sources: [
        source({
          id: "samsung-hbm",
          publisher: "Samsung",
          source_group: "samsung.com",
          title: "HBM4 mass production",
          snapshot_text: "HBM4 mass production capacity yield demand shipment ".repeat(20),
        }),
        source({
          id: "micron-hbm",
          publisher: "Micron",
          source_group: "micron.com",
          title: "HBM and DRAM results",
          snapshot_text: "HBM DRAM demand inventory pricing supply capacity ".repeat(20),
        }),
        source({
          id: "micron-second",
          publisher: "Micron",
          source_group: "micron.com",
          title: "Second Micron HBM release",
          snapshot_text: "HBM demand capacity shipment ".repeat(20),
        }),
        source({
          id: "irrelevant",
          publisher: "Other",
          source_group: "other.com",
          title: "Smartphone camera",
          snapshot_text: "camera pixel photography ".repeat(20),
        }),
        source({
          id: "rejected",
          publisher: "TrendForce",
          source_group: "trendforce.com",
          title: "HBM price inventory",
          snapshot_text: "HBM price inventory demand supply ".repeat(20),
          usability_status: "rejected",
        }),
      ],
      requirements: [{
        id: "ER-HBM",
        requirement: "取得 HBM 价格、库存、需求、供给与产能证据",
        evidence_role: "support",
        minimum_independent_sources: 2,
        judgment_unit_ids: ["JU-HBM"],
        source: "unit_requirement",
      }],
      maxCandidates: 3,
    });

    expect(candidates.map((item) => item.id)).toEqual([
      "micron-hbm",
      "samsung-hbm",
      "micron-second",
    ]);
    expect(candidates.map((item) => item.id)).not.toContain("rejected");
    expect(candidates.map((item) => item.id)).not.toContain("irrelevant");
  });

  it("materializes frozen registry candidates as complete stable SourceDrafts before the model runs", () => {
    const registry = source({
      id: "392fc308-792e-4906-9869-30db0589dd71",
      title: "Micron Fiscal Q3 2026 Results",
      snapshot_text: [
        "Skip to main navigation Part number look up Firmware downloads.",
        "Micron announced fiscal third quarter 2026 revenue of $41.46 billion.",
        "Data center demand remained strong while supply stayed constrained.",
      ].join(" "),
      usability_status: "limited",
      retrieval_status: "limited",
      quote_verified: false,
    });
    const drafts = materializeFrozenStage03CandidateDrafts({
      sources: [registry],
      requirements: [{
        id: "ER-1",
        requirement: "取得数据中心需求与供给证据",
        evidence_role: "support",
        minimum_independent_sources: 2,
        judgment_unit_ids: ["JU-1"],
        source: "unit_requirement",
      }],
      maxQuoteChars: 500,
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      source_id: registry.id,
      source_key: "SRC-R-392FC308",
      source_tier: "S2",
      source_type: "disclosure",
      quote_verified: false,
    });
    expect(drafts[0].source_quote).toContain("revenue of $41.46 billion");
    expect(drafts[0].locator).toBeTruthy();

    const reused = materializeFrozenStage03CandidateDrafts({
      sources: [{ ...registry, source_quote: "Previously verified exact quote with sufficient length.", quote_verified: true }],
      existingDraftSources: [{ source_id: registry.id, source_key: "SRC-EXISTING" }],
    });
    expect(reused[0]).toMatchObject({
      source_key: "SRC-EXISTING",
      source_quote: "Previously verified exact quote with sufficient length.",
      quote_verified: true,
    });
  });

  it("selects the evidence-dense continuous window instead of navigation boilerplate", () => {
    const navigation = "Popular Keywords Shopping List View Cart Sign In DRAM NAND Price ".repeat(80);
    const evidence = [
      "Key Highlights",
      "Supplier inventory fell to multi-quarter lows while enterprise demand accelerated.",
      "Contract pricing increased during the quarter and capacity remained constrained.",
      "Consumer shipments weakened, providing a counter-signal for the next quarter.",
    ].join(" ");
    const excerpt = selectEvidenceSnapshotExcerpt({
      snapshotText: `${navigation} ${evidence} footer`,
      title: "NAND Flash Market Bulletin",
      requirements: [{
        id: "ER-1",
        requirement: "取得NAND库存、合约价、企业与消费需求的正反证",
        evidence_role: "support",
        minimum_independent_sources: 2,
        judgment_unit_ids: ["JU-1"],
        source: "unit_requirement",
      }],
      maxChars: 800,
    });
    expect(excerpt).toContain("Supplier inventory fell");
    expect(excerpt).toContain("Consumer shipments weakened");
    expect(excerpt).not.toMatch(/^Popular Keywords Shopping List/);
  });

  it("builds a balanced support/counter acquisition plan instead of spending both queries on one side", () => {
    const queries = buildStage03AcquisitionQueries({
      question: "存储周期判断",
      targetUnitIds: ["JU-1"],
      requirements: [
        {
          id: "ER-SUPPORT",
          requirement: "取得价格与库存时序",
          evidence_role: "support",
          minimum_independent_sources: 1,
          judgment_unit_ids: ["JU-1"],
          source: "unit_requirement",
        },
        {
          id: "ER-COUNTER",
          requirement: "验证库存重新累积的反向情形",
          evidence_role: "counter",
          minimum_independent_sources: 1,
          judgment_unit_ids: ["JU-1"],
          source: "counter_direction",
        },
        {
          id: "ER-COUNTER-2",
          requirement: "验证需求不及预期",
          evidence_role: "counter",
          minimum_independent_sources: 1,
          judgment_unit_ids: ["JU-1"],
          source: "counter_direction",
        },
      ],
      maxQueries: 2,
    });
    expect(queries).toHaveLength(2);
    expect(queries[0]).toMatch(/pricing.*inventory/);
    expect(queries[1]).toMatch(/inventory/);
  });

  it("allocates support and counter queries to every unit in a two-unit batch", () => {
    const requirement = (
      id: string,
      text: string,
      role: "support" | "counter",
      unitId: string,
    ) => ({
      id,
      requirement: text,
      evidence_role: role,
      minimum_independent_sources: 2,
      judgment_unit_ids: [unitId],
      source: role === "counter" ? "counter_direction" as const : "unit_requirement" as const,
    });
    const queries = buildStage03AcquisitionQueries({
      question: "存储周期",
      targetUnitIds: ["JU-1", "JU-2"],
      requirements: [
        requirement("ER-1-S", "HBM价格库存主证", "support", "JU-1"),
        requirement("ER-1-C", "HBM需求转弱反证", "counter", "JU-1"),
        requirement("ER-2-S", "通用DRAM价格库存主证", "support", "JU-2"),
        requirement("ER-2-C", "通用DRAM库存累积反证", "counter", "JU-2"),
      ],
    });
    expect(queries).toHaveLength(4);
    expect(queries[0]).toMatch(/HBM4.*mass production/);
    expect(queries[1]).toMatch(/HBM.*demand.*inventory/);
    expect(queries[2]).toMatch(/DRAM.*supply.*inventory/);
    expect(queries[3]).toMatch(/DRAM.*contract price.*inventory/);
  });

  it("treats zero acquisition calls as gaps instead of model-generated facts", () => {
    expect(stage03AcquisitionCallCount({
      web_search_calls: 0,
      public_page_fetch_calls: 0,
      mcp_evidence_calls: 0,
    })).toBe(0);
    expect(stage03AcquisitionCallCount({ public_page_fetch_calls: 2 })).toBe(2);

    const honest = enforceStage03AcquisitionHonesty({
      baseData: {
        sources: [],
        evidence_drafts: [{
          id: "GAP-1",
          statement: "缺口",
          kind: "gap",
          direction: "unknown",
          source_keys: [],
          source_ids: [],
          judgment_unit_ids: ["JU-1"],
          ontology_node_ids: [],
          requirement: "补正文",
          evidence_role: "support",
          minimum_independent_sources: 1,
          limitations: ["待取证"],
        }],
      },
      patch: {
        affected_object_refs: ["SRC-NEW", "GAP-1"],
        upserts: {
          sources: [{
            source_key: "SRC-NEW",
            url: "https://example.com/unfetched",
            title: "模型记忆",
          }],
          evidence_drafts: [{
            id: "GAP-1",
            statement: "模型声称价格上涨",
            kind: "fact_draft",
            direction: "support",
            source_keys: ["SRC-NEW"],
            judgment_unit_ids: ["JU-1"],
          }],
          method_applications: [{
            application_id: "MA-EV-1",
            status: "executed",
          }],
          unresolved_gaps: [],
        },
        removals: {},
        revision_summary: "completed",
      },
      toolUsage: {},
      targetUnitIds: ["JU-1"],
    });
    expect(honest.upserts.sources).toEqual([]);
    expect(honest.upserts.evidence_drafts[0]).toMatchObject({
      id: "GAP-1",
      kind: "gap",
      direction: "unknown",
      source_keys: [],
      source_ids: [],
    });
    expect((honest.upserts.method_applications[0] as any).status).toBe("blocked");
    expect(honest.revision_summary).toMatch(/acquisition honesty gate/);
  });

  it("does not let a no-tool patch overwrite an existing fact", () => {
    const honest = enforceStage03AcquisitionHonesty({
      baseData: {
        evidence_drafts: [{
          id: "EV-VERIFIED",
          kind: "fact_draft",
          statement: "已有事实",
          judgment_unit_ids: ["JU-1"],
        }],
      },
      patch: {
        affected_object_refs: ["EV-VERIFIED"],
        upserts: {
          evidence_drafts: [{
            id: "EV-VERIFIED",
            kind: "fact_draft",
            statement: "无工具调用的新说法",
            judgment_unit_ids: ["JU-1"],
          }],
        },
        removals: {},
      },
      toolUsage: { web_search_calls: 0 },
      targetUnitIds: ["JU-1"],
    });
    expect(honest.upserts.evidence_drafts).toEqual([]);
    expect(honest.upserts.unresolved_gaps[0]).toMatch(/忽略对既有事实的修改/);
  });

  it("without model tool calls, only accepts sources from the Runtime pre-acquisition boundary", () => {
    const honest = enforceStage03AcquisitionHonesty({
      baseData: { sources: [], evidence_drafts: [] },
      patch: {
        affected_object_refs: ["SRC-ALLOWED", "SRC-INVENTED", "EV-1", "EV-2"],
        upserts: {
          sources: [
            { source_key: "SRC-ALLOWED", url: "https://example.com/allowed", title: "allowed" },
            { source_key: "SRC-INVENTED", url: "https://example.com/invented", title: "invented" },
          ],
          evidence_drafts: [
            {
              id: "EV-1",
              kind: "fact_draft",
              direction: "support",
              statement: "来自 Runtime 候选",
              source_keys: ["SRC-ALLOWED"],
              judgment_unit_ids: ["JU-1"],
            },
            {
              id: "EV-2",
              kind: "fact_draft",
              direction: "support",
              statement: "来自边界外来源",
              source_keys: ["SRC-INVENTED"],
              judgment_unit_ids: ["JU-1"],
            },
          ],
        },
        removals: {},
      },
      toolUsage: { runtime_preacquired_sources: 1 },
      runtimeAcquiredSourceUrls: ["https://example.com/allowed"],
      targetUnitIds: ["JU-1"],
    });

    expect(honest.upserts.sources.map((item: any) => item.source_key)).toEqual(["SRC-ALLOWED"]);
    expect(honest.upserts.evidence_drafts[0]).toMatchObject({ id: "EV-1", kind: "fact_draft" });
    expect(honest.upserts.evidence_drafts[1]).toMatchObject({
      id: "EV-2",
      kind: "gap",
      source_keys: [],
      source_ids: [],
    });
    expect(honest.upserts.unresolved_gaps.join(" ")).toMatch(/不在 Runtime 确定性预取集合|已降级为 gap/);
  });

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

  it("recovers a missing source_id and freeze fields from an unambiguous Registry URL", () => {
    const registry = source({
      id: "uuid-url",
      url: "https://example.com/report/",
      final_url: "https://example.com/report/#section",
      locator: "registry-locator",
      source_quote: "registry quote verbatim",
    });
    const synced = syncStage03DraftSourcesFromRegistry({
      sources: [{
        source_key: "SRC-NEW",
        source_id: null,
        url: "https://EXAMPLE.com/report",
        title: "公告",
      }],
      evidence_drafts: [{ id: "EV-1", source_keys: ["SRC-NEW"], source_ids: [] }],
      unresolved_gaps: [],
    }, [registry]);
    expect(synced.changed).toBe(true);
    expect(synced.data.sources[0]).toMatchObject({
      source_id: "uuid-url",
      locator: "registry-locator",
      source_quote: "registry quote verbatim",
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
      missing_core_types: [] as string[],
      authority_coverage: [] as { authority_type: string; present: boolean }[],
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

  it("continues when gaps do not improve but coverage is still below the floor", () => {
    expect(evaluateEvidenceStopCondition({
      coverage_gap_count: 3,
      coverage_rate: 0.2,
      verification_rate: 0.1,
    }, 3)).toEqual({
      shouldStop: false,
      reason: "no_gap_improvement_continue",
    });
  });

  it("injects selected_method_guidance into supplement model payload", async () => {
    const { runEvidenceSupplementRound } = await import("@/skills/gap_detection/gap_analyzer");
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
        quality_gate_ref: "tasks/workflows/deep_research/stages/03_evidence.md",
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
      structure: {
        variables: [{ id: "VAR-1", ontology_node_id: "end_market_demand_strength" }],
        paths: [{ id: "PATH-1", variable_ids: ["VAR-1"], judgment_unit_ids: ["JU-1"] }],
        judgment_units: [{ id: "JU-1", judgment_type: "cycle_phase", ontology_node_ids: [] }],
      },
      requirements: [{
        id: "ER-1",
        requirement: "取得 HBM 需求、订单与库存反证",
        evidence_role: "counter",
        minimum_independent_sources: 2,
        judgment_unit_ids: ["JU-1"],
        source: "counter_direction",
      }],
      targetUnitIds: ["JU-1"],
      cutoffMs: Date.parse("2026-06-30T23:59:59Z"),
      assertRunning: () => undefined,
      existingSources: [],
    }).catch(() => undefined);
    expect(capturedInput).toBeTruthy();
    const payload = JSON.parse(capturedInput);
    expect(payload.selected_method_guidance?.length).toBeGreaterThan(0);
    expect(payload.selected_method_guidance[0].method_id).toBe("kb03:A03");
    expect(payload.evidence_judgment_type_cards.cycle_phase.method).toBe("kb03:A03");
    expect(payload.mcp_channel_hints.length).toBeGreaterThan(0);
    expect(payload.acquisition_plan.generated_from.evidence_profile_ids).toContain("demand_orders");
    expect(payload.acquisition_plan.tasks[0].query_card_refs.length).toBeGreaterThan(0);
    expect(payload.runtime_acquisition_trace.route_registry_version).toBe("1.1.0");
  });
});
