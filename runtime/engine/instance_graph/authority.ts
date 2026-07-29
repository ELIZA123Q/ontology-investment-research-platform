import "server-only";
import { createHash } from "node:crypto";
import { materializeStageIntoGraph } from "./materialize";
import { mergeGraphs } from "./projection";
import {
  emptyGraph,
  type BusinessInstanceGraph,
  type GraphObject,
  type GraphRelation,
} from "./types";

export const AUTHORITY_GRAPH_STAGES = ["stage_02", "stage_03", "stage_04"] as const;
export type AuthorityGraphStage = (typeof AUTHORITY_GRAPH_STAGES)[number];

export type AuthorityStageInput = {
  kind: AuthorityGraphStage;
  artifact_id: string;
  artifact_version: number;
  data: Record<string, unknown>;
};

/**
 * 从已确认阶段的完整序列重放正式图，而不是把新阶段增量叠加到旧图。
 * 因此上游修订时，已被废止的下游投影会自然消失；Action 写入仅在显式
 * 标记为 action origin 时作为覆盖层保留。
 */
export function buildAuthorityGraphCandidate(
  stages: AuthorityStageInput[],
  existingGraph?: BusinessInstanceGraph | null,
): BusinessInstanceGraph {
  assertContiguousStages(stages);
  let candidate = emptyGraph();
  candidate.authority = "business_parameters";
  candidate.projection_fingerprints = {};

  for (const stage of stages) {
    candidate = materializeStageIntoGraph(candidate, stage.kind, stage.data);
    candidate.projection_fingerprints = {
      ...(candidate.projection_fingerprints || {}),
      [stage.kind]: authorityStageProjectionFingerprint(stage),
    };
  }

  const overlay = existingGraph ? actionOverlay(existingGraph, candidate) : null;
  if (overlay?.objects.length || overlay?.relations.length) {
    candidate = mergeGraphs(candidate, overlay);
  }
  candidate.authority = "business_parameters";
  return candidate;
}

function assertContiguousStages(stages: AuthorityStageInput[]) {
  const kinds = stages.map((stage) => stage.kind);
  const expected = AUTHORITY_GRAPH_STAGES.slice(0, stages.length);
  if (new Set(kinds).size !== kinds.length || kinds.some((kind, index) => kind !== expected[index])) {
    throw new Error(
      `正式图谱阶段必须从 stage_02 连续重放；收到 ${kinds.join(", ") || "<empty>"}`,
    );
  }
}

export function authorityStageProjectionFingerprint(stage: AuthorityStageInput): string {
  return createHash("sha256")
    .update(stableJson({
      stage: stage.kind,
      artifact_id: stage.artifact_id,
      artifact_version: stage.artifact_version,
      data: stage.data,
    }))
    .digest("hex");
}

function actionOverlay(
  existing: BusinessInstanceGraph,
  candidate: BusinessInstanceGraph,
): BusinessInstanceGraph {
  const actionObjects = existing.objects
    .filter(isActionObject)
    .map(cloneObject);
  const endpointIds = new Set([
    ...candidate.objects.map((object) => object.id),
    ...actionObjects.map((object) => object.id),
  ]);
  const actionRelations = existing.relations
    .filter(isActionRelation)
    .filter((relation) => endpointIds.has(relation.sourceId) && endpointIds.has(relation.targetId))
    .map(cloneRelation);
  return {
    ...emptyGraph(),
    authority: "business_parameters",
    objects: actionObjects,
    relations: actionRelations,
  };
}

function isActionObject(object: GraphObject) {
  return object.projection?.origin === "action";
}

function isActionRelation(relation: GraphRelation) {
  return relation.properties?.projection_origin === "action";
}

function cloneObject(object: GraphObject): GraphObject {
  return {
    ...object,
    properties: { ...(object.properties || {}) },
    projection: object.projection ? { ...object.projection } : undefined,
  };
}

function cloneRelation(relation: GraphRelation): GraphRelation {
  return {
    ...relation,
    properties: { ...(relation.properties || {}) },
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
