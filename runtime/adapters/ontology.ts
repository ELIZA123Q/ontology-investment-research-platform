import "server-only";
import { readFileSync } from "node:fs";
import YAML from "yaml";
import { getRun } from "./db";
import { repositoryPath } from "./repo-paths";
import { loadGraphForRun, queryObjectSet } from "../engine/instance_graph";
import { listActionTypes } from "../engine/action_executor";

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

const ontologyFiles = [
  "ontology/01_通用/semantic.yaml",
  "ontology/01_通用/evidence.yaml",
  "ontology/01_通用/reasoning.yaml",
  "ontology/02_领域/semiconductor/semantic.yaml",
  "ontology/02_领域/semiconductor/evidence.yaml",
  "ontology/02_领域/semiconductor/reasoning.yaml",
];

export function loadOntology() {
  const nodes = new Map<string, OntologyNode>();
  for (const file of ontologyFiles) {
    const doc = YAML.parse(readFileSync(repositoryPath(file), "utf8")) || {};
    for (const [group, category] of [
      ["object_types", "Object"],
      ["relation_types", "Relation"],
      ["action_types", "Action"],
      ["functions", "Function"],
      ["rules", "Rule"],
      ["logic_flows", "Logic"],
    ] as const) {
      for (const [id, raw] of Object.entries<any>(doc[group] || {})) {
        const prior = nodes.get(id);
        nodes.set(id, {
          id,
          name: raw.name || raw.label_zh || id,
          category,
          description: raw.description || prior?.description || "",
          properties: Object.keys(raw.properties || {}),
          source_file: file,
          source_types: raw.source_types || prior?.source_types || [],
          target_types: raw.target_types || prior?.target_types || [],
          write_scope: raw.write_scope || prior?.write_scope,
          function_ref: raw.function_ref || prior?.function_ref,
          parameters: raw.parameters || prior?.parameters,
          logic_refs: raw.logic_refs || prior?.logic_refs,
          rule_refs: raw.rule_refs || prior?.rule_refs,
        });
      }
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
