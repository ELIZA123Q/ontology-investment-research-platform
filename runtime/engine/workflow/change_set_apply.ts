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
    const structureArtifact = latestArtifact(runId, "stage_02", ["approved"])
      || latestArtifact(run.parent_run_id, "stage_02", ["approved"]);
    ensureStage03DocumentFields(merged, {
      question: run.question,
      taskId: run.id,
      structure: parseJson(structureArtifact?.json_content || "{}", {}),
    });
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

