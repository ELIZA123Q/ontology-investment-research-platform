import { z } from "zod";
import { markdownSchema, nonEmptyStringSchema } from "./schema_primitives";

export const evaluationSchema = z.object({
  scores: z.record(z.string(), z.number().min(1).max(5)),
  metrics: z.record(z.string(), z.unknown()),
  notes: z.string(),
  evaluator: nonEmptyStringSchema,
  evaluated_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/),
  revealed: z.boolean(),
  side_a: z.enum(["baseline", "runtime"]),
  baseline_artifact_id: nonEmptyStringSchema,
  runtime_report_artifact_id: nonEmptyStringSchema,
  frozen_stage03_artifact_id: nonEmptyStringSchema,
  frozen_stage03_artifact_hash: z.string().regex(/^[a-f0-9]{64}$/),
  metrics_version: z.string().nullable().optional(),
  metrics_recomputed_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/).nullable().optional(),
  supersedes_evaluation_artifact_id: z.string().nullable().optional(),
});

export const EVALUATION_CRITERIA = [
  "事实与来源可核验性",
  "无来源主张控制",
  "反证与竞争解释",
  "结论边界",
  "可复盘性",
  "研究决策帮助",
] as const;

export const evaluationSubmissionSchema = z.object({
  scores: z.record(z.string(), z.number().int().min(1).max(5)),
  notes: z.string().trim().min(8),
  evaluator: z.string().trim().min(2),
});

export const independentReviewSchema = z.object({
  reviewed_stage04_artifact_id: nonEmptyStringSchema,
  reviewed_stage04_artifact_hash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  verdict: z.enum(["pass", "rework"]),
  issues: z.array(z.object({
    issue_type: z.enum(["reasoning_jump", "evidence_mismatch", "overclaim", "missing_competing_explanation", "traceability_gap"]),
    judgment_id: z.string().nullable(),
    description: nonEmptyStringSchema,
    evidence_refs: z.array(z.string()),
    required_action: nonEmptyStringSchema,
    return_stage: z.enum(["stage_02", "stage_03", "stage_04"]),
  })),
  strengths: z.array(z.string()),
  overall_assessment: nonEmptyStringSchema,
  document_markdown: markdownSchema,
  reviewer_model: z.string().nullable(),
  producer_model: z.string().nullable(),
  reviewer_type: z.enum(["model", "human"]).default("model"),
  reviewer_attestation: z.string().nullable().default(null),
  independence_level: z.enum(["independent_model", "independent_human", "same_model_separate_call"]).nullable(),
  semantic_checks: z.array(z.object({
    check_id: z.enum([
      "local_evidence_not_globalized",
      "parent_aggregation_complete",
      "incremental_update_is_local_first",
      "title_represents_major_scopes",
      "conditions_scope_and_prohibitions_preserved",
    ]),
    result: z.enum(["pass", "fail", "needs_human"]),
    reason: nonEmptyStringSchema,
    return_to_stage: z.enum(["02", "03", "04", "05"]).nullable().optional(),
  })).default([]),
}).superRefine((value, context) => {
  if (value.independence_level === "independent_human") {
    if (value.reviewer_type !== "human") {
      context.addIssue({
        code: "custom",
        path: ["reviewer_type"],
        message: "人类独立审阅必须标记 reviewer_type=human",
      });
    }
    if (!value.reviewer_attestation || value.reviewer_attestation.trim().length < 20) {
      context.addIssue({
        code: "custom",
        path: ["reviewer_attestation"],
        message: "人类独立审阅必须留下至少 20 字的独立性声明",
      });
    }
  }
  if (value.independence_level === "independent_model" && value.reviewer_type !== "model") {
    context.addIssue({
      code: "custom",
      path: ["reviewer_type"],
      message: "模型独立审阅必须标记 reviewer_type=model",
    });
  }
  if (value.verdict === "pass" && value.semantic_checks.length !== 5) {
    context.addIssue({
      code: "custom",
      path: ["semantic_checks"],
      message: "verdict=pass 时必须填写全部五项 semantic_checks",
    });
  }
  for (const check of value.semantic_checks) {
    if (check.result !== "pass" && !check.return_to_stage) {
      context.addIssue({
        code: "custom",
        path: ["semantic_checks"],
        message: `${check.check_id} 未通过时必须指定 return_to_stage`,
      });
    }
  }
});

