import type {
  EvidenceFact, EvidenceRole, HypothesisMapSurfaceData, JudgmentSurfaceData, MethodApplication,
  ReportSection, ReportSectionKey, ReportSurfaceData, ResearchMethodPlan, SourceReference, Task,
} from "@/src/contracts";
import { REPORT_KIND_LABELS, REPORT_SECTION_LABELS } from "@/src/reporting/report-spec";
import { assessResearchMethods, selectResearchMethods } from "@/src/research/method-router";
import type { ModelSectionDraft, ReportDraftingAttempt } from "@/src/reporting/report-model-drafter";

export interface ProfessionalReportInput {
  task: Task;
  judgment?: JudgmentSurfaceData;
  evidence?: { facts?: EvidenceFact[]; sufficient?: boolean; stopReason?: string };
  hypotheses?: HypothesisMapSurfaceData;
  methodPlan?: ResearchMethodPlan;
  sourceRefs: SourceReference[];
  modelDrafting?: Pick<ReportDraftingAttempt, "drafts" | "provider" | "model" | "fingerprint">;
}

export interface ProfessionalReportDraft {
  title: string;
  data: ReportSurfaceData;
  sourceRefs: SourceReference[];
}

const audienceLabels: Record<Task["reportSpec"]["audience"], string> = {
  portfolio_manager: "投资组合经理", investment_committee: "投资决策委员会", research_analyst: "研究员", client: "客户",
};
const depthLabels: Record<Task["reportSpec"]["depth"], string> = { brief: "简版", standard: "标准版", deep: "深度版" };

export function composeProfessionalReport(input: ProfessionalReportInput): ProfessionalReportDraft {
  const { task, judgment, evidence, hypotheses } = input;
  const sourceRefs = input.sourceRefs.filter((source) => source.verification === "verified");
  const facts = evidence?.facts || [];
  const formalJudgment = Boolean(judgment?.ontologyJudgmentRef && judgment.lifecycleStatus === "approved" && judgment.methodApplicationRefs?.length && judgment.methodGateStatus !== "blocked" && evidence?.sufficient);
  const methodPlan = assessResearchMethods(input.methodPlan || selectResearchMethods(task.goal, task.reportSpec), facts, formalJudgment);
  const sourceIds = [...new Set(sourceRefs.map((source) => source.sourceId))];
  const claims = formalJudgment && judgment ? [{ text: judgment.statement, sourceIds }] : [];
  const summary = judgment?.statement || "当前没有可交付的正式判断。";
  const boundary = formalJudgment
    ? "判断已由研究员确认并绑定正式 EvidenceFact；结论仅适用于报告所列范围、截止时间和改判条件。"
    : evidence?.stopReason || "证据未达到专业判断门槛，本报告只保留研究范围、证据缺口与后续核验条件。";
  const context = { task, judgment, evidence, hypotheses, facts, sourceRefs, sourceIds, formalJudgment, methods: methodPlan.applications };
  const sections = task.reportSpec.sections.map((key) => mergeModelDraft(buildSection(key, context), input.modelDrafting));
  const kindLabel = REPORT_KIND_LABELS[task.reportSpec.kind];
  return {
    title: `${kindLabel}｜${task.goal.length > 36 ? `${task.goal.slice(0, 36)}…` : task.goal}`,
    data: { summary, boundary, claims, reportSpec: task.reportSpec, sections, methodApplications: methodPlan.applications },
    sourceRefs,
  };
}

function mergeModelDraft(section: ReportSection, attempt?: ProfessionalReportInput["modelDrafting"]): ReportSection {
  const draft: ModelSectionDraft | undefined = attempt?.drafts?.find((item) => item.sectionKey === section.key);
  if (!draft || !attempt?.provider || !attempt.model || !attempt.fingerprint) return section;
  return {
    ...section,
    paragraphs: draft.paragraphs,
    bullets: draft.bullets,
    sourceIds: draft.usedSourceIds,
    evidenceFactIds: draft.usedEvidenceFactIds,
    modelDraft: { provider: attempt.provider, model: attempt.model, fingerprint: attempt.fingerprint },
  };
}

type SectionContext = {
  task: Task;
  judgment?: JudgmentSurfaceData;
  evidence?: ProfessionalReportInput["evidence"];
  hypotheses?: HypothesisMapSurfaceData;
  facts: EvidenceFact[];
  sourceRefs: SourceReference[];
  sourceIds: string[];
  formalJudgment: boolean;
  methods: MethodApplication[];
};

function buildSection(key: ReportSectionKey, context: SectionContext): ReportSection {
  const method = context.methods.find((item) => item.sectionKey === key);
  const base = {
    key, title: REPORT_SECTION_LABELS[key], sourceIds: [] as string[],
    methodApplicationIds: method ? [method.id] : [], evidenceFactIds: method?.evidenceFactIds || [],
    missingInputs: (method?.missingEvidenceRoles || []).map((role) => evidenceRoleLabels[role]),
  };
  const limited = (message: string): ReportSection => ({ ...base, status: "limited", paragraphs: [message], bullets: [] });
  const evidenceBullets = context.facts.map((fact) => fact.statement);
  const methodFacts = method ? context.facts.filter((fact) => method.evidenceFactIds.includes(fact.id)).map((fact) => fact.statement) : evidenceBullets;
  switch (key) {
    case "executive_summary":
      return { ...base, status: context.formalJudgment ? "ready" : "limited", paragraphs: [context.judgment?.statement || "暂不可判断"], bullets: context.judgment?.changeConditions || [], sourceIds: context.formalJudgment ? context.sourceIds : [] };
    case "research_scope":
      return { ...base, status: "ready", paragraphs: [context.task.goal, `交付对象：${audienceLabels[context.task.reportSpec.audience]}；深度：${depthLabels[context.task.reportSpec.depth]}。`, ...(context.task.reportSpec.customInstructions ? [`定制要求：${context.task.reportSpec.customInstructions}`] : [])], bullets: [] };
    case "core_judgments":
      return { ...base, status: context.formalJudgment ? "ready" : "limited", paragraphs: [context.judgment?.statement || "尚未形成判断。", `置信边界：${context.judgment?.confidence || "未评估"}`], bullets: [], sourceIds: context.formalJudgment ? context.sourceIds : [] };
    case "evidence_analysis":
      return evidenceBullets.length ? { ...base, status: context.evidence?.sufficient ? "ready" : "limited", paragraphs: [`已核验 ${evidenceBullets.length} 条 EvidenceFact。`], bullets: evidenceBullets, sourceIds: context.sourceIds } : limited(context.evidence?.stopReason || "没有可晋级的 EvidenceFact。");
    case "risks_change_conditions":
      return { ...base, status: context.judgment?.changeConditions.length ? "ready" : "limited", paragraphs: ["以下条件触发时应重新取证并评估，而不是静默维持原判断。"], bullets: context.judgment?.changeConditions || ["等待定义可操作的改判条件"] };
    case "source_appendix":
      return context.sourceRefs.length ? { ...base, status: "ready", paragraphs: ["仅列出已通过快照、定位和哈希校验的来源。"], bullets: context.sourceRefs.map((source) => `${source.title}｜${source.publisherId || "发布主体待识别"}｜${source.locator}`), sourceIds: context.sourceIds } : limited("没有通过确定性校验的来源可列示。");
    case "alternative_hypotheses": {
      const items = context.hypotheses?.hypotheses || [];
      return items.length ? { ...base, status: "ready", paragraphs: ["候选解释不等同于正式判断，需由区分性证据继续证伪。"], bullets: items.map((item) => `${item.statement}${item.falsificationConditions.length ? `；反证：${item.falsificationConditions.join("、")}` : ""}`) } : limited("本轮未形成可区分的竞争解释。");
    }
    case "industry_structure":
    case "cycle_supply_demand":
      return methodFacts.length ? { ...base, status: "limited", paragraphs: [methodBoundary(method)], bullets: methodFacts, sourceIds: context.sourceIds } : limited("缺少行业结构、供需或周期方法输入，不能用通用描述补齐。");
    case "competitive_landscape":
      return methodFacts.length ? { ...base, status: "limited", paragraphs: [methodBoundary(method), "尚未形成统一口径的竞争对象矩阵，因此不生成主观排名。"], bullets: methodFacts, sourceIds: context.sourceIds } : limited("缺少按统一口径核验的竞争对象比较，本节不生成主观排名。");
    case "business_model":
      return methodFacts.length ? { ...base, status: "limited", paragraphs: [methodBoundary(method)], bullets: methodFacts, sourceIds: context.sourceIds } : limited("缺少业务分部、价值链位置和盈利机制的正式证据，本节暂不扩写。");
    case "financial_operating_analysis":
      return methodFacts.length ? { ...base, status: "limited", paragraphs: [methodBoundary(method)], bullets: methodFacts, sourceIds: context.sourceIds } : limited("缺少经核验的财务与经营序列，不能形成趋势或质量判断。");
    case "valuation_scenarios":
      return methodFacts.length ? { ...base, status: "limited", paragraphs: [methodBoundary(method), "估值方法输出门尚未通过，不输出目标价或伪精确估值。"], bullets: methodFacts, sourceIds: context.sourceIds } : limited("尚未绑定估值基准、预测口径与情景参数，不输出目标价或伪精确估值。");
    case "mechanism_chain":
      return methodFacts.length ? { ...base, status: "limited", paragraphs: [methodBoundary(method)], bullets: methodFacts, sourceIds: context.sourceIds } : limited("尚未形成通过方法与证据约束的机制传导链。");
    case "scenario_analysis":
      return methodFacts.length ? { ...base, status: "limited", paragraphs: [methodBoundary(method), "尚未冻结情景变量、范围与概率口径。"], bullets: methodFacts, sourceIds: context.sourceIds } : limited("尚未冻结情景变量、范围与概率口径，本节只保留为待补研究模块。");
    case "delta_since_prior":
      return limited("尚未选择可比较的历史 Judgment 版本，不能声称发生改判或变化。");
    default:
      return { ...base, status: "not_applicable", paragraphs: [], bullets: [] };
  }
}

const evidenceRoleLabels: Record<EvidenceRole, string> = {
  demand: "需求", supply: "供给", inventory: "库存", price: "价格", utilization: "产能利用率",
  competition: "竞争口径", business_model: "商业模式", financial: "财务经营", expectation: "事前预期",
  valuation: "估值基准", mechanism: "机制路径", risk: "风险触发",
};

function methodBoundary(method?: MethodApplication): string {
  if (!method) return "本节尚未绑定受治理的方法应用。";
  const methods = [...method.frameworkIds, method.evidenceMethodId, method.adjudicationMethodId].join(" + ");
  const missing = method.missingEvidenceRoles.map((role) => evidenceRoleLabels[role]);
  return missing.length
    ? `已绑定 ${methods}，当前仅达到方法输入的部分覆盖；仍缺：${missing.join("、")}。`
    : `已绑定 ${methods} 并覆盖最低证据角色，但框架输出门仍需结构化执行与复核，当前不升级为正式章节判断。`;
}
