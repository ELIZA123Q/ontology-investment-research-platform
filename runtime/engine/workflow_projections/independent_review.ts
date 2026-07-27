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
import { loadKnowledge } from "../knowledge";
import { createResearchModelClient } from "../../adapters/deepseek";
import { promptFor, PROMPT_VERSION } from "../prompts";
import { schemas, type SchemaKind } from "../schemas";
import { ontologyContextForPrompt } from "../ontology_tools";
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
  recallRegisteredMethodCandidates,
  registeredMethodCandidates,
  validateMethodRoutes,
  validateRegisteredMethodApplications,
} from "../method_registry";
import { parseJson, STAGES, type Artifact, type ArtifactKind, type MethodApplication, type SourceRecord, type StageKind } from "../types";
import { validateReasoningTraceBindings } from "../reasoning_trace";
import { changeSetSchema, mergeChangeSet, type ChangeSet } from "../change_set";
import { captureSourceSnapshot } from "../source_snapshot";
import { applyDeterministicRuleEvaluations, assertDeterministicRuleResults } from "../semantic_execution";
import { evidenceBoundSourceIds, evidenceBoundSources } from "../evidence_sources";
import { syncReviewWorkItems } from "../review_work_items";
import { classifyRuntimeFailure, compactStructuredArtifact } from "../workflow_support";
import {
  normalizeEvidencePreparationNulls,
  dropIncompleteSources,
  prepareEvidenceForSourceCapture,
  reconcileMethodEvidenceRefs,
} from "../evidence_draft_normalize";

import { syncStage02ReadableMarkdown, syncStage01ReadableMarkdown, syncStage03ReadableMarkdown, syncStage04ReadableMarkdown } from "../readable_markdown";
import { ensureStage01ContractFields } from "../stage01_contract";
import { ensureStage02DocumentFields } from "../stage02_documents";
import { ensureStage05DocumentFields } from "../stage05_documents";
import {
  buildStage05SkeletonMarkdown,
  shouldPreserveStage05Markdown,
  stripInlineAuditDetails,
} from "../stage05_quality";
import {
  competingExplanationsForUnit,
  normalizeCompetingExplanations,
  normalizeCounterEvidenceDirections,
  projectEvidenceRequirementsFromStructure,
} from "../structure_candidates";
import {
  editArtifact,
  methodCandidatesForPrompt,
  normalizeBusinessCutoff,
  sameStringSet,
  sourcesForPrompt,
  sourceForFrozenBaseline,
  validateGeneratedSemanticDraft,
  validateOntologyVariableBindings,
} from "../workflow_shared";

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
  const semanticChecks = [
    "local_evidence_not_globalized",
    "parent_aggregation_complete",
    "incremental_update_is_local_first",
    "title_represents_major_scopes",
    "conditions_scope_and_prohibitions_preserved",
  ].map((check_id) => (
    input.verdict === "pass"
      ? {
        check_id,
        result: "pass" as const,
        reason: `人类独立审阅确认：${assessment.slice(0, 120)}`,
      }
      : {
        check_id,
        result: "needs_human" as const,
        reason: `人类独立审阅要求返工：${issues[0]?.description || assessment}`.slice(0, 200),
        return_to_stage: (issues[0]?.return_stage?.replace("stage_", "") || "04") as "02" | "03" | "04" | "05",
      }
  ));
  const data = {
    reviewed_stage04_artifact_id: reviewed.id,
    reviewed_stage04_artifact_hash: createHash("sha256").update(reviewed.json_content).digest("hex"),
    verdict: input.verdict,
    issues,
    strengths,
    overall_assessment: assessment,
    semantic_checks: semanticChecks,
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
      "## 五项语义审查",
      "",
      ...semanticChecks.map((check) => `- ${check.check_id}: ${check.result} — ${check.reason}`),
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
