import "server-only";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { latestArtifact } from "@/storage/db";
import { instancesPath, repositoryPath } from "@/storage/repo_paths";
import { parseJson } from "@/schemas/types";
import { emptyGraph, type BusinessInstanceGraph, type ObjectSetQuery, type ObjectSetResult, type GraphLoadResult } from "./types";
import { materializeStageIntoGraph } from "./materialize";
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

let cachedDomainGraph: BusinessInstanceGraph | null | undefined;
export function resetDomainBusinessGraphCache() {
  cachedDomainGraph = undefined;
}
export function loadDomainBusinessGraph(): BusinessInstanceGraph | null {
  if (cachedDomainGraph !== undefined) return cachedDomainGraph ? structuredClone(cachedDomainGraph) : null;
  cachedDomainGraph = loadGraphFromYamlFile(
    repositoryPath("01_semantic_knowledge", "01_ontology", "domains", "semiconductor", "business_instances.yaml"),
  );
  return cachedDomainGraph ? structuredClone(cachedDomainGraph) : null;
}

export function loadGraphFromPackage(packageRelPath: string): BusinessInstanceGraph | null {
  const normalized = packageRelPath.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized.startsWith("04_context_state/03_workspace/") || normalized.includes("../")) {
    throw new Error("样例包路径必须位于 04_context_state/03_workspace/ 内");
  }
  const root = instancesPath(normalized.slice("04_context_state/03_workspace/".length));
  if (!existsSync(root)) return null;
  const files = readdirSync(root).filter((name) => name.includes("本体视图") && name.endsWith(".yaml"));
  for (const file of files) {
    const graph = loadGraphFromYamlFile(path.join(/* turbopackIgnore: true */ root, file));
    if (graph?.objects.length) return graph;
  }

  // Ontology 3.0 的 semantic_fixture 样例按 02/03/04 分层保存，不再附带旧式“本体视图”文件。
  // 这里仅做只读、确定性的包投影；正式写入仍须生成 instance_graph artifact。
  const compactStages: Array<[string, string]> = [
    ["02_structure.yaml", "stage_02"],
    ["03_evidence.yaml", "stage_03"],
    ["04_judgment.yaml", "stage_04"],
  ];
  let projected = emptyGraph();
  projected.authority = "package_projection";
  for (const [file, stageKind] of compactStages) {
    const absolutePath = path.join(/* turbopackIgnore: true */ root, file);
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
