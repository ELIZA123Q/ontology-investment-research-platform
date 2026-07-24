/**
 * Runtime 上下文装配器：按阶段与任务切片组装 prompt 输入，
 * 避免整库硬塞；槽位有 token/字符预算。
 * 不依赖 server-only 模块，便于单测。
 */

import { createHash } from "node:crypto";
import { loadKnowledge, type LoadKnowledgeOptions } from "./knowledge";
import type { ArtifactKind, StageKind } from "./types";

/** 各槽位默认字符预算（近似 token 控制）。 */
export const CONTEXT_SLOT_BUDGETS = {
  knowledge: 72_000,
  ontology: 12_000,
  method_guidance: 48_000,
  upstream_json_soft: 120_000,
  sources_snapshot: 12_000,
} as const;

export type SemanticRoute = {
  judgment_unit_ids: string[];
  judgment_types: string[];
  ontology_node_ids: string[];
  variable_ids: string[];
  competing_explanation_ids: string[];
  evidence_method_ids: string[];
  adjudication_method_ids: string[];
};

export type AssembledStageContext = {
  semantic_route: SemanticRoute;
  ontology_object_set: string;
  knowledge_files: string[];
  knowledge_context: string;
  knowledge_version: string;
  budgets: typeof CONTEXT_SLOT_BUDGETS;
  assembly_note: string;
};

/** 从上游 01/02 投影本次语义路由（本体切片 + 方法子集线索）。 */
export function buildSemanticRoute(upstream: Array<{ kind: string; json: any }>): SemanticRoute {
  const stage01 = upstream.find((item) => item.kind === "stage_01")?.json || {};
  const stage02 = upstream.find((item) => item.kind === "stage_02")?.json || {};
  const units = Array.isArray(stage02.judgment_units) ? stage02.judgment_units : [];
  const variables = Array.isArray(stage02.variables) ? stage02.variables : [];
  const mas = Array.isArray(stage02.method_applications) ? stage02.method_applications : [];
  const ces = Array.isArray(stage02.competing_explanations) ? stage02.competing_explanations : [];

  return {
    judgment_unit_ids: units.map((u: any) => String(u?.id || "")).filter(Boolean),
    judgment_types: [
      ...new Set([
        ...units.map((u: any) => String(u?.judgment_type || "")).filter(Boolean),
        ...((stage01.main_judgment_axis?.judgment_types as string[]) || []).map(String),
      ]),
    ],
    ontology_node_ids: [
      ...new Set([
        ...units.flatMap((u: any) => (Array.isArray(u?.ontology_node_ids) ? u.ontology_node_ids : []).map(String)),
        ...variables.map((v: any) => String(v?.ontology_node_id || "")).filter(Boolean),
      ]),
    ],
    variable_ids: variables.map((v: any) => String(v?.id || "")).filter(Boolean),
    competing_explanation_ids: ces
      .map((c: any) => String(c?.explanation_id || c?.id || ""))
      .filter(Boolean),
    evidence_method_ids: mas
      .filter((m: any) => String(m?.capability_type) === "evidence")
      .map((m: any) => String(m?.method_id || ""))
      .filter(Boolean),
    adjudication_method_ids: mas
      .filter((m: any) => String(m?.capability_type) === "adjudication")
      .map((m: any) => String(m?.method_id || ""))
      .filter(Boolean),
  };
}

function clip(text: string, budget: number): string {
  if (text.length <= budget) return text;
  return `${text.slice(0, budget)}\n…[truncated to ${budget} chars]`;
}

/** 按任务相关判断类型加载知识；超出预算则按文件截断。 */
export function loadRoutedKnowledge(
  kind: StageKind,
  options: LoadKnowledgeOptions & { maxTotalChars?: number } = {},
) {
  const maxTotal = options.maxTotalChars ?? CONTEXT_SLOT_BUDGETS.knowledge;
  const loaded = loadKnowledge(kind, options);
  if (loaded.context.length <= maxTotal) return loaded;

  const perFile = Math.max(4_000, Math.floor(maxTotal / Math.max(loaded.files.length, 1)));
  const parts: string[] = [];
  let used = 0;
  for (const file of loaded.files) {
    const marker = `\n## ${file}\n`;
    const start = loaded.context.indexOf(marker);
    if (start < 0) continue;
    const next = loaded.context.indexOf("\n## ", start + marker.length);
    const body = loaded.context.slice(start + marker.length, next < 0 ? undefined : next);
    const slice = body.slice(0, perFile);
    const chunk = `${marker}${slice}${body.length > perFile ? "\n…[file truncated]" : ""}`;
    if (used + chunk.length > maxTotal) break;
    parts.push(chunk);
    used += chunk.length;
  }
  const context = parts.join("\n");
  const version = createHash("sha256").update(context).digest("hex");
  return { version: `sha256:${version}`, context, files: loaded.files };
}

/**
 * 装配阶段上下文核心槽位：语义路由 + 本体切片 + 按需知识库。
 * ontology 文本由调用方注入（避免本模块依赖 server-only 的 ontology_tools）。
 */
export function assembleStageContext(input: {
  kind: ArtifactKind;
  upstream: Array<{ kind: string; json: any }>;
  ontologyObjectSet: string;
  deliveryArchetype?: string;
}): AssembledStageContext {
  const route = buildSemanticRoute(input.upstream);
  const ontology_object_set = clip(input.ontologyObjectSet || "", CONTEXT_SLOT_BUDGETS.ontology);

  const isStage = String(input.kind).startsWith("stage_");
  const knowledge = isStage
    ? loadRoutedKnowledge(input.kind as StageKind, {
      deliveryArchetype: input.kind === "stage_05" ? input.deliveryArchetype : undefined,
      judgmentTypes: input.kind === "stage_04" || input.kind === "stage_03" || input.kind === "stage_02"
        ? route.judgment_types
        : undefined,
      maxTotalChars: CONTEXT_SLOT_BUDGETS.knowledge,
    })
    : { version: "none", context: "", files: [] as string[] };

  return {
    semantic_route: route,
    ontology_object_set,
    knowledge_files: knowledge.files,
    knowledge_context: knowledge.context,
    knowledge_version: knowledge.version,
    budgets: CONTEXT_SLOT_BUDGETS,
    assembly_note:
      "上下文按语义路由装配：本体切片 + 任务相关知识文件 + 方法子集；未路由资产不进默认 knowledge。",
  };
}
