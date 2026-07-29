/**
 * ONTO-UX-001：本轮本体生效摘要（研究员语言，无内部审计 ID）。
 */
import type { OntologyResearchEffect, OntologyResearchValueSummary } from "./ontology_research_value";
import type { Stage03PrecheckSummary } from "./ontology_stage03_precheck";
import { stripInternalReferencePrefix } from "./research_overview";

export type OntologyContributionLine = {
  kind: "completion" | "constraint" | "connection" | "precheck";
  title: string;
  detail: string;
};

export type OntologyContributionSummary = {
  lines: OntologyContributionLine[];
  formal_variable_count: number;
  task_local_count: number;
  constraining_rule_count: number;
  precheck_warning_count: number;
  headline: string;
};

const KIND_LABEL = {
  completion: "补全",
  constraint: "限制",
  connection: "关联",
  precheck: "预警",
} as const;

function sanitize(text: string): string {
  return stripInternalReferencePrefix(text)
    .replace(/\bRE-SYS-[A-Za-z0-9._-]+\b/g, "")
    .replace(/\b(?:JU|EV|ER|GAP|CE|CD|SRC|MA)-[A-Za-z0-9._-]+\b/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function strengthLabel(strength: string): string {
  const value = String(strength || "").trim();
  if (!value || value === "J0") return "暂不判断";
  if (value === "J1") return "观察级";
  if (value === "J2") return "有限判断";
  if (value === "J3") return "较强判断";
  if (value === "J4") return "高强度判断";
  return value;
}

/**
 * 从 Goal5 本体贡献 + Stage03 预检 + 判断强度，投影概览/判断页摘要。
 */
export function buildOntologyContributionSummary(input: {
  researchValue?: OntologyResearchValueSummary | null;
  precheck?: Stage03PrecheckSummary | null;
  judgments?: Array<{ strength?: string; level?: string; decision_status?: string; not_judgeable_reason?: string }>;
  limit?: number;
}): OntologyContributionSummary {
  const limit = input.limit ?? 4;
  const effects = input.researchValue?.effects || [];
  const formal_variable_count = effects.filter((item) => item.kind === "completion" && item.id.startsWith("completion:binding:")).length;
  const task_local_count = effects.filter((item) => item.kind === "constraint" && item.id.includes("task-local")).length;
  const constraining = effects.filter((item) =>
    item.kind === "constraint"
    && (item.result.includes("阻止") || item.title.includes("未通过") || item.title.includes("阻断")));
  const precheck_warning_count = input.precheck?.findings.length || 0;

  const lines: OntologyContributionLine[] = [];

  for (const effect of prioritizeEffects(effects)) {
    if (lines.length >= limit) break;
    lines.push({
      kind: effect.kind,
      title: sanitize(effect.title),
      detail: sanitize(effect.result || effect.explanation),
    });
  }

  for (const finding of input.precheck?.findings || []) {
    if (lines.length >= limit) break;
    lines.push({
      kind: "precheck",
      title: sanitize(finding.message),
      detail: sanitize(finding.researcher_hint),
    });
  }

  const judgments = input.judgments || [];
  const allJ0 = judgments.length > 0 && judgments.every((item) => String(item.strength || item.level || "J0") === "J0");
  const demotedReason = judgments.find((item) => String(item.not_judgeable_reason || "").trim())?.not_judgeable_reason;
  let headline = "本轮尚未形成可展示的本体约束生效记录";
  if (allJ0 && demotedReason) {
    headline = `因语义/证据约束停在${strengthLabel("J0")}：${sanitize(String(demotedReason)).slice(0, 80)}`;
  } else if (constraining.length) {
    headline = `有 ${constraining.length} 条正式规则限制了结论强度或口径`;
  } else if (formal_variable_count || task_local_count) {
    headline = `已对齐 ${formal_variable_count} 个正式变量` + (task_local_count ? `，保留 ${task_local_count} 个本轮候选` : "");
  } else if (precheck_warning_count) {
    headline = `证据阶段有 ${precheck_warning_count} 项本体口径预警（判断确认时仍会挡门）`;
  }

  return {
    lines,
    formal_variable_count,
    task_local_count,
    constraining_rule_count: constraining.length,
    precheck_warning_count,
    headline: sanitize(headline),
  };
}

function prioritizeEffects(effects: OntologyResearchEffect[]): OntologyResearchEffect[] {
  const rank = (item: OntologyResearchEffect) => {
    if (item.kind === "constraint" && (item.result.includes("阻止") || /未通过|阻断/.test(item.title))) return 3;
    if (item.kind === "constraint") return 2;
    if (item.kind === "completion") return 1;
    return 0;
  };
  return [...effects].sort((a, b) => rank(b) - rank(a) || a.id.localeCompare(b.id));
}

export function ontologyContributionKindLabel(kind: OntologyContributionLine["kind"]): string {
  return KIND_LABEL[kind];
}
