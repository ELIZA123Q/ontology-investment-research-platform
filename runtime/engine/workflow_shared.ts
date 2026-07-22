import "server-only";
import { createHash } from "node:crypto";
import {
  approveArtifact,
  createArtifact,
  getArtifact,
  getRun,
  latestArtifact,
  listWorkItems,
  listSources,
  normalizeUrl,
  quarantineUnboundWebCitations,
  saveInstanceGraph,
  supersedeDownstream,
  supersedeOtherArtifactAttempts,
  updateArtifact,
  updateArtifactIfStatus,
  upsertSource,
  withImmediateTransaction,
} from "../adapters/db";
import { loadKnowledge } from "./knowledge";
import { createResearchModelClient } from "../adapters/deepseek";
import { promptFor, PROMPT_VERSION } from "./prompts";
import { schemas, type SchemaKind } from "./schemas";
import {
  normalizeCompetingExplanations,
  normalizeCounterEvidenceDirections,
  projectEvidenceRequirementsFromStructure,
} from "./structure_candidates";
import { ontologyContextForPrompt } from "./ontology_tools";
import { emptyGraph, loadDomainBusinessGraph, loadGraphForRun, markReachableDownstreamStale, materializeStageIntoGraph } from "./instance_graph";
import {
  validateExpressionMethodBindings,
  validateJudgmentCapabilityCoverage,
  validateJudgmentMethodBindings,
  validateMethodApplications,
} from "./method_application";
import {
  defaultMethodIdsForJudgmentType,
  loadMethodRegistry,
  recallRegisteredMethodCandidates,
  registeredMethodCandidates,
  validateMethodRoutes,
  validateRegisteredMethodApplications,
} from "./method_registry";
import { parseJson, STAGES, type Artifact, type ArtifactKind, type MethodApplication, type SourceRecord, type StageKind } from "./types";
import { validateReasoningTraceBindings } from "./reasoning_trace";
import { changeSetSchema, mergeChangeSet, type ChangeSet } from "./change_set";
import { captureSourceSnapshot } from "./source_snapshot";
import { applyDeterministicRuleEvaluations, assertDeterministicRuleResults } from "./semantic_execution";
import { evidenceBoundSourceIds, evidenceBoundSources } from "./evidence_sources";
import { syncReviewWorkItems } from "./review_work_items";
import { classifyRuntimeFailure, compactStructuredArtifact } from "./workflow_support";
import {
  syncStage01ReadableMarkdown,
  syncStage02ReadableMarkdown,
  syncStage03ReadableMarkdown,
  syncStage04ReadableMarkdown,
  syncStage05ReadableMarkdown,
} from "./readable_markdown";

export function stageNumber(kind: ArtifactKind) {
  return kind.startsWith("stage_") ? Number(kind.slice(-2)) : 0;
}

export function equivalentSourceTime(left: unknown, right: unknown) {
  const leftValue = String(left || "");
  const rightValue = String(right || "");
  if (leftValue === rightValue) return true;
  const leftTime = Date.parse(leftValue);
  const rightTime = Date.parse(rightValue);
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime === rightTime;
}

export function sameStringSet(left: unknown[], right: unknown[]) {
  const leftSet = new Set(left.map(String));
  const rightSet = new Set(right.map(String));
  return leftSet.size === rightSet.size && [...leftSet].every((value) => rightSet.has(value));
}

export function validateOntologyVariableBindings(variables: any[]) {
  const stateVariables = new Set(
    (loadDomainBusinessGraph()?.objects || [])
      .filter((object) => object.type === "StateVariable")
      .map((object) => object.id),
  );
  for (const variable of variables || []) {
    const variableId = String(variable?.id || "");
    const nodeId = String(variable?.ontology_node_id || "");
    if (nodeId === `task_local:${variableId}`) continue;
    if (!stateVariables.has(nodeId)) {
      throw new Error(`${variableId}.ontology_node_id=${nodeId} 既不是正式 StateVariable，也不是 task_local:${variableId}；禁止为满足结构而牵强挂靠本体`);
    }
  }
}

export function validateGeneratedSemanticDraft(runId: string, kind: ArtifactKind, data: any) {
  if (kind === "stage_02") {
    validateMethodApplications("stage_02", data.method_applications || []);
    validateRegisteredMethodApplications(data.method_applications || []);
    validateMethodRoutes(data.method_applications || [], data.judgment_units || []);
    validateJudgmentCapabilityCoverage(data.method_applications || [], data.judgment_units || []);
    validateOntologyVariableBindings(data.variables || []);
    return;
  }
  if (kind === "stage_03") {
    const structure: any = parseJson(latestArtifact(runId, "stage_02", ["approved"])?.json_content || "{}", {});
    const evidenceIds = new Set<string>((data.evidence_drafts || []).map((item: any) => String(item.id)));
    validateMethodApplications("stage_03", data.method_applications || [], {
      prior: structure.method_applications || [],
      evidenceIds,
    });
    validateRegisteredMethodApplications(data.method_applications || []);
    validateMethodRoutes(data.method_applications || [], structure.judgment_units || []);
    validateJudgmentCapabilityCoverage(data.method_applications || [], structure.judgment_units || []);
    for (const application of data.method_applications || []) {
      if (application.capability_type === "evidence" && application.status === "candidate") {
        throw new Error(`${application.application_id} 取证 MA 在 stage_03 必须收敛，不能仍为 candidate`);
      }
    }
    return;
  }
  if (kind === "stage_04") {
    const evidence: any = parseJson(latestArtifact(runId, "stage_03", ["approved"])?.json_content || "{}", {});
    const structure: any = parseJson(latestArtifact(runId, "stage_02", ["approved"])?.json_content || "{}", {});
    const evidenceIds = new Set<string>((evidence.evidence_drafts || []).map((item: any) => String(item.id)));
    const judgmentIds = new Set<string>((data.judgments || []).map((item: any) => String(item.id)));
    const signalIds = new Set<string>((data.signals || []).map((item: any) => String(item.id)));
    const sourceGroupById = new Map(listSources(runId).map((source) => [source.id, source.source_group || source.publisher || source.normalized_url]));
    validateMethodApplications("stage_04", data.method_applications || [], {
      prior: evidence.method_applications || [],
      evidenceIds,
      judgmentIds,
      signalIds,
      evidenceDrafts: evidence.evidence_drafts || [],
      sourceGroupById,
    });
    validateRegisteredMethodApplications(data.method_applications || []);
    validateMethodRoutes(data.method_applications || [], structure.judgment_units || []);
    validateJudgmentCapabilityCoverage(data.method_applications || [], structure.judgment_units || []);
    validateJudgmentMethodBindings(data.judgments || [], data.method_applications || []);
    validateReasoningTraceBindings(data, evidenceIds, data.method_applications || []);
  }
}

export function validateApproval(artifact: Artifact) {
  const schema = schemas[artifact.kind as SchemaKind];
  if (schema) schema.parse(parseJson(artifact.json_content, {}));
  const data: any = parseJson(artifact.json_content, {});
  if (artifact.kind === "stage_02") {
    validateMethodApplications("stage_02", data.method_applications as MethodApplication[]);
    validateRegisteredMethodApplications(data.method_applications as MethodApplication[]);
    validateMethodRoutes(data.method_applications as MethodApplication[], data.judgment_units || []);
    validateJudgmentCapabilityCoverage(data.method_applications as MethodApplication[], data.judgment_units || []);
    validateOntologyVariableBindings(data.variables || []);
  }
  if (artifact.kind === "stage_03") {
    const structure: any = parseJson(latestArtifact(artifact.run_id, "stage_02", ["approved"])?.json_content || "{}", {});
    const evidenceIds = new Set<string>((data.evidence_drafts || []).map((item: any) => String(item.id)));
    const judgmentUnitIds = new Set<string>((structure.judgment_units || []).map((item: any) => String(item.id)));
    validateMethodApplications("stage_03", data.method_applications as MethodApplication[], {
      prior: structure.method_applications || [],
      evidenceIds,
    });
    validateRegisteredMethodApplications(data.method_applications as MethodApplication[]);
    validateMethodRoutes(data.method_applications as MethodApplication[], structure.judgment_units || []);
    validateJudgmentCapabilityCoverage(data.method_applications as MethodApplication[], structure.judgment_units || []);
    for (const application of data.method_applications as MethodApplication[]) {
      if (application.capability_type === "evidence" && application.status === "candidate") {
        throw new Error(`${application.application_id} 取证 MA 在 stage_03 必须收敛为 selected/degraded/blocked/rejected，不得仍为 candidate`);
      }
    }
    const referencedEvidenceIds = new Set<string>(
      (data.method_applications || []).flatMap((item: MethodApplication) => item.input_evidence_refs),
    );
    for (const application of data.method_applications as MethodApplication[]) {
      for (const ref of application.target_judgment_unit_refs) {
        if (!judgmentUnitIds.has(ref)) throw new Error(`${application.application_id} 引用了不存在的判断单元 ${ref}`);
      }
      if (application.capability_type === "evidence" && application.status === "selected" && !application.input_evidence_refs.length) {
        throw new Error(`${application.application_id} selected 取证方法必须绑定至少一项证据草稿`);
      }
    }
    const sourceRecords = listSources(artifact.run_id);
    const known = new Map(sourceRecords.map((s) => [s.id, s]));
    const sourceByKey = new Map<string, any>();
    const seenSourceIds = new Set<string>();
    for (const source of data.sources || []) {
      const key = String(source.source_key || "");
      const sourceId = String(source.source_id || "");
      if (!key || sourceByKey.has(key)) throw new Error(`stage_03 来源 source_key 为空或重复: ${key || "<empty>"}`);
      if (!sourceId || seenSourceIds.has(sourceId)) throw new Error(`${key} 缺少唯一 source_id`);
      const record = known.get(sourceId);
      if (!record) throw new Error(`${key} 未绑定当前运行 Source Registry`);
      let normalized = "";
      try { normalized = normalizeUrl(source.url); } catch { throw new Error(`${key} URL 非法`); }
      const mismatches = [
        normalized !== record.normalized_url ? "url" : "",
        String(source.content_hash || "") !== String(record.content_hash || "") ? "content_hash" : "",
        String(source.locator || "") !== String(record.locator || "") ? "locator" : "",
        String(source.source_quote || "") !== String(record.source_quote || "") ? "source_quote" : "",
        String(source.captured_at || "") !== String(record.captured_at || "") ? "captured_at" : "",
        String(source.final_url || "") !== String(record.final_url || "") ? "final_url" : "",
        String(source.retrieval_status || "") !== String(record.retrieval_status || "") ? "retrieval_status" : "",
        Boolean(source.quote_verified) !== Boolean(record.quote_verified) ? "quote_verified" : "",
        String(source.source_tier || "S8") !== String(record.source_tier || "S8") ? "source_tier" : "",
        !equivalentSourceTime(source.published_at, record.published_at) ? "published_at" : "",
      ].filter(Boolean);
      if (mismatches.length) throw new Error(`${key} 与 Source Registry 不一致: ${mismatches.join(", ")}`);
      sourceByKey.set(key, source);
      seenSourceIds.add(sourceId);
    }
    for (const evidence of data.evidence_drafts || []) {
      for (const ref of evidence.judgment_unit_ids || []) {
        if (!judgmentUnitIds.has(ref)) throw new Error(`${evidence.id} 引用了不存在的判断单元 ${ref}`);
      }
      if (evidence.kind !== "gap" && (!evidence.source_ids?.length || evidence.source_ids.some((id: string) => !known.has(id)))) {
        throw new Error(`${evidence.id} 缺少有效来源，不能确认`);
      }
      if (evidence.kind !== "gap") {
        const expectedSourceIds = (evidence.source_keys || []).map((key: string) => sourceByKey.get(String(key))?.source_id).filter(Boolean);
        if (expectedSourceIds.length !== (evidence.source_keys || []).length
          || !sameStringSet(expectedSourceIds, evidence.source_ids || [])) {
          throw new Error(`${evidence.id} 的 source_keys/source_ids 与冻结来源表不一致`);
        }
      }
      const boundSources = ((evidence.source_ids || []).map((id: string) => known.get(id)) as Array<SourceRecord | undefined>)
        .filter((source): source is SourceRecord => Boolean(source));
      if (evidence.kind !== "gap" && boundSources.some((source) => source.usability_status === "candidate" || source.usability_status === "rejected")) {
        throw new Error(`${evidence.id} 引用了尚未通过正文抓取和定位校验的来源`);
      }
      if (evidence.kind !== "gap" && boundSources.some((source) => source.usability_status === "limited") && !(evidence.limitations || []).length) {
        throw new Error(`${evidence.id} 使用受限来源时必须披露 limitations`);
      }
      if (!referencedEvidenceIds.has(evidence.id)) {
        throw new Error(`${evidence.id} 未绑定任何 MethodApplication，不能确认`);
      }
    }
  }
  if (artifact.kind === "stage_04") {
    const upstream: any = parseJson(latestArtifact(artifact.run_id, "stage_03", ["approved"])?.json_content || "{}", {});
    const structure: any = parseJson(latestArtifact(artifact.run_id, "stage_02", ["approved"])?.json_content || "{}", {});
    const ids = new Set<string>((upstream.evidence_drafts || []).map((x: any) => String(x.id)));
    const judgmentIds = new Set<string>((data.judgments || []).map((item: any) => String(item.id)));
    const signalIds = new Set<string>((data.signals || []).map((item: any) => String(item.id)));
    const sourceGroupById = new Map(listSources(artifact.run_id).map((source) => [source.id, source.source_group || source.publisher || source.normalized_url]));
    validateMethodApplications("stage_04", data.method_applications as MethodApplication[], {
      prior: upstream.method_applications || [],
      evidenceIds: ids,
      judgmentIds,
      signalIds,
      evidenceDrafts: upstream.evidence_drafts || [],
      sourceGroupById,
    });
    validateRegisteredMethodApplications(data.method_applications as MethodApplication[]);
    validateMethodRoutes(data.method_applications as MethodApplication[], structure.judgment_units || []);
    validateJudgmentCapabilityCoverage(data.method_applications as MethodApplication[], structure.judgment_units || []);
    validateJudgmentMethodBindings(data.judgments || [], data.method_applications || []);
    validateReasoningTraceBindings(data, ids, data.method_applications || []);
    assertDeterministicRuleResults(data);
    for (const j of data.judgments || []) {
      for (const id of [...j.supporting_evidence_draft_ids, ...j.counter_evidence_draft_ids]) {
        if (!ids.has(id)) throw new Error(`${j.id} 引用了不存在的证据草稿 ${id}`);
      }
    }
  }
  if (artifact.kind === "stage_05") {
    const upstream: any = parseJson(latestArtifact(artifact.run_id, "stage_04", ["approved"])?.json_content || "{}", {});
    const evidenceStage: any = parseJson(latestArtifact(artifact.run_id, "stage_03", ["approved"])?.json_content || "{}", {});
    const ids = new Set((upstream.judgments || []).map((x: any) => x.id));
    const sourceIds = evidenceBoundSourceIds(evidenceStage);
    validateExpressionMethodBindings(data.report_claims || [], upstream.method_applications || [], upstream.judgments || []);
    const judgmentById = new Map((upstream.judgments || []).map((item: any) => [String(item.id), item]));
    const evidenceById = new Map((evidenceStage.evidence_drafts || []).map((item: any) => [String(item.id), item]));
    for (const c of data.report_claims || []) {
      for (const id of c.judgment_ids) if (!ids.has(id)) throw new Error(`${c.id} 引用了不存在的判断 ${id}`);
      for (const id of c.source_ids) if (!sourceIds.has(id)) throw new Error(`${c.id} 引用了不存在的来源 ${id}`);
      const judgments = (c.judgment_ids || []).map((id: string) => judgmentById.get(String(id))).filter(Boolean) as any[];
      const allowedEvidence = new Set(judgments.flatMap((item) => [
        ...(item.supporting_evidence_draft_ids || []), ...(item.counter_evidence_draft_ids || []),
      ]).map(String));
      const claimEvidence = (c.evidence_draft_ids || []).map(String);
      const onlyJ0Stops = judgments.length > 0 && judgments.every((item) => item.strength === "J0"
        && ["blocked", "indeterminate", "contested"].includes(String(item.decision_status)));
      if (!claimEvidence.length && !onlyJ0Stops) throw new Error(`${c.id} 缺少事实级 evidence_draft_ids 追溯`);
      for (const id of claimEvidence) if (!allowedEvidence.has(id) || !evidenceById.has(id)) throw new Error(`${c.id} 引用了来源 Judgment 未使用的证据 ${id}`);
      const expectedSources = claimEvidence.flatMap((id: string) => (evidenceById.get(id) as any)?.source_ids || []).map(String);
      if (!sameStringSet(expectedSources, c.source_ids || [])) throw new Error(`${c.id}.source_ids 必须由 evidence_draft_ids 唯一派生`);
    }
  }
  if (artifact.kind === "baseline") {
    const current = latestArtifact(artifact.run_id, "stage_03", ["approved"]);
    if (!current) throw new Error("基线失去已确认的冻结证据包");
    const expectedHash = createHash("sha256").update(current.json_content).digest("hex");
    if (data.frozen_stage03_artifact_id !== current.id || data.frozen_stage03_artifact_hash !== expectedHash) {
      throw new Error("同证据基线与当前 stage_03 冻结证据不一致");
    }
    const currentData = parseJson<any>(current.json_content, {});
    const boundIds = evidenceBoundSourceIds(currentData);
    const frozenByKey = new Map(
      (currentData.sources || [])
        .filter((source: any) => boundIds.has(String(source.source_id || "")))
        .map((source: any) => [String(source.source_key), source]),
    );
    for (const claim of data.core_claims || []) {
      for (const key of claim.source_keys || []) if (!frozenByKey.has(String(key))) throw new Error(`${claim.id} 引用了冻结证据外的来源 ${key}`);
    }
    for (const source of data.sources || []) {
      const frozen = frozenByKey.get(String(source.source_key || ""));
      if (!frozen || normalizeUrl(source.url) !== normalizeUrl((frozen as any).url)) {
        throw new Error(`同证据基线携带了冻结证据外的来源 ${source.source_key || source.url}`);
      }
    }
  }
  if (artifact.kind === "independent_review") {
    const current = latestArtifact(artifact.run_id, "stage_04", ["approved"]);
    if (!current) throw new Error("独立审阅失去已确认的 stage_04");
    const expectedHash = createHash("sha256").update(current.json_content).digest("hex");
    if (data.reviewed_stage04_artifact_id !== current.id || data.reviewed_stage04_artifact_hash !== expectedHash) {
      throw new Error("独立审阅不对应当前 stage_04 内容");
    }
    if (!artifact.model_name || data.reviewer_model !== artifact.model_name || data.producer_model !== current.model_name) {
      throw new Error("独立审阅的生产/审阅模型身份与实际产物不符");
    }
    const independentModel = data.independence_level === "independent_model"
      && data.reviewer_type === "model"
      && data.reviewer_model !== data.producer_model;
    const independentHuman = data.independence_level === "independent_human"
      && data.reviewer_type === "human"
      && String(data.reviewer_model || "").startsWith("human:")
      && data.reviewer_model !== data.producer_model
      && String(data.reviewer_attestation || "").trim().length >= 20;
    if (!independentModel && !independentHuman) {
      throw new Error("独立审阅必须由不同模型完成，或由留下独立性声明的非生产人类审阅者完成");
    }
    if ((data.verdict === "pass" && data.issues.length) || (data.verdict === "rework" && !data.issues.length)) {
      throw new Error("独立审阅 verdict 与 issues 不一致");
    }
  }
}

export function methodCandidatesForPrompt(kind: ArtifactKind, upstream: Array<{ json: any }>, taskText = "") {
  if (kind === "stage_02") return taskText.trim()
    ? recallRegisteredMethodCandidates(taskText)
    : registeredMethodCandidates();
  if (kind !== "stage_03" && kind !== "stage_04") return [];
  const inheritedMethodIds = new Set<string>(
    upstream.flatMap((item) => (item.json?.method_applications || []).map((application: any) => String(application.method_id))),
  );
  return registeredMethodCandidates().filter((method) => inheritedMethodIds.has(method.method_id));
}

export function sourcesForPrompt(kind: ArtifactKind, sources: SourceRecord[], cutoffAt?: string | null) {
  if (kind !== "stage_03") return [];
  const normalizedCutoff = normalizeBusinessCutoff(cutoffAt);
  const cutoff = normalizedCutoff ? Date.parse(normalizedCutoff) : null;
  return sources.filter((source) => source.usability_status !== "rejected"
    && (cutoff === null || !source.published_at || !Number.isFinite(Date.parse(source.published_at)) || Date.parse(source.published_at) <= cutoff));
}

export function sourceForFrozenBaseline(source: SourceRecord) {
  return { ...source, snapshot_text: source.source_quote || "" };
}

export function normalizeBusinessCutoff(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const date = raw.match(/(20\d{2})[-/]([01]?\d)[-/]([0-3]?\d)/)
    || raw.match(/(20\d{2})年([01]?\d)月([0-3]?\d)日/);
  if (date) {
    const [, year, month, day] = date;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T23:59:59.999+08:00`;
  }
  const half = raw.match(/(20\d{2})年(上|下)半年/);
  if (half) return `${half[1]}-${half[2] === "上" ? "06-30" : "12-31"}T23:59:59.999+08:00`;
  const quarter = raw.match(/(20\d{2})年?第?([一二三四1-4])季度|(?:^|\D)(20\d{2})Q([1-4])/i);
  if (quarter) {
    const year = quarter[1] || quarter[3];
    const token = quarter[2] || quarter[4];
    const index = ({ 一: 1, 二: 2, 三: 3, 四: 4 } as Record<string, number>)[token] || Number(token);
    const ends = ["03-31", "06-30", "09-30", "12-31"];
    return `${year}-${ends[index - 1]}T23:59:59.999+08:00`;
  }
  const monthOnly = raw.match(/(20\d{2})年([01]?\d)月(?![0-3]?\d日)/);
  if (monthOnly) {
    const year = Number(monthOnly[1]);
    const month = Number(monthOnly[2]);
    if (month >= 1 && month <= 12) {
      const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T23:59:59.999+08:00`;
    }
  }
  return Number.isFinite(Date.parse(raw)) ? new Date(raw).toISOString() : null;
}

export function syncReadableMarkdownForArtifact(artifact: { id: string; run_id: string; kind: string }, data: any): string {
  const run = getRun(artifact.run_id);
  if (artifact.kind === "stage_01") return syncStage01ReadableMarkdown(data, run?.question || "");
  if (artifact.kind === "stage_02") return syncStage02ReadableMarkdown(data);
  if (artifact.kind === "stage_03") return syncStage03ReadableMarkdown(data);
  if (artifact.kind === "stage_04") return syncStage04ReadableMarkdown(data);
  if (artifact.kind === "stage_05") return syncStage05ReadableMarkdown(data, run?.question || "", listSources(artifact.run_id));
  return String(data.document_markdown || "");
}

export function editArtifact(
  id: string,
  jsonContent: string,
  markdownContent?: string,
  options?: { preferMarkdown?: boolean },
) {
  const artifact = getArtifact(id);
  if (!artifact) throw new Error("稿件不存在");
  let data: any;
  try {
    data = JSON.parse(jsonContent);
  } catch {
    throw new Error("结构化内容不是合法 JSON，无法保存");
  }
  if (artifact.kind === "stage_02") {
    const unitIds = (data.judgment_units || []).map((unit: any) => String(unit.id || "")).filter(Boolean);
    data.competing_explanations = normalizeCompetingExplanations(data.competing_explanations, { unitIds });
    data.counter_evidence_directions = normalizeCounterEvidenceDirections(data.counter_evidence_directions, { unitIds });
    data.evidence_requirements = projectEvidenceRequirementsFromStructure({
      units: data.judgment_units || [],
      counter_evidence_directions: data.counter_evidence_directions,
    });
    if (!Array.isArray(data.questions) || !data.questions.length) {
      const statement = String(data.research_scope?.dimensions?.question || data.research_scope?.label || "").trim();
      if (statement) {
        data.questions = [{
          id: "RQ-01",
          question: statement,
          statement,
          scope_ref: String(data.research_scope?.id || "SCOPE-UNRESOLVED"),
          failure_route: "return_to_structure",
        }];
      }
    } else {
      data.questions = data.questions.map((item: any, index: number) => {
        const statement = String(item.question || item.statement || "").trim();
        return {
          id: String(item.id || item.question_id || `RQ-${String(index + 1).padStart(2, "0")}`),
          question: statement,
          statement,
          scope_ref: String(item.scope_ref || data.research_scope?.id || "SCOPE-UNRESOLVED"),
          failure_route: item.failure_route || "return_to_structure",
        };
      });
    }
  }
  const schema = schemas[artifact.kind as SchemaKind];
  const syncedKinds = new Set(["stage_01", "stage_02", "stage_03", "stage_04", "stage_05"]);
  const preferMarkdown = Boolean(options?.preferMarkdown) && artifact.kind === "stage_05" && typeof markdownContent === "string";
  const markdown = preferMarkdown
    ? markdownContent!
    : syncedKinds.has(artifact.kind)
      ? syncReadableMarkdownForArtifact(artifact, data)
      : (markdownContent ?? String(data.document_markdown || ""));
  if (syncedKinds.has(artifact.kind) || preferMarkdown) data.document_markdown = markdown;
  if (schema) schema.parse(data);
  const nextJson = JSON.stringify(data, null, 2);

  const stage = stageNumber(artifact.kind);
  if (stage) supersedeDownstream(artifact.run_id, stage);
  if (artifact.status === "approved" || artifact.status === "superseded") {
    const next = createArtifact(artifact.run_id, artifact.kind, {
      status: "needs_review",
      json_content: nextJson,
      markdown_content: markdown,
      model_name: artifact.model_name,
      prompt_version: artifact.prompt_version,
      knowledge_version: artifact.knowledge_version,
      input_context: artifact.input_context,
      raw_model_output: artifact.raw_model_output,
      response_id: artifact.response_id,
      token_usage: artifact.token_usage,
      tool_usage: artifact.tool_usage,
    });
    if (["stage_03", "stage_04", "independent_review"].includes(next.kind)) syncReviewWorkItems(next, data);
    return next;
  }
  return updateArtifact(id, {
    json_content: nextJson,
    markdown_content: markdown,
    status: "needs_review",
    approved_at: null,
  });
}
