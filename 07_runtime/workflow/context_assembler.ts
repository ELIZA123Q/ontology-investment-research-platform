/**
 * Runtime 上下文装配器：按阶段与任务切片组装 prompt 输入，
 * 避免整库硬塞；槽位有 token/字符预算。
 * 不依赖 server-only 模块，便于单测。
 */

import { createHash } from "node:crypto";
import {
  loadKnowledge,
  prioritizeKnowledgeContent,
  type LoadKnowledgeOptions,
} from "../skills/method_selection/knowledge_loader";
import type { ArtifactKind, StageKind } from "../schemas/types";

/** 各槽位默认字符预算（近似 token 控制）。
 *  标准、方法正文与上游结构化产物分槽限额；同一方法正文不得同时从
 *  knowledge 与 method_guidance 重复进入。预算目标是保留决胜规则和研究材料，
 *  而不是把整个仓库塞给模型后依赖注意力碰运气。
 */
export const CONTEXT_SLOT_BUDGETS = {
  knowledge: 96_000,
  ontology: 28_000,
  method_guidance: 56_000,
  upstream_json_soft: 72_000,
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

/** 单文件实际注入审计：loaded 仅当正文真正进入 prompt。 */
export type KnowledgeFileInjection = {
  file: string;
  included_chars: number;
  truncated: boolean;
  omitted_reason: string | null;
  content_hash: string;
  loaded: boolean;
};

export type AssembledStageContext = {
  semantic_route: SemanticRoute;
  ontology_object_set: string;
  knowledge_files: string[];
  knowledge_context: string;
  knowledge_version: string;
  /** 源文件全文哈希（截断前），用于溯源；与 knowledge_version（注入内容哈希）不同。 */
  knowledge_source_version: string;
  budgets: typeof CONTEXT_SLOT_BUDGETS;
  assembly_note: string;
  file_injections: KnowledgeFileInjection[];
  /** 标准加载统计 */
  standards_loading: {
    files_total: number;
    files_loaded: number;
    files_missing: number;
    files_omitted_by_budget: number;
    missing_list: string[];
  };
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

/**
 * 真正执行 upstream_json_soft 预算：超限时进一步压缩 Stage03 样本并截断长字符串字段。
 */
export function clipUpstreamJsonSoft<T>(
  upstream: T,
  budget: number = CONTEXT_SLOT_BUDGETS.upstream_json_soft,
): { value: T; clipped: boolean; original_chars: number; final_chars: number } {
  const original = JSON.stringify(upstream);
  if (original.length <= budget) {
    return { value: upstream, clipped: false, original_chars: original.length, final_chars: original.length };
  }
  if (!Array.isArray(upstream)) {
    return {
      value: upstream,
      clipped: true,
      original_chars: original.length,
      final_chars: original.length,
    };
  }

  let next = (upstream as any[]).map((item) => {
    if (!item || typeof item !== "object") return item;
    if (item.kind === "stage_03" && item.json) {
      return {
        ...item,
        json: {
          ...(typeof item.json === "object" ? item.json : {}),
          preparation_excerpt: clip(String(item.json?.preparation_excerpt || ""), 3_000),
          evidence_drafts: Array.isArray(item.json?.evidence_drafts)
            ? item.json.evidence_drafts.slice(0, 12)
            : [],
          sources: Array.isArray(item.json?.sources) ? item.json.sources.slice(0, 16) : [],
          evidence_summaries: Array.isArray(item.json?.evidence_summaries)
            ? item.json.evidence_summaries.slice(0, 8)
            : [],
          evidence_compression: {
            ...(item.json?.evidence_compression || {}),
            upstream_soft_clipped: true,
          },
        },
      };
    }
    if (item.json && typeof item.json === "object") {
      const json = { ...item.json };
      for (const key of Object.keys(json)) {
        if (typeof json[key] === "string" && json[key].length > 4_000 && /markdown|yaml|excerpt/i.test(key)) {
          json[key] = clip(json[key], 4_000);
        }
      }
      return { ...item, json };
    }
    return item;
  });

  let serialized = JSON.stringify(next);
  // 仍超限：逐项再砍 Stage03 drafts
  if (serialized.length > budget) {
    next = next.map((item: any) => {
      if (item?.kind !== "stage_03" || !item.json) return item;
      return {
        ...item,
        json: {
          ...item.json,
          evidence_drafts: Array.isArray(item.json.evidence_drafts) ? item.json.evidence_drafts.slice(0, 6) : [],
          sources: Array.isArray(item.json.sources) ? item.json.sources.slice(0, 8) : [],
          preparation_excerpt: clip(String(item.json.preparation_excerpt || ""), 1_500),
        },
      };
    });
    serialized = JSON.stringify(next);
  }

  return {
    value: next as T,
    clipped: true,
    original_chars: original.length,
    final_chars: serialized.length,
  };
}

function contentDigest(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function emptyInjection(file: string, reason: string): KnowledgeFileInjection {
  return {
    file,
    included_chars: 0,
    truncated: false,
    omitted_reason: reason,
    content_hash: "",
    loaded: false,
  };
}

/** 按任务相关判断类型加载知识；超出预算则优先保留规范/短卡，再截断附录。 */
export function loadRoutedKnowledge(
  kind: StageKind,
  options: LoadKnowledgeOptions & { maxTotalChars?: number } = {},
) {
  const maxTotal = options.maxTotalChars ?? CONTEXT_SLOT_BUDGETS.knowledge;
  const loaded = loadKnowledge(kind, options);
  const entries = Array.isArray(loaded.entries)
    ? loaded.entries
    : loaded.files.map((file) => ({ file, content: "" }));
  const sourceVersion = loaded.source_version || loaded.version;

  const buildInjectionsWithinBudget = (
    maxChars: number,
  ): {
    context: string;
    files: string[];
    injections: KnowledgeFileInjection[];
    omittedByBudget: number;
  } => {
    const priorityBoost = (file: string): number => {
      if (/00A_runtime_quality_card|投研判断任务受理|判断结构与本体视图|数据与证据准备|推理输出规范|投研表达/.test(file)) {
        return 2.5;
      }
      if (/00A_高质量|A00_裁决总则|B0[0-4]_|OPS_MCP|附录[1-4]/.test(file)) return 1.8;
      if (/模板|README/.test(file)) return 1.0;
      return 1;
    };
    const weightSum = entries.reduce((sum, entry) => sum + priorityBoost(entry.file), 0);
    const parts: string[] = [];
    const includedFiles: string[] = [];
    const injections: KnowledgeFileInjection[] = [];
    let used = 0;
    let stoppedByBudget = false;

    for (const entry of entries) {
      const file = entry.file;
      const marker = `\n## ${file}\n`;
      // 直接使用按文件保存的正文，不能在拼接字符串里用 "\n## " 找下一个
      // 文件；规范正文自身也有 H2，旧实现会误把正文第一节当成文件边界，
      // 导致核心要求只剩导语、看似 loaded 实际未进 prompt。
      const body = entry.content;
      if (!body.trim()) {
        injections.push(emptyInjection(file, "empty_body"));
        continue;
      }
      if (stoppedByBudget || used >= maxChars) {
        injections.push(emptyInjection(file, "omitted_by_budget"));
        continue;
      }
      const OVERHEAD_PER_FILE = 100;
      const share = priorityBoost(file) / Math.max(weightSum, 1);
      const perFile = Math.max(4_000, Math.floor(maxChars * share) - OVERHEAD_PER_FILE);
      const remain = maxChars - used;
      if (remain < 2_000) {
        stoppedByBudget = true;
        injections.push(emptyInjection(file, "omitted_by_budget"));
        continue;
      }
      const allowBody = Math.min(perFile, Math.max(0, remain - marker.length - 19));
      const slice = prioritizeKnowledgeContent(body, allowBody);
      if (!slice.trim()) {
        injections.push(emptyInjection(file, "zero_body_after_budget"));
        continue;
      }
      const truncated = slice.length < body.length;
      const chunk = truncated
        ? `${marker}${slice}\n…[file truncated]`
        : `${marker}${slice}`;
      if (used + chunk.length > maxChars) {
        const tightAllow = Math.max(0, maxChars - used - marker.length - 19);
        if (tightAllow < 500) {
          stoppedByBudget = true;
          injections.push(emptyInjection(file, "omitted_by_budget"));
          continue;
        }
        const tightSlice = prioritizeKnowledgeContent(body, tightAllow);
        if (!tightSlice.trim()) {
          stoppedByBudget = true;
          injections.push(emptyInjection(file, "zero_body_after_budget"));
          continue;
        }
        parts.push(`${marker}${tightSlice}\n…[file truncated]`);
        includedFiles.push(file);
        injections.push({
          file,
          included_chars: tightSlice.length,
          truncated: true,
          omitted_reason: null,
          content_hash: contentDigest(tightSlice),
          loaded: true,
        });
        stoppedByBudget = true;
        used = maxChars;
        continue;
      }
      parts.push(chunk);
      includedFiles.push(file);
      injections.push({
        file,
        included_chars: slice.length,
        truncated,
        omitted_reason: null,
        content_hash: contentDigest(slice),
        loaded: true,
      });
      used += chunk.length;
    }

    for (const missing of loaded.missingFiles || []) {
      injections.push(emptyInjection(missing, "missing_file"));
    }

    return {
      context: parts.join("\n"),
      files: includedFiles,
      injections,
      omittedByBudget: injections.filter((item) => item.omitted_reason === "omitted_by_budget").length,
    };
  };

  // 统一走预算装配：即使总长未超限，也按文件记账，避免假 loaded。
  const routed = buildInjectionsWithinBudget(maxTotal);
  const trulyLoaded = routed.injections.filter((item) => item.loaded);
  const version = createHash("sha256").update(routed.context).digest("hex");
  return {
    version: `sha256:${version}`,
    source_version: sourceVersion,
    context: routed.context,
    files: trulyLoaded.map((item) => item.file),
    entries: loaded.entries,
    registeredFiles: loaded.files,
    missingFiles: loaded.missingFiles,
    file_injections: routed.injections,
    stats: {
      total: loaded.stats.total,
      loaded: trulyLoaded.length,
      missing: loaded.stats.missing,
      omitted_by_budget: routed.omittedByBudget,
    },
  };
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
    : {
      version: "none",
      source_version: "none",
      context: "",
      files: [] as string[],
      file_injections: [] as KnowledgeFileInjection[],
      missingFiles: [] as string[],
      stats: { total: 0, loaded: 0, missing: 0, omitted_by_budget: 0 },
    };

  const missingList = knowledge.missingFiles || [];
  const stats = knowledge.stats || {
    total: knowledge.files.length,
    loaded: knowledge.files.length,
    missing: 0,
    omitted_by_budget: 0,
  };
  const fileInjections = knowledge.file_injections || knowledge.files.map((file) => ({
    file,
    included_chars: 0,
    truncated: false,
    omitted_reason: null as string | null,
    content_hash: "",
    loaded: true,
  }));

  return {
    semantic_route: route,
    ontology_object_set,
    knowledge_files: knowledge.files,
    knowledge_context: knowledge.context,
    knowledge_version: knowledge.version,
    knowledge_source_version: knowledge.source_version || knowledge.version,
    budgets: CONTEXT_SLOT_BUDGETS,
    assembly_note: `上下文按语义路由装配：本体切片 + 任务相关知识文件 + 方法子集；未路由资产不进默认 knowledge。进入 prompt: ${stats.loaded}/${stats.total} 文件（缺失 ${stats.missing || 0}，预算省略 ${stats.omitted_by_budget || 0}）。loaded 仅计实际有正文进入 prompt 的文件。`,
    file_injections: fileInjections,
    standards_loading: {
      files_total: stats.total,
      files_loaded: stats.loaded,
      files_missing: stats.missing || 0,
      files_omitted_by_budget: stats.omitted_by_budget || 0,
      missing_list: missingList,
    },
  };
}
