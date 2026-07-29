import "server-only";
import { getRun } from "./db";
import { loadGraphForRun, queryObjectSet } from "../engine/instance_graph";
import { listActionTypes } from "../engine/action_executor";
import { loadOntologyCatalog } from "../engine/ontology_catalog";

export type OntologyNode = {
  id: string;
  name: string;
  category: string;
  description: string;
  properties: string[];
  source_file: string;
  source_types: string[];
  target_types: string[];
  write_scope?: string[];
  function_ref?: string;
  parameters?: string[];
  logic_refs?: string[];
  rule_refs?: string[];
};

export function loadOntology() {
  const nodes = new Map<string, OntologyNode>();
  const catalog = loadOntologyCatalog();
  for (const [definitions, category] of [
    [catalog.object_types, "Object"],
    [catalog.relation_types, "Relation"],
    [catalog.rules, "Rule"],
    [catalog.scenario_types, "Scenario"],
  ] as const) {
      for (const [id, raw] of definitions) {
        nodes.set(id, {
          id,
          name: String(raw.name || raw.metadata?.label_zh || raw.label_zh || id),
          category,
          description: String(raw.description || raw.metadata?.definition || ""),
          properties: Object.keys(raw.attributes || raw.properties || {}),
          source_file: raw.source_file,
          source_types: raw.source_types || [],
          target_types: raw.target_types || [],
          write_scope: raw.write_scope as string[] | undefined,
          function_ref: raw.function_ref as string | undefined,
          parameters: raw.parameters as string[] | undefined,
          logic_refs: raw.logic_refs as string[] | undefined,
          rule_refs: raw.rule_refs as string[] | undefined,
        });
      }
  }
  return [...nodes.values()].sort((a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id));
}

/** Query run-scoped Object Set by ontology node type/id instead of JSON substring matching. */
export function ontologyInstances(nodeId: string, runId: string) {
  const run = getRun(runId);
  const { graph, source } = loadGraphForRun(runId, run?.package_path);
  const node = loadOntology().find((item) => item.id === nodeId);

  let result;
  if (!node || node.category === "Object") {
    result = queryObjectSet(graph, { type: nodeId, limit: 100 });
    if (!result.objects.length) result = queryObjectSet(graph, { ids: [nodeId], limit: 100 });
  } else if (node.category === "Relation") {
    const relations = graph.relations.filter((relation) => relation.type === nodeId).slice(0, 100);
    const objectIds = new Set(relations.flatMap((relation) => [relation.sourceId, relation.targetId]));
    result = {
      objects: graph.objects.filter((object) => objectIds.has(object.id)),
      relations,
      total_objects: objectIds.size,
      total_relations: relations.length,
      source,
    };
  } else {
    result = queryObjectSet(graph, { propertyContains: { key: "ontology_node_id", value: nodeId }, limit: 100 });
  }

  return {
    node: node || { id: nodeId },
    graph_source: source,
    executable_actions: listActionTypes()
      .filter((action) => action.target_types.includes(nodeId) || action.write_scope.includes(nodeId))
      .map((action) => action.id),
    instances: result.objects.map((object) => ({
      artifact_id: source,
      kind: "instance_graph",
      path: object.projection?.section || object.type,
      label: object.properties?.statement || object.properties?.name || object.id,
      object,
    })),
    relations: result.relations,
    sources: [],
  };
}
