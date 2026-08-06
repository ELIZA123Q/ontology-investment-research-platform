export const AUTHORITY_TYPES = [
  "official",
  "company_disclosure",
  "industry_provider",
  "public_secondary",
  "unknown",
] as const;

export type AuthorityType = (typeof AUTHORITY_TYPES)[number];

/** 对齐半导体 SourceProfile 的三类一手权威角色；仅作标注分类，不作覆盖 checklist。 */
export const CORE_AUTHORITY_TYPES = [
  "official",
  "company_disclosure",
  "industry_provider",
] as const;

export type CoreAuthorityType = (typeof CORE_AUTHORITY_TYPES)[number];

export function normalizeAuthorityType(value: unknown): AuthorityType {
  const raw = String(value || "unknown").trim();
  return (AUTHORITY_TYPES as readonly string[]).includes(raw) ? raw as AuthorityType : "unknown";
}

export function authorityTypeLabel(type: string): string {
  return (
    {
      official: "监管 / 官方原文",
      company_disclosure: "公司披露",
      industry_provider: "行业数据 / 协会统计",
      public_secondary: "公开二手",
      unknown: "未分类",
    } as Record<string, string>
  )[type] || type;
}
