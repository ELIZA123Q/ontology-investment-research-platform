import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import YAML from "yaml";
import { repositoryPath } from "../adapters/repo-paths";
import type { StageKind } from "./types";

const contextRegistryPath = "governance/01_架构/runtime_contexts.yaml";

export type LoadKnowledgeOptions = {
  deliveryArchetype?: string | null;
  judgmentTypes?: string[];
};

type StageContextConfig = {
  assets?: string[];
  template_by_archetype?: Record<string, string>;
  conditional_assets?: Array<{
    when_judgment_types?: string[];
    assets?: string[];
  }>;
};

type ContextRegistry = {
  stages?: Record<string, StageContextConfig>;
};

function loadRegistry(): ContextRegistry {
  return YAML.parse(readFileSync(repositoryPath(contextRegistryPath), "utf8")) as ContextRegistry;
}

export function registeredFiles(stage: StageKind, options: LoadKnowledgeOptions = {}): string[] {
  const registry = loadRegistry();
  const config = registry.stages?.[stage];
  if (!config || !Array.isArray(config.assets)) {
    throw new Error(`运行上下文注册表缺少 ${stage}`);
  }
  const files = [...config.assets];

  const templates = config.template_by_archetype;
  if (templates && Object.keys(templates).length) {
    const archetype = String(options.deliveryArchetype || "industry_cycle_report");
    const template = templates[archetype] || templates.industry_cycle_report;
    if (template) files.push(template);
  }

  for (const rule of config.conditional_assets || []) {
    const when = [...(rule.when_judgment_types || [])].map(String);
    const match = !when.length
      || when.some((type) => (options.judgmentTypes || []).includes(type));
    if (match) files.push(...(rule.assets || []).map(String));
  }

  return [...new Set(files)];
}

export function loadKnowledge(stage: StageKind, options: LoadKnowledgeOptions = {}) {
  const files = registeredFiles(stage, options);
  const loaded = files.map((file) => ({ file, content: readFileSync(repositoryPath(file), "utf8") }));
  const version = createHash("sha256").update(loaded.map((x) => `${x.file}\0${x.content}`).join("\0")).digest("hex");
  // Bound API cost while retaining headings, rules and field contracts.
  const context = loaded.map((x) => `\n## ${x.file}\n${x.content.slice(0, 24000)}`).join("\n");
  return { version: `sha256:${version}`, context, files };
}
