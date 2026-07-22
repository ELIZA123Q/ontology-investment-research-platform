import "server-only";

import { readFileSync } from "node:fs";
import YAML from "yaml";
import { getRun, latestArtifact } from "@/adapters/db";
import { repositoryPath } from "@/adapters/repo-paths";
import { loadGraphForRun } from "@/engine/instance_graph";
import { ontologyTypeLabel } from "@/engine/ontology_display_labels";
import { deriveOntologyResearchValue } from "@/engine/ontology_research_value";
import { parseJson } from "@/engine/types";

export type KnowledgeAsset = {
  stage: string;
  file: string;
  title: string;
  snippet: string;
};

export function listKnowledgeAssets(): KnowledgeAsset[] {
  const registry = YAML.parse(readFileSync(repositoryPath("governance/01_架构/runtime_contexts.yaml"), "utf8")) as {
    stages?: Record<string, { assets?: string[] }>;
  };
  const assets: KnowledgeAsset[] = [];
  for (const [stage, config] of Object.entries(registry.stages || {})) {
    for (const file of config.assets || []) {
      const content = readFileSync(repositoryPath(file), "utf8");
      const lines = content.split("\n").slice(0, 10).join("\n");
      assets.push({
        stage,
        file,
        title: file.split("/").at(-1) || file,
        snippet: lines,
      });
    }
  }
  return assets;
}

export function collectRunOntologyTouchpoints(runId: string): string[] {
  const ids = new Set<string>();
  const stage02 = latestArtifact(runId, "stage_02", ["approved", "needs_review"]);
  const data = parseJson<Record<string, any>>(stage02?.json_content || "{}", {});
  for (const unit of data.judgment_units || []) {
    for (const item of unit.ontology_node_ids || []) ids.add(String(item));
  }
  for (const variable of data.variables || []) {
    if (variable.ontology_node_id) ids.add(String(variable.ontology_node_id));
  }
  const graph = loadGraphForRun(runId, getRun(runId)?.package_path).graph;
  for (const object of graph.objects) ids.add(object.type);
  for (const relation of graph.relations) ids.add(relation.type);
  return [...ids];
}

export function getRunOntologyResearchValue(runId: string) {
  const stage02 = latestArtifact(runId, "stage_02", ["approved", "needs_review"]);
  const stage04 = latestArtifact(runId, "stage_04", ["approved", "needs_review"]);
  const graph = loadGraphForRun(runId, getRun(runId)?.package_path).graph;
  return deriveOntologyResearchValue({
    structure: parseJson(stage02?.json_content || "{}", {}),
    judgment: parseJson(stage04?.json_content || "{}", {}),
    graph,
    labelForOntologyRef: ontologyTypeLabel,
  });
}
