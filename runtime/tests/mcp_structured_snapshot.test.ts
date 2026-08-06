import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("structured MCP evidence snapshots", () => {
  it("freezes a URL-less mapped response as a replayable registry source", async () => {
    vi.resetModules();
    const db = await import("@/storage/db");
    const { enrichMcpResult } = await import("@/skills/model_client/deepseek_client");
    const run = db.createRun("结构化 MCP 快照契约", "semiconductor");
    const enriched = await enrichMcpResult({
      ok: true,
      channel: "datayes-stock-finoper-mcp",
      results: [{
        title: "通联财务结构化响应",
        url: null,
        summary: "营业收入字段",
        published_at: null,
        authority_type: "company_disclosure",
        publisher: "通联数据",
        raw_excerpt: JSON.stringify({
          reportDate: "2026-06-30",
          ticker: "000001",
          revenue: 123456789,
          unit: "CNY",
        }),
      }],
      provenance: {
        connector: "datayes-stock-finoper-mcp",
        upstream_producer: "通联数据",
        query_parameters: {
          channel: "datayes-stock-finoper-mcp",
          tool_name: "stock_finoper_get_data",
          arguments: { api_name: "getFdmtISLT2018", ticker: "000001" },
        },
        tool_name: "stock_finoper_get_data",
        response_fingerprint: "mcp_test_fingerprint",
        mapping_profile_id: "DMP-DATAYES-STOCK",
        mapping_profile_version: "1.0.0",
        mapping_status: "registered",
        ontology_target_types: ["MetricValue"],
        field_lineage_note: "$.data[0].revenue",
        access_scope: "authorized",
        replayability: "time_sensitive",
        runtime_wired: true,
      },
      content_text: "",
    }, [], run.id);

    expect(enriched.results[0]).toMatchObject({
      retrieval_status: "captured",
      quote_verified: true,
      usability_status: "usable",
      published_at: "2026-06-30T00:00:00.000Z",
    });
    expect(String(enriched.results[0].url)).toMatch(/^mcp:\/\/datayes-stock-finoper-mcp\//);
    expect((enriched.results[0] as any).structured_snapshot_contract).toMatchObject({
      mapping_status: "registered",
      verification_status: "field_snapshot_verified",
    });
    const registry = db.listSources(run.id);
    expect(registry).toHaveLength(1);
    expect(registry[0]).toMatchObject({
      source_type: "structured_mcp_snapshot",
      retrieval_status: "captured",
      usability_status: "usable",
      quote_verified: 1,
    });
    expect(registry[0].locator).toContain("stock_finoper_get_data");
    expect(registry[0].source_quote).toContain("123456789");
  });
});
