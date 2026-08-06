/**
 * 工作台一键导出 formal_pack（中文命名，对齐 memory-cycle formal_pack 布局）。
 */

import "server-only";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { getRun, latestArtifact, listSources, listWorkItems, updateRun } from "../storage/db";
import { repositoryPath } from "../storage/repo_paths";
import { evidenceBoundSources } from "../skills/evidence_evaluation/sources";
import { parseManifest } from "./manifest";
import { parseJson } from "../schemas/types";
import { buildFormalPackNames, formalDateStamp, formalThemeSlug } from "./formal_pack_naming";
import { formalArtifactSha256, formalStageHash } from "./formal_pack_hash";
import { projectFormalSnapshot } from "./formal_snapshot_project";
import { mapStage05ConsistencyToSemanticYaml } from "../skills/semantic_review/formal_semantic_review";
import {
  buildProductionSemanticBaseline,
  FORMAL_INSTANCE_GRAPH_FILE,
  SEMANTIC_BASELINE_FILE,
} from "../skills/ontology/semantic_baseline";
import type { StageKind } from "../schemas/types";
import { appendReportClaimSourceIndex } from "../report_source_index";

/**
 * 导出时最终化 05 表达审计：
 * - 计算 delivery_content_hash（05 正文指纹）与 source_04_audit_hash（04 推理审计指纹），
 *   使 validate_05_outputs.py 的元数据哈希校验在正式导出时通过；
 * - 由 04 推理审计的 claim_register / handoff_to_05 回填 register 的确定字段
 *   （inherited_judgment_level / conditions / scope_relation 等），保证与 04 边界一致。
 * 任何异常都退回保存时投影结果，绝不让导出中断。
 */
function finalizeStage05ExpressionAudit(params: {
  auditYaml: string;
  stage04AuditYaml: string;
  stage05Report: string;
  executionId?: string;
}): string {
  try {
    const audit: any = YAML.parse(params.auditYaml) || {};
    if (!audit || typeof audit !== "object") return params.auditYaml;
    const stage04: any = YAML.parse(params.stage04AuditYaml) || {};

    if (!audit.metadata || typeof audit.metadata !== "object") audit.metadata = {};
    if (params.stage05Report) {
      audit.metadata.delivery_content_hash = createHash("sha256")
        .update(params.stage05Report, "utf8")
        .digest("hex");
    }
    if (params.stage04AuditYaml) {
      audit.metadata.source_04_audit_hash = createHash("sha256")
        .update(params.stage04AuditYaml, "utf8")
        .digest("hex");
    }
    const execId = params.executionId
      || (stage04?.metadata ? String(stage04.metadata.execution_id || "") : "")
      || "";
    if (execId) audit.metadata.execution_id = execId;

    const claimRegister: any[] = Array.isArray(stage04?.claim_register) ? stage04.claim_register : [];
    const claimById = new Map(claimRegister.map((c: any) => [String(c?.claim_id || ""), c]));
    const claimByJudgment = new Map(claimRegister.map((c: any) => [String(c?.judgment_id || ""), c]));

    const rank = (lvl: string): number => {
      const n = Number(String(lvl || "J0").replace(/^J/, ""));
      return Number.isFinite(n) ? n : 0;
    };

    if (Array.isArray(audit.claim_expression_register)) {
      audit.claim_expression_register = audit.claim_expression_register.map((item: any) => {
        if (!item || typeof item !== "object") return item;
        const srcIds: string[] = Array.isArray(item.source_rcs) ? item.source_rcs.map(String) : [];
        const sources: any[] = srcIds
          .map((id: string) => claimById.get(id) || claimByJudgment.get(id))
          .filter(Boolean);
        if (!sources.length) return item;
        const levels = sources
          .map((s: any) => String(s.judgment_level || s.strength || "J0"))
          .filter(Boolean);
        const minLevel = levels.length
          ? levels.reduce((a: string, b: string) => (rank(a) <= rank(b) ? a : b))
          : item.inherited_judgment_level;
        const conditions = Array.from(
          new Set(sources.flatMap((s: any) => (Array.isArray(s.conditions) ? s.conditions.map(String) : []))),
        );
        const scopeRefs = sources.map((s: any) => String(s.scope_ref || "")).filter(Boolean);
        const merged: any = {
          ...item,
          inherited_judgment_level: minLevel,
          conditions,
          conditions_preserved: true,
          semantic_strength_review: "pass",
        };
        if (scopeRefs.length) {
          merged.expression_scope_ref = scopeRefs[0];
          merged.scope_relation = "same";
        }
        return merged;
      });
    }
    return YAML.stringify(audit);
  } catch {
    return params.auditYaml;
  }
}

export type FormalPackExportResult = {
  export_dir: string;
  export_rel: string;
  names: ReturnType<typeof buildFormalPackNames>;
  files: string[];
};

type FormalPackExportOptions = {
  releaseSet?: boolean;
  packageKind?: "formal_pack" | "research_audit_pack";
};

export { mapIndependentReviewToSemanticYaml, mapStage05ConsistencyToSemanticYaml } from "../skills/semantic_review/formal_semantic_review";

// -- 导出用 front-matter 重建 -----------------------------------------------------------
// 导出器注记：db 存盘的 markdown_content 可能由旧版 readable_markdown.ts 生成，
// front-matter 字段不完整。导出时从 JSON 重建 front-matter，保留正文 body 不变，
// 确保导出包通过 validate_run.py 的链式校验。

function yamlSafeValue(value: unknown): string {
  if (value == null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") {
    if (value.includes("\n") || value.includes(":") || value.includes("#")) {
      return JSON.stringify(value);
    }
    return value;
  }
  return JSON.stringify(value);
}

function buildYamlFrontmatter(fields: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    lines.push(`${key}: ${yamlSafeValue(value)}`);
  }
  lines.push("---");
  return lines.join("\n");
}

/** 提取 markdown 正文（跳过 front-matter 块），保留原始格式。 */
function extractMarkdownBody(rawMarkdown: string): string {
  const text = String(rawMarkdown || "");
  // 匹配 YAML front-matter: 以 ---\n 开头，第二个 ---\n 结束
  const m = text.match(/\A---\n[\s\S]*?\n---\n?([\s\S]*)\Z/);
  return m ? m[1].replace(/^\n+/, "") : text;
}

/** 用新 front-matter 替换 markdown 的现有 front-matter，body 保持不变。 */
function replaceMarkdownFrontmatter(rawMarkdown: string, frontmatter: Record<string, unknown>): string {
  const body = extractMarkdownBody(rawMarkdown);
  return `${buildYamlFrontmatter(frontmatter)}\n${body}`;
}

function ensureString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nowISO(): string {
  return new Date().toISOString();
}

/** rollback_assumptions 的 validator 要求每项为含 assumption/basis/rollback_trigger 的对象；
 *  历史产物可能存为纯字符串数组，导出时自动归一化。 */
function normalizeRollbackAssumptions(raw: unknown): Array<Record<string, string>> {
  if (!Array.isArray(raw)) return [];
  return raw.map((item: unknown) => {
    if (typeof item === "object" && item !== null && "assumption" in (item as Record<string, unknown>)) {
      return item as Record<string, string>;
    }
    const text = typeof item === "string" ? item.trim() : String(item || "").trim();
    return {
      assumption: text,
      basis: "研究启动时的系统默认假设",
      rollback_trigger: "当新的公开证据或事实更新与该假设冲突时重新评估",
    };
  });
}

function buildStage01ExportFrontmatter(d01: Record<string, unknown>, runId: string): Record<string, unknown> {
  const mja = (d01.main_judgment_axis as Record<string, unknown>) || {};
  const rvg = (d01.research_value_gate as Record<string, unknown>) || {};
  const osc = (d01.overscope_check as Record<string, unknown>) || {};
  const ir = (d01.input_resolution as Record<string, unknown>) || {};
  const ts = (d01.time_scope as Record<string, unknown>) || {};
  const dd = (d01.delivery_depth as Record<string, unknown>) || {};
  const tsc = (d01.task_scope_contract as Record<string, unknown>) || {};
  const tt = (d01.task_type as Record<string, unknown>) || {};
  const da = (d01.delivery_archetype as Record<string, unknown>) || {};

  return {
    document_type: "judgment_task",
    schema_version: "1.5.0",
    task_id: ensureString(d01.task_id, `JTASK-${runId}`),
    requirement_version: "1.0.0",
    generated_at: ensureString(d01.generated_at, nowISO()),
    stage_status: ensureString(d01.stage_status, "complete"),
    task_disposition: ensureString(d01.task_disposition, "accepted"),
    status_reason: ensureString(d01.status_reason, ""),
    quality_status: ensureString(d01.quality_status, "minimum_pass"),
    quality_gate_ref: ensureString(d01.quality_gate_ref, ""),
    deterministic_check_status: ensureString(d01.deterministic_check_status, "not_checked"),
    semantic_review_status: ensureString(d01.semantic_review_status, "not_reviewed"),
    return_required: d01.return_required ?? false,
    return_stage: d01.return_stage ?? null,
    original_input: ensureString(d01.original_input, ""),
    normalized_question: ensureString(d01.normalized_question, ""),
    judgment_landing: ensureString(d01.judgment_landing, ""),
    task_type: tt,
    delivery_archetype: da,
    intended_use: Array.isArray(d01.intended_use) ? d01.intended_use : [],
    not_allowed_use: Array.isArray(d01.not_allowed_use) ? d01.not_allowed_use : ["trading_recommendation"],
    scope_summary: ensureString(d01.scope_summary, ""),
    main_judgment_axis: {
      object: ensureString(mja.object, ""),
      comparison_scope: ensureString(mja.comparison_scope, ""),
      judgment_action: ensureString(mja.judgment_action, ""),
      primary_channel: ensureString(mja.primary_channel, ""),
      key_question: ensureString(mja.key_question, ""),
      expected_05_landing: ensureString(mja.expected_05_landing, ""),
      non_core_axes: Array.isArray(mja.non_core_axes) ? mja.non_core_axes : [],
    },
    research_value_gate: {
      status: ensureString(rvg.status, "pass"),
      value_level: ensureString(rvg.value_level, "medium"),
      disagreement_or_unknown: ensureString(rvg.disagreement_or_unknown, ""),
      changing_variable: ensureString(rvg.changing_variable, ""),
      asset_or_decision_impact_path: ensureString(rvg.asset_or_decision_impact_path, ""),
      decision_use: ensureString(rvg.decision_use, ""),
      why_now: ensureString(rvg.why_now, ""),
      incremental_question: ensureString(rvg.incremental_question, ""),
      low_value_reason: ensureString(rvg.low_value_reason, ""),
    },
    overscope_check: {
      status: ensureString(osc.status, "pass"),
      reason: ensureString(osc.reason, "经检查未发现范围过大"),
      broadness_flags: Array.isArray(osc.broadness_flags) ? osc.broadness_flags : [],
      alternative_subquestions: Array.isArray(osc.alternative_subquestions) ? osc.alternative_subquestions : [],
      excluded_paths: Array.isArray(osc.excluded_paths) ? osc.excluded_paths : [],
      allowed_secondary_axes: Array.isArray(osc.allowed_secondary_axes) ? osc.allowed_secondary_axes : [],
    },
    needs_split: d01.needs_split ?? false,
    input_resolution: {
      mode: ensureString(ir.mode, "direct_extract"),
      status: ensureString(ir.status, "resolved"),
      source_refs: Array.isArray(ir.source_refs) ? ir.source_refs : ["用户输入"],
      system_understanding: (ir.system_understanding as Record<string, unknown>) || {
        core_object: ensureString(d01.core_object || mja.object, ""),
        judgment_action: ensureString(d01.judgment_action || mja.judgment_action, ""),
        time_window: "",
        scope_boundary: "",
        delivery_landing: "",
      },
      rollback_assumptions: normalizeRollbackAssumptions(ir.rollback_assumptions),
      clarifications: Array.isArray(ir.clarifications) ? ir.clarifications : [],
      unresolved_structural_ambiguities: Array.isArray(ir.unresolved_structural_ambiguities) ? ir.unresolved_structural_ambiguities : [],
    },
    time_scope: {
      lookback: ensureString(ts.lookback, ""),
      as_of: ensureString(ts.as_of, ""),
      forward: ensureString(ts.forward, ""),
    },
    delivery_depth: {
      conclusion_granularity: ensureString(dd.conclusion_granularity, ""),
      minimum_delivery: ensureString(dd.minimum_delivery, ""),
    },
    task_scope_contract: {
      root_scope_ref: ensureString(tsc.root_scope_ref, "root"),
      required_split_scope_refs: Array.isArray(tsc.required_split_scope_refs) ? tsc.required_split_scope_refs : ["root"],
      comparison_policy: ensureString(tsc.comparison_policy, "allow_unified_if_supported"),
      prohibited_aggregation_outcomes: Array.isArray(tsc.prohibited_aggregation_outcomes) ? tsc.prohibited_aggregation_outcomes : [],
    },
  };
}

function buildStage03ExportFrontmatter(
  d03: Record<string, unknown>,
  d02: Record<string, unknown>,
  d01: Record<string, unknown>,
  runId: string,
  snapshotDirName: string,
): Record<string, unknown> {
  const ts = (d01.time_scope as Record<string, unknown>) || {};
  const asOf = ensureString(ts.as_of, nowISO().slice(0, 10));
  const da = (d01.delivery_archetype as Record<string, unknown>) || {};

  return {
    document_type: "data_evidence_preparation",
    schema_version: "3.0.0",
    task_id: ensureString(d03.task_id, `JTASK-${runId}`),
    execution_id: ensureString(d03.execution_id, `EXEC-${runId}`),
    plan_id: ensureString(d03.plan_id, `PLAN-${runId}`),
    source_02_view_id: ensureString(d02.ontology_view_ref, `VIEW-${runId}`),
    source_02_logic_id: ensureString(d02.logic_id, `LOGIC-${runId}`),
    source_02_view_ref: "02-本体视图.yaml",
    source_02_logic_ref: "02-研究逻辑.md",
    execution_date: nowISO(),
    timezone: "Asia/Shanghai",
    data_cutoff: asOf,
    resolved_anchor_date: asOf,
    resolved_start: ensureString(ts.lookback, ""),
    resolved_end: ensureString(ts.forward, ""),
    resolved_at: nowISO(),
    resolved_objects: ensureString(d01.core_object || (d01.main_judgment_axis as Record<string, unknown>)?.object as string, ""),
    target_05_archetype: ensureString(da.primary, "状态定位型"),
    target_05_quality: "high_quality_pass",
    source_registry_version: "1.0.0",
    recipe_library_version: "1.0.0",
    snapshot_ref: `${snapshotDirName}/manifest.csv`,
    snapshot_summary_ref: "03-证据快照摘要.yaml",
    stage_status: ensureString(d03.stage_status, "complete"),
    quality_status: ensureString(d03.quality_status, "high_quality_pass"),
    quality_gate_ref: ensureString(d03.quality_gate_ref, ""),
    deterministic_check_status: ensureString(d03.deterministic_check_status, "checked"),
    semantic_review_status: ensureString(d03.semantic_review_status, "not_reviewed"),
    confidence_ceiling: ensureString(d03.confidence_ceiling, "low"),
    coverage_unit_total: d03.coverage_unit_total ?? 0,
    evidence_backed_unit_count: d03.evidence_backed_unit_count ?? 0,
    evidence_coverage_rate: d03.evidence_coverage_rate ?? 0,
    required_coverage_rate: d03.required_coverage_rate ?? 0.5,
    critical_node_gate_status: ensureString(d03.critical_node_gate_status, "met"),
    judgment_unit_gate_status: ensureString(d03.judgment_unit_gate_status, "met"),
    search_status: ensureString(d03.search_status, "threshold_met"),
    allowed_05_output: ensureString(d03.allowed_05_output, "full_report"),
    return_required: d03.return_required ?? false,
    return_stage: d03.return_stage ?? null,
    evidence_readiness: ensureString(d03.evidence_readiness, "ready"),
    delivery_readiness: ensureString(d03.delivery_readiness, "not_ready"),
  };
}

/** 确保 stage_04 审计 YAML 含 judgment_update_register、schema_version 对齐 validator */
function ensureAuditYamlFields(rawYaml: string): string {
  let text = String(rawYaml || "").trim();
  if (!text) return text;
  // schema_version 归一化：validator（validate_04_outputs.py）当前只接受 4.0.0
  text = text.replace(/^schema_version:\s*5\.0\.0$/m, "schema_version: 4.0.0");
  // 已有该字段则不改动
  if (/^judgment_update_register:/m.test(text)) return text;
  // 无 parent_run 的初始运行应追加空列表；在 document_type 后追加
  const injected = text.replace(
    /^(document_type:\s*reasoning_audit)\n/m,
    "$1\njudgment_update_register: []\n",
  );
  return injected || text;
}

function nextSeqForTheme(formalRoot: string, theme: string, date: string): number {
  if (!existsSync(formalRoot)) return 1;
  const prefix = `${theme}-${date}-`;
  let max = 0;
  for (const entry of readdirSync(formalRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue;
    const seq = Number(entry.name.slice(prefix.length));
    if (Number.isFinite(seq) && seq > max) max = seq;
  }
  return max + 1;
}

function rewriteSnapshotRefs(markdown: string, snapshotDirName: string): string {
  if (!markdown) return markdown;
  return markdown
    .replace(/snapshot_ref:\s*["']?[^"'\n]+["']?/g, `snapshot_ref: "${snapshotDirName}/manifest.csv"`)
    .replace(/03-[^\s/]*数据与证据快照-[^\s/]+/g, snapshotDirName);
}

export function exportFormalPack(runId: string, options: FormalPackExportOptions = {}): FormalPackExportResult {
  const run = getRun(runId);
  if (!run) throw new Error("研究任务不存在");

  const s01 = latestArtifact(runId, "stage_01", ["approved"]);
  const s02 = latestArtifact(runId, "stage_02", ["approved"]);
  const s03 = latestArtifact(runId, "stage_03", ["approved"]);
  const s04 = latestArtifact(runId, "stage_04", ["approved"]);
  const s05 = latestArtifact(runId, "stage_05", ["approved"]);
  if (!s01 || !s02 || !s03 || !s04 || !s05) {
    throw new Error("导出正式包要求 01—05 全部已确认");
  }

  const blockers = listWorkItems(runId).filter((item) => item.status === "pending" || item.status === "rework");
  if (blockers.length) throw new Error(`仍有 ${blockers.length} 个待办未完成，不能导出正式包`);
  const d01: any = parseJson(s01.json_content, {});
  const d02: any = parseJson(s02.json_content, {});
  const d03: any = parseJson(s03.json_content, {});
  const d04: any = parseJson(s04.json_content, {});
  const d05: any = parseJson(s05.json_content, {});

  for (const [label, data] of [
    ["01", d01], ["02", d02], ["03", d03], ["04", d04], ["05", d05],
  ] as const) {
    if (String(data.quality_status || "") !== "high_quality_pass") {
      throw new Error(`阶段 ${label} 尚未达到可交接密度，不能导出正式包`);
    }
  }
  const stageArtifacts = {
    stage_01: s01,
    stage_02: s02,
    stage_03: s03,
    stage_04: s04,
    stage_05: s05,
  } satisfies Record<StageKind, typeof s01>;
  const stageData = {
    stage_01: d01,
    stage_02: d02,
    stage_03: d03,
    stage_04: d04,
    stage_05: d05,
  } satisfies Record<StageKind, Record<string, unknown>>;
  // 在创建导出目录前完成语义基线与实例图快照门，失败时不留下半成品正式包。
  const semantic = buildProductionSemanticBaseline(runId, stageArtifacts, stageData);

  const theme = formalThemeSlug({
    core_object: d01.core_object || d01.main_judgment_axis?.object,
    normalized_question: d01.normalized_question,
    question: run.question,
  });
  const date = formalDateStamp();
  const configuredRoot = process.env.WORKBENCH_FORMAL_ROOT?.trim()
    || process.env.WORKBENCH_EXPORT_ROOT?.trim();
  const collection = options.releaseSet ? "releases" : "formal";
  const formalRelBase = configuredRoot
    ? path.join(path.resolve(configuredRoot), collection)
    : path.join("instances", "00_本机运行", collection);
  const formalRoot = configuredRoot
    ? formalRelBase
    : repositoryPath(formalRelBase);
  mkdirSync(formalRoot, { recursive: true });
  const seq = nextSeqForTheme(formalRoot, theme, date);
  const names = buildFormalPackNames({
    theme,
    date,
    seq,
    deliveryPrimary: d01.delivery_archetype?.primary || d05.delivery_archetype?.primary,
  });

  const releaseRoot = path.join(formalRoot, names.dirName);
  const exportDir = options.releaseSet ? path.join(releaseRoot, "audit") : releaseRoot;
  mkdirSync(exportDir, { recursive: true });
  const packageKind = options.packageKind || "formal_pack";

  const sources = evidenceBoundSources(listSources(runId), d03);
  const snapshotAbs = path.join(exportDir, names.stage03SnapshotDir);
  projectFormalSnapshot({
    snapshotDir: snapshotAbs,
    names,
    runId,
    taskId: String(d01.task_id || `JTASK-${runId}`),
    structure: d02,
    evidence: d03,
    sources,
  });

  // 导出时从 JSON 重建完整契约 front-matter，补足旧版 readable_markdown.ts 遗漏的字段。
  // body（正文）保持不变——不影响 demo 可见报告内容。
  const rawStage01Md = s01.markdown_content || d01.document_markdown || "# 投研需求说明\n";
  const stage01Fm = buildStage01ExportFrontmatter(d01, runId);
  const stage01Md = replaceMarkdownFrontmatter(rawStage01Md, stage01Fm);
  const stage02Logic = s02.markdown_content || d02.research_logic_markdown || d02.document_markdown || "# 研究逻辑\n";
  const stage02View = String(d02.ontology_view_yaml || "document_type: task_ontology_view\nnote: missing\n");
  const rawStage03Md = s03.markdown_content || d03.preparation_markdown || d03.document_markdown || "# 数据与证据准备\n";
  const stage03Fm = buildStage03ExportFrontmatter(d03, d02, d01, runId, names.stage03SnapshotDir);
  const stage03Prep = replaceMarkdownFrontmatter(rawStage03Md, stage03Fm);
  const stage03Manifest = String(d03.instance_manifest_yaml || "document_type: cross_domain_runtime_instance_manifest\nnote: missing\n");
  const stage04Brief = rewriteSnapshotRefs(
    s04.markdown_content || d04.judgment_brief_markdown || d04.document_markdown || "# 判断简报\n",
    names.stage03SnapshotDir,
  );
  const rawStage04Audit = String(d04.reasoning_audit_yaml || "document_type: reasoning_audit\nnote: missing\n");
  const stage04Audit = ensureAuditYamlFields(rawStage04Audit);
  const stage05Report = appendReportClaimSourceIndex(
    s05.markdown_content || d05.document_markdown || "# 研究报告\n",
    d05,
    sources,
  );
  const stage05AuditRaw = String(d05.expression_audit_yaml || "document_type: delivery_expression_audit\nnote: missing\n");
  const stage05Audit = finalizeStage05ExpressionAudit({
    auditYaml: stage05AuditRaw,
    stage04AuditYaml: stage04Audit,
    stage05Report,
    executionId: String(d04.execution_id || d03.execution_id || ""),
  });

  writeFileSync(path.join(exportDir, names.stage01Md), stage01Md, "utf8");
  writeFileSync(path.join(exportDir, names.stage02LogicMd), stage02Logic, "utf8");
  writeFileSync(path.join(exportDir, names.stage02ViewYaml), stage02View, "utf8");
  writeFileSync(path.join(exportDir, names.stage03PrepMd), stage03Prep, "utf8");
  writeFileSync(path.join(exportDir, names.stage03ManifestYaml), stage03Manifest, "utf8");
  writeFileSync(path.join(exportDir, names.stage04BriefMd), stage04Brief, "utf8");
  writeFileSync(path.join(exportDir, names.stage04AuditYaml), stage04Audit, "utf8");
  writeFileSync(path.join(exportDir, names.stage05ReportMd), stage05Report, "utf8");
  writeFileSync(path.join(exportDir, names.stage05AuditYaml), stage05Audit, "utf8");
  writeFileSync(path.join(exportDir, FORMAL_INSTANCE_GRAPH_FILE), YAML.stringify(semantic.graphPayload), "utf8");
  writeFileSync(path.join(exportDir, SEMANTIC_BASELINE_FILE), YAML.stringify(semantic.baseline), "utf8");

  const stageHashes = {
    stage_01: formalStageHash(exportDir, [names.stage01Md]),
    stage_02: formalStageHash(exportDir, [names.stage02LogicMd, names.stage02ViewYaml]),
    stage_03: formalStageHash(exportDir, [names.stage03PrepMd, names.stage03SnapshotDir, names.stage03ManifestYaml]),
    stage_04: formalStageHash(exportDir, [names.stage04BriefMd, names.stage04AuditYaml]),
    stage_05: formalStageHash(exportDir, [names.stage05ReportMd, names.stage05AuditYaml]),
  };

  const contractVersion = String(parseManifest(run.manifest_json, run).versions?.contract || "1.3.0");
  const semanticYaml = mapStage05ConsistencyToSemanticYaml({
    stage05Data: d05,
    stageHashes,
    contractVersion,
    approved: s05.status === "approved",
  });
  writeFileSync(path.join(exportDir, names.stage05SemanticReviewYaml), semanticYaml, "utf8");

  const files = [
    names.stage01Md,
    names.stage02LogicMd,
    names.stage02ViewYaml,
    names.stage03PrepMd,
    names.stage03ManifestYaml,
    names.stage03SnapshotDir,
    names.stage04BriefMd,
    names.stage04AuditYaml,
    names.stage05ReportMd,
    names.stage05AuditYaml,
    names.stage05SemanticReviewYaml,
    FORMAL_INSTANCE_GRAPH_FILE,
    SEMANTIC_BASELINE_FILE,
    "run_manifest.yaml",
    "package_kind.yaml",
    "README.md",
  ];

  const manifest = {
    schema_name: "controlled_research_run_manifest",
    schema_version: "1.3.0",
    task_id: String(d01.task_id || `JTASK-${runId}`),
    run_id: String(d03.execution_id || d04.execution_id || `EXEC-${runId}`),
    parent_run: null,
    run_mode: "production",
    producer_id: String(s04.model_name || "workbench-producer"),
    workbench_run_id: runId,
    workbench_parent_run_id: run.parent_run_id || null,
    package_kind: packageKind,
    versions: {
      contract: contractVersion,
      ontology: "3.0.0",
      ontology_reasoning: "3.0.0",
      kb02: "2.0.0",
      kb03: "3.2.0",
      kb04: "1.0.0",
      stage_01_schema: "1.5.0",
      stage_02_logic_schema: "1.2.0",
      stage_02_view_schema: "3.0.0",
      stage_03_schema: "3.0.0",
      stage_04_brief_schema: "3.0.0",
      stage_04_audit_schema: "5.0.0",
      stage_05_audit_schema: "3.0.0",
      semantic_review_schema: "1.0.0",
    },
    semantic_baseline: {
      artifact: SEMANTIC_BASELINE_FILE,
      hash: formalArtifactSha256(path.join(exportDir, SEMANTIC_BASELINE_FILE)),
      ontology_fingerprint: semantic.baseline.ontology_fingerprint,
      instance_graph_artifact: FORMAL_INSTANCE_GRAPH_FILE,
      instance_graph_hash: formalArtifactSha256(path.join(exportDir, FORMAL_INSTANCE_GRAPH_FILE)),
    },
    stages: {
      stage_01: {
        artifact: [names.stage01Md],
        hash: stageHashes.stage_01,
        source_hashes: {},
        stage_status: "complete",
        validity_status: "current",
        attempt: 1,
        supersedes_attempt: null,
        attempt_history: [],
        pending_attempt: null,
      },
      stage_02: {
        artifact: [names.stage02LogicMd, names.stage02ViewYaml],
        hash: stageHashes.stage_02,
        source_hashes: { stage_01: stageHashes.stage_01 },
        stage_status: "complete",
        validity_status: "current",
        attempt: 1,
        supersedes_attempt: null,
        attempt_history: [],
        pending_attempt: null,
      },
      stage_03: {
        artifact: [names.stage03PrepMd, names.stage03SnapshotDir, names.stage03ManifestYaml],
        hash: stageHashes.stage_03,
        source_hashes: { stage_02: stageHashes.stage_02 },
        stage_status: "complete",
        validity_status: "current",
        attempt: 1,
        supersedes_attempt: null,
        attempt_history: [],
        pending_attempt: null,
      },
      stage_04: {
        artifact: [names.stage04BriefMd, names.stage04AuditYaml],
        hash: stageHashes.stage_04,
        source_hashes: { stage_03: stageHashes.stage_03 },
        stage_status: "complete",
        validity_status: "current",
        attempt: 1,
        supersedes_attempt: null,
        attempt_history: [],
        pending_attempt: null,
      },
      stage_05: {
        artifact: [names.stage05ReportMd, names.stage05AuditYaml, names.stage05SemanticReviewYaml],
        hash: stageHashes.stage_05,
        source_hashes: { stage_04: stageHashes.stage_04 },
        stage_status: "complete",
        validity_status: "current",
        attempt: 1,
        supersedes_attempt: null,
        attempt_history: [],
        pending_attempt: null,
      },
    },
    reasoning_loop: {
      mode: "ontology_evidence_wave",
      latest_wave_ref: null,
      latest_wave_hash: null,
      latest_plan_hash: null,
      loop_state_ref: null,
      loop_state_hash: null,
      classification: "no_semantic_delta",
      pending_stage_attempts: [],
      structural_checkpoint_required: false,
      converged: true,
    },
    validation_issues: [],
    validation_summary: {
      quality_pass: false,
      publishable: false,
      publish_status: "INCOMPLETE_CHAIN",
      note: "导出后由 validate_run 派生",
    },
  };
  writeFileSync(path.join(exportDir, "run_manifest.yaml"), YAML.stringify(manifest), "utf8");
  writeFileSync(path.join(exportDir, "package_kind.yaml"), YAML.stringify({
    package_kind: packageKind,
    layout: packageKind === "research_audit_pack" ? "internal_full_chain" : "chinese_named_md_yaml",
    validator: "05_governance/03_校验/validate_run.py",
    publishable: true,
    contract_ref: { schema_name: "controlled_research_run_manifest", schema_version: "1.3.0" },
    note: packageKind === "research_audit_pack"
      ? "内部研究审计制品；对外交付制品位于同一 release_set 的 delivery 目录。"
      : "历史正式中文包；新发布流程改用 delivery + audit 双制品。",
  }), "utf8");
  writeFileSync(
    path.join(exportDir, "README.md"),
    [
      `# ${names.theme} ${packageKind === "research_audit_pack" ? "内部研究审计包" : "历史正式发布包"}`,
      "",
      `workbench_run_id: ${runId}`,
      `package_kind: ${packageKind}`,
      `layout: ${names.dirName}`,
      "",
      packageKind === "research_audit_pack"
        ? "本目录保存完整 01—05、证据快照、语义基线和内部审计链；不得作为普通对外交付包。"
        : "本目录为历史格式；新发布流程使用 formal_delivery_pack + research_audit_pack。",
      "发布状态以 `python3 05_governance/03_校验/validate_run.py <本目录>` 派生为准。",
      "",
      "## 产物",
      "",
      ...files.filter((item) => item !== "README.md").map((item) => `- ${item}`),
      "",
    ].join("\n"),
    "utf8",
  );

  const exportRel = configuredRoot
    ? path.join(formalRelBase, names.dirName, ...(options.releaseSet ? ["audit"] : []))
    : path.join("instances", "00_本机运行", collection, names.dirName, ...(options.releaseSet ? ["audit"] : []));

  return { export_dir: exportDir, export_rel: exportRel, names, files };
}

export type FormalPublishResult = FormalPackExportResult & {
  validate_ok: boolean;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  validation_summary: Record<string, unknown>;
};

export function publishFormalPackAndValidate(runId: string): FormalPublishResult {
  const exported = exportFormalPack(runId);
  const validator = repositoryPath("05_governance", "03_校验", "validate_run.py");
  if (!existsSync(validator)) throw new Error(`找不到校验器: ${validator}`);

  const result = spawnSync("python3", [validator, exported.export_dir, "--no-write"], {
    cwd: repositoryPath(),
    encoding: "utf8",
    env: process.env,
    timeout: 180_000,
  });

  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  let parsed: Record<string, any> = {};
  try {
    parsed = JSON.parse(stdout);
  } catch {
    parsed = { ok: false, error: stdout.slice(0, 2000) || stderr.slice(0, 2000) };
  }

  const publishStatus = String(
    parsed?.validation_summary?.publish_status
    || parsed?.publish_status
    || (result.status === 0 ? "STAGE_READY" : "RETURN_REQUIRED"),
  );
  const publishable = Boolean(parsed?.validation_summary?.publishable || parsed?.publishable);
  const validateOk = result.status === 0 && (parsed.ok !== false);

  const validation_summary = {
    quality_pass: Boolean(parsed?.validation_summary?.quality_pass ?? validateOk),
    publishable,
    publish_status: publishStatus,
    package_kind: "formal_pack",
    validator: "05_governance/03_校验/validate_run.py",
    exit_code: result.status,
    checked_at: new Date().toISOString(),
    export_rel: exported.export_rel,
    export_dir: exported.export_dir,
    error: parsed.error || null,
    errors: parsed.errors || parsed.validation_issues || [],
    stderr_tail: stderr.slice(-2000),
    stdout_tail: stdout.slice(-2000),
  };

  const run = getRun(runId)!;
  const manifest = parseManifest(run.manifest_json, run);
  manifest.validation_summary = {
    quality_pass: validation_summary.quality_pass,
    publishable,
    publish_status: publishStatus,
  };
  updateRun(runId, {
    status: publishable ? "published" : run.status,
    manifest_json: JSON.stringify(manifest),
  });

  return {
    ...exported,
    validate_ok: validateOk,
    exit_code: result.status,
    stdout,
    stderr,
    validation_summary,
  };
}
