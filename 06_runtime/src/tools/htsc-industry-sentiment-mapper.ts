import type { FinancialDataToolResult } from "@/src/tools/financial-data-adapter";

export const HTSC_CONNECTOR_ID = "htsc_research_mcp";
export const HTSC_INDUSTRY_SENTIMENT_PROFILE = {
  id: "htsc_industry_sentiment_observation",
  version: "1.0.0",
} as const;

export interface HtscIndustrySentimentReceipt {
  operation: "get_industry_sentiment";
  request: {
    industryLevel: "一级行业" | "二级行业";
    industry: string;
    startDate: string;
    endDate: string;
  };
  requestedAt: string;
  retrievedAt: string;
  asOf: string;
  responseFingerprint: string;
  mappingProfile: typeof HTSC_INDUSTRY_SENTIMENT_PROFILE;
  replayability: "time_sensitive" | "replayable";
  riskDisclosure: string;
  observations: Array<{
    industry: string;
    observedAt: string;
    value: number;
    sourcePath: string;
  }>;
}

export interface HtscIndustrySentimentMcpPayload {
  status: string;
  message: string;
  data: string;
}

export class HtscIndustrySentimentMappingError extends Error {}

export function parseHtscIndustrySentimentMcpPayload(input: {
  payload: HtscIndustrySentimentMcpPayload;
  request: HtscIndustrySentimentReceipt["request"];
  requestedAt: string;
  retrievedAt: string;
  responseFingerprint: string;
}): HtscIndustrySentimentReceipt {
  if (input.payload.status !== "success" || input.payload.message !== "查询成功") {
    throw new HtscIndustrySentimentMappingError("HTSC MCP response is not successful");
  }
  const body = requireText(input.payload.data, "payload.data");
  if (!body.includes("华泰智研MCP数据服务") || !body.includes("华泰证券研究所")) {
    throw new HtscIndustrySentimentMappingError("HTSC MCP provider identity is missing");
  }
  const observations = [...body.matchAll(/^\|\s*([^|]+?)\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(-?\d+(?:\.\d+)?)\s*\|\s*$/gmu)].map((match, index) => ({
    industry: match[1].trim(),
    observedAt: match[2],
    value: Number(match[3]),
    sourcePath: `$.data.markdown.rows[${index}].sentiment`,
  }));
  const riskMatch = body.match(/^\*\*风险揭示\*\*:\s*(.+)$/mu);
  if (!riskMatch) throw new HtscIndustrySentimentMappingError("HTSC risk disclosure is missing");
  return {
    operation: "get_industry_sentiment",
    request: input.request,
    requestedAt: input.requestedAt,
    retrievedAt: input.retrievedAt,
    asOf: input.retrievedAt,
    responseFingerprint: input.responseFingerprint,
    mappingProfile: HTSC_INDUSTRY_SENTIMENT_PROFILE,
    replayability: "time_sensitive",
    riskDisclosure: riskMatch[1].trim(),
    observations,
  };
}

export function mapHtscIndustrySentimentReceipt(receipt: HtscIndustrySentimentReceipt): FinancialDataToolResult {
  if (receipt.operation !== "get_industry_sentiment") throw new HtscIndustrySentimentMappingError("unsupported HTSC route");
  if (receipt.mappingProfile.id !== HTSC_INDUSTRY_SENTIMENT_PROFILE.id || receipt.mappingProfile.version !== HTSC_INDUSTRY_SENTIMENT_PROFILE.version) {
    throw new HtscIndustrySentimentMappingError("HTSC mapping profile is not active");
  }
  if (!/^sha256:[a-f0-9]{64}$/u.test(receipt.responseFingerprint)) throw new HtscIndustrySentimentMappingError("responseFingerprint must be sha256");
  const industry = requireText(receipt.request.industry, "request.industry");
  const riskDisclosure = requireText(receipt.riskDisclosure, "riskDisclosure");
  if (!receipt.observations.length) throw new HtscIndustrySentimentMappingError("at least one observation is required");
  const sourcePaths = receipt.observations.map((item, index) => requireText(item.sourcePath, `observations[${index}].sourcePath`));
  if (new Set(sourcePaths).size !== sourcePaths.length) throw new HtscIndustrySentimentMappingError("field lineage paths must be unique");
  if (receipt.observations.some((item) => item.industry.trim() !== industry)) throw new HtscIndustrySentimentMappingError("observation industry does not match the request");

  return {
    connectorId: HTSC_CONNECTOR_ID,
    operation: receipt.operation,
    requestParameters: {
      industryLevel: receipt.request.industryLevel,
      industry,
      startDate: receipt.request.startDate,
      endDate: receipt.request.endDate,
      responseFingerprint: receipt.responseFingerprint,
      mappingProfileId: receipt.mappingProfile.id,
      mappingProfileVersion: receipt.mappingProfile.version,
      replayability: receipt.replayability,
      fieldLineage: sourcePaths,
      usageRestriction: "authorized_research_only_no_redistribution",
    },
    requestedAt: receipt.requestedAt,
    retrievedAt: receipt.retrievedAt,
    asOf: receipt.asOf,
    entity: { id: `industry:${slug(industry)}:cn`, name: industry },
    upstream: {
      sourceId: `htsc:industry-sentiment:${slug(industry)}:${receipt.request.startDate}:${receipt.request.endDate}`,
      uri: `mcp://${HTSC_CONNECTOR_ID}/${receipt.responseFingerprint.slice(7)}`,
      title: `华泰智研 ${industry}行业景气度`,
      publisherId: "华泰证券研究所",
      sourceType: "secondary",
    },
    permissionScope: "authorized_research_use",
    observations: receipt.observations.map((item, index) => ({
      metricId: "htsc.industry_sentiment",
      metricName: "行业景气度",
      value: item.value,
      unit: "index_points",
      businessTime: item.observedAt,
      basis: "provider_measurement",
      dimensions: {
        industryLevel: receipt.request.industryLevel,
        industry,
        providerMethodology: "HTSC_research_derived",
        observationSequence: index + 1,
      },
      locator: `华泰智研 MCP 返回 ${item.sourcePath}；风险限制：${riskDisclosure}`,
    })),
  };
}

function requireText(value: string, field: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new HtscIndustrySentimentMappingError(`${field} is required`);
  return normalized;
}

function slug(value: string): string {
  return Buffer.from(value).toString("hex").slice(0, 32);
}
