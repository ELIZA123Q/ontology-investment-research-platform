export const SOURCE_AUTHORITY_TYPES = [
  "official",
  "company_disclosure",
  "industry_provider",
  "public_secondary",
  "unknown",
] as const;

export type SourceAuthorityType = (typeof SOURCE_AUTHORITY_TYPES)[number];

/** 覆盖图默认应补齐的三类核心来源（对齐领域 SourceProfile）。 */
export const CORE_SOURCE_AUTHORITY_TYPES: SourceAuthorityType[] = [
  "official",
  "company_disclosure",
  "industry_provider",
];

export function normalizeSourceAuthorityType(value: unknown): SourceAuthorityType {
  const raw = String(value || "unknown").trim();
  return (SOURCE_AUTHORITY_TYPES as readonly string[]).includes(raw) ? raw as SourceAuthorityType : "unknown";
}

export function sourceAuthorityLabel(authority: string): string {
  return (
    {
      official: "监管 / 官方原文",
      company_disclosure: "公司披露",
      industry_provider: "行业数据 / 协会统计",
      public_secondary: "公开二手",
      unknown: "未分类",
    } as Record<string, string>
  )[authority] || authority;
}
