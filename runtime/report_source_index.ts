type ReportClaimLike = {
  statement?: unknown;
  source_ids?: unknown;
};

export type ReportSourceLike = {
  id: string;
  title: string;
  publisher?: string | null;
  published_at?: string | null;
  url: string;
  locator?: string | null;
};

export type ReportClaimSourceEntry = {
  statement: string;
  sources: Array<{
    id: string;
    title: string;
    publisher: string;
    publishedAt: string;
    url: string;
    locator: string;
  }>;
};

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function markdownText(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/([\\[\]])/g, "\\$1").trim();
}

function sourceDate(value: string | null | undefined): string {
  if (!value) return "日期未登记";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toISOString().slice(0, 10);
}

export function buildReportClaimSourceIndex(
  reportData: Record<string, unknown>,
  sources: ReportSourceLike[],
): ReportClaimSourceEntry[] {
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const claims = Array.isArray(reportData.report_claims)
    ? reportData.report_claims as ReportClaimLike[]
    : [];
  return claims.map((claim) => {
    const seen = new Set<string>();
    const mappedSources = strings(claim.source_ids).flatMap((sourceId) => {
      if (seen.has(sourceId)) return [];
      seen.add(sourceId);
      const source = sourceMap.get(sourceId);
      if (!source) return [];
      return [{
        id: source.id,
        title: String(source.title || source.url).trim(),
        publisher: String(source.publisher || "未识别发布者").trim(),
        publishedAt: sourceDate(source.published_at),
        url: source.url,
        locator: String(source.locator || source.url).trim(),
      }];
    });
    return {
      statement: String(claim.statement || "").replace(/\s+/g, " ").trim(),
      sources: mappedSources,
    };
  }).filter((entry) => entry.statement && entry.sources.length);
}

export function appendReportClaimSourceIndex(
  markdown: string,
  reportData: Record<string, unknown>,
  sources: ReportSourceLike[],
): string {
  if (/^##\s+核心主张来源索引\s*$/m.test(markdown)) return markdown;
  const entries = buildReportClaimSourceIndex(reportData, sources);
  if (!entries.length) return markdown;
  const appendix = [
    "## 核心主张来源索引",
    "",
    "> 下列索引只展示已绑定到报告主张的来源，便于逐条复核；完整引文、正文哈希与审计记录保留在同一 release_id 的内部研究审计包中。",
    "",
    ...entries.flatMap((entry, index) => [
      `### ${index + 1}. ${markdownText(entry.statement)}`,
      "",
      ...entry.sources.map((source) =>
        `- [${markdownText(source.title)}](${source.url}) — ${markdownText(source.publisher)}，${source.publishedAt}`),
      "",
    ]),
  ].join("\n").trimEnd();
  return `${markdown.trimEnd()}\n\n${appendix}\n`;
}
