import { SourceConnectorError, type SourceConnector, type SourceQueryRequest } from "@/src/connectors/source-connector";
import type { UnifiedSourceToolResult } from "@/src/tools/source-result-adapter";

export const CNINFO_CONNECTOR_ID = "cninfo.public.disclosure";
const SEARCH_ENDPOINT = "https://www.cninfo.com.cn/new/hisAnnouncement/query";
const STATIC_ORIGIN = "https://static.cninfo.com.cn/";

interface CninfoAnnouncement {
  announcementId?: string;
  announcementTitle?: string;
  announcementTime?: number;
  adjunctUrl?: string;
  secCode?: string;
  secName?: string;
  orgId?: string;
}

interface CninfoResponse {
  announcements?: CninfoAnnouncement[];
  totalAnnouncement?: number;
}

type FetchLike = typeof fetch;
const stripMarkup = (value: string) => value.replace(/<[^>]+>/g, "").replaceAll("&nbsp;", " ").trim();

export class CninfoDisclosureConnector implements SourceConnector {
  readonly id = CNINFO_CONNECTOR_ID;

  constructor(private readonly fetcher: FetchLike = fetch) {}

  async query(request: SourceQueryRequest): Promise<UnifiedSourceToolResult> {
    const companyCode = request.companyCode.replace(/^(?:SH|SZ)/i, "");
    if (!/^\d{6}$/.test(companyCode) || !request.companyName.trim() || !request.query.trim()) {
      throw new SourceConnectorError("CNInfo query requires a six-digit code, company name and query", "invalid_request", false, this.id);
    }
    const asOf = new Date(request.asOf);
    if (Number.isNaN(asOf.getTime())) throw new SourceConnectorError("CNInfo query asOf is invalid", "invalid_request", false, this.id);
    const requestedAt = new Date().toISOString();
    const plate = companyCode.startsWith("6") ? "sh" : "sz";
    const body = new URLSearchParams({
      pageNum: "1",
      pageSize: String(Math.min(30, Math.max(1, request.maxResults || 10))),
      column: plate === "sh" ? "sse" : "szse",
      tabName: "fulltext",
      plate,
      stock: companyCode,
      searchkey: request.query,
      secid: "",
      category: "category_ndbg_szsh;category_bndbg_szsh;category_sjdbg_szsh;category_yjygjxz_szsh",
      trade: "",
      seDate: `1990-01-01~${asOf.toISOString().slice(0, 10)}`,
      sortName: "time",
      sortType: "desc",
      isHLtitle: "true",
    });
    let response: Response;
    try {
      response = await this.fetcher(SEARCH_ENDPOINT, {
        method: "POST",
        headers: {
          accept: "application/json, text/plain, */*",
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
          origin: "https://www.cninfo.com.cn",
          referer: "https://www.cninfo.com.cn/",
          "user-agent": "InvestmentResearchWorkbench/0.1 (+public-disclosure-research)",
        },
        body,
      });
    } catch (error) {
      throw new SourceConnectorError(`CNInfo network failure: ${error instanceof Error ? error.message : String(error)}`, "upstream_unavailable", true, this.id);
    }
    if (!response.ok) throw new SourceConnectorError(`CNInfo returned HTTP ${response.status}`, response.status === 403 ? "permission_denied" : "upstream_unavailable", response.status >= 500 || response.status === 429, this.id);
    let payload: CninfoResponse;
    try { payload = await response.json() as CninfoResponse; }
    catch { throw new SourceConnectorError("CNInfo response is not valid JSON", "invalid_response", true, this.id); }
    const announcements = (payload.announcements || [])
      .filter((item) => item.announcementTitle && item.adjunctUrl && item.announcementTime)
      .filter((item) => Number(item.announcementTime) <= asOf.getTime())
      .sort((left, right) => Number(right.announcementTime) - Number(left.announcementTime));
    const announcement = announcements[0];
    if (!announcement) throw new SourceConnectorError("CNInfo returned no disclosure at or before asOf", "no_match", false, this.id);
    const retrievedAt = new Date().toISOString();
    const title = stripMarkup(announcement.announcementTitle || "");
    const publishedAt = new Date(Number(announcement.announcementTime)).toISOString();
    const uri = new URL(String(announcement.adjunctUrl), STATIC_ORIGIN).toString();
    const metadata = {
      producer: "cninfo.com.cn",
      announcementId: String(announcement.announcementId || announcement.adjunctUrl),
      securityCode: announcement.secCode || companyCode,
      securityName: announcement.secName || request.companyName,
      orgId: announcement.orgId || null,
      title,
      publishedAt,
      documentUri: uri,
      reportPeriod: request.reportPeriod || null,
      query: request.query,
      asOf: asOf.toISOString(),
    };
    const capturedBody = JSON.stringify(metadata, null, 2);
    return {
      connectorId: this.id,
      operation: "query_official_disclosures",
      requestParameters: { companyCode, companyName: request.companyName, query: request.query, asOf: asOf.toISOString(), reportPeriod: request.reportPeriod || "" },
      requestedAt,
      retrievedAt,
      upstream: {
        sourceId: String(announcement.announcementId || announcement.adjunctUrl),
        uri,
        title,
        publisherId: "cninfo.com.cn",
        publishedAt,
        sourceType: "primary",
      },
      capture: {
        body: capturedBody,
        locator: "巨潮资讯公告检索结果（正式 PDF 链接）",
        quote: title,
        permissionScope: "public_research_use",
      },
    };
  }
}
