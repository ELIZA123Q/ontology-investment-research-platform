/** 由结构化 JSON 重写研究员可读稿（Markdown）。 */

import {
  formatCandidateBullet,
  normalizeCompetingExplanations,
  normalizeCounterEvidenceDirections,
} from "./structure_candidates";
import { STAGE01_QUALITY_GATE_REF } from "./stage01_contract";
import { ensureStage02DocumentFields, STAGE02_QUALITY_GATE_REF } from "./stage02_documents";
import { ensureStage03DocumentFields, STAGE03_QUALITY_GATE_REF } from "./stage03_documents";
import { ensureStage04DocumentFields, STAGE04_QUALITY_GATE_REF } from "./stage04_documents";
import { ensureStage05DocumentFields } from "./stage05_documents";
import {
  buildStage05SkeletonMarkdown,
  shouldPreserveStage05Markdown,
  stripInlineAuditDetails,
} from "./stage05_quality";

function bullets(values: unknown[], empty = "- 无"): string[] {
  return values.length ? values.map((value) => `- ${String(value)}`) : [empty];
}

function countProseLines(text: string, minLen = 24): number {
  return text.split("\n").filter((line) => {
    const trimmed = line.trim();
    return trimmed.length >= minLen
      && !trimmed.startsWith("#")
      && !trimmed.startsWith("-")
      && !trimmed.startsWith("*")
      && !trimmed.startsWith(">")
      && !trimmed.startsWith("---")
      && !trimmed.startsWith("`")
      && !trimmed.startsWith("|");
  }).length;
}

/** 模型写的 03 长文应保留；仅库存清单模板不够格时才重建。 */
export function shouldPreserveStage03Markdown(body: string): boolean {
  const text = String(body || "").trim();
  if (text.length < 800) return false;
  const looksLikeInventory = /##\s*1\.\s*范围交接/.test(text) && /##\s*6\.\s*交给\s*04/.test(text);
  if (looksLikeInventory) return countProseLines(text) >= 5;
  return /证据|来源|缺口|覆盖|上限|取证|MCP|留痕/.test(text) && countProseLines(text) >= 2;
}

/** 模型写的 04 判断长文应保留；仅简报骨架不够格时才重建。 */
export function shouldPreserveStage04Markdown(body: string): boolean {
  const text = String(body || "").trim();
  if (text.length < 800) return false;
  const looksLikeBriefSkeleton = /##\s*1\.\s*一句话结论/.test(text) && /##\s*7\.\s*允许\s*05/.test(text);
  if (looksLikeBriefSkeleton) return countProseLines(text) >= 5;
  return /判断|路径|竞争解释|改判|证伪|对象分化/.test(text) && countProseLines(text) >= 2;
}

/** 模型写的 02 研究逻辑应保留；仅同步模板不够格时才重建。 */
export function shouldPreserveStage02Markdown(body: string): boolean {
  const text = String(body || "").trim();
  if (text.length < 800) return false;
  const looksLikeSyncTemplate = /##\s*1\.\s*核心待验证命题/.test(text)
    && /##\s*6\.\s*停止条件/.test(text)
    && /##\s*7\.\s*双产物交接/.test(text);
  if (looksLikeSyncTemplate) return countProseLines(text) >= 5;
  return /判断|框架|停止条件|竞争解释|反证/.test(text) && countProseLines(text) >= 2;
}

function yamlFrontmatter(fields: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    if (value == null) {
      lines.push(`${key}: null`);
    } else if (typeof value === "boolean" || typeof value === "number") {
      lines.push(`${key}: ${value}`);
    } else if (typeof value === "string") {
      const escaped = value.includes("\n") || value.includes(":") || value.includes("#")
        ? JSON.stringify(value)
        : value;
      lines.push(`${key}: ${escaped}`);
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  lines.push("---", "");
  return lines.join("\n");
}

export function syncStage01ReadableMarkdown(data: any, question: string): string {
  delete data.report_type;
  const resolution = data.input_resolution || {};
  const clarifications = Array.isArray(resolution.clarifications) ? resolution.clarifications : [];
  const clarificationRows = clarifications.length
    ? clarifications.map((item: any) => (
      `| ${item.question_id || ""} | ${item.topic || ""} | ${item.question || ""} | ${item.answer || "（待答）"} |`
    ))
    : ["| — | — | 无澄清记录 | — |"];
  data.document_markdown = [
    yamlFrontmatter({
      document_type: "judgment_task",
      stage_status: data.stage_status || "in_progress",
      task_disposition: data.task_disposition || "needs_clarification",
      quality_status: data.quality_status || "draft",
      quality_gate_ref: data.quality_gate_ref || STAGE01_QUALITY_GATE_REF,
      status_reason: data.status_reason || "",
    }),
    "# 投研需求说明",
    "",
    "## 1. 原始输入与解析",
    "",
    String(data.original_input || question),
    "",
    `- 解析模式：\`${resolution.mode || "direct_extract"}\``,
    `- 解析状态：\`${resolution.status || "pending"}\``,
    `- 处置：\`${data.task_disposition || "needs_clarification"}\` — ${data.status_reason || ""}`,
    "",
    "### 系统理解",
    "",
    `- 核心对象：${resolution.system_understanding?.core_object || data.core_object || ""}`,
    `- 判断动作：${resolution.system_understanding?.judgment_action || data.judgment_action || ""}`,
    `- 时间窗口：${resolution.system_understanding?.time_window || ""}`,
    `- 范围边界：${resolution.system_understanding?.scope_boundary || ""}`,
    `- 交付落点：${resolution.system_understanding?.delivery_landing || ""}`,
    "",
    "### 澄清记录",
    "",
    "| 编号 | 主题 | 问题 | 回答 |",
    "|---|---|---|---|",
    ...clarificationRows,
    "",
    "## 2. 规范化问题",
    "",
    String(data.normalized_question || ""),
    "",
    "## 3. 核心研究主线",
    "",
    `| 要素 | 内容 |`,
    `|---|---|`,
    `| 主对象 | ${data.main_judgment_axis?.object || data.core_object || ""} |`,
    `| 比较范围 | ${data.main_judgment_axis?.comparison_scope || ""} |`,
    `| 判断动作 | ${data.main_judgment_axis?.judgment_action || data.judgment_action || ""} |`,
    `| 主要通道 | ${data.main_judgment_axis?.primary_channel || ""} |`,
    `| 关键问题 | ${data.main_judgment_axis?.key_question || ""} |`,
    `| 05 落点 | ${data.main_judgment_axis?.expected_05_landing || ""} |`,
    "",
    "## 4. 时间口径",
    "",
    `- 回看期：${data.time_scope?.lookback || ""}`,
    `- 当前时点：${data.time_scope?.as_of || ""}`,
    `- 前瞻期：${data.time_scope?.forward || ""}`,
    "",
    "## 5. 研究范围与排除",
    "",
    "### 边界",
    "",
    ...bullets(data.boundaries || []),
    "",
    "### 排除项",
    "",
    ...bullets(data.exclusions || []),
    "",
    `范围过宽检查：\`${data.overscope_check?.status || "pending"}\` — ${data.overscope_check?.reason || ""}`,
    "",
    "## 6. 研究价值与交付深度",
    "",
    `- 价值门禁：\`${data.research_value_gate?.status || "pending"}\` / ${data.research_value_gate?.value_level || ""}`,
    `- 分歧或未知：${data.research_value_gate?.disagreement_or_unknown || ""}`,
    `- 变化变量：${data.research_value_gate?.changing_variable || ""}`,
    `- 结论粒度：${data.delivery_depth?.conclusion_granularity || ""}`,
    `- 最低交付：${data.delivery_depth?.minimum_delivery || ""}`,
    "",
    "## 7. 阶段边界",
    "",
    "本阶段只冻结问题、时间与范围，不登记事实，不形成方向判断。任何观察、原因或结论都必须在后续阶段由可定位公开来源和事实级证据支持。",
  ].join("\n");
  return data.document_markdown;
}

export function syncStage02ReadableMarkdown(data: any): string {
  ensureStage02DocumentFields(data);
  const existing = String(data.research_logic_markdown || data.document_markdown || "").trim();
  if (shouldPreserveStage02Markdown(existing)) {
    data.research_logic_markdown = existing;
    data.document_markdown = existing;
    ensureStage02DocumentFields(data);
    return data.document_markdown;
  }
  const units = data.judgment_units || [];
  const unitIds = units.map((unit: any) => String(unit.id || "")).filter(Boolean);
  const counters = normalizeCounterEvidenceDirections(data.counter_evidence_directions, { unitIds });
  const competing = normalizeCompetingExplanations(data.competing_explanations, { unitIds });
  const ers = Array.isArray(data.evidence_requirements) ? data.evidence_requirements : [];
  const logic = [
    yamlFrontmatter({
      document_type: "research_logic",
      logic_id: data.logic_id,
      ontology_view_ref: data.ontology_view_ref,
      stage_status: data.stage_status,
      quality_status: data.quality_status,
      quality_gate_ref: data.quality_gate_ref || STAGE02_QUALITY_GATE_REF,
      ontology_gap_scan_status: data.ontology_gap_scan_status,
      can_enter_03: Boolean(data.can_enter_03),
      judgment_spine: data.judgment_spine,
      framework_usage_ref: data.framework_usage_ref,
    }),
    "# 研究逻辑",
    "",
    "## 1. 核心待验证命题",
    "",
    `> ${String(data.judgment_spine || "")}`,
    "",
    `研究范围：${String(data.research_scope?.label || data.research_scope?.id || "未命名")}`,
    "",
    "## 2. 框架选用与裁剪理由",
    "",
    `本阶段按 judgment_type 路由选用/裁剪框架；framework_usage_ref=\`${String(data.framework_usage_ref || "")}\`。`,
    "仅保留改变输出门槛、前置、主路径/反证或停止条件的最小充分组合，禁止按热点词机械匹配。",
    units.length >= 3
      ? "多单元时优先保证 critical/关键 单元决定总判断，supporting 不与之同等优先。"
      : "判断单元保持最小可判断结构，避免无关扩展。",
    "",
    "## 3. 原子判断单元",
    "",
    ...(units.length
      ? units.map((unit: any) => {
        const requirements = unit.evidence_requirements || unit.evidence_requirement_refs || [];
        return `- ${unit.id || "判断单元"} · ${unit.title || "未命名"}：${unit.question || unit.statement || ""}；必要证据：${Array.isArray(requirements) && requirements.length ? requirements.join("、") : "未登记"}`;
      })
      : ["- 尚未登记判断单元"]),
    "",
    "## 4. 必须主动寻找的反向证据",
    "",
    ...bullets(counters.map((item) => formatCandidateBullet(item)), "- 尚未登记；确认前必须补齐。"),
    "",
    "## 5. 竞争解释",
    "",
    ...bullets(competing.map((item) => formatCandidateBullet(item)), "- 尚未登记；确认前必须补齐。"),
    "",
    "## 6. 停止条件",
    "",
    "停止条件是核心判断达到最低验证条件（主证/反证/可区分竞争解释齐备）；禁止把停止条件写成继续堆材料。",
    "不得以「继续收集更多资料」或「材料足够多」作为停止条件。",
    ...(ers.length
      ? ers.slice(0, 8).map((item: any) =>
        `- ${item.id || "ER"}（${item.evidence_role || "role"}）：${item.requirement || ""}；最低独立来源 ${item.minimum_independent_sources ?? "未填"}`)
      : ["- 证据要求尚未登记；确认前必须补齐最低验证条件。"]),
    "",
    "## 7. 双产物交接",
    "",
    `- 配对本体视图：\`${String(data.ontology_view_ref || "")}\``,
    `- 缺口扫描：\`${String(data.ontology_gap_scan_status || "")}\``,
    `- 可否进入 03：${data.can_enter_03 ? "是" : "否"}`,
    "",
    "本阶段只登记判断结构与候选方法，不宣称任何方法已经执行，也不新增事实。正式 ID、路径与证据需求以配对本体视图 YAML 为准。",
  ].join("\n");
  data.research_logic_markdown = logic;
  data.document_markdown = logic;
  return data.document_markdown;
}

export function syncStage03ReadableMarkdown(
  data: any,
  options: { question?: string; taskId?: string; structure?: any } = {},
): string {
  ensureStage03DocumentFields(data, options);
  const existing = String(data.preparation_markdown || data.document_markdown || "").trim();
  if (shouldPreserveStage03Markdown(existing)) {
    data.preparation_markdown = existing;
    data.document_markdown = existing;
    ensureStage03DocumentFields(data, options);
    return data.document_markdown;
  }
  const drafts = data.evidence_drafts || [];
  const sources = data.sources || [];
  const gaps = data.unresolved_gaps || [];
  const facts = drafts.filter((item: any) => String(item?.kind) !== "gap");
  const gapDrafts = drafts.filter((item: any) => String(item?.kind) === "gap");
  const directionLabel = (direction: string) =>
    ({ support: "支持", weaken: "削弱", neutral: "中性", unknown: "未知" } as Record<string, string>)[direction] || direction || "未标注";
  const kindLabel = (kind: string) =>
    ({ fact_draft: "事实草稿", source_claim: "来源主张", counter: "反证", gap: "缺口", conflict: "冲突" } as Record<string, string>)[kind] || kind || "条目";
  const prep = [
    yamlFrontmatter({
      document_type: "evidence_preparation",
      stage_status: data.stage_status,
      quality_status: data.quality_status,
      quality_gate_ref: data.quality_gate_ref || STAGE03_QUALITY_GATE_REF,
      evidence_readiness: data.evidence_readiness,
      delivery_readiness: data.delivery_readiness,
      allowed_05_output: data.allowed_05_output,
      confidence_ceiling: data.confidence_ceiling,
      evidence_coverage_rate: data.evidence_coverage_rate,
      snapshot_ref: data.snapshot_ref,
      instance_manifest_ref: "03-语义域与证据域实例清单.yaml",
    }),
    "# 数据与证据准备",
    "",
    "## 1. 范围交接",
    "",
    String(options.question || "继承 Stage02 已确认判断单元与证据要求；本阶段只登记可核验事实与缺口，不形成方向裁决。"),
    "",
    "## 2. 证据需求覆盖",
    "",
    `- 覆盖单元：${data.evidence_backed_unit_count}/${data.coverage_unit_total}（要求 ≥ ${(Number(data.required_coverage_rate || 0) * 100).toFixed(0)}%）`,
    `- 关键节点门禁：\`${data.critical_node_gate_status}\``,
    `- 判断单元门禁：\`${data.judgment_unit_gate_status}\``,
    `- 检索状态：\`${data.search_status}\``,
    "",
    "## 3. 来源计划与入库",
    "",
    `本阶段登记 ${sources.length} 份来源、${facts.length} 条非缺口证据、${gapDrafts.length} 条缺口草稿。`,
    "",
    ...(sources.length
      ? sources.map((source: any) => `- ${source.source_key || source.source_id || "SRC"} · ${source.title || "未命名"}（${source.source_tier || "S?"}）：${source.url || ""}`)
      : ["- 尚无可用来源；仅允许显式 gap。"]),
    "",
    "## 4. 证据处理结果",
    "",
    ...(drafts.length
      ? drafts.map((item: any) => {
        const units = item.judgment_unit_ids || [];
        return `- ${item.id || "EV"} · ${kindLabel(String(item.kind || ""))} · ${directionLabel(String(item.direction || ""))} → ${(units.length ? units : ["未挂判断"]).join("、")}：${item.statement || item.requirement || ""}`;
      })
      : ["- 尚未登记证据条目"]),
    "",
    "## 5. 覆盖、缺口与双就绪",
    "",
    ...(gaps.length ? gaps.map((gap: any) => `- 未解决：${gap}`) : ["- 未解决缺口清单为空。"]),
    "",
    `- 证据就绪：\`${data.evidence_readiness}\``,
    `- 交付就绪：\`${data.delivery_readiness}\`（与证据就绪独立评估）`,
    `- 允许 05 输出：\`${data.allowed_05_output}\``,
    `- 置信度上限：\`${data.confidence_ceiling}\``,
    `- 交付素材候选：图表 ${data.delivery_materials?.chart_candidates?.length || 0} / 表格 ${data.delivery_materials?.table_candidates?.length || 0} / 来源注释 ${data.delivery_materials?.source_annotation_candidates?.length || 0}`,
    "",
    "## 6. 交给 04 的上限",
    "",
    "本阶段不预写研究报告，不抬升判断强度。04 只能基于本包事实草稿、缺口与方法应用状态裁决；配对实例清单见 `instance_manifest_yaml`。交付素材候选供 05 引用，不得当作已确认判断。",
  ].join("\n");
  data.preparation_markdown = prep;
  data.document_markdown = prep;
  ensureStage03DocumentFields(data, options);
  return data.document_markdown;
}

export function syncStage04ReadableMarkdown(
  data: any,
  options: { question?: string; taskId?: string } = {},
): string {
  ensureStage04DocumentFields(data, options);
  const existing = String(data.judgment_brief_markdown || data.document_markdown || "").trim();
  if (shouldPreserveStage04Markdown(existing)) {
    data.judgment_brief_markdown = existing;
    data.document_markdown = existing;
    ensureStage04DocumentFields(data, options);
    return data.document_markdown;
  }
  const judgments = data.judgments || [];
  const competing = data.competing_explanations || [];
  const primary = judgments[0];
  const brief = [
    yamlFrontmatter({
      document_type: "judgment_brief",
      stage_status: data.stage_status,
      quality_status: data.quality_status,
      quality_gate_ref: data.quality_gate_ref || STAGE04_QUALITY_GATE_REF,
      judgment_level: data.judgment_level,
      confidence: data.confidence,
      primary_claim_id: data.primary_claim_id,
      audit_ref: data.audit_ref,
      brief_ref: data.brief_ref,
      brief_quality_check_result: data.brief_quality_check_result,
      judgment_as_of: data.judgment_as_of,
    }),
    "# 判断简报",
    "",
    "## 1. 一句话结论",
    "",
    primary
      ? `> ${primary.conclusion || "暂不可判断"}（${primary.strength || data.judgment_level}/${primary.decision_status || "draft"}）`
      : "> 尚未形成主判断。",
    "",
    "## 2. 判断单元结果",
    "",
    ...(judgments.length
      ? judgments.map((judgment: any) => {
        const support = judgment.supporting_evidence_draft_ids || [];
        return `- ${judgment.id || "J"} · ${judgment.title || judgment.judgment_unit_id || "判断"}：${judgment.conclusion || ""}（${judgment.strength || "J0"}；证据 ${support.length ? support.join("、") : "无"}）`;
      })
      : ["- 尚未形成判断"]),
    "",
    "## 3. 对象分化与主路径裁决",
    "",
    String(data.object_differentiation || "尚未登记对象分化。"),
    "",
    String(data.primary_path_ruling || "尚未登记主路径裁决。"),
    "",
    "## 4. 竞争解释",
    "",
    ...(competing.length
      ? competing.map((item: any) => `- ${item.id || "CE"} · ${item.status || "active"}：${item.statement || ""}`)
      : ["- 未登记竞争解释。"]),
    "",
    "## 5. 投资命题与改判信号",
    "",
    String(data.investment_proposition || "尚未登记投资命题。"),
    "",
    ...bullets(
      judgments.flatMap((judgment: any) => (judgment.invalidation_conditions || []).map((text: string) => `${judgment.id}: ${text}`)),
      "- 未登记改判条件。",
    ),
    "",
    "## 6. 不确定性与边界",
    "",
    String(data.overall_boundary || "未登记额外边界。"),
    "",
    ...bullets(
      judgments.flatMap((judgment: any) => (judgment.uncertainties || []).map((text: string) => `${judgment.id}: ${text}`)),
      "- 未登记额外不确定性。",
    ),
    "",
    "## 7. 允许 05 表达什么",
    "",
    `- 主主张：\`${data.primary_claim_id}\` / 强度上限 \`${data.expression_permission?.max_expression_level || data.judgment_level}\``,
    `- 可表达主张：${(data.expression_permission?.allowed_core_claims || []).join("、") || "无"}`,
    `- 受限主张：${(data.expression_permission?.restricted_claims || []).join("、") || "无"}`,
    `- 置信度：\`${data.confidence}\``,
    `- ${data.expression_permission?.notes || "不得抬高强度，不得新增事实；配对审计见 reasoning_audit_yaml。"}`,
  ].join("\n");
  data.judgment_brief_markdown = brief;
  data.document_markdown = brief;
  ensureStage04DocumentFields(data, options);
  return data.document_markdown;
}

export function syncStage05ReadableMarkdown(
  data: any,
  question: string,
  sources: Array<{ id: string; title: string; url: string }> = [],
  options: { taskId?: string; stage04?: any; forceSkeleton?: boolean } = {},
): string {
  ensureStage05DocumentFields(data, { question, taskId: options.taskId, stage04: options.stage04 });
  const existing = stripInlineAuditDetails(String(data.document_markdown || ""));
  if (!options.forceSkeleton && shouldPreserveStage05Markdown(existing)) {
    data.document_markdown = existing;
    ensureStage05DocumentFields(data, { question, taskId: options.taskId, stage04: options.stage04 });
    return data.document_markdown;
  }

  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const claims = data.report_claims || [];
  const usedSourceIds = new Set<string>(claims.flatMap((claim: any) => claim.source_ids || []).map(String));
  const usedSources = [...usedSourceIds].map((id) => sourceById.get(id)).filter(Boolean) as Array<{ title: string; url: string }>;
  // 缺稿时补 05C 骨架；不写 YAML front matter，不写审计腔。
  data.document_markdown = buildStage05SkeletonMarkdown({
    title: data.title || "研究报告",
    question,
    executivePoints: data.executive_points || [],
    limitations: data.limitations || [],
    sourceLines: usedSources.map((source) => `[${source.title}](${source.url})`),
    claims: claims.map((claim: any) => ({
      id: String(claim.id || "RC"),
      statement: String(claim.statement || claim.id || ""),
      judgmentTitles: [],
      conclusions: [String(claim.statement || "")],
      sourceLines: (claim.source_ids || []).map((id: string) => {
        const source = sourceById.get(id);
        return source ? `[${source.title}](${source.url})` : String(id);
      }),
      uncertainties: [],
      invalidations: [],
    })),
  });
  ensureStage05DocumentFields(data, { question, taskId: options.taskId, stage04: options.stage04 });
  return data.document_markdown;
}
