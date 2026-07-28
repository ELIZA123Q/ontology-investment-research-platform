import { stripInternalReferencePrefix } from "@/engine/research_overview";

type UnknownRecord = Record<string, any>;

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
    .replace(/本次证据收集阶段面临本次自动检索/g, "本次证据收集受自动检索")
    .replace(/标记为缺口[（(]证据缺口[）)]/g, "登记为尚缺的证据")
    .replace(/证据缺口/g, "尚缺的证据")
    .replace(/\bStage[\s_-]*0?([1-5])\b/gi, (_, stage) => (
      { "1": "范围阶段", "2": "结构阶段", "3": "证据阶段", "4": "判断阶段", "5": "交付阶段" } as Record<string, string>
    )[stage] || `第${stage}阶段`)
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
