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
  parent_run_id: string | null;
  trigger_event_id: string | null;
  trigger_classification: ImpactClassification | null;
  manifest_json: string;
  created_at: string;
  updated_at: string;
};

export type MarketEventStatus = "new" | "reviewed" | "applied" | "dismissed";
export type ImpactDirection = "support" | "weaken" | "invalidate" | "review" | "context";
export type ImpactClassification = "evidence_update" | "structure_revision" | "scope_revision";
export type WorkItemStatus = "pending" | "approved" | "rework" | "dismissed" | "superseded";

export type MarketEvent = {
  id: string;
  dedupe_key: string;
  title: string;
  summary: string;
  url: string;
  publisher: string;
  occurred_at: string | null;
  published_at: string | null;
  event_type: string;
  /** 候选文本标签，不是 ontology object ID；持久化列名仍为 object_labels_json */
  candidate_labels: string[];
  confidence: "high" | "medium" | "low";
  status: MarketEventStatus;
  refresh_batch_id: string;
  discovered_at: string;
};

export type EventImpact = {
  id: string;
  event_id: string;
  run_id: string;
  judgment_unit_id: string | null;
  judgment_id: string | null;
  matched_condition: string | null;
  direction: ImpactDirection;
  impact_classification: ImpactClassification;
  relevance: number;
  rationale: string;
  status: "suggested" | "accepted" | "dismissed";
  created_at: string;
};

export type ResearchWorkItem = {
  id: string;
  run_id: string;
  kind: "event_review" | "evidence_review" | "judgment_review" | "supplement_evidence" | "resolve_conflict" | "publish_blocker" | "action_review";
  stage: string;
  target_type: string;
  target_id: string;
  title: string;
  status: WorkItemStatus;
  priority: "high" | "medium" | "low";
  reason: string;
  note: string;
  source_event_id: string | null;
  artifact_id: string;
  attempt: number;
  payload_json: string;
  resolution: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  superseded_at: string | null;
};

export type ActionProposalStatus = "pending" | "approved" | "rejected" | "executed" | "superseded";

export type StoredActionProposal = {
  id: string;
  run_id: string;
  action_id: string;
  parameters_json: string;
  expected_graph_version: number;
  proposal_json: string;
  status: ActionProposalStatus;
  work_item_id: string;
  created_at: string;
  approved_at: string | null;
  executed_at: string | null;
  execution_id: string | null;
};

export type StoredActionExecution = {
  execution_id: string;
  proposal_id: string;
  run_id: string;
  action_id: string;
  graph_version_before: number;
  graph_version_after: number;
  status: "executed" | "rejected";
  result_json: string;
  created_at: string;
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
  source_tier?: "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7" | "S8";
  source_group?: string;
  search_excerpt: string;
  locator?: string;
  captured_at?: string | null;
  content_hash?: string;
  usability_status?: "candidate" | "usable" | "limited" | "rejected";
  failure_category?: "" | "model_output_error" | "source_acquisition_failure" | "method_not_applicable" | "evidence_insufficient" | "contract_implementation_error";
  failure_detail?: string;
  final_url?: string;
  content_mime?: string;
  http_status?: number | null;
  retrieval_status?: "not_attempted" | "captured" | "limited" | "failed";
  snapshot_text?: string;
  source_quote?: string;
  quote_verified?: number | boolean;
};

export function parseJson<T = unknown>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}
