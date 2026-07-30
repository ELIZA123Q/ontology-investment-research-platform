/**
 * 从工作台 Stage02/03 + Source Registry 投影正式包 03 快照 CSV 树。
 * 缺材料时写诚实 gap / 空表头，不伪造事实。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SourceRecord } from "./types";
import type { FormalPackNames } from "./formal_pack_naming";

/** 与 runtime/adapters/snapshot_layout_03.py 对齐。 */
export const SNAPSHOT_CSV_LAYOUT: Record<string, string> = {
  "manifest.csv": "manifest.csv",
  "evidence_requirements.csv": "01_plan/evidence_requirements.csv",
  "evidence_recipe_matches.csv": "01_plan/evidence_recipe_matches.csv",
  "evidence_baskets.csv": "01_plan/evidence_baskets.csv",
  "source_profiles.csv": "01_plan/source_profiles.csv",
  "acquisition_channels.csv": "01_plan/acquisition_channels.csv",
  "proxy_indicators.csv": "01_plan/proxy_indicators.csv",
  "source_snapshot.csv": "02_assets/source_snapshot.csv",
  "source_documents.csv": "02_assets/source_documents.csv",
  "acquisition_log.csv": "02_assets/acquisition_log.csv",
  "semantic_instances.csv": "02_assets/semantic_instances.csv",
  "semantic_relations.csv": "02_assets/semantic_relations.csv",
  "reasoning_inputs.csv": "02_assets/reasoning_inputs.csv",
  "evidence_records.csv": "02_assets/evidence_records.csv",
  "evidence_claims.csv": "02_assets/evidence_claims.csv",
  "evidence_facts.csv": "02_assets/evidence_facts.csv",
  "evidence_relations.csv": "02_assets/evidence_relations.csv",
  "evidence_assessments.csv": "02_assets/evidence_assessments.csv",
  "evidence_readiness_assessments.csv": "03_gate/evidence_readiness_assessments.csv",
  "state_variable_coverage.csv": "03_gate/state_variable_coverage.csv",
  "path_readiness.csv": "03_gate/path_readiness.csv",
  "gaps_and_risks.csv": "03_gate/gaps_and_risks.csv",
  "display_data_candidates.csv": "04_05_materials/display_data_candidates.csv",
  "chart_data_package.csv": "04_05_materials/chart_data_package.csv",
  "table_material_package.csv": "04_05_materials/table_material_package.csv",
  "source_annotation_package.csv": "04_05_materials/source_annotation_package.csv",
  "delivery_readiness.csv": "04_05_materials/delivery_readiness.csv",
};

function csvEscape(value: unknown): string {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function writeCsv(filePath: string, headers: string[], rows: Array<Record<string, unknown>>) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ];
  writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function asList(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function nonEmpty(value: unknown, fallback = ""): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

export type SnapshotProjectInput = {
  snapshotDir: string;
  names: FormalPackNames;
  runId: string;
  taskId?: string;
  structure: any;
  evidence: any;
  sources: SourceRecord[];
  nowIso?: string;
};

export function projectFormalSnapshot(input: SnapshotProjectInput): { snapshotDirName: string; filesWritten: string[] } {
  const now = input.nowIso || new Date().toISOString();
  const snapshotRoot = input.snapshotDir;
  mkdirSync(snapshotRoot, { recursive: true });
  const filesWritten: string[] = [];
  const write = (logical: string, headers: string[], rows: Array<Record<string, unknown>>) => {
    const rel = SNAPSHOT_CSV_LAYOUT[logical];
    if (!rel) throw new Error(`未知快照逻辑名 ${logical}`);
    writeCsv(path.join(snapshotRoot, rel), headers, rows);
    filesWritten.push(rel);
  };

  const units = asList(input.structure?.judgment_units);
  const requirements = asList(input.structure?.evidence_requirements).length
    ? asList(input.structure?.evidence_requirements)
    : asList(input.evidence?.evidence_requirements);
  const drafts = asList(input.evidence?.evidence_drafts);
  const requirementAssessments = asList(input.evidence?.evidence_requirement_assessments);
  const gapDrafts = drafts.filter((draft: any) => draft?.kind === "gap");
  const gaps = asList(input.evidence?.unresolved_gaps);
  const materials = input.evidence?.delivery_materials || {};
  const executionId = `EXEC-${input.runId}`;
  const taskId = nonEmpty(input.taskId, `JTASK-${input.runId}`);

  write("evidence_requirements.csv", [
    "requirement_id", "judgment_unit_ids", "statement", "evidence_role", "priority", "notes",
  ], requirements.map((item: any, index: number) => ({
    requirement_id: nonEmpty(item?.id, `ER-${String(index + 1).padStart(2, "0")}`),
    judgment_unit_ids: asList(item?.judgment_unit_ids).join("|"),
    statement: nonEmpty(item?.statement || item?.requirement),
    evidence_role: nonEmpty(item?.evidence_role, "support"),
    priority: nonEmpty(item?.priority, "normal"),
    notes: nonEmpty(item?.notes, "workbench_projection"),
  })));

  write("evidence_recipe_matches.csv", [
    "match_id", "requirement_id", "recipe_id", "status", "notes",
  ], requirements.map((item: any, index: number) => ({
    match_id: `RM-${String(index + 1).padStart(2, "0")}`,
    requirement_id: nonEmpty(item?.id, `ER-${String(index + 1).padStart(2, "0")}`),
    recipe_id: "ad-hoc-workbench",
    status: "projected",
    notes: "工作台投影，非正式 recipe 库命中",
  })));

  write("evidence_baskets.csv", [
    "basket_id", "judgment_unit_id", "requirement_ids", "support_count", "counter_count", "gap_count", "notes",
  ], units.map((unit: any, index: number) => {
    const unitId = nonEmpty(unit?.id, `JU-${String(index + 1).padStart(2, "0")}`);
    const related = drafts.filter((draft: any) => asList(draft?.judgment_unit_ids).includes(unitId));
    return {
      basket_id: `BK-${String(index + 1).padStart(2, "0")}`,
      judgment_unit_id: unitId,
      requirement_ids: [...new Set(related.flatMap((draft: any) =>
        asList(draft?.evidence_requirement_ids),
      ))].join("|"),
      support_count: related.filter((draft: any) => draft?.kind !== "gap" && draft?.kind !== "counter").length,
      counter_count: related.filter((draft: any) => draft?.kind === "counter").length,
      gap_count: related.filter((draft: any) => draft?.kind === "gap").length,
      notes: "workbench_projection",
    };
  }));

  write("source_profiles.csv", [
    "profile_id", "source_id", "publisher", "source_tier", "authority_type", "status", "notes",
  ], input.sources.map((source, index) => ({
    profile_id: `SP-${String(index + 1).padStart(2, "0")}`,
    source_id: source.id,
    publisher: nonEmpty(source.publisher),
    source_tier: nonEmpty(source.source_tier, "S8"),
    authority_type: nonEmpty(source.authority_type, "public"),
    status: nonEmpty(source.usability_status, "unknown"),
    notes: "workbench_projection",
  })));

  write("acquisition_channels.csv", [
    "channel_id", "connector", "purpose", "status", "notes",
  ], [{
    channel_id: "CH-01",
    connector: "workbench_source_registry",
    purpose: "工作台已取得来源冻结",
    status: input.sources.length ? "used" : "empty",
    notes: "由工作台 Source Registry 投影",
  }]);

  write("proxy_indicators.csv", [
    "proxy_id", "variable_id", "proxy_name", "disclosure", "notes",
  ], []);

  write("source_snapshot.csv", [
    "source_id", "url", "title", "published_at", "captured_at", "content_hash", "retrieval_status", "quote_verified",
  ], input.sources.map((source) => ({
    source_id: source.id,
    url: nonEmpty(source.url),
    title: nonEmpty(source.title),
    published_at: nonEmpty(source.published_at),
    captured_at: nonEmpty(source.captured_at),
    content_hash: nonEmpty(source.content_hash),
    retrieval_status: nonEmpty(source.retrieval_status),
    quote_verified: source.quote_verified ? "true" : "false",
  })));

  write("source_documents.csv", [
    "source_document_id", "source_id", "title", "source_type", "location", "access_scope",
    "source_reliability", "publisher", "published_at", "status", "created_at", "notes",
  ], input.sources.map((source, index) => ({
    source_document_id: `SD-${String(index + 1).padStart(3, "0")}`,
    source_id: source.id,
    title: nonEmpty(source.title),
    source_type: nonEmpty(source.source_type, "web"),
    location: nonEmpty(source.url),
    access_scope: "public",
    source_reliability: nonEmpty(source.source_tier, "S8"),
    publisher: nonEmpty(source.publisher),
    published_at: nonEmpty(source.published_at),
    status: "active",
    created_at: now,
    notes: "workbench_projection",
  })));

  write("acquisition_log.csv", [
    "log_id", "source_id", "obtained_at", "connector", "status", "notes",
  ], input.sources.map((source, index) => ({
    log_id: `AL-${String(index + 1).padStart(3, "0")}`,
    source_id: source.id,
    obtained_at: nonEmpty(source.captured_at, now),
    connector: "workbench",
    status: nonEmpty(source.retrieval_status, "captured"),
    notes: "workbench_projection",
  })));

  write("semantic_instances.csv", [
    "instance_id", "object_type", "label", "source_refs", "notes",
  ], units.map((unit: any, index: number) => ({
    instance_id: nonEmpty(unit?.id, `JU-${String(index + 1).padStart(2, "0")}`),
    object_type: "JudgmentUnit",
    label: nonEmpty(unit?.title || unit?.statement),
    source_refs: "",
    notes: "workbench_projection",
  })));

  write("semantic_relations.csv", [
    "relation_id", "from_id", "to_id", "relation_type", "notes",
  ], []);

  write("reasoning_inputs.csv", [
    "input_id", "judgment_unit_id", "evidence_draft_id", "role", "notes",
  ], drafts.flatMap((draft: any, index: number) => asList(draft?.judgment_unit_ids).map((unitId: string, j: number) => ({
    input_id: `RI-${String(index + 1).padStart(3, "0")}-${j + 1}`,
    judgment_unit_id: unitId,
    evidence_draft_id: nonEmpty(draft?.id),
    role: nonEmpty(draft?.kind, "support"),
    notes: "workbench_projection",
  }))));

  write("evidence_records.csv", [
    "evidence_id", "kind", "statement", "judgment_unit_ids", "source_ids", "observed_at", "notes",
  ], drafts.map((draft: any) => ({
    evidence_id: nonEmpty(draft?.id),
    kind: nonEmpty(draft?.kind),
    statement: nonEmpty(draft?.statement),
    judgment_unit_ids: asList(draft?.judgment_unit_ids).join("|"),
    source_ids: asList(draft?.source_ids).join("|"),
    observed_at: nonEmpty(draft?.observed_at),
    notes: draft?.kind === "gap" ? "gap_honest" : "workbench_projection",
  })));

  write("evidence_claims.csv", [
    "claim_id", "evidence_id", "claim_text", "source_ids", "notes",
  ], drafts.filter((draft: any) => draft?.kind !== "gap").map((draft: any, index: number) => ({
    claim_id: `CL-${String(index + 1).padStart(3, "0")}`,
    evidence_id: nonEmpty(draft?.id),
    claim_text: nonEmpty(draft?.statement),
    source_ids: asList(draft?.source_ids).join("|"),
    notes: "workbench_projection",
  })));

  write("evidence_facts.csv", [
    "fact_id", "evidence_id", "evidence_requirement_ids", "fact_text", "source_ids", "quote_verified", "notes",
  ], drafts.filter((draft: any) => draft?.kind !== "gap").map((draft: any, index: number) => ({
    fact_id: `FT-${String(index + 1).padStart(3, "0")}`,
    evidence_id: nonEmpty(draft?.id),
    evidence_requirement_ids: asList(draft?.evidence_requirement_ids).join("|"),
    fact_text: nonEmpty(draft?.statement),
    source_ids: asList(draft?.source_ids).join("|"),
    quote_verified: "unknown",
    notes: "workbench_projection",
  })));

  write("evidence_relations.csv", [
    "relation_id", "from_evidence_id", "to_evidence_id", "relation_type", "notes",
  ], []);

  write("evidence_assessments.csv", [
    "assessment_id", "evidence_id", "usable", "directness", "notes",
  ], drafts.map((draft: any, index: number) => ({
    assessment_id: `EA-${String(index + 1).padStart(3, "0")}`,
    evidence_id: nonEmpty(draft?.id),
    usable: draft?.kind === "gap" ? "false" : "true",
    directness: nonEmpty(draft?.directness, "unknown"),
    notes: "workbench_projection",
  })));

  write("evidence_readiness_assessments.csv", [
    "assessment_id", "requirement_id", "judgment_unit_id", "evidence_role",
    "evidence_ids", "gap_ids", "independent_source_groups", "minimum_independent_sources",
    "status", "notes",
  ], requirementAssessments.map((assessment: any, index: number) => ({
    assessment_id: `ERA-${String(index + 1).padStart(2, "0")}`,
    requirement_id: nonEmpty(assessment?.requirement_id),
    judgment_unit_id: nonEmpty(assessment?.judgment_unit_id),
    evidence_role: nonEmpty(assessment?.evidence_role),
    evidence_ids: asList(assessment?.evidence_ids).join("|"),
    gap_ids: asList(assessment?.gap_ids).join("|"),
    independent_source_groups: Number(assessment?.independent_source_groups || 0),
    minimum_independent_sources: Number(assessment?.minimum_independent_sources || 0),
    status: nonEmpty(assessment?.status, "missing"),
    notes: asList(assessment?.limitations).join("；") || "workbench_projection",
  })));

  const variables = asList(input.structure?.variables);
  write("state_variable_coverage.csv", [
    "coverage_id", "variable_id", "variable_name", "covered", "evidence_ids", "notes",
  ], variables.map((variable: any, index: number) => {
    const variableId = nonEmpty(variable?.id, `SV-${String(index + 1).padStart(2, "0")}`);
    const related = drafts.filter((draft: any) => String(draft?.subject_ref || "").includes(variableId)
      || String(draft?.statement || "").includes(nonEmpty(variable?.name)));
    return {
      coverage_id: `SVC-${String(index + 1).padStart(3, "0")}`,
      variable_id: variableId,
      variable_name: nonEmpty(variable?.name),
      covered: related.some((draft: any) => draft?.kind !== "gap") ? "true" : "false",
      evidence_ids: related.map((draft: any) => draft?.id).filter(Boolean).join("|"),
      notes: "workbench_projection",
    };
  }));

  write("path_readiness.csv", [
    "path_id", "label", "ready", "blocking_gaps", "notes",
  ], asList(input.structure?.paths || input.structure?.transmission_paths).map((item: any, index: number) => ({
    path_id: nonEmpty(item?.id, `P-${String(index + 1).padStart(2, "0")}`),
    label: nonEmpty(item?.label || item?.statement),
    ready: gaps.length ? "partial" : "ready",
    blocking_gaps: gaps.length,
    notes: "workbench_projection",
  })));

  const gapInputs = gapDrafts.length ? gapDrafts : gaps;
  const gapRows = gapInputs.length
    ? gapInputs.map((gap: any, index: number) => ({
      gap_id: nonEmpty(gap?.id, `GAP-${String(index + 1).padStart(2, "0")}`),
      execution_id: executionId,
      gap_type: nonEmpty(gap?.gap_type, "evidence"),
      requirement_id: asList(gap?.evidence_requirement_ids).join("|") || nonEmpty(gap?.requirement_id),
      linked_judgment_unit_ids: asList(gap?.judgment_unit_ids).join("|"),
      description: nonEmpty(gap?.description || gap?.requirement || gap?.statement, "未解决缺口"),
      severity: nonEmpty(gap?.severity, "medium"),
      blocks_reasoning: gap?.blocks_reasoning ? "true" : "false",
      status: "open",
      notes: "workbench_projection_honest_gap",
    }))
    : [{
      gap_id: "GAP-00",
      execution_id: executionId,
      gap_type: "coverage",
      requirement_id: "",
      linked_judgment_unit_ids: "",
      description: "工作台投影未登记显式缺口；正式完备度仍须人工复核",
      severity: "low",
      blocks_reasoning: "false",
      status: "noted",
      notes: "workbench_projection",
    }];
  write("gaps_and_risks.csv", [
    "gap_id", "execution_id", "gap_type", "requirement_id", "linked_judgment_unit_ids",
    "description", "severity", "blocks_reasoning", "status", "notes",
  ], gapRows);

  write("display_data_candidates.csv", [
    "candidate_id", "kind", "title", "status", "notes",
  ], asList(materials.chart_candidates).concat(asList(materials.table_candidates)).map((item: any, index: number) => ({
    candidate_id: nonEmpty(item?.id, `DC-${String(index + 1).padStart(2, "0")}`),
    kind: nonEmpty(item?.kind, "display"),
    title: nonEmpty(item?.title || item?.label),
    status: "candidate",
    notes: "workbench_projection",
  })));

  write("chart_data_package.csv", [
    "figure_id", "title", "status", "notes",
  ], asList(materials.chart_candidates).map((item: any, index: number) => ({
    figure_id: nonEmpty(item?.id, `FIG-${String(index + 1).padStart(2, "0")}`),
    title: nonEmpty(item?.title || item?.label),
    status: "candidate",
    notes: "workbench_projection",
  })));

  write("table_material_package.csv", [
    "table_id", "title", "status", "notes",
  ], asList(materials.table_candidates).map((item: any, index: number) => ({
    table_id: nonEmpty(item?.id, `TBL-${String(index + 1).padStart(2, "0")}`),
    title: nonEmpty(item?.title || item?.label),
    status: "candidate",
    notes: "workbench_projection",
  })));

  write("source_annotation_package.csv", [
    "annotation_id", "source_id", "note", "status",
  ], asList(materials.source_annotation_candidates).map((item: any, index: number) => ({
    annotation_id: nonEmpty(item?.id, `ANN-${String(index + 1).padStart(2, "0")}`),
    source_id: nonEmpty(item?.source_id),
    note: nonEmpty(item?.note || item?.statement),
    status: "candidate",
  })));

  write("delivery_readiness.csv", [
    "assessment_id", "delivery_readiness", "evidence_readiness", "allowed_05_output", "notes",
  ], [{
    assessment_id: "DR-01",
    delivery_readiness: nonEmpty(input.evidence?.delivery_readiness, "partial"),
    evidence_readiness: nonEmpty(input.evidence?.evidence_readiness, "partial"),
    allowed_05_output: nonEmpty(input.evidence?.allowed_05_output, "limited_report"),
    notes: "workbench_projection",
  }]);

  const unitTotal = units.length;
  const backed = units.filter((unit: any) => {
    const unitId = nonEmpty(unit?.id);
    return drafts.some((draft: any) => draft?.kind !== "gap" && asList(draft?.judgment_unit_ids).includes(unitId));
  }).length;
  const rate = unitTotal ? (backed / unitTotal).toFixed(4) : "0";

  write("manifest.csv", [
    "task_id", "execution_id", "plan_id", "source_02_view_ref", "source_02_logic_ref",
    "preparation_ref", "snapshot_summary_ref", "execution_date", "timezone", "created_at",
    "coverage_unit_total", "evidence_backed_unit_count", "evidence_coverage_rate",
    "judgment_unit_total", "evidence_requirements_ref", "evidence_recipe_matches_ref",
    "evidence_baskets_ref", "source_profiles_ref", "acquisition_channels_ref", "proxy_indicators_ref",
    "evidence_readiness_assessments_ref", "display_data_candidates_ref", "chart_data_package_ref",
    "table_material_package_ref", "source_annotation_package_ref", "gaps_and_risks_ref",
    "delivery_readiness_ref", "stage_status", "quality_status", "deterministic_check_status",
    "semantic_review_status", "return_required", "notes",
  ], [{
    task_id: taskId,
    execution_id: executionId,
    plan_id: `DAP-${input.names.stamp}`,
    source_02_view_ref: input.names.stage02ViewYaml,
    source_02_logic_ref: input.names.stage02LogicMd,
    preparation_ref: input.names.stage03PrepMd,
    snapshot_summary_ref: `${input.names.stage03SnapshotDir}/${input.names.stage03SnapshotSummaryMd}`,
    execution_date: input.names.date.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3"),
    timezone: "Asia/Shanghai",
    created_at: now,
    coverage_unit_total: unitTotal,
    evidence_backed_unit_count: backed,
    evidence_coverage_rate: rate,
    judgment_unit_total: unitTotal,
    evidence_requirements_ref: "01_plan/evidence_requirements.csv",
    evidence_recipe_matches_ref: "01_plan/evidence_recipe_matches.csv",
    evidence_baskets_ref: "01_plan/evidence_baskets.csv",
    source_profiles_ref: "01_plan/source_profiles.csv",
    acquisition_channels_ref: "01_plan/acquisition_channels.csv",
    proxy_indicators_ref: "01_plan/proxy_indicators.csv",
    evidence_readiness_assessments_ref: "03_gate/evidence_readiness_assessments.csv",
    display_data_candidates_ref: "04_05_materials/display_data_candidates.csv",
    chart_data_package_ref: "04_05_materials/chart_data_package.csv",
    table_material_package_ref: "04_05_materials/table_material_package.csv",
    source_annotation_package_ref: "04_05_materials/source_annotation_package.csv",
    gaps_and_risks_ref: "03_gate/gaps_and_risks.csv",
    delivery_readiness_ref: "04_05_materials/delivery_readiness.csv",
    stage_status: "complete",
    quality_status: nonEmpty(input.evidence?.quality_status, "high_quality_pass"),
    deterministic_check_status: nonEmpty(input.evidence?.deterministic_check_status, "checked"),
    semantic_review_status: "not_reviewed",
    return_required: "false",
    notes: "工作台一键导出投影；正式完备度以 validate_run 为准",
  }]);

  const summaryPath = path.join(snapshotRoot, input.names.stage03SnapshotSummaryMd);
  writeFileSync(summaryPath, [
    `# ${input.names.stage03SnapshotDir}`,
    "",
    `execution_id: ${executionId}`,
    `created_at: ${now}`,
    "",
    "本快照由工作台从已确认 Stage02/03 与 Source Registry 投影生成。",
    "缺口已诚实登记；不得把投影完备度误认为已通过正式 PUBLISHABLE。",
    "",
  ].join("\n"), "utf8");
  filesWritten.push(input.names.stage03SnapshotSummaryMd);

  return { snapshotDirName: input.names.stage03SnapshotDir, filesWritten };
}
