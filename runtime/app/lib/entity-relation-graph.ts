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
  const orderedTypes = [
    ...DISPLAY_ORDER.filter((type) => visibleObjects.some((item) => item.type === type)),
    ...[...new Set(visibleObjects.map((item) => item.type))].filter((type) => !DISPLAY_ORDER.includes(type)),
  ];
  const columns = new Map<string, number>();
  let columnCursor = 0;
  for (const type of orderedTypes) {
    columns.set(type, columnCursor);
    const count = visibleObjects.filter((item) => item.type === type).length;
    columnCursor += Math.max(1, Math.ceil(count / 6));
  }
  const rowByType = new Map<string, number>();
  const nodes = visibleObjects.map((object) => {
    const index = rowByType.get(object.type) || 0;
    rowByType.set(object.type, index + 1);
    const col = (columns.get(object.type) || 0) + Math.floor(index / 6);
    const row = index % 6;
    return {
      id: object.id,
      label: objectLabel(object),
      meta: objectTypeLabel(object.type),
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
