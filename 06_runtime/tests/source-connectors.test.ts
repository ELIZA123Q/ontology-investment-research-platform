import { describe, expect, it, vi } from "vitest";
import { CNINFO_CONNECTOR_ID, CninfoDisclosureConnector } from "@/src/connectors/cninfo-disclosure-connector";
import { SourceConnectorError, SourceConnectorRegistry, type SourceConnector } from "@/src/connectors/source-connector";
import { adaptSourceToolResult } from "@/src/tools/source-result-adapter";

const request = {
  companyCode: "688261",
  companyName: "东微半导",
  query: "业绩快报",
  asOf: "2026-08-14T00:00:00.000Z",
};

describe("governed source connectors", () => {
  it("maps a live CNInfo announcement listing into the provenance boundary", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ announcements: [{
      announcementId: "1224987566", announcementTitle: "<em>2025 年度业绩快报公告</em>", announcementTime: Date.parse("2026-02-28T00:00:00.000Z"),
      adjunctUrl: "finalpage/2026-02-28/1224987566.PDF", secCode: "688261", secName: "东微半导", orgId: "9900050800",
    }] }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    const result = await new CninfoDisclosureConnector(fetcher).query(request);
    expect(result).toMatchObject({ connectorId: CNINFO_CONNECTOR_ID, upstream: { publisherId: "cninfo.com.cn", sourceType: "primary" } });
    expect(result.upstream.uri).toBe("https://static.cninfo.com.cn/finalpage/2026-02-28/1224987566.PDF");
    expect(adaptSourceToolResult(result).snapshot).toMatchObject({ permissionScope: "public_research_use", publisherId: "cninfo.com.cn" });
  });

  it("rejects announcements newer than the research cutoff", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ announcements: [{ announcementId: "future", announcementTitle: "未来公告", announcementTime: Date.parse("2026-08-15T00:00:00.000Z"), adjunctUrl: "future.pdf" }] }), { status: 200 })) as typeof fetch;
    await expect(new CninfoDisclosureConnector(fetcher).query(request)).rejects.toMatchObject({ code: "no_match" });
  });

  it("falls back and opens a circuit after repeated upstream failures", async () => {
    const failed: SourceConnector = { id: "failed", query: async () => { throw new SourceConnectorError("offline", "upstream_unavailable", true, "failed"); } };
    const fallback: SourceConnector = { id: "fallback", query: async () => new CninfoDisclosureConnector(vi.fn(async () => new Response(JSON.stringify({ announcements: [{ announcementId: "ok", announcementTitle: "业绩快报", announcementTime: Date.parse("2026-02-28T00:00:00.000Z"), adjunctUrl: "ok.pdf" }] }), { status: 200 })) as typeof fetch).query(request) };
    const registry = new SourceConnectorRegistry(1, 60_000);
    registry.register(failed); registry.register(fallback);
    const first = await registry.query(request, ["failed", "fallback"]);
    const second = await registry.query(request, ["failed", "fallback"]);
    expect(first.trace.map((item) => item.status)).toEqual(["failed", "completed"]);
    expect(second.trace.map((item) => item.status)).toEqual(["circuit_open", "completed"]);
  });
});
