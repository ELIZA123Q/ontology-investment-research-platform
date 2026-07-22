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
import { accumulateTokenUsage, createResearchModelClient } from "../adapters/deepseek";
import { generationLeaseMs } from "../adapters/model_provider";
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
  methodRoutesForPrompt,
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
import { classifyRuntimeFailure, compactStructuredArtifact, formatRuntimeFailureMessage } from "./workflow_support";
import { buildGenerationProgressHeartbeat, parseGenerationProgress } from "./generation_progress";
import {
  applyStage03SourceSnapshots,
  findUnchangedEvidenceIds,
  runEvidenceSupplementRound,
  stage03AutoSupplementMaxRounds,
} from "./evidence_auto_supplement";
import { computeSourceCoverage, evaluateEvidenceStopCondition } from "./source_coverage";
import { projectEvidenceRequirementsFromStructure } from "./structure_candidates";
import { resolveResearchJobReview } from "../adapters/research_jobs";

export {
  classifyRuntimeFailure,
  compactStructuredArtifact,
  formatRuntimeFailureMessage,
  type RuntimeFailureCategory,
} from "./workflow_support";

export {
  validateOntologyVariableBindings,
  validateApproval,
  methodCandidatesForPrompt,
  sourcesForPrompt,
  sourceForFrozenBaseline,
  normalizeBusinessCutoff,
  stageNumber,
  editArtifact,
  validateGeneratedSemanticDraft,
} from "./workflow_shared";

export {
  normalizeStage01Projection,
  createStage01DeterministicProjection,
  createControlledStructureProjection,
  buildEvidenceGapFallback,
  repairEvidencePreparationDraft,
  createEvidenceGapFallback,
  createControlledEvidenceProjection,
  createControlledJudgmentProjection,
  buildJudgmentGapFallback,
  createJudgmentGapFallback,
  normalizeStage05Projection,
  createStage05DeterministicProjection,
  createControlledIndependentReview,
} from "./workflow_projections";

export {
  reviseRunStage,
  validateStage02ForApproval,
  heuristicStructureIssues,
  approvedDownstreamStages,
  activeSceneToDefaultStage,
  normalizeTargetStage,
} from "./workflow_revise";

import {
  methodCandidatesForPrompt,
  normalizeBusinessCutoff,
  sourcesForPrompt,
  sourceForFrozenBaseline,
  stageNumber,
  validateApproval,
  validateGeneratedSemanticDraft,
  validateOntologyVariableBindings,
} from "./workflow_shared";
import {
  createControlledEvidenceProjection,
  createControlledIndependentReview,
  createControlledJudgmentProjection,
  createControlledStructureProjection,
  createEvidenceGapFallback,
  createJudgmentGapFallback,
  createStage01DeterministicProjection,
  createStage05DeterministicProjection,
  normalizeStage01Projection,
  normalizeStage05Projection,
  repairEvidencePreparationDraft,
} from "./workflow_projections";

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
    resolveResearchJobReview(artifact.id, true);
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

export async function generateArtifact(
  runId: string,
  kind: ArtifactKind,
  options?: {
    mode?: "regenerate" | "evidence_supplement";
    maxAutoRounds?: number;
    maxSourceCount?: number;
    executionLease?: {
      assertActive(): void;
      onArtifactCreated?(artifactId: string): void;
    };
  },
) {
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
    const leaseMs = generationLeaseMs();
    const ageMs = Date.now() - Date.parse(running.created_at);
    if (Number.isFinite(ageMs) && ageMs < leaseMs + 60_000) {
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
      judgment_method_routes: kind === "stage_02" || kind === "stage_03" || kind === "stage_04"
        ? methodRoutesForPrompt()
        : undefined,
      knowledge_files: knowledge.files,
      knowledge_context: knowledge.context,
    },
    null,
    2,
  );
  const client = createResearchModelClient(kind === "independent_review" ? "reviewer" : "producer");
  const artifact = createArtifact(runId, kind, {
    status: "running",
    prompt_version: PROMPT_VERSION,
    knowledge_version: knowledge.version,
    input_context: inputContext,
    model_name: client.model,
  });
  try {
    options?.executionLease?.onArtifactCreated?.(artifact.id);
  } catch (error) {
    updateArtifactIfStatus(artifact.id, "running", {
      status: "failed",
      error_message: "[model_output_error] GENERATION_LEASE_LOST: 新产物无法绑定到当前 job 租约",
    });
    throw error;
  }

  const runModelJob = async () => {
    const startedAt = new Date().toISOString();
    let lastHeartbeatJson = JSON.stringify({
      in_progress: true,
      phase: "model_round",
      round: 0,
      max_rounds: 0,
      tool_names: [],
      heartbeat_at: startedAt,
      started_at: startedAt,
      elapsed_ms: 0,
      message: "已开始生成，等待首轮模型响应",
    });
    updateArtifactIfStatus(artifact.id, "running", { tool_usage: lastHeartbeatJson });
    try {
      const assertRunning = () => {
        options?.executionLease?.assertActive();
        if (getArtifact(artifact.id)?.status !== "running") {
          throw new Error("GENERATION_LEASE_LOST: 当前生成已被超时恢复流程取代，禁止旧请求写回");
        }
      };
      const writeCoverageHeartbeat = (
        autoRound: number,
        maxRounds: number,
        coverage: { coverage_rate: number; verification_rate: number; coverage_gap_count: number },
        message: string,
      ) => {
        const heartbeat = {
          ...buildGenerationProgressHeartbeat({
            phase: "coverage_pass",
            round: autoRound,
            max_rounds: maxRounds,
            tool_names: [],
            message,
          }, startedAt),
          auto_round: autoRound,
          max_auto_rounds: maxRounds,
          coverage_rate: coverage.coverage_rate,
          verification_rate: coverage.verification_rate,
          coverage_gap_count: coverage.coverage_gap_count,
        };
        lastHeartbeatJson = JSON.stringify(heartbeat);
        updateArtifactIfStatus(artifact.id, "running", { tool_usage: lastHeartbeatJson });
      };

      const stage03Mode = kind === "stage_03" ? (options?.mode ?? "regenerate") : undefined;
      const maxAutoRounds = kind === "stage_03" ? (options?.maxAutoRounds ?? stage03AutoSupplementMaxRounds()) : 1;
      let inheritFromArtifactId: string | undefined;
      let initialBaseData: any | undefined;
      let result: Awaited<ReturnType<typeof client.generate>> | null = null;
      let cumulativeUsage: unknown = {};
      let data: any;
      const structureData: any = kind === "stage_03"
        ? parseJson(latestArtifact(runId, "stage_02", ["approved"])!.json_content, {})
        : {};
      const evidenceRequirements = kind === "stage_03"
        ? projectEvidenceRequirementsFromStructure({
          units: structureData.judgment_units || [],
          counter_evidence_directions: structureData.counter_evidence_directions,
        })
        : [];
      const cutoffMs = kind === "stage_03"
        ? (() => {
          const normalized = normalizeBusinessCutoff(taskContext?.time_scope?.as_of);
          if (!normalized) return undefined;
          const parsed = Date.parse(normalized);
          return Number.isFinite(parsed) ? parsed : undefined;
        })()
        : undefined;
      const supplementContext = { upstream, question: run.question, domain: run.domain };

      if (kind === "stage_03" && stage03Mode === "evidence_supplement") {
        const baseArtifact = latestArtifact(runId, "stage_03", ["needs_review", "approved"]);
        if (!baseArtifact) throw new Error("尚无证据稿件可补充，请先生成全量证据");
        inheritFromArtifactId = baseArtifact.id;
        initialBaseData = parseJson(baseArtifact.json_content, {});
        const supplement = await runEvidenceSupplementRound({
          client,
          runId,
          baseData: initialBaseData,
          supplementContext,
          assertRunning,
          onProgress: (event) => {
            const heartbeat = buildGenerationProgressHeartbeat({
              phase: "model_round",
              round: event.round,
              max_rounds: maxAutoRounds,
              tool_names: [],
              message: event.message,
            }, startedAt);
            lastHeartbeatJson = JSON.stringify({ ...heartbeat, auto_round: 1, max_auto_rounds: maxAutoRounds });
            updateArtifactIfStatus(artifact.id, "running", { tool_usage: lastHeartbeatJson });
          },
          existingSources: listSources(runId),
          maxSourceCount: options?.maxSourceCount,
          requirements: evidenceRequirements,
          cutoffMs,
        });
        data = supplement.data;
        cumulativeUsage = accumulateTokenUsage(cumulativeUsage, supplement.usage);
      } else {
        const useOntologyTools = kind === "stage_02" || kind === "stage_03" || kind === "stage_04";
        result = await client.generate(kind as SchemaKind, promptFor(kind), inputContext, {
          webSearch: kind === "stage_03",
          ontologyTools: useOntologyTools,
          runId,
          validateOutput: (draft) => validateGeneratedSemanticDraft(runId, kind, draft),
          repairOutput: kind === "stage_03"
            ? (draft) => repairEvidencePreparationDraft(draft)
            : undefined,
          onProgress: (event) => {
            assertRunning();
            const heartbeat = buildGenerationProgressHeartbeat(event, startedAt);
            lastHeartbeatJson = JSON.stringify(heartbeat);
            updateArtifactIfStatus(artifact.id, "running", { tool_usage: lastHeartbeatJson });
          },
        });
        cumulativeUsage = accumulateTokenUsage(cumulativeUsage, result.usage);
        data = result.data;
        assertRunning();
        if (kind === "stage_03") {
          const affectedRefs = new Set<string>(
            (data.sources || []).map((source: any) => String(source.source_key || "")).filter(Boolean),
          );
          data = await applyStage03SourceSnapshots({
            runId,
            data,
            affectedRefs,
            existingSources: listSources(runId),
            maxNewSources: options?.maxSourceCount === undefined
              ? undefined
              : Math.max(0, options.maxSourceCount - listSources(runId).length),
            assertRunning,
            onCaptureProgress: (index, total) => {
              const captureHeartbeat = buildGenerationProgressHeartbeat({
                phase: "tool_call",
                round: index,
                max_rounds: Math.max(total, 1),
                tool_names: ["capture_source_snapshot"],
                last_tool: "capture_source_snapshot",
                message: `正在冻结来源 ${index}/${total || 1}`,
              }, startedAt);
              lastHeartbeatJson = JSON.stringify(captureHeartbeat);
              updateArtifactIfStatus(artifact.id, "running", { tool_usage: lastHeartbeatJson });
            },
          });
        }
      }

      assertRunning();
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
        let autoRound = 1;
        let previousGapCount: number | undefined;
        while (autoRound < maxAutoRounds) {
          const coverage = computeSourceCoverage({
            sources: listSources(runId),
            evidence: data.evidence_drafts || [],
            requirements: evidenceRequirements,
            cutoffMs,
          });
          writeCoverageHeartbeat(
            autoRound,
            maxAutoRounds,
            coverage,
            `第 ${autoRound}/${maxAutoRounds} 轮后评估：覆盖率 ${(coverage.coverage_rate * 100).toFixed(0)}%，核验率 ${(coverage.verification_rate * 100).toFixed(0)}%`,
          );
          const stop = evaluateEvidenceStopCondition(coverage, previousGapCount);
          if (stop.shouldStop) break;
          previousGapCount = coverage.coverage_gap_count;
          autoRound += 1;
          const supplement = await runEvidenceSupplementRound({
            client,
            runId,
            baseData: data,
            supplementContext,
            assertRunning,
            onProgress: (event) => {
              const heartbeat = buildGenerationProgressHeartbeat({
                phase: "model_round",
                round: event.round,
                max_rounds: maxAutoRounds,
                tool_names: [],
                message: event.message,
              }, startedAt);
              lastHeartbeatJson = JSON.stringify({
                ...heartbeat,
                auto_round: autoRound,
                max_auto_rounds: maxAutoRounds,
              });
              updateArtifactIfStatus(artifact.id, "running", { tool_usage: lastHeartbeatJson });
            },
            existingSources: listSources(runId),
            maxSourceCount: options?.maxSourceCount,
            requirements: evidenceRequirements,
            cutoffMs,
          });
          data = supplement.data;
          cumulativeUsage = accumulateTokenUsage(cumulativeUsage, supplement.usage);
        }
        schemas.stage_03.parse(data);
      }
      if (kind === "stage_05") {
        const judgmentArtifact = latestArtifact(runId, "stage_04", ["approved"])!;
        normalizeStage05Projection(data, parseJson<any>(judgmentArtifact.json_content, {}), run.question, listSources(runId));
        schemas.stage_05.parse(data);
      }
      assertRunning();
      const completed = updateArtifactIfStatus(artifact.id, "running", {
        status: "needs_review",
        json_content: JSON.stringify(data, null, 2),
        markdown_content: data.document_markdown || "",
        model_name: client.model,
        raw_model_output: result?.raw || JSON.stringify(data),
        response_id: result?.responseId || null,
        token_usage: JSON.stringify(cumulativeUsage),
        tool_usage: result?.toolUsage ? JSON.stringify(result.toolUsage) : lastHeartbeatJson,
        error_message: null,
      });
      if (!completed) throw new Error("GENERATION_LEASE_LOST: 生成完成前租约已失效，旧请求不得恢复为可审阅产物");
      syncReviewWorkItems(completed, data, inheritFromArtifactId && initialBaseData ? {
        inheritFromArtifactId,
        unchangedEvidenceIds: findUnchangedEvidenceIds(initialBaseData.evidence_drafts || [], data.evidence_drafts || []),
      } : undefined);
      return completed;
    } catch (error) {
      const failureCategory = classifyRuntimeFailure(error);
      const lastProgress = parseGenerationProgress(lastHeartbeatJson);
      updateArtifactIfStatus(artifact.id, "running", {
        status: "failed",
        error_message: `[${failureCategory}] ${formatRuntimeFailureMessage(error)}`,
        tool_usage: JSON.stringify({
          failure_category: failureCategory,
          ...(lastProgress ? {
            last_progress: {
              phase: lastProgress.phase,
              round: lastProgress.round,
              max_rounds: lastProgress.max_rounds,
              tool_names: lastProgress.tool_names,
              last_tool: lastProgress.last_tool,
              heartbeat_at: lastProgress.heartbeat_at,
              elapsed_ms: lastProgress.elapsed_ms,
              message: lastProgress.message,
            },
          } : {}),
        }),
      });
      throw error;
    }
  };

  return runModelJob();
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
