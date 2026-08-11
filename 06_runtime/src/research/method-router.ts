import type {
  EvidenceFact, EvidenceRole, JudgmentType, MethodApplication, ReportKind, ReportSectionKey,
  ReportSpec, ResearchMethodPlan,
} from "@/src/contracts";

const FRAMEWORK_REGISTRY = "03_agent_capability/02_skills/research_design/registry.yaml";
const EVIDENCE_REGISTRY = "03_agent_capability/02_skills/evidence_research/registry.yaml";
const ADJUDICATION_REGISTRY = "05_control_evaluation/01_rules/policies/judgment_method_routes.yaml";

interface MethodProfile {
  judgmentType: JudgmentType;
  frameworkIds: string[];
  evidenceMethodId: string;
  adjudicationMethodId: string;
  requiredEvidenceRoles: EvidenceRole[];
  rationale: string;
}

const profiles: Partial<Record<ReportSectionKey, MethodProfile>> = {
  business_model: profile("state_measurement", ["BF-BM-01"], "kb03:A02", "kb04:A01", ["business_model", "financial"], "先验证收入机制与单位经济，再讨论商业模式质量。"),
  financial_operating_analysis: profile("impact_realization", ["BF-FQ-01", "BF-EE-01"], "kb03:A06", "kb04:A08", ["financial", "business_model"], "把报表事实、正常化基线和经营到财务的桥接分开核验。"),
  industry_structure: profile("state_measurement", ["BF-IC-01"], "kb03:A02", "kb04:A01", ["competition", "supply"], "先冻结可替代市场边界，再比较参与者、产能和利润池。"),
  cycle_supply_demand: profile("cycle_phase", ["BF-SD-01"], "kb03:A03", "kb04:A03", ["demand", "supply", "price"], "以需求、有效供给和价格/库存时钟共同判断周期，禁止单指标定阶段。"),
  competitive_landscape: profile("object_differentiation", ["BF-IC-01"], "kb03:A05", "kb04:A07", ["competition", "financial"], "所有竞争对象必须使用统一产品、地域、期间和指标口径。"),
  valuation_scenarios: profile("valuation_impact", ["BF-EE-01", "BF-FS-01", "BF-EG-01", "BF-VA-01"], "kb03:A07", "kb04:A08", ["financial", "expectation", "valuation"], "估值只能承接已通过的盈利桥、预测基线和事前预期，不能从主题判断直接跳到目标价。"),
  mechanism_chain: profile("transmission_path", ["BF-VT-01"], "kb03:A04", "kb04:A06", ["mechanism", "demand", "supply"], "逐段验证起点、传导节点、吸收或放大机制与终点结果。"),
  scenario_analysis: profile("impact_realization", ["BF-RS-01", "BF-FS-01"], "kb03:A06", "kb04:A08", ["risk", "financial", "expectation"], "情景必须绑定可观察触发条件、经营/财务变量和退出条件。"),
  alternative_hypotheses: profile("causal_attribution", ["BF-VT-01"], "kb03:A04", "kb04:A05", ["mechanism", "demand"], "枚举竞争解释并寻找能够区分解释的证据，而不是罗列同义原因。"),
  delta_since_prior: profile("trend_direction", ["JF-TREND"], "kb03:A03", "kb04:A02", ["expectation", "demand"], "只比较同口径、同范围且带版本时间戳的历史判断。"),
  risks_change_conditions: profile("impact_realization", ["BF-RS-01"], "kb03:A06", "kb04:A08", ["risk"], "风险必须写成可观察触发、暴露、缓冲和恢复路径。"),
};

const coreByKind: Record<ReportKind, MethodProfile> = {
  company_research: profile("impact_realization", ["BF-BM-01", "BF-EE-01"], "kb03:A06", "kb04:A08", ["business_model", "financial"], "公司主判断必须落到经营、盈利或现金桥，而不是停在行业叙事。"),
  industry_research: profile("cycle_phase", ["BF-SD-01"], "kb03:A03", "kb04:A03", ["demand", "supply", "price"], "行业主判断用供需、价格和周期阶段形成可证伪结论。"),
  thematic_research: profile("transmission_path", ["BF-VT-01"], "kb03:A04", "kb04:A06", ["mechanism", "demand", "supply"], "主题主判断必须经过机制与路径验证，不能把共现当作传导。"),
  evidence_update: profile("trend_direction", ["JF-TREND"], "kb03:A03", "kb04:A02", ["demand", "expectation"], "证据更新只说明同口径事实的新增方向，不自动升级原判断。"),
  judgment_update: profile("trend_direction", ["JF-TREND"], "kb03:A03", "kb04:A02", ["demand", "expectation"], "改判必须说明相对旧版本的新增事实、方向和失效条件。"),
};

function profile(judgmentType: JudgmentType, frameworkIds: string[], evidenceMethodId: string, adjudicationMethodId: string, requiredEvidenceRoles: EvidenceRole[], rationale: string): MethodProfile {
  return { judgmentType, frameworkIds, evidenceMethodId, adjudicationMethodId, requiredEvidenceRoles, rationale };
}

export function selectResearchMethods(goal: string, reportSpec: ReportSpec): ResearchMethodPlan {
  const substantive = reportSpec.sections.filter((key) => profiles[key]);
  const sections = ["core_judgments" as const, ...substantive.filter((key) => key !== "core_judgments")];
  const semiconductor = /半导体|芯片|存储|dram|nand|hbm|封装|晶圆|semiconductor/i.test(goal);
  const applications = sections.map((sectionKey) => {
    const selected = sectionKey === "core_judgments" ? coreByKind[reportSpec.kind] : profiles[sectionKey]!;
    const frameworkIds = [...selected.frameworkIds];
    if (semiconductor && selected.judgmentType === "cycle_phase" && !frameworkIds.includes("IF-SC-01")) frameworkIds.push("IF-SC-01");
    return application(sectionKey, selected, frameworkIds);
  });
  return {
    version: "1.0.0",
    selectionMode: "bounded_default",
    knowledgeVersions: { framework: "2.0.0", evidence: "3.2.0", adjudication: "1.0.0" },
    applications,
    exitCondition: "任一章节的方法前提或最低证据角色未满足时，该章节必须降为 provisional/blocked，并输出缺口，不得补写结论。",
  };
}

export function assessResearchMethods(plan: ResearchMethodPlan, facts: EvidenceFact[], formalJudgment: boolean): ResearchMethodPlan {
  return {
    ...plan,
    applications: plan.applications.map((item) => {
      const matched = unique(facts.flatMap((fact) => fact.evidenceRoles || deriveEvidenceRoles(fact.statement))).filter((role) => item.requiredEvidenceRoles.includes(role));
      const missing = item.requiredEvidenceRoles.filter((role) => !matched.includes(role));
      const evidenceFactIds = facts.filter((fact) => (fact.evidenceRoles || deriveEvidenceRoles(fact.statement)).some((role) => item.requiredEvidenceRoles.includes(role))).map((fact) => fact.id);
      const gateStatus = missing.length === 0 && formalJudgment ? "passed" : matched.length ? "provisional" : "blocked";
      const executionStatus = missing.length === 0 && formalJudgment ? "executed" : matched.length ? "bound" : "blocked";
      return { ...item, matchedEvidenceRoles: matched, missingEvidenceRoles: missing, evidenceFactIds, gateStatus, executionStatus };
    }),
  };
}

export function deriveEvidenceRoles(statement: string): EvidenceRole[] {
  const rules: Array<[EvidenceRole, RegExp]> = [
    ["demand", /需求|订单|消耗|出货|demand|orders?|consumption|shipment/i],
    ["supply", /供给|供应|产能|扩产|晶圆|supply|capacity|wafer|production/i],
    ["inventory", /库存|存货|inventory/i],
    ["price", /价格|售价|asp|price|pricing/i],
    ["utilization", /利用率|稼动率|开工率|utilization/i],
    ["competition", /竞争|份额|市占|对手|market share|competitor|ranking/i],
    ["business_model", /客户|合同|商业模式|收费|订阅|customer|contract|business model|subscription/i],
    ["financial", /收入|利润|毛利|现金流|资本开支|revenue|profit|margin|cash flow|capex/i],
    ["expectation", /预期|预测|展望|一致预期|forecast|outlook|consensus|expects?/i],
    ["valuation", /估值|目标价|倍数|市盈率|dcf|valuation|multiple|target price/i],
    ["mechanism", /机制|传导|驱动|转化|因果|mechanism|transmission|driver|causal/i],
    ["risk", /风险|下行|压力|违约|不确定|risk|downside|stress|covenant|uncertain/i],
  ];
  return rules.filter(([, pattern]) => pattern.test(statement)).map(([role]) => role);
}

function application(sectionKey: ReportSectionKey, selected: MethodProfile, frameworkIds: string[]): MethodApplication {
  return {
    id: `MA-${sectionKey}`,
    sectionKey,
    judgmentType: selected.judgmentType,
    frameworkIds,
    evidenceMethodId: selected.evidenceMethodId,
    adjudicationMethodId: selected.adjudicationMethodId,
    requiredEvidenceRoles: selected.requiredEvidenceRoles,
    matchedEvidenceRoles: [], missingEvidenceRoles: selected.requiredEvidenceRoles, evidenceFactIds: [],
    rationale: selected.rationale, gateStatus: "selected", executionStatus: "candidate",
    sourceRefs: [FRAMEWORK_REGISTRY, EVIDENCE_REGISTRY, ADJUDICATION_REGISTRY],
  };
}

function unique<T>(values: T[]): T[] { return [...new Set(values)]; }
