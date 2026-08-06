/** 正式包文件命名与主题短标题。 */

const ARCHETYPE_LABEL: Record<string, string> = {
  industry_cycle_report: "行业周期判断",
  event_commentary: "事件点评",
  industry_dynamic_commentary: "行业动态点评",
  company_earnings_commentary: "公司业绩点评",
  theme_deep_dive: "主题深度研究",
};

export function formalDateStamp(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/** 从核心对象或问题提炼适合文件名的短主题（去掉标点，截断）。 */
export function formalThemeSlug(input: {
  core_object?: string;
  normalized_question?: string;
  question?: string;
}): string {
  const raw = String(input.core_object || input.normalized_question || input.question || "研究任务").trim();
  const cleaned = raw
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/[，。；：、？！\s]+/g, "")
    .replace(/（.*?）|\(.*?\)/g, "")
    .slice(0, 24);
  return cleaned || "研究任务";
}

export function deliveryArchetypeLabel(primary: unknown): string {
  const key = String(primary || "industry_cycle_report");
  return ARCHETYPE_LABEL[key] || ARCHETYPE_LABEL.industry_cycle_report;
}

export type FormalPackNames = {
  theme: string;
  date: string;
  seq: number;
  stamp: string;
  dirName: string;
  stage01Md: string;
  stage02LogicMd: string;
  stage02ViewYaml: string;
  stage03PrepMd: string;
  stage03ManifestYaml: string;
  stage03SnapshotDir: string;
  stage03SnapshotSummaryMd: string;
  stage04BriefMd: string;
  stage04AuditYaml: string;
  stage05ReportMd: string;
  stage05AuditYaml: string;
  stage05SemanticReviewYaml: string;
};

export function buildFormalPackNames(input: {
  theme: string;
  date?: string;
  seq?: number;
  deliveryPrimary?: unknown;
}): FormalPackNames {
  const theme = input.theme || "研究任务";
  const date = input.date || formalDateStamp();
  const seq = input.seq && input.seq > 0 ? input.seq : 1;
  const stamp = `${date}-${seq}`;
  const deliveryLabel = deliveryArchetypeLabel(input.deliveryPrimary);
  return {
    theme,
    date,
    seq,
    stamp,
    dirName: `${theme}-${stamp}`,
    stage01Md: `01-${theme}投研需求说明-${stamp}.md`,
    stage02LogicMd: `02-${theme}研究逻辑-${stamp}.md`,
    stage02ViewYaml: `02-${theme}本体视图-${stamp}.yaml`,
    stage03PrepMd: `03-${theme}数据与证据准备-${stamp}.md`,
    stage03ManifestYaml: `03-${theme}语义域与证据域实例清单-${stamp}.yaml`,
    stage03SnapshotDir: `03-${theme}数据与证据快照-${stamp}`,
    stage03SnapshotSummaryMd: `03-${theme}数据与证据快照-${stamp}.md`,
    stage04BriefMd: `04-${theme}判断简报-${stamp}.md`,
    stage04AuditYaml: `04-${theme}推理审计-${stamp}.yaml`,
    stage05ReportMd: `05-${theme}${deliveryLabel}-${stamp}.md`,
    stage05AuditYaml: `05-${theme}表达审计-${stamp}.yaml`,
    stage05SemanticReviewYaml: `05-${theme}交付一致性检查-${stamp}.yaml`,
  };
}
