import "server-only";

import { readFileSync } from "node:fs";
import YAML from "yaml";
import { getRun, latestArtifact } from "../../storage/db";
import { repositoryPath } from "../../storage/repo_paths";
import { loadGraphForRun } from "../ontology/instance_graph";
import { formalStateVariableDisplayNames, ontologyTypeLabel } from "../ontology/display_labels";
import { deriveOntologyResearchValue } from "../ontology/research_value";
import { parseJson } from "../../schemas/types";
import { approvedSemanticDataIfPresent } from "../ontology/semantic_reads";

export type KnowledgeAsset = {
  stage: string;
  file: string;
  title: string;
  snippet: string;
};

export function listKnowledgeAssets(): KnowledgeAsset[] {
  const registry = YAML.parse(readFileSync(repositoryPath("governance/01_架构/runtime_contexts.yaml"), "utf8")) as {
    stages?: Record<string, {
      assets?: string[];
      template_by_archetype?: Record<string, string>;
      conditional_assets?: Array<{ assets?: string[] }>;
    }>;
  };
  const assets: KnowledgeAsset[] = [];
  for (const [stage, config] of Object.entries(registry.stages || {})) {
    const files = new Set<string>([
      ...(config.assets || []),
      ...Object.values(config.template_by_archetype || {}),
      ...(config.conditional_assets || []).flatMap((rule) => rule.assets || []),
    ]);
    for (const file of files) {
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
  const draft = latestArtifact(runId, "stage_02", ["needs_review"]);
  const data = draft
    ? parseJson<Record<string, any>>(draft.json_content, {})
    : approvedSemanticDataIfPresent(runId, "stage_02") || {};
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
  const stage02Draft = latestArtifact(runId, "stage_02", ["needs_review"]);
  const stage04Draft = latestArtifact(runId, "stage_04", ["needs_review"]);
  const graph = loadGraphForRun(runId, getRun(runId)?.package_path).graph;
  const formalVariableNames = formalStateVariableDisplayNames();
  return deriveOntologyResearchValue({
    structure: stage02Draft
      ? parseJson(stage02Draft.json_content, {})
      : approvedSemanticDataIfPresent(runId, "stage_02") || {},
    judgment: stage04Draft
      ? parseJson(stage04Draft.json_content, {})
      : approvedSemanticDataIfPresent(runId, "stage_04") || {},
    graph,
    labelForOntologyRef: (ref) => formalVariableNames.get(ref) || ontologyTypeLabel(ref),
  });
}
