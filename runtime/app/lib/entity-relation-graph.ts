import type { ResearchGraphEdge, ResearchGraphNode } from "@/app/components/research-graph";
import { type GraphLoadResult } from "@/engine/instance_graph";

const PROCESS_TYPES = new Set([
  "JudgmentUnit",
  "Judgment",
  "EvidenceFact",
  "EvidenceClaim",
  "SourceDocument",
  "Hypothesis",
  "Signal",
  "CompetingExplanation",
  "RuleEvaluation",
  "ReasoningTrace",
]);

function toneForType(type: string): ResearchGraphNode["tone"] {
  if (type === "Judgment") return "support";
  if (PROCESS_TYPES.has(type)) return "unknown";
  return "neutral";
}

function objectLabel(item: { id: string; properties?: Record<string, unknown> }): string {
  const name = item.properties?.name || item.properties?.title || item.properties?.statement || item.properties?.conclusion;
  return typeof name === "string" && name.trim() ? name : item.id;
}

export function buildEntityRelationGraph(
  loaded: GraphLoadResult,
  options: { includeProcessObjects?: boolean } = {},
): { nodes: ResearchGraphNode[]; edges: ResearchGraphEdge[] } {
  const includeProcessObjects = Boolean(options.includeProcessObjects);
  const visibleObjects = loaded.graph.objects.filter((item) => includeProcessObjects || !PROCESS_TYPES.has(item.type));
  const visibleIds = new Set(visibleObjects.map((item) => item.id));
  const columns = new Map<string, number>();
  let cursor = 0;
  const nodes = visibleObjects.map((object, index) => {
    if (!columns.has(object.type)) {
      columns.set(object.type, cursor);
      cursor += 1;
    }
    const col = columns.get(object.type) || 0;
    const row = visibleObjects.filter((item, idx) => idx <= index && item.type === object.type).length - 1;
    return {
      id: object.id,
      label: objectLabel(object),
      meta: object.type,
      tone: toneForType(object.type),
      x: col * 320,
      y: row * 130,
      details: {
        类型: object.type,
        编号: object.id,
        属性: object.properties || {},
      },
    } satisfies ResearchGraphNode;
  });
  const edges = loaded.graph.relations
    .filter((item) => visibleIds.has(item.sourceId) && visibleIds.has(item.targetId))
    .map((relation) => ({
      id: relation.id,
      source: relation.sourceId,
      target: relation.targetId,
      label: relation.type,
      tone: "neutral" as const,
    }));
  return { nodes, edges };
}
