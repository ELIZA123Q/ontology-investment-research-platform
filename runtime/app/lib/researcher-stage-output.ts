import { stripInternalReferencePrefix } from "@/runner/research_overview";

type UnknownRecord = Record<string, any>;

export type StageExceptionView = {
  tone: "blocking" | "limiting";
  title: string;
  items: string[];
};

export type StageDecisionView = {
  outcome: string;
  exception: StageExceptionView | null;
};

/** 统一研究员主视图：正常校验不产生提示，阻断优先于强度限制。 */
export function buildStageDecisionView(options: {
  outcome: unknown;
  blockingReasons?: unknown[];
  limitingReasons?: unknown[];
  blockingTitle?: string;
  limitingTitle?: string;
}): StageDecisionView {
  const unique = (items: unknown[] = []) => Array.from(new Set(items.map(researcherLanguage).filter(Boolean)));
  const blocking = unique(options.blockingReasons);
  const limiting = unique(options.limitingReasons);
  return {
    outcome: researcherLanguage(options.outcome),
    exception: blocking.length ? {
      tone: "blocking",
      title: options.blockingTitle || "确认前需处理",
      items: blocking,
    } : limiting.length ? {
      tone: "limiting",
      title: options.limitingTitle || "当前结论强度受限",
      items: limiting,
    } : null,
  };
}

function records(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.filter((item): item is UnknownRecord => Boolean(item && typeof item === "object")) : [];
}

function statementRecords(value: unknown): UnknownRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (item && typeof item === "object") return [item as UnknownRecord];
    const statement = String(item || "").trim();
    return statement ? [{ statement }] : [];
  });
}

function refs(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(String).map((item) => item.trim()).filter(Boolean)
    : [];
}

export function researcherLanguage(value: unknown): string {
  return stripInternalReferencePrefix(value)
    .replace(/\bJU-0*(\d+)\b/gi, "关键判断 $1")
    .replace(/\bEV-[A-Za-z0-9._-]+\b/gi, "已确认事实")
    .replace(/\bER-[A-Za-z0-9._-]+\b/gi, "证据要求")
    .replace(/\bGAP-[A-Za-z0-9._-]+\b/gi, "尚缺的证据")
    .replace(/\bCE-[A-Za-z0-9._-]+\b/gi, "竞争解释")
    .replace(/\bCD-[A-Za-z0-9._-]+\b/gi, "反证方向")
    .replace(/\bMA-[A-Za-z0-9._-]+\b/gi, "方法应用")
    .replace(/\b(?:EX|RC)-[A-Za-z0-9._-]+\b/gi, "研究结论")
    .replace(/\bJ-[A-Za-z0-9._-]+\b/gi, "判断")
    .replace(/\bRS-[A-Za-z0-9._-]+\b/gi, "研究范围")
    .replace(/\b(?:RQ|Q)-[A-Za-z0-9._-]+\b/gi, "研究问题")
    .replace(/\bSRC-[A-Za-z0-9._-]+\b/gi, "来源")
    .replace(/\bC-[A-Za-z0-9._-]+\b/gi, "计算结果")
    .replace(/\bS1\b/g, "一手来源")
    .replace(/\bMethodApplication\b/g, "方法应用")
    .replace(/\bEvidenceFact\b/g, "已确认事实")
    .replace(/\bJudgment\b/g, "判断")
    .replace(/\bDeepSeek\b/gi, "自动判断生成")
    .replace(/\bSignal\b/g, "研究信号")
    .replace(/搜索工具/g, "本次自动检索")
    .replace(/标记为\s*gap/gi, "登记为尚缺的证据")
    .replace(/\bgap\b/gi, "尚缺的证据")
    .replace(/本次本次自动检索/g, "本次自动检索")
    .replace(/(?:获批事实|已批准事实)/g, "已确认事实")
    .replace(/本次证据收集阶段面临本次自动检索/g, "本次证据收集受自动检索")
    .replace(/标记为缺口[（(]证据缺口[）)]/g, "登记为尚缺的证据")
    .replace(/证据缺口/g, "尚缺的证据")
    .replace(/\bStage[\s_-]*0?([1-5])\b/gi, (_, stage) => (
      { "1": "范围阶段", "2": "结构阶段", "3": "证据阶段", "4": "判断阶段", "5": "交付阶段" } as Record<string, string>
    )[stage] || `第${stage}阶段`)
    .replace(/\bevidence_scope_time_alignment\b/g, "证据范围与时间一致性")
    .replace(/\bstate_time_consistency\b/g, "状态与时间一致性")
    .replace(/\bno_direct_evidence_to_judgment\b/g, "证据需经过推理再形成判断")
    .replace(/\bjudgment_reference_integrity\b/g, "判断引用完整性")
    .replace(/\bjudgment_evidence_threshold\b/g, "判断证据门槛")
    .replace(/\bjudgment_status_consistency\b/g, "判断强度与状态一致性")
    .replace(/\bexpectation_projection_integrity\b/g, "预期差映射完整性")
    .replace(/\bvaluation_hypothesis_level_coupling\b/g, "估值假设与判断强度匹配")
    .replace(/\brisk_exposure_blocking_linkage\b/g, "风险暴露与阻断条件关联")
    .replace(/\bvalue_chain_propagation_consistency\b/g, "产业链传导一致性")
    .replace(/\bsemiconductor_proxy_disclosure\b/g, "半导体代理证据披露")
    .replace(/\bsemiconductor_qualification_stage_alignment\b/g, "半导体验证阶段口径一致性")
    .replace(/\bsemiconductor_capacity_yield_scope_alignment\b/g, "半导体产能良率口径一致性")
    .replace(/\bsource_group\b/gi, "来源组")
    .replace(/\bJ[0-4]\b/g, (strength) => judgmentStrengthLabel(strength))
    .replace(/方向的\s*方向观察/g, "方向观察")
    .replace(/\s+(暂不可判断|方向观察|有条件判断|强判断|行动级判断)/g, "$1")
    .replace(/[（(]计算结果[，,]\s*由\s*计算结果\s*与\s*计算结果\s*推导[）)]/g, "（由上述两项数据计算）")
    .replace(/方向观察\s*观察/g, "方向观察")
    .replace(/(?:已确认事实\s*[、,，]\s*)+已确认事实/g, "已确认事实")
    .replace(/可核验\s+已确认事实/g, "可核验的已确认事实")
    .replace(/已确认事实\s+或\s+研究信号/g, "已确认事实或研究信号")
    .replace(/自动判断生成\s+未/g, "自动判断生成未")
    .replace(/\s+(已确认事实|来源组)\s+/g, "$1")
    .replace(/；仍有\s*0\s*个冲突或尚缺的证据需要纳入边界。?/g, "。")
    .replace(/；仍有\s*0\s*个冲突或证据缺口需要纳入边界。?/g, "。")
    .replace(/到\s+(范围|结构|证据|判断|交付)阶段\s+/g, "到$1阶段")
    .replace(/：暂不可判断：当前暂不可形成方向判断[（(]暂不可判断[）)]/g, "：当前证据不足，暂不可形成方向判断")
    .replace(/暂不可判断\s*\/\s*暂不可判断/g, "暂不可判断")
    .replace(/本产物只登记/g, "本报告只呈现")
    .replace(/上游只有经人工接受的证据缺口/g, "上游目前只有研究员确认的尚缺证据")
    .replace(/上游目前只有研究员确认的证据缺口/g, "上游目前只有研究员确认的尚缺证据")
    .replace(/经人工接受的证据缺口/g, "研究员确认的尚缺证据")
    .replace(/研究员确认的证据缺口/g, "研究员确认的尚缺证据")
    .replace(/至少方向观察\s*的可核验事实级证据/g, "方向观察所需的可核验事实")
    .replace(/冲突或尚缺的证据/g, "相互矛盾或尚缺的证据")
    .replace(/冲突或证据缺口/g, "相互矛盾或尚缺的证据")
    .replace(/接受当前缺口/g, "确认当前暂缺")
    .replace(/接受缺口/g, "确认暂缺")
    .replace(/明确缺口/g, "尚缺的证据")
    .replace(/单元缺口/g, "单元尚缺项")
    .replace(/反证缺口/g, "反证暂缺")
    .replace(/追溯缺口/g, "追溯不完整")
    .replace(/(?<!知识|尚缺的证|确认暂)缺口/g, "尚缺")
    .replace(/\s+([，。；：、])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export type ScopeStageSummary = {
  question: string;
  coreObject: string;
  judgmentAction: string;
  timeScope: Array<{ label: string; value: string }>;
  boundaries: string[];
  exclusions: string[];
  reportType: string;
};

export function buildScopeStageSummary(data: UnknownRecord, fallbackQuestion = ""): ScopeStageSummary {
  const timeScope = data.time_scope && typeof data.time_scope === "object"
    ? data.time_scope as UnknownRecord
    : {};
  return {
    question: researcherLanguage(data.normalized_question || fallbackQuestion),
    coreObject: researcherLanguage(data.core_object),
    judgmentAction: researcherLanguage(data.judgment_action),
    timeScope: [
      { label: "回看范围", value: researcherLanguage(timeScope.lookback) },
      { label: "判断时点", value: researcherLanguage(timeScope.as_of) },
      { label: "前瞻范围", value: researcherLanguage(timeScope.forward) },
    ].filter((item) => Boolean(item.value)),
    boundaries: displayStrings(data.boundaries),
    exclusions: displayStrings(data.exclusions),
    reportType: researcherLanguage(data.report_type),
  };
}

export function researcherMarkdown(value: unknown): string {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => researcherLanguage(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function formatResearchDate(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "未设定";
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return researcherLanguage(raw);
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

function displayStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(researcherLanguage).filter(Boolean) : [];
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items));
}

function structureItemKey(value: string): string {
  return value
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/[\s，。；：、,.;:]/g, "")
    .toLowerCase();
}

function uniqueStructureItems(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = structureItemKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function recordId(item: UnknownRecord): string {
  return String(
    item.id
    || item.judgment_unit_id
    || item.judgment_unit_ref
    || item.evidence_id
    || item.explanation_id
    || item.direction_id
    || "",
  );
}

function boundToUnit(item: UnknownRecord, unitId: string): boolean {
  const unitRefs = refs(item.judgment_unit_ids || item.target_judgment_unit_refs);
  return unitRefs.length === 0 || unitRefs.includes(unitId);
}

export type StructureUnitSummary = {
  id: string;
  title: string;
  question: string;
  evidenceRequirements: string[];
  competingExplanations: string[];
  counterEvidence: string[];
};

export function buildStructureStageSummary(data: UnknownRecord): StructureUnitSummary[] {
  const formalRequirements = statementRecords(data.evidence_requirements);
  const competitors = statementRecords(data.competing_explanations);
  const counterDirections = statementRecords(data.counter_evidence_directions);

  return records(data.judgment_units).map((unit, index) => {
    const id = recordId(unit) || `unit-${index + 1}`;
    const inlineRequirements = displayStrings(unit.evidence_requirements);
    const linkedRequirements = formalRequirements
      .filter((item) => boundToUnit(item, id))
      .map((item) => stripInternalReferencePrefix(item.requirement || item.statement))
      .filter(Boolean);
    const evidenceRequirements = uniqueStructureItems([...inlineRequirements, ...linkedRequirements]);
    const counterEvidence = uniqueStructureItems(counterDirections
      .filter((item) => boundToUnit(item, id))
      .map((item) => researcherLanguage(item.statement || item.direction))
      .filter(Boolean));
    const counterKeys = new Set(counterEvidence.map(structureItemKey));
    const competingExplanations = uniqueStructureItems(competitors
      .filter((item) => boundToUnit(item, id))
      .map((item) => researcherLanguage(item.statement || item.explanation))
      .filter(Boolean))
      .filter((item) => !counterKeys.has(structureItemKey(item)));
    return {
      id,
      title: researcherLanguage(unit.title || unit.statement || unit.question) || `关键判断 ${index + 1}`,
      question: researcherLanguage(unit.question || unit.statement || ""),
      evidenceRequirements,
      competingExplanations,
      counterEvidence,
    };
  });
}

export type JudgmentSummary = {
  id: string;
  title: string;
  conclusion: string;
  strength: string;
  strengthLabel: string;
  statusLabel: string;
  rationale: string;
  evidence: string[];
  uncertainties: string[];
  competingExplanations: string[];
  invalidationConditions: string[];
  trackingSignals: string[];
};

export function judgmentStrengthLabel(value: unknown): string {
  return (
    {
      J0: "暂不可判断",
      J1: "方向观察",
      J2: "有条件判断",
      J3: "强判断",
      J4: "行动级判断",
    } as Record<string, string>
  )[String(value || "J0")] || String(value || "未标注");
}

export function judgmentDecisionStatusLabel(value: unknown): string {
  return (
    {
      supported: "证据支持",
      indeterminate: "证据不足",
      contested: "存在冲突",
      blocked: "判断受阻",
      invalidated: "已失效",
      draft: "草稿",
    } as Record<string, string>
  )[String(value || "draft")] || String(value || "未标注");
}

export function buildJudgmentStageSummary(
  data: UnknownRecord,
  evidenceDrafts: unknown,
): JudgmentSummary[] {
  const evidence = records(evidenceDrafts);
  const evidenceById = new Map(evidence.map((item) => [recordId(item), item]));
  const competitors = records(data.competing_explanations);

  return records(data.judgments).map((judgment, index) => {
    const id = recordId(judgment) || `judgment-${index + 1}`;
    const unitId = String(judgment.judgment_unit_id || judgment.judgment_unit_ref || "");
    const evidenceRefs = refs(
      judgment.supporting_evidence_draft_ids
      || judgment.evidence_draft_ids
      || judgment.evidence_refs,
    );
    return {
      id,
      title: researcherLanguage(judgment.title || "") || `判断 ${index + 1}`,
      conclusion: researcherLanguage(judgment.conclusion || judgment.statement || judgment.title),
      strength: String(judgment.strength || judgment.level || "J0"),
      strengthLabel: judgmentStrengthLabel(judgment.strength || judgment.level),
      statusLabel: judgmentDecisionStatusLabel(judgment.decision_status),
      rationale: researcherLanguage(judgment.rationale || judgment.why || ""),
      evidence: unique(evidenceRefs
        .map((ref) => evidenceById.get(ref))
        .filter(Boolean)
        .map((item) => researcherLanguage(item?.statement))
        .filter(Boolean)),
      uncertainties: unique(displayStrings(judgment.uncertainties || judgment.limitations)),
      competingExplanations: unique(competitors
        .filter((item) => !unitId || boundToUnit(item, unitId))
        .map((item) => researcherLanguage(item.statement || item.explanation))
        .filter(Boolean)),
      invalidationConditions: unique(displayStrings(judgment.invalidation_conditions)),
      trackingSignals: unique(displayStrings(judgment.tracking_signals)),
    };
  });
}

function readerStrength(value: string): string {
  return judgmentStrengthLabel(value);
}

/**
 * Stage05 keeps IDs in the persisted artifact for traceability. The reader preview
 * removes that audit layer while leaving the stored/exported package unchanged.
 */
export function prepareReaderReportMarkdown(content: string): string {
  const lines = String(content || "").split(/\r?\n/);
  const output: string[] = [];
  let conclusionIndex = 0;
  let skipAuditList = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (/^#\s+本体约束的投研判断报告\s*$/.test(line)) {
      output.push("# 研究判断报告");
      skipAuditList = false;
      continue;
    }
    if (/^##\s+已确认判断投影\s*$/.test(line)) {
      output.push("## 核心结论");
      skipAuditList = false;
      continue;
    }
    if (/^#{2,4}\s+(?:审计|追溯|表达映射|机器可读)/.test(line)) {
      skipAuditList = true;
      continue;
    }
    if (/^###\s+(?:EX|RC)-[A-Za-z0-9._-]+\s*$/.test(line)) {
      conclusionIndex += 1;
      output.push(`### 核心结论 ${conclusionIndex}`);
      skipAuditList = false;
      continue;
    }
    if (/^\s*[-*]\s+(?:Judgment|MethodApplication|EvidenceFact|Source|表达编号|判断编号|方法编号|证据编号)\s*[：:]/i.test(line)) {
      continue;
    }
    if (skipAuditList && /^\s*[-*]\s+/.test(line)) continue;
    if (line && !/^#{2,4}\s+/.test(line)) skipAuditList = false;

    output.push(
      researcherLanguage(
        line
        .replace(/（(J[0-4])\/(?:supported|indeterminate|contested|blocked|invalidated|draft)）/g, (_, strength) => `（${readerStrength(strength)}）`)
        .replace(/\((J[0-4])\/(?:supported|indeterminate|contested|blocked|invalidated|draft)\)/g, (_, strength) => `（${readerStrength(strength)}）`)
        .replace(/\bJ[0-4]\b/g, (strength) => readerStrength(strength))
        .replace(/\bsource_group\b/g, "来源组"),
      ),
    );
  }

  return output
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** UI 层统一推进状态：折叠四套运行状态为研究员可操作信息。 */
export type ResearcherProceedState = {
  canProceed: boolean;
  blockingReasons: string[];
  attentionItems: string[];
  statusLabel: string;
};

export type ResearcherStageView = {
  stage: number;
  title: string;
  summary: string;
  outputCount: number;
  proceed: ResearcherProceedState;
  sections: Array<{
    id: string;
    label: string;
    body: string;
    items?: string[];
    emptyBody?: string;
  }>;
  auditRefs: string[];
};

export function buildProceedState(input: {
  artifactStatus?: string | null;
  pendingCount?: number;
  blockingReasons?: string[];
  attentionItems?: string[];
}): ResearcherProceedState {
  const pending = Number(input.pendingCount || 0);
  const blocking = [...(input.blockingReasons || [])];
  if (pending > 0) blocking.push(`仍有 ${pending} 项待人工确认`);
  if (input.artifactStatus === "failed") blocking.push("本阶段生成失败，需重新生成或登记尚缺");
  if (input.artifactStatus === "running") blocking.push("模型仍在生成中");
  const canProceed = input.artifactStatus === "needs_review" && blocking.length === 0;
  const statusLabel = (
    {
      approved: "已确认",
      needs_review: canProceed ? "待确认" : "待处理",
      running: "生成中",
      failed: "失败",
      draft: "草稿",
    } as Record<string, string>
  )[String(input.artifactStatus || "")] || "未开始";
  return {
    canProceed,
    blockingReasons: blocking,
    attentionItems: input.attentionItems || [],
    statusLabel,
  };
}

export function buildScopeResearcherView(
  data: UnknownRecord,
  options: { artifactStatus?: string | null; fallbackQuestion?: string } = {},
): ResearcherStageView {
  const summary = buildScopeStageSummary(data, options.fallbackQuestion);
  const hasPremiseField = (key: "known_facts" | "user_assumptions" | "hypotheses_to_verify") => (
    Object.prototype.hasOwnProperty.call(data, key) && Array.isArray(data[key])
  );
  const premiseFieldsComplete = hasPremiseField("known_facts")
    && hasPremiseField("user_assumptions")
    && hasPremiseField("hypotheses_to_verify");
  const knownItems = statementRecords(data.known_facts).map((item) => researcherLanguage(item.statement || item)).filter(Boolean);
  const assumptionItems = statementRecords(data.user_assumptions).map((item) => researcherLanguage(item.statement || item)).filter(Boolean);
  const hypothesisItems = statementRecords(data.hypotheses_to_verify).map((item) => researcherLanguage(item.statement || item)).filter(Boolean);
  const blocking: string[] = [];
  if (!summary.question) blocking.push("尚未形成规范化研究问题");
  if (!summary.boundaries.length && !summary.exclusions.length) blocking.push("边界与排除项仍不完整");
  if (!premiseFieldsComplete) blocking.push("前提三分字段缺失，请重新生成研究范围");
  if (hasPremiseField("hypotheses_to_verify") && !hypothesisItems.length && data.task_disposition === "accepted") {
    blocking.push("尚未形成待验证假设");
  }
  const premiseSection = (
    id: "known" | "assumptions" | "hypotheses",
    key: "known_facts" | "user_assumptions" | "hypotheses_to_verify",
    label: string,
    items: string[],
    emptyBody: string,
  ) => ({
    id,
    label,
    body: hasPremiseField(key) ? `${items.length} 项` : "字段缺失",
    items,
    emptyBody: hasPremiseField(key) ? emptyBody : "旧产物未生成此字段，请重新生成研究范围",
  });
  return {
    stage: 1,
    title: summary.question || "研究范围",
    summary: [summary.coreObject, summary.judgmentAction].filter(Boolean).join(" · ") || "等待收敛研究问题",
    outputCount: summary.question ? 1 : 0,
    proceed: buildProceedState({ artifactStatus: options.artifactStatus, blockingReasons: blocking }),
    sections: [
      { id: "question", label: "规范化研究问题", body: summary.question || "尚未形成" },
      { id: "object", label: "研究对象", body: summary.coreObject || "尚未登记" },
      { id: "action", label: "要做的判断", body: summary.judgmentAction || "尚未登记" },
      {
        id: "time",
        label: "时间口径",
        body: summary.timeScope.map((item) => `${item.label}：${item.value}`).join("；") || "尚未登记",
        items: summary.timeScope.map((item) => `${item.label}：${item.value}`),
      },
      { id: "boundaries", label: "研究边界", body: `${summary.boundaries.length} 项`, items: summary.boundaries },
      { id: "exclusions", label: "不研究事项", body: `${summary.exclusions.length} 项`, items: summary.exclusions },
      premiseSection("known", "known_facts", "已知事实", knownItems, "本次没有用户明确给定或继承的已知前提"),
      premiseSection("assumptions", "user_assumptions", "用户假设", assumptionItems, "本次没有用户明确采用的未验证立场"),
      premiseSection("hypotheses", "hypotheses_to_verify", "待验证假设", hypothesisItems, "尚未形成待验证命题"),
      { id: "delivery", label: "交付落点", body: summary.reportType || researcherLanguage(data.delivery_depth?.minimum_delivery) || "尚未登记" },
    ],
    auditRefs: ["document_markdown", "input_resolution", "research_value_gate"],
  };
}

export function buildStructureResearcherView(
  data: UnknownRecord,
  options: { artifactStatus?: string | null } = {},
): ResearcherStageView {
  const units = buildStructureStageSummary(data).map((unit) => ({
    ...unit,
    priorityTier: researcherLanguage((records(data.judgment_units).find((item) => recordId(item) === unit.id) || {}).priority_tier),
    decisionRole: researcherLanguage((records(data.judgment_units).find((item) => recordId(item) === unit.id) || {}).decision_role),
    decisionWeight: (records(data.judgment_units).find((item) => recordId(item) === unit.id) || {}).decision_weight,
    candidateClaim: researcherLanguage((records(data.judgment_units).find((item) => recordId(item) === unit.id) || {}).candidate_claim),
  }));
  return {
    stage: 2,
    title: `${units.length} 个关键判断`,
    summary: units.map((unit) => unit.title).slice(0, 3).join("；") || "等待形成关键判断",
    outputCount: units.length,
    proceed: buildProceedState({
      artifactStatus: options.artifactStatus,
      blockingReasons: units.some((unit) => !unit.evidenceRequirements.length)
        ? ["部分关键判断尚未登记必要证据"]
        : [],
    }),
    sections: units.map((unit, index) => ({
      id: unit.id,
      label: `关键判断 ${index + 1}`,
      body: unit.question || unit.title,
      items: [
        unit.candidateClaim ? `候选主张：${unit.candidateClaim}` : "",
        unit.decisionRole ? `决策角色：${unit.decisionRole}` : "",
        typeof unit.decisionWeight === "number" ? `决策权重：${unit.decisionWeight}` : "",
        unit.priorityTier ? `优先级：${unit.priorityTier}` : "",
        ...unit.evidenceRequirements.map((item) => `必要证据：${item}`),
        ...unit.counterEvidence.map((item) => `反证：${item}`),
        ...unit.competingExplanations.map((item) => `竞争解释：${item}`),
      ].filter(Boolean),
    })),
    auditRefs: ["research_logic_markdown", "ontology_view_yaml", "method_applications"],
  };
}

export type EvidenceReadinessView = {
  judgmentReadyLabel: string;
  deliveryReadyLabel: string;
  factCount: number;
  gapCount: number;
  conflictCount: number;
  coverageConstraintCount: number;
  ontologyWarningCount: number;
  note: string;
};

export function buildEvidenceReadinessView(
  data: UnknownRecord,
  options: { coverageConstraintCount?: number; ontologyWarningCount?: number } = {},
): EvidenceReadinessView {
  const drafts = records(data.evidence_drafts);
  const facts = drafts.filter((item) => !["gap", "conflict"].includes(String(item.kind || "")));
  const gaps = drafts.filter((item) => String(item.kind) === "gap");
  const conflicts = drafts.filter((item) => String(item.kind) === "conflict");
  const evidenceReadiness = String(data.evidence_readiness?.status || data.evidence_readiness || "");
  const deliveryReadiness = String(data.delivery_readiness?.status || data.delivery_readiness || "");
  const coverageConstraintCount = Math.max(0, Number(options.coverageConstraintCount || 0));
  const ontologyWarningCount = Math.max(0, Number(options.ontologyWarningCount || 0));
  const downstreamConstraintCount = coverageConstraintCount + ontologyWarningCount;
  return {
    judgmentReadyLabel: downstreamConstraintCount
      ? `材料受限，${downstreamConstraintCount} 项待判断前核对`
      : evidenceReadiness
        ? researcherLanguage(evidenceReadiness)
        : (gaps.length || conflicts.length ? "可形成有边界的弱判断" : facts.length ? "具备判断材料" : "尚不足以下判断"),
    deliveryReadyLabel: downstreamConstraintCount
      ? "尚不能确认交付上限"
      : deliveryReadiness
        ? researcherLanguage(deliveryReadiness)
        : (facts.length ? "素材可支撑有边界报告" : "交付素材未就绪"),
    factCount: facts.length,
    gapCount: gaps.length,
    conflictCount: conflicts.length,
    coverageConstraintCount,
    ontologyWarningCount,
    note: downstreamConstraintCount
      ? "事实已经登记，但最低证据组合或口径仍有限制；判断阶段会据此限制强度或要求返回补证。"
      : "证据数量不等于判断强度；结论强度仍受最薄弱环节与本体约束限制。",
  };
}

export type FormalDeliveryGate = {
  ready: boolean;
  label: string;
  summary: string;
  blockingReasons: string[];
};

export function buildFormalDeliveryGate(options: {
  artifactApproved: boolean;
  pendingCount: number;
  allStagesApproved: boolean;
  /**
   * 五个阶段是否全部达到高质量通过（high_quality_pass）。
   * 缺省为 undefined，表示调用方未提供该信息——此时不额外阻断，保持旧行为。
   * 传入 false 时，将作为正式交付阻塞项（与 exportFormalPack 的真实导出规则对齐）。
   */
  allStagesHighQualityPass?: boolean;
}): FormalDeliveryGate {
  const blockingReasons = [
    !options.artifactApproved ? "05 尚未通过交付一致性检查" : "",
    options.pendingCount > 0 ? `仍有 ${options.pendingCount} 项待办` : "",
    !options.allStagesApproved ? "五个研究阶段尚未全部确认" : "",
    options.allStagesHighQualityPass === false
      ? "存在阶段未达到高质量通过（high_quality_pass），不满足正式交付门槛"
      : "",
  ].filter(Boolean);
  return {
    ready: blockingReasons.length === 0,
    label: blockingReasons.length ? "尚未达到正式发布条件" : "可导出正式发布包",
    summary: blockingReasons.length
      ? blockingReasons.join("；")
      : "05 已忠实表达 04，五个研究阶段均达高质量通过且待办清单已清空，可直接导出正式发布包。",
    blockingReasons,
  };
}

export function buildJudgmentResearcherView(
  data: UnknownRecord,
  evidenceDrafts: unknown,
  options: { artifactStatus?: string | null; pendingCount?: number } = {},
): ResearcherStageView {
  const judgments = buildJudgmentStageSummary(data, evidenceDrafts);
  return {
    stage: 4,
    title: `${judgments.length} 项研究判断`,
    summary: judgments[0]?.conclusion || "尚未形成研究判断",
    outputCount: judgments.length,
    proceed: buildProceedState({
      artifactStatus: options.artifactStatus,
      pendingCount: options.pendingCount,
    }),
    sections: judgments.map((judgment, index) => ({
      id: judgment.id,
      label: `判断 ${index + 1}`,
      body: `${judgment.conclusion}（${judgment.strengthLabel} · ${judgment.statusLabel}）`,
      items: [
        judgment.rationale ? `依据说明：${judgment.rationale}` : "",
        ...judgment.evidence.map((item) => `关键依据：${item}`),
        ...judgment.competingExplanations.map((item) => `竞争解释：${item}`),
        ...judgment.uncertainties.map((item) => `不确定性：${item}`),
        ...judgment.invalidationConditions.map((item) => `改判条件：${item}`),
        ...judgment.trackingSignals.map((item) => `跟踪信号：${item}`),
      ].filter(Boolean),
    })),
    auditRefs: ["judgment_brief_markdown", "reasoning_audit_yaml", "claims", "rule_evaluations"],
  };
}

export function buildDeliveryResearcherView(
  data: UnknownRecord,
  options: {
    artifactStatus?: string | null;
    pendingCount?: number;
    stagesApproved?: boolean;
  } = {},
): ResearcherStageView {
  const claims = records(data.report_claims);
  const blocking: string[] = [];
  if (options.artifactStatus !== "approved") blocking.push("05 尚未通过交付一致性检查");
  if (options.pendingCount) blocking.push(`仍有 ${options.pendingCount} 项待办`);
  if (!options.stagesApproved) blocking.push("五个研究阶段尚未全部确认");
  return {
    stage: 5,
    title: researcherLanguage(data.title) || "研究判断报告",
    summary: displayStrings(data.executive_points).slice(0, 2).join("；") || "面向读者的研究稿",
    outputCount: claims.length || (String(data.document_markdown || "").trim() ? 1 : 0),
    proceed: buildProceedState({
      artifactStatus: options.artifactStatus,
      pendingCount: options.pendingCount,
      blockingReasons: blocking.filter((item) => !item.includes("待办") || !options.pendingCount),
    }),
    sections: [
      {
        id: "executive",
        label: "核心要点",
        body: `${displayStrings(data.executive_points).length} 条`,
        items: displayStrings(data.executive_points),
      },
      {
        id: "limitations",
        label: "限制与边界",
        body: `${displayStrings(data.limitations).length} 条`,
        items: displayStrings(data.limitations),
      },
      {
        id: "claims",
        label: "报告主张",
        body: `${claims.length} 条`,
        items: claims.map((item) => researcherLanguage(item.statement)),
      },
    ],
    auditRefs: ["expression_audit_yaml", "research_value_review"],
  };
}
