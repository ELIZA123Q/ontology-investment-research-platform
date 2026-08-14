import type {
  EvidenceFact, EvidenceRole, JudgmentType, MethodApplication, ReportKind, ReportSectionKey,
  ReportSpec, ResearchMethodPlan,
} from "@/src/contracts";
import { DOMAIN_CATALOG } from "@/src/generated/domain-catalog";

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

const governedProfiles = DOMAIN_CATALOG.reportGeneration.method_profiles;
const profiles = governedProfiles.sections as unknown as Partial<Record<ReportSectionKey, MethodProfile>>;
const coreByKind = governedProfiles.core_by_kind as unknown as Record<ReportKind, MethodProfile>;

export function selectResearchMethods(goal: string, reportSpec: ReportSpec): ResearchMethodPlan {
  const substantive = reportSpec.sections.filter((key) => profiles[key]);
  const sections = ["core_judgments" as const, ...substantive.filter((key) => key !== "core_judgments")];
  const domainExtension = governedProfiles.domain_extensions.semiconductor_cycle;
  const semiconductor = domainExtension.match.some((term) => goal.toLowerCase().includes(term.toLowerCase()));
  const applications = sections.map((sectionKey) => {
    const selected = sectionKey === "core_judgments" ? coreByKind[reportSpec.kind] : profiles[sectionKey]!;
    const frameworkIds = [...selected.frameworkIds];
    if (semiconductor && selected.judgmentType === domainExtension.judgmentType && !frameworkIds.includes(domainExtension.appendFrameworkId)) frameworkIds.push(domainExtension.appendFrameworkId);
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
