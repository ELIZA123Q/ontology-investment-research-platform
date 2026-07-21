import "server-only";

import { z } from "zod";
import { getRun, latestArtifact, listArtifacts } from "../adapters/db";
import { createResearchModelClient } from "../adapters/deepseek";
import { parseJson, STAGES, type Artifact, type StageKind } from "./types";
import { stageNumber } from "./workflow_shared";
import { createControlledStructureProjection, createStage01DeterministicProjection } from "./workflow_projections";
import {
  normalizeCompetingExplanations,
  normalizeCounterEvidenceDirections,
} from "./structure_candidates";

const JUDGMENT_TYPES = [
  "state_measurement", "trend_direction", "cycle_phase", "mechanism_validation", "causal_attribution",
  "transmission_path", "object_differentiation", "impact_realization", "expectation_gap", "valuation_impact",
] as const;

export const controlledScopePatchSchema = z.object({
  normalized_question: z.string().min(1),
  core_object: z.string().min(1),
  judgment_action: z.string().min(1),
  lookback: z.string().min(1),
  as_of: z.string().min(1),
  forward: z.string().min(1),
  boundaries: z.array(z.string().min(1)).min(2),
  exclusions: z.array(z.string().min(1)).min(1),
  revision_summary: z.string().min(1),
});

export type ControlledScopePatch = z.infer<typeof controlledScopePatchSchema>;

const structureUnitSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  question: z.string().min(1),
  judgment_type: z.enum(JUDGMENT_TYPES),
  evidence_requirements: z.array(z.string().min(1)).min(1),
});

const structureCandidateSchema = z.union([
  z.string().min(1),
  z.object({
    explanation_id: z.string().optional(),
    direction_id: z.string().optional(),
    id: z.string().optional(),
    statement: z.string().min(1),
    judgment_unit_ids: z.array(z.string()).optional(),
  }),
]);

export const controlledStructurePatchSchema = z.object({
  scope_label: z.string().optional(),
  units: z.array(structureUnitSchema).min(1),
  counter_evidence_directions: z.array(structureCandidateSchema).min(1),
  competing_explanations: z.array(structureCandidateSchema).min(1),
  revision_summary: z.string().min(1),
});

export const structureValidationResultSchema = z.object({
  ok: z.boolean(),
  summary: z.string().min(1),
  issues: z.array(z.object({
    severity: z.enum(["error", "warning"]),
    unit_id: z.string().optional(),
    code: z.string().min(1),
    message: z.string().min(1),
  })),
  suggested_patch: z.object({
    scope_label: z.string().optional(),
    units: z.array(structureUnitSchema).min(1),
    counter_evidence_directions: z.array(structureCandidateSchema).min(1),
    competing_explanations: z.array(structureCandidateSchema).min(1),
  }).nullable(),
});

export type ControlledStructurePatch = z.infer<typeof controlledStructurePatchSchema>;
export type StructureValidationResult = z.infer<typeof structureValidationResultSchema>;

const STAGE_LABELS: Record<number, string> = {
  1: "问题定义",
  2: "判断结构",
  3: "来源与证据",
  4: "判断裁决",
  5: "研究表达",
};

const REVISE_SUPPORTED = new Set([1, 2]);
const REVISE_SUPPORTED_LABEL = "问题定义（Stage01）与判断结构（Stage02）";

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
    structurePatch?: ControlledStructurePatch;
  } = {},
): Promise<ReviseRunStageResult> {
  const run = getRun(runId);
  if (!run) throw new Error("研究任务不存在");
  const trimmed = String(instruction || "").trim();
  if (!trimmed && !options.structurePatch && !options.scopePatch) throw new Error("请填写改稿指令");
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

  if (targetStage === 1) {
    return reviseStage01(runId, run.question, trimmed, options);
  }
  if (targetStage === 2) {
    return reviseStage02(runId, trimmed, options);
  }

  return {
    status: "unsupported",
    target_stage: targetStage,
    message: `阶段 ${String(targetStage).padStart(2, "0")} 自然语言改稿尚未开通`,
  };
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
    structurePatch?: ControlledStructurePatch;
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
      id: unit.id,
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

export async function validateStage02ForApproval(
  runId: string,
  options: {
    createClient?: typeof createResearchModelClient;
    /** Test hook: return this validation result without calling the model. */
    validationResult?: StructureValidationResult;
    applySuggestedPatch?: boolean;
  } = {},
): Promise<StructureValidationResult & { artifact?: Artifact }> {
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
      units: result.suggested_patch.units,
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
