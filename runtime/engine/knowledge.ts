import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
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

/** 检查文件是否存在，返回缺失文件列表 */
export function verifyFileExists(filePath: string): { exists: boolean; message: string } {
  try {
    const fullPath = repositoryPath(filePath);
    if (existsSync(fullPath)) {
      return { exists: true, message: `✓ ${filePath}` };
    }
    return { exists: false, message: `✗ MISSING: ${filePath}` };
  } catch {
    return { exists: false, message: `✗ ERROR reading: ${filePath}` };
  }
}

/** 验证所有阶段注册的文件是否存在，返回完整诊断报告 */
export function verifyAllStandardFiles(): {
  allOk: boolean;
  total: number;
  present: number;
  missing: string[];
  byStage: Record<string, { total: number; present: number; missing: string[] }>;
} {
  const registry = loadRegistry();
  const stages = registry.stages || {};
  const missing: string[] = [];
  let total = 0;
  let present = 0;
  const byStage: Record<string, { total: number; present: number; missing: string[] }> = {};

  for (const [stage, config] of Object.entries(stages)) {
    const stageFiles = config.assets || [];
    const stageMissing: string[] = [];
    let stageTotal = stageFiles.length;
    let stagePresent = 0;

    for (const file of stageFiles) {
      const result = verifyFileExists(file);
      if (result.exists) stagePresent++;
      else stageMissing.push(file);
    }
    total += stageTotal;
    present += stagePresent;
    missing.push(...stageMissing);
    byStage[stage] = { total: stageTotal, present: stagePresent, missing: stageMissing };
  }

  return { allOk: missing.length === 0, total, present, missing, byStage };
}

export function loadKnowledge(stage: StageKind, options: LoadKnowledgeOptions = {}) {
  const files = registeredFiles(stage, options);
  const loadedFiles: string[] = [];
  const missingFiles: string[] = [];

  for (const file of files) {
    const check = verifyFileExists(file);
    if (check.exists) loadedFiles.push(file);
    else missingFiles.push(file);
  }

  // 缺失文件时输出警告（运行时环境可能无 stderr，使用一个结构化日志前缀）
  if (missingFiles.length > 0) {
    const warnPrefix = `[STANDARDS:WARN] Stage ${stage} 缺失知识文件 (${missingFiles.length}/${files.length}):`;
    console.warn(`${warnPrefix}\n  ${missingFiles.join("\n  ")}`);
  }

  const loaded = loadedFiles.map((file) => ({ file, content: readFileSync(repositoryPath(file), "utf8") }));
  const version = createHash("sha256").update(loaded.map((x) => `${x.file}\0${x.content}`).join("\0")).digest("hex");
  // Bound API cost while retaining headings, rules and field contracts.
  const context = loaded.map((x) => `\n## ${x.file}\n${x.content.slice(0, 24000)}`).join("\n");
  return {
    version: `sha256:${version}`,
    context,
    files: loadedFiles,
    missingFiles,
    stats: { total: files.length, loaded: loadedFiles.length, missing: missingFiles.length },
  };
}
