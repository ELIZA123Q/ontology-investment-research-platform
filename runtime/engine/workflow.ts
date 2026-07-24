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
import {
  evidenceJudgmentTypeCardsForPrompt,
  executedMethodsSummary,
  buildStageGenerationGuidance,
  judgmentThresholdCapsForPrompt,
  mcpChannelHintsForPrompt,
  methodDisciplineDigest,
} from "./method_guidance";
import {
  attachResearchValueReview,
  buildStage05RetryContext,
  heuristicResearchValueReview,
  mergeResearchValueReviews,
  researchValueReviewPrompt,
  researchValueReviewSchema,
  type ResearchValueReview,
} from "./research_value_review";
import { summarizeInjectedAssets } from "./runtime_asset_coverage";
import {
  applyUpstreamQualityFailure,
  buildQualityRetryNotes,
  collectStageHighQualityErrors,
  forceHighQualityTarget,
  HQ_RETRY_KEY,
  markGenerationBelowHighQuality,
  meetsHighQualityForReview,
  shouldPreserveUpstreamQualityFailure,
} from "./stage_hq_retry";
import { parseJson, STAGES, type Artifact, type ArtifactKind, type MethodApplication, type SourceRecord, type StageKind } from "./types";
import { validateReasoningTraceBindings } from "./reasoning_trace";
import { changeSetSchema, expandAffectedObjectRefs, mergeChangeSet, type ChangeSet } from "./change_set";
import { captureSourceSnapshot } from "./source_snapshot";
import { applyDeterministicRuleEvaluations, assertDeterministicRuleResults } from "./semantic_execution";
import { evidenceBoundSourceIds, evidenceBoundSources } from "./evidence_sources";
import { syncReviewWorkItems } from "./review_work_items";
import { assembleStageContext, buildSemanticRoute, clipUpstreamJsonSoft, CONTEXT_SLOT_BUDGETS } from "./context_assembler";
import { classifyRuntimeFailure, compactStructuredArtifact, compactStage03ForUpstream, formatRuntimeFailureMessage } from "./workflow_support";
import { formalOntologyRuleIds, repairJudgmentPreparationDraft } from "./judgment_draft_normalize";
import { buildGenerationProgressHeartbeat, parseGenerationProgress } from "./generation_progress";
import { evaluateEvidenceQuality } from "./evidence_quality_gate";
import { auditStage05Expressions, sanitizeAuditVoice } from "./expression_audit";
import {
  applyStage03SourceSnapshots,
  findUnchangedEvidenceIds,
  runEvidenceSupplementRound,
  stage03AutoSupplementMaxRounds,
  syncStage03DraftSourcesFromRegistry,
} from "./evidence_auto_supplement";
import { computeSourceCoverage, evaluateEvidenceStopCondition } from "./source_coverage";
import { projectEvidenceRequirementsFromStructure } from "./structure_candidates";
import { resolveResearchJobReview } from "../adapters/research_jobs";

export {
  classifyRuntimeFailure,
  compactStructuredArtifact,
  compactStage03ForUpstream,
  formatRuntimeFailureMessage,
  type RuntimeFailureCategory,
} from "./workflow_support";

export {
  validateOntologyVariableBindings,
  validateApproval,
  methodCandidatesForPrompt,
  upstreamJudgmentTypes,
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
  upstreamJudgmentTypes,
  validateApproval,
  validateGeneratedSemanticDraft,
  validateOntologyVariableBindings,
  editArtifact,
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
import { ensureStage02DocumentFields } from "./stage02_documents";
import { ensureStage03DocumentFields } from "./stage03_documents";
import { ensureStage04DocumentFields } from "./stage04_documents";
import { ensureStage05DocumentFields } from "./stage05_documents";
import { applyClarificationAnswer, applyClarificationAnswers, pendingClarificationQuestion } from "./stage01_contract";
import { syncStage01ReadableMarkdown, syncStage03ReadableMarkdown, syncStage04ReadableMarkdown } from "./readable_markdown";

export function approve(id: string) {
  return withImmediateTransaction(() => {
    let artifact = getArtifact(id);
    if (!artifact) throw new Error("产物不存在");
    if (artifact.status !== "needs_review") throw new Error("只有待确认产物可以确认");
    if (artifact.kind === "stage_03") {
      // Registry 可能被补证/重新取得来源更新；确认前把冻结字段投影回草稿，再做严格核对。
      const synced = syncStage03DraftSourcesFromRegistry(
        parseJson(artifact.json_content, {}),
        listSources(artifact.run_id),
      );
      if (synced.changed) {
        updateArtifact(artifact.id, { json_content: JSON.stringify(synced.data, null, 2) });
        artifact = getArtifact(id)!;
      }
    }
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
  const dependencyStages: Partial<Record<ArtifactKind, StageKind[]>> = {
    stage_01: [],
    stage_02: ["stage_01"],
    stage_03: ["stage_01", "stage_02"],
    stage_04: ["stage_02", "stage_03"],
    stage_05: ["stage_01", "stage_03", "stage_04"],
    baseline: [],
    independent_review: ["stage_02", "stage_03", "stage_04"],
  };
  const upstreamStages = dependencyStages[kind] || [];
  const upstreamRaw = upstreamStages
    .map((s) => latestArtifact(runId, s, ["approved"]))
    .filter(Boolean)
    .map((a) => {
      const raw = parseJson(a!.json_content, {});
      const compressed = a!.kind === "stage_03" && ["stage_04", "stage_05", "independent_review"].includes(kind)
        ? compactStage03ForUpstream(raw)
        : compactStructuredArtifact(raw);
      return {
        artifact_id: a!.id,
        artifact_hash: createHash("sha256").update(a!.json_content).digest("hex"),
        model_name: a!.model_name,
        kind: a!.kind,
        json: compressed,
      };
    });
  const upstreamClip = clipUpstreamJsonSoft(upstreamRaw, CONTEXT_SLOT_BUDGETS.upstream_json_soft);
  const upstream = upstreamClip.value;
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
  const taskContext: any = upstream.find((item) => item.kind === "stage_01")?.json
    || parseJson(latestArtifact(runId, "stage_01", ["approved"])?.json_content || "{}", {});
  const deliveryArchetype = String(
    taskContext?.delivery_archetype?.primary
    || "industry_cycle_report",
  );
  const routePreview = buildSemanticRoute(upstream);
  const ontologyRaw = ontologyContextForPrompt(runId, {
    focusNodeIds: routePreview.ontology_node_ids,
    focusJudgmentUnitIds: routePreview.judgment_unit_ids,
  });
  const assembled = assembleStageContext({
    kind,
    upstream,
    ontologyObjectSet: ontologyRaw,
    deliveryArchetype,
  });
  const judgmentTypesForKnowledge = assembled.semantic_route.judgment_types.length
    ? assembled.semantic_route.judgment_types
    : upstreamJudgmentTypes(upstream);
  const knowledge = {
    version: assembled.knowledge_version,
    context: assembled.knowledge_context,
    files: assembled.knowledge_files,
  };
  const promptSources = sourcesForPrompt(kind, allSources, taskContext?.time_scope?.as_of);
  const sourceContext = promptSources.map((source) => ({
    ...source,
    snapshot_text: (source.snapshot_text || "").slice(0, 12_000),
  }));
  // 同证据基线只能看到 Stage03 已登记的逐字引文，不能从完整快照
  // 额外开采主链未登记的新事实，否则“同证据”比较失真。
  const frozenSourceContext = frozenSources.map(sourceForFrozenBaseline);
  const ontologyContext = assembled.ontology_object_set;
  const frozenEvidenceArtifact = kind === "baseline" ? approvedEvidenceArtifact : undefined;
  const frozenEvidence: any = frozenEvidenceArtifact ? parseJson(frozenEvidenceArtifact.json_content, {}) : undefined;
  const priorStage01 = kind === "stage_01"
    ? latestArtifact(runId, "stage_01", ["needs_review", "approved"])
    : null;
  const priorStage01Data = priorStage01 ? parseJson<any>(priorStage01.json_content, {}) : null;
  const methodCandidates = methodCandidatesForPrompt(kind, upstream, run.question);
  // C1 修复：将方法关键纪律提取为文本，注入 system prompt 前面，避免模型忽略 JSON 深处的方法正文
  const methodDigest = (kind === "stage_02" || kind === "stage_03" || kind === "stage_04")
    ? methodDisciplineDigest(methodCandidates)
    : "";
  const systemPrompt = methodDigest ? `${promptFor(kind)}\n\n${methodDigest}` : promptFor(kind);
  const stageGuidance = (kind === "stage_02" || kind === "stage_03" || kind === "stage_04")
    ? buildStageGenerationGuidance({
      kind,
      candidates: methodCandidates,
      taskText: run.question,
    })
    : undefined;
  const selectedMethodGuidance = stageGuidance?.selected_method_guidance;
  const scenarioCardIds = stageGuidance?.scenario_card_ids || [];
  const stage04Json: any = kind === "stage_05"
    ? (upstream.find((item) => item.kind === "stage_04")?.json
      || parseJson(latestArtifact(runId, "stage_04", ["approved"])?.json_content || "{}", {}))
    : undefined;
  const injectedAssets = summarizeInjectedAssets({
    knowledge_files: knowledge.files,
    method_guidance: selectedMethodGuidance,
    scenario_card_ids: scenarioCardIds,
    structured_keys: [
      kind === "stage_03" || kind === "stage_04" ? "judgment_method_routes" : "",
      kind === "stage_03" || kind === "stage_04" ? "judgment_threshold_caps" : "",
      kind === "stage_03" ? "mcp_channel_hints" : "",
      kind === "stage_05" ? "expression_permission_from_04" : "",
      kind === "stage_05" ? "executed_methods_summary" : "",
    ].filter(Boolean),
  });
  const inputContext = JSON.stringify(
    {
      question: run.question,
      domain: run.domain,
      package_path: run.package_path,
      upstream,
      semantic_route: assembled.semantic_route,
      context_assembly: {
        note: assembled.assembly_note,
        budgets: assembled.budgets,
        knowledge_version: assembled.knowledge_version,
        injected_assets: injectedAssets,
        upstream_json: {
          clipped: upstreamClip.clipped,
          original_chars: upstreamClip.original_chars,
          final_chars: upstreamClip.final_chars,
        },
      },
      clarification_state: kind === "stage_01" && priorStage01Data
        ? {
          previous_artifact_id: priorStage01?.id,
          task_disposition: priorStage01Data.task_disposition,
          input_resolution: priorStage01Data.input_resolution,
          pending_question: pendingClarificationQuestion(priorStage01Data),
          pending_questions: (priorStage01Data?.input_resolution?.clarifications || [])
            .filter((item: any) => !item?.answer),
        }
        : undefined,
      sources: kind === "baseline" ? undefined : sourceContext,
      frozen_evidence: kind === "baseline" ? {
        artifact_id: frozenEvidenceArtifact?.id,
        artifact_version: frozenEvidenceArtifact?.version,
        artifact_hash: frozenEvidenceArtifact ? createHash("sha256").update(frozenEvidenceArtifact.json_content).digest("hex") : null,
        evidence_drafts: frozenEvidence?.evidence_drafts || [],
        source_registry: frozenSourceContext,
      } : undefined,
      ontology_object_set: ontologyContext,
      method_candidates: methodCandidates,
      selected_method_guidance: selectedMethodGuidance,
      scenario_card_ids: scenarioCardIds.length ? scenarioCardIds : undefined,
      judgment_method_routes: kind === "stage_02" || kind === "stage_03" || kind === "stage_04"
        ? methodRoutesForPrompt()
        : undefined,
      judgment_threshold_caps: kind === "stage_03" || kind === "stage_04"
        ? judgmentThresholdCapsForPrompt()
        : undefined,
      evidence_judgment_type_cards: kind === "stage_03"
        ? evidenceJudgmentTypeCardsForPrompt(judgmentTypesForKnowledge)
        : undefined,
      mcp_channel_hints: kind === "stage_03" ? mcpChannelHintsForPrompt() : undefined,
      executed_methods_summary: kind === "stage_05"
        ? executedMethodsSummary(
          upstream.flatMap((item) => (item.json as any)?.method_applications || []),
        )
        : undefined,
      expression_permission_from_04: kind === "stage_05"
        ? (stage04Json?.expression_permission || null)
        : undefined,
      formal_ontology_rules: kind === "stage_04" ? [...formalOntologyRuleIds()].sort() : undefined,
      delivery_archetype: kind === "stage_05" ? {
        primary: deliveryArchetype,
        secondary: taskContext?.delivery_archetype?.secondary || [],
        modules: taskContext?.delivery_archetype?.modules || [],
        template_hint: deliveryArchetype === "industry_cycle_report"
          ? "delivery/02_模板/05C_行业周期判断模板.md"
          : deliveryArchetype === "event_commentary"
            ? "delivery/02_模板/05A_事件点评模板.md"
            : deliveryArchetype === "industry_dynamic_commentary"
              ? "delivery/02_模板/05B_行业动态点评模板.md"
              : deliveryArchetype === "company_earnings_commentary"
                ? "delivery/02_模板/05D_公司业绩点评模板.md"
                : deliveryArchetype === "theme_deep_dive"
                  ? "delivery/02_模板/05E_主题深度研究模板.md"
                  : "delivery/02_模板/05C_行业周期判断模板.md",
        expression_standard: "delivery/01_标准/05_投研表达标准.md",
        quality_gate_note: "工作台确认 ≠ PUBLISHABLE；正式发布仍须 governance validate_05_outputs / validate_run。",
      } : undefined,
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
      const supplementContext = {
        upstream,
        question: run.question,
        domain: run.domain,
        judgmentTypes: judgmentTypesForKnowledge,
      };

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
        // Stage04 的 upstream 已含结构/证据；开放 ontologyTools 易陷入 query_object_set/propose_action 空转直至超时。
        const useOntologyTools = kind === "stage_02" || kind === "stage_03";
        result = await client.generate(kind as SchemaKind, systemPrompt, inputContext, {
          webSearch: kind === "stage_03",
          ontologyTools: useOntologyTools,
          // Stage04 无检索工具；测试友好保留较低轮次，但仍给模型几次修正机会。
          maxToolRounds: kind === "stage_04" ? 6 : undefined,
          runId,
          validateOutput: (draft) => validateGeneratedSemanticDraft(runId, kind, draft),
          repairOutput: kind === "stage_03"
            ? (draft) => {
              const repaired = repairEvidencePreparationDraft(draft);
              ensureStage03DocumentFields(repaired, {
                question: run.question,
                taskId: run.id,
                structure: structureData,
              });
              return repaired;
            }
            : kind === "stage_04"
              ? (draft) => {
                const structure: any = parseJson(latestArtifact(runId, "stage_02", ["approved"])?.json_content || "{}", {});
                const repaired = repairJudgmentPreparationDraft(draft, {
                  judgmentUnitIds: (structure.judgment_units || []).map((unit: any) => String(unit.id || "")).filter(Boolean),
                  scopeRef: structure.research_scope?.id || null,
                });
                ensureStage04DocumentFields(repaired, { question: run.question, taskId: run.id });
                return repaired;
              }
              : kind === "stage_02"
                ? (draft) => ensureStage02DocumentFields(draft, { question: run.question, taskId: run.id })
                : kind === "stage_05"
                  ? (draft) => {
                    const stage04: any = parseJson(latestArtifact(runId, "stage_04", ["approved"])?.json_content || "{}", {});
                    return ensureStage05DocumentFields(draft, { question: run.question, taskId: run.id, stage04 });
                  }
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
      if (kind === "stage_02") {
        ensureStage02DocumentFields(data, { question: run.question, taskId: run.id });
        if (!String(data.research_logic_markdown || "").trim() && String(data.document_markdown || "").trim()) {
          data.research_logic_markdown = data.document_markdown;
        }
        if (String(data.research_logic_markdown || "").trim()) {
          data.document_markdown = data.research_logic_markdown;
        }
        ensureStage02DocumentFields(data, { question: run.question, taskId: run.id });
        schemas.stage_02.parse(data);
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
        syncStage04ReadableMarkdown(data, { question: run.question, taskId: run.id });
        schemas.stage_04.parse(data);
      }
      if (kind === "stage_03" && stage03Mode !== "evidence_supplement") {
        // 全量生成后可自动多轮补证；「补充取证」按钮本身已是一轮，再套 max_auto_rounds 会把 token 打爆。
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
      }
      if (kind === "stage_03") {
        data = repairEvidencePreparationDraft(data);
        syncStage03ReadableMarkdown(data, {
          question: run.question,
          taskId: run.id,
          structure: structureData,
        });
        schemas.stage_03.parse(data);

        // A3: 证据最低质量门 - 强制执行（含 Stage02 逐 JU 独立性/反证需求）
        const stage03Requirements = Array.isArray(structureData?.evidence_requirements) && structureData.evidence_requirements.length
          ? structureData.evidence_requirements
          : projectEvidenceRequirementsFromStructure({
            units: structureData?.judgment_units || [],
            counter_evidence_directions: structureData?.counter_evidence_directions,
          });
        const evidenceQuality = evaluateEvidenceQuality({
          evidenceDrafts: data.evidence_drafts || [],
          sources: listSources(runId),
          judgmentUnits: structureData?.judgment_units || [],
          evidenceRequirements: stage03Requirements,
        });
        data.evidence_quality_gate = {
          passed: evidenceQuality.passed,
          quality_status: evidenceQuality.qualityStatus,
          total_evidence: evidenceQuality.totalEvidence,
          source_groups: evidenceQuality.sourceGroups,
          direct_facts: evidenceQuality.directFacts,
          gap_details: evidenceQuality.gapDetails,
          evaluated_at: new Date().toISOString(),
        };
        data.evidence_quality_summary = evidenceQuality.summary;

        if (!evidenceQuality.passed || evidenceQuality.qualityStatus === "return_required") {
          console.warn(`[EVIDENCE:GATE] Stage 03 未通过: ${evidenceQuality.summary}`);
          data.quality_status = "return_required";
          data.return_required = true;
          data.deterministic_check_status = "not_checked";
          data.status_reason = evidenceQuality.summary;
          data.evidence_gap_report = {
            generated_at: new Date().toISOString(),
            reason: "evidence_quality_floor_not_met",
            details: evidenceQuality.gapDetails.filter((d) => d.isBlocking),
            recommendation: "建议手动补证或缩小研究范围后重试",
          };
        } else if (evidenceQuality.qualityStatus === "minimum_pass") {
          // 证据仅达最低流转：不得自称 HQ；确认门禁仍要求 HQ，故标为需补强
          if (String(data.quality_status || "") === "high_quality_pass") {
            data.quality_status = "minimum_pass";
            data.deterministic_check_status = "not_checked";
          }
        }

        // 一手 MCP 硬门禁：登记了非 gap 事实却零 MCP 调用 → 不得 HQ（Bing 不能冒充一手）
        const toolUsage = (result?.toolUsage && typeof result.toolUsage === "object")
          ? result.toolUsage as Record<string, unknown>
          : {};
        const mcpCalls = Number(toolUsage.mcp_evidence_calls || 0);
        const webCalls = Number(toolUsage.web_search_calls || 0);
        const nonGapCount = (Array.isArray(data.evidence_drafts) ? data.evidence_drafts : [])
          .filter((item: any) => String(item?.kind) !== "gap").length;
        data.mcp_channel_usage = {
          mcp_evidence_calls: mcpCalls,
          web_search_calls: webCalls,
          public_page_fetch_calls: Number(toolUsage.public_page_fetch_calls || 0),
          tools: Array.isArray(toolUsage.tools) ? toolUsage.tools : [],
          evaluated_at: new Date().toISOString(),
        };
        if (nonGapCount > 0 && mcpCalls <= 0) {
          console.warn("[MCP:GATE] Stage03 未调用一手 MCP 却登记了非 gap 证据");
          data.quality_status = "return_required";
          data.return_required = true;
          data.deterministic_check_status = "not_checked";
          data.status_reason = "未调用一手 MCP（cninfo/datayes/policy 等）却登记了非 gap 证据；请补 MCP 取证或改为显式 gap";
          data.mcp_channel_usage = {
            ...data.mcp_channel_usage,
            gate: "return_required",
            reason: "non_gap_without_primary_mcp",
          };
        }
      }
      if (kind === "stage_05") {
        const judgmentArtifact = latestArtifact(runId, "stage_04", ["approved"])!;
        const judgmentJson = parseJson<any>(judgmentArtifact.json_content, {});
        // 对齐 claim↔judgment 与审计；保留模型研报正文，不压平为简报。
        normalizeStage05Projection(
          data,
          judgmentJson,
          run.question,
          listSources(runId),
        );
        if (!data.delivery_archetype) data.delivery_archetype = deliveryArchetype;

        let review: ResearchValueReview = heuristicResearchValueReview({
          body: String(data.document_markdown || ""),
          stage01: taskContext,
          research_edge: data.research_edge,
          intensity_lifted: false,
          retry_count: 0,
        });
        // 可选：同一模型按 00A 打分（失败不阻断，保留启发式）。
        try {
          const llmReview = await client.generateStructured(
            "research_value_review",
            researchValueReviewSchema,
            researchValueReviewPrompt(),
            JSON.stringify({
              question: run.question,
              stage01_normalized_question: taskContext?.normalized_question || null,
              document_markdown: String(data.document_markdown || "").slice(0, 24_000),
              research_edge: data.research_edge || [],
            }, null, 2),
            { maxToolRounds: 2 },
          );
          cumulativeUsage = accumulateTokenUsage(cumulativeUsage, llmReview.usage);
          review = {
            status: llmReview.data.status,
            checks: llmReview.data.checks,
            retry_count: 0,
            reviewed_at: new Date().toISOString(),
            mode: "llm",
          };
          // 与启发式取交：任一 fail 则 fail
          const heuristic = heuristicResearchValueReview({
            body: String(data.document_markdown || ""),
            stage01: taskContext,
            research_edge: data.research_edge,
            retry_count: 0,
          });
          const byId = new Map(heuristic.checks.map((item) => [item.id, item]));
          for (const check of review.checks) {
            const prev = byId.get(check.id);
            byId.set(check.id, {
              id: check.id,
              pass: Boolean(prev?.pass) && check.pass,
              evidence_span: check.evidence_span || prev?.evidence_span || "",
              note: check.note || prev?.note || "",
            });
          }
          review = {
            status: [...byId.values()].every((item) => item.pass) ? "pass" : "fail",
            checks: [...byId.values()],
            retry_count: 0,
            reviewed_at: new Date().toISOString(),
            mode: "combined",
          };
        } catch {
          // 模型审查不可用时仅用启发式
        }

        if (review.status === "fail") {
          assertRunning();
          const retryInput = JSON.stringify({
            ...JSON.parse(inputContext),
            research_value_retry_notes: buildStage05RetryContext(review),
          }, null, 2);
          const retryResult = await client.generate(kind as SchemaKind, systemPrompt, retryInput, {
            maxToolRounds: 4,
            runId,
            validateOutput: (draft) => validateGeneratedSemanticDraft(runId, kind, draft),
            repairOutput: (draft) => ensureStage05DocumentFields(draft, {
              question: run.question,
              taskId: run.id,
              stage04: judgmentJson,
            }),
            onProgress: (event) => {
              assertRunning();
              const heartbeat = buildGenerationProgressHeartbeat({
                ...event,
                message: `00A 研究价值重试：${event.message || ""}`,
              }, startedAt);
              lastHeartbeatJson = JSON.stringify(heartbeat);
              updateArtifactIfStatus(artifact.id, "running", { tool_usage: lastHeartbeatJson });
            },
          });
          cumulativeUsage = accumulateTokenUsage(cumulativeUsage, retryResult.usage);
          data = retryResult.data;
          result = retryResult;
          normalizeStage05Projection(
            data,
            judgmentJson,
            run.question,
            listSources(runId),
          );
          if (!data.delivery_archetype) data.delivery_archetype = deliveryArchetype;
          let retryReview = heuristicResearchValueReview({
            body: String(data.document_markdown || ""),
            stage01: taskContext,
            research_edge: data.research_edge,
            retry_count: 1,
          });
          // 重试后仍尝试 LLM 审查；失败则保留启发式，不得静默当过。
          try {
            const llmRetry = await client.generateStructured(
              "research_value_review",
              researchValueReviewSchema,
              researchValueReviewPrompt(),
              JSON.stringify({
                question: run.question,
                stage01_normalized_question: taskContext?.normalized_question || null,
                document_markdown: String(data.document_markdown || "").slice(0, 24_000),
                research_edge: data.research_edge || [],
              }, null, 2),
              { maxToolRounds: 2 },
            );
            cumulativeUsage = accumulateTokenUsage(cumulativeUsage, llmRetry.usage);
            retryReview = mergeResearchValueReviews(retryReview, {
              status: llmRetry.data.status,
              checks: llmRetry.data.checks,
              retry_count: 1,
              reviewed_at: new Date().toISOString(),
              mode: "llm",
            });
            retryReview.retry_count = 1;
            retryReview.mode = "combined";
          } catch {
            // keep heuristic
          }
          review = retryReview;
        }

        attachResearchValueReview(data, review);
        ensureStage05DocumentFields(data, {
          question: run.question,
          taskId: run.id,
          stage04: judgmentJson,
        });

        // A6: 表达审计 - 验证 EX→C 映射、等级一致性、审计腔禁令
        const expressionAudit = auditStage05Expressions(
          data.expressions || [],
          judgmentJson.claims || [],
          judgmentJson.judgments || [],
        );
        data.expression_audit = expressionAudit;

        // 审计腔清洗：05 正文移除 YAML/审计专用术语
        if (data.document_markdown) {
          data.document_markdown = sanitizeAuditVoice(String(data.document_markdown));
        }

        schemas.stage_05.parse(data);
      }

      // 01–05：生成后静默 HQ 门禁；失败则注入失败项再生成一次，仍失败则标为不可确认。
      // 上游硬失败（00A 研究价值 / 证据质量门）禁止 forceHQ + checked 盖章冲掉。
      const stageKindsForHq = new Set(["stage_01", "stage_02", "stage_03", "stage_04", "stage_05"]);
      if (
        stageKindsForHq.has(kind)
        && data
        && typeof data === "object"
        && String(data.task_disposition || "") !== "needs_clarification"
      ) {
        const upstreamLock = shouldPreserveUpstreamQualityFailure(data, kind as ArtifactKind);
        if (upstreamLock.preserve) {
          applyUpstreamQualityFailure(data, upstreamLock.reason);
        } else {
          forceHighQualityTarget(data);
          // 仅在形态检查期间临时假定 checked；通过后才保留，失败由 markGeneration 清回。
          data.deterministic_check_status = "checked";
          let hqErrors = collectStageHighQualityErrors(kind, data);
          if (hqErrors.length && stage03Mode !== "evidence_supplement") {
            assertRunning();
            const retryNotes = buildQualityRetryNotes(hqErrors);
            const retryHeartbeat = buildGenerationProgressHeartbeat({
              phase: "model_round",
              round: 1,
              max_rounds: 2,
              tool_names: [],
              message: "正在按可交接密度标准补强本稿",
            }, startedAt);
            lastHeartbeatJson = JSON.stringify(retryHeartbeat);
            updateArtifactIfStatus(artifact.id, "running", { tool_usage: lastHeartbeatJson });
            const retryInput = JSON.stringify({
              ...JSON.parse(inputContext),
              [HQ_RETRY_KEY]: retryNotes,
            }, null, 2);
            const useOntologyTools = kind === "stage_02" || kind === "stage_03";
            const retryResult = await client.generate(kind as SchemaKind, systemPrompt, retryInput, {
              webSearch: kind === "stage_03",
              ontologyTools: useOntologyTools,
              maxToolRounds: kind === "stage_04" ? 6 : undefined,
              runId,
              validateOutput: (draft) => validateGeneratedSemanticDraft(runId, kind, draft),
              repairOutput: kind === "stage_03"
                ? (draft) => {
                  const repaired = repairEvidencePreparationDraft(draft);
                  ensureStage03DocumentFields(repaired, {
                    question: run.question,
                    taskId: run.id,
                    structure: structureData,
                  });
                  return repaired;
                }
                : kind === "stage_04"
                  ? (draft) => {
                    const structure: any = parseJson(latestArtifact(runId, "stage_02", ["approved"])?.json_content || "{}", {});
                    const repaired = repairJudgmentPreparationDraft(draft, {
                      judgmentUnitIds: (structure.judgment_units || []).map((unit: any) => String(unit.id || "")).filter(Boolean),
                      scopeRef: structure.research_scope?.id || null,
                    });
                    ensureStage04DocumentFields(repaired, { question: run.question, taskId: run.id });
                    return repaired;
                  }
                  : kind === "stage_02"
                    ? (draft) => ensureStage02DocumentFields(draft, { question: run.question, taskId: run.id })
                    : kind === "stage_05"
                      ? (draft) => {
                        const stage04: any = parseJson(latestArtifact(runId, "stage_04", ["approved"])?.json_content || "{}", {});
                        return ensureStage05DocumentFields(draft, { question: run.question, taskId: run.id, stage04 });
                      }
                      : kind === "stage_01"
                        ? (draft) => {
                          normalizeStage01Projection(draft, run.question);
                          return draft;
                        }
                        : undefined,
              onProgress: (event) => {
                assertRunning();
                const heartbeat = buildGenerationProgressHeartbeat({
                  ...event,
                  message: `密度补强：${event.message || ""}`,
                }, startedAt);
                lastHeartbeatJson = JSON.stringify(heartbeat);
                updateArtifactIfStatus(artifact.id, "running", { tool_usage: lastHeartbeatJson });
              },
            });
            cumulativeUsage = accumulateTokenUsage(cumulativeUsage, retryResult.usage);
            data = retryResult.data;
            result = retryResult;
            assertRunning();
            if (kind === "stage_01") {
              normalizeStage01Projection(data, run.question);
              schemas.stage_01.parse(data);
            } else if (kind === "stage_02") {
              ensureStage02DocumentFields(data, { question: run.question, taskId: run.id });
              if (!String(data.research_logic_markdown || "").trim() && String(data.document_markdown || "").trim()) {
                data.research_logic_markdown = data.document_markdown;
              }
              if (String(data.research_logic_markdown || "").trim()) {
                data.document_markdown = data.research_logic_markdown;
              }
              ensureStage02DocumentFields(data, { question: run.question, taskId: run.id });
              schemas.stage_02.parse(data);
            } else if (kind === "stage_03") {
              data = repairEvidencePreparationDraft(data);
              syncStage03ReadableMarkdown(data, {
                question: run.question,
                taskId: run.id,
                structure: structureData,
              });
              ensureStage03DocumentFields(data, {
                question: run.question,
                taskId: run.id,
                structure: structureData,
              });
              // HQ 重试后重新执法证据门，避免补强稿冲掉先前失败态
              const stage03Requirements = Array.isArray(structureData?.evidence_requirements) && structureData.evidence_requirements.length
                ? structureData.evidence_requirements
                : projectEvidenceRequirementsFromStructure({
                  units: structureData?.judgment_units || [],
                  counter_evidence_directions: structureData?.counter_evidence_directions,
                });
              const evidenceQuality = evaluateEvidenceQuality({
                evidenceDrafts: data.evidence_drafts || [],
                sources: listSources(runId),
                judgmentUnits: structureData?.judgment_units || [],
                evidenceRequirements: stage03Requirements,
              });
              data.evidence_quality_gate = {
                passed: evidenceQuality.passed,
                quality_status: evidenceQuality.qualityStatus,
                total_evidence: evidenceQuality.totalEvidence,
                source_groups: evidenceQuality.sourceGroups,
                direct_facts: evidenceQuality.directFacts,
                gap_details: evidenceQuality.gapDetails,
                evaluated_at: new Date().toISOString(),
              };
              data.evidence_quality_summary = evidenceQuality.summary;
              if (!evidenceQuality.passed || evidenceQuality.qualityStatus === "return_required") {
                data.quality_status = "return_required";
                data.return_required = true;
                data.deterministic_check_status = "not_checked";
                data.status_reason = evidenceQuality.summary;
              }
              schemas.stage_03.parse(data);
            } else if (kind === "stage_04") {
              const structure: any = parseJson(latestArtifact(runId, "stage_02", ["approved"])?.json_content || "{}", {});
              const repaired = repairJudgmentPreparationDraft(data, {
                judgmentUnitIds: (structure.judgment_units || []).map((unit: any) => String(unit.id || "")).filter(Boolean),
                scopeRef: structure.research_scope?.id || null,
              });
              ensureStage04DocumentFields(repaired, { question: run.question, taskId: run.id });
              data = repaired;
              schemas.stage_04.parse(data);
            } else if (kind === "stage_05") {
              const judgmentJson: any = parseJson(latestArtifact(runId, "stage_04", ["approved"])!.json_content, {});
              normalizeStage05Projection(data, judgmentJson, run.question, listSources(runId));
              ensureStage05DocumentFields(data, {
                question: run.question,
                taskId: run.id,
                stage04: judgmentJson,
              });
              schemas.stage_05.parse(data);
            }
            const retryLock = shouldPreserveUpstreamQualityFailure(data, kind as ArtifactKind);
            if (retryLock.preserve) {
              applyUpstreamQualityFailure(data, retryLock.reason);
              hqErrors = [];
            } else {
              forceHighQualityTarget(data);
              data.deterministic_check_status = "checked";
              hqErrors = collectStageHighQualityErrors(kind, data);
            }
          }
          if (
            !shouldPreserveUpstreamQualityFailure(data, kind as ArtifactKind).preserve
            && !meetsHighQualityForReview(kind, data)
          ) {
            markGenerationBelowHighQuality(data, hqErrors.length ? hqErrors : collectStageHighQualityErrors(kind, data));
          }
        }
      }

      assertRunning();
      if (data && typeof data === "object") {
        data.context_injected_assets = injectedAssets;
      }
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
  const mergedRaw: any = mergeChangeSet(parseJson(baseArtifact.json_content, {}), changeSet);
  const merged: any = stage === "stage_03" ? repairEvidencePreparationDraft(mergedRaw) : mergedRaw;
  const affectedObjectRefs = expandAffectedObjectRefs(changeSet);

  if (stage === "stage_03") {
    const affected = new Set(affectedObjectRefs);
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
  const graphRefs = affectedObjectRefs.map((ref) => {
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

/** Stage01：一次提交全部澄清回答并写回产物；随后应重新生成 Stage01。 */
export function clarifyStage01(
  runId: string,
  answerOrAnswers: string | Array<{ question_id?: string; answer: string }>,
  options: { question_id?: string; regenerate?: boolean } = {},
): Artifact {
  const run = getRun(runId);
  if (!run) throw new Error("研究任务不存在");
  const artifact = latestArtifact(runId, "stage_01", ["needs_review"]);
  if (!artifact) throw new Error("尚无待澄清的 Stage01 草稿");
  const previous = parseJson<any>(artifact.json_content, {});
  if (String(previous.task_disposition || "") !== "needs_clarification"
    && !pendingClarificationQuestion(previous)) {
    throw new Error("当前 Stage01 不处于待澄清状态");
  }
  const next = Array.isArray(answerOrAnswers)
    ? applyClarificationAnswers(previous, answerOrAnswers)
    : applyClarificationAnswer(previous, answerOrAnswers, { question_id: options.question_id });
  syncStage01ReadableMarkdown(next, run.question);
  schemas.stage_01.parse(next);
  return editArtifact(artifact.id, JSON.stringify(next, null, 2), next.document_markdown);
}
