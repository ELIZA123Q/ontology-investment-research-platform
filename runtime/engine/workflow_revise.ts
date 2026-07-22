import "server-only";

import { getRun, latestArtifact, listArtifacts, recordResearchExperienceEvent } from "../adapters/db";
import { createResearchModelClient } from "../adapters/deepseek";
import { parseJson, STAGES, type Artifact, type StageKind } from "./types";
import { stageNumber } from "./workflow_shared";
import { createControlledStructureProjection, createControlledJudgmentProjection, createStage01DeterministicProjection } from "./workflow_projections";
import {
  normalizeCompetingExplanations,
  normalizeCounterEvidenceDirections,
} from "./structure_candidates";
import {
  controlledScopePatchSchema,
  controlledStructurePatchSchema,
  controlledJudgmentPatchSchema,
  structureValidationResultSchema,
  type ControlledScopePatch,
  type ControlledStructurePatchInput,
  type ControlledJudgmentPatch,
  type StructureValidationResult,
  type StructureValidationResultInput,
} from "./revise_schemas";

export {
  controlledScopePatchSchema,
  controlledStructurePatchSchema,
  controlledJudgmentPatchSchema,
  structureValidationResultSchema,
  type ControlledScopePatch,
  type ControlledStructurePatchInput,
  type ControlledJudgmentPatch,
  type StructureValidationResult,
  type StructureValidationResultInput,
} from "./revise_schemas";

const JUDGMENT_TYPES = [
  "state_measurement", "trend_direction", "cycle_phase", "mechanism_validation", "causal_attribution",
  "transmission_path", "object_differentiation", "impact_realization", "expectation_gap", "valuation_impact",
] as const;

const STAGE_LABELS: Record<number, string> = {
  1: "问题定义",
  2: "判断结构",
  3: "来源与证据",
  4: "判断裁决",
  5: "研究表达",
};

const REVISE_SUPPORTED = new Set([1, 2, 4]);
const REVISE_SUPPORTED_LABEL = "问题定义（Stage01）、判断结构（Stage02）与判断裁决（Stage04）";

export function normalizeTargetStage(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new Error("target_stage 必须是 1—5 的整数");
  }
  return value;
}

export function approvedDownstreamStages(runId: string, afterStage: number): Array<{ stage: number; kind: string; artifact_id: string }> {
  return listArtifacts(runId)
    .filter((artifact) => artifact.status === "approved" && stageNumber(artifact.kind) > afterStage)
    .map((artifact) => ({
      stage: stageNumber(artifact.kind),
      kind: artifact.kind,
      artifact_id: artifact.id,
    }))
    .sort((left, right) => left.stage - right.stage);
}

type StructureContractView = {
  scope_label: string;
  units: Array<{
    id: string;
    title: string;
    question: string;
    judgment_type: string;
    evidence_requirements: string[];
  }>;
  counter_evidence_directions: Array<{ direction_id: string; statement: string; judgment_unit_ids: string[] }>;
  competing_explanations: Array<{ explanation_id: string; statement: string; judgment_unit_ids: string[] }>;
};

function structureFromArtifact(artifact: Artifact | undefined): StructureContractView {
  const data = parseJson<any>(artifact?.json_content || "{}", {});
  const units = Array.isArray(data.judgment_units) ? data.judgment_units.map((unit: any) => ({
    id: String(unit.id || ""),
    title: String(unit.title || ""),
    question: String(unit.question || ""),
    judgment_type: String(unit.judgment_type || "cycle_phase"),
    evidence_requirements: Array.isArray(unit.evidence_requirements)
      ? unit.evidence_requirements.map(String)
      : [],
  })) : [];
  const unitIds = units.map((unit: { id: string }) => unit.id).filter(Boolean);
  return {
    scope_label: String(data.research_scope?.label || ""),
    units,
    counter_evidence_directions: normalizeCounterEvidenceDirections(data.counter_evidence_directions, { unitIds }),
    competing_explanations: normalizeCompetingExplanations(data.competing_explanations, { unitIds }),
  };
}

/** Deterministic sanity checks used by tests and as AI context. */
export function heuristicStructureIssues(structure: StructureContractView | {
  scope_label?: string;
  units: StructureContractView["units"];
  counter_evidence_directions: unknown[];
  competing_explanations: unknown[];
}, scope: any) {
  const unitIds = new Set(structure.units.map((unit) => unit.id).filter(Boolean));
  const normalized: StructureContractView = {
    scope_label: String(structure.scope_label || ""),
    units: structure.units,
    counter_evidence_directions: normalizeCounterEvidenceDirections(structure.counter_evidence_directions, { unitIds: [...unitIds] }),
    competing_explanations: normalizeCompetingExplanations(structure.competing_explanations, { unitIds: [...unitIds] }),
  };
  const issues: StructureValidationResult["issues"] = [];
  for (const unit of normalized.units) {
    if (!unit.title.trim() || !unit.question.trim()) {
      issues.push({
        severity: "error",
        unit_id: unit.id || undefined,
        code: "missing_title_or_question",
        message: `${unit.id || "判断单元"} 缺少标题或原子判断问题`,
      });
    }
    if (!JUDGMENT_TYPES.includes(unit.judgment_type as typeof JUDGMENT_TYPES[number])) {
      issues.push({
        severity: "error",
        unit_id: unit.id || undefined,
        code: "invalid_judgment_type",
        message: `${unit.id || "判断单元"} 判断类型未登记: ${unit.judgment_type}`,
      });
    }
    if (!unit.evidence_requirements.filter((item: string) => item.trim()).length) {
      issues.push({
        severity: "error",
        unit_id: unit.id || undefined,
        code: "missing_evidence",
        message: `${unit.id || "判断单元"} 至少需要一条必要证据`,
      });
    }
    if (unit.title.includes("？") && !unit.question.includes("？") && unit.question.length < 12) {
      issues.push({
        severity: "error",
        unit_id: unit.id || undefined,
        code: "title_question_mismatch",
        message: `${unit.id || "判断单元"} 标题像完整问句而原子问题过短，疑似填反`,
      });
    }
  }
  if (!normalized.counter_evidence_directions.filter((item) => item.statement.trim()).length) {
    issues.push({ severity: "error", code: "missing_counter", message: "缺少反向证据方向" });
  }
  if (!normalized.competing_explanations.filter((item) => item.statement.trim()).length) {
    issues.push({ severity: "error", code: "missing_competing", message: "缺少竞争解释" });
  }
  for (const item of normalized.competing_explanations) {
    for (const unitId of item.judgment_unit_ids) {
      if (!unitIds.has(unitId)) {
        issues.push({
          severity: "error",
          code: "invalid_ce_unit_binding",
          message: `竞争解释 ${item.explanation_id} 挂接了不存在的判断单元 ${unitId}`,
        });
      }
    }
  }
  void scope;
  return issues;
}

export type ReviseRunStageResult =
  | {
    status: "needs_confirmation";
    target_stage: number;
    affected_downstream: Array<{ stage: number; kind: string; artifact_id: string; label: string }>;
    message: string;
  }
  | {
    status: "unsupported";
    target_stage: number;
    message: string;
  }
  | {
    status: "revised";
    target_stage: number;
    revision_summary: string;
    artifact: Artifact;
  };

function scopeFromArtifact(artifact: Artifact | undefined) {
  const data = parseJson<any>(artifact?.json_content || "{}", {});
  return {
    normalized_question: String(data.normalized_question || ""),
    core_object: String(data.core_object || ""),
    judgment_action: String(data.judgment_action || ""),
    lookback: String(data.time_scope?.lookback || ""),
    as_of: String(data.time_scope?.as_of || ""),
    forward: String(data.time_scope?.forward || ""),
    boundaries: Array.isArray(data.boundaries) ? data.boundaries.map(String) : [],
    exclusions: Array.isArray(data.exclusions) ? data.exclusions.map(String) : [],
  };
}

export async function reviseRunStage(
  runId: string,
  targetStage: number,
  instruction: string,
  options: {
    confirm_downstream_invalidate?: boolean;
    createClient?: typeof createResearchModelClient;
    /** Test hook: skip model and apply this patch directly for stage 01. */
    scopePatch?: ControlledScopePatch;
    /** Test hook: skip model and apply this patch directly for stage 02. */
    structurePatch?: ControlledStructurePatchInput;
    /** Test hook: skip model and apply this patch directly for stage 04. */
    judgmentPatch?: ControlledJudgmentPatch;
  } = {},
): Promise<ReviseRunStageResult> {
  const run = getRun(runId);
  if (!run) throw new Error("研究任务不存在");
  const trimmed = String(instruction || "").trim();
  if (!trimmed && !options.structurePatch && !options.scopePatch && !options.judgmentPatch) throw new Error("请填写改稿指令");
  if (!REVISE_SUPPORTED.has(targetStage)) {
    return {
      status: "unsupported",
      target_stage: targetStage,
      message: `阶段 ${String(targetStage).padStart(2, "0")}（${STAGE_LABELS[targetStage]}）自然语言改稿尚未开通；当前支持${REVISE_SUPPORTED_LABEL}。`,
    };
  }

  const affected = approvedDownstreamStages(runId, targetStage).map((item) => ({
    ...item,
    label: STAGE_LABELS[item.stage] || item.kind,
  }));
  if (affected.length && !options.confirm_downstream_invalidate) {
    return {
      status: "needs_confirmation",
      target_stage: targetStage,
      affected_downstream: affected,
      message: `改动 Stage0${targetStage} 将作废已确认的下游：${affected.map((item) => item.label).join("、")}。请确认后再提交。`,
    };
  }

  let result: ReviseRunStageResult;
  if (targetStage === 1) result = await reviseStage01(runId, run.question, trimmed, options);
  else if (targetStage === 2) result = await reviseStage02(runId, trimmed, options);
  else if (targetStage === 4) result = await reviseStage04(runId, trimmed, options);
  else result = {
    status: "unsupported",
    target_stage: targetStage,
    message: `阶段 ${String(targetStage).padStart(2, "0")} 自然语言改稿尚未开通`,
  };

  if (result.status === "revised") {
    recordResearchExperienceEvent({
      runId,
      eventType: "stage_revision_completed",
      actorType: "human",
      stage: `stage_${String(targetStage).padStart(2, "0")}`,
      targetType: "Artifact",
      targetId: result.artifact.id,
      outcome: "revised",
      payload: { instruction: trimmed, revision_summary: result.revision_summary },
      dedupeKey: `stage_revision_completed:${result.artifact.id}`,
    });
  }
  return result;
}

async function reviseStage01(
  runId: string,
  question: string,
  instruction: string,
  options: {
    createClient?: typeof createResearchModelClient;
    scopePatch?: ControlledScopePatch;
  },
): Promise<ReviseRunStageResult> {
  const current = latestArtifact(runId, "stage_01", ["approved", "needs_review", "failed"]);
  const currentScope = scopeFromArtifact(current);

  let patch = options.scopePatch;
  if (!patch) {
    const client = (options.createClient || createResearchModelClient)("producer");
    const result = await client.generateStructured(
      "scope_revise",
      controlledScopePatchSchema,
      [
        "你是投研工作台的研究范围改稿器。根据用户指令修订 Stage01 研究范围合同字段。",
        "只输出完整范围字段：normalized_question、core_object、judgment_action、lookback、as_of、forward、boundaries（至少2条）、exclusions（至少1条）。",
        "as_of 必须是可解析的截止时点（日期、月份、季度或半年）；不得编造事实或形成方向判断。",
        "本阶段只定义任务边界，不登记证据或结论。",
        "revision_summary 用一两句中文说明改了什么。",
      ].join("\n"),
      JSON.stringify({
        instruction,
        original_question: question,
        current_scope: currentScope,
      }, null, 2),
    );
    patch = result.data;
  }

  const artifact = createStage01DeterministicProjection(runId, {
    normalized_question: patch.normalized_question,
    core_object: patch.core_object,
    judgment_action: patch.judgment_action,
    lookback: patch.lookback,
    as_of: patch.as_of,
    forward: patch.forward,
    boundaries: patch.boundaries,
    exclusions: patch.exclusions,
  });

  return {
    status: "revised",
    target_stage: 1,
    revision_summary: patch.revision_summary || "已按指令更新研究范围",
    artifact,
  };
}

async function reviseStage02(
  runId: string,
  instruction: string,
  options: {
    createClient?: typeof createResearchModelClient;
    structurePatch?: ControlledStructurePatchInput;
  },
): Promise<ReviseRunStageResult> {
  if (!latestArtifact(runId, "stage_01", ["approved"])) {
    throw new Error("请先确认阶段 01，再改判断结构");
  }

  const current = latestArtifact(runId, "stage_02", ["approved", "needs_review", "failed"]);
  const scope = parseJson<any>(latestArtifact(runId, "stage_01", ["approved"])!.json_content, {});
  const currentStructure = structureFromArtifact(current);

  let patch = options.structurePatch;
  if (!patch) {
    const client = (options.createClient || createResearchModelClient)("producer");
    const result = await client.generateStructured(
      "structure_revise",
      controlledStructurePatchSchema,
      [
        "你是投研工作台的研究结构改稿器。根据用户指令，在已确认 Stage01 范围内修订 Stage02 判断结构。",
        "只输出完整的新结构合同字段：units、counter_evidence_directions、competing_explanations；可保留或调整 scope_label。",
        "每个判断单元必须：标题短标签、原子判断问题为完整可反证问句、judgment_type 合法、至少一条可执行必要证据。",
        "标题与原子问题、判断类型必须语义一致，不得互相矛盾或填反。",
        "counter_evidence_directions 与 competing_explanations 必须是对象数组：{direction_id|explanation_id, statement, judgment_unit_ids?}；judgment_unit_ids 可多挂，也可留空表示待归属。",
        "竞争解释还必须给出非空 discriminating_evidence（可区分主路径与该解释的证据要求）。",
        "优先保留未改动单元的既有 id；新增单元可用新 id。",
        "revision_summary 用一两句中文说明改了什么。",
        "不得编造已取证事实；本阶段只改结构。",
      ].join("\n"),
      JSON.stringify({
        instruction,
        stage_01_scope: {
          normalized_question: scope.normalized_question,
          core_object: scope.core_object,
          judgment_action: scope.judgment_action,
          time_scope: scope.time_scope,
          boundaries: scope.boundaries,
          exclusions: scope.exclusions,
        },
        current_structure: currentStructure,
        allowed_judgment_types: JUDGMENT_TYPES,
      }, null, 2),
    );
    patch = result.data;
  }

  const artifact = createControlledStructureProjection(runId, {
    scope_label: patch.scope_label || currentStructure.scope_label,
    units: patch.units.map((unit) => ({
      id: unit.id ?? undefined,
      title: unit.title,
      question: unit.question,
      judgment_type: unit.judgment_type,
      evidence_requirements: unit.evidence_requirements,
    })),
    counter_evidence_directions: patch.counter_evidence_directions,
    competing_explanations: patch.competing_explanations,
  });

  return {
    status: "revised",
    target_stage: 2,
    revision_summary: patch.revision_summary || "已按指令更新判断结构",
    artifact,
  };
}

type JudgmentContractView = {
  judgments: Array<{
    judgment_unit_id: string;
    conclusion: string;
    supporting_evidence_draft_ids: string[];
    counter_evidence_draft_ids: string[];
    rationale: string;
    uncertainties: string[];
    invalidation_conditions: string[];
    competing_explanation: string;
    source_explanation_id?: string;
    discriminating_evidence: string[];
    counterevidence_resolution: string;
    confirmed_precondition_ids: string[];
    tracking_signals: string[];
    conditions: string[];
    strength?: string;
    decision_status?: string;
  }>;
  overall_boundary: string;
};

function judgmentFromArtifact(
  artifact: Artifact | undefined,
  structure: StructureContractView,
  evidenceData: any,
): JudgmentContractView {
  const data = parseJson<any>(artifact?.json_content || "{}", {});
  const competingByUnit = new Map<string, { statement: string; source_explanation_id?: string }>();
  for (const item of data.competing_explanations || []) {
    for (const unitId of item.judgment_unit_ids || []) {
      if (!competingByUnit.has(String(unitId))) {
        competingByUnit.set(String(unitId), {
          statement: String(item.statement || ""),
          source_explanation_id: item.source_explanation_id ? String(item.source_explanation_id) : undefined,
        });
      }
    }
  }
  const automaticallyConfirmed = new Set(["controlled_source_verification", "judgment_unit", "object_scope"]);
  const confirmedByUnit = new Map<string, string[]>();
  for (const application of evidenceData.method_applications || []) {
    for (const unitId of application.target_judgment_unit_refs || []) {
      const passed = (application.precondition_checks || [])
        .filter((check: any) => check.result === "pass" && !automaticallyConfirmed.has(String(check.precondition_id)))
        .map((check: any) => String(check.precondition_id));
      if (passed.length) {
        confirmedByUnit.set(String(unitId), [...new Set([...(confirmedByUnit.get(String(unitId)) || []), ...passed])]);
      }
    }
  }
  const judgments = (data.judgments || []).map((judgment: any) => {
    const unitId = String(judgment.judgment_unit_id || "");
    const primaryCompetition = (data.competing_explanations || []).find((item: any) =>
      (item.judgment_unit_ids || []).includes(unitId) && !String(item.id || "").includes("-S"));
    const competition = primaryCompetition || competingByUnit.get(unitId);
    const elimination = String(primaryCompetition?.elimination_rationale || "");
    const counterevidenceResolution = elimination.startsWith("研究者记录的有限裁决：")
      ? elimination
        .replace(/^研究者记录的有限裁决：/, "")
        .replace(/；竞争解释仍不得标记为 eliminated$/, "")
        .trim()
      : "";
    return {
      judgment_unit_id: unitId,
      conclusion: String(judgment.conclusion || ""),
      supporting_evidence_draft_ids: (judgment.supporting_evidence_draft_ids || []).map(String),
      counter_evidence_draft_ids: (judgment.counter_evidence_draft_ids || []).map(String),
      rationale: String(judgment.rationale || ""),
      uncertainties: (judgment.uncertainties || []).map(String),
      invalidation_conditions: (judgment.invalidation_conditions || []).map(String),
      competing_explanation: String(primaryCompetition?.statement || competition?.statement || ""),
      source_explanation_id: primaryCompetition?.source_explanation_id
        ? String(primaryCompetition.source_explanation_id)
        : competition?.source_explanation_id,
      discriminating_evidence: (primaryCompetition?.discriminating_evidence || []).map(String),
      counterevidence_resolution: counterevidenceResolution,
      confirmed_precondition_ids: confirmedByUnit.get(unitId) || [],
      tracking_signals: (judgment.tracking_signals || []).map(String),
      conditions: (judgment.conditions || []).map(String),
      strength: String(judgment.strength || ""),
      decision_status: String(judgment.decision_status || ""),
    };
  });
  if (!judgments.length) {
    return {
      judgments: structure.units.map((unit) => ({
        judgment_unit_id: unit.id,
        conclusion: "",
        supporting_evidence_draft_ids: [],
        counter_evidence_draft_ids: [],
        rationale: "",
        uncertainties: [],
        invalidation_conditions: [],
        competing_explanation: structure.competing_explanations.find((item) => item.judgment_unit_ids.includes(unit.id))?.statement || "",
        source_explanation_id: structure.competing_explanations.find((item) => item.judgment_unit_ids.includes(unit.id))?.explanation_id,
        discriminating_evidence: [],
        counterevidence_resolution: "",
        confirmed_precondition_ids: [],
        tracking_signals: [],
        conditions: [],
      })),
      overall_boundary: String(data.overall_boundary || ""),
    };
  }
  return {
    judgments,
    overall_boundary: String(data.overall_boundary || ""),
  };
}

function patchToJudgmentInputs(patch: ControlledJudgmentPatch) {
  return patch.judgments.map((item) => ({
    judgment_unit_id: item.judgment_unit_id,
    conclusion: item.conclusion,
    supporting_evidence_draft_ids: item.supporting_evidence_draft_ids,
    counter_evidence_draft_ids: item.counter_evidence_draft_ids,
    rationale: item.rationale ?? undefined,
    uncertainties: item.uncertainties,
    invalidation_conditions: item.invalidation_conditions,
    competing_explanation: item.competing_explanation,
    source_explanation_id: item.source_explanation_id ?? undefined,
    discriminating_evidence: item.discriminating_evidence,
    counterevidence_resolution: item.counterevidence_resolution ?? undefined,
    confirmed_precondition_ids: item.confirmed_precondition_ids,
    tracking_signals: item.tracking_signals ?? undefined,
    conditions: item.conditions ?? undefined,
  }));
}

async function reviseStage04(
  runId: string,
  instruction: string,
  options: {
    createClient?: typeof createResearchModelClient;
    judgmentPatch?: ControlledJudgmentPatch;
  },
): Promise<ReviseRunStageResult> {
  if (!latestArtifact(runId, "stage_02", ["approved"])) {
    throw new Error("请先确认阶段 02，再改判断裁决");
  }
  if (!latestArtifact(runId, "stage_03", ["approved"])) {
    throw new Error("请先确认阶段 03，再改判断裁决");
  }

  const structureArtifact = latestArtifact(runId, "stage_02", ["approved"])!;
  const evidenceArtifact = latestArtifact(runId, "stage_03", ["approved"])!;
  const current = latestArtifact(runId, "stage_04", ["approved", "needs_review", "failed"]);
  const structure = structureFromArtifact(structureArtifact);
  const evidenceData = parseJson<any>(evidenceArtifact.json_content, {});
  const currentJudgment = judgmentFromArtifact(current, structure, evidenceData);
  const scope = parseJson<any>(latestArtifact(runId, "stage_01", ["approved"])?.json_content || "{}", {});

  const evidenceFacts = (evidenceData.evidence_drafts || [])
    .filter((item: any) => item.kind !== "gap")
    .map((item: any) => ({
      id: String(item.id),
      statement: String(item.statement || ""),
      judgment_unit_ids: (item.judgment_unit_ids || []).map(String),
      direction: String(item.direction || ""),
    }));

  let patch = options.judgmentPatch;
  if (!patch) {
    const client = (options.createClient || createResearchModelClient)("producer");
    const result = await client.generateStructured(
      "judgment_revise",
      controlledJudgmentPatchSchema,
      [
        "你是投研工作台的判断裁决改稿器。根据用户指令，在已确认 Stage02 结构与 Stage03 已批准事实范围内修订 Stage04 推理合同。",
        "只输出 judgments[] 与 revision_summary。每个 judgment_unit_id 必须覆盖 Stage02 的全部判断单元，不得遗漏。",
        "可改字段：conclusion、supporting_evidence_draft_ids、counter_evidence_draft_ids、rationale、uncertainties、invalidation_conditions、",
        "competing_explanation、source_explanation_id、discriminating_evidence、counterevidence_resolution、confirmed_precondition_ids、tracking_signals、conditions。",
        "禁止输出 strength、decision_status、confidence 等系统裁决字段；强度与状态由 Runtime 规则重算。",
        "证据 ID 只能引用 Stage03 已批准事实；不得编造新事实。",
        "竞争解释优先沿用 Stage02 候选的 source_explanation_id；可改写 statement 但不得脱离已批准事实。",
        "revision_summary 用一两句中文说明改了什么。",
      ].join("\n"),
      JSON.stringify({
        instruction,
        stage_01_scope: {
          normalized_question: scope.normalized_question,
          core_object: scope.core_object,
          judgment_action: scope.judgment_action,
          time_scope: scope.time_scope,
        },
        judgment_units: structure.units,
        structure_competing_explanations: structure.competing_explanations,
        approved_evidence: evidenceFacts,
        current_judgment: currentJudgment,
      }, null, 2),
    );
    patch = result.data;
  }

  const artifact = createControlledJudgmentProjection(runId, patchToJudgmentInputs(patch));

  return {
    status: "revised",
    target_stage: 4,
    revision_summary: patch.revision_summary || "已按指令更新判断裁决",
    artifact,
  };
}

export async function validateStage02ForApproval(
  runId: string,
  options: {
    createClient?: typeof createResearchModelClient;
    /** Test hook: return this validation result without calling the model. */
    validationResult?: StructureValidationResultInput;
    applySuggestedPatch?: boolean;
  } = {},
): Promise<StructureValidationResultInput & { artifact?: Artifact }> {
  const run = getRun(runId);
  if (!run) throw new Error("研究任务不存在");
  const stage01 = latestArtifact(runId, "stage_01", ["approved"]);
  if (!stage01) throw new Error("请先确认阶段 01");
  const stage02 = latestArtifact(runId, "stage_02", ["needs_review", "approved"]);
  if (!stage02) throw new Error("尚无待确认的判断结构");
  if (stage02.status !== "needs_review") throw new Error("只有待确认的判断结构可以做确认前校验");

  const scope = parseJson<any>(stage01.json_content, {});
  const structure = structureFromArtifact(stage02);
  const heuristic = heuristicStructureIssues(structure, scope);

  let result = options.validationResult;
  if (!result && stage02.model_name === "human-controlled-structure-projection") {
    const errors = heuristic.filter((item) => item.severity === "error");
    result = {
      ok: errors.length === 0,
      summary: errors.length
        ? "人工受控结构未通过确定性确认前校验"
        : "人工受控结构已通过 Schema 与确定性确认前校验；未产生额外模型费用",
      issues: heuristic,
      suggested_patch: null,
    };
  }
  if (!result) {
    const client = (options.createClient || createResearchModelClient)("producer");
    const modelResult = await client.generateStructured(
      "structure_validate",
      structureValidationResultSchema,
      [
        "你是投研工作台的研究结构确认前校验器。检查当前 Stage02 是否可进入 Stage03。",
        "必须检查：1) 每个单元标题、原子问题、judgment_type 是否一致；2) 是否越出 Stage01 对象/动作/边界；3) 必要证据是否可执行并与问题匹配；4) 反向证据与竞争解释是否空洞或与单元矛盾。",
        "若存在 error 级问题，ok 必须为 false，并给出可直接落库的 suggested_patch（完整合同字段）。",
        "若仅有轻微 warning 且结构可用，ok 可为 true，suggested_patch 可为 null。",
        "issues.message 使用简洁中文。不要编造证据事实。",
      ].join("\n"),
      JSON.stringify({
        stage_01_scope: {
          normalized_question: scope.normalized_question,
          core_object: scope.core_object,
          judgment_action: scope.judgment_action,
          time_scope: scope.time_scope,
          boundaries: scope.boundaries,
          exclusions: scope.exclusions,
        },
        current_structure: structure,
        heuristic_issues: heuristic,
        allowed_judgment_types: JUDGMENT_TYPES,
      }, null, 2),
    );
    result = modelResult.data;
  }

  // Merge heuristic errors the model might have missed.
  const codes = new Set(result.issues.map((item) => `${item.unit_id || ""}:${item.code}`));
  for (const issue of heuristic.filter((item) => item.severity === "error")) {
    const key = `${issue.unit_id || ""}:${issue.code}`;
    if (!codes.has(key)) {
      result.issues.push(issue);
      result.ok = false;
    }
  }

  if (result.ok) return { ...result };

  if (options.applySuggestedPatch && result.suggested_patch) {
    const artifact = createControlledStructureProjection(runId, {
      scope_label: result.suggested_patch.scope_label || structure.scope_label,
      units: result.suggested_patch.units.map((unit) => ({
        ...unit,
        id: unit.id ?? undefined,
      })),
      counter_evidence_directions: result.suggested_patch.counter_evidence_directions,
      competing_explanations: result.suggested_patch.competing_explanations,
    });
    const nextStructure = structureFromArtifact(artifact);
    const nextIssues = heuristicStructureIssues(nextStructure, scope);
    const remainingErrors = nextIssues.filter((item) => item.severity === "error");
    return {
      ok: remainingErrors.length === 0,
      summary: remainingErrors.length
        ? `${result.summary}；已写入建议补丁，但仍有待处理问题。`
        : `${result.summary}；已采纳建议补丁，可再次确认。`,
      issues: nextIssues.length ? nextIssues : result.issues,
      suggested_patch: remainingErrors.length ? result.suggested_patch : null,
      artifact,
    };
  }

  return { ...result };
}

export function activeSceneToDefaultStage(active: string): number {
  switch (active) {
    case "scope": return 1;
    case "structure": return 2;
    case "evidence": return 3;
    case "judgment": return 4;
    case "delivery": return 5;
    default: return 2;
  }
}

export function stageKindForNumber(stage: number): StageKind {
  const kind = `stage_0${stage}` as StageKind;
  if (!STAGES.includes(kind)) throw new Error(`无效阶段: ${stage}`);
  return kind;
}
