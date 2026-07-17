import "server-only";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { latestArtifact } from "../adapters/db";
import { repositoryPath } from "../adapters/repo-paths";
import { parseJson } from "./types";

export type GraphObject = {
  id: string;
  type: string;
  properties?: Record<string, unknown>;
  projection?: Record<string, unknown>;
  validFrom?: string;
  validTo?: string;
};

export type GraphRelation = {
  id: string;
  type: string;
  sourceId: string;
  targetId: string;
  properties?: Record<string, unknown>;
};

export type BusinessInstanceGraph = {
  schema_name: "ontology_business_instance_graph";
  schema_version: string;
  authority: string;
  objects: GraphObject[];
  relations: GraphRelation[];
  projection_fingerprints?: Record<string, string>;
};

export type ObjectSetQuery = {
  type?: string | string[];
  ids?: string[];
  relatedTo?: string;
  relationType?: string;
  direction?: "out" | "in" | "both";
  propertyContains?: { key: string; value: string };
  limit?: number;
};

export type ObjectSetResult = {
  objects: GraphObject[];
  relations: GraphRelation[];
  total_objects: number;
  total_relations: number;
  source: string;
  authority: "formal" | "package" | "provisional" | "empty";
  provisional?: boolean;
};

export type GraphLoadResult = {
  graph: BusinessInstanceGraph;
  source: string;
  authority: "formal" | "package" | "provisional" | "empty";
  provisional: boolean;
};

const EMPTY_GRAPH: BusinessInstanceGraph = {
  schema_name: "ontology_business_instance_graph",
  schema_version: "1.0.0",
  authority: "business_parameters",
  objects: [],
  relations: [],
};

export function emptyGraph(): BusinessInstanceGraph {
  return structuredClone(EMPTY_GRAPH);
}

export function isBusinessInstanceGraph(value: unknown): value is BusinessInstanceGraph {
  if (!value || typeof value !== "object") return false;
  const doc = value as Record<string, unknown>;
  return doc.schema_name === "ontology_business_instance_graph" && Array.isArray(doc.objects) && Array.isArray(doc.relations);
}

export function extractGraph(doc: unknown): BusinessInstanceGraph | null {
  if (!doc || typeof doc !== "object") return null;
  const root = doc as Record<string, unknown>;
  if (isBusinessInstanceGraph(root)) return normalizeGraph(root);
  if (isBusinessInstanceGraph(root.business_instance_graph)) {
    return normalizeGraph(root.business_instance_graph as BusinessInstanceGraph);
  }
  return null;
}

function normalizeGraph(graph: BusinessInstanceGraph): BusinessInstanceGraph {
  return {
    schema_name: "ontology_business_instance_graph",
    schema_version: String(graph.schema_version || "1.0.0"),
    authority: String(graph.authority || "business_parameters"),
    objects: (graph.objects || []).map((object) => ({
      id: String(object.id),
      type: String(object.type),
      properties: object.properties && typeof object.properties === "object" ? { ...object.properties } : {},
      projection: object.projection && typeof object.projection === "object" ? { ...object.projection } : undefined,
      validFrom: object.validFrom,
      validTo: object.validTo,
    })),
    relations: (graph.relations || []).map((relation) => ({
      id: String(relation.id),
      type: String(relation.type),
      sourceId: String(relation.sourceId),
      targetId: String(relation.targetId),
      properties: relation.properties && typeof relation.properties === "object" ? { ...relation.properties } : {},
    })),
    projection_fingerprints: graph.projection_fingerprints,
  };
}

export function queryObjectSet(graph: BusinessInstanceGraph, query: ObjectSetQuery = {}): ObjectSetResult {
  const types = query.type ? new Set(Array.isArray(query.type) ? query.type : [query.type]) : null;
  const ids = query.ids?.length ? new Set(query.ids) : null;
  const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
  let objects = graph.objects.slice();

  if (types) objects = objects.filter((object) => types.has(object.type));
  if (ids) objects = objects.filter((object) => ids.has(object.id));
  if (query.propertyContains) {
    const { key, value } = query.propertyContains;
    objects = objects.filter((object) => {
      const raw = object.properties?.[key];
      return raw !== undefined && String(raw).includes(value);
    });
  }

  if (query.relatedTo) {
    const direction = query.direction || "both";
    const neighborIds = new Set<string>();
    for (const relation of graph.relations) {
      if (query.relationType && relation.type !== query.relationType) continue;
      if ((direction === "out" || direction === "both") && relation.sourceId === query.relatedTo) {
        neighborIds.add(relation.targetId);
      }
      if ((direction === "in" || direction === "both") && relation.targetId === query.relatedTo) {
        neighborIds.add(relation.sourceId);
      }
    }
    objects = objects.filter((object) => neighborIds.has(object.id) || object.id === query.relatedTo);
  }

  const objectIds = new Set(objects.map((object) => object.id));
  const relations = graph.relations.filter(
    (relation) => objectIds.has(relation.sourceId) || objectIds.has(relation.targetId),
  );

  return {
    objects: objects.slice(0, limit),
    relations: relations.slice(0, limit * 3),
    total_objects: objects.length,
    total_relations: relations.length,
    source: "business_instance_graph",
    authority: "formal",
  };
}

export function loadGraphFromYamlFile(absolutePath: string): BusinessInstanceGraph | null {
  if (!existsSync(absolutePath)) return null;
  const doc = YAML.parse(readFileSync(absolutePath, "utf8"));
  return extractGraph(doc);
}

export function loadGraphFromPackage(packageRelPath: string): BusinessInstanceGraph | null {
  const root = repositoryPath(packageRelPath);
  if (!existsSync(root)) return null;
  const files = readdirSync(root).filter((name) => name.includes("本体视图") && name.endsWith(".yaml"));
  for (const file of files) {
    const graph = loadGraphFromYamlFile(path.join(root, file));
    if (graph?.objects.length) return graph;
  }

  // Ontology 3.0 的正式样例按 02/03/04 分层保存，不再附带旧式“本体视图”文件。
  // 这里仅做只读、确定性的包投影；正式写入仍须生成 instance_graph artifact。
  const compactStages: Array<[string, string]> = [
    ["02_structure.yaml", "stage_02"],
    ["03_evidence.yaml", "stage_03"],
    ["04_judgment.yaml", "stage_04"],
  ];
  let projected = emptyGraph();
  projected.authority = "package_projection";
  for (const [file, stageKind] of compactStages) {
    const absolutePath = path.join(root, file);
    if (!existsSync(absolutePath)) continue;
    const document = YAML.parse(readFileSync(absolutePath, "utf8"));
    if (!document || typeof document !== "object") continue;
    projected = materializeStageIntoGraph(projected, stageKind, document as Record<string, unknown>);
    projected.authority = "package_projection";
  }
  if (projected.objects.length) return projected;
  return null;
}

/**
 * Load the run-scoped graph.
 * Formal authority = committed `instance_graph` artifact only.
 * Package / embedded stage graphs are read-only seeds.
 * Draft synthesis is NEVER returned as silent formal truth — use buildProvisionalProjection().
 */
export function loadGraphForRun(runId: string, packagePath?: string | null): GraphLoadResult {
  const graphArtifact = latestArtifact(runId, "instance_graph" as any, ["approved", "needs_review"]);
  if (graphArtifact) {
    const payload: any = parseJson(graphArtifact.json_content, {});
    const graph = extractGraph(payload);
    if (graph) {
      const provisional = Boolean(payload.provisional) || graph.authority === "workbench_provisional";
      return {
        graph,
        source: `artifact:${graphArtifact.id}`,
        authority: provisional ? "provisional" : "formal",
        provisional,
      };
    }
  }

  if (packagePath) {
    const graph = loadGraphFromPackage(packagePath);
    if (graph?.objects.length) {
      return { graph, source: `package:${packagePath}`, authority: "package", provisional: false };
    }
  }

  for (const kind of ["stage_02", "stage_04", "stage_03"] as const) {
    const artifact = latestArtifact(runId, kind, ["approved"]);
    if (!artifact) continue;
    const graph = extractGraph(parseJson(artifact.json_content, {}));
    if (graph?.objects.length) {
      return {
        graph,
        source: `${kind}:${artifact.id}`,
        authority: "package",
        provisional: false,
      };
    }
  }

  return { graph: emptyGraph(), source: "empty", authority: "empty", provisional: false };
}

/** Explicit draft projection — must not be treated as formal write authority. */
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
        type: "EvidenceClaim",
        properties: { ...draft, provisional: true },
        projection: { section: "evidence_drafts", index, provisional: true },
      });
    }
  }

  const stage04 = latestArtifact(runId, "stage_04", ["approved", "needs_review"]);
  if (stage04) {
    const data: any = parseJson(stage04.json_content, {});
    for (const [index, judgment] of (data.judgments || []).entries()) {
      const id = String(judgment.id || `J-${index + 1}`);
      graph.objects.push({
        id,
        type: "Judgment",
        properties: { ...judgment, provisional: true },
        projection: { section: "judgments", index, provisional: true },
      });
      for (const evidenceId of judgment.supporting_evidence_draft_ids || []) {
        graph.relations.push({
          id: `REL-${id}-${evidenceId}`,
          type: "judgmentBasedOn",
          sourceId: id,
          targetId: String(evidenceId),
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

/** Materialize stage drafts / embedded graphs into the committed instance_graph artifact payload. */
export function materializeStageIntoGraph(
  current: BusinessInstanceGraph,
  stageKind: string,
  stageJson: Record<string, unknown>,
): BusinessInstanceGraph {
  const embedded = extractGraph(stageJson);
  if (embedded?.objects.length) {
    return mergeGraphs({ ...current, authority: "business_parameters" }, embedded);
  }

  const slice = emptyGraph();
  slice.authority = "business_parameters";
  const addObjects = (
    values: unknown,
    type: string,
    idKeys: string[],
    section: string,
    typeFromItem = false,
  ) => {
    if (!Array.isArray(values)) return;
    for (const [index, raw] of values.entries()) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      const id = idKeys.map((key) => item[key]).find((value) => value !== undefined && String(value).length);
      if (!id) continue;
      slice.objects.push({
        id: String(id),
        type: typeFromItem && item.type ? String(item.type) : type,
        properties: { ...item },
        projection: { section, index },
      });
    }
  };
  for (const [index, application] of ((stageJson.method_applications as any[]) || []).entries()) {
    const applicationId = String(application.application_id || `MA-${index + 1}`);
    slice.objects.push({
      id: applicationId,
      type: "MethodApplication",
      properties: { ...application, runtime_contract: "1.3.0" },
      projection: { section: "method_applications", index },
    });
    for (const judgmentUnitId of application.target_judgment_unit_refs || []) {
      slice.relations.push({
        id: `RUNTIME-${applicationId}-TARGET-${judgmentUnitId}`,
        type: "runtimeMethodApplicationTargets",
        sourceId: applicationId,
        targetId: String(judgmentUnitId),
        properties: { authority: "public_contract_1.3" },
      });
    }
  }
  if (stageKind === "stage_02") {
    addObjects(stageJson.ontology_instances, "SemanticObject", ["id"], "ontology_instances", true);
    addObjects(stageJson.questions, "ResearchQuestion", ["question_id", "id"], "questions");
    for (const [index, unit] of ((stageJson.judgment_units as any[]) || []).entries()) {
      slice.objects.push({
        id: String(unit.judgment_unit_id || unit.id || `JU-${index + 1}`),
        type: "JudgmentUnit",
        properties: { ...unit },
        projection: { section: "judgment_units", index },
      });
    }
    addObjects(stageJson.competing_explanations, "CompetingExplanation", ["explanation_id", "id"], "competing_explanations");
    addObjects(stageJson.evidence_requirements, "EvidenceRequirement", ["evidence_requirement_id", "id"], "evidence_requirements");
  }
  if (stageKind === "stage_03") {
    addObjects(stageJson.claims, "EvidenceClaim", ["claim_id", "id"], "claims");
    addObjects(stageJson.facts, "EvidenceFact", ["evidence_id", "id"], "facts", true);
    addObjects(stageJson.assessments, "EvidenceAssessment", ["assessment_id", "id"], "assessments");
    addObjects(stageJson.baskets, "EvidenceBasket", ["basket_id", "id"], "baskets");
    for (const [index, draft] of ((stageJson.evidence_drafts as any[]) || []).entries()) {
      slice.objects.push({
        id: String(draft.id || `EV-${index + 1}`),
        type: "EvidenceClaim",
        properties: { ...draft },
        projection: { section: "evidence_drafts", index },
      });
    }
    for (const [index, source] of ((stageJson.sources as any[]) || []).entries()) {
      const id = String(source.source_id || source.source_key || source.id || `SD-${index + 1}`);
      slice.objects.push({
        id,
        type: "SourceDocument",
        properties: { ...source },
        projection: { section: "sources", index },
      });
    }
  }
  if (stageKind === "stage_04") {
    for (const [index, signal] of ((stageJson.signals as any[]) || []).entries()) {
      const id = String(signal.signal_id || signal.id || `SIG-${index + 1}`);
      slice.objects.push({
        id,
        type: "Signal",
        properties: { ...signal },
        projection: { section: "signals", index },
      });
      for (const evidenceId of signal.evidence_refs || signal.evidence_draft_ids || []) {
        slice.relations.push({
          id: `REL-${id}-EVIDENCE-${evidenceId}`,
          type: "signalDerivedFromEvidence",
          sourceId: id,
          targetId: String(evidenceId),
          properties: {},
        });
      }
    }
    addObjects(stageJson.hypotheses, "Hypothesis", ["hypothesis_id", "id"], "hypotheses");
    addObjects(stageJson.competing_explanations, "CompetingExplanation", ["explanation_id", "id"], "competing_explanations");
    addObjects(stageJson.rule_evaluations, "RuleEvaluation", ["rule_evaluation_id", "id"], "rule_evaluations");
    addObjects(stageJson.reasoning_traces, "ReasoningTrace", ["trace_id", "id"], "reasoning_traces");
    for (const [index, judgment] of ((stageJson.judgments as any[]) || []).entries()) {
      const id = String(judgment.judgment_id || judgment.id || `J-${index + 1}`);
      slice.objects.push({
        id,
        type: "Judgment",
        properties: { ...judgment },
        projection: { section: "judgments", index },
      });
      for (const evidenceId of judgment.evidence_refs || judgment.supporting_evidence_draft_ids || []) {
        slice.relations.push({
          id: `REL-${id}-${evidenceId}`,
          type: "judgmentBasedOn",
          sourceId: id,
          targetId: String(evidenceId),
          properties: {},
        });
      }
      for (const applicationId of judgment.method_application_refs || judgment.method_application_ids || []) {
        slice.relations.push({
          id: `RUNTIME-${id}-METHOD-${applicationId}`,
          type: "runtimeJudgmentUsesMethodApplication",
          sourceId: id,
          targetId: String(applicationId),
          properties: { authority: "public_contract_1.3" },
        });
      }
    }
  }
  return mergeGraphs({ ...current, authority: "business_parameters" }, slice);
}

export function summarizeGraph(graph: BusinessInstanceGraph, limit = 40): string {
  const byType = new Map<string, number>();
  for (const object of graph.objects) byType.set(object.type, (byType.get(object.type) || 0) + 1);
  const typeLines = [...byType.entries()].sort((a, b) => b[1] - a[1]).map(([type, count]) => `${type}:${count}`);
  const sample = graph.objects.slice(0, limit).map((object) => `${object.id}(${object.type})`).join(", ");
  return `objects=${graph.objects.length}; relations=${graph.relations.length}; types=[${typeLines.join(", ")}]; sample=[${sample}]`;
}

/** Resolve a formal example package relative path for binding. */
export function defaultExamplePackages(): string[] {
  const root = repositoryPath("instances", "02_V3样例");
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join("instances", "02_V3样例", entry.name));
}
