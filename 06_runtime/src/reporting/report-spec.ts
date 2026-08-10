import type { ReportKind, ReportSectionKey, ReportSpec, ReportSpecInput } from "@/src/contracts";

export const REPORT_SECTION_LABELS: Record<ReportSectionKey, string> = {
  executive_summary: "核心摘要",
  research_scope: "研究问题与范围",
  core_judgments: "核心判断",
  evidence_analysis: "证据与数据分析",
  business_model: "商业模式与价值链位置",
  financial_operating_analysis: "经营与财务分析",
  industry_structure: "行业结构",
  cycle_supply_demand: "周期、供给与需求",
  competitive_landscape: "竞争格局",
  valuation_scenarios: "估值与情景边界",
  mechanism_chain: "机制与传导链",
  scenario_analysis: "情景分析",
  alternative_hypotheses: "竞争解释与反证",
  delta_since_prior: "相对前次判断的变化",
  risks_change_conditions: "风险与改判条件",
  source_appendix: "来源与口径附录",
};

export const REPORT_KIND_LABELS: Record<ReportKind, string> = {
  company_research: "公司研究",
  industry_research: "行业研究",
  thematic_research: "专题研究",
  evidence_update: "证据更新",
  judgment_update: "判断更新",
};

const BASE_REQUIRED: ReportSectionKey[] = [
  "executive_summary", "research_scope", "core_judgments", "evidence_analysis", "risks_change_conditions", "source_appendix",
];

const KIND_REQUIRED: Record<ReportKind, ReportSectionKey[]> = {
  company_research: ["business_model", "financial_operating_analysis", "competitive_landscape", "valuation_scenarios"],
  industry_research: ["industry_structure", "cycle_supply_demand", "competitive_landscape"],
  thematic_research: ["mechanism_chain", "scenario_analysis", "alternative_hypotheses"],
  evidence_update: ["delta_since_prior"],
  judgment_update: ["delta_since_prior", "alternative_hypotheses"],
};

const SECTION_ORDER = Object.keys(REPORT_SECTION_LABELS) as ReportSectionKey[];
const validKinds = new Set(Object.keys(REPORT_KIND_LABELS));
const validAudiences = new Set(["portfolio_manager", "investment_committee", "research_analyst", "client"]);
const validDepths = new Set(["brief", "standard", "deep"]);
const validSections = new Set(SECTION_ORDER);

export function normalizeReportSpec(input: ReportSpecInput | (Partial<ReportSpec> & { optionalSections?: ReportSectionKey[] }) = {}): ReportSpec {
  const kind = validKinds.has(String(input.kind)) ? input.kind! : "thematic_research";
  const audience = validAudiences.has(String(input.audience)) ? input.audience! : "research_analyst";
  const depth = validDepths.has(String(input.depth)) ? input.depth! : "standard";
  const persistedSections = "sections" in input && Array.isArray(input.sections) ? input.sections : [];
  const optional = [
    ...(Array.isArray(input.optionalSections) ? input.optionalSections : []),
    ...persistedSections,
  ].filter((item): item is ReportSectionKey => validSections.has(item));
  const required = new Set<ReportSectionKey>([...BASE_REQUIRED, ...KIND_REQUIRED[kind], ...optional]);
  const customInstructions = typeof input.customInstructions === "string" ? input.customInstructions.trim().slice(0, 500) : "";
  return {
    version: "1.0.0", kind, audience, depth, language: "zh-CN",
    sections: SECTION_ORDER.filter((section) => required.has(section)),
    ...(customInstructions ? { customInstructions } : {}),
  };
}

export function inferReportKind(goal: string): ReportKind {
  const text = goal.toLowerCase();
  if (/公司|企业|个股|标的|财务|估值/.test(text)) return "company_research";
  if (/行业|产业|供需|周期|竞争格局/.test(text)) return "industry_research";
  if (/更新判断|重新判断|改判/.test(text)) return "judgment_update";
  if (/只补|证据更新|补充来源/.test(text)) return "evidence_update";
  return "thematic_research";
}

export function reportSpecForGoal(goal: string, input?: ReportSpecInput): ReportSpec {
  return normalizeReportSpec({ ...input, kind: input?.kind || inferReportKind(goal) });
}
