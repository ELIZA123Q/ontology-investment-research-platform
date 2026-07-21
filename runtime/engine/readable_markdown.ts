/** 由结构化 JSON 重写研究员可读稿（Markdown）。 */

import {
  formatCandidateBullet,
  normalizeCompetingExplanations,
  normalizeCounterEvidenceDirections,
} from "./structure_candidates";

function bullets(values: unknown[], empty = "- 无"): string[] {
  return values.length ? values.map((value) => `- ${String(value)}`) : [empty];
}

export function syncStage01ReadableMarkdown(data: any, question: string): string {
  delete data.report_type;
  data.document_markdown = [
    "# 研究任务定义",
    "",
    "## 原始问题",
    "",
    question,
    "",
    "## 改写后的研究问题",
    "",
    String(data.normalized_question || ""),
    "",
    "## 判断范围",
    "",
    `- 核心对象：${String(data.core_object || "")}`,
    `- 判断动作：${String(data.judgment_action || "")}`,
    `- 回看期：${String(data.time_scope?.lookback || "")}`,
    `- 截止时点：${String(data.time_scope?.as_of || "")}`,
    `- 前瞻期：${String(data.time_scope?.forward || "")}`,
    `- 正式领域覆盖：${data.domain_supported ? "是" : "否"}`,
    "",
    "## 边界",
    "",
    ...bullets(data.boundaries || []),
    "",
    "## 排除项",
    "",
    ...bullets(data.exclusions || []),
    "",
    "## 阶段边界",
    "",
    "本阶段只冻结问题、时间与范围，不登记事实，不形成方向判断。任何观察、原因或结论都必须在后续阶段由可定位公开来源和事实级证据支持。",
  ].join("\n");
  return data.document_markdown;
}

export function syncStage02ReadableMarkdown(data: any): string {
  const units = data.judgment_units || [];
  const unitIds = units.map((unit: any) => String(unit.id || "")).filter(Boolean);
  const counters = normalizeCounterEvidenceDirections(data.counter_evidence_directions, { unitIds });
  const competing = normalizeCompetingExplanations(data.competing_explanations, { unitIds });
  data.document_markdown = [
    "# 研究结构",
    "",
    `研究范围：${String(data.research_scope?.label || data.research_scope?.id || "未命名")}`,
    "",
    "## 原子判断单元",
    "",
    ...(units.length
      ? units.map((unit: any) => {
        const requirements = unit.evidence_requirements || unit.evidence_requirement_refs || [];
        return `- ${unit.id || "判断单元"} · ${unit.title || "未命名"}：${unit.question || unit.statement || ""}；必要证据：${Array.isArray(requirements) && requirements.length ? requirements.join("、") : "未登记"}`;
      })
      : ["- 尚未登记判断单元"]),
    "",
    "## 必须主动寻找的反向证据",
    "",
    ...bullets(counters.map((item) => formatCandidateBullet(item)), "- 尚未登记；确认前必须补齐。"),
    "",
    "## 竞争解释",
    "",
    ...bullets(competing.map((item) => formatCandidateBullet(item)), "- 尚未登记；确认前必须补齐。"),
    "",
    "本阶段只登记判断结构与候选方法，不宣称任何方法已经执行，也不新增事实。",
  ].join("\n");
  return data.document_markdown;
}

export function syncStage03ReadableMarkdown(data: any): string {
  const drafts = data.evidence_drafts || [];
  const gaps = data.unresolved_gaps || [];
  const directionLabel = (direction: string) =>
    ({ support: "支持", weaken: "削弱", neutral: "中性" } as Record<string, string>)[direction] || direction || "未标注";
  const kindLabel = (kind: string) =>
    ({ fact_draft: "事实草稿", counter: "反证", gap: "缺口", conflict: "冲突" } as Record<string, string>)[kind] || kind || "条目";
  data.document_markdown = [
    "# 证据准备",
    "",
    `本阶段共有 ${drafts.length} 条证据条目、${(data.sources || []).length} 份来源登记。`,
    "",
    "## 证据条目",
    "",
    ...(drafts.length
      ? drafts.map((item: any) => {
        const units = item.judgment_unit_ids || item.target_judgment_unit_refs || [];
        return `- ${item.id || "EV"} · ${kindLabel(String(item.kind || ""))} · ${directionLabel(String(item.direction || ""))} → ${(units.length ? units : ["未挂判断"]).join("、")}：${item.statement || ""}`;
      })
      : ["- 尚未登记证据条目"]),
    "",
    ...(gaps.length ? ["## 未解决边界", "", ...gaps.map((gap: any) => `- ${gap}`), ""] : []),
    "本阶段登记事实与缺口，不形成方向裁决。",
  ].join("\n");
  return data.document_markdown;
}

export function syncStage04ReadableMarkdown(data: any): string {
  const judgments = data.judgments || [];
  data.document_markdown = [
    "# 判断结果",
    "",
    ...(judgments.length
      ? judgments.map((judgment: any) => {
        const support = judgment.supporting_evidence_draft_ids || [];
        return `- ${judgment.title || judgment.id || "判断"}：${judgment.conclusion || judgment.statement || ""}（${judgment.strength || judgment.level || "J0"}；证据 ${support.length ? support.join("、") : "无"}）`;
      })
      : ["- 尚未形成判断"]),
    "",
    "## 总体边界",
    "",
    String(data.overall_boundary || "未登记额外边界。"),
  ].join("\n");
  return data.document_markdown;
}

export function syncStage05ReadableMarkdown(
  data: any,
  question: string,
  sources: Array<{ id: string; title: string; url: string }> = [],
): string {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const claims = data.report_claims || [];
  const claimMarkdown = claims.length
    ? claims.map((claim: any) => [
      `### ${claim.statement || claim.id}`,
      "",
      `- 判断：${(claim.judgment_ids || []).join("、") || "未挂接"}`,
      `- 证据：${(claim.evidence_draft_ids || []).join("、") || "无"}`,
      `- 来源：${(claim.source_ids || []).map((id: string) => sourceById.get(id)?.title || id).join("、") || "无"}`,
    ].join("\n")).join("\n\n")
    : "- 当前没有可交付的已确认判断。";
  const usedSourceIds = new Set<string>(claims.flatMap((claim: any) => claim.source_ids || []).map(String));
  const usedSources = [...usedSourceIds].map((id) => sourceById.get(id)).filter(Boolean) as Array<{ title: string; url: string }>;
  data.document_markdown = [
    `# ${data.title || "研究判断简报"}`,
    "",
    "## 研究问题",
    "",
    question,
    "",
    "## 结论先行",
    "",
    ...bullets(data.executive_points || [], "- 当前没有可交付的已确认判断。"),
    "",
    "## 判断依据与改判条件",
    "",
    claimMarkdown,
    "",
    "## 整体适用边界",
    "",
    ...bullets(data.limitations || [], "- 无额外边界记录"),
    ...(usedSources.length ? ["", "## 主要资料来源", "", ...usedSources.map((source) => `- [${source.title}](${source.url})`)] : []),
  ].join("\n");
  return data.document_markdown;
}
