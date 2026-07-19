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
  supersedeWorkItemsForArtifact,
  updateArtifact,
  upsertSource,
  upsertWorkItem,
} from "../adapters/db";
import { loadKnowledge } from "./knowledge";
import { ResearchModelClient } from "../adapters/deepseek";
import { promptFor, PROMPT_VERSION } from "./prompts";
import { schemas, type SchemaKind } from "./schemas";
import { ontologyContextForPrompt } from "./ontology_tools";
import { emptyGraph, loadGraphForRun, markReachableDownstreamStale, materializeStageIntoGraph } from "./instance_graph";
import {
  validateExpressionMethodBindings,
  validateJudgmentMethodBindings,
  validateMethodApplications,
} from "./method_application";
import {
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

function stageNumber(kind: ArtifactKind) {
  return kind.startsWith("stage_") ? Number(kind.slice(-2)) : 0;
}

export function validateApproval(artifact: Artifact) {
  const schema = schemas[artifact.kind as SchemaKind];
  if (schema) schema.parse(parseJson(artifact.json_content, {}));
  const data: any = parseJson(artifact.json_content, {});
  if (artifact.kind === "stage_02") {
    validateMethodApplications("stage_02", data.method_applications as MethodApplication[]);
    validateRegisteredMethodApplications(data.method_applications as MethodApplication[]);
    validateMethodRoutes(data.method_applications as MethodApplication[], data.judgment_units || []);
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
    if (data.reviewer_model === data.producer_model || data.independence_level !== "independent_model") {
      throw new Error("独立审阅必须使用与生产阶段不同的模型");
    }
    if ((data.verdict === "pass" && data.issues.length) || (data.verdict === "rework" && !data.issues.length)) {
      throw new Error("独立审阅 verdict 与 issues 不一致");
    }
  }
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
  const sources = isEvidenceConsumer && approvedEvidence
    ? evidenceBoundSources(allSources, approvedEvidence)
    : allSources;
  const sourceContext = sources.map((source) => ({
    ...source,
    snapshot_text: (source.snapshot_text || "").slice(0, 12_000),
  }));
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
        source_registry: sourceContext,
      } : undefined,
      ontology_object_set: ontologyContext,
      method_candidates: ["stage_02", "stage_03", "stage_04"].includes(kind)
        ? registeredMethodCandidates()
        : [],
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
    });
    const data: any = result.data;
    if (kind === "independent_review") {
      const reviewed = latestArtifact(runId, "stage_04", ["approved"])!;
      data.reviewed_stage04_artifact_id = reviewed.id;
      data.reviewed_stage04_artifact_hash = createHash("sha256").update(reviewed.json_content).digest("hex");
      const producerModel = reviewed.model_name || "unknown";
      data.reviewer_model = client.model;
      data.producer_model = producerModel;
      data.independence_level = producerModel !== "unknown" && producerModel !== client.model ? "independent_model" : "same_model_separate_call";
    }
    if (kind === "baseline") {
      data.frozen_stage03_artifact_id = frozenEvidenceArtifact!.id;
      data.frozen_stage03_artifact_hash = createHash("sha256").update(frozenEvidenceArtifact!.json_content).digest("hex");
      const frozenUrls = new Set(sources.map((source) => source.normalized_url));
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
        const snapshot = await captureSourceSnapshot({ url: s.url, locator: s.locator, source_quote: s.source_quote });
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
      const used = new Set((data.report_claims || []).flatMap((x: any) => x.source_ids || []));
      const refs = listSources(runId).filter((s) => used.has(s.id));
      if (refs.length) {
        data.document_markdown += `\n\n## 主要资料来源\n\n${refs.map((s) => `- [${s.title}](${s.url})`).join("\n")}`;
      }
    }
    const completed = updateArtifact(artifact.id, {
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
    syncReviewWorkItems(completed, data);
    return completed;
  } catch (error) {
    const failureCategory = classifyRuntimeFailure(error);
    updateArtifact(artifact.id, {
      status: "failed",
      error_message: `[${failureCategory}] ${error instanceof Error ? error.message : String(error)}`,
      tool_usage: JSON.stringify({ failure_category: failureCategory }),
    });
    throw error;
  }
}

export function compactStructuredArtifact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compactStructuredArtifact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "document_markdown")
      .map(([key, item]) => [key, compactStructuredArtifact(item)]),
  );
}

export type RuntimeFailureCategory =
  | "model_output_error"
  | "source_acquisition_failure"
  | "method_not_applicable"
  | "evidence_insufficient"
  | "contract_implementation_error";

export function classifyRuntimeFailure(error: unknown): RuntimeFailureCategory {
  const message = error instanceof Error ? error.message : String(error);
  if (/MODEL_TIMEOUT|DeepSeek.*超时/i.test(message)) return "model_output_error";
  if (/证据不足|缺少有效来源|insufficient evidence|source_ids|判断超过证据上限|证据上限/i.test(message)) return "evidence_insufficient";
  if (/方法.*不适用|method.*not applicable|precondition.*fail/i.test(message)) return "method_not_applicable";
  if (/web_search|fetch|network|timeout|ECONN|ENOTFOUND|来源取得|网页/i.test(message)) return "source_acquisition_failure";
  if (/schema|contract|合同|不存在的判断|未绑定|结构校验|validation|确定性本体规则|直接连接|端点类型/i.test(message)) return "contract_implementation_error";
  return "model_output_error";
}

function syncReviewWorkItems(artifact: Artifact, data: any) {
  const runId = artifact.run_id;
  const kind = artifact.kind;
  supersedeWorkItemsForArtifact(runId, kind, artifact.id, artifact.version);
  const artifactBinding = { artifact_id: artifact.id, attempt: artifact.version };
  if (kind === "stage_03") {
    for (const evidence of data.evidence_drafts || []) {
      const id = String(evidence.id || "");
      if (!id) continue;
      const isGap = evidence.kind === "gap";
      const isConflict = evidence.kind === "conflict";
      upsertWorkItem({
        run_id: runId,
        kind: isGap ? "supplement_evidence" : isConflict ? "resolve_conflict" : "evidence_review",
        stage: "stage_03",
        target_type: "EvidenceDraft",
        target_id: id,
        title: isGap ? `补齐证据缺口：${evidence.statement}` : `审阅证据：${evidence.statement}`,
        priority: isGap || evidence.kind === "conflict" ? "high" : "medium",
        reason: (evidence.limitations || []).join("；"),
        source_event_id: null,
        ...artifactBinding,
        payload_json: JSON.stringify({ kind: evidence.kind, direction: evidence.direction, judgment_unit_ids: evidence.judgment_unit_ids || [] }),
      });
    }
  }
  if (kind === "stage_04") {
    for (const judgment of data.judgments || []) {
      const id = String(judgment.id || judgment.judgment_id || "");
      if (!id) continue;
      upsertWorkItem({
        run_id: runId,
        kind: "judgment_review",
        stage: "stage_04",
        target_type: "Judgment",
        target_id: id,
        title: `裁决判断：${judgment.title || judgment.conclusion || judgment.statement}`,
        priority: "high",
        reason: (judgment.uncertainties || []).join("；"),
        source_event_id: null,
        ...artifactBinding,
        payload_json: JSON.stringify({ strength: judgment.strength || judgment.level, invalidation_conditions: judgment.invalidation_conditions || [] }),
      });
    }
  }
  if (kind === "independent_review") {
    for (const [index, issue] of (data.issues || []).entries()) {
      const targetId = String(issue.judgment_id || `review-issue-${index + 1}`);
      upsertWorkItem({
        run_id: runId,
        kind: "publish_blocker",
        stage: issue.return_stage || "stage_04",
        target_type: issue.judgment_id ? "Judgment" : "ReviewIssue",
        target_id: targetId,
        title: issue.required_action || issue.description,
        priority: "high",
        reason: issue.description,
        source_event_id: null,
        ...artifactBinding,
        payload_json: JSON.stringify(issue),
      });
    }
  }
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
