import { describe, expect, it } from "vitest";
import { adaptFinancialDataResult } from "@/src/tools/financial-data-adapter";
import {
  HTSC_CONNECTOR_ID,
  HTSC_INDUSTRY_SENTIMENT_PROFILE,
  mapHtscIndustrySentimentReceipt,
  parseHtscIndustrySentimentMcpPayload,
  type HtscIndustrySentimentReceipt,
} from "@/src/tools/htsc-industry-sentiment-mapper";

const hash = `sha256:${"b".repeat(64)}`;

function receipt(overrides: Partial<HtscIndustrySentimentReceipt> = {}): HtscIndustrySentimentReceipt {
  return {
    operation: "get_industry_sentiment",
    request: { industryLevel: "二级行业", industry: "半导体", startDate: "2026-05-01", endDate: "2026-08-11" },
    requestedAt: "2026-08-11T02:20:00Z",
    retrievedAt: "2026-08-11T02:20:09Z",
    asOf: "2026-08-11T02:20:09Z",
    responseFingerprint: hash,
    mappingProfile: HTSC_INDUSTRY_SENTIMENT_PROFILE,
    replayability: "time_sensitive",
    riskDisclosure: "仅供研究学习，不构成投资建议，不得二次传播。",
    observations: [
      { industry: "半导体", observedAt: "2026-05-31", value: 10, sourcePath: "$.data.rows[0].sentiment" },
      { industry: "半导体", observedAt: "2026-06-30", value: 9, sourcePath: "$.data.rows[1].sentiment" },
    ],
    ...overrides,
  };
}

describe("HTSC industry sentiment mapper", () => {
  it("parses the real MCP markdown shape without model interpretation", () => {
    const parsed = parseHtscIndustrySentimentMcpPayload({
      payload: {
        status: "success",
        message: "查询成功",
        data: "# 行业景气度数据\n\n| 行业名称 | 日期 | 景气度值 |\n| --- | --- | --- |\n| 半导体 | 2026-05-31 | 10 |\n| 半导体 | 2026-06-30 | 9 |\n\n**数据来源**: 华泰智研MCP数据服务\n**数据提供方**: 华泰证券研究所\n**风险揭示**: 仅供研究学习，不构成投资建议，请勿二次传播。",
      },
      request: receipt().request,
      requestedAt: receipt().requestedAt,
      retrievedAt: receipt().retrievedAt,
      responseFingerprint: hash,
    });
    expect(parsed.observations).toEqual([
      { industry: "半导体", observedAt: "2026-05-31", value: 10, sourcePath: "$.data.markdown.rows[0].sentiment" },
      { industry: "半导体", observedAt: "2026-06-30", value: 9, sourcePath: "$.data.markdown.rows[1].sentiment" },
    ]);
    expect(parsed.riskDisclosure).toContain("请勿二次传播");
  });

  it("preserves licensed provider identity, risk boundary, field lineage and business time", () => {
    const mapped = mapHtscIndustrySentimentReceipt(receipt());
    expect(mapped).toMatchObject({ connectorId: HTSC_CONNECTOR_ID, permissionScope: "authorized_research_use" });
    expect(mapped.upstream).toMatchObject({ publisherId: "华泰证券研究所", sourceType: "secondary" });
    expect(mapped.requestParameters).toMatchObject({ mappingProfileId: HTSC_INDUSTRY_SENTIMENT_PROFILE.id, usageRestriction: "authorized_research_only_no_redistribution" });
    expect(mapped.observations[0].locator).toContain("不得二次传播");
    const adapted = adaptFinancialDataResult(mapped);
    expect(adapted.observations[0]).toMatchObject({ metricId: "htsc.industry_sentiment", basis: "provider_measurement", factType: "measurement" });
  });

  it("rejects missing lineage, mismatched industries and unbound profiles", () => {
    expect(() => mapHtscIndustrySentimentReceipt(receipt({ responseFingerprint: "missing" }))).toThrow(/sha256/);
    expect(() => mapHtscIndustrySentimentReceipt(receipt({ observations: [{ ...receipt().observations[0], sourcePath: "" }] }))).toThrow(/sourcePath/);
    expect(() => mapHtscIndustrySentimentReceipt(receipt({ observations: [{ ...receipt().observations[0], industry: "元件" }] }))).toThrow(/does not match/);
    expect(() => mapHtscIndustrySentimentReceipt(receipt({ mappingProfile: { id: "other", version: "1.0.0" } as unknown as typeof HTSC_INDUSTRY_SENTIMENT_PROFILE }))).toThrow(/profile/);
    expect(() => parseHtscIndustrySentimentMcpPayload({
      payload: { status: "success", message: "查询成功", data: "no provider or risk" },
      request: receipt().request, requestedAt: receipt().requestedAt, retrievedAt: receipt().retrievedAt, responseFingerprint: hash,
    })).toThrow(/provider identity/);
  });
});
