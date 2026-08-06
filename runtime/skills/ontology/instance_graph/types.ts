import "server-only";
export type GraphObject = {
  id: string;
  type: string;
  properties?: Record<string, unknown>;
  projection?: Record<string, unknown>;
  validFrom?: string;
  validTo?: string;
};

export type GraphRelation = {
  id: string;
  type: string;
  sourceId: string;
  targetId: string;
  properties?: Record<string, unknown>;
};

export type BusinessInstanceGraph = {
  schema_name: "ontology_business_instance_graph";
  schema_version: string;
  authority: string;
  objects: GraphObject[];
  relations: GraphRelation[];
  projection_fingerprints?: Record<string, string>;
};

export type ObjectSetQuery = {
  type?: string | string[];
  ids?: string[];
  relatedTo?: string;
  relationType?: string;
  direction?: "out" | "in" | "both";
  propertyContains?: { key: string; value: string };
  limit?: number;
};

export type ObjectSetResult = {
  objects: GraphObject[];
  relations: GraphRelation[];
  total_objects: number;
  total_relations: number;
  source: string;
  authority: "formal" | "package" | "provisional" | "empty";
  provisional?: boolean;
};

export type GraphLoadResult = {
  graph: BusinessInstanceGraph;
  source: string;
  authority: "formal" | "package" | "provisional" | "empty";
  provisional: boolean;
};

const EMPTY_GRAPH: BusinessInstanceGraph = {
  schema_name: "ontology_business_instance_graph",
  schema_version: "1.0.0",
  authority: "business_parameters",
  objects: [],
  relations: [],
};

export function emptyGraph(): BusinessInstanceGraph {
  return structuredClone(EMPTY_GRAPH);
}
