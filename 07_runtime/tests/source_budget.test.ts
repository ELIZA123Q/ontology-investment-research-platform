import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
process.env.WORKBENCH_DB_PATH = `/tmp/ontology-workbench-source-budget-${process.pid}.sqlite`;

describe("run-level source budget", () => {
  it("keeps over-budget candidates as explicit gaps without fetching or registering them", async () => {
    const { applyStage03SourceSnapshots } = await import("@/skills/gap_detection/gap_analyzer");
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
    vi.doMock("@/skills/evidence_evaluation/source_snapshot", () => ({
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
    const db = await import("@/storage/db");
    const run = db.createRun("来源预算优先级测试", "semiconductor");
    const { applyStage03SourceSnapshots } = await import("@/skills/gap_detection/gap_analyzer");
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

  it("registers and deterministically quote-freezes Runtime-discovered candidates without any model call", async () => {
    vi.resetModules();
    const db = await import("@/storage/db");
    const run = db.createRun("Runtime 确定性候选来源登记", "semiconductor");
    const { preAcquireStage03CandidateSources } = await import("@/skills/gap_detection/gap_analyzer");
    const acquired = await preAcquireStage03CandidateSources({
      runId: run.id,
      question: "未来六个月存储价格周期",
      requirements: [{
        id: "ER-01",
        requirement: "验证 DRAM 合约价与库存变化",
        evidence_role: "support",
        minimum_independent_sources: 2,
        judgment_unit_ids: ["JU-01"],
        source: "unit_requirement",
      }],
      targetUnitIds: ["JU-01"],
      existingSources: [],
      search: async () => ({
        results: [{
          title: "DRAM market data",
          url: "https://trendforce.com/dram",
          summary: "contract price and inventory",
          published_at: "2026-07-01T00:00:00.000Z",
          query: "DRAM contract price inventory",
          retrieval_status: "limited",
          final_url: "https://trendforce.com/dram",
          content_excerpt: "A".repeat(400),
          locator_hint: "https://trendforce.com/dram",
          content_hash: "c".repeat(64),
          retrieval_error: undefined,
        }],
      }),
    });

    expect(acquired.queries[0]).toMatch(/DRAM.*contract price.*inventory/);
    expect(acquired.sources).toHaveLength(1);
    expect(acquired.sources[0]).toMatchObject({
      retrieval_status: "captured",
      usability_status: "usable",
      quote_verified: 1,
    });
    expect(acquired.sources[0].source_quote).toBe("A".repeat(400));
    expect(db.listSources(run.id)).toHaveLength(1);
  });

  it("spends the first candidate slot across distinct queries before taking duplicate-query hits", async () => {
    vi.resetModules();
    const db = await import("@/storage/db");
    const run = db.createRun("Runtime 查询多样性", "semiconductor");
    const { preAcquireStage03CandidateSources } = await import("@/skills/gap_detection/gap_analyzer");
    const requirements = [
      ["ER-1-S", "HBM 价格库存主证", "support", "JU-1"],
      ["ER-1-C", "HBM 需求转弱反证", "counter", "JU-1"],
      ["ER-2-S", "DRAM 价格库存主证", "support", "JU-2"],
      ["ER-2-C", "DRAM 渠道库存累积反证", "counter", "JU-2"],
    ].map(([id, requirement, evidence_role, unit]) => ({
      id,
      requirement,
      evidence_role: evidence_role as "support" | "counter",
      minimum_independent_sources: 1,
      judgment_unit_ids: [unit],
      source: evidence_role === "counter" ? "counter_direction" as const : "unit_requirement" as const,
    }));
    const acquired = await preAcquireStage03CandidateSources({
      runId: run.id,
      question: "存储周期",
      requirements,
      targetUnitIds: ["JU-1", "JU-2"],
      existingSources: [],
      maxSourceCount: 4,
      search: async (args) => {
        const queries = args.queries as string[];
        const hit = (query: string, suffix: string) => ({
          query,
          title: `${query}-${suffix}`,
          url: `https://trendforce.com/${encodeURIComponent(query)}-${suffix}`,
          summary: query,
          published_at: "2026-07-01T00:00:00.000Z",
          retrieval_status: "limited",
          final_url: `https://trendforce.com/${encodeURIComponent(query)}-${suffix}`,
          content_excerpt: "A".repeat(300),
          locator_hint: query,
          content_hash: "e".repeat(64),
          retrieval_error: undefined,
        });
        return {
          results: [
            hit(queries[0], "a"),
            hit(queries[0], "b"),
            hit(queries[1], "a"),
            hit(queries[2], "a"),
            hit(queries[3], "a"),
          ],
        };
      },
    });

    expect(acquired.sources).toHaveLength(4);
    expect(new Set(acquired.sources.map((source) => source.search_excerpt))).toEqual(new Set(acquired.queries));
  });

  it("re-verifies an existing Runtime candidate without consuming new-source budget", async () => {
    const captureOrder: string[] = [];
    vi.resetModules();
    vi.doMock("@/skills/evidence_evaluation/source_snapshot", () => ({
      captureSourceSnapshot: async (input: { url: string; source_quote?: string }) => {
        captureOrder.push(input.url);
        return {
          locator: `quote:${input.source_quote}`,
          captured_at: "2026-07-02T00:00:00.000Z",
          content_hash: "d".repeat(64),
          usability_status: "usable",
          failure_category: "",
          failure_detail: "",
          final_url: input.url,
          content_mime: "text/html",
          http_status: 200,
          retrieval_status: "captured",
          snapshot_text: "verified source body",
          source_quote: input.source_quote || "",
          quote_verified: true,
        };
      },
    }));
    const db = await import("@/storage/db");
    const run = db.createRun("候选来源二次核验", "semiconductor");
    const prior = db.upsertSource(run.id, {
      url: "https://example.com/candidate",
      title: "candidate",
      publisher: "example.com",
      published_at: "2026-07-01T00:00:00.000Z",
      source_type: "web_citation",
      source_tier: "S8",
      authority_type: "public_secondary",
      search_excerpt: "candidate",
      locator: "https://example.com/candidate",
      captured_at: "2026-07-01T00:00:00.000Z",
      content_hash: "c".repeat(64),
      usability_status: "limited",
      failure_category: "",
      failure_detail: "待摘录",
      final_url: "https://example.com/candidate",
      content_mime: "text/html",
      http_status: 200,
      retrieval_status: "limited",
      snapshot_text: "verified source body",
      source_quote: "",
      quote_verified: false,
    });
    const { applyStage03SourceSnapshots } = await import("@/skills/gap_detection/gap_analyzer");
    const data = {
      sources: [{
        source_id: prior.id,
        source_key: "SRC-CANDIDATE",
        url: prior.url,
        title: prior.title,
        publisher: prior.publisher,
        published_at: prior.published_at,
        source_tier: prior.source_tier,
        authority_type: prior.authority_type,
        source_type: prior.source_type,
        search_excerpt: prior.search_excerpt,
        locator: prior.locator,
        source_quote: "verified source body",
      }],
      evidence_drafts: [{ source_keys: ["SRC-CANDIDATE"], source_ids: [] }],
      unresolved_gaps: [],
    };

    await applyStage03SourceSnapshots({
      runId: run.id,
      data,
      affectedRefs: new Set(["SRC-CANDIDATE"]),
      existingSources: [prior],
      maxNewSources: 0,
      assertRunning: () => undefined,
    });

    expect(captureOrder).toEqual(["https://example.com/candidate"]);
    expect(db.listSources(run.id)[0]).toMatchObject({
      retrieval_status: "captured",
      usability_status: "usable",
      quote_verified: 1,
    });
  });
});
