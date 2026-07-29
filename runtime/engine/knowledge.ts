import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import YAML from "yaml";
import { repositoryPath } from "../adapters/repo-paths";
import { logger } from "../lib/logger";
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

  // 条件资源加载：按判断类型筛选。
  // 回退策略：如果未提供 judgmentTypes（首次生成 Stage02 时 Stage01 可能未填），
  // 加载全部 conditional_assets，避免框架文件完全缺失。
  const hasJudgmentTypes = (options.judgmentTypes || []).length > 0;
  for (const rule of config.conditional_assets || []) {
    const when = [...(rule.when_judgment_types || [])].map(String);
    const match = !when.length
      || !hasJudgmentTypes  // 回退：无判断类型时加载全部
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
    const stageTotal = stageFiles.length;
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

  // 缺失文件时输出警告（运行时环境可能无 stderr，使用统一 logger）
  if (missingFiles.length > 0) {
    logger.warn(
      "STANDARDS",
      `Stage ${stage} 缺失知识文件 (${missingFiles.length}/${files.length})`,
      missingFiles,
    );
  }

  const loaded = loadedFiles.map((file) => ({ file, content: readFileSync(repositoryPath(file), "utf8") }));
  // source_version：全文哈希，用于溯源；version 与此相同（未截断路由时）。
  // loadRoutedKnowledge 会另算注入内容哈希作为 knowledge_version。
  const sourceDigest = createHash("sha256").update(loaded.map((x) => `${x.file}\0${x.content}`).join("\0")).digest("hex");
  const source_version = `sha256:${sourceDigest}`;
  // Bound API cost while retaining headings / 质量门槛 / 停止条件等优先节。
  const context = loaded.map((x) => `\n## ${x.file}\n${prioritizeKnowledgeContent(x.content, 60_000)}`).join("\n");
  return {
    version: source_version,
    source_version,
    context,
    files: loadedFiles,
    entries: loaded,
    missingFiles,
    stats: {
      total: files.length,
      loaded: loadedFiles.length,
      missing: missingFiles.length,
      omitted_by_budget: 0,
    },
  };
}

/** 超长规范优先保留方法指导和质量章节，避免偏向约束性内容。 */
export function prioritizeKnowledgeContent(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  const parts = content.split(/(?=^#{1,3}\s+)/m);
  if (parts.length < 3) {
    return `${content.slice(0, maxChars)}\n…[truncated]`;
  }
  const headBudget = Math.floor(maxChars * 0.25);
  const selected = new Set<number>([0]);
  // 方法指导优先，约束性章节次之
  const METHOD_GUIDE = /分析[步骤流程方法框架]|计算[步骤逻辑方法]|数据[来源采集映射]|关键指标|推理[过程链步骤]|判断[流逻辑步骤]|评估[方法逻辑]|验证[方法步骤]|研究[路线框架方法]|操作[步骤流程]|案例/;
  const CONSTRAINT = /质量|门槛|返工|停止|门禁|00A|不得|禁止|确认前|high_quality|minimum_pass|证据不越权|判断价值/;
  const ranked = parts
    .map((part, index) => ({
      index,
      priority: index === 0
        ? -1                          // 引导段永远第一
        : METHOD_GUIDE.test(part) ? 0  // 方法指导最高优先
        : CONSTRAINT.test(part) ? 1    // 约束性次之
        : 2,                           // 其他最后
    }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index);

  let budgetLeft = maxChars;
  const lengths = new Map<number, number>();
  for (const item of ranked) {
    if (budgetLeft <= 0) break;
    const part = parts[item.index] || "";
    const allow = item.index === 0 ? Math.min(part.length, headBudget, budgetLeft) : Math.min(part.length, budgetLeft);
    if (allow <= 0) continue;
    selected.add(item.index);
    lengths.set(item.index, allow);
    budgetLeft -= allow;
  }

  let out = "";
  for (let i = 0; i < parts.length; i += 1) {
    if (!selected.has(i)) continue;
    out += parts[i].slice(0, lengths.get(i) || 0);
  }
  return `${out}\n…[truncated prioritizing quality sections]`;
}
