import "server-only";

import { getRun, latestArtifact } from "../../storage/db";
import { listEvidenceImpactQueries } from "../ontology/research_queries";
import { collectRunOntologyTouchpoints, getRunOntologyResearchValue } from "./knowledge_browser";
import { buildKnowledgePackage } from "./knowledge_package";
import { loadGraphForRun } from "../ontology/instance_graph";
import { loadMethodRegistry } from "./method_registry";
import { parseJson, STAGES } from "../../schemas/types";

function collectStrings(value: unknown, key: string, target: Set<string>) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, key, target));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [nestedKey, nested] of Object.entries(value as Record<string, unknown>)) {
    if (nestedKey === key) {
      if (Array.isArray(nested)) nested.map(String).filter(Boolean).forEach((item) => target.add(item));
      else if (typeof nested === "string" && nested) target.add(nested);
    }
    collectStrings(nested, key, target);
  }
}

export function buildRunKnowledgeDashboard(runId: string) {
  const run = getRun(runId);
  if (!run) return null;
  const methodRegistry = loadMethodRegistry();
  const knowledgeFiles = new Set<string>();
  const mappingProfileIds = new Set<string>();
  const knowledgeVersions = new Set<string>();
  const methods = new Map<string, {
    method_id: string;
    name: string;
    capability_type: string;
    method_version: string;
    status: string;
    stage: string;
  }>();
  const stageApplications: Array<{
    stage: string;
    status: string;
    artifact_id: string;
    artifact_version: number;
    knowledge_version: string;
  }> = [];
  let structureArtifact: ReturnType<typeof latestArtifact> | undefined;
  let structure: Record<string, any> = {};

  for (const stage of STAGES) {
    const artifact = latestArtifact(runId, stage, ["needs_review"])
      || latestArtifact(runId, stage, ["approved"]);
    if (!artifact) continue;
    const data = parseJson<Record<string, any>>(artifact.json_content, {});
    const context = parseJson<Record<string, any>>(artifact.input_context || "{}", {});
    if (artifact.knowledge_version) knowledgeVersions.add(artifact.knowledge_version);
    collectStrings(context, "knowledge_files", knowledgeFiles);
    collectStrings(context, "mapping_profile_id", mappingProfileIds);
    collectStrings(data, "mapping_profile_id", mappingProfileIds);
    for (const application of Array.isArray(data.method_applications) ? data.method_applications : []) {
      const methodId = String(application?.method_id || "");
      if (!methodId || application?.status === "rejected") continue;
      const registered = methodRegistry.get(methodId);
      methods.set(`${stage}:${methodId}`, {
        method_id: methodId,
        name: registered?.name || methodId,
        capability_type: registered?.capability_type || "unknown",
        method_version: registered?.method_version || String(application?.method_version || ""),
        status: String(application?.status || artifact.status),
        stage,
      });
    }
    stageApplications.push({
      stage,
      status: artifact.status,
      artifact_id: artifact.id,
      artifact_version: artifact.version,
      knowledge_version: artifact.knowledge_version || "",
    });
    if (stage === "stage_02") {
      structureArtifact = artifact;
      structure = data;
    }
  }

  const localCandidates = (Array.isArray(structure.variables) ? structure.variables : [])
    .filter((item: any) => String(item?.ontology_node_id || "").startsWith("task_local:"))
    .map((item: any) => ({
      id: String(item.id || ""),
      ontology_node_id: String(item.ontology_node_id),
      name: String(item.name || item.id || "未命名候选"),
      category: String(item.category || "unknown"),
      variable_kind: String(item.variable_kind || "unknown"),
      definition: String(item.definition || ""),
      anchors: Array.isArray(item.anchors) ? item.anchors.map(String) : [],
      source_artifact_id: structureArtifact?.id || "",
      source_status: structureArtifact?.status || "unknown",
      judgment_unit_ids: (Array.isArray(structure.judgment_units) ? structure.judgment_units : [])
        .filter((unit: any) => (unit.ontology_node_ids || []).some((ref: unknown) => [item.id, item.ontology_node_id].includes(String(ref))))
        .map((unit: any) => String(unit.id || unit.judgment_unit_id || ""))
        .filter(Boolean),
    }));
  const touched = collectRunOntologyTouchpoints(runId);
  const value = getRunOntologyResearchValue(runId);
  const formalOntologyIds = [...new Set([...touched, ...(value?.relevant_node_ids || [])])]
    .filter((id) => !String(id).startsWith("task_local:"));
  const loadedGraph = loadGraphForRun(runId, run.package_path);
  const taskPackage = buildKnowledgePackage(runId);

  return {
    run,
    loadedGraph,
    formalOntologyIds,
    localCandidates,
    effects: value?.effects || [],
    methods: [...methods.values()],
    knowledgeFiles: [...knowledgeFiles].sort(),
    mappingProfileIds: [...mappingProfileIds].sort(),
    knowledgeVersions: [...knowledgeVersions].sort(),
    stageApplications,
    evidenceImpacts: listEvidenceImpactQueries(runId),
    taskPackage: {
      package_id: taskPackage.package_id,
      fingerprint: taskPackage.fingerprint,
      manifest: taskPackage.manifest,
    },
  };
}
