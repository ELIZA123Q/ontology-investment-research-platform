export interface DomainSemanticGraph {
  kind: "domain_semantic_graph";
  nodes: Array<{ id: string; type: "Company" | "Product" | "Technology" | "Industry" | "StateVariable" | "Event" | "InferenceRule"; schemaVersion: string }>;
  edges: Array<{ from: string; to: string; predicate: string; schemaVersion: string }>;
}

export interface ResearchProvenanceGraph {
  kind: "research_provenance_graph";
  nodes: Array<{ id: string; type: "Source" | "EvidenceFact" | "Claim" | "Judgment" | "Artifact" | "Task" | "TaskNode" | "AgentRun"; version: number }>;
  edges: Array<{ from: string; to: string; predicate: "captured_as" | "supports" | "contradicts" | "adjudicated_into" | "included_in" | "executed_by" }>;
}

export interface HybridRetrievalQuery {
  text: string;
  strategies: Array<"fts" | "vector" | "structured" | "domain_graph" | "provenance_graph">;
  asOf?: string;
  limit: number;
}

export interface HybridRetrievalResult {
  refId: string;
  graphKind?: DomainSemanticGraph["kind"] | ResearchProvenanceGraph["kind"];
  version: number;
  score: number;
  reason: string;
}

export interface SemanticGateway {
  search(query: HybridRetrievalQuery): Promise<HybridRetrievalResult[]>;
}
