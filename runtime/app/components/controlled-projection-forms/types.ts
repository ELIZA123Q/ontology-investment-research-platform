export type UnitOption = { id: string; title: string; ontology_node_ids?: string[] };
export type SourceOption = { id: string; title: string; publisher: string; published_at: string | null };
export type EvidenceOption = { id: string; statement: string; judgment_unit_ids: string[]; direction?: string };
export type MethodApplicationOption = {
  application_id: string;
  method_id: string;
  capability_type: string;
  target_judgment_unit_refs: string[];
  precondition_checks: Array<{ precondition_id: string; reason?: string }>;
};

export type ApprovedScopeSummary = {
  coreObject: string;
  judgmentAction: string;
  asOf: string;
  lookback: string;
  forward: string;
};
