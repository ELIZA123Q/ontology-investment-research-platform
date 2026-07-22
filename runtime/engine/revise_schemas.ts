import { z } from "zod";
import { modelOptional } from "./model_schema_helpers";

const JUDGMENT_TYPES = [
  "state_measurement", "trend_direction", "cycle_phase", "mechanism_validation", "causal_attribution",
  "transmission_path", "object_differentiation", "impact_realization", "expectation_gap", "valuation_impact",
] as const;

export const structureUnitSchema = z.object({
  id: modelOptional(z.string()),
  title: z.string().min(1),
  question: z.string().min(1),
  judgment_type: z.enum(JUDGMENT_TYPES),
  evidence_requirements: z.array(z.string().min(1)).min(1),
});

/** 模型提交用对象形态；字符串候选由 normalize* 在落库前升格。 */
export const structureCandidateSchema = z.object({
  explanation_id: modelOptional(z.string()),
  direction_id: modelOptional(z.string()),
  id: modelOptional(z.string()),
  statement: z.string().min(1),
  judgment_unit_ids: modelOptional(z.array(z.string())),
  discriminating_evidence: modelOptional(z.array(z.string().min(1))),
});

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

export const controlledStructurePatchSchema = z.object({
  scope_label: modelOptional(z.string()),
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
    unit_id: modelOptional(z.string()),
    code: z.string().min(1),
    message: z.string().min(1),
  })),
  suggested_patch: z.object({
    scope_label: modelOptional(z.string()),
    units: z.array(structureUnitSchema).min(1),
    counter_evidence_directions: z.array(structureCandidateSchema).min(1),
    competing_explanations: z.array(structureCandidateSchema).min(1),
  }).nullable(),
});

export type ControlledScopePatch = z.infer<typeof controlledScopePatchSchema>;
export type ControlledStructurePatch = z.infer<typeof controlledStructurePatchSchema>;
export type StructureValidationResult = z.infer<typeof structureValidationResultSchema>;

export const controlledEvidencePatchSchema = z.object({
  // 与 upserts/removals 双记账：模型常漏写新建 SRC。提交前 Runtime 会从 upserts/removals 并入。
  affected_object_refs: z.array(z.string().min(1)).min(1),
  upserts: z.record(z.string(), z.array(z.unknown())),
  removals: z.record(z.string(), z.array(z.string())).default({}),
  revision_summary: z.string().min(1),
});

export type ControlledEvidencePatch = z.infer<typeof controlledEvidencePatchSchema>;

export const controlledJudgmentUnitPatchSchema = z.object({
  judgment_unit_id: z.string().min(1),
  conclusion: z.string().min(1),
  supporting_evidence_draft_ids: z.array(z.string()).default([]),
  counter_evidence_draft_ids: z.array(z.string()).default([]),
  rationale: modelOptional(z.string()),
  uncertainties: z.array(z.string()).min(1),
  invalidation_conditions: z.array(z.string()).min(1),
  competing_explanation: z.string().min(1),
  source_explanation_id: modelOptional(z.string()),
  discriminating_evidence: z.array(z.string()).min(1),
  counterevidence_resolution: modelOptional(z.string()),
  confirmed_precondition_ids: z.array(z.string()).default([]),
  tracking_signals: modelOptional(z.array(z.string())),
  conditions: modelOptional(z.array(z.string())),
});

export const controlledJudgmentPatchSchema = z.object({
  judgments: z.array(controlledJudgmentUnitPatchSchema).min(1),
  revision_summary: z.string().min(1),
});

export type ControlledJudgmentUnitPatch = z.infer<typeof controlledJudgmentUnitPatchSchema>;
export type ControlledJudgmentPatch = z.infer<typeof controlledJudgmentPatchSchema>;

/** 测试钩子 / 人工补丁可传 string 候选；模型提交 schema 仅接受对象。 */
export type StructureCandidateInput = z.infer<typeof structureCandidateSchema> | string;
export type ControlledStructurePatchInput = Omit<ControlledStructurePatch, "counter_evidence_directions" | "competing_explanations"> & {
  counter_evidence_directions: StructureCandidateInput[];
  competing_explanations: StructureCandidateInput[];
};
export type StructureValidationResultInput = Omit<StructureValidationResult, "suggested_patch"> & {
  suggested_patch: (Omit<NonNullable<StructureValidationResult["suggested_patch"]>, "counter_evidence_directions" | "competing_explanations"> & {
    counter_evidence_directions: StructureCandidateInput[];
    competing_explanations: StructureCandidateInput[];
  }) | null;
};
