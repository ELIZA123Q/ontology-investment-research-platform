import { z } from "zod";
import {
  markdownSchema as markdown,
  nonEmptyStringSchema as nonEmptyString,
  qualityStatusSchema as qualityStatus,
  stageStatusSchema as stageStatus,
} from "./schema_primitives";
import { isHumanClarificationQuestion } from "./stage01_contract";

const taskDisposition = z.enum(["accepted", "needs_clarification", "out_of_scope", "split_required"]);

const premiseRecordSchema = z.object({
  id: nonEmptyString,
  statement: nonEmptyString,
  source_refs: z.array(nonEmptyString).min(1),
  invalidation_conditions: z.array(nonEmptyString).min(1),
});

export const taskDefinitionSchema = z.object({
  normalized_question: nonEmptyString,
  core_object: nonEmptyString,
  judgment_action: nonEmptyString,
  time_scope: z.object({ lookback: nonEmptyString, as_of: nonEmptyString, forward: nonEmptyString }),
  boundaries: z.array(z.string()),
  exclusions: z.array(z.string()),
  known_facts: z.array(premiseRecordSchema),
  user_assumptions: z.array(premiseRecordSchema),
  hypotheses_to_verify: z.array(premiseRecordSchema),
  domain_supported: z.boolean(),
  document_markdown: markdown,
  stage_status: stageStatus,
  task_disposition: taskDisposition,
  status_reason: nonEmptyString,
  quality_status: qualityStatus,
  quality_gate_ref: nonEmptyString,
  deterministic_check_status: z.enum(["not_checked", "checked", "failed"]),
  semantic_review_status: z.enum(["not_reviewed", "reviewed", "rejected"]),
  return_required: z.boolean(),
  return_stage: z.string().nullable(),
  original_input: nonEmptyString,
  judgment_landing: nonEmptyString,
  task_type: z.object({
    primary: nonEmptyString,
    secondary: z.array(z.string()),
  }),
  delivery_archetype: z.object({
    primary: nonEmptyString,
    secondary: z.array(z.string()),
    modules: z.array(z.string()),
  }),
  intended_use: z.array(z.string()).min(1),
  not_allowed_use: z.array(z.string()),
  main_judgment_axis: z.object({
    object: nonEmptyString,
    comparison_scope: nonEmptyString,
    judgment_action: nonEmptyString,
    primary_channel: nonEmptyString,
    key_question: nonEmptyString,
    expected_05_landing: nonEmptyString,
    non_core_axes: z.array(z.string()),
  }),
  delivery_depth: z.object({
    conclusion_granularity: nonEmptyString,
    minimum_delivery: nonEmptyString,
  }),
  research_value_gate: z.object({
    status: z.enum(["pass", "fail", "pending"]),
    value_level: z.enum(["high", "medium", "low"]),
    disagreement_or_unknown: nonEmptyString,
    changing_variable: nonEmptyString,
    asset_or_decision_impact_path: nonEmptyString,
    decision_use: nonEmptyString,
    why_now: nonEmptyString,
    incremental_question: nonEmptyString,
    low_value_reason: z.string(),
  }),
  overscope_check: z.object({
    status: z.enum(["pass", "fail", "pending"]),
    reason: nonEmptyString,
    broadness_flags: z.array(z.string()),
    alternative_subquestions: z.array(z.string()),
    excluded_paths: z.array(z.string()),
    allowed_secondary_axes: z.array(z.string()),
  }),
  needs_split: z.boolean(),
  split_recommendation: z.string().nullable(),
  scope_summary: nonEmptyString,
  input_resolution: z.object({
    mode: z.enum(["direct_extract", "inherited_context", "user_clarified"]),
    status: z.enum(["resolved", "pending"]),
    source_refs: z.array(z.string()).min(1),
    system_understanding: z.object({
      core_object: nonEmptyString,
      judgment_action: nonEmptyString,
      time_window: nonEmptyString,
      scope_boundary: nonEmptyString,
      delivery_landing: nonEmptyString,
    }),
    rollback_assumptions: z.array(z.string()),
    clarifications: z.array(z.object({
      question_id: nonEmptyString,
      topic: nonEmptyString,
      question: nonEmptyString,
      answer: z.string().nullable(),
      answered_at: z.string().nullable(),
    })),
    unresolved_structural_ambiguities: z.array(z.string()),
  }),
}).superRefine((value, context) => {
  const premiseGroups = [
    ["known_facts", value.known_facts],
    ["user_assumptions", value.user_assumptions],
    ["hypotheses_to_verify", value.hypotheses_to_verify],
  ] as const;
  const seenIds = new Set<string>();
  const seenStatements = new Map<string, string>();
  for (const [group, items] of premiseGroups) {
    items.forEach((item, index) => {
      if (seenIds.has(item.id)) {
        context.addIssue({
          code: "custom",
          path: [group, index, "id"],
          message: `前提 ID 重复：${item.id}`,
        });
      }
      seenIds.add(item.id);
      const normalized = item.statement.replace(/\s+/g, "").replace(/[？?。；;]+$/g, "");
      const priorGroup = seenStatements.get(normalized);
      if (priorGroup && priorGroup !== group) {
        context.addIssue({
          code: "custom",
          path: [group, index, "statement"],
          message: "同一内容不得同时登记为已知事实、用户假设和待验证假设",
        });
      }
      seenStatements.set(normalized, group);
    });
  }
  if (value.task_disposition === "accepted" && !value.hypotheses_to_verify.length) {
    context.addIssue({
      code: "custom",
      path: ["hypotheses_to_verify"],
      message: "accepted 任务至少需要一条待验证假设，供 Stage02 建立核心验证结构",
    });
  }
  if (value.task_disposition === "needs_clarification") {
    const clarifications = value.input_resolution.clarifications;
    const unanswered = clarifications.filter((item) => !item.answer);
    const unresolved = value.input_resolution.unresolved_structural_ambiguities;
    const allAnsweredAwaitingRegen = clarifications.length > 0
      && clarifications.every((item) => Boolean(item.answer))
      && value.input_resolution.mode === "user_clarified"
      && value.input_resolution.status === "pending";
    if (!unanswered.length && !unresolved.length && !allAnsweredAwaitingRegen) {
      context.addIssue({
        code: "custom",
        path: ["task_disposition"],
        message: "needs_clarification 必须登记待答澄清或未决结构性歧义",
      });
    }
    if (unanswered.length > 5) {
      context.addIssue({
        code: "custom",
        path: ["input_resolution", "clarifications"],
        message: "澄清问题过多：一次最多 5 个结构性追问，请合并或拆题",
      });
    }
    unanswered.forEach((item, index) => {
      if (!isHumanClarificationQuestion(item.question)) {
        context.addIssue({
          code: "custom",
          path: ["input_resolution", "clarifications", index, "question"],
          message: "澄清问题必须是短句人话（对齐 7/13：如「是否把 HBM、非 HBM DRAM 与 NAND 分开判断」），禁止模板腔与内部代号",
        });
      }
    });
  }
  if (value.input_resolution.mode === "direct_extract") {
    const forged = value.input_resolution.clarifications.some((item) => Boolean(item.answer));
    if (forged) {
      context.addIssue({
        code: "custom",
        path: ["input_resolution", "clarifications"],
        message: "direct_extract 不得伪造已回答的澄清记录",
      });
    }
  }
});
