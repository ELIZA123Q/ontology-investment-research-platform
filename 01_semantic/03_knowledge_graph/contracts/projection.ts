import "server-only";
import { latestArtifact } from "@/storage/db";
import { parseJson } from "@/schemas/types";
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
    projection_fingerprints: (base.projection_fingerprints || incoming.projection_fingerprints)
      ? {
          ...(base.projection_fingerprints || {}),
          ...(incoming.projection_fingerprints || {}),
        }
      : undefined,
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

const STAGE_READ_SECTIONS: Record<string, string[]> = {
  stage_02: [
    "research_scope",
    "judgment_units",
    "variables",
    "paths",
    "questions",
    "ontology_instances",
    "evidence_requirements",
    "competing_explanations",
    "method_applications",
  ],
  stage_03: [
    "sources",
    "evidence_drafts",
    "method_applications",
  ],
  stage_04: [
    "judgments",
    "signals",
    "competing_explanations",
    "reasoning_traces",
    "method_applications",
  ],
};

function stripProjectionNoise(properties: Record<string, unknown> | undefined): Record<string, unknown> {
  const next = { ...(properties || {}) };
  delete next.provisional;
  delete next.projection_stage;
  delete next.projection_origin;
  return next;
}

/**
 * Unidirectional read: rebuild stage JSON sections from an instance graph.
 * Forbidden: hand-syncing stage JSON ↔ graph in both directions.
 */
export function projectStageJsonFromGraph(
  graph: BusinessInstanceGraph,
  stageKind: "stage_02" | "stage_03" | "stage_04",
): Record<string, unknown> {
  const allowed = new Set(STAGE_READ_SECTIONS[stageKind] || []);
  const buckets = new Map<string, Array<{ index: number; value: Record<string, unknown> }>>();

  for (const object of graph.objects) {
    const section = String(object.projection?.section || "");
    if (!section || !allowed.has(section)) continue;
    const index = typeof object.projection?.index === "number" ? Number(object.projection.index) : 0;
    const props = stripProjectionNoise(object.properties as Record<string, unknown> | undefined);
    const value = { id: object.id, ...props };
    const list = buckets.get(section) || [];
    list.push({ index, value });
    buckets.set(section, list);
  }

  const out: Record<string, unknown> = {
    _projected_from_graph: true,
    _projection_policy: "unidirectional_graph_to_stage_json",
  };
  for (const section of allowed) {
    const items = (buckets.get(section) || []).sort((a, b) => a.index - b.index).map((item) => item.value);
    if (!items.length) continue;
    if (section === "research_scope") {
      out.research_scope = items[0];
    } else {
      out[section] = items;
    }
  }
  return out;
}

/** Merge graph projection over artifact JSON for sections the graph knows about. */
export function mergeStageJsonWithGraphProjection(
  artifactData: Record<string, unknown>,
  graph: BusinessInstanceGraph,
  stageKind: "stage_02" | "stage_03" | "stage_04",
): Record<string, unknown> {
  const projected = projectStageJsonFromGraph(graph, stageKind);
  const next: Record<string, unknown> = { ...artifactData };
  for (const [key, value] of Object.entries(projected)) {
    next[key] = value;
  }
  return next;
}
