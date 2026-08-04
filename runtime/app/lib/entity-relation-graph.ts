import type { ResearchGraphEdge, ResearchGraphNode } from "@/app/components/research-graph";
import { objectTypeLabel, relationTypeLabel } from "@/app/lib/ui-labels";
import { type GraphLoadResult } from "@/engine/instance_graph";

const PROCESS_TYPES = new Set([
  "ResearchQuestion",
  "JudgmentUnit",
  "Judgment",
  "EvidenceFact",
  "EvidenceClaim",
  "EvidenceRequirement",
  "EvidenceAssessment",
  "EvidenceBasket",
  "SourceDocument",
  "Hypothesis",
  "Signal",
  "CompetingExplanation",
  "RuleEvaluation",
  "ReasoningTrace",
  "MethodApplication",
  "ResearchScope",
  "ResearchPath",
]);

const DECISION_TYPES = new Set([
  "ResearchQuestion",
  "JudgmentUnit",
  "ResearchScope",
  "StateVariable",
  "Industry",
  "ValueChainSegment",
  "Product",
  "Application",
  "Company",
  "ManufacturingFacility",
  "Technology",
  "Region",
  "Material",
  "ProcessStep",
  "Asset",
  "Hypothesis",
  "Judgment",
]);

const DECISION_RELATIONS = new Set([
  "questionDecomposesIntoUnit",
  "unitUsesScope",
  "scopeIncludesObject",
  "unitEvaluatesStateVariable",
  "unitHasHypothesis",
  "judgmentResolvesUnit",
  "judgmentBasedOnHypothesis",
]);

export type EntityNetworkLayer = "business" | "evidence" | "reasoning" | "technical";

const ENTITY_LAYER_TYPES: Record<EntityNetworkLayer, Set<string>> = {
  business: new Set([
    "StateVariable", "Industry", "ValueChainSegment", "Product", "Application", "Company",
    "ManufacturingFacility", "Technology", "Region", "Material", "ProcessStep", "Asset",
  ]),
  evidence: new Set([
    "SourceDocument", "EvidenceClaim", "EvidenceFact", "EvidenceAssessment", "EvidenceBasket",
    "EvidenceRequirement", "Signal", "BlockingFactor",
  ]),
  reasoning: new Set([
    "ResearchQuestion", "JudgmentUnit", "ResearchScope", "Hypothesis", "CompetingExplanation",
    "RuleEvaluation", "Judgment",
  ]),
  technical: new Set(["MethodApplication", "ReasoningTrace"]),
};

const DISPLAY_ORDER = [
  "ResearchQuestion",
  "JudgmentUnit",
  "ResearchScope",
  "StateVariable",
  "Industry",
  "ValueChainSegment",
  "Product",
  "Application",
  "Company",
  "ManufacturingFacility",
  "Technology",
  "Region",
  "Material",
  "ProcessStep",
  "Asset",
  "Hypothesis",
  "Judgment",
];

export type EntityRelationGraphStats = {
  totalObjects: number;
  totalRelations: number;
  visibleObjects: number;
  visibleRelations: number;
  isolatedDecisionObjects: number;
  judgmentUnits: number;
  judgmentUnitsWithoutVariableBindings: number;
  stateVariables: number;
  unboundStateVariables: number;
  availableByLayer?: Record<EntityNetworkLayer, number>;
};

function toneForType(type: string): ResearchGraphNode["tone"] {
  if (type === "Judgment") return "support";
  if (type === "ResearchQuestion" || type === "Hypothesis") return "inherited";
  if (PROCESS_TYPES.has(type)) return "unknown";
  return "neutral";
}

function objectLabel(item: { id: string; properties?: Record<string, unknown> }): string {
  const name = item.properties?.name || item.properties?.title || item.properties?.statement || item.properties?.conclusion;
  return typeof name === "string" && name.trim() ? name : item.id;
}

export function buildEntityRelationGraph(
  loaded: GraphLoadResult,
  options: { includeProcessObjects?: boolean; scope?: "decision" | "business" | "all" } = {},
): { nodes: ResearchGraphNode[]; edges: ResearchGraphEdge[]; stats: EntityRelationGraphStats } {
  const scope = options.scope || (options.includeProcessObjects ? "all" : "business");
  const candidateObjects = loaded.graph.objects.filter((item) => {
    if (scope === "all") return true;
    if (scope === "decision") return DECISION_TYPES.has(item.type);
    return !PROCESS_TYPES.has(item.type);
  });
  const candidateIds = new Set(candidateObjects.map((item) => item.id));
  const candidateRelations = loaded.graph.relations.filter((item) =>
    candidateIds.has(item.sourceId)
    && candidateIds.has(item.targetId)
    && (scope !== "decision" || DECISION_RELATIONS.has(item.type)),
  );
  const connectedIds = new Set(candidateRelations.flatMap((item) => [item.sourceId, item.targetId]));
  const visibleObjects = scope === "decision"
    ? candidateObjects.filter((item) => connectedIds.has(item.id))
    : candidateObjects;
  const visibleIds = new Set(visibleObjects.map((item) => item.id));
  const typeOrder = new Map(DISPLAY_ORDER.map((type, index) => [type, index]));
  const orderedObjects = [...visibleObjects].sort((left, right) =>
    (typeOrder.get(left.type) ?? DISPLAY_ORDER.length) - (typeOrder.get(right.type) ?? DISPLAY_ORDER.length)
    || left.type.localeCompare(right.type)
    || left.id.localeCompare(right.id));
  const columnCount = orderedObjects.length > 100 ? 16 : orderedObjects.length > 50 ? 12 : 8;
  const nodes = orderedObjects.map((object, index) => {
    return {
      id: object.id,
      label: objectLabel(object),
      meta: objectTypeLabel(object.type),
      tone: toneForType(object.type),
      x: (index % columnCount) * 250,
      y: Math.floor(index / columnCount) * 125,
      details: {
        类型: object.type,
        编号: object.id,
        属性: object.properties || {},
      },
    } satisfies ResearchGraphNode;
  });
  const edges = candidateRelations
    .filter((item) => visibleIds.has(item.sourceId) && visibleIds.has(item.targetId))
    .map((relation) => ({
      id: relation.id,
      source: relation.sourceId,
      target: relation.targetId,
      label: relationTypeLabel(relation.type),
      tone: relation.type.startsWith("judgment") ? "support" as const
        : relation.type === "unitEvaluatesStateVariable" || relation.type === "unitHasHypothesis"
          ? "inherited" as const
          : "neutral" as const,
    }));
  const judgmentUnitIds = new Set(loaded.graph.objects.filter((item) => item.type === "JudgmentUnit").map((item) => item.id));
  const stateVariableIds = new Set(loaded.graph.objects.filter((item) => item.type === "StateVariable").map((item) => item.id));
  const variableRelations = loaded.graph.relations.filter((item) =>
    item.type === "unitEvaluatesStateVariable"
    && judgmentUnitIds.has(item.sourceId)
    && stateVariableIds.has(item.targetId),
  );
  const boundJudgmentUnitIds = new Set(variableRelations.map((item) => item.sourceId));
  const boundStateVariableIds = new Set(variableRelations.map((item) => item.targetId));
  return {
    nodes,
    edges,
    stats: {
      totalObjects: loaded.graph.objects.length,
      totalRelations: loaded.graph.relations.length,
      visibleObjects: nodes.length,
      visibleRelations: edges.length,
      isolatedDecisionObjects: candidateObjects.length - visibleObjects.length,
      judgmentUnits: judgmentUnitIds.size,
      judgmentUnitsWithoutVariableBindings: judgmentUnitIds.size - boundJudgmentUnitIds.size,
      stateVariables: stateVariableIds.size,
      unboundStateVariables: stateVariableIds.size - boundStateVariableIds.size,
    },
  };
}

export function buildLayeredEntityNetwork(
  loaded: GraphLoadResult,
  options: { layers?: EntityNetworkLayer[]; query?: string; type?: string } = {},
): { nodes: ResearchGraphNode[]; edges: ResearchGraphEdge[]; stats: EntityRelationGraphStats } {
  const layers = options.layers?.length ? options.layers : ["business" as const];
  const allowedTypes = new Set(layers.flatMap((layer) => [...ENTITY_LAYER_TYPES[layer]]));
  const normalizedQuery = String(options.query || "").trim().toLocaleLowerCase("zh-CN");
  let candidates = loaded.graph.objects.filter((item) => allowedTypes.has(item.type));
  if (options.type) candidates = candidates.filter((item) => item.type === options.type);
  const candidateIds = new Set(candidates.map((item) => item.id));
  const candidateRelations = loaded.graph.relations.filter((relation) => candidateIds.has(relation.sourceId) && candidateIds.has(relation.targetId));
  if (normalizedQuery) {
    const directMatches = new Set(candidates.filter((item) => `${item.id} ${objectLabel(item)} ${objectTypeLabel(item.type)}`
      .toLocaleLowerCase("zh-CN").includes(normalizedQuery)).map((item) => item.id));
    const neighborhood = new Set(directMatches);
    for (const relation of candidateRelations) {
      if (directMatches.has(relation.sourceId) || directMatches.has(relation.targetId)) {
        neighborhood.add(relation.sourceId);
        neighborhood.add(relation.targetId);
      }
    }
    candidates = candidates.filter((item) => neighborhood.has(item.id));
  }
  const visibleIds = new Set(candidates.map((item) => item.id));
  const visibleRelations = candidateRelations.filter((relation) => visibleIds.has(relation.sourceId) && visibleIds.has(relation.targetId));
  const orderedTypes = [
    ...DISPLAY_ORDER.filter((type) => candidates.some((item) => item.type === type)),
    ...[...new Set(candidates.map((item) => item.type))].filter((type) => !DISPLAY_ORDER.includes(type)),
  ];
  const columns = new Map(orderedTypes.map((type, index) => [type, index]));
  const rowByType = new Map<string, number>();
  const nodes = candidates.map((object) => {
    const row = rowByType.get(object.type) || 0;
    rowByType.set(object.type, row + 1);
    return {
      id: object.id,
      label: objectLabel(object),
      meta: objectTypeLabel(object.type),
      tone: toneForType(object.type),
      x: (columns.get(object.type) || 0) * 330,
      y: row * 120,
      details: { 类型: objectTypeLabel(object.type), 名称: objectLabel(object), 关系数: visibleRelations.filter((relation) => relation.sourceId === object.id || relation.targetId === object.id).length, 技术编号: object.id },
    } satisfies ResearchGraphNode;
  });
  const edges = visibleRelations.map((relation) => ({
    id: relation.id,
    source: relation.sourceId,
    target: relation.targetId,
    label: relationTypeLabel(relation.type),
    tone: "neutral" as const,
  }));
  const base = buildEntityRelationGraph(loaded, { scope: "decision" });
  return {
    nodes,
    edges,
    stats: {
      ...base.stats,
      visibleObjects: nodes.length,
      visibleRelations: edges.length,
      availableByLayer: {
        business: loaded.graph.objects.filter((item) => ENTITY_LAYER_TYPES.business.has(item.type)).length,
        evidence: loaded.graph.objects.filter((item) => ENTITY_LAYER_TYPES.evidence.has(item.type)).length,
        reasoning: loaded.graph.objects.filter((item) => ENTITY_LAYER_TYPES.reasoning.has(item.type)).length,
        technical: loaded.graph.objects.filter((item) => ENTITY_LAYER_TYPES.technical.has(item.type)).length,
      },
    },
  };
}

export function entityLayerTypes(layer: EntityNetworkLayer) {
  return [...ENTITY_LAYER_TYPES[layer]];
}

const BUSINESS_ENTITY_TYPES = new Set([
  "Industry", "ValueChainSegment", "Product", "Application", "Company", "ManufacturingFacility",
  "ProductionLine", "Technology", "TechnologyRoute", "Region", "Material", "SemiconductorMaterial",
  "SemiconductorEquipment", "ProcessStep", "Asset", "PolicyInstrument", "FinancialInstrument", "TradingVenue", "Listing",
]);

export function buildBusinessEntityGraph(loaded: GraphLoadResult) {
  const objects = loaded.graph.objects.filter((item) => BUSINESS_ENTITY_TYPES.has(item.type));
  const objectIds = new Set(objects.map((item) => item.id));
  const relations = loaded.graph.relations.filter((relation) => objectIds.has(relation.sourceId) && objectIds.has(relation.targetId));
  const types = [...new Set(objects.map((item) => item.type))].sort((a, b) =>
    (DISPLAY_ORDER.indexOf(a) < 0 ? 999 : DISPLAY_ORDER.indexOf(a)) - (DISPLAY_ORDER.indexOf(b) < 0 ? 999 : DISPLAY_ORDER.indexOf(b))
    || a.localeCompare(b));
  const columnByType = new Map(types.map((type, index) => [type, index]));
  const rowByType = new Map<string, number>();
  const nodes = objects.map((object) => {
    const row = rowByType.get(object.type) || 0;
    rowByType.set(object.type, row + 1);
    const status = String(object.properties?.status || object.properties?.verification_status || object.properties?.instance_status || "");
    return {
      id: object.id,
      label: objectLabel(object),
      meta: `${objectTypeLabel(object.type)}${status ? ` · ${status}` : ""}`,
      tone: status === "planned" ? "weaken" as const : "neutral" as const,
      x: (columnByType.get(object.type) || 0) * 310,
      y: row * 125,
      details: { 类型: objectTypeLabel(object.type), 技术类型: object.type, 实例状态: status || "未登记", 属性: object.properties || {}, 技术编号: object.id },
    } satisfies ResearchGraphNode;
  });
  const edges = relations.map((relation) => {
    const status = String(relation.properties?.status || relation.properties?.verification_status || "verified");
    return {
      id: relation.id,
      source: relation.sourceId,
      target: relation.targetId,
      label: relationTypeLabel(relation.type),
      tone: status === "planned" ? "weaken" as const : "neutral" as const,
      dashed: status === "planned",
      details: { 关系类型: relationTypeLabel(relation.type), 技术关系ID: relation.type, 关系状态: status, 属性: relation.properties || {}, 关系记录ID: relation.id },
    } satisfies ResearchGraphEdge;
  });
  return { nodes, edges, stats: { objects: nodes.length, relations: edges.length, isolated: nodes.filter((node) => !edges.some((edge) => edge.source === node.id || edge.target === node.id)).length } };
}

const REASONING_TYPES = new Set([
  "ResearchQuestion", "JudgmentUnit", "Signal", "Hypothesis", "CompetingExplanation", "BlockingFactor", "Judgment",
]);

const REASONING_COLUMNS: Record<string, number> = {
  ResearchQuestion: 0,
  JudgmentUnit: 1,
  Signal: 2,
  CompetingExplanation: 2,
  BlockingFactor: 2,
  Hypothesis: 3,
  Judgment: 4,
};

function reasoningTone(type: string, properties: Record<string, unknown> = {}): ResearchGraphNode["tone"] {
  const role = String(properties.role || properties.direction || properties.result || properties.decision_status || "");
  if (["weaken", "counter", "contested"].includes(role)) return "weaken";
  if (["block", "blocked", "fail"].includes(role) || type === "BlockingFactor") return "danger";
  if (["support", "supported", "pass"].includes(role) || type === "Judgment") return "support";
  return type === "ResearchQuestion" || type === "Hypothesis" ? "inherited" : "neutral";
}

function reachableEvidence(loaded: GraphLoadResult, unitId: string) {
  const objectById = new Map(loaded.graph.objects.map((object) => [object.id, object]));
  const allowed = new Set(["JudgmentUnit", "EvidenceRequirement", "EvidenceBasket", "EvidenceAssessment", "EvidenceFact", "Signal"]);
  const visited = new Set([unitId]);
  let frontier = new Set([unitId]);
  for (let depth = 0; depth < 5 && frontier.size; depth += 1) {
    const next = new Set<string>();
    for (const relation of loaded.graph.relations) {
      if (!frontier.has(relation.sourceId) && !frontier.has(relation.targetId)) continue;
      const candidate = frontier.has(relation.sourceId) ? relation.targetId : relation.sourceId;
      const object = objectById.get(candidate);
      if (!object || !allowed.has(object.type) || visited.has(candidate)) continue;
      visited.add(candidate);
      next.add(candidate);
    }
    frontier = next;
  }
  return loaded.graph.objects.filter((object) => visited.has(object.id) && object.type === "EvidenceFact");
}

export function buildReasoningPathGraph(loaded: GraphLoadResult) {
  const objects = loaded.graph.objects.filter((item) => REASONING_TYPES.has(item.type));
  const visibleIds = new Set(objects.map((item) => item.id));
  const evaluationsByJudgment = new Map<string, typeof loaded.graph.objects>();
  for (const relation of loaded.graph.relations.filter((item) => item.type === "judgmentHasRuleEvaluation")) {
    const evaluation = loaded.graph.objects.find((object) => object.id === relation.targetId && object.type === "RuleEvaluation");
    if (evaluation) evaluationsByJudgment.set(relation.sourceId, [...(evaluationsByJudgment.get(relation.sourceId) || []), evaluation]);
  }
  // 识别根问题：唯一对 JudgmentUnit 发出 questionDecomposesIntoUnit 的研究问题即本研究主问题；
  // 其余研究问题节点为判断单元分解出的子问题。无单一根时回落到 Q-root 或首个研究问题。
  const questionIds = new Set(objects.filter((item) => item.type === "ResearchQuestion").map((item) => item.id));
  const rootSourceIds = new Set(
    loaded.graph.relations
      .filter((item) => item.type === "questionDecomposesIntoUnit" && questionIds.has(item.sourceId))
      .map((item) => item.sourceId),
  );
  const rootQuestionId = rootSourceIds.size === 1
    ? [...rootSourceIds][0]
    : (objects.find((item) => item.type === "ResearchQuestion" && item.id === "Q-root")?.id
      || objects.find((item) => item.type === "ResearchQuestion")?.id
      || "");
  const subQuestionIds: string[] = [];
  const rowByType = new Map<string, number>();
  const nodes = objects.map((object) => {
    const row = rowByType.get(object.type) || 0;
    rowByType.set(object.type, row + 1);
    const evidence = object.type === "JudgmentUnit" ? reachableEvidence(loaded, object.id) : [];
    const evaluations = evaluationsByJudgment.get(object.id) || [];
    const isRootQuestion = object.type === "ResearchQuestion" && object.id === rootQuestionId;
    if (object.type === "ResearchQuestion" && !isRootQuestion) subQuestionIds.push(object.id);
    const questionRoleMeta = object.type === "ResearchQuestion"
      ? isRootQuestion ? " · 主问题" : " · 子问题"
      : "";
    return {
      id: object.id,
      label: objectLabel(object),
      meta: `${objectTypeLabel(object.type)}${questionRoleMeta}${evidence.length ? ` · ${evidence.length} 条证据` : ""}${evaluations.length ? ` · ${evaluations.length} 项规则` : ""}`,
      tone: object.type === "ResearchQuestion" ? (isRootQuestion ? "inherited" : "neutral") : reasoningTone(object.type, object.properties),
      x: (REASONING_COLUMNS[object.type] || 0) * 330,
      y: row * 145,
      details: {
        类型: objectTypeLabel(object.type),
        技术类型: object.type,
        状态: object.properties?.decision_status || object.properties?.status || object.properties?.result || "—",
        结论或陈述: object.properties?.conclusion || object.properties?.statement || object.properties?.question || object.properties?.name || "—",
        证据数量: evidence.length,
        证据摘要: evidence.slice(0, 12).map((item) => objectLabel(item)),
        规则评估: evaluations.map((item) => ({ 规则: item.properties?.rule_ref, 结果: item.properties?.result, 理由: item.properties?.deterministic_result || item.properties?.rationale })),
        成立条件: object.properties?.conditions || "—",
        失效条件: object.properties?.invalidation_conditions || "—",
        技术编号: object.id,
        ...(object.type === "ResearchQuestion" ? { 角色: isRootQuestion ? "主问题（本研究核心问题）" : "子问题（判断单元分解）" } : {}),
      },
    } satisfies ResearchGraphNode;
  });
  const edges: ResearchGraphEdge[] = [];
  for (const relation of loaded.graph.relations) {
    if (!visibleIds.has(relation.sourceId) || !visibleIds.has(relation.targetId)) continue;
    let source = relation.sourceId;
    let target = relation.targetId;
    if (["judgmentBasedOnHypothesis", "judgmentResolvesUnit"].includes(relation.type)) [source, target] = [target, source];
    const role = String(relation.properties?.role || "");
    const tone = role === "weaken" || role === "counter" ? "weaken" as const
      : role === "block" || relation.type.includes("Blocking") || relation.type.includes("blocking") ? "danger" as const
        : ["signalEvaluatesHypothesis", "judgmentBasedOnHypothesis"].includes(relation.type) ? "support" as const : "inherited" as const;
    edges.push({
      id: relation.id,
      source,
      target,
      label: role ? `${relationTypeLabel(relation.type)} · ${role}` : relationTypeLabel(relation.type),
      tone,
      dashed: tone === "weaken" || tone === "danger",
      details: { 路径语义: role || relationTypeLabel(relation.type), 技术关系: relation.type, 属性: relation.properties || {} },
    });
  }
  // 将子问题显式挂接在根问题之下，明确它们属于同一研究而非多个独立研究。
  if (rootQuestionId && subQuestionIds.length) {
    for (const subId of subQuestionIds) {
      edges.push({
        id: `SYNTH-ROOT-SUB-${subId}`,
        source: rootQuestionId,
        target: subId,
        label: relationTypeLabel("questionDecomposesIntoSubQuestion"),
        tone: "inherited" as const,
        dashed: true,
        details: { 路径语义: "分解为子问题", 技术关系: "questionDecomposesIntoSubQuestion", 属性: {} },
      });
    }
  }
  return { nodes, edges, stats: { nodes: nodes.length, paths: edges.length, evidence: nodes.reduce((sum, node) => sum + Number(node.details.证据数量 || 0), 0) } };
}
