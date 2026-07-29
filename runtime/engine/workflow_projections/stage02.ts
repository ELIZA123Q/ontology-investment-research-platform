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
import { ONTOLOGY_JUDGMENT_TYPES } from "../ontology_vocabulary.generated";
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
  const allowedTypes = new Set<string>(ONTOLOGY_JUDGMENT_TYPES);
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
