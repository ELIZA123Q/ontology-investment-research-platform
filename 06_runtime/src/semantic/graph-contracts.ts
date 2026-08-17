import type { OntologyObjectTypeId, OntologyRelationTypeId } from "@/src/ontology/catalog";

/**
 * Runtime 图边界类型。
 * Semantic 合同（双视图、入图策略、追溯方向）见：
 * `01_semantic_knowledge/03_knowledge_graph/contracts/`。
 * Domain Semantic Graph 与 Research Provenance Graph 不得合并成万能图；
 * 也不与 Execution Trace（Task / TaskNode / AgentRun / Event / Checkpoint）混写。
 */
export interface DomainSemanticGraph {
  kind: "domain_semantic_graph";
  nodes: Array<{ id: string; type: OntologyObjectTypeId; schemaVersion: string }>;
  edges: Array<{ from: string; to: string; predicate: OntologyRelationTypeId; schemaVersion: string }>;
}

export interface ResearchProvenanceGraph {
  kind: "research_provenance_graph";
  /** 研究语义溯源节点；不含 Task/TaskNode/AgentRun（属 Execution Trace）。 */
  nodes: Array<{
    id: string;
    type:
      | "SourceDocument"
      | "SourceSnapshot"
      | "EvidenceFact"
      | "EvidenceClaim"
      | "Signal"
      | "Hypothesis"
      | "Judgment"
      | "ReasoningTrace"
      | "MethodApplication"
      | "Artifact";
    version: number;
  }>;
  edges: Array<{
    from: string;
    to: string;
    predicate:
      | "captured_as"
      | "derived_from"
      | "supports"
      | "contradicts"
      | "adjudicated_into"
      | "included_in";
    schemaVersion?: string;
  }>;
}

export interface OntologyContextSlice {
  asOf: string;
  seedRefIds: string[];
  objects: Array<{
    id: string;
    type: string;
    version: number;
    validAt: string;
    selectionReason: string;
  }>;
  paths: Array<{
    relationId: string;
    relationType: string;
    fromRef: string;
    toRef: string;
    version: number;
  }>;
  sourceVersionRefs: Array<{
    objectRef: string;
    sourceRef: string;
    version: number;
  }>;
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
