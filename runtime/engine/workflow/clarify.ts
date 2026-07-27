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
