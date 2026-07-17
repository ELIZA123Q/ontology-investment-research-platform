export const STAGES = ["stage_01", "stage_02", "stage_03", "stage_04", "stage_05"] as const;
export type StageKind = (typeof STAGES)[number];
export type ArtifactKind = StageKind | "baseline" | "evaluation" | "independent_review" | "instance_graph" | "action_audit";
export type ArtifactStatus = "running" | "needs_review" | "approved" | "failed" | "superseded";

export type MethodApplicationStatus = "candidate" | "selected" | "executed" | "rejected" | "blocked" | "degraded";
export type MethodCapabilityType = "judgment_structure" | "evidence" | "adjudication";
export type MethodPreconditionResult = "pass" | "fail" | "partial" | "not_checked";

export type MethodApplication = {
  application_id: string;
  method_id: string;
  method_version: string;
  capability_type: MethodCapabilityType;
  target_question_refs: string[];
  target_judgment_unit_refs: string[];
  target_ontology_object_refs: string[];
  status: MethodApplicationStatus;
  precondition_checks: Array<{
    precondition_id: string;
    result: MethodPreconditionResult;
    evidence_refs: string[];
    reason: string;
  }>;
  input_evidence_refs: string[];
  output_signal_refs: string[];
  output_judgment_refs: string[];
  execution_summary: string;
  applicability_boundary: string;
  limitations: string[];
  counter_example_refs: string[];
  provenance: {
    stage: "stage_02" | "stage_03" | "stage_04";
    source_application_id: string | null;
    actor: string;
    recorded_at: string | null;
  };
  alternatives: Array<{
    method_id: string;
    decision: string;
    reason: string;
  }>;
};

export type ResearchRun = {
  id: string;
  question: string;
  domain: string;
  current_stage: number;
  status: string;
  package_path: string | null;
  manifest_json: string;
  created_at: string;
  updated_at: string;
};

export type Artifact = {
  id: string;
  run_id: string;
  kind: ArtifactKind;
  version: number;
  status: ArtifactStatus;
  json_content: string;
  markdown_content: string;
  model_name: string | null;
  prompt_version: string;
  knowledge_version: string;
  input_context: string;
  raw_model_output: string;
  response_id: string | null;
  token_usage: string;
  tool_usage: string;
  error_message: string | null;
  created_at: string;
  approved_at: string | null;
};

export type SourceRecord = {
  id: string;
  run_id: string;
  normalized_url: string;
  url: string;
  title: string;
  publisher: string;
  published_at: string | null;
  accessed_at: string;
  source_type: string;
  search_excerpt: string;
};

export function parseJson<T = unknown>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}
