import { traceReachableDownstream, type BusinessInstanceGraph } from "./instance_graph";

export type EvidenceImpactQueryResult = {
  evidence: { id: string; type: string; label: string };
  impacted_judgments: Array<{
    id: string;
    label: string;
    strength: string;
    decision_status: string;
    judgment_unit_id: string;
    path: Array<{ relation_type: string; from: string; to: string }>;
  }>;
  impacted_object_count: number;
};

function objectLabel(object: { id: string; properties?: Record<string, unknown> }): string {
  return String(
    object.properties?.statement
      || object.properties?.title
      || object.properties?.conclusion
      || object.properties?.name
      || object.id,
  );
}

export function queryEvidenceImpact(
  graph: BusinessInstanceGraph,
  evidenceId: string,
): EvidenceImpactQueryResult {
  const evidence = graph.objects.find((object) => object.id === evidenceId);
  if (!evidence || !["EvidenceFact", "EvidenceClaim", "SourceDocument"].includes(evidence.type)) {
    throw new Error("查询起点必须是当前实例图中的来源、证据陈述或证据事实");
  }
  const traces = traceReachableDownstream(graph, [evidenceId]);
  const traceById = new Map(traces.map((trace) => [trace.object_id, trace]));
  const impactedJudgments = graph.objects
    .filter((object) => object.type === "Judgment" && traceById.has(object.id))
    .map((object) => ({
      id: object.id,
      label: objectLabel(object),
      strength: String(object.properties?.strength || object.properties?.level || ""),
      decision_status: String(object.properties?.decision_status || object.properties?.status || ""),
      judgment_unit_id: String(object.properties?.judgment_unit_id || object.properties?.judgment_unit_ref || ""),
      path: traceById.get(object.id)!.path.map(({ relation_type, from, to }) => ({ relation_type, from, to })),
    }));
  return {
    evidence: { id: evidence.id, type: evidence.type, label: objectLabel(evidence) },
    impacted_judgments: impactedJudgments,
    impacted_object_count: traces.length - 1,
  };
}
