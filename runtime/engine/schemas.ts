import { z } from "zod";

const markdown = z.string().min(40);
const nonEmptyString = z.string().min(1);
const judgmentType = z.enum([
  "state_measurement",
  "trend_direction",
  "cycle_phase",
  "mechanism_validation",
  "causal_attribution",
  "transmission_path",
  "object_differentiation",
  "impact_realization",
  "expectation_gap",
  "valuation_impact",
]);

export const methodApplicationSchema = z.object({
  application_id: z.string().regex(/^MA-[A-Z0-9_-]+$/),
  method_id: nonEmptyString,
  method_version: nonEmptyString,
  capability_type: z.enum(["judgment_structure", "evidence", "adjudication"]),
  target_question_refs: z.array(z.string()),
  target_judgment_unit_refs: z.array(z.string()).min(1),
  target_ontology_object_refs: z.array(z.string()),
  status: z.enum(["candidate", "selected", "executed", "rejected", "blocked", "degraded"]),
  precondition_checks: z.array(z.object({
    precondition_id: nonEmptyString,
    result: z.enum(["pass", "fail", "partial", "not_checked"]),
    evidence_refs: z.array(z.string()),
    reason: nonEmptyString,
  })),
  input_evidence_refs: z.array(z.string()),
  output_signal_refs: z.array(z.string()),
  output_judgment_refs: z.array(z.string()),
  execution_summary: z.string(),
  applicability_boundary: nonEmptyString,
  limitations: z.array(z.string()),
  counter_example_refs: z.array(z.string()),
  provenance: z.object({
    stage: z.enum(["stage_02", "stage_03", "stage_04"]),
    source_application_id: z.string().nullable(),
    actor: nonEmptyString,
    recorded_at: z.string().nullable(),
  }),
  alternatives: z.array(z.object({
    method_id: nonEmptyString,
    decision: nonEmptyString,
    reason: nonEmptyString,
  })),
});

export const taskDefinitionSchema = z.object({
  normalized_question: nonEmptyString,
  core_object: nonEmptyString,
  judgment_action: nonEmptyString,
  time_scope: z.object({ lookback: nonEmptyString, as_of: nonEmptyString, forward: nonEmptyString }),
  boundaries: z.array(z.string()),
  exclusions: z.array(z.string()),
  report_type: nonEmptyString,
  domain_supported: z.boolean(),
  document_markdown: markdown,
});

export const judgmentStructureSchema = z.object({
  method_applications: z.array(methodApplicationSchema).min(1),
  research_scope: z.object({
    id: nonEmptyString,
    label: nonEmptyString,
    dimensions: z.record(z.string(), z.unknown()),
  }),
  judgment_units: z.array(z.object({
    id: nonEmptyString,
    title: nonEmptyString,
    question: nonEmptyString,
    judgment_type: judgmentType,
    scope_ref: nonEmptyString,
    ontology_node_ids: z.array(z.string()),
    evidence_requirements: z.array(z.string()),
  })).min(1),
  variables: z.array(z.object({
    id: nonEmptyString,
    name: nonEmptyString,
    category: nonEmptyString,
    definition: nonEmptyString,
    variable_kind: nonEmptyString,
    anchors: z.array(z.string()).min(1),
    ontology_node_id: nonEmptyString,
    role: nonEmptyString,
  })),
  paths: z.array(z.object({ id: nonEmptyString, statement: nonEmptyString, variable_ids: z.array(z.string()) })),
  counter_evidence_directions: z.array(z.string()),
  competing_explanations: z.array(z.string()),
  document_markdown: markdown,
});

const sourceDraft = z.object({
  // 以下运行字段在模型提交时必须显式为 null 或候选值，随后一律由
  // Source Registry 抓取结果覆盖；使用 nullable 而非 optional 以兼容
  // DeepSeek/OpenAI 严格函数 Schema 的“所有字段 required”约束。
  source_id: z.string().nullable(),
  source_key: nonEmptyString,
  url: z.string().url(),
  title: nonEmptyString,
  publisher: z.string(),
  published_at: nonEmptyString,
  source_tier: z.enum(["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"]),
  source_type: nonEmptyString,
  search_excerpt: z.string(),
  locator: nonEmptyString,
  source_quote: nonEmptyString,
  captured_at: z.string().nullable(),
  content_hash: z.string().nullable(),
  final_url: z.string().nullable(),
  retrieval_status: z.string().nullable(),
  quote_verified: z.boolean().nullable(),
});

const evidenceFactDraft = z.object({
  id: nonEmptyString,
  statement: nonEmptyString,
  kind: z.enum(["source_claim", "fact_draft", "counter", "conflict"]),
  direction: z.enum(["support", "weaken", "neutral", "unknown"]),
  source_keys: z.array(z.string()).min(1),
  source_ids: z.array(z.string()).default([]),
  judgment_unit_ids: z.array(z.string()).min(1),
  ontology_node_ids: z.array(z.string()),
  subject_ref: nonEmptyString,
  time_basis: nonEmptyString,
  scope_ref: nonEmptyString,
  observed_at: nonEmptyString,
  valid_from: nonEmptyString,
  valid_to: z.string().nullable().default(null),
  published_at: nonEmptyString,
  cutoff_at: nonEmptyString,
  directness: z.enum(["direct", "indirect", "proxy"]),
  limitations: z.array(z.string()),
});

const evidenceGapDraft = z.object({
  id: nonEmptyString,
  statement: nonEmptyString,
  kind: z.literal("gap"),
  direction: z.literal("unknown"),
  source_keys: z.array(z.string()).max(0),
  source_ids: z.array(z.string()).default([]),
  judgment_unit_ids: z.array(z.string()).min(1),
  ontology_node_ids: z.array(z.string()),
  requirement: nonEmptyString,
  evidence_role: z.enum(["support", "counter", "context", "boundary"]),
  minimum_independent_sources: z.number().int().nonnegative(),
  limitations: z.array(z.string()).min(1),
});

export const evidencePreparationSchema = z.object({
  method_applications: z.array(methodApplicationSchema).min(1),
  sources: z.array(sourceDraft),
  evidence_drafts: z.array(z.discriminatedUnion("kind", [evidenceFactDraft, evidenceGapDraft])).min(1),
  unresolved_gaps: z.array(z.string()),
  document_markdown: markdown,
}).superRefine((value, context) => {
  const evidenceIds = new Set(value.evidence_drafts.map((item) => item.id));
  const referencedEvidenceIds = new Set(value.method_applications.flatMap((item) => item.input_evidence_refs));
  for (const [index, application] of value.method_applications.entries()) {
    if (["blocked", "rejected"].includes(application.status) && !application.alternatives.length) {
      context.addIssue({ code: "custom", path: ["method_applications", index, "alternatives"], message: `${application.status} 方法必须记录替代路线` });
    }
    for (const ref of application.input_evidence_refs) {
      if (!evidenceIds.has(ref)) context.addIssue({ code: "custom", path: ["method_applications", index, "input_evidence_refs"], message: `引用了不存在的证据或缺口 ${ref}` });
    }
  }
  for (const [index, evidence] of value.evidence_drafts.entries()) {
    if (!referencedEvidenceIds.has(evidence.id)) {
      context.addIssue({ code: "custom", path: ["evidence_drafts", index, "id"], message: `${evidence.id} 必须绑定至少一个 MethodApplication` });
    }
  }
  if (!value.sources.length && value.evidence_drafts.some((item) => item.kind !== "gap")) {
    context.addIssue({ code: "custom", path: ["sources"], message: "无来源时只能登记显式 gap，不得形成事实草稿" });
  }
  if (!value.sources.length && !value.unresolved_gaps.length) {
    context.addIssue({ code: "custom", path: ["unresolved_gaps"], message: "无来源时必须明确记录未解决证据缺口" });
  }
});

export const judgmentDecisionSchema = z.object({
  method_applications: z.array(methodApplicationSchema).min(1),
  signals: z.array(z.object({
    id: nonEmptyString,
    statement: nonEmptyString,
    role: z.enum(["support", "weaken", "block", "context"]),
    evidence_draft_ids: z.array(z.string()).min(1),
    judgment_unit_ids: z.array(z.string()).min(1),
    target_hypothesis_ids: z.array(z.string()).min(1),
  })),
  hypotheses: z.array(z.object({
    id: nonEmptyString,
    statement: nonEmptyString,
    signal_ids: z.array(z.string()),
    falsification_conditions: z.array(z.string()).min(1),
    time_horizon: nonEmptyString,
  })).min(1),
  competing_explanations: z.array(z.object({
    id: nonEmptyString,
    statement: nonEmptyString,
    signal_ids: z.array(z.string()),
    discriminating_evidence: z.array(z.string()).min(1),
    status: z.enum(["active", "weakened", "eliminated", "unknown"]),
    elimination_rationale: z.string(),
  })).min(1),
  rule_evaluations: z.array(z.object({
    id: nonEmptyString,
    rule_ref: nonEmptyString,
    input_refs: z.array(z.string()).min(1),
    condition_results: z.array(z.object({
      condition_id: nonEmptyString,
      expression: nonEmptyString,
      input_refs: z.array(z.string()).min(1),
      outcome: z.enum(["pass", "fail", "contested", "blocked"]),
      rationale: nonEmptyString,
    })).min(1),
    result: z.enum(["pass", "fail", "contested", "blocked"]),
    deterministic_result: z.object({
      engine_version: nonEmptyString,
      result: z.enum(["pass", "fail", "contested", "blocked"]),
      rationale: nonEmptyString,
      evaluated_at: nonEmptyString,
    }).nullable(),
  })).min(1),
  judgments: z.array(z.object({
    id: nonEmptyString,
    judgment_unit_id: nonEmptyString,
    title: nonEmptyString,
    conclusion: nonEmptyString,
    rationale: nonEmptyString,
    strength: z.enum(["J0", "J1", "J2", "J3", "J4"]),
    confidence: z.enum(["low", "medium", "high"]),
    decision_status: z.enum(["draft", "supported", "contested", "blocked", "indeterminate", "invalidated"]),
    conflict_status: z.enum(["none", "unresolved", "resolved", "decisive"]),
    not_judgeable_reason: z.string().nullable().default(null),
    scope_ref: nonEmptyString,
    cutoff_at: nonEmptyString,
    conditions: z.array(z.string()),
    supporting_evidence_draft_ids: z.array(z.string()),
    counter_evidence_draft_ids: z.array(z.string()),
    hypothesis_ids: z.array(z.string()).min(1),
    rule_evaluation_ids: z.array(z.string()).min(1),
    method_application_ids: z.array(z.string()).min(1),
    ontology_node_ids: z.array(z.string()),
    uncertainties: z.array(z.string()),
    invalidation_conditions: z.array(z.string()).min(1),
    tracking_signals: z.array(z.string()),
  })).min(1),
  reasoning_traces: z.array(z.object({
    id: nonEmptyString,
    judgment_id: nonEmptyString,
    node_ids: z.array(z.string()).min(1),
    created_at: nonEmptyString,
  })).min(1),
  overall_boundary: nonEmptyString,
  document_markdown: markdown,
}).superRefine((value, context) => {
  const hypotheses = new Map(value.hypotheses.map((item) => [item.id, item]));
  for (const [index, judgment] of value.judgments.entries()) {
    const explicitJ0Stop = judgment.strength === "J0"
      && ["blocked", "indeterminate", "contested"].includes(judgment.decision_status)
      && Boolean(judgment.not_judgeable_reason?.trim());
    if (!explicitJ0Stop && ![...judgment.supporting_evidence_draft_ids, ...judgment.counter_evidence_draft_ids].length) {
      context.addIssue({ code: "custom", path: ["judgments", index], message: "非 J0 停止判断必须绑定事实级证据" });
    }
    if (!explicitJ0Stop && judgment.hypothesis_ids.some((id) => !(hypotheses.get(id)?.signal_ids.length))) {
      context.addIssue({ code: "custom", path: ["judgments", index, "hypothesis_ids"], message: "非 J0 停止判断的假设必须由 Signal 评价" });
    }
  }
});

export const researchExpressionSchema = z.object({
  title: nonEmptyString,
  executive_points: z.array(z.string()),
  report_claims: z.array(z.object({
    id: nonEmptyString,
    statement: nonEmptyString,
    judgment_ids: z.array(z.string()).min(1),
    method_application_ids: z.array(z.string()).min(1),
    evidence_draft_ids: z.array(z.string()),
    source_ids: z.array(z.string()),
  })),
  limitations: z.array(z.string()),
  document_markdown: markdown,
});

export const baselineSchema = z.object({
  frozen_stage03_artifact_id: z.string().nullable(),
  frozen_stage03_artifact_hash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  title: nonEmptyString,
  core_claims: z.array(z.object({ id: nonEmptyString, statement: nonEmptyString, source_keys: z.array(z.string()) })),
  counterpoints: z.array(z.string()),
  limitations: z.array(z.string()),
  sources: z.array(sourceDraft),
  document_markdown: markdown,
});

export const evaluationSchema = z.object({
  scores: z.record(z.string(), z.number().min(1).max(5)),
  metrics: z.record(z.string(), z.unknown()),
  notes: z.string(),
  evaluator: nonEmptyString,
  evaluated_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/),
  revealed: z.boolean(),
  side_a: z.enum(["baseline", "runtime"]),
  baseline_artifact_id: nonEmptyString,
  runtime_report_artifact_id: nonEmptyString,
  frozen_stage03_artifact_id: nonEmptyString,
  frozen_stage03_artifact_hash: z.string().regex(/^[a-f0-9]{64}$/),
});

export const EVALUATION_CRITERIA = ["事实与来源可核验性", "无来源主张控制", "反证与竞争解释", "结论边界", "可复盘性", "研究决策帮助"] as const;

export const evaluationSubmissionSchema = z.object({
  scores: z.record(z.string(), z.number().int().min(1).max(5)),
  notes: z.string().trim().min(8),
  evaluator: z.string().trim().min(2),
});

export const independentReviewSchema = z.object({
  reviewed_stage04_artifact_id: nonEmptyString,
  reviewed_stage04_artifact_hash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  verdict: z.enum(["pass", "rework"]),
  issues: z.array(z.object({
    issue_type: z.enum(["reasoning_jump", "evidence_mismatch", "overclaim", "missing_competing_explanation", "traceability_gap"]),
    judgment_id: z.string().nullable(),
    description: nonEmptyString,
    evidence_refs: z.array(z.string()),
    required_action: nonEmptyString,
    return_stage: z.enum(["stage_02", "stage_03", "stage_04"]),
  })),
  strengths: z.array(z.string()),
  overall_assessment: nonEmptyString,
  document_markdown: markdown,
  reviewer_model: z.string().nullable(),
  producer_model: z.string().nullable(),
  independence_level: z.enum(["independent_model", "same_model_separate_call"]).nullable(),
});

export const schemas = {
  stage_01: taskDefinitionSchema,
  stage_02: judgmentStructureSchema,
  stage_03: evidencePreparationSchema,
  stage_04: judgmentDecisionSchema,
  stage_05: researchExpressionSchema,
  baseline: baselineSchema,
  independent_review: independentReviewSchema,
};
export type SchemaKind = keyof typeof schemas;
