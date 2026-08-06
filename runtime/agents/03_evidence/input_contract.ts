/** Stage03 双产物（数据与证据准备.md + 跨域实例清单.yaml）与覆盖/双就绪门禁。 */

import YAML from "yaml";
import {
  applyHighQualityGate,
  bodyMeetsMinDensity,
  downgradeIfHighQualityFails,
  nonEmptyText,
  requireDeterministicChecked,
  type StageQualityIssue,
} from "../shared/high_quality_gate";
import { evaluateEvidenceQuality } from "../../skills/evidence_evaluation/quality_gate";
import { demoteUnverifiedEvidenceDrafts } from "../../skills/evidence_evaluation/draft_normalize";
import {
  precheckFindingsAsWeakLinks,
  precheckStage03OntologyConstraints,
} from "../../skills/ontology/stage03_precheck";
import { projectEvidenceRequirementsFromStructure } from "../02_structure/structure_candidates";
import type { SourceRecord } from "../../schemas/types";

export const STAGE03_QUALITY_GATE_REF =
  "runtime/workflow/stage_specs/03_证据/03_数据与证据准备规范.md#3-质量门槛与返工";

function nonEmpty(value: unknown, fallback = ""): string {
  return nonEmptyText(value, fallback);
}

function asList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function requirementsFromStructure(structure: any): any[] {
  const units = Array.isArray(structure?.judgment_units) ? structure.judgment_units : [];
  return Array.isArray(structure?.evidence_requirements) && structure.evidence_requirements.length
    ? structure.evidence_requirements
    : projectEvidenceRequirementsFromStructure({
      units,
      counter_evidence_directions: structure?.counter_evidence_directions,
    });
}

function evidenceRoleOfDraft(draft: any): string {
  const explicit = String(draft?.evidence_role || "");
  if (["support", "counter", "context", "boundary"].includes(explicit)) {
    // 显式 evidence_role 与 kind/direction 冲突时，以 kind 为准
    if (explicit === "support" && (draft?.kind === "counter" || draft?.kind === "conflict" || draft?.direction === "weaken")) return "counter";
    return explicit;
  }
  if (draft?.kind === "counter" || draft?.kind === "conflict" || draft?.direction === "weaken") return "counter";
  if (draft?.direction === "neutral") return "context";
  return "support";
}

/**
 * 新产物显式使用 evidence_requirement_ids。旧产物只有在“同 JU、同角色、
 * 同 requirement 文本”或唯一候选时才自动迁移；歧义时保持空数组并由门禁阻断。
 */
export function bindStage03DraftsToRequirements(data: any, structure?: any): void {
  const requirements = requirementsFromStructure(structure);
  const requirementById = new Map(requirements.map((item: any) => [String(item?.id || ""), item]));
  if (!Array.isArray(data?.evidence_drafts)) return;
  data.evidence_drafts = data.evidence_drafts.map((draft: any) => {
    const declared = asList(draft?.evidence_requirement_ids);
    // 只读展示/旧工具未携带 Stage02 结构时不得擦除已存在的显式绑定；
    // 审批路径一定携带结构，届时再严格剔除悬空 ER。
    const explicit = requirements.length
      ? declared.filter((requirementId) => requirementById.has(requirementId))
      : declared;
    if (explicit.length) return { ...draft, evidence_requirement_ids: explicit };
    const unitIds = new Set(asList(draft?.judgment_unit_ids));
    const role = evidenceRoleOfDraft(draft);
    const candidates = requirements.filter((requirement: any) =>
      String(requirement?.evidence_role || "support") === role
      && asList(requirement?.judgment_unit_ids).some((unitId) => unitIds.has(unitId)),
    );
    const exact = String(draft?.requirement || "").trim()
      ? candidates.filter((requirement: any) =>
        String(requirement?.requirement || "").trim() === String(draft.requirement).trim(),
      )
      : [];
    const inferred = exact.length === 1
      ? [String(exact[0].id)]
      : candidates.length === 1
        ? [String(candidates[0].id)]
        : [];
    return { ...draft, evidence_requirement_ids: inferred };
  });
}

export function deriveDeliveryReadiness(data: any): "ready" | "partial" | "not_ready" {
  const materials = data?.delivery_materials || {};
  const charts = Array.isArray(materials.chart_candidates) ? materials.chart_candidates : [];
  const tables = Array.isArray(materials.table_candidates) ? materials.table_candidates : [];
  const annotations = Array.isArray(materials.source_annotation_candidates)
    ? materials.source_annotation_candidates
    : [];
  if (!charts.length && !tables.length && !annotations.length) return "not_ready";
  if ((charts.length || tables.length) && annotations.length) return "ready";
  return "partial";
}

function parseableTime(value: unknown): string | undefined {
  const text = String(value || "").trim();
  return text && Number.isFinite(Date.parse(text)) ? text : undefined;
}

/**
 * 预检使用 01 截止时点（若可解析）与 02 研究范围。旧调用方未传截止
 * 时点时，取证据中最早的 cutoff，防止较晚口径悄悄扩大研究窗口。
 */
function stage03OntologyPrecheck(
  data: any,
  structure: any,
  sources: SourceRecord[],
  options: { defaultScopeRef?: string; cutoffAt?: string } = {},
) {
  const drafts = Array.isArray(data?.evidence_drafts) ? data.evidence_drafts : [];
  const declaredCutoffs = drafts
    .filter((draft: any) => String(draft?.kind) !== "gap")
    .map((draft: any) => parseableTime(draft?.cutoff_at))
    .filter((value: string | undefined): value is string => Boolean(value))
    .sort((a: string, b: string) => Date.parse(a) - Date.parse(b));
  return precheckStage03OntologyConstraints({
    evidence_drafts: drafts,
    sources,
    default_scope_ref: String(
      options.defaultScopeRef
      || structure?.research_scope?.id
      || "",
    ).trim(),
    cutoff_at: parseableTime(options.cutoffAt) || declaredCutoffs[0],
  });
}

export function projectInstanceManifestYaml(
  data: any,
  options: { taskId?: string; question?: string; structure?: any } = {},
): string {
  const drafts = Array.isArray(data?.evidence_drafts) ? data.evidence_drafts : [];
  const sources = Array.isArray(data?.sources) ? data.sources : [];
  const units = Array.isArray(options.structure?.judgment_units) ? options.structure.judgment_units : [];
  const nonGap = drafts.filter((item: any) => String(item?.kind) !== "gap");
  const gaps = drafts.filter((item: any) => String(item?.kind) === "gap");
  const payload = {
    document_type: "cross_domain_runtime_instance_manifest",
    schema_version: "1.0.0",
    metadata: {
      task_id: nonEmpty(options.taskId, "JTASK-RUNTIME"),
      normalized_question: nonEmpty(options.question),
      snapshot_ref: nonEmpty(data?.snapshot_ref, "03-证据快照摘要.yaml"),
      stage_status: nonEmpty(data?.stage_status, "complete"),
      quality_status: nonEmpty(data?.quality_status, "minimum_pass"),
    },
    ontology_versions: {
      runtime: "3.0",
    },
    manifest_role: "stage_03_handoff",
    domain_instances: {
      semantic: units.map((unit: any) => ({
        id: nonEmpty(unit?.id),
        title: nonEmpty(unit?.title),
        judgment_type: nonEmpty(unit?.judgment_type),
      })),
      evidence: nonGap.map((item: any) => ({
        id: nonEmpty(item?.id),
        kind: nonEmpty(item?.kind),
        statement: nonEmpty(item?.statement),
        judgment_unit_ids: asList(item?.judgment_unit_ids),
        source_ids: asList(item?.source_ids),
      })),
      reasoning_input: gaps.map((item: any) => ({
        id: nonEmpty(item?.id),
        kind: "gap",
        requirement: nonEmpty(item?.requirement, item?.statement),
        judgment_unit_ids: asList(item?.judgment_unit_ids),
      })),
    },
    operational_files: {
      sources_count: sources.length,
      evidence_draft_count: drafts.length,
      unresolved_gaps: asList(data?.unresolved_gaps),
    },
    cross_domain_constraints: [
      "不得含 RuleEvaluation 或 Judgment",
      "事实草稿必须绑定 Source Registry",
    ],
    validation: {
      checks: [
        { id: "preparation_present", status: "pass" },
        { id: "instance_manifest_present", status: "pass" },
      ],
    },
  };
  return YAML.stringify(payload);
}

/** 原地补齐 Stage03 门禁与双产物字段。 */
export function ensureStage03DocumentFields(
  data: any,
  options: { question?: string; taskId?: string; structure?: any; forceProjection?: boolean } = {},
): any {
  const next = data && typeof data === "object" ? data : {};
  bindStage03DraftsToRequirements(next, options.structure);
  const drafts = Array.isArray(next.evidence_drafts) ? next.evidence_drafts : [];
  const units = Array.isArray(options.structure?.judgment_units) ? options.structure.judgment_units : [];
  const unitIds = new Set(units.map((unit: any) => String(unit.id)).filter(Boolean));
  const covered = new Set<string>();
  for (const draft of drafts) {
    if (String(draft?.kind) === "gap") continue;
    for (const id of asList(draft?.judgment_unit_ids)) covered.add(id);
  }
  const coverageTotal = unitIds.size || Math.max(drafts.length, 1);
  const backed = unitIds.size
    ? [...unitIds].filter((id) => covered.has(String(id))).length
    : drafts.filter((item: any) => String(item?.kind) !== "gap").length;
  const rate = coverageTotal ? backed / coverageTotal : 0;
  const allGap = drafts.length > 0 && drafts.every((item: any) => String(item?.kind) === "gap");

  next.stage_status = nonEmpty(next.stage_status, "complete");
  next.quality_gate_ref = nonEmpty(next.quality_gate_ref, STAGE03_QUALITY_GATE_REF);
  next.deterministic_check_status = nonEmpty(next.deterministic_check_status, "not_checked");
  next.semantic_review_status = nonEmpty(next.semantic_review_status, "not_reviewed");
  next.confidence_ceiling = nonEmpty(next.confidence_ceiling, allGap ? "low" : "medium");
  // 覆盖/就绪字段是当前 EvidenceDraft 的确定性投影，不得沿用 gap 底稿或旧补证轮次的缓存值。
  next.coverage_unit_total = coverageTotal;
  next.evidence_backed_unit_count = backed;
  next.evidence_coverage_rate = Number(rate.toFixed(4));
  next.required_coverage_rate = Number.isFinite(Number(next.required_coverage_rate))
    ? Number(next.required_coverage_rate)
    : 0.5;
  next.critical_node_gate_status = allGap
    ? "not_met"
    : (rate >= next.required_coverage_rate ? "met" : "partial");
  next.judgment_unit_gate_status = allGap
    ? "insufficient"
    : (rate >= next.required_coverage_rate ? "met" : "partial");
  next.search_status = !(next.sources || []).length
    ? "source_scarce"
    : (rate >= next.required_coverage_rate ? "threshold_met" : "in_progress");
  next.allowed_05_output = allGap
    ? "gap_report_only"
    : (rate >= next.required_coverage_rate ? "full_report" : "bounded_report");
  next.evidence_readiness = allGap
    ? "not_ready"
    : (rate >= next.required_coverage_rate ? "ready" : "partial");
  next.snapshot_ref = nonEmpty(next.snapshot_ref, "03-证据快照摘要.yaml");
  // 缺口可带边界确认（gap_report_only）；仅当显式要求返工时才置 return_required。
  next.quality_status = nonEmpty(next.quality_status, "high_quality_pass");
  next.return_required = Boolean(next.return_required ?? false);
  next.return_stage = next.return_stage == null || next.return_stage === ""
    ? (next.return_required ? "stage_03" : null)
    : String(next.return_stage);

  if (!next.delivery_materials || typeof next.delivery_materials !== "object") {
    next.delivery_materials = {
      chart_candidates: [],
      table_candidates: [],
      source_annotation_candidates: [],
    };
  } else {
    next.delivery_materials.chart_candidates = Array.isArray(next.delivery_materials.chart_candidates)
      ? next.delivery_materials.chart_candidates
      : [];
    next.delivery_materials.table_candidates = Array.isArray(next.delivery_materials.table_candidates)
      ? next.delivery_materials.table_candidates
      : [];
    next.delivery_materials.source_annotation_candidates = Array.isArray(next.delivery_materials.source_annotation_candidates)
      ? next.delivery_materials.source_annotation_candidates
      : [];
  }
  next.delivery_readiness = deriveDeliveryReadiness(next);

  ensureEvidenceCompressionFields(next, options.structure);

  const gateStatus = String(next?.evidence_quality_gate?.quality_status || "");
  if (next?.evidence_quality_gate?.passed === false || gateStatus === "return_required") {
    next.evidence_readiness = "not_ready";
    next.allowed_05_output = Number(next?.evidence_quality_gate?.total_evidence || 0) > 0
      ? "bounded_report"
      : "gap_report_only";
  } else if (gateStatus === "minimum_pass") {
    next.evidence_readiness = "partial";
    next.allowed_05_output = "bounded_report";
  } else if (gateStatus === "high_quality_pass") {
    next.evidence_readiness = "ready";
    next.allowed_05_output = "full_report";
  }

  const prep = nonEmpty(next.preparation_markdown, nonEmpty(next.document_markdown));
  if (prep) next.preparation_markdown = prep;
  if (options.forceProjection || !nonEmpty(next.instance_manifest_yaml)) {
    next.instance_manifest_yaml = projectInstanceManifestYaml(next, options);
  }
  if (nonEmpty(next.preparation_markdown)) {
    next.document_markdown = next.preparation_markdown;
  }

  if (nonEmpty(next.quality_status) === "high_quality_pass") {
    const provisional = { ...next, deterministic_check_status: "checked" };
    const hqErrors = collectStage03HighQualityIssues(provisional);
    if (hqErrors.length) downgradeIfHighQualityFails(next, hqErrors);
    else next.deterministic_check_status = "checked";
  }
  return next;
}

/** Stage03 high_quality：准备说明密度、压缩产物、非 gap 有来源、数字 grounding、deterministic checked。 */
export function collectStage03HighQualityIssues(data: any): StageQualityIssue[] {
  const issues: StageQualityIssue[] = [];
  const prep = nonEmpty(data?.preparation_markdown, data?.document_markdown);
  if (!bodyMeetsMinDensity(prep, 800)) {
    issues.push({
      severity: "error",
      code: "stage03_prep_thin",
      message: "high_quality 要求数据与证据准备正文达到可审阅密度（≥800 字，含覆盖/缺口/上限）",
    });
  }
  const drafts = Array.isArray(data?.evidence_drafts) ? data.evidence_drafts : [];
  const nonGap = drafts.filter((item: any) => String(item?.kind) !== "gap");
  if (!nonGap.length && drafts.length === 0) {
    issues.push({
      severity: "error",
      code: "evidence_drafts_empty",
      message: "high_quality 要求至少有证据草稿或显式 gap 登记",
    });
  }
  const hasCounterOrGap = drafts.some((item: any) => {
    const kind = String(item?.kind || "");
    const dir = String(item?.direction || "");
    return kind === "counter" || kind === "gap" || kind === "conflict" || dir === "weaken" || dir === "unknown";
  });
  if (nonGap.length && !hasCounterOrGap) {
    issues.push({
      severity: "error",
      code: "counter_or_gap_missing",
      message: "high_quality 要求显式反证/冲突或 gap，禁止只有单向支持事实",
    });
  }
  const gate = data?.evidence_quality_gate;
  if (!gate) {
    issues.push({
      severity: "error",
      code: "evidence_quality_gate_missing",
      message: "high_quality 要求存在可复核的 evidence_quality_gate（确认时会重算）",
    });
  } else if (gate.passed === false || String(gate.quality_status || "") === "return_required") {
    issues.push({
      severity: "error",
      code: "evidence_quality_gate_failed",
      message: `high_quality 要求证据质量门通过：${nonEmpty(data?.evidence_quality_summary, "未通过")}`,
    });
  } else if (String(gate.quality_status || "") !== "high_quality_pass") {
    issues.push({
      severity: "error",
      code: "evidence_quality_not_hq",
      message: "high_quality 要求 evidence_quality_gate.quality_status=high_quality_pass（证据条数/来源组/直接事实达标）",
    });
  }
  for (const draft of nonGap) {
    const sources = asList(draft?.source_keys).length + asList(draft?.source_ids).length;
    if (!sources) {
      issues.push({
        severity: "error",
        code: "nongap_without_source",
        message: `high_quality：非 gap 证据 ${draft?.id || ""} 必须绑定来源`,
      });
      break;
    }
  }
  const bundles = Array.isArray(data?.evidence_bundles) ? data.evidence_bundles : [];
  const summaries = Array.isArray(data?.evidence_summaries) ? data.evidence_summaries : [];
  if (!bundles.length && nonGap.length) {
    issues.push({
      severity: "error",
      code: "evidence_bundles_missing",
      message: "high_quality 要求按判断单元产出 evidence_bundles",
    });
  }
  if (!summaries.length && nonGap.length) {
    issues.push({
      severity: "error",
      code: "evidence_summaries_missing",
      message: "high_quality 要求产出 evidence_summaries 压缩摘要",
    });
  }
  // 数字 grounding：对 HQ 一律按 error 收集
  const grounded = collectNumericGroundingWarnings({ ...data, quality_status: "high_quality_pass" })
    .filter((item) => item.severity === "error");
  issues.push(...grounded.map((item) => ({
    severity: "error" as const,
    code: item.code,
    message: item.message,
  })));
  requireDeterministicChecked(data, issues);
  return issues;
}

/** 从 drafts 投影 Evidence Summary / Bundle；模型已写则保留并补缺。 */
export function ensureEvidenceCompressionFields(data: any, structure?: any): void {
  bindStage03DraftsToRequirements(data, structure);
  const drafts = Array.isArray(data?.evidence_drafts) ? data.evidence_drafts : [];
  const units = Array.isArray(structure?.judgment_units) ? structure.judgment_units : [];
  const unitIds = [
    ...new Set([
      ...units.map((u: any) => String(u?.id || "").trim()).filter(Boolean),
      ...drafts.flatMap((d: any) => asList(d?.judgment_unit_ids)),
    ]),
  ];

  const nonGap = drafts.filter((d: any) => String(d?.kind) !== "gap");
  const nonGapIds = new Set(nonGap.map((draft: any) => String(draft?.id || "")).filter(Boolean));
  const existingSummaries = Array.isArray(data.evidence_summaries) ? data.evidence_summaries : [];
  const validSummaries = existingSummaries.filter((summary: any) => {
    const refs = asList(summary?.evidence_draft_ids);
    return refs.length > 0 && refs.every((ref) => nonGapIds.has(ref));
  }).map((summary: any) => ({
    ...summary,
    evidence_draft_ids: asList(summary?.evidence_draft_ids),
  }));
  const summarizedEvidenceIds = new Set(
    validSummaries.flatMap((summary: any) => asList(summary?.evidence_draft_ids)),
  );
  const occupiedSummaryIds = new Set(validSummaries.map((summary: any) => String(summary?.id || "")).filter(Boolean));
  const addedSummaries = nonGap
    .filter((draft: any) => !summarizedEvidenceIds.has(String(draft?.id || "")))
    .slice(0, Math.max(0, 24 - validSummaries.length))
    .map((d: any, index: number) => {
      let id = `ESUM-AUTO-${String(index + 1).padStart(2, "0")}`;
      let suffix = 2;
      while (occupiedSummaryIds.has(id)) {
        id = `ESUM-AUTO-${String(index + 1).padStart(2, "0")}-${suffix}`;
        suffix += 1;
      }
      occupiedSummaryIds.add(id);
      return {
      id,
      title: nonEmpty(d?.statement, `证据摘要 ${index + 1}`).slice(0, 80),
      summary_kind: String(d?.kind) === "counter" ? "comparison" : "other",
      metric_refs: [],
      judgment_unit_ids: asList(d?.judgment_unit_ids),
      statement: nonEmpty(d?.statement),
      numeric_values: [],
      evidence_draft_ids: [nonEmpty(d?.id)].filter(Boolean),
      limitations: asList(d?.limitations),
    };
    });
  data.evidence_summaries = [...validSummaries, ...addedSummaries];

  const priorBundles = new Map<string, any>(
    (Array.isArray(data.evidence_bundles) ? data.evidence_bundles : [])
      .map((bundle: any) => [String(bundle?.judgment_unit_id || ""), bundle]),
  );
  data.evidence_bundles = unitIds.map((unitId) => {
      const related = drafts.filter((d: any) => asList(d?.judgment_unit_ids).includes(unitId));
      const support = related.filter((d: any) => {
        const kind = String(d?.kind);
        const dir = String(d?.direction);
        return kind !== "gap" && (dir === "support" || kind === "fact_draft" || kind === "source_claim");
      });
      const counter = related.filter((d: any) => String(d?.kind) === "counter" || String(d?.direction) === "weaken");
      const gaps = related.filter((d: any) => String(d?.kind) === "gap");
      const summaryIds = (Array.isArray(data.evidence_summaries) ? data.evidence_summaries : [])
        .filter((s: any) => asList(s?.judgment_unit_ids).includes(unitId) || asList(s?.judgment_unit_ids).length === 0)
        .map((s: any) => String(s.id));
      const readiness = gaps.length && !support.length
        ? "not_ready"
        : (gaps.length || !support.length ? "partial" : "ready");
      return {
        judgment_unit_id: unitId,
        requirement_ids: [
          ...new Set(related.flatMap((draft: any) => asList(draft?.evidence_requirement_ids))),
        ],
        support_evidence_ids: support.map((d: any) => String(d.id)),
        counter_evidence_ids: counter.map((d: any) => String(d.id)),
        gap_ids: gaps.map((d: any) => String(d.id)),
        summary_ids: summaryIds,
        readiness,
        notes: asList(priorBundles.get(unitId)?.notes),
      };
    });
}

/** 陈述中的数字是否出现在 quote 或 summary.numeric_values。
 * 非 gap 草稿的未 grounding 数字在 high_quality_pass 时升为 error；否则 warning。
 */
export function collectNumericGroundingWarnings(data: any): Stage03ConsistencyIssue[] {
  const warnings: Stage03ConsistencyIssue[] = [];
  const issues = findStage03NumericGroundingIssues(data);
  const elevate = String(data?.quality_status || "") === "high_quality_pass";
  for (const issue of issues) {
    warnings.push({
      severity: elevate ? "error" : "warning",
      code: "numeric_ungrounded",
      message: `${issue.evidence_id} 陈述中的数字未见于 source_quote 或 evidence_summaries.numeric_values：${issue.tokens.join(", ")}`,
    });
  }
  return warnings;
}

export type Stage03NumericGroundingIssue = {
  evidence_id: string;
  judgment_unit_ids: string[];
  tokens: string[];
};

/**
 * 返回可供补证调度消费的结构化数字落引问题。审批报错与补证目标必须使用
 * 同一检测器，避免“门禁知道哪里错、调度器却只看覆盖率”的死循环。
 */
export function findStage03NumericGroundingIssues(data: any): Stage03NumericGroundingIssue[] {
  const sources = Array.isArray(data?.sources) ? data.sources : [];
  const sourceByKey = new Map<string, any>(
    sources.map((source: any) => [String(source?.source_key || ""), source]),
  );
  const summaries = Array.isArray(data?.evidence_summaries) ? data.evidence_summaries : [];
  const issues: Stage03NumericGroundingIssue[] = [];

  for (const draft of Array.isArray(data?.evidence_drafts) ? data.evidence_drafts : []) {
    if (String(draft?.kind) === "gap") continue;
    const statement = String(draft?.statement || "");
    // 数字必须落到“本条 EvidenceDraft 实际绑定”的引文，不能拿另一条证据的
    // quote 或无关 Summary 全局串门过关。
    const quotePool = asList(draft?.source_keys)
      .map((key) => String(sourceByKey.get(key)?.source_quote || ""))
      .join("\n");
    const summaryNums = summaries
      .filter((summary: any) => asList(summary?.evidence_draft_ids).includes(String(draft?.id || "")))
      .flatMap((summary: any) => (Array.isArray(summary?.numeric_values) ? summary.numeric_values : []))
      .map((value: any) => String(value?.value ?? ""));
    const allowed = new Set([...summaryNums, ...extractNumericTokens(quotePool)]);
    const nums = extractNumericTokens(statement);
    const ungrounded = nums.filter((n) => !tokenGrounded(n, allowed, quotePool));
    if (ungrounded.length) {
      issues.push({
        evidence_id: String(draft.id || ""),
        judgment_unit_ids: asList(draft.judgment_unit_ids),
        tokens: ungrounded,
      });
    }
  }
  return issues;
}

function extractNumericTokens(text: string): string[] {
  // “2025-2026”中的连接号不是负号；真正的负数（如 -4.7%）仍保留符号。
  const matches = text.match(/(?<!\d)-?\d+(?:\.\d+)?%?/g) || [];
  return [...new Set(matches.filter((m) => m.replace(/[^\d]/g, "").length >= 2))];
}

function tokenGrounded(token: string, allowed: Set<string>, quotePool: string): boolean {
  if (allowed.has(token)) return true;
  const bare = token.replace(/%$/, "");
  if (allowed.has(bare) || allowed.has(`${bare}%`)) return true;
  return quotePool.includes(token) || quotePool.includes(bare);
}

export type Stage03ConsistencyIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
};

export function collectStage03ConsistencyIssues(data: any): Stage03ConsistencyIssue[] {
  const issues: Stage03ConsistencyIssue[] = [];
  const prep = nonEmpty(data?.preparation_markdown, data?.document_markdown);
  const manifest = nonEmpty(data?.instance_manifest_yaml);
  if (!prep || prep.length < 40) {
    issues.push({ severity: "error", code: "missing_preparation", message: "缺少合格的数据与证据准备正文" });
  }
  if (!manifest || manifest.length < 20) {
    issues.push({ severity: "error", code: "missing_instance_manifest", message: "缺少跨域实例清单 YAML" });
  }
  if (prep && nonEmpty(data?.document_markdown) && prep.trim() !== String(data.document_markdown).trim()) {
    issues.push({ severity: "error", code: "preparation_mirror", message: "document_markdown 必须与 preparation_markdown 一致" });
  }
  if (String(data?.evidence_readiness) === "not_ready" && String(data?.allowed_05_output) === "full_report") {
    issues.push({
      severity: "error",
      code: "readiness_output_conflict",
      message: "evidence_readiness=not_ready 时 allowed_05_output 不得为 full_report",
    });
  }
  const expectedDeliveryReadiness = deriveDeliveryReadiness(data);
  if (String(data?.delivery_readiness) !== expectedDeliveryReadiness) {
    issues.push({
      severity: "error",
      code: "delivery_readiness_not_material_derived",
      message: `delivery_readiness 必须由展示素材独立派生，当前应为 ${expectedDeliveryReadiness}`,
    });
  }
  const unboundDrafts = (Array.isArray(data?.evidence_drafts) ? data.evidence_drafts : [])
    .filter((draft: any) => !asList(draft?.evidence_requirement_ids).length);
  if (unboundDrafts.length) {
    issues.push({
      severity: "error",
      code: "evidence_requirement_binding_missing",
      message: `每条 EvidenceDraft 必须绑定具体 Stage02 ER；未绑定：${unboundDrafts.map((draft: any) => draft?.id).join(", ")}`,
    });
  }
  const ontologyPrecheck = data?.ontology_precheck;
  if (ontologyPrecheck && Number(ontologyPrecheck.blocking_soft_count || 0) > 0) {
    issues.push({
      severity: "error",
      code: "ontology_precheck_blocking",
      message: `本体约束预检存在 ${ontologyPrecheck.blocking_soft_count} 项待修复阻断`,
    });
  }
  const quality = nonEmpty(data?.quality_status);
  if (quality !== "high_quality_pass") {
    issues.push({
      severity: "error",
      code: "quality_status",
      message: "本稿尚未达到可交接密度，请重新生成后再确认",
    });
  }
  const nonGapCount = (Array.isArray(data?.evidence_drafts) ? data.evidence_drafts : [])
    .filter((item: any) => String(item?.kind) !== "gap").length;
  const gate = data?.evidence_quality_gate;
  if (!gate) {
    issues.push({
      severity: "error",
      code: "evidence_quality_gate_missing",
      message: "缺少 evidence_quality_gate；确认前须按草稿与 Source Registry 重算并通过",
    });
  } else if (gate.passed === false || String(gate.quality_status || "") === "return_required") {
    issues.push({
      severity: "error",
      code: "evidence_quality_gate",
      message: `证据质量门未通过：${nonEmpty(data?.evidence_quality_summary, "需补证后重试")}`,
    });
  }
  // 未达 HQ 时数字 grounding 仍提示；达 HQ 后由 HQ 门禁升为 error
  if (quality !== "high_quality_pass") {
    issues.push(...collectNumericGroundingWarnings(data));
  }
  const mcpUsage = data?.mcp_channel_usage;
  if (nonGapCount > 0 && !mcpUsage) {
    issues.push({
      severity: "warning",
      code: "acquisition_telemetry_missing",
      message: "缺少来源取得通道留痕；这不改变来源本身的权威性，但会降低运行回放完整度",
    });
  }
  issues.push(...applyHighQualityGate(collectStage03HighQualityIssues(data), quality));
  return issues;
}

/**
 * 确认前重算证据质量门：忽略可被手工篡改的旧 gate 结论，按当前草稿 + Source Registry 派生。
 * 不改写 mcp_channel_usage（应由生成期工具留痕写入）。
 */
export function recomputeStage03EvidenceQualityGate(
  data: any,
  options: {
    structure?: any;
    sources?: SourceRecord[];
    defaultScopeRef?: string;
    cutoffAt?: string;
  } = {},
): any {
  const next = data && typeof data === "object" ? { ...data } : {};
  const structure = options.structure || {};
  const cutoffMs = parseableTime(options.cutoffAt)
    ? Date.parse(String(options.cutoffAt))
    : undefined;
  Object.assign(next, demoteUnverifiedEvidenceDrafts(next, {
    cutoffMs,
    registrySources: options.sources || [],
  }));
  bindStage03DraftsToRequirements(next, structure);
  const units = Array.isArray(structure.judgment_units) ? structure.judgment_units : [];
  const requirements = Array.isArray(structure.evidence_requirements) && structure.evidence_requirements.length
    ? structure.evidence_requirements
    : projectEvidenceRequirementsFromStructure({
      units,
      counter_evidence_directions: structure.counter_evidence_directions,
    });
  const sources = Array.isArray(options.sources) ? options.sources : [];
  const evidenceQuality = evaluateEvidenceQuality({
    evidenceDrafts: Array.isArray(next.evidence_drafts) ? next.evidence_drafts : [],
    sources,
    judgmentUnits: units,
    evidenceRequirements: requirements,
  });
  const ontologyPrecheck = stage03OntologyPrecheck(next, structure, sources, options);
  const ontologyBlocked = ontologyPrecheck.blocking_soft_count > 0;
  next.ontology_precheck = ontologyPrecheck;
  const ontologyWeakLinks = precheckFindingsAsWeakLinks(ontologyPrecheck);
  next.evidence_quality_gate = {
    passed: evidenceQuality.passed && !ontologyBlocked,
    quality_status: ontologyBlocked ? "return_required" : evidenceQuality.qualityStatus,
    total_evidence: evidenceQuality.totalEvidence,
    source_groups: evidenceQuality.sourceGroups,
    direct_facts: evidenceQuality.directFacts,
    gap_details: evidenceQuality.gapDetails,
    evaluated_at: new Date().toISOString(),
    recomputed_on_approval: true,
    ontology_precheck_blocking_soft_count: ontologyPrecheck.blocking_soft_count,
    ontology_precheck_advisory_count: ontologyPrecheck.advisory_count,
  };
  next.evidence_quality_summary = [
    evidenceQuality.summary,
    ...ontologyWeakLinks,
  ].filter(Boolean).join("；");
  next.evidence_requirement_assessments = evidenceQuality.requirementAssessments;
  next.delivery_readiness = deriveDeliveryReadiness(next);
  if (ontologyBlocked || !evidenceQuality.passed || evidenceQuality.qualityStatus === "return_required") {
    next.quality_status = "return_required";
    next.return_required = true;
    next.deterministic_check_status = "not_checked";
    next.evidence_readiness = "not_ready";
    next.allowed_05_output = evidenceQuality.totalEvidence > 0 ? "bounded_report" : "gap_report_only";
  } else if (evidenceQuality.qualityStatus === "minimum_pass") {
    if (String(next.quality_status || "") === "high_quality_pass") {
      next.quality_status = "minimum_pass";
      next.deterministic_check_status = "not_checked";
    }
    next.evidence_readiness = "partial";
    next.allowed_05_output = "bounded_report";
  } else if (evidenceQuality.qualityStatus === "high_quality_pass") {
    next.evidence_readiness = "ready";
    next.allowed_05_output = "full_report";
    next.return_required = false;
    // 证据门按当前 Registry 重算通过后，再以完整 HQ 合同闭环校验。
    // 不能让历史 minimum_pass 缓存永久压住真实高质量证据，也不能仅凭
    // 条数直接升级。
    ensureEvidenceCompressionFields(next, structure);
    next.quality_status = "high_quality_pass";
    next.deterministic_check_status = "checked";
    const highQualityIssues = collectStage03HighQualityIssues(next);
    if (highQualityIssues.length) downgradeIfHighQualityFails(next, highQualityIssues);
  }
  return next;
}

export function assertStage03ReadyForApproval(data: any) {
  const errors = collectStage03ConsistencyIssues(data).filter((item) => item.severity === "error");
  if (errors.length) {
    throw new Error(`Stage03 双产物/质量门禁未通过：${errors.map((item) => item.message).join("；")}`);
  }
}
