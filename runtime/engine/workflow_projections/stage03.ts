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

export function repairEvidencePreparationDraft(data: any): any {
  if (!data || typeof data !== "object") return data;
  let normalized: any = normalizeEvidencePreparationNulls(data);
  normalized = dropIncompleteSources(normalized);
  normalized = prepareEvidenceForSourceCapture(normalized);
  normalized = normalizeEvidencePreparationNulls(normalized);
  normalized = reconcileMethodEvidenceRefs(normalized);
  if (!Array.isArray(normalized.method_applications) || !Array.isArray(normalized.evidence_drafts)) {
    return normalized;
  }
  const drafts = normalized.evidence_drafts;
  const referenced = new Set<string>(
    normalized.method_applications.flatMap((item: any) => (
      Array.isArray(item?.input_evidence_refs) ? item.input_evidence_refs.map(String) : []
    )),
  );
  const unbound = drafts.filter((item: any) => item?.id && !referenced.has(String(item.id)));
  const needsAlternatives = normalized.method_applications.some((item: any) => (
    ["blocked", "rejected"].includes(String(item?.status || "")) && !(item.alternatives || []).length
  ));
  if (!unbound.length && !needsAlternatives) return normalized;

  const applications = normalized.method_applications.map((application: any) => {
    let input_evidence_refs = Array.isArray(application.input_evidence_refs)
      ? application.input_evidence_refs.map(String)
      : [];
    const targets = new Set((application.target_judgment_unit_refs || []).map(String));
    if (application.capability_type === "evidence" && unbound.length) {
      const extra = unbound
        .filter((draft: any) => (draft.judgment_unit_ids || []).some((id: string) => targets.has(String(id))))
        .map((draft: any) => String(draft.id));
      if (extra.length) input_evidence_refs = [...new Set([...input_evidence_refs, ...extra])];
    }
    let alternatives = Array.isArray(application.alternatives) ? [...application.alternatives] : [];
    if (["blocked", "rejected"].includes(String(application.status || "")) && !alternatives.length) {
      alternatives = [{
        method_id: String(application.method_id || "unknown"),
        decision: "retry_after_source_acquisition",
        reason: "取得可核验正文后重试同一登记方法",
      }];
    }
    return { ...application, input_evidence_refs, alternatives };
  });

  const stillReferenced = new Set(applications.flatMap((item: any) => item.input_evidence_refs.map(String)));
  const stillUnbound = drafts.filter((item: any) => item?.id && !stillReferenced.has(String(item.id)));
  for (const draft of stillUnbound) {
    const juIds = new Set((draft.judgment_unit_ids || []).map(String));
    const target = applications.find((app: any) => (
      app.capability_type === "evidence"
      && (app.target_judgment_unit_refs || []).some((id: string) => juIds.has(String(id)))
    )) || applications.find((app: any) => app.capability_type === "evidence") || applications[0];
    if (target) {
      target.input_evidence_refs = [...new Set([...target.input_evidence_refs, String(draft.id)])];
    }
  }

  return { ...normalized, method_applications: applications };
}

export function buildEvidenceGapFallback(structure: any, reason: string) {
  const gapIdsByUnit = new Map<string, string[]>();
  const projectedRequirements = Array.isArray(structure.evidence_requirements)
    && structure.evidence_requirements.length
    ? structure.evidence_requirements
    : projectEvidenceRequirementsFromStructure({
      units: structure.judgment_units || [],
      counter_evidence_directions: structure.counter_evidence_directions,
    });
  const evidenceDrafts = (structure.judgment_units || []).flatMap((unit: any, unitIndex: number) => {
    const unitRequirements = projectedRequirements.filter((requirement: any) =>
      (requirement.judgment_unit_ids || []).map(String).includes(String(unit.id)),
    );
    const requirements = unitRequirements.length
      ? unitRequirements
      : [{
        requirement: `${unit.title || unit.id} 缺少可核验的直接证据`,
        evidence_role: "support",
        minimum_independent_sources: 2,
      }];
    const gaps = requirements.map((requirement: any, requirementIndex: number) => ({
      id: `GAP-${String(unitIndex + 1).padStart(2, "0")}-${String(requirementIndex + 1).padStart(2, "0")}`,
      statement: `未取得可核验来源：${String(requirement.requirement || requirement)}`,
      kind: "gap" as const,
      direction: "unknown" as const,
      source_keys: [],
      source_ids: [],
      judgment_unit_ids: [unit.id],
      ontology_node_ids: unit.ontology_node_ids || [],
      requirement: String(requirement.requirement || requirement),
      evidence_role: ["support", "counter", "context", "boundary"].includes(String(requirement.evidence_role))
        ? requirement.evidence_role
        : "support",
      minimum_independent_sources: Math.max(0, Number(requirement.minimum_independent_sources || 1)),
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
  syncStage03ReadableMarkdown(data, { question: run.question, taskId: runId, structure });
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
        authority_type: source.authority_type || "unknown",
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
  syncStage03ReadableMarkdown(data, { question: run.question, taskId: runId, structure });
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

