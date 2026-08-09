import type { OntologyObjectTypeId, OntologyRelationTypeId } from "@/src/ontology/catalog";

export interface DomainSemanticGraph {
  kind: "domain_semantic_graph";
  nodes: Array<{ id: string; type: OntologyObjectTypeId; schemaVersion: string }>;
  edges: Array<{ from: string; to: string; predicate: OntologyRelationTypeId; schemaVersion: string }>;
}

export interface ResearchProvenanceGraph {
  kind: "research_provenance_graph";
  nodes: Array<{ id: string; type: "Source" | "SourceSnapshot" | "EvidenceFact" | "Claim" | "Judgment" | "Artifact" | "Task" | "TaskNode" | "AgentRun"; version: number }>;
  edges: Array<{ from: string; to: string; predicate: "captured_as" | "derived_from" | "supports" | "contradicts" | "adjudicated_into" | "included_in" | "executed_by" }>;
}

export interface HybridRetrievalQuery {
  text: string;
  strategies: Array<"fts" | "vector" | "structured" | "domain_graph" | "provenance_graph">;
  kinds?: SemanticAssetKind[];
  asOf?: string;
  limit: number;
}

export type SemanticAssetKind = "ontology" | "dictionary" | "evidence_guide" | "method" | "historical_artifact" | "source_snapshot";

export interface SemanticAssetDocument {
  id: string;
  kind: SemanticAssetKind;
  path: string;
  title: string;
  version: number;
  contentHash: string;
  modifiedAt: string;
  body: string;
}

export interface HybridRetrievalResult {
  refId: string;
  kind?: SemanticAssetKind;
  path?: string;
  title?: string;
  graphKind?: DomainSemanticGraph["kind"] | ResearchProvenanceGraph["kind"];
  version: number;
  score: number;
  reason: string;
}

export interface SemanticGateway {
  search(query: HybridRetrievalQuery): Promise<HybridRetrievalResult[]>;
}
