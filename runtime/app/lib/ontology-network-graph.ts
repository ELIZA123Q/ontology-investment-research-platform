import type { ResearchGraphEdge, ResearchGraphNode } from "@/app/components/research-graph";
import type { OntologyNode } from "@/skills/ontology/catalog_loader_adapter";

export type OntologyGraphPreset = {
  id: string;
  label: string;
  description: string;
  nodeIds: string[];
  relationIds: string[];
  entryConditions: string[];
  completionConditions: string[];
};

export type OntologyNetworkGraph = {
  nodes: ResearchGraphNode[];
  edges: ResearchGraphEdge[];
  presets: OntologyGraphPreset[];
  rules: Array<{ id: string; label: string; description: string; targetNodeIds: string[]; targetEdgeIds: string[] }>;
};

type OntologyGraphInput = Pick<OntologyNetworkGraph, "nodes" | "edges"> & Partial<Pick<OntologyNetworkGraph, "presets" | "rules">>;

function ontologyGroup(item: OntologyNode): string {
  if (["semantic", "semiconductor"].includes(String(item.model))) return "核心业务";
  if (item.model === "state_event") return "状态与事件";
  if (["evidence", "judgment"].includes(String(item.model))) return "证据与判断";
  return "研究结构";
}

function canonicalRelations(relations: OntologyNode[]) {
  const relationById = new Map(relations.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const result: Array<{ relation: OntologyNode; inverse?: OntologyNode }> = [];
  for (const relation of [...relations].sort((a, b) => a.id.localeCompare(b.id))) {
    const inverse = relation.inverse_of ? relationById.get(relation.inverse_of) : undefined;
    const key = inverse ? [relation.id, inverse.id].sort().join("~") : relation.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const canonical = inverse && inverse.id.localeCompare(relation.id) < 0 ? inverse : relation;
    const reverse = inverse ? (canonical.id === relation.id ? inverse : relation) : undefined;
    result.push({ relation: canonical, inverse: reverse });
  }
  return result;
}

function matchesRule(rule: OntologyNode, typeId: string) {
  return [...(rule.applies_to || []), ...(rule.input_types || []), ...(rule.output_types || [])].includes(typeId);
}

export function buildOntologyNetworkGraph(
  ontologyNodes: OntologyNode[],
  highlightNodeIds: string[] = [],
): OntologyNetworkGraph {
  const objects = ontologyNodes.filter((item) => item.category === "Object");
  const relations = ontologyNodes.filter((item) => item.category === "Relation");
  const rules = ontologyNodes.filter((item) => item.category === "Rule");
  const scenarios = ontologyNodes.filter((item) => item.category === "Scenario");
  const objectIds = new Set(objects.map((item) => item.id));
  const highlights = new Set(highlightNodeIds);
  const grouped = new Map<string, OntologyNode[]>();
  for (const item of objects) {
    const group = ontologyGroup(item);
    grouped.set(group, [...(grouped.get(group) || []), item]);
  }
  const groupOrder = ["核心业务", "状态与事件", "证据与判断", "研究结构"];
  const nodes: ResearchGraphNode[] = [];
  let baseX = 0;
  for (const group of groupOrder) {
    const items = [...(grouped.get(group) || [])].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    const columns = items.length > 24 ? 4 : items.length > 10 ? 3 : 2;
    items.forEach((item, index) => {
      const attachedRules = rules.filter((rule) => matchesRule(rule, item.id));
      const requiredByScenarios = scenarios.filter((scenario) => [
        ...(scenario.required_object_types || []),
        ...(scenario.required_state_types || []),
        ...(scenario.required_evidence_types || []),
        ...(scenario.required_judgment_types || []),
      ].includes(item.id));
      nodes.push({
        id: item.id,
        label: item.name,
        meta: `${group} · 对象类型${highlights.has(item.id) ? " · 本研究采用" : ""}`,
        tone: highlights.has(item.id) ? "support" : "neutral",
        x: baseX + (index % columns) * 260,
        y: Math.floor(index / columns) * 125,
        details: {
          知识分组: group,
          定义: item.description || "暂无定义",
          属性: item.properties,
          约束规则: attachedRules.map((rule) => rule.name),
          适用研究情景: requiredByScenarios.map((scenario) => scenario.name),
          模型: item.model,
          命名空间: item.namespace,
          状态: item.status,
          来源文件: item.source_file,
        },
      });
    });
    baseX += Math.max(2, columns) * 270 + 140;
  }

  const edges: ResearchGraphEdge[] = [];
  for (const { relation, inverse } of canonicalRelations(relations)) {
    for (const sourceType of relation.source_types || []) for (const targetType of relation.target_types || []) {
      if (!objectIds.has(sourceType) || !objectIds.has(targetType)) continue;
      const edgeId = `link:${relation.id}:${sourceType}:${targetType}`;
      const attachedRules = rules.filter((rule) =>
        matchesRule(rule, relation.id)
        || (rule.applies_to || []).includes("relation_instance")
        || ((rule.input_types || []).includes(sourceType) && (rule.input_types || []).includes(targetType)),
      );
      edges.push({
        id: edgeId,
        source: sourceType,
        target: targetType,
        label: inverse ? `${relation.name} / ${inverse.name}` : relation.name,
        tone: highlights.has(relation.id) || (inverse && highlights.has(inverse.id)) ? "support" : "neutral",
        authority: "formal",
        details: {
          关系ID: relation.id,
          关系名称: relation.name,
          反向关系ID: inverse?.id || "—",
          反向关系名称: inverse?.name || "—",
          定义: relation.description,
          方向: relation.direction || "directed",
          源基数: relation.source_cardinality || "—",
          目标基数: relation.target_cardinality || "—",
          关系属性: relation.properties,
          约束规则: attachedRules.map((rule) => rule.name),
          状态: relation.status,
          来源文件: relation.source_file,
        },
      });
    }
  }

  const ruleOverlays = rules.map((rule) => ({
    id: rule.id,
    label: rule.name,
    description: rule.description,
    targetNodeIds: nodes.filter((node) => matchesRule(rule, node.id)).map((node) => node.id),
    targetEdgeIds: edges.filter((edge) => {
      const relationId = String(edge.details?.关系ID || "");
      return matchesRule(rule, relationId) || (rule.applies_to || []).includes("relation_instance");
    }).map((edge) => edge.id),
  })).filter((rule) => rule.targetNodeIds.length || rule.targetEdgeIds.length);

  const presets = scenarios.map((scenario) => ({
    id: scenario.id,
    label: scenario.name,
    description: scenario.description,
    nodeIds: [...new Set([
      ...(scenario.required_object_types || []),
      ...(scenario.required_state_types || []),
      ...(scenario.required_evidence_types || []),
      ...(scenario.required_judgment_types || []),
    ])].filter((id) => objectIds.has(id)),
    relationIds: scenario.required_relation_types || [],
    entryConditions: scenario.entry_conditions || [],
    completionConditions: scenario.completion_conditions || [],
  }));

  return { nodes, edges, presets, rules: ruleOverlays };
}

/** 选择本轮实际触及的正式知识；关系会携带端点，规则和情景仅作为图层元数据保留。 */
export function selectRelevantOntologyNodes(ontologyNodes: OntologyNode[], touchedNodeIds: string[]): OntologyNode[] {
  const nodeMap = new Map(ontologyNodes.map((node) => [node.id, node]));
  const selected = new Set(touchedNodeIds.filter((id) => nodeMap.has(id)));
  for (const relation of ontologyNodes.filter((node) => node.category === "Relation")) {
    const endpoints = [...relation.source_types, ...relation.target_types];
    if (selected.has(relation.id)) endpoints.forEach((id) => { if (nodeMap.has(id)) selected.add(id); });
    else if (relation.source_types.some((id) => selected.has(id)) && relation.target_types.some((id) => selected.has(id))) selected.add(relation.id);
  }
  return ontologyNodes.filter((node) => selected.has(node.id));
}

export function addTaskLocalCandidatesToOntologyGraph(
  graph: OntologyGraphInput,
  candidates: Array<{
    id: string; ontology_node_id: string; name: string; definition: string; category: string;
    variable_kind: string; anchors: string[]; judgment_unit_ids: string[]; source_status: string;
  }>,
): OntologyNetworkGraph {
  const nodes = [...graph.nodes];
  const edges = [...graph.edges];
  const objectIds = new Set(nodes.map((node) => node.id));
  const baseX = Math.max(0, ...nodes.map((node) => node.x)) + 360;
  candidates.forEach((candidate, index) => {
    const anchorIds = candidate.anchors.filter((anchor) => objectIds.has(anchor));
    const fallbackIds = anchorIds.length ? [] : objectIds.has("JudgmentUnit") && candidate.judgment_unit_ids.length ? ["JudgmentUnit"] : objectIds.has("StateVariable") ? ["StateVariable"] : [];
    nodes.push({
      id: candidate.ontology_node_id,
      label: candidate.name,
      meta: "非正式候选 · 任务专用概念",
      tone: "weaken",
      x: baseX,
      y: index * 135,
      details: {
        知识分组: "任务专用候选",
        权威状态: "仅本研究生效",
        定义: candidate.definition || "尚未形成稳定定义",
        类别: candidate.category,
        变量类型: candidate.variable_kind,
        锚点: candidate.anchors,
        使用位置: candidate.judgment_unit_ids,
        来源状态: candidate.source_status,
      },
    });
    [...anchorIds, ...fallbackIds].forEach((anchorId) => edges.push({
      id: `task-local:${candidate.ontology_node_id}:${anchorId}`,
      source: anchorId,
      target: candidate.ontology_node_id,
      label: anchorIds.includes(anchorId) ? "任务内扩展" : anchorId === "JudgmentUnit" ? "任务内判断使用" : "任务内变量扩展",
      tone: "weaken",
      authority: "task_local",
      dashed: true,
      details: { 权威状态: "task_local", 使用位置: candidate.judgment_unit_ids, 来源状态: candidate.source_status },
    }));
  });
  return { nodes, edges, presets: graph.presets || [], rules: graph.rules || [] };
}

export function applyUsageHeatToOntologyGraph(
  graph: OntologyGraphInput,
  usage: Map<string, { run_count: number; occurrence_count: number }>,
): OntologyNetworkGraph {
  return {
    presets: graph.presets || [],
    rules: graph.rules || [],
    nodes: graph.nodes.map((node) => {
      const observed = usage.get(node.id);
      return {
        ...node,
        tone: observed?.run_count ? "support" as const : "unknown" as const,
        meta: `${node.meta.split("·")[0].trim()} · ${observed?.run_count || 0} 个研究 / ${observed?.occurrence_count || 0} 次`,
        details: { ...node.details, 应用研究数: observed?.run_count || 0, 应用次数: observed?.occurrence_count || 0 },
      };
    }),
    edges: graph.edges.map((edge) => {
      const relationId = String(edge.details?.关系ID || "");
      const observed = usage.get(relationId);
      return { ...edge, usageCount: observed?.occurrence_count || 0, tone: observed?.run_count ? "support" as const : "unknown" as const, details: { ...edge.details, 应用研究数: observed?.run_count || 0, 应用次数: observed?.occurrence_count || 0 } };
    }),
  };
}

export function buildCandidateGapGraph(candidates: Array<{
  candidate_key: string; name: string; category: string; variable_kind: string; run_count: number;
  occurrence_count: number; definitions: string[]; anchors: string[];
  similarities?: Array<{ candidate_key: string; name: string; score: number; confidence: string }>;
}>): OntologyNetworkGraph {
  const nodes: ResearchGraphNode[] = candidates.map((candidate, index) => ({
    id: candidate.candidate_key,
    label: candidate.name,
    meta: `非正式候选 · ${candidate.run_count} 个研究 / ${candidate.occurrence_count} 次`,
    tone: candidate.run_count > 1 ? "weaken" : "unknown",
    x: Math.floor(index / 7) * 360,
    y: (index % 7) * 125,
    details: { 建议: candidate.run_count > 1 ? "建议进入本体治理" : "继续观察复用证据", 类别: candidate.category, 变量类型: candidate.variable_kind, 定义变体: candidate.definitions, 锚点: candidate.anchors },
  }));
  const ids = new Set(nodes.map((node) => node.id));
  const edgeIds = new Set<string>();
  const edges: ResearchGraphEdge[] = [];
  for (const candidate of candidates) for (const related of candidate.similarities || []) {
    if (!ids.has(related.candidate_key) || related.confidence !== "high") continue;
    const id = [candidate.candidate_key, related.candidate_key].sort().join("~");
    if (edgeIds.has(id)) continue;
    edgeIds.add(id);
    edges.push({ id, source: candidate.candidate_key, target: related.candidate_key, label: `高置信近义 ${(related.score * 100).toFixed(0)}%`, tone: "weaken", authority: "task_local", dashed: true, details: { 相似度: related.score, 置信度: related.confidence } });
  }
  return { nodes, edges, presets: [], rules: [] };
}
