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
import { ResearchModelClient } from "../adapters/deepseek";
import { promptFor, PROMPT_VERSION } from "./prompts";
import { schemas, type SchemaKind } from "./schemas";
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

export {
  classifyRuntimeFailure,
  compactStructuredArtifact,
  type RuntimeFailureCategory,
} from "./workflow_support";

function stageNumber(kind: ArtifactKind) {
  return kind.startsWith("stage_") ? Number(kind.slice(-2)) : 0;
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

function validateGeneratedSemanticDraft(runId: string, kind: ArtifactKind, data: any) {
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

export function normalizeStage01Projection(data: any, question: string) {
  const cutoff = normalizeBusinessCutoff(data?.time_scope?.as_of || question);
  if (cutoff && data?.time_scope) data.time_scope.as_of = cutoff;
  const bullets = (values: unknown[]) => values.length ? values.map((value) => `- ${String(value)}`) : ["- 无"];
  data.document_markdown = [
    "# 研究任务定义",
    "",
    "## 原始问题",
    "",
    question,
    "",
    "## 规范化问题",
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
    `- 交付类型：${String(data.report_type || "")}`,
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
  return data;
}

type ControlledScopeInput = {
  normalized_question?: string;
  core_object?: string;
  judgment_action?: string;
  lookback?: string;
  as_of?: string;
  forward?: string;
  boundaries?: string[];
  exclusions?: string[];
  report_type?: string;
};

export function createStage01DeterministicProjection(runId: string, input: ControlledScopeInput = {}) {
  const run = getRun(runId);
  if (!run) throw new Error("研究任务不存在");
  const sourceArtifact = latestArtifact(runId, "stage_01", ["approved", "needs_review"]);
  const previous = sourceArtifact ? parseJson<any>(sourceArtifact.json_content, {}) : {};
  const cutoff = normalizeBusinessCutoff(input.as_of || previous.time_scope?.as_of || run.question);
  if (!cutoff) throw new Error("缺少可解析的研究截止日期；请明确到日、月、季度或半年");
  const pick = (value: unknown, fallback: unknown) => String(value || fallback || "").trim();
  const draft = {
    normalized_question: pick(input.normalized_question, previous.normalized_question || run.question),
    core_object: pick(input.core_object, previous.core_object),
    judgment_action: pick(input.judgment_action, previous.judgment_action),
    time_scope: {
      lookback: pick(input.lookback, previous.time_scope?.lookback),
      as_of: cutoff,
      forward: pick(input.forward, previous.time_scope?.forward),
    },
    boundaries: input.boundaries?.map(String).map((item) => item.trim()).filter(Boolean) ?? previous.boundaries ?? [],
    exclusions: input.exclusions?.map(String).map((item) => item.trim()).filter(Boolean) ?? previous.exclusions ?? [],
    report_type: pick(input.report_type, previous.report_type || "可审计研究判断简报"),
    domain_supported: run.domain === "semiconductor",
    document_markdown: "placeholder",
  };
  if (!sourceArtifact && (!draft.core_object || !draft.judgment_action || !draft.time_scope.lookback || !draft.time_scope.forward)) {
    throw new Error("空白运行必须显式填写核心对象、判断动作、回看期和前瞻期；不得用泛化占位语冻结范围");
  }
  if (draft.boundaries.length < 2 || !draft.exclusions.length) throw new Error("受控范围至少需要两条边界和一条排除项");
  const data = normalizeStage01Projection(draft, run.question);
  schemas.stage_01.parse(data);
  if (sourceArtifact) return editArtifact(sourceArtifact.id, JSON.stringify(data, null, 2), data.document_markdown);
  return createArtifact(runId, "stage_01", {
    status: "needs_review",
    prompt_version: `${PROMPT_VERSION}:runtime-deterministic-scope-v1`,
    knowledge_version: "runtime-deterministic-scope-v1",
    input_context: JSON.stringify({ question: run.question, parsed_cutoff: cutoff, controlled_scope_input: input }, null, 2),
    json_content: JSON.stringify(data, null, 2),
    markdown_content: data.document_markdown,
    model_name: "runtime-deterministic-scope-projection",
    tool_usage: JSON.stringify({ deterministic_projection: true }),
  });
}

type ControlledStructureUnitInput = {
  id?: string;
  title: string;
  question: string;
  judgment_type: string;
  evidence_requirements: string[];
};
type ControlledStructureInput = {
  scope_label: string;
  scope_dimensions?: Record<string, unknown>;
  units: ControlledStructureUnitInput[];
  counter_evidence_directions?: string[];
  competing_explanations?: string[];
};

export function createControlledStructureProjection(runId: string, raw: ControlledStructureInput) {
  const run = getRun(runId);
  if (!run) throw new Error("研究任务不存在");
  if (!latestArtifact(runId, "stage_01", ["approved"])) throw new Error("请先确认阶段 01");
  if (latestArtifact(runId, "stage_02", ["running"])) throw new Error("请先取消运行中的 Stage 02");
  const input = raw && typeof raw === "object" ? raw : {} as ControlledStructureInput;
  if (!String(input.scope_label || "").trim()) throw new Error("受控研究结构必须填写 scope_label");
  if (!Array.isArray(input.units) || !input.units.length) throw new Error("受控研究结构至少需要一个 JudgmentUnit");
  const allowedTypes = new Set([
    "state_measurement", "trend_direction", "cycle_phase", "mechanism_validation", "causal_attribution",
    "transmission_path", "object_differentiation", "impact_realization", "expectation_gap", "valuation_impact",
  ]);
  const seen = new Set<string>();
  const units = input.units.map((unit, index) => {
    const id = String(unit.id || `JU-CONTROLLED-${String(index + 1).padStart(2, "0")}`).trim();
    if (!id || seen.has(id)) throw new Error(`JudgmentUnit ID 为空或重复: ${id || "<empty>"}`);
    seen.add(id);
    if (!String(unit.title || "").trim() || !String(unit.question || "").trim()) throw new Error(`${id} 缺少标题或原子判断问题`);
    if (!allowedTypes.has(String(unit.judgment_type || ""))) throw new Error(`${id} judgment_type 未登记: ${unit.judgment_type}`);
    const requirements = [...new Set((unit.evidence_requirements || []).map(String).map((item) => item.trim()).filter(Boolean))];
    if (!requirements.length) throw new Error(`${id} 至少需要一条可执行证据要求`);
    return {
      id,
      title: String(unit.title).trim(),
      question: String(unit.question).trim(),
      judgment_type: String(unit.judgment_type),
      scope_ref: "SCOPE-CONTROLLED",
      // No cosmetic ontology binding: task-specific variables stay explicitly
      // local until repeated real runs justify a stable ontology extension.
      ontology_node_ids: [] as string[],
      evidence_requirements: requirements,
    };
  });
  const registry = loadMethodRegistry();
  const methodApplications: MethodApplication[] = units.flatMap((unit, unitIndex) => {
    const defaults = defaultMethodIdsForJudgmentType(unit.judgment_type);
    return (Object.entries(defaults) as Array<["judgment_structure" | "evidence" | "adjudication", string]>).map(([capability, methodId], capabilityIndex) => {
      const registered = registry.get(methodId);
      if (!registered) throw new Error(`${unit.id} 默认方法未登记: ${methodId}`);
      const applicability = Array.isArray(registered.applicability) ? registered.applicability.join("；") : registered.applicability;
      return {
        application_id: `MA-CONTROLLED-${String(unitIndex + 1).padStart(2, "0")}-${String(capabilityIndex + 1).padStart(2, "0")}`,
        method_id: registered.method_id,
        method_version: registered.method_version,
        capability_type: capability,
        target_question_refs: ["Q-CONTROLLED-01"],
        target_judgment_unit_refs: [unit.id],
        target_ontology_object_refs: [],
        status: "candidate" as const,
        precondition_checks: registered.preconditions.map((precondition) => ({
          precondition_id: precondition,
          result: "not_checked" as const,
          evidence_refs: [],
          reason: "Stage02 仅登记候选方法；须在后续阶段以事实级证据核验",
        })),
        input_evidence_refs: [],
        output_signal_refs: [],
        output_judgment_refs: [],
        execution_summary: "",
        applicability_boundary: String(applicability || `用于 ${unit.judgment_type} 判断`),
        limitations: [...registered.not_applicable_when],
        counter_example_refs: [...registered.counter_examples],
        provenance: { stage: "stage_02" as const, source_application_id: null, actor: "human-controlled-structure-projection", recorded_at: null },
        alternatives: registered.alternatives.map((alternative) => ({ method_id: alternative, decision: "not_selected", reason: "保留为前置条件不满足时的替代路线" })),
      };
    });
  });
  const variables = units.map((unit, index) => {
    const id = `V-CONTROLLED-${String(index + 1).padStart(2, "0")}`;
    return {
      id,
      name: unit.title,
      category: "task_specific",
      definition: unit.question,
      variable_kind: "observed_or_adjudicated",
      anchors: [...unit.evidence_requirements],
      ontology_node_id: `task_local:${id}`,
      role: "judgment_input",
    };
  });
  const counterDirections = [...new Set((input.counter_evidence_directions || []).map(String).map((item) => item.trim()).filter(Boolean))];
  const competing = [...new Set((input.competing_explanations || []).map(String).map((item) => item.trim()).filter(Boolean))];
  const data = {
    method_applications: methodApplications,
    research_scope: {
      id: "SCOPE-CONTROLLED",
      label: String(input.scope_label).trim(),
      dimensions: input.scope_dimensions || { question: run.question, domain: run.domain },
    },
    judgment_units: units,
    variables,
    paths: [],
    counter_evidence_directions: counterDirections,
    competing_explanations: competing,
    document_markdown: [
      "# 受控研究结构",
      "",
      `研究范围：${String(input.scope_label).trim()}`,
      "",
      "## 原子判断单元",
      "",
      ...units.map((unit) => `- ${unit.id} · ${unit.title}：${unit.question}；必要证据：${unit.evidence_requirements.join("、")}`),
      "",
      "## 必须主动寻找的反向证据",
      "",
      ...(counterDirections.length ? counterDirections.map((item) => `- ${item}`) : ["- 尚未登记；确认前必须补齐。"]),
      "",
      "## 竞争解释",
      "",
      ...(competing.length ? competing.map((item) => `- ${item}`) : ["- 尚未登记；确认前必须补齐。"]),
      "",
      "本阶段只登记判断结构与候选方法，不宣称任何方法已经执行，也不新增事实。任务特有变量显式使用 task_local，不为满足形式牵强扩充本体。",
    ].join("\n"),
  };
  schemas.stage_02.parse(data);
  validateGeneratedSemanticDraft(runId, "stage_02", data);
  const artifact = createArtifact(runId, "stage_02", {
    status: "needs_review",
    prompt_version: `${PROMPT_VERSION}:human-controlled-structure-projection`,
    knowledge_version: "runtime-controlled-structure-projection-v1",
    input_context: JSON.stringify({ question: run.question, controlled_structure: input }, null, 2),
    json_content: JSON.stringify(data, null, 2),
    markdown_content: data.document_markdown,
    model_name: "human-controlled-structure-projection",
    tool_usage: JSON.stringify({ controlled_projection: true, unit_count: units.length, method_application_count: methodApplications.length }),
  });
  syncReviewWorkItems(artifact, data);
  return artifact;
}

export function buildEvidenceGapFallback(structure: any, reason: string) {
  const gapIdsByUnit = new Map<string, string[]>();
  const evidenceDrafts = (structure.judgment_units || []).flatMap((unit: any, unitIndex: number) => {
    const requirements = unit.evidence_requirements?.length
      ? unit.evidence_requirements
      : [`${unit.title || unit.id} 缺少可核验的直接证据`];
    const gaps = requirements.map((requirement: string, requirementIndex: number) => ({
      id: `GAP-${String(unitIndex + 1).padStart(2, "0")}-${String(requirementIndex + 1).padStart(2, "0")}`,
      statement: `未取得可核验来源：${requirement}`,
      kind: "gap" as const,
      direction: "unknown" as const,
      source_keys: [],
      source_ids: [],
      judgment_unit_ids: [unit.id],
      ontology_node_ids: unit.ontology_node_ids || [],
      requirement,
      evidence_role: "support" as const,
      minimum_independent_sources: 2,
      limitations: ["未取得可定位、可冻结且发布时间不晚于研究截止的公开正文，不能形成 EvidenceFact"],
    }));
    gapIdsByUnit.set(unit.id, gaps.map((gap: any) => gap.id));
    return gaps;
  });
  const applications = (structure.method_applications || []).map((application: MethodApplication) => {
    const gapRefs = [...new Set(application.target_judgment_unit_refs.flatMap((unitId) => gapIdsByUnit.get(unitId) || []))];
    const evidenceCapability = application.capability_type === "evidence";
    return {
      ...application,
      status: evidenceCapability ? "blocked" as const : "candidate" as const,
      precondition_checks: evidenceCapability ? [{
        precondition_id: "public_source_acquisition",
        result: "fail" as const,
        evidence_refs: gapRefs,
        reason,
      }] : application.precondition_checks,
      input_evidence_refs: evidenceCapability ? gapRefs : [],
      output_signal_refs: [],
      output_judgment_refs: [],
      execution_summary: "",
      limitations: evidenceCapability
        ? [...new Set([...(application.limitations || []), "公开来源取得或结构化提交失败；本阶段仅登记证据缺口"])]
        : application.limitations,
      provenance: {
        ...application.provenance,
        stage: "stage_03" as const,
        source_application_id: application.application_id,
        actor: "runtime-gap-fallback",
        recorded_at: null,
      },
      alternatives: evidenceCapability && !application.alternatives.length
        ? [{ method_id: application.method_id, decision: "retry_after_source_acquisition", reason: "取得可核验正文后重试同一登记方法" }]
        : application.alternatives,
    };
  });
  return {
    method_applications: applications,
    sources: [],
    evidence_drafts: evidenceDrafts,
    unresolved_gaps: evidenceDrafts.map((gap: any) => `${gap.id}: ${gap.requirement}`),
    document_markdown: `# 证据准备降级结果\n\n本次未取得可进入正式证据表的公开正文，且结构化生成未完成。系统没有创建事实草稿，而是按已确认判断单元逐项登记 ${evidenceDrafts.length} 个证据缺口。所有取证方法均标记为 blocked，必须由人工逐项接受缺口或补充来源后才能确认。\n\n失败原因：${reason}`,
  };
}

export function createEvidenceGapFallback(runId: string, reason: string) {
  const run = getRun(runId);
  if (!run) throw new Error("研究任务不存在");
  if (latestArtifact(runId, "stage_03", ["running"])) throw new Error("请先取消运行中的 Stage 03");
  const structureArtifact = latestArtifact(runId, "stage_02", ["approved"]);
  if (!structureArtifact) throw new Error("请先确认阶段 02");
  const usableSources = sourcesForPrompt("stage_03", listSources(runId));
  if (usableSources.length) throw new Error("当前已有未驳回来源，不能直接降级为全量证据缺口；请重新运行取证或先审阅来源");
  const structure = parseJson<any>(structureArtifact.json_content, {});
  const data = buildEvidenceGapFallback(structure, reason);
  schemas.stage_03.parse(data);
  validateGeneratedSemanticDraft(runId, "stage_03", data);
  const artifact = createArtifact(runId, "stage_03", {
    status: "needs_review",
    prompt_version: `${PROMPT_VERSION}:explicit-gap-fallback`,
    knowledge_version: "runtime-deterministic-gap-fallback-v1",
    input_context: JSON.stringify({
      question: run.question,
      stage_02_artifact_id: structureArtifact.id,
      stage_02_artifact_hash: createHash("sha256").update(structureArtifact.json_content).digest("hex"),
      usable_source_count: 0,
      fallback_reason: reason,
    }, null, 2),
    json_content: JSON.stringify(data, null, 2),
    markdown_content: data.document_markdown,
    model_name: "runtime-deterministic-gap-fallback",
    tool_usage: JSON.stringify({ degraded: true, failure_category: "model_output_error", reason }),
    error_message: `[model_output_error] ${reason}；已降级为显式证据缺口，尚未确认`,
  });
  syncReviewWorkItems(artifact, data);
  return artifact;
}

type ControlledEvidenceBinding = {
  source_id: string;
  judgment_unit_ids: string[];
  subject_ref: string;
  observed_at: string;
  direction?: "support" | "weaken" | "neutral";
  ontology_node_ids?: string[];
};

export function createControlledEvidenceProjection(runId: string, bindings: ControlledEvidenceBinding[]) {
  const run = getRun(runId);
  if (!run) throw new Error("研究任务不存在");
  if (latestArtifact(runId, "stage_03", ["running"])) throw new Error("请先取消运行中的 Stage 03");
  const taskArtifact = latestArtifact(runId, "stage_01", ["approved"]);
  const structureArtifact = latestArtifact(runId, "stage_02", ["approved"]);
  if (!taskArtifact || !structureArtifact) throw new Error("请先确认阶段 01 和 02");
  if (!Array.isArray(bindings) || !bindings.length) throw new Error("受控证据投影至少需要一条显式来源绑定");

  const task = parseJson<any>(taskArtifact.json_content, {});
  const structure = parseJson<any>(structureArtifact.json_content, {});
  const cutoffAt = normalizeBusinessCutoff(task.time_scope?.as_of);
  if (!cutoffAt) throw new Error("Stage 01 缺少可解析的研究截止时间");
  const cutoffMs = Date.parse(cutoffAt);
  const unitById = new Map<string, any>((structure.judgment_units || []).map((unit: any) => [String(unit.id), unit]));
  const sourceById = new Map(listSources(runId).map((source) => [source.id, source]));
  const duplicateSourceIds = bindings
    .map((binding) => String(binding.source_id))
    .filter((sourceId, index, values) => values.indexOf(sourceId) !== index);
  if (duplicateSourceIds.length) {
    throw new Error(`同一来源只能登记一次；请在一条绑定中选择多个 JudgmentUnit: ${[...new Set(duplicateSourceIds)].join(", ")}`);
  }
  const seenSources = new Set<string>();
  const sources: any[] = [];
  const evidenceDrafts: any[] = [];

  for (const [index, binding] of bindings.entries()) {
    const source = sourceById.get(String(binding.source_id));
    if (!source) throw new Error(`来源不存在: ${binding.source_id}`);
    if (source.usability_status !== "usable" || source.retrieval_status !== "captured" || !source.quote_verified) {
      throw new Error(`来源 ${source.id} 未同时满足 usable/captured/quote_verified`);
    }
    if (!source.source_quote?.trim() || !source.content_hash || !source.captured_at) {
      throw new Error(`来源 ${source.id} 缺少逐字引文、内容 hash 或抓取时间`);
    }
    const publishedMs = Date.parse(String(source.published_at || ""));
    if (!Number.isFinite(publishedMs) || publishedMs > cutoffMs) {
      throw new Error(`来源 ${source.id} 的发布时间为空或晚于研究截止时间`);
    }
    const unitIds = [...new Set((binding.judgment_unit_ids || []).map(String))];
    if (!unitIds.length || unitIds.some((id) => !unitById.has(id))) {
      throw new Error(`来源 ${source.id} 必须显式绑定存在的 JudgmentUnit`);
    }
    if (!String(binding.subject_ref || "").trim()) throw new Error(`来源 ${source.id} 缺少 subject_ref`);
    if (!Number.isFinite(Date.parse(String(binding.observed_at || "")))) throw new Error(`来源 ${source.id} 缺少有效 observed_at`);
    const direction = binding.direction || "support";
    if (!["support", "weaken", "neutral"].includes(direction)) throw new Error(`来源 ${source.id} direction 非法`);

    const sourceKey = `SRC-CONTROLLED-${String(index + 1).padStart(2, "0")}`;
    if (!seenSources.has(source.id)) {
      sources.push({
        source_id: source.id,
        source_key: sourceKey,
        url: source.url,
        title: source.title,
        publisher: source.publisher,
        published_at: source.published_at,
        source_tier: source.source_tier,
        source_type: source.source_type,
        search_excerpt: source.search_excerpt || "人工选择的已核验公开来源",
        locator: source.locator || "verified_quote",
        source_quote: source.source_quote,
        captured_at: source.captured_at,
        content_hash: source.content_hash,
        final_url: source.final_url || source.url,
        retrieval_status: source.retrieval_status,
        quote_verified: true,
      });
      seenSources.add(source.id);
    }
    const forwardLooking = /\b(?:forecast|project|expect|likely|outlook|guidance)\w*\b|预计|预测|展望|可能/i.test(source.source_quote);
    evidenceDrafts.push({
      id: `EV-CONTROLLED-${String(index + 1).padStart(2, "0")}`,
      statement: source.source_quote.trim(),
      kind: direction === "weaken" ? "counter" as const : forwardLooking ? "source_claim" as const : "fact_draft" as const,
      direction,
      source_keys: [sourceKey],
      source_ids: [source.id],
      judgment_unit_ids: unitIds,
      ontology_node_ids: binding.ontology_node_ids?.length
        ? [...new Set(binding.ontology_node_ids.map(String))]
        : [...new Set(unitIds.flatMap((id) => unitById.get(id)?.ontology_node_ids || []))],
      subject_ref: String(binding.subject_ref),
      time_basis: "reporting_period",
      scope_ref: String(unitById.get(unitIds[0])?.scope_ref || structure.research_scope?.id),
      observed_at: String(binding.observed_at),
      valid_from: String(binding.observed_at),
      valid_to: null,
      published_at: source.published_at,
      cutoff_at: cutoffAt,
      directness: "direct" as const,
      limitations: [
        "受控人工登记；陈述逐字采用已核验来源引文，未由模型改写",
        ...(forwardLooking ? ["来源陈述包含预测、预期或可能性语言，只能作为 SourceClaim，不得当作已经实现的事实"] : []),
      ],
    });
  }

  const applications = (structure.method_applications || []).map((application: MethodApplication) => {
    if (application.capability_type !== "evidence") return {
      ...application,
      provenance: { ...application.provenance, stage: "stage_03", source_application_id: application.application_id },
    };
    const evidenceRefs = evidenceDrafts
      .filter((evidence) => evidence.judgment_unit_ids.some((id: string) => application.target_judgment_unit_refs.includes(id)))
      .map((evidence) => evidence.id);
    if (!evidenceRefs.length) throw new Error(`${application.application_id} 没有绑定任何显式选择的事实`);
    return {
      ...application,
      status: "selected" as const,
      precondition_checks: [
        ...(application.precondition_checks || []).map((check) => ({
          ...check,
          result: "not_checked" as const,
          evidence_refs: evidenceRefs,
          reason: "来源可用性已确认，但该研究方法的语义前置条件必须在 Stage04 单独确认，不能由抓取成功代替",
        })),
        {
          precondition_id: "controlled_source_verification",
          result: "pass" as const,
          evidence_refs: evidenceRefs,
          reason: "人工选择的公开来源已完成抓取、逐字引文、发布时间和内容 hash 核验",
        },
      ],
      input_evidence_refs: evidenceRefs,
      provenance: {
        ...application.provenance,
        stage: "stage_03" as const,
        source_application_id: application.application_id,
        actor: "human-controlled-evidence-projection",
        recorded_at: new Date().toISOString(),
      },
    };
  });
  const sourceGroups = new Set(bindings.map((binding) => {
    const source = sourceById.get(String(binding.source_id))!;
    return source.source_group || source.publisher || source.normalized_url;
  }));
  const unresolvedGaps = sourceGroups.size < 2
    ? ["来源独立性不足：已登记事实均来自同一 source_group，后续判断强度不得因文档数量而升级"]
    : [];
  const data = {
    method_applications: applications,
    sources,
    evidence_drafts: evidenceDrafts,
    unresolved_gaps: unresolvedGaps,
    document_markdown: [
      "# 受控事实级证据登记",
      "",
      `本阶段由研究者显式选择 ${sources.length} 份已抓取、已冻结且逐字引文核验通过的公开来源。系统仅把来源原文登记为事实草稿，不做方向裁决，也不补写来源之外的事实。`,
      "",
      ...evidenceDrafts.map((evidence) => `- ${evidence.id} · ${evidence.direction} → ${evidence.judgment_unit_ids.join("、")}：${evidence.statement}`),
      "",
      ...(unresolvedGaps.length ? ["## 未解决边界", "", ...unresolvedGaps.map((gap) => `- ${gap}`)] : []),
    ].join("\n"),
  };
  schemas.stage_03.parse(data);
  validateGeneratedSemanticDraft(runId, "stage_03", data);
  const artifact = createArtifact(runId, "stage_03", {
    status: "needs_review",
    prompt_version: `${PROMPT_VERSION}:human-controlled-evidence-projection`,
    knowledge_version: "runtime-controlled-evidence-projection-v1",
    input_context: JSON.stringify({
      question: run.question,
      stage_01_artifact_id: taskArtifact.id,
      stage_02_artifact_id: structureArtifact.id,
      stage_02_artifact_hash: createHash("sha256").update(structureArtifact.json_content).digest("hex"),
      bindings,
    }, null, 2),
    json_content: JSON.stringify(data, null, 2),
    markdown_content: data.document_markdown,
    model_name: "human-controlled-evidence-projection",
    tool_usage: JSON.stringify({ controlled_projection: true, source_count: sources.length, source_group_count: sourceGroups.size }),
    error_message: null,
  });
  syncReviewWorkItems(artifact, data);
  return artifact;
}

type ControlledJudgmentInput = {
  judgment_unit_id: string;
  conclusion: string;
  evidence_draft_ids?: string[];
  supporting_evidence_draft_ids?: string[];
  counter_evidence_draft_ids?: string[];
  uncertainties?: string[];
  invalidation_conditions?: string[];
  competing_explanation?: string;
  discriminating_evidence?: string[];
  counterevidence_resolution?: string;
  confirmed_precondition_ids?: string[];
};

export function createControlledJudgmentProjection(runId: string, inputs: ControlledJudgmentInput[]) {
  const run = getRun(runId);
  if (!run) throw new Error("研究任务不存在");
  if (latestArtifact(runId, "stage_04", ["running"])) throw new Error("请先取消运行中的 Stage 04");
  const structureArtifact = latestArtifact(runId, "stage_02", ["approved"]);
  const evidenceArtifact = latestArtifact(runId, "stage_03", ["approved"]);
  if (!structureArtifact || !evidenceArtifact) throw new Error("请先确认阶段 02 和 03");
  if (!Array.isArray(inputs) || !inputs.length) throw new Error("受控判断投影至少需要一条显式 JudgmentUnit 裁决输入");

  const structure = parseJson<any>(structureArtifact.json_content, {});
  const evidence = parseJson<any>(evidenceArtifact.json_content, {});
  const unitById = new Map<string, any>((structure.judgment_units || []).map((unit: any) => [String(unit.id), unit]));
  const factById = new Map<string, any>((evidence.evidence_drafts || []).filter((item: any) => item.kind !== "gap").map((item: any) => [String(item.id), item]));
  const seenUnits = new Set<string>();
  const normalizedInputs = inputs.map((input) => {
    const unitId = String(input.judgment_unit_id || "");
    if (!unitById.has(unitId)) throw new Error(`JudgmentUnit 不存在: ${unitId}`);
    if (seenUnits.has(unitId)) throw new Error(`JudgmentUnit 重复裁决: ${unitId}`);
    seenUnits.add(unitId);
    if (!String(input.conclusion || "").trim()) throw new Error(`${unitId} 缺少显式 conclusion`);
    const supportingIds = [...new Set((input.supporting_evidence_draft_ids || input.evidence_draft_ids || []).map(String))];
    const counterIds = [...new Set((input.counter_evidence_draft_ids || []).map(String))];
    if (supportingIds.some((id) => counterIds.includes(id))) throw new Error(`${unitId} 同一事实不能同时标记为支持与反证`);
    const evidenceIds = [...new Set([...supportingIds, ...counterIds])];
    if (!evidenceIds.length) throw new Error(`${unitId} 至少需要一条已批准事实`);
    for (const id of evidenceIds) {
      const fact = factById.get(id);
      if (!fact) throw new Error(`${unitId} 引用了不存在或 gap 的事实 ${id}`);
      if (!(fact.judgment_unit_ids || []).map(String).includes(unitId)) throw new Error(`${id} 未在 Stage03 绑定 ${unitId}`);
    }
    return {
      ...input,
      judgment_unit_id: unitId,
      conclusion: input.conclusion.trim(),
      evidence_draft_ids: evidenceIds,
      supporting_evidence_draft_ids: supportingIds,
      counter_evidence_draft_ids: counterIds,
      confirmed_precondition_ids: [...new Set((input.confirmed_precondition_ids || []).map(String))],
    };
  });

  const inputByUnit = new Map(normalizedInputs.map((input) => [input.judgment_unit_id, input]));
  for (const unitId of unitById.keys()) {
    if (!inputByUnit.has(unitId)) throw new Error(`受控判断投影不得遗漏 JudgmentUnit ${unitId}`);
  }
  const recordedAt = new Date().toISOString();
  const ids = new Map(normalizedInputs.map((input, index) => [input.judgment_unit_id, {
    judgment: `J-CONTROLLED-${String(index + 1).padStart(2, "0")}`,
    supportSignal: `SIG-CONTROLLED-${String(index + 1).padStart(2, "0")}-S`,
    weakenSignal: `SIG-CONTROLLED-${String(index + 1).padStart(2, "0")}-W`,
    hypothesis: `H-CONTROLLED-${String(index + 1).padStart(2, "0")}`,
    competition: `CE-CONTROLLED-${String(index + 1).padStart(2, "0")}`,
    trace: `RT-CONTROLLED-${String(index + 1).padStart(2, "0")}`,
  }]));

  const methodRegistry = loadMethodRegistry();
  const applications: MethodApplication[] = (evidence.method_applications || []).map((application: MethodApplication) => {
    const boundInputs = application.target_judgment_unit_refs.map((unitId) => inputByUnit.get(unitId)).filter(Boolean) as ControlledJudgmentInput[];
    const evidenceRefs = [...new Set(boundInputs.flatMap((input) => input.evidence_draft_ids || []))];
    const judgmentRefs = [...new Set(application.target_judgment_unit_refs.map((unitId) => ids.get(unitId)?.judgment).filter(Boolean))] as string[];
    const signalRefs = [...new Set(application.target_judgment_unit_refs.flatMap((unitId) => {
      const input = inputByUnit.get(unitId);
      const unitIds = ids.get(unitId);
      return [
        input?.supporting_evidence_draft_ids?.length ? unitIds?.supportSignal : null,
        input?.counter_evidence_draft_ids?.length ? unitIds?.weakenSignal : null,
      ].filter(Boolean);
    }))] as string[];
    if (!evidenceRefs.length) throw new Error(`${application.application_id} 没有可执行的事实输入`);
    const registeredPreconditions = methodRegistry.get(application.method_id)?.preconditions || [];
    const confirmed = new Set(boundInputs.flatMap((input) => input.confirmed_precondition_ids || []));
    const automaticallyConfirmed = new Set(["controlled_source_verification", "judgment_unit", "object_scope"]);
    const missingPreconditions = registeredPreconditions.filter((precondition) => !confirmed.has(precondition) && !automaticallyConfirmed.has(precondition));
    const checks = registeredPreconditions.length
      ? registeredPreconditions.map((precondition) => {
        const passed = confirmed.has(precondition) || automaticallyConfirmed.has(precondition);
        return {
          precondition_id: precondition,
          result: passed ? "pass" as const : "fail" as const,
          evidence_refs: evidenceRefs,
          reason: passed
            ? (automaticallyConfirmed.has(precondition) ? "由已批准结构或来源冻结合同确定性确认" : "研究者在受控裁决中显式确认，并绑定已批准事实")
            : "研究者未显式确认该语义前置条件；抓取成功不能代替方法适用性",
        };
      })
      : [{
        precondition_id: "controlled_judgment_input",
        result: "pass" as const,
        evidence_refs: evidenceRefs,
        reason: "该方法无额外登记前置条件；输入只来自已批准事实",
      }];
    const executed = missingPreconditions.length === 0;
    return {
      ...application,
      status: executed ? "executed" as const : "degraded" as const,
      precondition_checks: checks,
      input_evidence_refs: evidenceRefs,
      output_signal_refs: application.capability_type === "evidence" ? signalRefs : [],
      output_judgment_refs: application.capability_type === "evidence" ? [] : judgmentRefs,
      execution_summary: executed
        ? `基于 ${evidenceRefs.join("、")} 完成受控 ${application.capability_type} 执行；方向与证据上限由 Runtime 再校验`
        : `未执行：缺少显式确认的语义前置条件 ${missingPreconditions.join("、")}`,
      limitations: [...new Set([...(application.limitations || []), ...(executed ? [] : [`方法前置条件未满足：${missingPreconditions.join("、")}`])])],
      provenance: {
        ...application.provenance,
        stage: "stage_04" as const,
        source_application_id: application.application_id,
        actor: "human-controlled-judgment-projection",
        recorded_at: recordedAt,
      },
      alternatives: application.alternatives.length
        ? application.alternatives
        : executed ? [] : [{ method_id: application.method_id, decision: "retry_after_precondition_confirmation", reason: "补齐并确认语义前置条件后重试" }],
    };
  });

  const signals = normalizedInputs.flatMap((input) => [
    input.supporting_evidence_draft_ids?.length ? {
      id: ids.get(input.judgment_unit_id)!.supportSignal,
      statement: `已批准事实支持待检验结论：${input.conclusion}`,
      role: "support" as const,
      evidence_draft_ids: input.supporting_evidence_draft_ids,
      judgment_unit_ids: [input.judgment_unit_id],
      target_hypothesis_ids: [ids.get(input.judgment_unit_id)!.hypothesis],
    } : null,
    input.counter_evidence_draft_ids?.length ? {
      id: ids.get(input.judgment_unit_id)!.weakenSignal,
      statement: `已批准事实削弱或限制待检验结论：${input.conclusion}`,
      role: "weaken" as const,
      evidence_draft_ids: input.counter_evidence_draft_ids,
      judgment_unit_ids: [input.judgment_unit_id],
      target_hypothesis_ids: [ids.get(input.judgment_unit_id)!.hypothesis],
    } : null,
  ].filter(Boolean)) as any[];
  const hypotheses = normalizedInputs.map((input) => ({
    id: ids.get(input.judgment_unit_id)!.hypothesis,
    statement: input.conclusion,
    signal_ids: [
      input.supporting_evidence_draft_ids?.length ? ids.get(input.judgment_unit_id)!.supportSignal : null,
      input.counter_evidence_draft_ids?.length ? ids.get(input.judgment_unit_id)!.weakenSignal : null,
    ].filter(Boolean) as string[],
    falsification_conditions: input.invalidation_conditions?.length
      ? [...new Set(input.invalidation_conditions.map(String))]
      : ["取得与当前结论方向相反且同口径、可定位、截止时间合规的新事实"],
    time_horizon: "仅限 Stage01 冻结的研究截止时点与范围",
  }));
  const competingExplanations = normalizedInputs.map((input) => ({
    id: ids.get(input.judgment_unit_id)!.competition,
    statement: String(input.competing_explanation || "观察到的变化可能来自短期扰动、口径差异或提前行为，而非待检验的可持续机制"),
    signal_ids: [
      input.supporting_evidence_draft_ids?.length ? ids.get(input.judgment_unit_id)!.supportSignal : null,
      input.counter_evidence_draft_ids?.length ? ids.get(input.judgment_unit_id)!.weakenSignal : null,
    ].filter(Boolean) as string[],
    discriminating_evidence: input.discriminating_evidence?.length
      ? [...new Set(input.discriminating_evidence.map(String))]
      : ["取得跨期、同口径且来源独立的后续观察，检验当前信号是否延续并排除短期扰动"],
    status: input.counterevidence_resolution ? "weakened" as const : "active" as const,
    elimination_rationale: input.counterevidence_resolution
      ? `研究者记录的有限裁决：${input.counterevidence_resolution}；竞争解释仍不得标记为 eliminated`
      : "尚未取得足以排除该解释的区分性证据",
  }));
  const sourceRecords = new Map(listSources(runId).map((source) => [source.id, source]));
  const judgments = normalizedInputs.map((input) => {
    const unit = unitById.get(input.judgment_unit_id);
    const applicationIds = applications
      .filter((application: MethodApplication) => application.target_judgment_unit_refs.includes(input.judgment_unit_id))
      .map((application: MethodApplication) => application.application_id);
    const inputFacts = (input.evidence_draft_ids || []).map((id) => factById.get(id)).filter(Boolean);
    const sourceGroups = new Set(inputFacts.flatMap((fact) => fact.source_ids || []).map((sourceId) => {
      const source = sourceRecords.get(String(sourceId));
      return source?.source_group || source?.publisher || source?.normalized_url || String(sourceId);
    }));
    const unresolvedConflict = Boolean(input.supporting_evidence_draft_ids?.length && input.counter_evidence_draft_ids?.length && !String(input.counterevidence_resolution || "").trim());
    const executedAdjudication = applications.some((application) => application.capability_type === "adjudication"
      && application.status === "executed" && application.target_judgment_unit_refs.includes(input.judgment_unit_id));
    const blockedByMethod = !executedAdjudication;
    const strength = unresolvedConflict || blockedByMethod ? "J0" as const : inputFacts.length >= 2 && sourceGroups.size >= 2 ? "J2" as const : "J1" as const;
    const decisionStatus = unresolvedConflict ? "contested" as const : blockedByMethod ? "indeterminate" as const : "supported" as const;
    const stopReason = unresolvedConflict
      ? "支持与反向证据并存，尚缺能够区分短期扰动与可持续改善的后续同口径证据"
      : blockedByMethod ? "裁决方法的语义前置条件未被显式确认，不能把已抓取来源直接升级为判断" : null;
    return {
      id: ids.get(input.judgment_unit_id)!.judgment,
      judgment_unit_id: input.judgment_unit_id,
      title: String(unit.title || input.judgment_unit_id),
      conclusion: input.conclusion,
      rationale: unresolvedConflict
        ? `支持证据与反向证据同时存在，且没有记录足以解决冲突的区分性证据；结论保持 J0/contested`
        : blockedByMethod
          ? "事实已登记，但裁决方法前置条件未满足；结论保持 J0/indeterminate"
        : `仅依据已批准事实 ${input.evidence_draft_ids?.join("、")} 形成受控判断；共 ${inputFacts.length} 条事实、${sourceGroups.size} 个来源组，强度上限为 ${strength}`,
      strength,
      confidence: strength === "J2" ? "medium" as const : "low" as const,
      decision_status: decisionStatus,
      conflict_status: unresolvedConflict ? "unresolved" as const : input.counter_evidence_draft_ids?.length ? "resolved" as const : "none" as const,
      not_judgeable_reason: stopReason,
      scope_ref: String(unit.scope_ref || structure.research_scope?.id),
      cutoff_at: normalizeBusinessCutoff(parseJson<any>(latestArtifact(runId, "stage_01", ["approved"])?.json_content || "{}", {}).time_scope?.as_of)!,
      conditions: ["只在已批准事实、冻结截止时间与所列适用范围内成立；不自动外推原因、持续性、行业全面性或投资建议"],
      supporting_evidence_draft_ids: input.supporting_evidence_draft_ids || [],
      counter_evidence_draft_ids: input.counter_evidence_draft_ids || [],
      hypothesis_ids: [ids.get(input.judgment_unit_id)!.hypothesis],
      rule_evaluation_ids: [],
      method_application_ids: applicationIds,
      ontology_node_ids: unit.ontology_node_ids || [],
      uncertainties: [...new Set([...(input.uncertainties || []), ...(sourceGroups.size < 2 ? ["当前事实缺少两个独立来源组的交叉验证"] : [])])],
      invalidation_conditions: input.invalidation_conditions?.length
        ? [...new Set(input.invalidation_conditions.map(String))]
        : ["取得与当前结论方向相反且同口径、可定位、截止时间合规的新事实"],
      tracking_signals: [...new Set([...(input.discriminating_evidence || []), ...(input.invalidation_conditions || [])])],
    };
  });
  const reasoningTraces = judgments.map((judgment) => ({
    id: ids.get(judgment.judgment_unit_id)!.trace,
    judgment_id: judgment.id,
    node_ids: [...new Set([
      judgment.scope_ref,
      judgment.judgment_unit_id,
      ...judgment.supporting_evidence_draft_ids,
      ...judgment.counter_evidence_draft_ids,
      ...judgment.hypothesis_ids,
      ...signals.filter((signal) => signal.judgment_unit_ids.includes(judgment.judgment_unit_id)).map((signal) => signal.id),
      ...judgment.method_application_ids,
      judgment.id,
    ])],
    created_at: recordedAt,
  }));
  const data: any = {
    method_applications: applications,
    signals,
    hypotheses,
    competing_explanations: competingExplanations,
    rule_evaluations: [],
    judgments,
    reasoning_traces: reasoningTraces,
    overall_boundary: "受控裁决只使用已批准事实；未解决的支持/反向证据冲突保持 J0/contested，已形成方向的判断也不外推原因、持续性、行业全面性或投资建议。",
    document_markdown: [
      "# 受控判断结果",
      "",
      ...judgments.map((judgment) => `- ${judgment.title}：${judgment.conclusion}（${judgment.strength}；${judgment.supporting_evidence_draft_ids.join("、")}）`),
      "",
      "## 总体边界",
      "",
      "未解决的证据冲突保持 J0/contested；其余判断的强度由事实数量、来源组和 Runtime 确定性规则共同限制。受控路径不把研究者填写的结论自动升级为强判断。",
    ].join("\n"),
  };
  applyDeterministicRuleEvaluations(data, evidence.evidence_drafts || [], listSources(runId), structure);
  schemas.stage_04.parse(data);
  validateGeneratedSemanticDraft(runId, "stage_04", data);
  const artifact = createArtifact(runId, "stage_04", {
    status: "needs_review",
    prompt_version: `${PROMPT_VERSION}:human-controlled-judgment-projection`,
    knowledge_version: "runtime-controlled-judgment-projection-v1",
    input_context: JSON.stringify({
      question: run.question,
      stage_02_artifact_id: structureArtifact.id,
      stage_03_artifact_id: evidenceArtifact.id,
      stage_03_artifact_hash: createHash("sha256").update(evidenceArtifact.json_content).digest("hex"),
      judgments: inputs,
    }, null, 2),
    json_content: JSON.stringify(data, null, 2),
    markdown_content: data.document_markdown,
    model_name: "human-controlled-judgment-projection",
    tool_usage: JSON.stringify({ controlled_projection: true, judgment_count: judgments.length, deterministic_rules: true }),
    error_message: null,
  });
  syncReviewWorkItems(artifact, data);
  return artifact;
}

export function buildJudgmentGapFallback(structure: any, evidence: any, reason: string) {
  const gapsByUnit = new Map<string, string[]>();
  for (const gap of evidence.evidence_drafts || []) {
    for (const unitId of gap.judgment_unit_ids || []) {
      gapsByUnit.set(unitId, [...(gapsByUnit.get(unitId) || []), gap.id]);
    }
  }
  const applications = (evidence.method_applications || []).map((application: MethodApplication) => {
    const gapRefs = [...new Set(application.target_judgment_unit_refs.flatMap((unitId) => gapsByUnit.get(unitId) || []))];
    return {
      ...application,
      status: "blocked" as const,
      precondition_checks: [{
        precondition_id: "fact_level_evidence_available",
        result: "fail" as const,
        evidence_refs: gapRefs,
        reason,
      }],
      input_evidence_refs: gapRefs,
      output_signal_refs: [],
      output_judgment_refs: [],
      execution_summary: "",
      limitations: [...new Set([...(application.limitations || []), "上游只有证据缺口，没有可用于执行的方法输入事实"])],
      provenance: {
        ...application.provenance,
        stage: "stage_04" as const,
        source_application_id: application.application_id,
        actor: "runtime-j0-fallback",
        recorded_at: null,
      },
      alternatives: application.alternatives.length
        ? application.alternatives
        : [{ method_id: application.method_id, decision: "retry_after_evidence", reason: "补齐事实级证据后重试同一登记方法" }],
    };
  });
  const scopeRef = String(structure.research_scope?.id || "SCOPE-UNRESOLVED");
  const cutoff = new Date().toISOString();
  const hypotheses: any[] = [];
  const competingExplanations: any[] = [];
  const ruleEvaluations: any[] = [];
  const judgments: any[] = [];
  const reasoningTraces: any[] = [];
  for (const [index, unit] of (structure.judgment_units || []).entries()) {
    const suffix = String(index + 1).padStart(2, "0");
    const hypothesisId = `H-J0-${suffix}`;
    const explanationId = `CE-J0-${suffix}`;
    const judgmentId = `J-J0-${suffix}`;
    const ruleId = `RE-SYS-PLACEHOLDER-${suffix}`;
    const adjudication = applications.find((application: MethodApplication) =>
      application.capability_type === "adjudication" && application.target_judgment_unit_refs.includes(unit.id));
    if (!adjudication) throw new Error(`${unit.id} 缺少 adjudication MA，不能生成 J0 降级判断`);
    const requirements = unit.evidence_requirements?.length ? unit.evidence_requirements : ["事实级证据"];
    hypotheses.push({
      id: hypothesisId,
      statement: `${unit.title} 的方向命题目前未被事实级证据检验`,
      signal_ids: [],
      falsification_conditions: requirements.map((item: string) => `取得并核验：${item}`),
      time_horizon: "补齐证据后重新裁决",
    });
    competingExplanations.push({
      id: explanationId,
      statement: `${unit.title} 可能改善、恶化或分化，当前均无法排除`,
      signal_ids: [],
      discriminating_evidence: requirements,
      status: "unknown" as const,
      elimination_rationale: "没有事实级 Signal，不能排除任何竞争解释",
    });
    ruleEvaluations.push({
      id: ruleId,
      rule_ref: "judgment_status_consistency",
      input_refs: [judgmentId],
      condition_results: [{
        condition_id: "j0_gap_path",
        expression: "gap_only => J0/indeterminate",
        input_refs: [judgmentId],
        outcome: "pass" as const,
        rationale: "上游只有 gap，判断保持 J0/indeterminate",
      }],
      result: "pass" as const,
      deterministic_result: null,
    });
    judgments.push({
      id: judgmentId,
      judgment_unit_id: unit.id,
      title: `${unit.title}：暂不可判断`,
      conclusion: "当前暂不可形成方向判断",
      rationale: `${reason}；没有可核验 EvidenceFact 或 Signal，禁止输出支持、削弱或趋势方向。`,
      strength: "J0" as const,
      confidence: "low" as const,
      decision_status: "indeterminate" as const,
      conflict_status: "none" as const,
      not_judgeable_reason: `缺少：${requirements.join("；")}`,
      scope_ref: scopeRef,
      cutoff_at: cutoff,
      conditions: ["仅当事实级证据补齐并重新执行裁决方法后才能升级"],
      supporting_evidence_draft_ids: [],
      counter_evidence_draft_ids: [],
      hypothesis_ids: [hypothesisId],
      rule_evaluation_ids: [ruleId],
      method_application_ids: [adjudication.application_id],
      ontology_node_ids: unit.ontology_node_ids || [],
      uncertainties: requirements,
      invalidation_conditions: ["取得足以形成至少 J1 的可核验事实级证据"],
      tracking_signals: requirements,
    });
    reasoningTraces.push({
      id: `RT-J0-${suffix}`,
      judgment_id: judgmentId,
      node_ids: [unit.id, hypothesisId, ruleId, adjudication.application_id, judgmentId],
      created_at: cutoff,
    });
  }
  return {
    method_applications: applications,
    signals: [],
    hypotheses,
    competing_explanations: competingExplanations,
    rule_evaluations: ruleEvaluations,
    judgments,
    reasoning_traces: reasoningTraces,
    overall_boundary: "上游只有经人工接受的证据缺口；本产物只登记 J0/暂不可判断，不包含任何方向性结论。",
    document_markdown: `# 判断降级结果\n\n上游 03 只有证据缺口，没有可核验事实。系统因此将全部方法收敛为 blocked，并为 ${judgments.length} 个判断单元生成 J0/暂不可判断结果。该结果仍需逐项人工审阅，不能被表达为行业方向或价格预测。\n\n失败原因：${reason}`,
  };
}

export function createJudgmentGapFallback(runId: string, reason: string) {
  const run = getRun(runId);
  if (!run) throw new Error("研究任务不存在");
  if (latestArtifact(runId, "stage_04", ["running"])) throw new Error("请先取消运行中的 Stage 04");
  const structureArtifact = latestArtifact(runId, "stage_02", ["approved"]);
  const evidenceArtifact = latestArtifact(runId, "stage_03", ["approved"]);
  if (!structureArtifact || !evidenceArtifact) throw new Error("请先确认阶段 02 和 03");
  const structure = parseJson<any>(structureArtifact.json_content, {});
  const evidence = parseJson<any>(evidenceArtifact.json_content, {});
  if ((evidence.evidence_drafts || []).some((item: any) => item.kind !== "gap")) {
    throw new Error("上游存在事实级证据，不能使用全量 J0 降级；请重新运行正常裁决");
  }
  const data = buildJudgmentGapFallback(structure, evidence, reason);
  schemas.stage_04.parse(data);
  validateGeneratedSemanticDraft(runId, "stage_04", data);
  applyDeterministicRuleEvaluations(data, evidence.evidence_drafts || [], listSources(runId), structure);
  schemas.stage_04.parse(data);
  const artifact = createArtifact(runId, "stage_04", {
    status: "needs_review",
    prompt_version: `${PROMPT_VERSION}:explicit-j0-fallback`,
    knowledge_version: "runtime-deterministic-j0-fallback-v1",
    input_context: JSON.stringify({
      question: run.question,
      stage_02_artifact_id: structureArtifact.id,
      stage_03_artifact_id: evidenceArtifact.id,
      stage_03_artifact_hash: createHash("sha256").update(evidenceArtifact.json_content).digest("hex"),
      fact_count: 0,
      fallback_reason: reason,
    }, null, 2),
    json_content: JSON.stringify(data, null, 2),
    markdown_content: data.document_markdown,
    model_name: "runtime-deterministic-j0-fallback",
    tool_usage: JSON.stringify({ degraded: true, failure_category: "model_output_error", reason }),
    error_message: `[model_output_error] ${reason}；已降级为 J0 判断，尚未确认`,
  });
  syncReviewWorkItems(artifact, data);
  return artifact;
}

export function normalizeStage05Projection(data: any, stage04: any, question: string, sources: SourceRecord[]) {
  const judgmentById = new Map<string, any>((stage04.judgments || []).map((item: any) => [String(item.id), item]));
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  for (const claim of data.report_claims || []) {
    const judgments = (claim.judgment_ids || []).map((id: string) => judgmentById.get(String(id))).filter(Boolean);
    if (!judgments.length) throw new Error(`${claim.id} 无法从已确认 Judgment 重建表达`);
    claim.statement = judgments.map((judgment: any) =>
      `${judgment.title}：${judgment.conclusion}（${judgment.strength}/${judgment.decision_status}）`).join("；");
  }
  data.title = `研究判断简报｜${String(question || "未命名研究问题").replace(/\s+/g, " ").trim().slice(0, 80)}`;
  data.executive_points = (data.report_claims || []).flatMap((claim: any) =>
    (claim.judgment_ids || []).map((id: string) => {
      const judgment = judgmentById.get(String(id));
      return judgment ? `${judgment.title}：${judgment.conclusion}` : claim.statement;
    }));
  data.limitations = [...new Set([
    String(stage04.overall_boundary || "").trim(),
    ...(stage04.judgments || []).flatMap((judgment: any) => [
      ...(judgment.uncertainties || []),
      ...(judgment.invalidation_conditions || []).map((item: string) => `改判条件：${item}`),
    ]),
  ].filter(Boolean))];
  const usedSourceIds = new Set<string>((data.report_claims || []).flatMap((claim: any) => claim.source_ids || []).map(String));
  const usedSources = [...usedSourceIds].map((id) => sourceById.get(id)).filter(Boolean) as SourceRecord[];
  const claimMarkdown = (data.report_claims || []).map((claim: any) => {
    const judgments = (claim.judgment_ids || []).map((id: string) => judgmentById.get(String(id))).filter(Boolean);
    const claimSources = (claim.source_ids || []).map((id: string) => sourceById.get(String(id))).filter(Boolean) as SourceRecord[];
    const title = judgments.map((judgment: any) => judgment.title).filter(Boolean).join(" / ") || claim.id;
    const conclusions = judgments.map((judgment: any) =>
      `- **${judgment.strength}/${judgment.decision_status}**：${judgment.conclusion}`).join("\n");
    const evidence = claimSources.length
      ? claimSources.map((source) => {
        const quote = String(source.source_quote || "").replace(/\s+/g, " ").trim();
        const excerpt = quote.length > 500 ? `${quote.slice(0, 500)}…` : quote;
        return `- [${source.title}](${source.url})${excerpt ? `：“${excerpt}”` : "（已登记来源，正文引文见证据台）"}`;
      }).join("\n")
      : "- 当前没有可支撑方向判断的事实级来源；结论保持 J0。";
    const uncertainties = [...new Set(judgments.flatMap((judgment: any) => judgment.uncertainties || []).map(String).filter(Boolean))];
    const invalidations = [...new Set(judgments.flatMap((judgment: any) => judgment.invalidation_conditions || []).map(String).filter(Boolean))];
    return [
      `### ${title}`,
      "",
      "**判断**",
      "",
      conclusions || `- ${claim.statement}`,
      "",
      "**直接依据**",
      "",
      evidence,
      "",
      "**当前边界**",
      "",
      ...(uncertainties.length ? uncertainties.map((item) => `- ${item}`) : ["- 未登记额外不确定性。"]),
      "",
      "**何时改判**",
      "",
      ...(invalidations.length ? invalidations.map((item) => `- ${item}`) : ["- 未登记额外改判条件。"]),
      "",
      "<details><summary>审计索引</summary>",
      "",
      `- ReportClaim：${claim.id}`,
      `- Judgment：${(claim.judgment_ids || []).join(", ")}`,
      `- MethodApplication：${(claim.method_application_ids || []).join(", ")}`,
      `- EvidenceFact：${(claim.evidence_draft_ids || []).length ? claim.evidence_draft_ids.join(", ") : "无（J0 不可判断路径）"}`,
      `- Source：${(claim.source_ids || []).length ? claim.source_ids.join(", ") : "无（J0 不可判断路径）"}`,
      "",
      "</details>",
    ].join("\n");
  }).join("\n\n");
  data.document_markdown = [
    `# ${data.title}`,
    "",
    "## 研究问题",
    "",
    question,
    "",
    "## 结论先行",
    "",
    ...(data.executive_points.length ? data.executive_points.map((item: string) => `- ${item}`) : ["- 当前没有可交付的已确认判断。"]),
    "",
    "## 判断依据与改判条件",
    "",
    claimMarkdown,
    "",
    "## 整体适用边界",
    "",
    ...(data.limitations.length ? data.limitations.map((item: string) => `- ${item}`) : ["- 无额外边界记录"]),
    ...(usedSources.length ? ["", "## 主要资料来源", "", ...usedSources.map((source) => `- [${source.title}](${source.url})`)] : []),
  ].join("\n");
  return data;
}

export function createStage05DeterministicProjection(runId: string) {
  const run = getRun(runId);
  if (!run) throw new Error("研究任务不存在");
  const stage04Artifact = latestArtifact(runId, "stage_04", ["approved"]);
  const sourceArtifact = latestArtifact(runId, "stage_05", ["approved", "needs_review"]);
  const stage03Artifact = latestArtifact(runId, "stage_03", ["approved"]);
  if (!stage04Artifact || !stage03Artifact) throw new Error("请先生成并确认 Stage 03 和 Stage 04");
  const stage04 = parseJson<any>(stage04Artifact.json_content, {});
  const stage03 = parseJson<any>(stage03Artifact.json_content, {});
  const evidenceById = new Map<string, any>((stage03.evidence_drafts || []).map((item: any) => [String(item.id), item]));
  const seed = sourceArtifact ? parseJson<any>(sourceArtifact.json_content, {}) : {
    title: "受控研究判断简报",
    executive_points: [],
    report_claims: (stage04.judgments || []).map((judgment: any, index: number) => {
      const evidenceIds = [...new Set([
        ...(judgment.supporting_evidence_draft_ids || []),
        ...(judgment.counter_evidence_draft_ids || []),
      ].map(String))];
      const sourceIds = [...new Set(evidenceIds.flatMap((id) => evidenceById.get(id)?.source_ids || []).map(String))];
      return {
        id: `RC-CONTROLLED-${String(index + 1).padStart(2, "0")}`,
        statement: String(judgment.conclusion || judgment.title || judgment.id),
        judgment_ids: [String(judgment.id)],
        method_application_ids: [...new Set((judgment.method_application_ids || []).map(String))],
        evidence_draft_ids: evidenceIds,
        source_ids: sourceIds,
      };
    }),
    limitations: [],
    document_markdown: "placeholder",
  };
  const data = normalizeStage05Projection(
    seed,
    stage04,
    run.question,
    listSources(runId),
  );
  schemas.stage_05.parse(data);
  if (sourceArtifact) return editArtifact(sourceArtifact.id, JSON.stringify(data, null, 2), data.document_markdown);
  return createArtifact(runId, "stage_05", {
    status: "needs_review",
    prompt_version: `${PROMPT_VERSION}:runtime-deterministic-expression-v1`,
    knowledge_version: "runtime-deterministic-expression-v1",
    input_context: JSON.stringify({
      question: run.question,
      stage_03_artifact_id: stage03Artifact.id,
      stage_03_artifact_hash: createHash("sha256").update(stage03Artifact.json_content).digest("hex"),
      stage_04_artifact_id: stage04Artifact.id,
      stage_04_artifact_hash: createHash("sha256").update(stage04Artifact.json_content).digest("hex"),
    }, null, 2),
    json_content: JSON.stringify(data, null, 2),
    markdown_content: data.document_markdown,
    model_name: "runtime-deterministic-expression-projection",
    tool_usage: JSON.stringify({ deterministic_projection: true, report_claim_count: data.report_claims.length }),
  });
}

type ControlledIndependentReviewInput = {
  reviewer: string;
  attestation: string;
  verdict: "pass" | "rework";
  issues?: Array<{
    issue_type: "reasoning_jump" | "evidence_mismatch" | "overclaim" | "missing_competing_explanation" | "traceability_gap";
    judgment_id?: string | null;
    description: string;
    evidence_refs?: string[];
    required_action: string;
    return_stage: "stage_02" | "stage_03" | "stage_04";
  }>;
  strengths?: string[];
  overall_assessment: string;
};

export function createControlledIndependentReview(runId: string, input: ControlledIndependentReviewInput) {
  const run = getRun(runId);
  if (!run) throw new Error("研究任务不存在");
  const reviewed = latestArtifact(runId, "stage_04", ["approved"]);
  if (!reviewed) throw new Error("请先确认 Stage04");
  const reviewer = String(input.reviewer || "").trim();
  const attestation = String(input.attestation || "").trim();
  const assessment = String(input.overall_assessment || "").trim();
  if (reviewer.length < 2) throw new Error("请填写可追溯的人类审阅者标识");
  if (attestation.length < 20) throw new Error("请留下至少 20 字的独立性与利益冲突声明");
  if (assessment.length < 8) throw new Error("请填写至少 8 字的总体审阅意见");
  const reviewerIdentity = `human:${reviewer}`;
  if (reviewerIdentity === reviewed.model_name || reviewer === reviewed.model_name) throw new Error("独立审阅者不能与 Stage04 生产者相同");
  const issues = (input.issues || []).map((issue) => ({
    issue_type: issue.issue_type,
    judgment_id: issue.judgment_id ? String(issue.judgment_id) : null,
    description: String(issue.description || "").trim(),
    evidence_refs: [...new Set((issue.evidence_refs || []).map(String).filter(Boolean))],
    required_action: String(issue.required_action || "").trim(),
    return_stage: issue.return_stage,
  }));
  if ((input.verdict === "pass" && issues.length) || (input.verdict === "rework" && !issues.length)) {
    throw new Error("pass 不得携带问题；rework 必须至少登记一项结构化问题");
  }
  const strengths = [...new Set((input.strengths || []).map(String).map((item) => item.trim()).filter(Boolean))];
  const data = {
    reviewed_stage04_artifact_id: reviewed.id,
    reviewed_stage04_artifact_hash: createHash("sha256").update(reviewed.json_content).digest("hex"),
    verdict: input.verdict,
    issues,
    strengths,
    overall_assessment: assessment,
    document_markdown: [
      "# 人类独立审阅",
      "",
      `- 审阅者：${reviewer}`,
      `- 结论：${input.verdict}`,
      `- 独立性声明：${attestation}`,
      `- 被审阅 Stage04：${reviewed.id}`,
      "",
      "## 总体意见",
      "",
      assessment,
      "",
      "## 优点",
      "",
      ...(strengths.length ? strengths.map((item) => `- ${item}`) : ["- 未登记"]),
      "",
      "## 问题与返工要求",
      "",
      ...(issues.length ? issues.map((issue, index) => `${index + 1}. [${issue.issue_type}] ${issue.description}；退回 ${issue.return_stage}；要求：${issue.required_action}`) : ["- 未发现需要返工的实质问题"]),
    ].join("\n"),
    reviewer_model: reviewerIdentity,
    producer_model: reviewed.model_name,
    reviewer_type: "human" as const,
    reviewer_attestation: attestation,
    independence_level: "independent_human" as const,
  };
  schemas.independent_review.parse(data);
  const artifact = createArtifact(runId, "independent_review", {
    status: "needs_review",
    prompt_version: `${PROMPT_VERSION}:human-independent-review-v1`,
    knowledge_version: "human-independent-review-v1",
    input_context: JSON.stringify({ reviewed_stage04_artifact_id: reviewed.id, reviewed_stage04_artifact_hash: data.reviewed_stage04_artifact_hash, reviewer_type: "human" }, null, 2),
    json_content: JSON.stringify(data, null, 2),
    markdown_content: data.document_markdown,
    model_name: reviewerIdentity,
    tool_usage: JSON.stringify({ human_controlled_review: true }),
  });
  syncReviewWorkItems(artifact, data);
  return artifact;
}

function equivalentSourceTime(left: unknown, right: unknown) {
  const leftValue = String(left || "");
  const rightValue = String(right || "");
  if (leftValue === rightValue) return true;
  const leftTime = Date.parse(leftValue);
  const rightTime = Date.parse(rightValue);
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime === rightTime;
}

function sameStringSet(left: unknown[], right: unknown[]) {
  const leftSet = new Set(left.map(String));
  const rightSet = new Set(right.map(String));
  return leftSet.size === rightSet.size && [...leftSet].every((value) => rightSet.has(value));
}

export function approve(id: string) {
  return withImmediateTransaction(() => {
    const artifact = getArtifact(id);
    if (!artifact) throw new Error("产物不存在");
    if (artifact.status !== "needs_review") throw new Error("只有待确认产物可以确认");
    validateApproval(artifact);
    assertArtifactReviewComplete(artifact);
    const approvedStage = stageNumber(artifact.kind);
    if (approvedStage) supersedeDownstream(artifact.run_id, approvedStage);
    supersedeOtherArtifactAttempts(artifact.run_id, artifact.kind, artifact.id);
    approveArtifact(artifact);
    if (["stage_02", "stage_03", "stage_04"].includes(artifact.kind)) {
      materializeAuthorityGraph(artifact.run_id, artifact.kind, parseJson(artifact.json_content, {}));
    }
    return getArtifact(id)!;
  });
}

function assertArtifactReviewComplete(artifact: Artifact) {
  if (artifact.kind !== "stage_03" && artifact.kind !== "stage_04") return;
  const data: any = parseJson(artifact.json_content, {});
  const targets: string[] = artifact.kind === "stage_03"
    ? (data.evidence_drafts || []).map((item: any) => String(item.id))
    : (data.judgments || []).map((item: any) => String(item.id));
  const bound = listWorkItems(artifact.run_id).filter((item) =>
    item.artifact_id === artifact.id && item.attempt === artifact.version);
  const byTarget = new Map<string, (typeof bound)[number]>(bound.map((item) => [item.target_id, item]));
  const missing = targets.filter((target: string) => !byTarget.has(target));
  if (missing.length) throw new Error(`${artifact.kind} 仍有未创建审阅工作项的对象: ${missing.join(", ")}`);
  const unresolved = targets
    .map((target: string) => byTarget.get(target))
    .filter((item): item is (typeof bound)[number] => Boolean(item) && item?.status !== "approved");
  if (unresolved.length) {
    throw new Error(`${artifact.kind} 仍有 ${unresolved.length} 个对象未获人工批准: ${unresolved.map((item) => `${item.target_id}:${item.status}`).join(", ")}`);
  }
}

function materializeAuthorityGraph(runId: string, stageKind: string, stageJson: Record<string, unknown>) {
  const run = getRun(runId);
  if (!run) return;
  const loaded = loadGraphForRun(runId, run.package_path);
  const base =
    loaded.authority === "formal" || loaded.authority === "package"
      ? loaded.graph
      : emptyGraph();
  const next = materializeStageIntoGraph(
    { ...base, authority: "business_parameters" },
    stageKind,
    stageJson,
  );
  saveInstanceGraph(
    runId,
    {
      provisional: false,
      materialized_from: stageKind,
      materialized_at: new Date().toISOString(),
      business_instance_graph: next,
    },
    `materialized from ${stageKind}`,
  );
}

export async function generateArtifact(runId: string, kind: ArtifactKind) {
  const run = getRun(runId);
  if (!run) throw new Error("研究任务不存在");
  if (kind === "independent_review" && !latestArtifact(runId, "stage_04", ["approved"])) {
    throw new Error("请先确认阶段 04，再运行独立审阅");
  }
  if (kind === "baseline" && !latestArtifact(runId, "stage_03", ["approved"])) {
    throw new Error("请先确认阶段 03 并冻结证据，再生成同证据基线");
  }
  if (kind.startsWith("stage_")) {
    const n = stageNumber(kind);
    if (n > 1 && !latestArtifact(runId, STAGES[n - 2], ["approved"])) {
      throw new Error(`请先确认阶段 ${String(n - 1).padStart(2, "0")}`);
    }
  }
  const running = latestArtifact(runId, kind, ["running"]);
  if (running) {
    const leaseMs = Math.min(Math.max(Number(process.env.DEEPSEEK_GENERATION_TIMEOUT_MS || 480_000), 30_000), 1_200_000);
    const ageMs = Date.now() - Date.parse(running.created_at);
    if (Number.isFinite(ageMs) && ageMs < leaseMs + 15_000) {
      throw new Error(`${kind} 已有生成请求运行中（artifact=${running.id}），请等待或在超时后重试`);
    }
    updateArtifact(running.id, {
      status: "failed",
      error_message: "[model_output_error] MODEL_TIMEOUT_RECOVERED: 上一进程终止后遗留 running，已由新请求恢复",
      tool_usage: JSON.stringify({ failure_category: "model_output_error", recovered_abandoned_generation: true }),
    });
  }
  const knowledge = kind.startsWith("stage_") ? loadKnowledge(kind as StageKind) : { version: "none", context: "", files: [] };
  const dependencyStages: Partial<Record<ArtifactKind, StageKind[]>> = {
    stage_01: [],
    stage_02: ["stage_01"],
    stage_03: ["stage_01", "stage_02"],
    stage_04: ["stage_02", "stage_03"],
    stage_05: ["stage_03", "stage_04"],
    baseline: [],
    independent_review: ["stage_02", "stage_03", "stage_04"],
  };
  const upstreamStages = dependencyStages[kind] || [];
  const upstream = upstreamStages
    .map((s) => latestArtifact(runId, s, ["approved"]))
    .filter(Boolean)
    .map((a) => ({ artifact_id: a!.id, artifact_hash: createHash("sha256").update(a!.json_content).digest("hex"), model_name: a!.model_name, kind: a!.kind, json: compactStructuredArtifact(parseJson(a!.json_content, {})) }));
  const approvedEvidenceArtifact = latestArtifact(runId, "stage_03", ["approved"]);
  const approvedEvidence: any = approvedEvidenceArtifact
    ? parseJson(approvedEvidenceArtifact.json_content, {})
    : undefined;
  if (approvedEvidence && kind !== "stage_03") {
    quarantineUnboundWebCitations(runId, evidenceBoundSourceIds(approvedEvidence));
  }
  const allSources = listSources(runId);
  const isEvidenceConsumer = ["stage_04", "stage_05", "baseline", "independent_review"].includes(kind);
  const frozenSources = isEvidenceConsumer && approvedEvidence
    ? evidenceBoundSources(allSources, approvedEvidence)
    : [];
  const taskContext: any = upstream.find((item) => item.kind === "stage_01")?.json;
  const promptSources = sourcesForPrompt(kind, allSources, taskContext?.time_scope?.as_of);
  const sourceContext = promptSources.map((source) => ({
    ...source,
    snapshot_text: (source.snapshot_text || "").slice(0, 12_000),
  }));
  // 同证据基线只能看到 Stage03 已登记的逐字引文，不能从完整快照
  // 额外开采主链未登记的新事实，否则“同证据”比较失真。
  const frozenSourceContext = frozenSources.map(sourceForFrozenBaseline);
  const ontologyContext = ontologyContextForPrompt(runId);
  const frozenEvidenceArtifact = kind === "baseline" ? approvedEvidenceArtifact : undefined;
  const frozenEvidence: any = frozenEvidenceArtifact ? parseJson(frozenEvidenceArtifact.json_content, {}) : undefined;
  const inputContext = JSON.stringify(
    {
      question: run.question,
      domain: run.domain,
      package_path: run.package_path,
      upstream,
      sources: kind === "baseline" ? undefined : sourceContext,
      frozen_evidence: kind === "baseline" ? {
        artifact_id: frozenEvidenceArtifact?.id,
        artifact_version: frozenEvidenceArtifact?.version,
        artifact_hash: frozenEvidenceArtifact ? createHash("sha256").update(frozenEvidenceArtifact.json_content).digest("hex") : null,
        evidence_drafts: frozenEvidence?.evidence_drafts || [],
        source_registry: frozenSourceContext,
      } : undefined,
      ontology_object_set: ontologyContext,
      method_candidates: methodCandidatesForPrompt(
        kind,
        upstream,
        run.question,
      ),
      knowledge_files: knowledge.files,
      knowledge_context: knowledge.context,
    },
    null,
    2,
  );
  const artifact = createArtifact(runId, kind, {
    status: "running",
    prompt_version: PROMPT_VERSION,
    knowledge_version: knowledge.version,
    input_context: inputContext,
  });
  try {
    const client = new ResearchModelClient(kind === "independent_review" ? "reviewer" : "producer");
    const useOntologyTools = kind === "stage_02" || kind === "stage_03" || kind === "stage_04";
    const result = await client.generate(kind as SchemaKind, promptFor(kind), inputContext, {
      webSearch: kind === "stage_03",
      ontologyTools: useOntologyTools,
      runId,
      validateOutput: (data) => validateGeneratedSemanticDraft(runId, kind, data),
    });
    const data: any = result.data;
    if (getArtifact(artifact.id)?.status !== "running") {
      throw new Error("GENERATION_LEASE_LOST: 当前生成已被超时恢复流程取代，禁止旧请求写回");
    }
    if (kind === "independent_review") {
      const reviewed = latestArtifact(runId, "stage_04", ["approved"])!;
      data.reviewed_stage04_artifact_id = reviewed.id;
      data.reviewed_stage04_artifact_hash = createHash("sha256").update(reviewed.json_content).digest("hex");
      const producerModel = reviewed.model_name || "unknown";
      data.reviewer_model = client.model;
      data.producer_model = producerModel;
      data.reviewer_type = "model";
      data.reviewer_attestation = null;
      data.independence_level = producerModel !== "unknown" && producerModel !== client.model ? "independent_model" : "same_model_separate_call";
    }
    if (kind === "stage_01") {
      normalizeStage01Projection(data, run.question);
      schemas.stage_01.parse(data);
    }
    if (kind === "baseline") {
      data.frozen_stage03_artifact_id = frozenEvidenceArtifact!.id;
      data.frozen_stage03_artifact_hash = createHash("sha256").update(frozenEvidenceArtifact!.json_content).digest("hex");
      const frozenUrls = new Set(frozenSources.map((source) => source.normalized_url));
      for (const source of data.sources || []) {
        let normalized = "";
        try { normalized = normalizeUrl(source.url); } catch { normalized = source.url; }
        if (!frozenUrls.has(normalized)) {
          throw new Error(`同证据基线引用了冻结证据包外的来源: ${source.url}`);
        }
      }
    }
    if (kind === "stage_04") {
      const evidence: any = parseJson(latestArtifact(runId, "stage_03", ["approved"])?.json_content || "{}", {});
      const structure: any = parseJson(latestArtifact(runId, "stage_02", ["approved"])?.json_content || "{}", {});
      applyDeterministicRuleEvaluations(data, evidence.evidence_drafts || [], listSources(runId), structure);
    }
    if (kind === "stage_03") {
      const keyMap = new Map<string, string>();
      for (const s of data.sources || []) {
        if (getArtifact(artifact.id)?.status !== "running") {
          throw new Error("GENERATION_LEASE_LOST: 来源抓取期间生成租约已失效");
        }
        const snapshot = await captureSourceSnapshot({ url: s.url, locator: s.locator, source_quote: s.source_quote });
        if (getArtifact(artifact.id)?.status !== "running") {
          throw new Error("GENERATION_LEASE_LOST: 来源抓取完成后生成租约已失效");
        }
        const saved = upsertSource(runId, {
          url: s.url,
          title: s.title,
          publisher: s.publisher,
          published_at: s.published_at,
          source_type: s.source_type,
          source_tier: s.source_tier,
          search_excerpt: s.search_excerpt,
          locator: snapshot.locator,
          captured_at: snapshot.captured_at,
          content_hash: snapshot.content_hash,
          usability_status: snapshot.usability_status,
          failure_category: snapshot.failure_category,
          failure_detail: snapshot.failure_detail,
          final_url: snapshot.final_url,
          content_mime: snapshot.content_mime,
          http_status: snapshot.http_status,
          retrieval_status: snapshot.retrieval_status,
          snapshot_text: snapshot.snapshot_text,
          source_quote: snapshot.source_quote,
          quote_verified: snapshot.quote_verified,
        });
        Object.assign(s, {
          source_id: saved.id,
          captured_at: snapshot.captured_at,
          content_hash: snapshot.content_hash,
          final_url: snapshot.final_url,
          retrieval_status: snapshot.retrieval_status,
          quote_verified: snapshot.quote_verified,
        });
        keyMap.set(s.source_key, saved.id);
      }
      for (const e of data.evidence_drafts || []) {
        e.source_ids = (e.source_keys || []).map((k: string) => keyMap.get(k)).filter(Boolean);
      }
    }
    if (kind === "stage_05") {
      const judgmentArtifact = latestArtifact(runId, "stage_04", ["approved"])!;
      normalizeStage05Projection(data, parseJson<any>(judgmentArtifact.json_content, {}), run.question, listSources(runId));
      schemas.stage_05.parse(data);
    }
    const completed = updateArtifactIfStatus(artifact.id, "running", {
      status: "needs_review",
      json_content: JSON.stringify(data, null, 2),
      markdown_content: data.document_markdown || "",
      model_name: client.model,
      raw_model_output: result.raw,
      response_id: result.responseId,
      token_usage: JSON.stringify(result.usage),
      tool_usage: JSON.stringify(result.toolUsage),
      error_message: null,
    });
    if (!completed) throw new Error("GENERATION_LEASE_LOST: 生成完成前租约已失效，旧请求不得恢复为可审阅产物");
    syncReviewWorkItems(completed, data);
    return completed;
  } catch (error) {
    const failureCategory = classifyRuntimeFailure(error);
    updateArtifactIfStatus(artifact.id, "running", {
      status: "failed",
      error_message: `[${failureCategory}] ${error instanceof Error ? error.message : String(error)}`,
      tool_usage: JSON.stringify({ failure_category: failureCategory }),
    });
    throw error;
  }
}

export function cancelGeneration(artifactId: string) {
  const artifact = getArtifact(artifactId);
  if (!artifact) throw new Error("产物不存在");
  if (artifact.status !== "running") throw new Error("只有运行中的生成可以取消");
  const cancelled = updateArtifactIfStatus(artifactId, "running", {
    status: "failed",
    error_message: "[model_output_error] GENERATION_CANCELLED: 用户取消了本次生成，旧请求不得写回",
    tool_usage: JSON.stringify({ failure_category: "model_output_error", cancelled_by_user: true }),
  });
  if (!cancelled) throw new Error("生成状态已变化，请刷新后重试");
  return cancelled;
}

export async function applyIncrementalChangeSet(runId: string, rawChangeSet: ChangeSet) {
  const run = getRun(runId);
  if (!run?.parent_run_id || !run.trigger_event_id) throw new Error("只有事件触发的子运行可以应用 ChangeSet");
  const changeSet = changeSetSchema.parse(rawChangeSet);
  if (changeSet.trigger_event_id !== run.trigger_event_id) throw new Error("ChangeSet 的触发事件与当前子运行不一致");
  const stage = changeSet.target_stage;
  const baseArtifact = latestArtifact(runId, stage, ["approved", "needs_review"])
    || latestArtifact(run.parent_run_id, stage, ["approved"]);
  if (!baseArtifact) throw new Error(`${stage} 没有可继承的完整快照`);
  if (changeSet.base_artifact_id !== baseArtifact.id) throw new Error("ChangeSet 的父产物版本已过期");
  const baseHash = createHash("sha256").update(baseArtifact.json_content).digest("hex");
  if (changeSet.base_artifact_hash !== baseHash) throw new Error("ChangeSet 的父产物 hash 不匹配");
  const nextAttempt = (latestArtifact(runId, stage)?.version || 0) + 1;
  if (changeSet.target_attempt !== nextAttempt) throw new Error(`ChangeSet target_attempt 应为 ${nextAttempt}`);
  const graphVersion = latestArtifact(runId, "instance_graph", ["approved"])?.version || 0;
  if (changeSet.expected_graph_version !== graphVersion) throw new Error(`图版本冲突：期望 ${changeSet.expected_graph_version}，当前 ${graphVersion}`);
  const merged: any = mergeChangeSet(parseJson(baseArtifact.json_content, {}), changeSet);

  if (stage === "stage_03") {
    const affected = new Set(changeSet.affected_object_refs);
    const existingSources = listSources(runId);
    const sourceKeyMap = new Map<string, string>();
    for (const source of merged.sources || []) {
      if (!source?.source_key || !source?.url) continue;
      if (!affected.has(source.source_key) && source.source_id) {
        sourceKeyMap.set(source.source_key, source.source_id);
        continue;
      }
      if (!affected.has(source.source_key)) {
        let normalized = "";
        try { normalized = normalizeUrl(source.url); } catch { normalized = source.url; }
        const existing = existingSources.find((item) => item.normalized_url === normalized);
        if (existing) {
          source.source_id = existing.id;
          sourceKeyMap.set(source.source_key, existing.id);
          continue;
        }
      }
      // ChangeSet 中的 hash、可用性和抓取时间均是不可信输入；必须重新取得原文后由 Runtime 计算。
      const snapshot = await captureSourceSnapshot({
        url: source.url,
        locator: source.locator,
        source_quote: source.source_quote,
      });
      const saved = upsertSource(runId, {
        url: source.url,
        title: source.title || source.url,
        publisher: source.publisher || "",
        published_at: source.published_at || null,
        source_type: source.source_type || "incremental_source",
        source_tier: source.source_tier || "S8",
        search_excerpt: source.search_excerpt || "",
        locator: snapshot.locator,
        captured_at: snapshot.captured_at,
        content_hash: snapshot.content_hash,
        usability_status: snapshot.usability_status,
        failure_category: snapshot.failure_category,
        failure_detail: snapshot.failure_detail,
        final_url: snapshot.final_url,
        content_mime: snapshot.content_mime,
        http_status: snapshot.http_status,
        retrieval_status: snapshot.retrieval_status,
        snapshot_text: snapshot.snapshot_text,
        source_quote: snapshot.source_quote,
        quote_verified: snapshot.quote_verified,
      });
      Object.assign(source, {
        source_id: saved.id,
        captured_at: snapshot.captured_at,
        content_hash: snapshot.content_hash,
        final_url: snapshot.final_url,
        retrieval_status: snapshot.retrieval_status,
        usability_status: snapshot.usability_status,
        quote_verified: snapshot.quote_verified,
      });
      sourceKeyMap.set(source.source_key, saved.id);
    }
    for (const evidence of merged.evidence_drafts || []) {
      evidence.source_ids = (evidence.source_keys || []).map((key: string) => sourceKeyMap.get(key)).filter(Boolean);
    }
  }
  schemas[stage].parse(merged);
  const loadedGraph = loadGraphForRun(runId, run.package_path);
  const graphRefs = changeSet.affected_object_refs.map((ref) => {
    const source = (merged.sources || []).find((item: any) => String(item.source_key) === ref);
    return String(source?.source_id || ref);
  });
  const invalidation = markReachableDownstreamStale(loadedGraph.graph, graphRefs);
  if (invalidation.stale_object_ids.length) {
    saveInstanceGraph(runId, {
      provisional: false,
      invalidated_by_change_set: true,
      trigger_event_id: changeSet.trigger_event_id,
      affected_stage_refs: changeSet.affected_stage_refs,
      stale_object_ids: invalidation.stale_object_ids,
      business_instance_graph: invalidation.graph,
    }, `ChangeSet 只使 ${invalidation.stale_object_ids.length} 个可达对象 stale`);
  }
  supersedeDownstream(runId, Number(stage.slice(-2)));
  const artifact = createArtifact(runId, stage, {
    status: "needs_review",
    json_content: JSON.stringify(merged, null, 2),
    markdown_content: merged.document_markdown || baseArtifact.markdown_content,
    prompt_version: `${PROMPT_VERSION}:changeset`,
    input_context: JSON.stringify({ inherited_artifact_id: baseArtifact.id, change_set: changeSet }, null, 2),
  });
  syncReviewWorkItems(artifact, merged);
  return artifact;
}

export function editArtifact(id: string, jsonContent: string, markdownContent: string) {
  const artifact = getArtifact(id);
  if (!artifact) throw new Error("产物不存在");
  const schema = schemas[artifact.kind as SchemaKind];
  if (schema) schema.parse(JSON.parse(jsonContent));
  const stage = stageNumber(artifact.kind);
  if (stage) supersedeDownstream(artifact.run_id, stage);
  if (artifact.status === "approved" || artifact.status === "superseded") {
    const next = createArtifact(artifact.run_id, artifact.kind, {
      status: "needs_review",
      json_content: jsonContent,
      markdown_content: markdownContent,
      model_name: artifact.model_name,
      prompt_version: artifact.prompt_version,
      knowledge_version: artifact.knowledge_version,
      input_context: artifact.input_context,
      raw_model_output: artifact.raw_model_output,
      response_id: artifact.response_id,
      token_usage: artifact.token_usage,
      tool_usage: artifact.tool_usage,
    });
    if (["stage_03", "stage_04", "independent_review"].includes(next.kind)) syncReviewWorkItems(next, JSON.parse(jsonContent));
    return next;
  }
  return updateArtifact(id, {
    json_content: jsonContent,
    markdown_content: markdownContent,
    status: "needs_review",
    approved_at: null,
  });
}
