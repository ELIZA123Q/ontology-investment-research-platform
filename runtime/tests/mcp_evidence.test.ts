import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  queryCninfo,
  queryDatayesFinoper,
  queryChinaPolicy,
  queryEvidenceMcp,
  setMcpEvidenceCallerForTests,
} from "@/adapters/mcp_evidence";

afterEach(() => {
  setMcpEvidenceCallerForTests(null);
});

describe("mcp_evidence adapter", () => {
  it("returns structured fallback when channel config is missing", async () => {
    const result = await queryEvidenceMcp({ channel: "not-a-real-channel" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/未找到可用 MCP 配置/);
    expect(result.fallback_hint).toMatch(/search_public_web|fetch_public_pages/);
    expect(result.results).toEqual([]);
  });

  it("normalizes injected MCP hits with provenance and company_disclosure authority", async () => {
    setMcpEvidenceCallerForTests(async ({ channel }) => ({
      tools: [{ name: "list_announcements", description: "公告列表" }],
      contentText: "中芯国际2024年报 https://www.cninfo.com.cn/new/disclosure/detail?stockCode=688981&announcementId=1219000001 营业收入同比增长",
      structured: { tool_name: "list_announcements", isError: false },
    }));

    const result = await queryCninfo({ stock_code: "688981" });
    expect(result.ok).toBe(true);
    expect(result.channel).toBe("cninfo");
    expect(result.provenance?.connector).toBe("cninfo");
    expect(result.provenance?.upstream_producer).toBe("巨潮资讯网");
    expect(result.provenance?.runtime_wired).toBe(true);
    expect(result.provenance).toMatchObject({
      mapping_profile_id: "cninfo_source_document",
      mapping_profile_version: "1.0.0",
      mapping_status: "registered",
      ontology_target_types: ["SourceDocument"],
    });
    expect(result.provenance?.query_parameters).toMatchObject({
      channel: "cninfo",
      arguments: expect.objectContaining({ stock_code: "688981" }),
    });
    expect(result.results[0]?.authority_type).toBe("company_disclosure");
    expect(result.results[0]?.url).toContain("cninfo.com.cn");
  });

  it("surfaces fallback_hint when injected caller fails", async () => {
    setMcpEvidenceCallerForTests(async () => {
      throw new Error("stdio spawn failed");
    });
    const result = await queryDatayesFinoper({ stock_code: "688981", period: "2024", api_name: "income" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/stdio spawn failed/);
    expect(result.fallback_hint).toMatch(/cninfo|公开网页/);
    expect(result.provenance?.connector).toBe("datayes-stock-finoper-mcp");
    expect(result.provenance?.mapping_profile_id).toBe("datayes_finoper_observation");
  });

  it("lists datayes tool schemas when api_name is missing", async () => {
    setMcpEvidenceCallerForTests(async ({ arguments: callArgs }) => {
      expect(callArgs?.__list_only).toBe(true);
      return {
        tools: [
          { name: "stock_finoper_get_info", description: "info", inputSchema: { required: ["api_name"] } },
          { name: "stock_finoper_get_data", description: "data", inputSchema: { required: ["api_name"] } },
        ],
        contentText: "",
        structured: { tool_name: null, list_only: true },
      };
    });
    const result = await queryDatayesFinoper({ stock_code: "688981" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/api_name/);
    expect(result.available_tools?.map((tool) => tool.name)).toEqual([
      "stock_finoper_get_info",
      "stock_finoper_get_data",
    ]);
  });

  it("marks china-policy hits as official authority", async () => {
    setMcpEvidenceCallerForTests(async () => ({
      tools: [{ name: "search_policy" }],
      contentText: "国务院关于促进集成电路产业的若干政策 https://www.gov.cn/zhengce/content/example.htm",
      structured: { tool_name: "search_policy", isError: false },
    }));
    const result = await queryChinaPolicy({ keyword: "集成电路" });
    expect(result.ok).toBe(true);
    expect(result.results[0]?.authority_type).toBe("official");
    expect(result.provenance?.access_scope).toBe("public");
    expect(result.provenance).toMatchObject({
      mapping_profile_id: "china_policy_document_event",
      ontology_target_types: ["SourceDocument", "Event"],
    });
  });
});
