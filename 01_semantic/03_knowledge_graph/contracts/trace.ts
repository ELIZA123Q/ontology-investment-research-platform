import "server-only";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { instancesPath } from "@/storage/repo_paths";
import type { BusinessInstanceGraph } from "./types";
const DOWNSTREAM_DIRECTIONS: Record<string, "forward" | "reverse"> = {
  claimCitesSource: "reverse",
  factDerivedFromClaim: "reverse",
  assessmentEvaluatesFact: "reverse",
  basketIncludesAssessment: "reverse",
  basketFulfillsRequirement: "reverse",
  requirementForJudgmentUnit: "reverse",
  factSupportsSignal: "forward",
  signalGroundedByFact: "reverse",
  signalEvaluatesHypothesis: "forward",
  hypothesisEvaluatedBySignal: "reverse",
  hypothesisSupportsJudgment: "forward",
  judgmentBasedOnHypothesis: "reverse",
  judgmentHasRuleEvaluation: "reverse",
  ruleEvaluationForJudgment: "forward",
  unitUsesScope: "forward",
  scopeIncludesObject: "forward",
  questionDecomposesIntoUnit: "forward",
  unitHasHypothesis: "forward",
  hypothesisForUnit: "reverse",
  competingExplanationForUnit: "reverse",
  judgmentResolvesUnit: "reverse",
  judgmentHasReasoningTrace: "forward",
  reasoningTraceForJudgment: "reverse",
  traceIncludesNode: "reverse",
  runtimeMethodApplicationTargets: "reverse",
  runtimeJudgmentUsesMethodApplication: "reverse",
};

export type DownstreamTrace = {
  object_id: string;
  path: Array<{ relation_id: string; relation_type: string; from: string; to: string }>;
};

/** 返回按正式失效方向可达的最短路径，用于解释“为什么这个对象需要重看”。 */
export function traceReachableDownstream(
  graph: BusinessInstanceGraph,
  affectedObjectRefs: string[],
): DownstreamTrace[] {
  const knownIds = new Set(graph.objects.map((object) => object.id));
  const traces = new Map<string, DownstreamTrace>();
  const queue: string[] = [];
  for (const id of affectedObjectRefs) {
    if (!knownIds.has(id) || traces.has(id)) continue;
    traces.set(id, { object_id: id, path: [] });
    queue.push(id);
  }
  while (queue.length) {
    const current = queue.shift()!;
    const currentTrace = traces.get(current)!;
    for (const relation of graph.relations) {
      const direction = DOWNSTREAM_DIRECTIONS[relation.type];
      if (!direction) continue;
      const upstream = direction === "forward" ? relation.sourceId : relation.targetId;
      const downstream = direction === "forward" ? relation.targetId : relation.sourceId;
      if (upstream !== current || traces.has(downstream) || !knownIds.has(downstream)) continue;
      traces.set(downstream, {
        object_id: downstream,
        path: [...currentTrace.path, {
          relation_id: relation.id,
          relation_type: relation.type,
          from: upstream,
          to: downstream,
        }],
      });
      queue.push(downstream);
    }
  }
  return [...traces.values()];
}

export function markReachableDownstreamStale(graph: BusinessInstanceGraph, affectedObjectRefs: string[]) {
  const next = structuredClone(graph);
  const stale = new Set(traceReachableDownstream(next, affectedObjectRefs).map((trace) => trace.object_id));
  next.objects = next.objects.map((object) => stale.has(object.id)
    ? { ...object, properties: { ...(object.properties || {}), validity_status: "stale" } }
    : object);
  return { graph: next, stale_object_ids: [...stale] };
}

/** Resolve a formal example package relative path for binding. */
export function defaultExamplePackages(): string[] {
  const root = instancesPath("02_V3样例");
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join("instances", "02_V3样例", entry.name));
}
