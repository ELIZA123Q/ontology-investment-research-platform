import type { ResearchGraphEdge, ResearchGraphNode } from "@/app/components/research-graph";
import type { OntologyNode } from "@/adapters/ontology";

function nodeTone(category: string): ResearchGraphNode["tone"] {
  if (category === "Object") return "neutral";
  if (category === "Relation") return "inherited";
  return "unknown";
}

export function buildOntologyNetworkGraph(
  ontologyNodes: OntologyNode[],
  highlightNodeIds: string[] = [],
): { nodes: ResearchGraphNode[]; edges: ResearchGraphEdge[] } {
  const nodeMap = new Map(ontologyNodes.map((item) => [item.id, item]));
  const highlights = new Set(highlightNodeIds);
  const categories = [...new Set(ontologyNodes.map((item) => item.category))];
  const colByCategory = new Map(categories.map((category, index) => [category, index]));
  const rowCounter = new Map<string, number>();

  const nodes: ResearchGraphNode[] = ontologyNodes.map((item) => {
    const col = colByCategory.get(item.category) || 0;
    const row = rowCounter.get(item.category) || 0;
    rowCounter.set(item.category, row + 1);
    return {
      id: item.id,
      label: item.name,
      meta: highlights.has(item.id) ? `${item.category} · 本轮触及` : item.category,
      tone: nodeTone(item.category),
      x: col * 360,
      y: row * 120,
      details: {
        描述: item.description || "暂无定义",
        属性: item.properties,
        来源文件: item.source_file,
        来源类型: item.source_types,
        目标类型: item.target_types,
      },
    };
  });

  const edges: ResearchGraphEdge[] = [];
  for (const relation of ontologyNodes.filter((item) => item.category === "Relation")) {
    for (const sourceType of relation.source_types || []) {
      if (!nodeMap.has(sourceType)) continue;
      edges.push({
        id: `${sourceType}->${relation.id}`,
        source: sourceType,
        target: relation.id,
        label: "源类型",
        tone: "neutral",
      });
    }
    for (const targetType of relation.target_types || []) {
      if (!nodeMap.has(targetType)) continue;
      edges.push({
        id: `${relation.id}->${targetType}`,
        source: relation.id,
        target: targetType,
        label: "目标类型",
        tone: "neutral",
      });
    }
  }

  return { nodes, edges };
}

/** 选择本轮触及节点及其一跳关系端点，避免默认把完整本体目录当作任务视图。 */
export function selectRelevantOntologyNodes(
  ontologyNodes: OntologyNode[],
  touchedNodeIds: string[],
): OntologyNode[] {
  const nodeMap = new Map(ontologyNodes.map((node) => [node.id, node]));
  const selected = new Set(touchedNodeIds.filter((id) => nodeMap.has(id)));

  for (const relation of ontologyNodes.filter((node) => node.category === "Relation")) {
    const endpoints = [...relation.source_types, ...relation.target_types];
    if (selected.has(relation.id)) {
      endpoints.forEach((id) => { if (nodeMap.has(id)) selected.add(id); });
      continue;
    }
    const sourceTouched = relation.source_types.some((id) => selected.has(id));
    const targetTouched = relation.target_types.some((id) => selected.has(id));
    if (sourceTouched && targetTouched) {
      selected.add(relation.id);
    }
  }

  return ontologyNodes.filter((node) => selected.has(node.id));
}
