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
} from "../../adapters/db";
import { accumulateTokenUsage, createResearchModelClient } from "../../adapters/deepseek";
import { generationLeaseMs } from "../../adapters/model_provider";
import { logger } from "../../lib/logger";
import { promptFor, PROMPT_VERSION } from "../prompts";
import { schemas, type SchemaKind } from "../schemas";
import { ontologyContextForPrompt, ontologyPromptSourceFiles } from "../ontology_tools";
import { emptyGraph, loadDomainBusinessGraph, loadGraphForRun, markReachableDownstreamStale, materializeStageIntoGraph } from "../instance_graph";
import {
  validateExpressionMethodBindings,
  validateJudgmentCapabilityCoverage,
  validateJudgmentMethodBindings,
  validateMethodApplications,
} from "../method_application";
import {
  defaultMethodIdsForJudgmentType,
  loadMethodRegistry,
  methodRoutesForPrompt,
  recallRegisteredMethodCandidates,
  registeredMethodCandidates,
  validateMethodRoutes,
  validateRegisteredMethodApplications,
} from "../method_registry";
import {
  evidenceJudgmentTypeCardsForPrompt,
  executedMethodsSummary,
  buildStageGenerationGuidance,
  judgmentThresholdCapsForPrompt,
  mcpChannelHintsForPrompt,
  methodDisciplineDigest,
} from "../method_guidance";
import {
  attachResearchValueReview,
  buildStage05RetryContext,
  heuristicResearchValueReview,
  mergeResearchValueReviews,
  RESEARCH_VALUE_PASS_THRESHOLD,
  researchValueReviewPrompt,
  researchValueReviewSchema,
  type ResearchValueReview,
} from "../research_value_review";
import { summarizeInjectedAssets } from "../runtime_asset_coverage";
import {
  applyUpstreamQualityFailure,
  buildQualityRetryNotes,
  collectStageHighQualityErrors,
  forceHighQualityTarget,
  HQ_RETRY_KEY,
  markGenerationBelowHighQuality,
  meetsHighQualityForReview,
  shouldPreserveUpstreamQualityFailure,
} from "../stage_hq_retry";
import { parseJson, STAGES, type Artifact, type ArtifactKind, type MethodApplication, type SourceRecord, type StageKind } from "../types";
import { validateReasoningTraceBindings } from "../reasoning_trace";
import { changeSetSchema, expandAffectedObjectRefs, mergeChangeSet, type ChangeSet } from "../change_set";
import { captureSourceSnapshot } from "../source_snapshot";
import { applyDeterministicRuleEvaluations, assertDeterministicRuleResults } from "../semantic_execution";
import { evidenceBoundSourceIds, evidenceBoundSources } from "../evidence_sources";
import { syncReviewWorkItems } from "../review_work_items";
import { assembleStageContext, buildSemanticRoute, clipUpstreamJsonSoft, CONTEXT_SLOT_BUDGETS } from "../context_assembler";
import {
  classifyRuntimeFailure,
  compactStructuredArtifact,
  compactStage03ForUpstream,
  formatRuntimeFailureMessage,
  shouldAbortStage03Batching,
  shouldRetryRuntimeFailure,
} from "../workflow_support";
import { formalOntologyRuleIds, repairJudgmentPreparationDraft } from "../judgment_draft_normalize";
import { buildGenerationProgressHeartbeat, parseGenerationProgress } from "../generation_progress";
import { evaluateEvidenceQuality } from "../evidence_quality_gate";
import { auditStage05Expressions, sanitizeAuditVoice } from "../expression_audit";
import {
  findUnchangedEvidenceIds,
  partitionStage03EvidenceBatches,
  runEvidenceSupplementRound,
  stage03AutoSupplementMaxRounds,
  stage03EvidenceBatchConfig,
  syncStage03DraftSourcesFromRegistry,
} from "../evidence_auto_supplement";
import { computeSourceCoverage, evaluateEvidenceStopCondition } from "../source_coverage";
import { projectEvidenceRequirementsFromStructure } from "../structure_candidates";
import { resolveResearchJobReview } from "../../adapters/research_jobs";
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
} from "../workflow_shared";
import {
  createControlledEvidenceProjection,
  createControlledIndependentReview,
  createControlledJudgmentProjection,
  createControlledStructureProjection,
  buildEvidenceGapFallback,
  createEvidenceGapFallback,
  createJudgmentGapFallback,
  createStage01DeterministicProjection,
  createStage05DeterministicProjection,
  normalizeStage01Projection,
  normalizeStage05Projection,
  repairEvidencePreparationDraft,
} from "../workflow_projections";
import { ensureStage02DocumentFields, repairStage02GenerationDraft } from "../stage02_documents";
import { ensureStage03DocumentFields } from "../stage03_documents";
import { ensureStage04DocumentFields } from "../stage04_documents";
import { ensureStage05DocumentFields } from "../stage05_documents";
import { applyClarificationAnswer, applyClarificationAnswers, pendingClarificationQuestion } from "../stage01_contract";
import { syncStage01ReadableMarkdown, syncStage03ReadableMarkdown, syncStage04ReadableMarkdown } from "../readable_markdown";

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
    ontology_files: ontologyPromptSourceFiles(),
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
  const governanceVersion = `sha256:${createHash("sha256").update(JSON.stringify({
    knowledge_version: assembled.knowledge_version,
    knowledge_files: knowledge.files,
    ontology_context: ontologyContext,
    ontology_files: injectedAssets.ontology_files,
    method_guidance: selectedMethodGuidance || [],
    scenario_card_ids: scenarioCardIds,
    structured_keys: injectedAssets.structured_keys,
  })).digest("hex")}`;
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
        governance_version: governanceVersion,
        standards_loading: assembled.standards_loading,
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
  const client = createResearchModelClient(
    kind === "independent_review" ? "reviewer" : "producer",
    kind,
  );
  const artifact = createArtifact(runId, kind, {
    status: "running",
    prompt_version: PROMPT_VERSION,
    knowledge_version: governanceVersion,
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
      const compactSupplementContextForUnits = (unitIds: string[]) => {
        const target = new Set(unitIds.map(String));
        return {
          question: run.question,
          domain: run.domain,
          judgmentTypes: judgmentTypesForKnowledge,
          upstream: upstream.map((item: any) => {
            if (item.kind !== "stage_02") return item;
            const json = item.json || {};
            return {
              kind: item.kind,
              json: {
                research_scope: json.research_scope,
                judgment_spine: json.judgment_spine,
                judgment_units: (json.judgment_units || []).filter((unit: any) =>
                  target.has(String(unit?.id || "")),
                ),
                variables: (json.variables || []).filter((variable: any) =>
                  !variable?.judgment_unit_ids
                  || variable.judgment_unit_ids.some((id: string) => target.has(String(id))),
                ),
                method_applications: (json.method_applications || []).filter((application: any) =>
                  (application.target_judgment_unit_refs || []).some((id: string) => target.has(String(id))),
                ),
                competing_explanations: json.competing_explanations || [],
                counter_evidence_directions: json.counter_evidence_directions || [],
              },
            };
          }),
        };
      };

      if (kind === "stage_03" && stage03Mode === "evidence_supplement") {
        const baseArtifact = latestArtifact(runId, "stage_03", ["needs_review", "approved"]);
        if (!baseArtifact) throw new Error("尚无证据稿件可补充，请先生成全量证据");
        inheritFromArtifactId = baseArtifact.id;
        initialBaseData = parseJson(baseArtifact.json_content, {});
        data = repairEvidencePreparationDraft(initialBaseData);
        const currentCoverage = computeSourceCoverage({
          sources: listSources(runId),
          evidence: data.evidence_drafts || [],
          requirements: evidenceRequirements,
          cutoffMs,
        });
        const coverageTargets = new Set(
          currentCoverage.unit_coverage
            .filter((unit) => (
              !unit.has_support_evidence
              || !unit.meets_independence
              || unit.gap_count > 0
              || unit.counter_gap_count > 0
            ))
            .map((unit) => String(unit.unit_id)),
        );
        const allStructureUnitIds = (structureData.judgment_units || [])
          .map((unit: any) => String(unit?.id || ""))
          .filter(Boolean);
        const targetUnitIds = allStructureUnitIds.filter((id: string) => coverageTargets.has(id));
        const batches = partitionStage03EvidenceBatches({
          judgmentUnitIds: targetUnitIds.length ? targetUnitIds : allStructureUnitIds,
          requirements: evidenceRequirements,
          ...stage03EvidenceBatchConfig(),
        });
        const batchTelemetry: Array<Record<string, unknown>> = [];
        for (const [batchIndex, batch] of batches.entries()) {
          assertRunning();
          writeCoverageHeartbeat(
            batchIndex + 1,
            Math.max(batches.length, 1),
            computeSourceCoverage({
              sources: listSources(runId),
              evidence: data.evidence_drafts || [],
              requirements: evidenceRequirements,
              cutoffMs,
            }),
            `Stage03 定向补证 ${batch.batch_id}：${batch.unit_ids.join(", ")}`,
          );
          try {
            const supplement = await runEvidenceSupplementRound({
              client,
              runId,
              baseData: data,
              supplementContext: compactSupplementContextForUnits(batch.unit_ids),
              assertRunning,
              onProgress: (event) => {
                const heartbeat = buildGenerationProgressHeartbeat({
                  phase: "model_round",
                  round: event.round,
                  max_rounds: 8,
                  tool_names: [],
                  message: `${batch.batch_id}：${event.message}`,
                }, startedAt);
                lastHeartbeatJson = JSON.stringify({
                  ...heartbeat,
                  evidence_batch: batch.batch_id,
                  evidence_batch_index: batchIndex + 1,
                  evidence_batch_count: batches.length,
                  target_unit_ids: batch.unit_ids,
                  mode: "evidence_supplement",
                });
                updateArtifactIfStatus(artifact.id, "running", { tool_usage: lastHeartbeatJson });
              },
              existingSources: listSources(runId),
              maxSourceCount: options?.maxSourceCount,
              requirements: batch.requirements,
              targetUnitIds: batch.unit_ids,
              cutoffMs,
              maxToolRounds: 8,
              idNamespace: `SUP-${batch.batch_id}`,
            });
            data = supplement.data;
            cumulativeUsage = accumulateTokenUsage(cumulativeUsage, supplement.usage);
            batchTelemetry.push({
              batch_id: batch.batch_id,
              target_unit_ids: batch.unit_ids,
              status: "complete",
              tool_usage: supplement.toolUsage,
              unchanged_evidence_ids: [...supplement.unchangedEvidenceIds],
            });
          } catch (error) {
            if (shouldAbortStage03Batching(error)) throw error;
            const message = formatRuntimeFailureMessage(error);
            data.unresolved_gaps = [
              ...new Set([
                ...(Array.isArray(data.unresolved_gaps) ? data.unresolved_gaps.map(String) : []),
                `${batch.batch_id} 定向补证失败（${batch.unit_ids.join(", ")}）：${message}`,
              ]),
            ];
            batchTelemetry.push({
              batch_id: batch.batch_id,
              target_unit_ids: batch.unit_ids,
              status: "failed",
              error: message,
            });
          }
        }
        data.stage03_batch_execution = {
          mode: "evidence_supplement_batches",
          batch_count: batches.length,
          batches: batchTelemetry,
        };
      } else if (kind === "stage_03") {
        // 03 默认走可恢复批次：确定性 gap 底稿保证所有判断单元都有位置，
        // 每批只研究 1–2 个单元，patch 再合并回全局。单批失败不抹掉已成功批次。
        data = buildEvidenceGapFallback(
          structureData,
          "Runtime 已建立完整证据缺口底稿，正在按判断单元分批取得并冻结真实来源",
        );
        data = repairEvidencePreparationDraft(data);
        ensureStage03DocumentFields(data, {
          question: run.question,
          taskId: run.id,
          structure: structureData,
        });
        const batches = partitionStage03EvidenceBatches({
          judgmentUnitIds: (structureData.judgment_units || [])
            .map((unit: any) => String(unit?.id || ""))
            .filter(Boolean),
          requirements: evidenceRequirements,
          ...stage03EvidenceBatchConfig(),
        });
        const batchTelemetry: Array<Record<string, unknown>> = [];
        for (const [batchIndex, batch] of batches.entries()) {
          assertRunning();
          writeCoverageHeartbeat(
            batchIndex + 1,
            Math.max(batches.length, 1),
            computeSourceCoverage({
              sources: listSources(runId),
              evidence: data.evidence_drafts || [],
              requirements: evidenceRequirements,
              cutoffMs,
            }),
            `Stage03 分批取证 ${batch.batch_id}：${batch.unit_ids.join(", ")}`,
          );
          try {
            const supplement = await runEvidenceSupplementRound({
              client,
              runId,
              baseData: data,
              supplementContext: compactSupplementContextForUnits(batch.unit_ids),
              assertRunning,
              onProgress: (event) => {
                const heartbeat = buildGenerationProgressHeartbeat({
                  phase: "model_round",
                  round: event.round,
                  max_rounds: 8,
                  tool_names: [],
                  message: `${batch.batch_id}：${event.message}`,
                }, startedAt);
                lastHeartbeatJson = JSON.stringify({
                  ...heartbeat,
                  evidence_batch: batch.batch_id,
                  evidence_batch_index: batchIndex + 1,
                  evidence_batch_count: batches.length,
                  target_unit_ids: batch.unit_ids,
                });
                updateArtifactIfStatus(artifact.id, "running", { tool_usage: lastHeartbeatJson });
              },
              existingSources: listSources(runId),
              maxSourceCount: options?.maxSourceCount,
              requirements: batch.requirements,
              targetUnitIds: batch.unit_ids,
              cutoffMs,
              maxToolRounds: 8,
              idNamespace: batch.batch_id,
            });
            data = supplement.data;
            cumulativeUsage = accumulateTokenUsage(cumulativeUsage, supplement.usage);
            batchTelemetry.push({
              batch_id: batch.batch_id,
              target_unit_ids: batch.unit_ids,
              status: "complete",
              tool_usage: supplement.toolUsage,
            });
          } catch (error) {
            if (shouldAbortStage03Batching(error)) throw error;
            // 继续其他批次；最终证据门会把未完成批次锁为 return_required，
            // 不会因容错而把全 gap 产物伪装成高质量。
            const message = formatRuntimeFailureMessage(error);
            data.unresolved_gaps = [
              ...new Set([
                ...(Array.isArray(data.unresolved_gaps) ? data.unresolved_gaps.map(String) : []),
                `${batch.batch_id} 批次失败（${batch.unit_ids.join(", ")}）：${message}`,
              ]),
            ];
            batchTelemetry.push({
              batch_id: batch.batch_id,
              target_unit_ids: batch.unit_ids,
              status: "failed",
              error: message,
            });
          }
        }
        data.stage03_batch_execution = {
          mode: "judgment_unit_batches",
          batch_count: batches.length,
          batches: batchTelemetry,
        };
      } else {
        // Stage04 的 upstream 已含结构/证据；开放 ontologyTools 易陷入 query_object_set/propose_action 空转直至超时。
        const useOntologyTools = kind === "stage_02";
        result = await client.generate(kind as SchemaKind, systemPrompt, inputContext, {
          webSearch: false,
          ontologyTools: useOntologyTools,
          // Stage04 无检索工具；测试友好保留较低轮次，但仍给模型几次修正机会。
          maxToolRounds: kind === "stage_04" ? 6 : undefined,
          runId,
          validateOutput: (draft) => validateGeneratedSemanticDraft(runId, kind, draft),
          repairOutput: kind === "stage_04"
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
                ? (draft) => repairStage02GenerationDraft(draft, { question: run.question, taskId: run.id })
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
      if (kind === "stage_03" && stage03Mode !== "evidence_supplement" && !data?.stage03_batch_execution) {
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
          logger.warn("EVIDENCE:GATE", `Stage 03 未通过: ${evidenceQuality.summary}`);
          data.quality_status = "return_required";
          data.return_required = true;
          data.deterministic_check_status = "not_checked";
          data.status_reason = evidenceQuality.summary;
          data.evidence_readiness = "not_ready";
          data.delivery_readiness = "not_ready";
          data.allowed_05_output = evidenceQuality.totalEvidence > 0 ? "bounded_report" : "gap_report_only";
          data.evidence_gap_report = {
            generated_at: new Date().toISOString(),
            reason: "evidence_quality_floor_not_met",
            details: evidenceQuality.gapDetails.filter((d) => d.isBlocking),
            recommendation: "建议手动补证或缩小研究范围后重试",
          };
        } else if (evidenceQuality.qualityStatus === "minimum_pass") {
          // 证据仅达最低流转：不得自称 HQ；确认门禁仍要求 HQ，故标为需补强
          data.evidence_readiness = "partial";
          data.delivery_readiness = "partial";
          data.allowed_05_output = "bounded_report";
          if (String(data.quality_status || "") === "high_quality_pass") {
            data.quality_status = "minimum_pass";
            data.deterministic_check_status = "not_checked";
          }
        } else {
          data.evidence_readiness = "ready";
          data.delivery_readiness = "ready";
          data.allowed_05_output = "full_report";
        }

        // 获取通道只做留痕，不决定来源权威性。公司 IR、监管/政府官网等
        // 经正文抓取与逐字核验后可以是一手来源；MCP 只是获取通道，不能
        // 被当作证据等级或 high_quality 的代理变量。
        const batchToolUsage = (data?.stage03_batch_execution?.batches || [])
          .map((batch: any) => batch?.tool_usage)
          .filter((usage: unknown) => usage && typeof usage === "object") as Array<Record<string, unknown>>;
        const toolUsage = (result?.toolUsage && typeof result.toolUsage === "object")
          ? result.toolUsage as Record<string, unknown>
          : batchToolUsage.length
            ? {
              tool_calls: batchToolUsage.reduce((sum, item) => sum + Number(item.tool_calls || 0), 0),
              web_search_calls: batchToolUsage.reduce((sum, item) => sum + Number(item.web_search_calls || 0), 0),
              public_page_fetch_calls: batchToolUsage.reduce((sum, item) => sum + Number(item.public_page_fetch_calls || 0), 0),
              mcp_evidence_calls: batchToolUsage.reduce((sum, item) => sum + Number(item.mcp_evidence_calls || 0), 0),
              tools: batchToolUsage.flatMap((item) => Array.isArray(item.tools) ? item.tools : []),
            }
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
          quality_semantics: "acquisition_telemetry_only",
        };
        if (nonGapCount > 0 && mcpCalls <= 0) {
          data.mcp_channel_usage = {
            ...data.mcp_channel_usage,
            note: "本次非 gap 证据来自公开原文抓取或既有 Source Registry；质量由来源生产者、正文 hash、逐字引用和证据门判定",
          };
        }
        // 证据门会改变 readiness / 05 输出上限；强制重建 03 的人类可读压缩层与实例清单，
        // 避免保留 gap 底稿或上一补证轮次的旧摘要。
        syncStage03ReadableMarkdown(data, {
          question: run.question,
          taskId: run.id,
          structure: structureData,
          forceProjection: true,
        });
        schemas.stage_03.parse(data);
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
        review.producer_model = client.model;
        // 研究价值用 reviewer 配置打分，避免生产模型自评。不可用时保留
        // 更保守的确定性启发式；reviewer 不参与改写正文。
        try {
          const valueReviewClient = createResearchModelClient("reviewer", "stage_05");
          const llmReview = await valueReviewClient.generateStructured(
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
          const totalScore = llmReview.data.checks.reduce((sum, item) => sum + item.score, 0);
          review = {
            status: llmReview.data.status,
            checks: llmReview.data.checks,
            retry_count: 0,
            total_score: totalScore,
            pass_threshold: RESEARCH_VALUE_PASS_THRESHOLD,
            reviewed_at: new Date().toISOString(),
            mode: "llm",
            reviewer_model: valueReviewClient.model,
            producer_model: client.model,
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
              score: Math.min(prev?.score ?? 0, check.score ?? 0),
              evidence_span: check.evidence_span || prev?.evidence_span || "",
              note: check.note || prev?.note || "",
            });
          }
          review = {
            status: [...byId.values()].every((item) => item.pass)
              && [...byId.values()].reduce((sum, item) => sum + item.score, 0) >= RESEARCH_VALUE_PASS_THRESHOLD
              ? "pass"
              : "fail",
            checks: [...byId.values()],
            retry_count: 0,
            total_score: [...byId.values()].reduce((sum, item) => sum + item.score, 0),
            pass_threshold: RESEARCH_VALUE_PASS_THRESHOLD,
            reviewed_at: new Date().toISOString(),
            mode: "combined",
            reviewer_model: valueReviewClient.model,
            producer_model: client.model,
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
          retryReview.producer_model = client.model;
          // 重试后仍尝试 LLM 审查；失败则保留启发式，不得静默当过。
          try {
            const valueReviewClient = createResearchModelClient("reviewer", "stage_05");
            const llmRetry = await valueReviewClient.generateStructured(
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
              total_score: llmRetry.data.checks.reduce((sum, item) => sum + item.score, 0),
              pass_threshold: RESEARCH_VALUE_PASS_THRESHOLD,
              reviewed_at: new Date().toISOString(),
              mode: "llm",
              reviewer_model: valueReviewClient.model,
              producer_model: client.model,
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
                    ? (draft) => repairStage02GenerationDraft(draft, { question: run.question, taskId: run.id })
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
                data.evidence_readiness = "not_ready";
                data.delivery_readiness = "not_ready";
                data.allowed_05_output = evidenceQuality.totalEvidence > 0 ? "bounded_report" : "gap_report_only";
              } else if (evidenceQuality.qualityStatus === "minimum_pass") {
                data.evidence_readiness = "partial";
                data.delivery_readiness = "partial";
                data.allowed_05_output = "bounded_report";
                if (String(data.quality_status || "") === "high_quality_pass") {
                  data.quality_status = "minimum_pass";
                  data.deterministic_check_status = "not_checked";
                }
              } else {
                data.evidence_readiness = "ready";
                data.delivery_readiness = "ready";
                data.allowed_05_output = "full_report";
              }
              syncStage03ReadableMarkdown(data, {
                question: run.question,
                taskId: run.id,
                structure: structureData,
                forceProjection: true,
              });
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
        tool_usage: result?.toolUsage
          ? JSON.stringify(result.toolUsage)
          : data?.stage03_batch_execution
            ? JSON.stringify({
              evidence_batch_execution: data.stage03_batch_execution,
              mcp_channel_usage: data.mcp_channel_usage,
            })
            : lastHeartbeatJson,
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

