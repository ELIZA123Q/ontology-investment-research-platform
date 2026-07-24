/** Stage03 双产物（数据与证据准备.md + 跨域实例清单.yaml）与覆盖/双就绪门禁。 */

import YAML from "yaml";
import {
  applyHighQualityGate,
  bodyMeetsMinDensity,
  downgradeIfHighQualityFails,
  nonEmptyText,
  requireDeterministicChecked,
  type StageQualityIssue,
} from "./stage_high_quality";
import { evaluateEvidenceQuality } from "./evidence_quality_gate";
import { projectEvidenceRequirementsFromStructure } from "./structure_candidates";
import type { SourceRecord } from "./types";

export const STAGE03_QUALITY_GATE_REF =
  "workflow/stages/03_证据/03_数据与证据准备规范.md#3-质量门槛与返工";

function nonEmpty(value: unknown, fallback = ""): string {
  return nonEmptyText(value, fallback);
}

function asList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
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
  options: { question?: string; taskId?: string; structure?: any } = {},
): any {
  const next = data && typeof data === "object" ? data : {};
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
  next.coverage_unit_total = Number.isFinite(Number(next.coverage_unit_total))
    ? Number(next.coverage_unit_total)
    : coverageTotal;
  next.evidence_backed_unit_count = Number.isFinite(Number(next.evidence_backed_unit_count))
    ? Number(next.evidence_backed_unit_count)
    : backed;
  next.evidence_coverage_rate = Number.isFinite(Number(next.evidence_coverage_rate))
    ? Number(next.evidence_coverage_rate)
    : Number(rate.toFixed(4));
  next.required_coverage_rate = Number.isFinite(Number(next.required_coverage_rate))
    ? Number(next.required_coverage_rate)
    : 0.5;
  next.critical_node_gate_status = nonEmpty(
    next.critical_node_gate_status,
    allGap ? "not_met" : (rate >= next.required_coverage_rate ? "met" : "partial"),
  );
  next.judgment_unit_gate_status = nonEmpty(
    next.judgment_unit_gate_status,
    allGap ? "insufficient" : (rate >= next.required_coverage_rate ? "met" : "partial"),
  );
  next.search_status = nonEmpty(next.search_status, (next.sources || []).length ? "threshold_met" : "source_scarce");
  next.allowed_05_output = nonEmpty(
    next.allowed_05_output,
    allGap ? "gap_report_only" : "full_report",
  );
  next.evidence_readiness = nonEmpty(
    next.evidence_readiness,
    allGap ? "not_ready" : (rate >= next.required_coverage_rate ? "ready" : "partial"),
  );
  next.delivery_readiness = nonEmpty(
    next.delivery_readiness,
    next.evidence_readiness === "ready" ? "ready" : "partial",
  );
  next.snapshot_ref = nonEmpty(next.snapshot_ref, "03-证据快照摘要.yaml");
  // 缺口可带边界确认（gap_report_only）；仅当显式要求返工时才置 return_required。
  next.quality_status = nonEmpty(next.quality_status, "minimum_pass");
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

  ensureEvidenceCompressionFields(next, options.structure);

  const prep = nonEmpty(next.preparation_markdown, nonEmpty(next.document_markdown));
  if (prep) next.preparation_markdown = prep;
  if (!nonEmpty(next.instance_manifest_yaml)) {
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
  const drafts = Array.isArray(data?.evidence_drafts) ? data.evidence_drafts : [];
  const units = Array.isArray(structure?.judgment_units) ? structure.judgment_units : [];
  const unitIds = [
    ...new Set([
      ...units.map((u: any) => String(u?.id || "").trim()).filter(Boolean),
      ...drafts.flatMap((d: any) => asList(d?.judgment_unit_ids)),
    ]),
  ];

  if (!Array.isArray(data.evidence_summaries) || data.evidence_summaries.length === 0) {
    const nonGap = drafts.filter((d: any) => String(d?.kind) !== "gap");
    data.evidence_summaries = nonGap.slice(0, 12).map((d: any, index: number) => ({
      id: `ESUM-${String(index + 1).padStart(2, "0")}`,
      title: nonEmpty(d?.statement, `证据摘要 ${index + 1}`).slice(0, 80),
      summary_kind: String(d?.kind) === "counter" ? "comparison" : "other",
      metric_refs: [],
      judgment_unit_ids: asList(d?.judgment_unit_ids),
      statement: nonEmpty(d?.statement),
      numeric_values: [],
      evidence_draft_ids: [nonEmpty(d?.id)].filter(Boolean),
      limitations: asList(d?.limitations),
    }));
  }

  if (!Array.isArray(data.evidence_bundles) || data.evidence_bundles.length === 0) {
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
        support_evidence_ids: support.map((d: any) => String(d.id)),
        counter_evidence_ids: counter.map((d: any) => String(d.id)),
        gap_ids: gaps.map((d: any) => String(d.id)),
        summary_ids: summaryIds,
        readiness,
        notes: [],
      };
    });
  }
}

/** 陈述中的数字是否出现在 quote 或 summary.numeric_values。
 * 非 gap 草稿的未 grounding 数字在 high_quality_pass 时升为 error；否则 warning。
 */
export function collectNumericGroundingWarnings(data: any): Stage03ConsistencyIssue[] {
  const warnings: Stage03ConsistencyIssue[] = [];
  const sources = Array.isArray(data?.sources) ? data.sources : [];
  const quotePool = sources.map((s: any) => String(s?.source_quote || "")).join("\n");
  const summaryNums = (Array.isArray(data?.evidence_summaries) ? data.evidence_summaries : [])
    .flatMap((s: any) => (Array.isArray(s?.numeric_values) ? s.numeric_values : []))
    .map((n: any) => String(n?.value ?? ""));
  const allowed = new Set([...summaryNums, ...extractNumericTokens(quotePool)]);
  const elevate = String(data?.quality_status || "") === "high_quality_pass";

  for (const draft of Array.isArray(data?.evidence_drafts) ? data.evidence_drafts : []) {
    if (String(draft?.kind) === "gap") continue;
    const statement = String(draft?.statement || "");
    const nums = extractNumericTokens(statement);
    const ungrounded = nums.filter((n) => !tokenGrounded(n, allowed, quotePool));
    if (ungrounded.length) {
      warnings.push({
        severity: elevate ? "error" : "warning",
        code: "numeric_ungrounded",
        message: `${draft.id} 陈述中的数字未见于 source_quote 或 evidence_summaries.numeric_values：${ungrounded.join(", ")}`,
      });
    }
  }
  return warnings;
}

function extractNumericTokens(text: string): string[] {
  const matches = text.match(/-?\d+(?:\.\d+)?%?/g) || [];
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
  if (String(data?.delivery_readiness) === "ready" && String(data?.evidence_readiness) === "not_ready") {
    issues.push({
      severity: "warning",
      code: "dual_readiness_independence",
      message: "delivery_readiness 与 evidence_readiness 应独立评估；证据未就绪时交付 ready 需人工确认",
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
  if (nonGapCount > 0 && (!mcpUsage || Number(mcpUsage.mcp_evidence_calls || 0) <= 0)) {
    issues.push({
      severity: "error",
      code: "mcp_channel_missing",
      message: "确认前须至少调用一手 MCP 通道，或将全部非核验主张改为 gap",
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
  options: { structure?: any; sources?: SourceRecord[] } = {},
): any {
  const next = data && typeof data === "object" ? { ...data } : {};
  const structure = options.structure || {};
  const units = Array.isArray(structure.judgment_units) ? structure.judgment_units : [];
  const requirements = Array.isArray(structure.evidence_requirements) && structure.evidence_requirements.length
    ? structure.evidence_requirements
    : projectEvidenceRequirementsFromStructure({
      units,
      counter_evidence_directions: structure.counter_evidence_directions,
    });
  const evidenceQuality = evaluateEvidenceQuality({
    evidenceDrafts: Array.isArray(next.evidence_drafts) ? next.evidence_drafts : [],
    sources: Array.isArray(options.sources) ? options.sources : [],
    judgmentUnits: units,
    evidenceRequirements: requirements,
  });
  next.evidence_quality_gate = {
    passed: evidenceQuality.passed,
    quality_status: evidenceQuality.qualityStatus,
    total_evidence: evidenceQuality.totalEvidence,
    source_groups: evidenceQuality.sourceGroups,
    direct_facts: evidenceQuality.directFacts,
    gap_details: evidenceQuality.gapDetails,
    evaluated_at: new Date().toISOString(),
    recomputed_on_approval: true,
  };
  next.evidence_quality_summary = evidenceQuality.summary;
  if (!evidenceQuality.passed || evidenceQuality.qualityStatus === "return_required") {
    next.quality_status = "return_required";
    next.return_required = true;
    next.deterministic_check_status = "not_checked";
  } else if (
    evidenceQuality.qualityStatus === "minimum_pass"
    && String(next.quality_status || "") === "high_quality_pass"
  ) {
    next.quality_status = "minimum_pass";
    next.deterministic_check_status = "not_checked";
  }
  return next;
}

export function assertStage03ReadyForApproval(data: any) {
  const errors = collectStage03ConsistencyIssues(data).filter((item) => item.severity === "error");
  if (errors.length) {
    throw new Error(`Stage03 双产物/质量门禁未通过：${errors.map((item) => item.message).join("；")}`);
  }
}
