import type { EvidenceFact, JudgmentSurfaceData, ReportSectionKey, SourceReference, Task } from "@/src/contracts";
import type { ModelProvider } from "@/src/providers/model-provider";
import { ModelGateway } from "@/src/providers/model-gateway";
import type { ProfessionalReportDraft } from "@/src/reporting/report-composer";
import type { RuntimeStore } from "@/src/runtime/store";
import { deriveModelDataPolicy } from "@/src/providers/model-data-policy";

const DRAFTABLE_SECTIONS = new Set<ReportSectionKey>([
  "business_model", "financial_operating_analysis", "industry_structure", "cycle_supply_demand",
  "competitive_landscape", "mechanism_chain", "scenario_analysis", "alternative_hypotheses",
]);

export interface ModelSectionDraft {
  sectionKey: ReportSectionKey;
  paragraphs: string[];
  bullets: string[];
  usedEvidenceFactIds: string[];
  usedSourceIds: string[];
}

export interface ReportDraftingAttempt {
  attempted: boolean;
  cached: boolean;
  drafts?: ModelSectionDraft[];
  provider?: string;
  model?: string;
  fingerprint?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  errors?: string[];
}

export interface ReportDraftingInput {
  task: Task;
  baseline: ProfessionalReportDraft;
  judgment?: JudgmentSurfaceData;
  evidenceFacts: Array<EvidenceFact & { ontologyFactRef?: string }>;
  sourceRefs: SourceReference[];
}

const responseSchema = {
  type: "object", required: ["sections"], properties: { sections: { type: "array", items: { type: "object",
    required: ["sectionKey", "paragraphs", "bullets", "usedEvidenceFactIds", "usedSourceIds"],
    properties: {
      sectionKey: { type: "string" }, paragraphs: { type: "array", items: { type: "string" } }, bullets: { type: "array", items: { type: "string" } },
      usedEvidenceFactIds: { type: "array", items: { type: "string" } }, usedSourceIds: { type: "array", items: { type: "string" } },
    },
  } } },
} as const;

export async function requestReportSectionDrafts(store: RuntimeStore, provider: ModelProvider | null, input: ReportDraftingInput): Promise<ReportDraftingAttempt> {
  if (!provider) return { attempted: false, cached: false, errors: ["No configured model provider"] };
  const eligible = (input.baseline.data.sections || []).filter((section) => DRAFTABLE_SECTIONS.has(section.key) && section.status !== "not_applicable" && Boolean(section.evidenceFactIds?.length));
  if (!eligible.length) return { attempted: false, cached: false, errors: ["No eligible professional section requires model drafting"] };
  const verifiedSources = input.sourceRefs.filter((source) => source.verification === "verified");
  const facts = input.evidenceFacts.filter((fact) => fact.status === "verified").map((fact) => ({
    id: fact.id, ontologyFactRef: fact.ontologyFactRef, statement: fact.statement, factType: fact.factType,
    businessTime: fact.businessTime, evidenceRoles: fact.evidenceRoles || [], sourceId: fact.snapshotId,
  }));
  const requestInput = {
    reportSpec: input.task.reportSpec,
    researchGoal: input.task.goal,
    customInstructions: input.task.reportSpec.customInstructions || "",
    formalJudgment: input.judgment?.ontologyJudgmentRef ? {
      statement: input.judgment.statement, confidence: input.judgment.confidence, changeConditions: input.judgment.changeConditions,
    } : null,
    sections: eligible.map((section) => ({
      sectionKey: section.key, title: section.title, statusMustRemain: section.status,
      methodApplicationIds: section.methodApplicationIds || [], authorizedEvidenceFactIds: section.evidenceFactIds || [],
      missingInputs: section.missingInputs || [], deterministicBoundary: section.paragraphs,
    })),
    evidenceFacts: facts,
    verifiedSources: verifiedSources.map((source) => ({ sourceId: source.sourceId, publisherId: source.publisherId, locator: source.locator, quote: source.quote })),
    hardRules: [
      "只输出 JSON；只能返回请求中的 sectionKey。", "不得创造事实、数值、来源、公司、时间或方法。",
      "每一段必须由 usedEvidenceFactIds 和 usedSourceIds 所列输入支持。", "缺失输入必须保留，不得把 limited 升级为 ready。",
      "不得输出评级、买卖建议、目标价或保证收益。", "个性化只影响组织与解释密度，不改变正式判断和证据等级。",
    ],
  };
  const dataPolicy = deriveModelDataPolicy(input.sourceRefs, facts.map((fact) => fact.sourceId));
  try {
    const result = await new ModelGateway(store, provider).generate({
      operation: "report_section_drafting",
      promptVersion: "bounded-report-drafter/2.0.0",
      schemaVersion: "report-sections/1.0.0",
      system: "你是专业投研章节写作 Agent。你只能在给定 ReportSpec、正式 Judgment、EvidenceFact、MethodApplication 和来源引用内组织分析。输出 JSON，不得补写缺失研究。",
      prompt: JSON.stringify(requestInput), responseSchema: responseSchema as unknown as Record<string, unknown>, schemaName: "report_section_drafts", maxOutputTokens: 3000,
      dataPolicy,
      validateResponse: (value) => {
        const checked = validateResult(JSON.stringify(value), input, eligible.map((section) => section.key), { attempted: true, cached: false });
        if (checked.errors?.length) throw new Error(checked.errors.join("; "));
      },
    });
    return validateResult(result.text, input, eligible.map((section) => section.key), { attempted: true, cached: result.cached, provider: result.provider, model: result.model, usage: result.usage, fingerprint: result.fingerprint });
  } catch (error) {
    return { attempted: true, cached: false, provider: provider.id, errors: [error instanceof Error ? error.message : String(error)] };
  }
}

function validateResult(text: string, input: ReportDraftingInput, eligibleKeys: ReportSectionKey[], base: Omit<ReportDraftingAttempt, "drafts" | "errors">): ReportDraftingAttempt {
  const parsed = parseJson(text);
  if (!parsed || !Array.isArray(parsed.sections)) return { ...base, errors: ["Model report draft is not valid structured JSON"] };
  const errors: string[] = [];
  const eligible = new Set(eligibleKeys);
  const facts = new Map(input.evidenceFacts.filter((fact) => fact.status === "verified").map((fact) => [fact.id, fact]));
  const sources = new Map(input.sourceRefs.filter((source) => source.verification === "verified").map((source) => [source.sourceId, source]));
  const baselineSections = new Map((input.baseline.data.sections || []).map((section) => [section.key, section]));
  const allowedNumericTokens = numericTokens(JSON.stringify({ task: input.task.goal, spec: input.task.reportSpec, judgment: input.judgment, facts: [...facts.values()].map((fact) => fact.statement), sources: [...sources.values()].map((source) => source.quote) }));
  const seen = new Set<string>();
  const drafts = parsed.sections.flatMap((raw: unknown, index: number) => {
    if (!raw || typeof raw !== "object") { errors.push(`section ${index + 1} must be an object`); return []; }
    const item = raw as Record<string, unknown>;
    const sectionKey = String(item.sectionKey || "") as ReportSectionKey;
    if (!eligible.has(sectionKey)) errors.push(`section ${sectionKey || index + 1} is not eligible for model drafting`);
    if (seen.has(sectionKey)) errors.push(`section ${sectionKey} is duplicated`);
    seen.add(sectionKey);
    const paragraphs = textList(item.paragraphs, `section ${sectionKey} paragraphs`, errors);
    const bullets = textList(item.bullets, `section ${sectionKey} bullets`, errors);
    const usedEvidenceFactIds = textList(item.usedEvidenceFactIds, `section ${sectionKey} usedEvidenceFactIds`, errors);
    const usedSourceIds = textList(item.usedSourceIds, `section ${sectionKey} usedSourceIds`, errors);
    const authorizedFacts = new Set(baselineSections.get(sectionKey)?.evidenceFactIds || []);
    if (!paragraphs.length) errors.push(`section ${sectionKey} requires at least one paragraph`);
    if (usedEvidenceFactIds.some((id) => !facts.has(id) || !authorizedFacts.has(id))) errors.push(`section ${sectionKey} references an unauthorized EvidenceFact`);
    if (usedSourceIds.some((id) => !sources.has(id))) errors.push(`section ${sectionKey} references an unauthorized source`);
    const factSourceIds = new Set(usedEvidenceFactIds.map((id) => facts.get(id)?.snapshotId).filter(Boolean));
    if (usedSourceIds.some((id) => !factSourceIds.has(id))) errors.push(`section ${sectionKey} source references do not match its EvidenceFact inputs`);
    if ((paragraphs.length || bullets.length) && (!usedEvidenceFactIds.length || !usedSourceIds.length)) errors.push(`section ${sectionKey} prose requires EvidenceFact and source references`);
    const prose = [...paragraphs, ...bullets].join("\n");
    if (/<script|javascript:|onerror\s*=|onclick\s*=/i.test(prose)) errors.push(`section ${sectionKey} contains executable markup`);
    if (/买入|卖出|增持|减持|目标价|保证收益|稳赚/i.test(prose)) errors.push(`section ${sectionKey} contains a prohibited investment recommendation`);
    for (const token of numericTokens(prose)) if (!allowedNumericTokens.has(token)) errors.push(`section ${sectionKey} introduces unsupported numeric token ${token}`);
    if (paragraphs.some((value) => value.length > 1200) || bullets.some((value) => value.length > 500)) errors.push(`section ${sectionKey} exceeds the bounded prose length`);
    return [{ sectionKey, paragraphs, bullets, usedEvidenceFactIds, usedSourceIds } satisfies ModelSectionDraft];
  });
  return errors.length ? { ...base, errors: [...new Set(errors)] } : { ...base, drafts };
}

function parseJson(text: string): { sections?: unknown[] } | null {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { const parsed = JSON.parse(trimmed); return parsed && typeof parsed === "object" ? parsed as { sections?: unknown[] } : null; }
  catch { return null; }
}

function textList(value: unknown, field: string, errors: string[]): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) { errors.push(`${field} must be a string list`); return []; }
  return value.map((item) => item.trim()).filter(Boolean);
}

function numericTokens(text: string): Set<string> {
  return new Set(text.match(/\d+(?:\.\d+)?%?/g) || []);
}
