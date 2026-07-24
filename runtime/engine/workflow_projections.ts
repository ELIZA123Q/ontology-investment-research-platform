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
import { createResearchModelClient } from "../adapters/deepseek";
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
import { classifyRuntimeFailure, compactStructuredArtifact } from "./workflow_support";
import { normalizeEvidencePreparationNulls, dropIncompleteSources, reconcileMethodEvidenceRefs } from "./evidence_draft_normalize";

import { syncStage02ReadableMarkdown, syncStage01ReadableMarkdown, syncStage03ReadableMarkdown, syncStage04ReadableMarkdown } from "./readable_markdown";
import { ensureStage01ContractFields } from "./stage01_contract";
import { ensureStage02DocumentFields } from "./stage02_documents";
import { ensureStage05DocumentFields } from "./stage05_documents";
import {
  buildStage05SkeletonMarkdown,
  shouldPreserveStage05Markdown,
  stripInlineAuditDetails,
} from "./stage05_quality";
import {
  competingExplanationsForUnit,
  normalizeCompetingExplanations,
  normalizeCounterEvidenceDirections,
  projectEvidenceRequirementsFromStructure,
} from "./structure_candidates";
import {
  editArtifact,
  methodCandidatesForPrompt,
  normalizeBusinessCutoff,
  sameStringSet,
  sourcesForPrompt,
  sourceForFrozenBaseline,
  validateGeneratedSemanticDraft,
  validateOntologyVariableBindings,
} from "./workflow_shared";

export function normalizeStage01Projection(data: any, question: string) {
  const cutoff = normalizeBusinessCutoff(data?.time_scope?.as_of || question);
  if (cutoff && data?.time_scope) data.time_scope.as_of = cutoff;
  delete data.report_type;
  ensureStage01ContractFields(data, question);
  syncStage01ReadableMarkdown(data, question);
  return data;
}

type ControlledScopeInput = {
  normalized_question?: string;
  core_object?: string;
  judgment_action?: string;
  lookback?: string;
  as_of?: string;
  forward?: string;
  boundaries?: string[];
  exclusions?: string[];
};

export function createStage01DeterministicProjection(runId: string, input: ControlledScopeInput = {}) {
  const run = getRun(runId);
  if (!run) throw new Error("研究任务不存在");
  const sourceArtifact = latestArtifact(runId, "stage_01", ["approved", "needs_review"]);
  const previous = sourceArtifact ? parseJson<any>(sourceArtifact.json_content, {}) : {};
  const cutoff = normalizeBusinessCutoff(input.as_of || previous.time_scope?.as_of || run.question);
  if (!cutoff) throw new Error("缺少可解析的研究截止日期；请明确到日、月、季度或半年");
  const pick = (value: unknown, fallback: unknown) => String(value || fallback || "").trim();
  const draft = {
    normalized_question: pick(input.normalized_question, previous.normalized_question || run.question),
    core_object: pick(input.core_object, previous.core_object),
    judgment_action: pick(input.judgment_action, previous.judgment_action),
    time_scope: {
      lookback: pick(input.lookback, previous.time_scope?.lookback),
      as_of: cutoff,
      forward: pick(input.forward, previous.time_scope?.forward),
    },
    boundaries: input.boundaries?.map(String).map((item) => item.trim()).filter(Boolean) ?? previous.boundaries ?? [],
    exclusions: input.exclusions?.map(String).map((item) => item.trim()).filter(Boolean) ?? previous.exclusions ?? [],
    domain_supported: run.domain === "semiconductor",
    document_markdown: "placeholder",
  };
  if (!sourceArtifact && (!draft.core_object || !draft.judgment_action || !draft.time_scope.lookback || !draft.time_scope.forward)) {
    throw new Error("空白运行必须显式填写核心对象、判断动作、回看期和前瞻期；不得用泛化占位语冻结范围");
  }
  if (draft.boundaries.length < 2 || !draft.exclusions.length) throw new Error("受控范围至少需要两条边界和一条排除项");
  const data = normalizeStage01Projection(draft, run.question);
  schemas.stage_01.parse(data);
  if (sourceArtifact) return editArtifact(sourceArtifact.id, JSON.stringify(data, null, 2), data.document_markdown);
  return createArtifact(runId, "stage_01", {
    status: "needs_review",
    prompt_version: `${PROMPT_VERSION}:runtime-deterministic-scope-v1`,
    knowledge_version: "runtime-deterministic-scope-v1",
    input_context: JSON.stringify({ question: run.question, parsed_cutoff: cutoff, controlled_scope_input: input }, null, 2),
    json_content: JSON.stringify(data, null, 2),
    markdown_content: data.document_markdown,
    model_name: "runtime-deterministic-scope-projection",
    tool_usage: JSON.stringify({ deterministic_projection: true }),
  });
}

type ControlledStructureUnitInput = {
  id?: string;
  title: string;
  question: string;
  judgment_type: string;
  evidence_requirements: string[];
};
type ControlledStructureInput = {
  scope_label?: string;
  scope_dimensions?: Record<string, unknown>;
  units: ControlledStructureUnitInput[];
  counter_evidence_directions?: unknown[];
  competing_explanations?: unknown[];
};

function defaultMethodApplicationsForUnit(unit: { id: string; judgment_type: string }, unitIndex: number, registry: ReturnType<typeof loadMethodRegistry>): MethodApplication[] {
  const defaults = defaultMethodIdsForJudgmentType(unit.judgment_type);
  return (Object.entries(defaults) as Array<["judgment_structure" | "evidence" | "adjudication", string]>).map(([capability, methodId], capabilityIndex) => {
    const registered = registry.get(methodId);
    if (!registered) throw new Error(`${unit.id} 默认方法未登记: ${methodId}`);
    const applicability = Array.isArray(registered.applicability) ? registered.applicability.join("；") : registered.applicability;
    return {
      application_id: `MA-CONTROLLED-${String(unitIndex + 1).padStart(2, "0")}-${String(capabilityIndex + 1).padStart(2, "0")}`,
      method_id: registered.method_id,
      method_version: registered.method_version,
      capability_type: capability,
      target_question_refs: ["Q-CONTROLLED-01"],
      target_judgment_unit_refs: [unit.id],
      target_ontology_object_refs: [],
      status: "candidate" as const,
      precondition_checks: registered.preconditions.map((precondition) => ({
        precondition_id: precondition,
        result: "not_checked" as const,
        evidence_refs: [],
        reason: "Stage02 仅登记候选方法；须在后续阶段以事实级证据核验",
      })),
      input_evidence_refs: [],
      output_signal_refs: [],
      output_judgment_refs: [],
      execution_summary: "",
      applicability_boundary: String(applicability || `用于 ${unit.judgment_type} 判断`),
      limitations: [...registered.not_applicable_when],
      counter_example_refs: [...registered.counter_examples],
      provenance: { stage: "stage_02" as const, source_application_id: null, actor: "human-controlled-structure-projection", recorded_at: null },
      alternatives: registered.alternatives.map((alternative) => ({ method_id: alternative, decision: "not_selected", reason: "保留为前置条件不满足时的替代路线" })),
    };
  });
}

function controlledVariablesForUnits(units: Array<{ id: string; title: string; question: string; evidence_requirements: string[] }>) {
  return units.map((unit, index) => {
    const id = `V-CONTROLLED-${String(index + 1).padStart(2, "0")}`;
    return {
      id,
      name: unit.title,
      category: "task_specific",
      definition: unit.question,
      variable_kind: "observed_or_adjudicated",
      anchors: [...unit.evidence_requirements],
      ontology_node_id: `task_local:${id}`,
      role: "judgment_input",
    };
  });
}

export function createControlledStructureProjection(runId: string, raw: ControlledStructureInput) {
  const run = getRun(runId);
  if (!run) throw new Error("研究任务不存在");
  if (!latestArtifact(runId, "stage_01", ["approved"])) throw new Error("请先确认阶段 01");
  if (latestArtifact(runId, "stage_02", ["running"])) throw new Error("请先取消运行中的 Stage 02");
  const sourceArtifact = latestArtifact(runId, "stage_02", ["approved", "needs_review"]);
  const previous = sourceArtifact ? parseJson<any>(sourceArtifact.json_content, {}) : {};
  const previousUnitsById = new Map<string, any>((previous.judgment_units || []).map((unit: any) => [String(unit.id), unit]));
  const previousMas = (previous.method_applications || []) as MethodApplication[];
  const input = raw && typeof raw === "object" ? raw : {} as ControlledStructureInput;
  if (!Array.isArray(input.units) || !input.units.length) throw new Error("受控研究结构至少需要一个 JudgmentUnit");
  const stage01 = latestArtifact(runId, "stage_01", ["approved"]);
  const stage01Data = stage01 ? parseJson<any>(stage01.json_content, {}) : {};
  const derivedScopeLabel = [
    String(stage01Data.core_object || "").trim(),
    String(stage01Data.judgment_action || "").trim(),
  ].filter(Boolean).join("；") || String(run.question || "").trim();
  const scopeLabel = String(
    input.scope_label || previous.research_scope?.label || derivedScopeLabel || "",
  ).trim();
  if (!scopeLabel) throw new Error("无法从 Stage01 推导研究范围标签；请先确认阶段 01");
  const allowedTypes = new Set([
    "state_measurement", "trend_direction", "cycle_phase", "mechanism_validation", "causal_attribution",
    "transmission_path", "object_differentiation", "impact_realization", "expectation_gap", "valuation_impact",
  ]);
  const scopeId = String(previous.research_scope?.id || "SCOPE-CONTROLLED");
  const seen = new Set<string>();
  const units = input.units.map((unit, index) => {
    const id = String(unit.id || `JU-CONTROLLED-${String(index + 1).padStart(2, "0")}`).trim();
    if (!id || seen.has(id)) throw new Error(`JudgmentUnit ID 为空或重复: ${id || "<empty>"}`);
    seen.add(id);
    if (!String(unit.title || "").trim() || !String(unit.question || "").trim()) throw new Error(`${id} 缺少标题或原子判断问题`);
    if (!allowedTypes.has(String(unit.judgment_type || ""))) throw new Error(`${id} judgment_type 未登记: ${unit.judgment_type}`);
    const requirements = [...new Set((unit.evidence_requirements || []).map(String).map((item) => item.trim()).filter(Boolean))];
    if (!requirements.length) throw new Error(`${id} 至少需要一条可执行证据要求`);
    const previousUnit = previousUnitsById.get(id);
    return {
      id,
      title: String(unit.title).trim(),
      question: String(unit.question).trim(),
      judgment_type: String(unit.judgment_type),
      scope_ref: String(previousUnit?.scope_ref || scopeId),
      // Preserve prior ontology bindings for unchanged unit ids; new units stay local.
      ontology_node_ids: Array.isArray(previousUnit?.ontology_node_ids)
        ? previousUnit.ontology_node_ids.map(String)
        : [] as string[],
      evidence_requirements: requirements,
    };
  });
  const registry = loadMethodRegistry();
  const methodApplications: MethodApplication[] = units.flatMap((unit, unitIndex) => {
    const previousUnit = previousUnitsById.get(unit.id);
    const existing = previousMas.filter((application) => (application.target_judgment_unit_refs || []).includes(unit.id));
    const capabilities = new Set(existing.map((application) => application.capability_type));
    if (
      previousUnit
      && String(previousUnit.judgment_type) === unit.judgment_type
      && capabilities.has("judgment_structure")
      && capabilities.has("evidence")
      && capabilities.has("adjudication")
    ) {
      return existing;
    }
    return defaultMethodApplicationsForUnit(unit, unitIndex, registry);
  });
  const previousUnitIds = (previous.judgment_units || []).map((unit: any) => String(unit.id));
  const nextUnitIds = units.map((unit) => unit.id);
  const sameUnits = sameStringSet(previousUnitIds, nextUnitIds);
  const variables = sameUnits && Array.isArray(previous.variables) && previous.variables.length
    ? previous.variables
    : controlledVariablesForUnits(units);
  const variableIds = new Set(variables.map((variable: any) => String(variable.id)));
  const paths = sameUnits && Array.isArray(previous.paths)
    ? previous.paths.filter((path: any) => (path.variable_ids || []).every((variableId: unknown) => variableIds.has(String(variableId))))
    : [];
  const counterDirections = normalizeCounterEvidenceDirections(input.counter_evidence_directions, { unitIds: nextUnitIds });
  const competing = normalizeCompetingExplanations(input.competing_explanations, { unitIds: nextUnitIds });
  if (!counterDirections.length || !competing.length) throw new Error("受控研究结构必须填写反向证据方向和竞争解释");
  const evidenceRequirements = projectEvidenceRequirementsFromStructure({
    units,
    counter_evidence_directions: counterDirections,
  });
  const questionStatement = String(stage01Data.normalized_question || run.question || scopeLabel).trim();
  const questions = questionStatement
    ? [{
      id: String(previous.questions?.[0]?.id || "RQ-01"),
      question: questionStatement,
      statement: questionStatement,
      scope_ref: scopeId,
      failure_route: "return_to_structure" as const,
    }]
    : [];
  const data = {
    method_applications: methodApplications,
    research_scope: {
      id: scopeId,
      label: scopeLabel,
      dimensions: input.scope_dimensions || previous.research_scope?.dimensions || {
        question: run.question,
        domain: run.domain,
        core_object: stage01Data.core_object,
        judgment_action: stage01Data.judgment_action,
        time_scope: stage01Data.time_scope,
      },
    },
    judgment_units: units,
    variables,
    paths,
    questions,
    evidence_requirements: evidenceRequirements,
    counter_evidence_directions: counterDirections,
    competing_explanations: competing,
    document_markdown: "placeholder",
    research_logic_markdown: "placeholder",
    ontology_view_yaml: "",
    logic_id: String(previous.logic_id || "RLOG-CONTROLLED"),
    ontology_view_ref: String(previous.ontology_view_ref || ""),
    judgment_spine: String(previous.judgment_spine || ""),
    framework_usage_ref: String(previous.framework_usage_ref || ""),
    stage_status: "complete",
    quality_status: "minimum_pass",
    quality_gate_ref: "",
    ontology_gap_scan_status: "minor_gap",
    can_enter_03: true,
  };
  ensureStage02DocumentFields(data, { question: run.question, taskId: run.id });
  syncStage02ReadableMarkdown(data);
  ensureStage02DocumentFields(data, { question: run.question, taskId: run.id });
  schemas.stage_02.parse(data);
  validateGeneratedSemanticDraft(runId, "stage_02", data);
  if (sourceArtifact) return editArtifact(sourceArtifact.id, JSON.stringify(data, null, 2), data.document_markdown);
  const artifact = createArtifact(runId, "stage_02", {
    status: "needs_review",
    prompt_version: `${PROMPT_VERSION}:human-controlled-structure-projection`,
    knowledge_version: "runtime-controlled-structure-projection-v1",
    input_context: JSON.stringify({ question: run.question, controlled_structure: input }, null, 2),
    json_content: JSON.stringify(data, null, 2),
    markdown_content: data.document_markdown,
    model_name: "human-controlled-structure-projection",
    tool_usage: JSON.stringify({ controlled_projection: true, unit_count: units.length, method_application_count: methodApplications.length }),
  });
  syncReviewWorkItems(artifact, data);
  return artifact;
}

/**
 * Soft-repair near-miss Stage 03 drafts before schema validation.
 * Models often emit gap drafts + blocked evidence MAs but forget
 * input_evidence_refs / alternatives bindings required by the contract.
 * Also: empty source quotes, dangling EV-* refs after partial patches.
 */
export function repairEvidencePreparationDraft(data: any): any {
  if (!data || typeof data !== "object") return data;
  let normalized: any = normalizeEvidencePreparationNulls(data);
  normalized = dropIncompleteSources(normalized);
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
  const evidenceDrafts = (structure.judgment_units || []).flatMap((unit: any, unitIndex: number) => {
    const requirements = unit.evidence_requirements?.length
      ? unit.evidence_requirements
      : [`${unit.title || unit.id} 缺少可核验的直接证据`];
    const gaps = requirements.map((requirement: string, requirementIndex: number) => ({
      id: `GAP-${String(unitIndex + 1).padStart(2, "0")}-${String(requirementIndex + 1).padStart(2, "0")}`,
      statement: `未取得可核验来源：${requirement}`,
      kind: "gap" as const,
      direction: "unknown" as const,
      source_keys: [],
      source_ids: [],
      judgment_unit_ids: [unit.id],
      ontology_node_ids: unit.ontology_node_ids || [],
      requirement,
      evidence_role: "support" as const,
      minimum_independent_sources: 2,
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

export type ControlledJudgmentInput = {
  judgment_unit_id: string;
  conclusion: string;
  evidence_draft_ids?: string[];
  supporting_evidence_draft_ids?: string[];
  counter_evidence_draft_ids?: string[];
  rationale?: string;
  uncertainties?: string[];
  invalidation_conditions?: string[];
  competing_explanation?: string;
  source_explanation_id?: string;
  discriminating_evidence?: string[];
  counterevidence_resolution?: string;
  confirmed_precondition_ids?: string[];
  tracking_signals?: string[];
  conditions?: string[];
};

export function createControlledJudgmentProjection(runId: string, inputs: ControlledJudgmentInput[]) {
  const run = getRun(runId);
  if (!run) throw new Error("研究任务不存在");
  if (latestArtifact(runId, "stage_04", ["running"])) throw new Error("请先取消运行中的 Stage 04");
  const structureArtifact = latestArtifact(runId, "stage_02", ["approved"]);
  const evidenceArtifact = latestArtifact(runId, "stage_03", ["approved"]);
  if (!structureArtifact || !evidenceArtifact) throw new Error("请先确认阶段 02 和 03");
  if (!Array.isArray(inputs) || !inputs.length) throw new Error("受控判断投影至少需要一条显式 JudgmentUnit 裁决输入");

  const structure = parseJson<any>(structureArtifact.json_content, {});
  const evidence = parseJson<any>(evidenceArtifact.json_content, {});
  const unitById = new Map<string, any>((structure.judgment_units || []).map((unit: any) => [String(unit.id), unit]));
  const factById = new Map<string, any>((evidence.evidence_drafts || []).filter((item: any) => item.kind !== "gap").map((item: any) => [String(item.id), item]));
  const seenUnits = new Set<string>();
  const normalizedInputs = inputs.map((input) => {
    const unitId = String(input.judgment_unit_id || "");
    if (!unitById.has(unitId)) throw new Error(`JudgmentUnit 不存在: ${unitId}`);
    if (seenUnits.has(unitId)) throw new Error(`JudgmentUnit 重复裁决: ${unitId}`);
    seenUnits.add(unitId);
    if (!String(input.conclusion || "").trim()) throw new Error(`${unitId} 缺少显式 conclusion`);
    const supportingIds = [...new Set((input.supporting_evidence_draft_ids || input.evidence_draft_ids || []).map(String))];
    const counterIds = [...new Set((input.counter_evidence_draft_ids || []).map(String))];
    if (supportingIds.some((id) => counterIds.includes(id))) throw new Error(`${unitId} 同一事实不能同时标记为支持与反证`);
    const evidenceIds = [...new Set([...supportingIds, ...counterIds])];
    if (!evidenceIds.length) throw new Error(`${unitId} 至少需要一条已批准事实`);
    for (const id of evidenceIds) {
      const fact = factById.get(id);
      if (!fact) throw new Error(`${unitId} 引用了不存在或 gap 的事实 ${id}`);
      if (!(fact.judgment_unit_ids || []).map(String).includes(unitId)) throw new Error(`${id} 未在 Stage03 绑定 ${unitId}`);
    }
    return {
      ...input,
      judgment_unit_id: unitId,
      conclusion: input.conclusion.trim(),
      evidence_draft_ids: evidenceIds,
      supporting_evidence_draft_ids: supportingIds,
      counter_evidence_draft_ids: counterIds,
      confirmed_precondition_ids: [...new Set((input.confirmed_precondition_ids || []).map(String))],
    };
  });

  const inputByUnit = new Map(normalizedInputs.map((input) => [input.judgment_unit_id, input]));
  for (const unitId of unitById.keys()) {
    if (!inputByUnit.has(unitId)) throw new Error(`受控判断投影不得遗漏 JudgmentUnit ${unitId}`);
  }
  const recordedAt = new Date().toISOString();
  const ids = new Map(normalizedInputs.map((input, index) => [input.judgment_unit_id, {
    judgment: `J-CONTROLLED-${String(index + 1).padStart(2, "0")}`,
    supportSignal: `SIG-CONTROLLED-${String(index + 1).padStart(2, "0")}-S`,
    weakenSignal: `SIG-CONTROLLED-${String(index + 1).padStart(2, "0")}-W`,
    hypothesis: `H-CONTROLLED-${String(index + 1).padStart(2, "0")}`,
    competition: `CE-CONTROLLED-${String(index + 1).padStart(2, "0")}`,
    trace: `RT-CONTROLLED-${String(index + 1).padStart(2, "0")}`,
  }]));

  const methodRegistry = loadMethodRegistry();
  const applications: MethodApplication[] = (evidence.method_applications || []).map((application: MethodApplication) => {
    const boundInputs = application.target_judgment_unit_refs.map((unitId) => inputByUnit.get(unitId)).filter(Boolean) as ControlledJudgmentInput[];
    const evidenceRefs = [...new Set(boundInputs.flatMap((input) => input.evidence_draft_ids || []))];
    const judgmentRefs = [...new Set(application.target_judgment_unit_refs.map((unitId) => ids.get(unitId)?.judgment).filter(Boolean))] as string[];
    const signalRefs = [...new Set(application.target_judgment_unit_refs.flatMap((unitId) => {
      const input = inputByUnit.get(unitId);
      const unitIds = ids.get(unitId);
      return [
        input?.supporting_evidence_draft_ids?.length ? unitIds?.supportSignal : null,
        input?.counter_evidence_draft_ids?.length ? unitIds?.weakenSignal : null,
      ].filter(Boolean);
    }))] as string[];
    if (!evidenceRefs.length) throw new Error(`${application.application_id} 没有可执行的事实输入`);
    const registeredPreconditions = methodRegistry.get(application.method_id)?.preconditions || [];
    const confirmed = new Set(boundInputs.flatMap((input) => input.confirmed_precondition_ids || []));
    const automaticallyConfirmed = new Set(["controlled_source_verification", "judgment_unit", "object_scope"]);
    const missingPreconditions = registeredPreconditions.filter((precondition) => !confirmed.has(precondition) && !automaticallyConfirmed.has(precondition));
    const checks = registeredPreconditions.length
      ? registeredPreconditions.map((precondition) => {
        const passed = confirmed.has(precondition) || automaticallyConfirmed.has(precondition);
        return {
          precondition_id: precondition,
          result: passed ? "pass" as const : "fail" as const,
          evidence_refs: evidenceRefs,
          reason: passed
            ? (automaticallyConfirmed.has(precondition) ? "由已批准结构或来源冻结合同确定性确认" : "研究者在受控裁决中显式确认，并绑定已批准事实")
            : "研究者未显式确认该语义前置条件；抓取成功不能代替方法适用性",
        };
      })
      : [{
        precondition_id: "controlled_judgment_input",
        result: "pass" as const,
        evidence_refs: evidenceRefs,
        reason: "该方法无额外登记前置条件；输入只来自已批准事实",
      }];
    const executed = missingPreconditions.length === 0;
    return {
      ...application,
      status: executed ? "executed" as const : "degraded" as const,
      precondition_checks: checks,
      input_evidence_refs: evidenceRefs,
      output_signal_refs: application.capability_type === "evidence" ? signalRefs : [],
      output_judgment_refs: application.capability_type === "evidence" ? [] : judgmentRefs,
      execution_summary: executed
        ? `基于 ${evidenceRefs.join("、")} 完成受控 ${application.capability_type} 执行；方向与证据上限由 Runtime 再校验`
        : `未执行：缺少显式确认的语义前置条件 ${missingPreconditions.join("、")}`,
      limitations: [...new Set([...(application.limitations || []), ...(executed ? [] : [`方法前置条件未满足：${missingPreconditions.join("、")}`])])],
      provenance: {
        ...application.provenance,
        stage: "stage_04" as const,
        source_application_id: application.application_id,
        actor: "human-controlled-judgment-projection",
        recorded_at: recordedAt,
      },
      alternatives: application.alternatives.length
        ? application.alternatives
        : executed ? [] : [{ method_id: application.method_id, decision: "retry_after_precondition_confirmation", reason: "补齐并确认语义前置条件后重试" }],
    };
  });

  const signals = normalizedInputs.flatMap((input) => [
    input.supporting_evidence_draft_ids?.length ? {
      id: ids.get(input.judgment_unit_id)!.supportSignal,
      statement: `已批准事实支持待检验结论：${input.conclusion}`,
      role: "support" as const,
      evidence_draft_ids: input.supporting_evidence_draft_ids,
      judgment_unit_ids: [input.judgment_unit_id],
      target_hypothesis_ids: [ids.get(input.judgment_unit_id)!.hypothesis],
    } : null,
    input.counter_evidence_draft_ids?.length ? {
      id: ids.get(input.judgment_unit_id)!.weakenSignal,
      statement: `已批准事实削弱或限制待检验结论：${input.conclusion}`,
      role: "weaken" as const,
      evidence_draft_ids: input.counter_evidence_draft_ids,
      judgment_unit_ids: [input.judgment_unit_id],
      target_hypothesis_ids: [ids.get(input.judgment_unit_id)!.hypothesis],
    } : null,
  ].filter(Boolean)) as any[];
  const hypotheses = normalizedInputs.map((input) => ({
    id: ids.get(input.judgment_unit_id)!.hypothesis,
    statement: input.conclusion,
    signal_ids: [
      input.supporting_evidence_draft_ids?.length ? ids.get(input.judgment_unit_id)!.supportSignal : null,
      input.counter_evidence_draft_ids?.length ? ids.get(input.judgment_unit_id)!.weakenSignal : null,
    ].filter(Boolean) as string[],
    falsification_conditions: input.invalidation_conditions?.length
      ? [...new Set(input.invalidation_conditions.map(String))]
      : ["取得与当前结论方向相反且同口径、可定位、截止时间合规的新事实"],
    time_horizon: "仅限 Stage01 冻结的研究截止时点与范围",
    judgment_unit_ids: [input.judgment_unit_id],
  }));
  const structureCandidates = normalizeCompetingExplanations(structure.competing_explanations, {
    unitIds: [...unitById.keys()],
  });
  const competingExplanations = normalizedInputs.flatMap((input) => {
    const unitIds = ids.get(input.judgment_unit_id)!;
    const signalIds = [
      input.supporting_evidence_draft_ids?.length ? unitIds.supportSignal : null,
      input.counter_evidence_draft_ids?.length ? unitIds.weakenSignal : null,
    ].filter(Boolean) as string[];
    const discriminating = input.discriminating_evidence?.length
      ? [...new Set(input.discriminating_evidence.map(String))]
      : ["取得跨期、同口径且来源独立的后续观察，检验当前信号是否延续并排除短期扰动"];
    const status = input.counterevidence_resolution ? "weakened" as const : "active" as const;
    const eliminationRationale = input.counterevidence_resolution
      ? `研究者记录的有限裁决：${input.counterevidence_resolution}；竞争解释仍不得标记为 eliminated`
      : "尚未取得足以排除该解释的区分性证据";
    const bound = competingExplanationsForUnit(structureCandidates, input.judgment_unit_id);
    const primarySourceId = String(input.source_explanation_id || bound[0]?.explanation_id || "").trim();
    const primarySource = bound.find((item) => item.explanation_id === primarySourceId) || bound[0];
    const primaryStatement = String(input.competing_explanation || primarySource?.statement || "观察到的变化可能来自短期扰动、口径差异或提前行为，而非待检验的可持续机制");
    const primary = {
      id: unitIds.competition,
      statement: primaryStatement,
      signal_ids: signalIds,
      discriminating_evidence: discriminating,
      status,
      elimination_rationale: eliminationRationale,
      source_explanation_id: primarySource?.explanation_id,
      judgment_unit_ids: [input.judgment_unit_id],
    };
    const extras = bound
      .filter((item) => item.explanation_id !== primary.source_explanation_id)
      .map((item, index) => ({
        id: `${unitIds.competition}-S${String(index + 2).padStart(2, "0")}`,
        statement: item.statement,
        signal_ids: signalIds,
        discriminating_evidence: discriminating,
        status: "active" as const,
        elimination_rationale: "来自 Stage02 结构候选；本轮未作为主裁决竞争解释编辑",
        source_explanation_id: item.explanation_id,
        judgment_unit_ids: [input.judgment_unit_id],
      }));
    return [primary, ...extras];
  });
  const sourceRecords = new Map(listSources(runId).map((source) => [source.id, source]));
  const judgments = normalizedInputs.map((input) => {
    const unit = unitById.get(input.judgment_unit_id);
    const applicationIds = applications
      .filter((application: MethodApplication) => application.target_judgment_unit_refs.includes(input.judgment_unit_id))
      .map((application: MethodApplication) => application.application_id);
    const inputFacts = (input.evidence_draft_ids || []).map((id) => factById.get(id)).filter(Boolean);
    const sourceGroups = new Set(inputFacts.flatMap((fact) => fact.source_ids || []).map((sourceId) => {
      const source = sourceRecords.get(String(sourceId));
      return source?.source_group || source?.publisher || source?.normalized_url || String(sourceId);
    }));
    const unresolvedConflict = Boolean(input.supporting_evidence_draft_ids?.length && input.counter_evidence_draft_ids?.length && !String(input.counterevidence_resolution || "").trim());
    const executedAdjudication = applications.some((application) => application.capability_type === "adjudication"
      && application.status === "executed" && application.target_judgment_unit_refs.includes(input.judgment_unit_id));
    const blockedByMethod = !executedAdjudication;
    const strength = unresolvedConflict || blockedByMethod ? "J0" as const : inputFacts.length >= 2 && sourceGroups.size >= 2 ? "J2" as const : "J1" as const;
    const decisionStatus = unresolvedConflict ? "contested" as const : blockedByMethod ? "indeterminate" as const : "supported" as const;
    const stopReason = unresolvedConflict
      ? "支持与反向证据并存，尚缺能够区分短期扰动与可持续改善的后续同口径证据"
      : blockedByMethod ? "裁决方法的语义前置条件未被显式确认，不能把已抓取来源直接升级为判断" : null;
    const defaultRationale = unresolvedConflict
      ? "支持证据与反向证据同时存在，且没有记录足以解决冲突的区分性证据；结论保持 J0/contested"
      : blockedByMethod
        ? "事实已登记，但裁决方法前置条件未满足；结论保持 J0/indeterminate"
        : `仅依据已批准事实 ${input.evidence_draft_ids?.join("、")} 形成受控判断；共 ${inputFacts.length} 条事实、${sourceGroups.size} 个来源组，强度上限为 ${strength}`;
    const researcherRationale = String(input.rationale || "").trim();
    const defaultConditions = ["只在已批准事实、冻结截止时间与所列适用范围内成立；不自动外推原因、持续性、行业全面性或投资建议"];
    const customConditions = (input.conditions || []).map(String).map((item) => item.trim()).filter(Boolean);
    const defaultTracking = [...new Set([...(input.discriminating_evidence || []), ...(input.invalidation_conditions || [])])];
    const customTracking = (input.tracking_signals || []).map(String).map((item) => item.trim()).filter(Boolean);
    return {
      id: ids.get(input.judgment_unit_id)!.judgment,
      judgment_unit_id: input.judgment_unit_id,
      title: String(unit.title || input.judgment_unit_id),
      conclusion: input.conclusion,
      rationale: (unresolvedConflict || blockedByMethod) ? defaultRationale : (researcherRationale || defaultRationale),
      strength,
      confidence: strength === "J2" ? "medium" as const : "low" as const,
      decision_status: decisionStatus,
      conflict_status: unresolvedConflict ? "unresolved" as const : input.counter_evidence_draft_ids?.length ? "resolved" as const : "none" as const,
      not_judgeable_reason: stopReason,
      scope_ref: String(unit.scope_ref || structure.research_scope?.id),
      cutoff_at: normalizeBusinessCutoff(parseJson<any>(latestArtifact(runId, "stage_01", ["approved"])?.json_content || "{}", {}).time_scope?.as_of)!,
      conditions: customConditions.length ? customConditions : defaultConditions,
      supporting_evidence_draft_ids: input.supporting_evidence_draft_ids || [],
      counter_evidence_draft_ids: input.counter_evidence_draft_ids || [],
      hypothesis_ids: [ids.get(input.judgment_unit_id)!.hypothesis],
      rule_evaluation_ids: [],
      method_application_ids: applicationIds,
      ontology_node_ids: unit.ontology_node_ids || [],
      uncertainties: [...new Set([...(input.uncertainties || []), ...(sourceGroups.size < 2 ? ["当前事实缺少两个独立来源组的交叉验证"] : [])])],
      invalidation_conditions: input.invalidation_conditions?.length
        ? [...new Set(input.invalidation_conditions.map(String))]
        : ["取得与当前结论方向相反且同口径、可定位、截止时间合规的新事实"],
      tracking_signals: customTracking.length ? [...new Set(customTracking)] : [...new Set(defaultTracking)],
    };
  });
  const reasoningTraces = judgments.map((judgment) => ({
    id: ids.get(judgment.judgment_unit_id)!.trace,
    judgment_id: judgment.id,
    node_ids: [...new Set([
      judgment.scope_ref,
      judgment.judgment_unit_id,
      ...judgment.supporting_evidence_draft_ids,
      ...judgment.counter_evidence_draft_ids,
      ...judgment.hypothesis_ids,
      ...signals.filter((signal) => signal.judgment_unit_ids.includes(judgment.judgment_unit_id)).map((signal) => signal.id),
      ...judgment.method_application_ids,
      judgment.id,
    ])],
    created_at: recordedAt,
  }));
  const data: any = {
    method_applications: applications,
    signals,
    hypotheses,
    competing_explanations: competingExplanations,
    rule_evaluations: [],
    judgments,
    reasoning_traces: reasoningTraces,
    overall_boundary: "受控裁决只使用已批准事实；未解决的支持/反向证据冲突保持 J0/contested，已形成方向的判断也不外推原因、持续性、行业全面性或投资建议。",
    document_markdown: [
      "# 受控判断结果",
      "",
      ...judgments.map((judgment) => `- ${judgment.title}：${judgment.conclusion}（${judgment.strength}；${judgment.supporting_evidence_draft_ids.join("、")}）`),
      "",
      "## 总体边界",
      "",
      "未解决的证据冲突保持 J0/contested；其余判断的强度由事实数量、来源组和 Runtime 确定性规则共同限制。受控路径不把研究者填写的结论自动升级为强判断。",
    ].join("\n"),
  };
  applyDeterministicRuleEvaluations(data, evidence.evidence_drafts || [], listSources(runId), structure);
  syncStage04ReadableMarkdown(data, { question: run.question, taskId: runId });
  schemas.stage_04.parse(data);
  validateGeneratedSemanticDraft(runId, "stage_04", data);
  const artifact = createArtifact(runId, "stage_04", {
    status: "needs_review",
    prompt_version: `${PROMPT_VERSION}:human-controlled-judgment-projection`,
    knowledge_version: "runtime-controlled-judgment-projection-v1",
    input_context: JSON.stringify({
      question: run.question,
      stage_02_artifact_id: structureArtifact.id,
      stage_03_artifact_id: evidenceArtifact.id,
      stage_03_artifact_hash: createHash("sha256").update(evidenceArtifact.json_content).digest("hex"),
      judgments: inputs,
    }, null, 2),
    json_content: JSON.stringify(data, null, 2),
    markdown_content: data.document_markdown,
    model_name: "human-controlled-judgment-projection",
    tool_usage: JSON.stringify({ controlled_projection: true, judgment_count: judgments.length, deterministic_rules: true }),
    error_message: null,
  });
  syncReviewWorkItems(artifact, data);
  return artifact;
}

export function buildJudgmentGapFallback(structure: any, evidence: any, reason: string) {
  const gapsByUnit = new Map<string, string[]>();
  for (const gap of evidence.evidence_drafts || []) {
    for (const unitId of gap.judgment_unit_ids || []) {
      gapsByUnit.set(unitId, [...(gapsByUnit.get(unitId) || []), gap.id]);
    }
  }
  const applications = (evidence.method_applications || []).map((application: MethodApplication) => {
    const gapRefs = [...new Set(application.target_judgment_unit_refs.flatMap((unitId) => gapsByUnit.get(unitId) || []))];
    return {
      ...application,
      status: "blocked" as const,
      precondition_checks: [{
        precondition_id: "fact_level_evidence_available",
        result: "fail" as const,
        evidence_refs: gapRefs,
        reason,
      }],
      input_evidence_refs: gapRefs,
      output_signal_refs: [],
      output_judgment_refs: [],
      execution_summary: "",
      limitations: [...new Set([...(application.limitations || []), "上游只有证据缺口，没有可用于执行的方法输入事实"])],
      provenance: {
        ...application.provenance,
        stage: "stage_04" as const,
        source_application_id: application.application_id,
        actor: "runtime-j0-fallback",
        recorded_at: null,
      },
      alternatives: application.alternatives.length
        ? application.alternatives
        : [{ method_id: application.method_id, decision: "retry_after_evidence", reason: "补齐事实级证据后重试同一登记方法" }],
    };
  });
  const scopeRef = String(structure.research_scope?.id || "SCOPE-UNRESOLVED");
  const cutoff = new Date().toISOString();
  const hypotheses: any[] = [];
  const competingExplanations: any[] = [];
  const ruleEvaluations: any[] = [];
  const judgments: any[] = [];
  const reasoningTraces: any[] = [];
  for (const [index, unit] of (structure.judgment_units || []).entries()) {
    const suffix = String(index + 1).padStart(2, "0");
    const hypothesisId = `H-J0-${suffix}`;
    const explanationId = `CE-J0-${suffix}`;
    const judgmentId = `J-J0-${suffix}`;
    const ruleId = `RE-SYS-PLACEHOLDER-${suffix}`;
    const adjudication = applications.find((application: MethodApplication) =>
      application.capability_type === "adjudication" && application.target_judgment_unit_refs.includes(unit.id));
    if (!adjudication) throw new Error(`${unit.id} 缺少 adjudication MA，不能生成 J0 降级判断`);
    const requirements = unit.evidence_requirements?.length ? unit.evidence_requirements : ["事实级证据"];
    hypotheses.push({
      id: hypothesisId,
      statement: `${unit.title} 的方向命题目前未被事实级证据检验`,
      signal_ids: [],
      falsification_conditions: requirements.map((item: string) => `取得并核验：${item}`),
      time_horizon: "补齐证据后重新裁决",
      judgment_unit_ids: [String(unit.id)],
    });
    const stage02Candidates = competingExplanationsForUnit(
      normalizeCompetingExplanations(structure.competing_explanations, { unitIds: (structure.judgment_units || []).map((unit: any) => String(unit.id)) }),
      String(unit.id),
    );
    if (stage02Candidates.length) {
      for (const [candidateIndex, candidate] of stage02Candidates.entries()) {
        competingExplanations.push({
          id: candidateIndex === 0 ? explanationId : `${explanationId}-S${String(candidateIndex + 1).padStart(2, "0")}`,
          statement: candidate.statement,
          signal_ids: [],
          discriminating_evidence: requirements,
          status: "unknown" as const,
          elimination_rationale: "没有事实级 Signal，不能排除任何竞争解释",
          source_explanation_id: candidate.explanation_id,
          judgment_unit_ids: [String(unit.id)],
        });
      }
    } else {
      competingExplanations.push({
        id: explanationId,
        statement: `${unit.title} 可能改善、恶化或分化，当前均无法排除`,
        signal_ids: [],
        discriminating_evidence: requirements,
        status: "unknown" as const,
        elimination_rationale: "没有事实级 Signal，不能排除任何竞争解释",
        judgment_unit_ids: [String(unit.id)],
      });
    }
    ruleEvaluations.push({
      id: ruleId,
      rule_ref: "judgment_status_consistency",
      input_refs: [judgmentId],
      condition_results: [{
        condition_id: "j0_gap_path",
        expression: "gap_only => J0/indeterminate",
        input_refs: [judgmentId],
        outcome: "pass" as const,
        rationale: "上游只有 gap，判断保持 J0/indeterminate",
      }],
      result: "pass" as const,
      deterministic_result: null,
    });
    judgments.push({
      id: judgmentId,
      judgment_unit_id: unit.id,
      title: `${unit.title}：暂不可判断`,
      conclusion: "当前暂不可形成方向判断",
      rationale: `${reason}；没有可核验 EvidenceFact 或 Signal，禁止输出支持、削弱或趋势方向。`,
      strength: "J0" as const,
      confidence: "low" as const,
      decision_status: "indeterminate" as const,
      conflict_status: "none" as const,
      not_judgeable_reason: `缺少：${requirements.join("；")}`,
      scope_ref: scopeRef,
      cutoff_at: cutoff,
      conditions: ["仅当事实级证据补齐并重新执行裁决方法后才能升级"],
      supporting_evidence_draft_ids: [],
      counter_evidence_draft_ids: [],
      hypothesis_ids: [hypothesisId],
      rule_evaluation_ids: [ruleId],
      method_application_ids: [adjudication.application_id],
      ontology_node_ids: unit.ontology_node_ids || [],
      uncertainties: requirements,
      invalidation_conditions: ["取得足以形成至少 J1 的可核验事实级证据"],
      tracking_signals: requirements,
    });
    reasoningTraces.push({
      id: `RT-J0-${suffix}`,
      judgment_id: judgmentId,
      node_ids: [unit.id, hypothesisId, ruleId, adjudication.application_id, judgmentId],
      created_at: cutoff,
    });
  }
  return {
    method_applications: applications,
    signals: [],
    hypotheses,
    competing_explanations: competingExplanations,
    rule_evaluations: ruleEvaluations,
    judgments,
    reasoning_traces: reasoningTraces,
    overall_boundary: "上游只有经人工接受的证据缺口；本产物只登记 J0/暂不可判断，不包含任何方向性结论。",
    document_markdown: `# 判断降级结果\n\n上游 03 只有证据缺口，没有可核验事实。系统因此将全部方法收敛为 blocked，并为 ${judgments.length} 个判断单元生成 J0/暂不可判断结果。该结果仍需逐项人工审阅，不能被表达为行业方向或价格预测。\n\n失败原因：${reason}`,
  };
}

export function createJudgmentGapFallback(runId: string, reason: string) {
  const run = getRun(runId);
  if (!run) throw new Error("研究任务不存在");
  if (latestArtifact(runId, "stage_04", ["running"])) throw new Error("请先取消运行中的 Stage 04");
  const structureArtifact = latestArtifact(runId, "stage_02", ["approved"]);
  const evidenceArtifact = latestArtifact(runId, "stage_03", ["approved"]);
  if (!structureArtifact || !evidenceArtifact) throw new Error("请先确认阶段 02 和 03");
  const structure = parseJson<any>(structureArtifact.json_content, {});
  const evidence = parseJson<any>(evidenceArtifact.json_content, {});
  if ((evidence.evidence_drafts || []).some((item: any) => item.kind !== "gap")) {
    throw new Error("上游存在事实级证据，不能使用全量 J0 降级；请重新运行正常裁决");
  }
  const data = buildJudgmentGapFallback(structure, evidence, reason);
  applyDeterministicRuleEvaluations(data, evidence.evidence_drafts || [], listSources(runId), structure);
  syncStage04ReadableMarkdown(data, { question: run.question, taskId: runId });
  schemas.stage_04.parse(data);
  validateGeneratedSemanticDraft(runId, "stage_04", data);
  const artifact = createArtifact(runId, "stage_04", {
    status: "needs_review",
    prompt_version: `${PROMPT_VERSION}:explicit-j0-fallback`,
    knowledge_version: "runtime-deterministic-j0-fallback-v1",
    input_context: JSON.stringify({
      question: run.question,
      stage_02_artifact_id: structureArtifact.id,
      stage_03_artifact_id: evidenceArtifact.id,
      stage_03_artifact_hash: createHash("sha256").update(evidenceArtifact.json_content).digest("hex"),
      fact_count: 0,
      fallback_reason: reason,
    }, null, 2),
    json_content: JSON.stringify(data, null, 2),
    markdown_content: data.document_markdown,
    model_name: "runtime-deterministic-j0-fallback",
    tool_usage: JSON.stringify({ degraded: true, failure_category: "model_output_error", reason }),
    error_message: `[model_output_error] ${reason}；已降级为 J0 判断，尚未确认`,
  });
  syncReviewWorkItems(artifact, data);
  return artifact;
}

/**
 * Stage05 投影对齐：校验 claim↔judgment，必要时补齐字段与审计 YAML。
 * 不得整篇覆盖 LLM/人工研报正文为「研究判断简报」骨架。
 * options.forceDeterministicSkeleton=true 仅用于 deterministic_projection 草稿路径。
 */
export function normalizeStage05Projection(
  data: any,
  stage04: any,
  question: string,
  sources: SourceRecord[],
  options: { forceDeterministicSkeleton?: boolean } = {},
) {
  const judgmentById = new Map<string, any>((stage04.judgments || []).map((item: any) => [String(item.id), item]));
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  for (const claim of data.report_claims || []) {
    const judgments = (claim.judgment_ids || []).map((id: string) => judgmentById.get(String(id))).filter(Boolean);
    if (!judgments.length) throw new Error(`${claim.id} 无法从已确认 Judgment 重建表达`);
    // 结构化 statement 对齐判断卡；强度编码仅留在字段/审计，不写入读者标题。
    claim.statement = judgments.map((judgment: any) =>
      `${judgment.title}：${judgment.conclusion}`).join("；");
  }

  const derivedPoints = (data.report_claims || []).flatMap((claim: any) =>
    (claim.judgment_ids || []).map((id: string) => {
      const judgment = judgmentById.get(String(id));
      return judgment ? `${judgment.title}：${judgment.conclusion}` : claim.statement;
    }));
  const derivedLimitations = [...new Set([
    String(stage04.overall_boundary || "").trim(),
    ...(stage04.judgments || []).flatMap((judgment: any) => [
      ...(judgment.uncertainties || []),
      ...(judgment.invalidation_conditions || []).map((item: string) => `改判条件：${item}`),
    ]),
  ].filter(Boolean))];

  const existingBody = stripInlineAuditDetails(String(data.document_markdown || ""));
  const preserve = !options.forceDeterministicSkeleton && shouldPreserveStage05Markdown(existingBody);

  // 压平/重建路径：要点与边界必须来自已确认判断，丢弃自由正文越权主张。
  if (!preserve) {
    data.executive_points = derivedPoints;
    data.limitations = derivedLimitations;
  } else {
    if (!Array.isArray(data.executive_points) || !data.executive_points.length) {
      data.executive_points = derivedPoints;
    }
    if (!Array.isArray(data.limitations) || !data.limitations.length) {
      data.limitations = derivedLimitations;
    }
  }
  if (!String(data.title || "").trim() || String(data.title).includes("研究判断简报")) {
    const primary = (stage04.judgments || [])[0];
    data.title = primary?.conclusion
      ? String(primary.conclusion).replace(/\s+/g, " ").trim().slice(0, 80)
      : String(question || "行业周期判断").replace(/\s+/g, " ").trim().slice(0, 80);
  }

  const usedSourceIds = new Set<string>((data.report_claims || []).flatMap((claim: any) => claim.source_ids || []).map(String));
  const usedSources = [...usedSourceIds].map((id) => sourceById.get(id)).filter(Boolean) as SourceRecord[];
  const sourceLines = usedSources.map((source) => `[${source.title}](${source.url})`);

  if (preserve) {
    data.document_markdown = existingBody;
  } else {
    // 重建骨架时丢弃自由叙述标题/要点/限制，只保留判断卡派生内容，防止过声称进入正文。
    const primary = (stage04.judgments || [])[0];
    data.title = primary?.conclusion
      ? String(primary.conclusion).replace(/\s+/g, " ").trim().slice(0, 80)
      : String(question || "行业周期判断").replace(/\s+/g, " ").trim().slice(0, 80);
    data.executive_points = derivedPoints;
    data.limitations = derivedLimitations;
    data.document_markdown = buildStage05SkeletonMarkdown({
      title: data.title,
      question,
      executivePoints: data.executive_points,
      limitations: data.limitations,
      sourceLines,
      claims: (data.report_claims || []).map((claim: any) => {
        const judgments = (claim.judgment_ids || []).map((id: string) => judgmentById.get(String(id))).filter(Boolean);
        const claimSources = (claim.source_ids || []).map((id: string) => sourceById.get(String(id))).filter(Boolean) as SourceRecord[];
        return {
          id: String(claim.id),
          statement: String(claim.statement || ""),
          judgmentTitles: judgments.map((judgment: any) => judgment.title).filter(Boolean),
          conclusions: judgments.map((judgment: any) => judgment.conclusion).filter(Boolean),
          sourceLines: claimSources.map((source) => {
            const quote = String(source.source_quote || "").replace(/\s+/g, " ").trim();
            const excerpt = quote.length > 500 ? `${quote.slice(0, 500)}…` : quote;
            return `[${source.title}](${source.url})${excerpt ? `：“${excerpt}”` : ""}`;
          }),
          uncertainties: [...new Set(judgments.flatMap((judgment: any) => judgment.uncertainties || []).map(String).filter(Boolean))],
          invalidations: [...new Set(judgments.flatMap((judgment: any) => judgment.invalidation_conditions || []).map(String).filter(Boolean))],
        };
      }),
    });
  }

  // 强制刷新审计投影，确保与 claim 对齐且不含读者面审计腔。
  data.expression_audit_yaml = "";
  ensureStage05DocumentFields(data, { question, stage04 });
  return data;
}

export function createStage05DeterministicProjection(runId: string) {
  const run = getRun(runId);
  if (!run) throw new Error("研究任务不存在");
  const stage04Artifact = latestArtifact(runId, "stage_04", ["approved"]);
  const sourceArtifact = latestArtifact(runId, "stage_05", ["approved", "needs_review"]);
  const stage03Artifact = latestArtifact(runId, "stage_03", ["approved"]);
  if (!stage04Artifact || !stage03Artifact) throw new Error("请先生成并确认 Stage 03 和 Stage 04");
  const stage04 = parseJson<any>(stage04Artifact.json_content, {});
  const stage03 = parseJson<any>(stage03Artifact.json_content, {});
  const evidenceById = new Map<string, any>((stage03.evidence_drafts || []).map((item: any) => [String(item.id), item]));
  const seed = sourceArtifact ? parseJson<any>(sourceArtifact.json_content, {}) : {
    title: "受控表达草稿",
    executive_points: [],
    report_claims: (stage04.judgments || []).map((judgment: any, index: number) => {
      const evidenceIds = [...new Set([
        ...(judgment.supporting_evidence_draft_ids || []),
        ...(judgment.counter_evidence_draft_ids || []),
      ].map(String))];
      const sourceIds = [...new Set(evidenceIds.flatMap((id) => evidenceById.get(id)?.source_ids || []).map(String))];
      return {
        id: `RC-CONTROLLED-${String(index + 1).padStart(2, "0")}`,
        statement: String(judgment.conclusion || judgment.title || judgment.id),
        judgment_ids: [String(judgment.id)],
        method_application_ids: [...new Set((judgment.method_application_ids || []).map(String))],
        evidence_draft_ids: evidenceIds,
        source_ids: sourceIds,
      };
    }),
    limitations: [],
    document_markdown: "placeholder",
  };
  // 确定性路径显式生成 05C 骨架草稿；不得当作抹掉模型研报的默认正式路径。
  const data = normalizeStage05Projection(
    seed,
    stage04,
    run.question,
    listSources(runId),
    { forceDeterministicSkeleton: true },
  );
  schemas.stage_05.parse(data);
  if (sourceArtifact) return editArtifact(sourceArtifact.id, JSON.stringify(data, null, 2), data.document_markdown);
  return createArtifact(runId, "stage_05", {
    status: "needs_review",
    prompt_version: `${PROMPT_VERSION}:runtime-deterministic-expression-v1`,
    knowledge_version: "runtime-deterministic-expression-v1",
    input_context: JSON.stringify({
      question: run.question,
      stage_03_artifact_id: stage03Artifact.id,
      stage_03_artifact_hash: createHash("sha256").update(stage03Artifact.json_content).digest("hex"),
      stage_04_artifact_id: stage04Artifact.id,
      stage_04_artifact_hash: createHash("sha256").update(stage04Artifact.json_content).digest("hex"),
    }, null, 2),
    json_content: JSON.stringify(data, null, 2),
    markdown_content: data.document_markdown,
    model_name: "runtime-deterministic-expression-projection",
    tool_usage: JSON.stringify({ deterministic_projection: true, report_claim_count: data.report_claims.length }),
  });
}

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
  const data = {
    reviewed_stage04_artifact_id: reviewed.id,
    reviewed_stage04_artifact_hash: createHash("sha256").update(reviewed.json_content).digest("hex"),
    verdict: input.verdict,
    issues,
    strengths,
    overall_assessment: assessment,
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
