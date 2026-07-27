import "server-only";
import { latestArtifact } from "../../adapters/db";
import { parseJson } from "../types";
import { emptyGraph, type BusinessInstanceGraph } from "./types";
export function buildProvisionalProjection(runId: string): BusinessInstanceGraph {
  const graph = emptyGraph();
  graph.authority = "workbench_provisional";
  const stage02 = latestArtifact(runId, "stage_02", ["approved", "needs_review"]);
  if (stage02) {
    const data: any = parseJson(stage02.json_content, {});
    for (const [index, unit] of (data.judgment_units || []).entries()) {
      graph.objects.push({
        id: String(unit.id || `JU-${index + 1}`),
        type: "JudgmentUnit",
        properties: { ...unit, provisional: true },
        projection: { section: "judgment_units", index, provisional: true },
      });
    }
  }

  const stage03 = latestArtifact(runId, "stage_03", ["approved", "needs_review"]);
  if (stage03) {
    const data: any = parseJson(stage03.json_content, {});
    for (const [index, draft] of (data.evidence_drafts || []).entries()) {
      const id = String(draft.id || `EV-${index + 1}`);
      graph.objects.push({
        id,
        type: draft.kind === "gap" ? "EvidenceRequirement" : "EvidenceFact",
        properties: { ...draft, provisional: true },
        projection: { section: "evidence_drafts", index, provisional: true },
      });
    }
  }

  const stage04 = latestArtifact(runId, "stage_04", ["approved", "needs_review"]);
  if (stage04) {
    const data: any = parseJson(stage04.json_content, {});
    for (const [index, judgment] of (data.judgments || []).entries()) {
      const id = String(judgment.judgment_id || judgment.id || `J-${index + 1}`);
      graph.objects.push({
        id,
        type: "Judgment",
        properties: { ...judgment, provisional: true },
        projection: { section: "judgments", index, provisional: true },
      });
      for (const hypothesisId of judgment.hypothesis_ids || []) {
        graph.relations.push({
          id: `REL-${id}-${hypothesisId}`,
          type: "judgmentBasedOnHypothesis",
          sourceId: id,
          targetId: String(hypothesisId),
          properties: { provisional: true },
        });
      }
    }
  }

  const methodSource = stage04 || stage03 || stage02;
  if (methodSource) {
    const data: any = parseJson(methodSource.json_content, {});
    for (const [index, application] of (data.method_applications || []).entries()) {
      graph.objects.push({
        id: String(application.application_id || `MA-${index + 1}`),
        type: "MethodApplication",
        properties: { ...application, runtime_contract: "1.3.0", provisional: true },
        projection: { section: "method_applications", index, provisional: true },
      });
    }
  }

  return graph;
}
export function mergeGraphs(base: BusinessInstanceGraph, incoming: BusinessInstanceGraph): BusinessInstanceGraph {
  const next: BusinessInstanceGraph = {
    schema_name: "ontology_business_instance_graph",
    schema_version: base.schema_version || "1.0.0",
    authority: "business_parameters",
    objects: base.objects.map((object) => ({ ...object, properties: { ...(object.properties || {}) } })),
    relations: base.relations.map((relation) => ({ ...relation, properties: { ...(relation.properties || {}) } })),
  };
  const objectIds = new Set(next.objects.map((object) => object.id));
  const relationIds = new Set(next.relations.map((relation) => relation.id));
  for (const object of incoming.objects) {
    if (objectIds.has(object.id)) {
      next.objects = next.objects.map((existing) => (existing.id === object.id ? { ...object, properties: { ...(object.properties || {}) } } : existing));
    } else {
      next.objects.push({ ...object, properties: { ...(object.properties || {}) } });
      objectIds.add(object.id);
    }
  }
  for (const relation of incoming.relations) {
    if (relationIds.has(relation.id)) {
      next.relations = next.relations.map((existing) => (existing.id === relation.id ? { ...relation, properties: { ...(relation.properties || {}) } } : existing));
    } else {
      next.relations.push({ ...relation, properties: { ...(relation.properties || {}) } });
      relationIds.add(relation.id);
    }
  }
  return next;
}
export function summarizeGraph(graph: BusinessInstanceGraph, limit = 40): string {
  const byType = new Map<string, number>();
  for (const object of graph.objects) byType.set(object.type, (byType.get(object.type) || 0) + 1);
  const typeLines = [...byType.entries()].sort((a, b) => b[1] - a[1]).map(([type, count]) => `${type}:${count}`);
  const sample = graph.objects.slice(0, limit).map((object) => `${object.id}(${object.type})`).join(", ");
  return `objects=${graph.objects.length}; relations=${graph.relations.length}; types=[${typeLines.join(", ")}]; sample=[${sample}]`;
}
