import "server-only";
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
import {
  AUTHORITY_GRAPH_STAGES,
  buildAuthorityGraphCandidate,
  loadGraphForRun,
  type AuthorityGraphStage,
  type AuthorityStageInput,
  type BusinessInstanceGraph,
} from "../instance_graph";
import { validateRuntimeGraph } from "../graph_contract";
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
  recomputeStage04DeterministicRules,
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
import { ensureStage03DocumentFields, recomputeStage03EvidenceQualityGate } from "../stage03_documents";
import { ensureStage04DocumentFields } from "../stage04_documents";
import { ensureStage05DocumentFields } from "../stage05_documents";
import { applyClarificationAnswer, applyClarificationAnswers, pendingClarificationQuestion } from "../stage01_contract";
import { syncStage01ReadableMarkdown, syncStage03ReadableMarkdown, syncStage04ReadableMarkdown } from "../readable_markdown";
import { buildStageSemanticContext } from "../semantic_context";

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
      const run = getRun(artifact.run_id);
      const structureArtifact = latestArtifact(artifact.run_id, "stage_02", ["approved"]);
      const structure = parseJson(structureArtifact?.json_content || "{}", {});
      ensureStage03DocumentFields(synced.data, {
        question: run?.question,
        taskId: artifact.run_id,
        structure,
        forceProjection: true,
      });
      const recomputed = recomputeStage03EvidenceQualityGate(synced.data, {
        structure,
        sources: listSources(artifact.run_id),
      });
      // 质量门不是只在内存里“通过”后即丢弃；下游 Stage04/05 必须读取
      // 与本次确认完全相同的重算结果。
      updateArtifact(artifact.id, {
        json_content: JSON.stringify(recomputed, null, 2),
        markdown_content: String(recomputed.document_markdown || artifact.markdown_content || ""),
      });
      artifact = getArtifact(id)!;
    }
    if (artifact.kind === "stage_04") {
      // 确认前按当前证据与来源重算正式规则，禁止信任可编辑的 deterministic_result。
      const recomputed = recomputeStage04DeterministicRules(
        artifact.run_id,
        parseJson(artifact.json_content, {}),
      );
      updateArtifact(artifact.id, {
        json_content: JSON.stringify(recomputed, null, 2),
        markdown_content: String(recomputed.document_markdown || artifact.markdown_content || ""),
      });
      artifact = getArtifact(id)!;
    }
    if (STAGES.includes(artifact.kind as StageKind)) {
      const stageNo = stageNumber(artifact.kind);
      const upstream = STAGES.slice(0, Math.max(stageNo - 1, 0))
        .map((stage) => latestArtifact(artifact!.run_id, stage, ["approved"]))
        .filter((item): item is Artifact => Boolean(item))
        .map((item) => parseJson(item.json_content, {}));
      const data = parseJson<Record<string, unknown>>(artifact.json_content, {});
      data.semantic_context = buildStageSemanticContext({
        stage: artifact.kind,
        data,
        upstream,
      });
      updateArtifact(artifact.id, { json_content: JSON.stringify(data, null, 2) });
      artifact = getArtifact(id)!;
    }
    validateApproval(artifact);
    assertArtifactReviewComplete(artifact);
    const graphCandidate = isAuthorityGraphStage(artifact.kind)
      ? buildAuthorityGraphCandidateForApproval(artifact)
      : null;
    const approvedStage = stageNumber(artifact.kind);
    if (approvedStage) supersedeDownstream(artifact.run_id, approvedStage);
    supersedeOtherArtifactAttempts(artifact.run_id, artifact.kind, artifact.id);
    approveArtifact(artifact);
    resolveResearchJobReview(artifact.id, true);
    if (graphCandidate) saveAuthorityGraph(artifact, graphCandidate);
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

function buildAuthorityGraphCandidateForApproval(artifact: Artifact): BusinessInstanceGraph {
  if (!isAuthorityGraphStage(artifact.kind)) {
    throw new Error(`${artifact.kind} 不属于正式图谱物化阶段`);
  }
  const targetIndex = AUTHORITY_GRAPH_STAGES.indexOf(artifact.kind);
  const stages: AuthorityStageInput[] = AUTHORITY_GRAPH_STAGES
    .slice(0, targetIndex + 1)
    .map((kind) => {
      const source = kind === artifact.kind
        ? artifact
        : latestArtifact(artifact.run_id, kind, ["approved"]);
      if (!source) throw new Error(`确认 ${artifact.kind} 前缺少已批准的 ${kind}`);
      return {
        kind,
        artifact_id: source.id,
        artifact_version: source.version,
        data: parseJson<Record<string, unknown>>(source.json_content, {}),
      };
    });
  const run = getRun(artifact.run_id);
  const loaded = loadGraphForRun(artifact.run_id, run?.package_path);
  const candidate = buildAuthorityGraphCandidate(
    stages,
    loaded.authority === "formal" ? loaded.graph : null,
  );
  // 必须在改变产物状态、废止下游和写入正式图之前完成候选图校验。
  validateRuntimeGraph(candidate);
  return candidate;
}

function saveAuthorityGraph(artifact: Artifact, candidate: BusinessInstanceGraph) {
  saveInstanceGraph(
    artifact.run_id,
    {
      authority_contract: "ontology_authority_graph_v1",
      provisional: false,
      materialized_from: artifact.kind,
      materialized_from_artifact_id: artifact.id,
      materialized_from_artifact_version: artifact.version,
      materialized_at: new Date().toISOString(),
      business_instance_graph: candidate,
    },
    `materialized from ${artifact.kind} artifact ${artifact.id} v${artifact.version}`,
  );
}

function isAuthorityGraphStage(kind: ArtifactKind): kind is AuthorityGraphStage {
  return AUTHORITY_GRAPH_STAGES.includes(kind as AuthorityGraphStage);
}
