import { z } from "zod";

const markdown = z.string().min(40);
const nonEmptyString = z.string().min(1);

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
  judgment_units: z.array(z.object({
    id: nonEmptyString,
    title: nonEmptyString,
    question: nonEmptyString,
    ontology_node_ids: z.array(z.string()),
    evidence_requirements: z.array(z.string()),
  })).min(1),
  variables: z.array(z.object({ id: nonEmptyString, name: nonEmptyString, ontology_node_id: nonEmptyString, role: nonEmptyString })),
  paths: z.array(z.object({ id: nonEmptyString, statement: nonEmptyString, variable_ids: z.array(z.string()) })),
  counter_evidence_directions: z.array(z.string()),
  competing_explanations: z.array(z.string()),
  document_markdown: markdown,
});

const sourceDraft = z.object({
  source_key: nonEmptyString,
  url: z.string().url(),
  title: nonEmptyString,
  publisher: z.string(),
  published_at: z.string().nullable(),
  source_type: nonEmptyString,
  search_excerpt: z.string(),
});

export const evidencePreparationSchema = z.object({
  method_applications: z.array(methodApplicationSchema).min(1),
  sources: z.array(sourceDraft).min(1),
  evidence_drafts: z.array(z.object({
    id: nonEmptyString,
    statement: nonEmptyString,
    kind: z.enum(["source_claim", "fact_draft", "counter", "conflict", "gap"]),
    direction: z.enum(["support", "weaken", "neutral", "unknown"]),
    source_keys: z.array(z.string()),
    source_ids: z.array(z.string()).default([]),
    judgment_unit_ids: z.array(z.string()).min(1),
    ontology_node_ids: z.array(z.string()),
    limitations: z.array(z.string()),
  })),
  unresolved_gaps: z.array(z.string()),
  document_markdown: markdown,
});

export const judgmentDecisionSchema = z.object({
  method_applications: z.array(methodApplicationSchema).min(1),
  signals: z.array(z.object({
    id: nonEmptyString,
    statement: nonEmptyString,
    role: z.enum(["support", "weaken", "block", "context"]),
    evidence_draft_ids: z.array(z.string()).min(1),
    judgment_unit_ids: z.array(z.string()).min(1),
  })),
  judgments: z.array(z.object({
    id: nonEmptyString,
    judgment_unit_id: nonEmptyString,
    title: nonEmptyString,
    conclusion: nonEmptyString,
    rationale: nonEmptyString,
    strength: z.enum(["J0", "J1", "J2", "J3", "J4"]),
    supporting_evidence_draft_ids: z.array(z.string()),
    counter_evidence_draft_ids: z.array(z.string()),
    method_application_ids: z.array(z.string()).min(1),
    ontology_node_ids: z.array(z.string()),
    uncertainties: z.array(z.string()),
    invalidation_conditions: z.array(z.string()).min(1),
    tracking_signals: z.array(z.string()),
  })).min(1),
  overall_boundary: nonEmptyString,
  document_markdown: markdown,
});

export const researchExpressionSchema = z.object({
  title: nonEmptyString,
  executive_points: z.array(z.string()),
  report_claims: z.array(z.object({
    id: nonEmptyString,
    statement: nonEmptyString,
    judgment_ids: z.array(z.string()).min(1),
    method_application_ids: z.array(z.string()).min(1),
    source_ids: z.array(z.string()),
  })),
  limitations: z.array(z.string()),
  document_markdown: markdown,
});

export const baselineSchema = z.object({
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
  revealed: z.boolean(),
  side_a: z.enum(["baseline", "runtime"]),
});

export const schemas = {
  stage_01: taskDefinitionSchema,
  stage_02: judgmentStructureSchema,
  stage_03: evidencePreparationSchema,
  stage_04: judgmentDecisionSchema,
  stage_05: researchExpressionSchema,
  baseline: baselineSchema,
};
export type SchemaKind = keyof typeof schemas;
