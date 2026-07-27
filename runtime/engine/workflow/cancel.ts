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

