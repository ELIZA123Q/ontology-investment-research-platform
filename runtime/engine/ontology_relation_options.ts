import "server-only";

import type { BusinessInstanceGraph } from "./instance_graph";
import {
  activeOntologyRelations,
  loadOntologyCatalog,
  type OntologyAttributeDefinition,
} from "./ontology_catalog";

export type FormalRelationOption = {
  id: string;
  label: string;
  definition: string;
  source_types: string[];
  target_types: string[];
  attributes: Record<string, OntologyAttributeDefinition>;
  targets: Array<{ id: string; type: string; label: string }>;
};

function typeAncestors(type: string, visiting = new Set<string>()): Set<string> {
  if (visiting.has(type)) return new Set([type]);
  const catalog = loadOntologyCatalog();
  const definition = catalog.object_types.get(type);
  const result = new Set([type]);
  if (!definition) return result;
  const next = new Set(visiting).add(type);
  for (const parent of [definition.extends, definition.projects_to]) {
    if (typeof parent !== "string" || !parent) continue;
    for (const ancestor of typeAncestors(parent, next)) result.add(ancestor);
  }
  return result;
}

function endpointMatches(actualType: string, allowedTypes: string[]) {
  if (!allowedTypes.length) return true;
  const actual = typeAncestors(actualType);
  return allowedTypes.some((allowed) => actual.has(allowed));
}

function objectLabel(object: { id: string; type: string; properties?: Record<string, unknown> }) {
  const properties = object.properties || {};
  return String(
    properties.name
    || properties.title
    || properties.label
    || properties.statement
    || object.id,
  );
}

export function formalRelationOptionsForSource(
  graph: BusinessInstanceGraph,
  sourceId: string,
): FormalRelationOption[] {
  const source = graph.objects.find((object) => object.id === sourceId);
  if (!source) throw new Error(`关系源对象不存在: ${sourceId}`);
  return activeOntologyRelations()
    .filter((relation) => endpointMatches(source.type, relation.source_types || []))
    .map((relation) => ({
      id: relation.id,
      label: String(relation.metadata?.label_zh || relation.id),
      definition: String(relation.metadata?.definition || ""),
      source_types: [...(relation.source_types || [])],
      target_types: [...(relation.target_types || [])],
      attributes: { ...(relation.attributes || relation.properties || {}) },
      targets: graph.objects
        .filter((target) => endpointMatches(target.type, relation.target_types || []))
        .map((target) => ({
          id: target.id,
          type: target.type,
          label: objectLabel(target),
        })),
    }))
    .filter((option) => option.targets.length)
    .sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
}

export function assertFormalRelationChoice(
  graph: BusinessInstanceGraph,
  sourceId: string,
  relationType: string,
  targetId: string,
) {
  const option = formalRelationOptionsForSource(graph, sourceId)
    .find((candidate) => candidate.id === relationType);
  if (!option) throw new Error(`关系 ${relationType} 不适用于源对象 ${sourceId}`);
  if (!option.targets.some((target) => target.id === targetId)) {
    throw new Error(`目标对象 ${targetId} 不符合关系 ${relationType} 的端点类型`);
  }
  if (graph.relations.some((relation) =>
    relation.type === relationType
    && relation.sourceId === sourceId
    && relation.targetId === targetId)) {
    throw new Error(`关系 ${sourceId} -[${relationType}]-> ${targetId} 已存在`);
  }
  return option;
}
