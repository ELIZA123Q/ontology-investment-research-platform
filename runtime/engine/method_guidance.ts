import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import YAML from "yaml";
import { repositoryPath, repositoryRoot } from "../adapters/repo-paths";
import {
  defaultMethodIdsForJudgmentType,
  inferJudgmentTypesFromTask,
  loadMethodRegistry,
  methodRoutesForPrompt,
  type RegisteredMethod,
} from "./method_registry";
import type { MethodCapabilityType } from "./types";

export type FrameworkGateCard = {
  requires: string[];
  minimum_evidence: string[];
};

export type MethodPromptCard = RegisteredMethod & {
  output_gates?: Record<string, FrameworkGateCard>;
  downstream_unlocks?: string[];
  boundary_handoffs?: Record<string, string>;
  quality_gates?: string[] | Array<{ id: string; requires: string[] }>;
  required_roles?: string[];
  use_when?: string | string[];
  auto_add_when?: unknown;
  forbidden_without?: unknown;
  follow_on_methods?: unknown;
  judgment_type_rows?: Array<{
    judgment_type: string;
    method: string;
    required_roles: string[];
    optional_roles: string[];
    max_completeness_without_direct_data?: string;
    auto_add?: string[];
    requires_methods?: string[];
  }>;
};

export type MethodGuidanceExcerpt = {
  method_id: string;
  file: string;
  excerpt: string;
  truncated: boolean;
  excerpt_mode: "full" | "sections";
};

export type ThresholdCapsProjection = {
  formal_rule_ref: string;
  evidence_grade_caps: Record<string, string>;
  counterevidence_caps: Record<string, string>;
  path_readiness_caps: Record<string, string>;
  level_outputs: Record<string, {
    evidence_permission: string;
    allowed_04_output: string;
    allowed_expression: string;
  }>;
  evidence_method_role_to_basket_role: Record<string, string>;
  invariants: string[];
};

const BODY_PER_METHOD_CHARS = 8_000;
const BODY_TOTAL_CHARS = 48_000;
const STAGE02_MAX_PER_CAPABILITY = 4;

const SECTION_PRIORITY_PATTERN = /停止|边界|不适用|最少必须|output_gate|判断原则|gate|不适用时|何时停止|完备度/;

function parseYaml(path: string) {
  return YAML.parse(readFileSync(repositoryPath(path), "utf8")) as any;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

let frameworkMarkdownCache: Map<string, string> | null = null;

function listMarkdownFiles(dirAbs: string): string[] {
  if (!existsSync(dirAbs)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dirAbs, { withFileTypes: true })) {
    const abs = join(dirAbs, entry.name);
    if (entry.isDirectory()) out.push(...listMarkdownFiles(abs));
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(abs);
  }
  return out;
}

/** Map BF-/IF- ids to framework markdown paths under methods/02_判断结构. */
export function frameworkMarkdownIndex(): Map<string, string> {
  if (frameworkMarkdownCache) return frameworkMarkdownCache;
  const roots = [
    "methods/02_判断结构/基础框架库",
    "methods/02_判断结构/行业框架库",
  ];
  const index = new Map<string, string>();
  for (const root of roots) {
    const absRoot = repositoryPath(root);
    for (const abs of listMarkdownFiles(absRoot)) {
      const content = readFileSync(abs, "utf8");
      const match = content.match(/^framework_id:\s*([A-Z0-9-]+)\s*$/m)
        || content.match(/^framework_id:\s*["']?([A-Z0-9-]+)["']?\s*$/m);
      if (!match) continue;
      index.set(match[1], relative(repositoryRoot, abs));
    }
  }
  frameworkMarkdownCache = index;
  return index;
}

function resolveMethodBodyFile(method: RegisteredMethod): string | null {
  if (method.file && method.file.endsWith(".md") && existsSync(repositoryPath(method.file))) {
    return method.file;
  }
  if (method.capability_type === "judgment_structure") {
    return frameworkMarkdownIndex().get(method.method_id) || null;
  }
  return null;
}

function projectQualityGates(raw: Record<string, any> | undefined) {
  const gates = raw || {};
  const entries = Object.entries(gates);
  if (!entries.length) return [];
  if (entries.some(([, value]) => value && typeof value === "object" && ("requires" in (value as object)))) {
    return entries.map(([id, value]) => ({
      id,
      requires: [...((value as any)?.requires || [])].map(String),
    }));
  }
  return entries.map(([id]) => id);
}

export function enrichPromptMethodCards(
  methods: RegisteredMethod[],
  judgmentTypes: string[] = [],
): MethodPromptCard[] {
  const frameworkRegistry = parseYaml("methods/02_判断结构/00_framework_dependency_registry.yaml");
  const evidenceRegistry = parseYaml("methods/03_取证/03_registry.yaml");
  const frameworks = {
    ...(frameworkRegistry.frameworks || {}),
    ...(frameworkRegistry.industry_overlays || {}),
  } as Record<string, any>;
  const typeRows = evidenceRegistry.judgment_types || {};
  const wantedTypes = judgmentTypes.length
    ? judgmentTypes
    : Object.keys(typeRows);

  return methods.map((method) => {
    if (method.capability_type === "judgment_structure") {
      const raw = frameworks[method.method_id] || {};
      const outputGates: Record<string, FrameworkGateCard> = {};
      for (const [gateId, gate] of Object.entries<any>(raw.output_gates || {})) {
        outputGates[gateId] = {
          requires: [...(gate?.requires || [])].map(String),
          minimum_evidence: [...(gate?.minimum_evidence || [])].map(String),
        };
      }
      return {
        ...method,
        file: resolveMethodBodyFile(method) || method.file,
        output_gates: outputGates,
        downstream_unlocks: [...(raw.downstream_unlocks || [])].map(String),
        boundary_handoffs: Object.fromEntries(
          Object.entries(raw.boundary_handoffs || {}).map(([k, v]) => [String(k), String(v)]),
        ),
        quality_gates: projectQualityGates(raw.quality_gates),
      };
    }

    if (method.capability_type === "evidence") {
      const localId = method.method_id.replace(/^kb03:/, "");
      const raw = evidenceRegistry.methods?.[localId] || {};
      const relatedTypes = wantedTypes
        .filter((type) => {
          const row = typeRows[type];
          if (!row) return false;
          const methodLocal = localId;
          return String(row.method) === methodLocal
            || String(row.method) === `A${methodLocal.replace(/^A/, "")}`
            || (row.requires_methods || []).includes(methodLocal)
            || (row.auto_add || []).includes(methodLocal);
        })
        .map((judgment_type) => {
          const row = typeRows[judgment_type] || {};
          return {
            judgment_type,
            method: String(row.method || ""),
            required_roles: [...(row.required_roles || [])].map(String),
            optional_roles: [...(row.optional_roles || [])].map(String),
            max_completeness_without_direct_data: row.max_completeness_without_direct_data
              ? String(row.max_completeness_without_direct_data)
              : undefined,
            auto_add: [...(row.auto_add || [])].map(String),
            requires_methods: [...(row.requires_methods || [])].map(String),
          };
        });
      return {
        ...method,
        required_roles: [...(raw.required_roles || [])].map(String),
        use_when: raw.use_when || method.applicability,
        auto_add_when: raw.auto_add_when || null,
        forbidden_without: raw.forbidden_without || null,
        follow_on_methods: raw.follow_on_methods || null,
        judgment_type_rows: relatedTypes,
      };
    }

    return { ...method };
  });
}

function emptyCapabilityBuckets(): Record<MethodCapabilityType, string[]> {
  return { judgment_structure: [], evidence: [], adjudication: [] };
}

function pushUnique(
  bucket: string[],
  methodId: string,
  maxPer: number,
  available: Set<string>,
) {
  if (bucket.length >= maxPer) return;
  if (!available.has(methodId)) return;
  if (bucket.includes(methodId)) return;
  bucket.push(methodId);
}

/** Stage02: put route defaults first, then allowed, within each capability cap. */
export function prioritizeMethodIdsForStage02(
  taskText: string,
  candidates: RegisteredMethod[],
  options: { maxPerCapability?: number } = {},
): string[] {
  const maxPer = options.maxPerCapability ?? STAGE02_MAX_PER_CAPABILITY;
  const available = new Set(candidates.map((item) => item.method_id));
  const byId = new Map(candidates.map((item) => [item.method_id, item]));
  const buckets = emptyCapabilityBuckets();
  const types = inferJudgmentTypesFromTask(taskText);
  const routes = methodRoutesForPrompt();

  for (const judgmentType of types) {
    try {
      const defaults = defaultMethodIdsForJudgmentType(judgmentType);
      pushUnique(buckets.judgment_structure, defaults.judgment_structure, maxPer, available);
      pushUnique(buckets.evidence, defaults.evidence, maxPer, available);
      pushUnique(buckets.adjudication, defaults.adjudication, maxPer, available);
    } catch {
      // judgment type without defaults — skip
    }
    const route = routes.routes[judgmentType];
    if (!route) continue;
    for (const id of route.allowed_kb03_methods || []) {
      pushUnique(buckets.evidence, String(id), maxPer, available);
    }
    for (const id of [
      ...(route.allowed_kb04_methods || []),
      ...(route.optional_auxiliary_methods || []),
    ]) {
      pushUnique(buckets.adjudication, String(id), maxPer, available);
    }
  }

  for (const method of candidates) {
    pushUnique(buckets[method.capability_type], method.method_id, maxPer, available);
  }

  // Drop ids that somehow lack capability mapping
  return [
    ...buckets.judgment_structure,
    ...buckets.evidence,
    ...buckets.adjudication,
  ].filter((id) => byId.has(id));
}

export function selectMethodIdsForGuidance(
  methods: RegisteredMethod[],
  options: {
    maxPerCapability?: number;
    capabilities?: MethodCapabilityType[];
    prioritizeIds?: string[];
  } = {},
): string[] {
  const maxPer = options.maxPerCapability ?? Number.POSITIVE_INFINITY;
  const allowed = new Set(options.capabilities || ["judgment_structure", "evidence", "adjudication"]);
  const byCapability = emptyCapabilityBuckets();
  const available = new Set(methods.map((item) => item.method_id));
  const byId = new Map(methods.map((item) => [item.method_id, item]));

  for (const methodId of options.prioritizeIds || []) {
    const method = byId.get(methodId);
    if (!method || !allowed.has(method.capability_type)) continue;
    pushUnique(byCapability[method.capability_type], methodId, maxPer, available);
  }

  for (const method of methods) {
    if (!allowed.has(method.capability_type)) continue;
    pushUnique(byCapability[method.capability_type], method.method_id, maxPer, available);
  }

  return [
    ...byCapability.judgment_structure,
    ...byCapability.evidence,
    ...byCapability.adjudication,
  ];
}

type MarkdownSection = { title: string; body: string; priority: number };

function splitMarkdownSections(content: string): MarkdownSection[] {
  const lines = content.split("\n");
  const sections: MarkdownSection[] = [];
  let currentTitle = "";
  let currentLines: string[] = [];
  const flush = () => {
    const body = currentLines.join("\n").trim();
    if (!currentTitle && !body) return;
    const title = currentTitle || "(lead)";
    const priority = !currentTitle
      ? 0
      : SECTION_PRIORITY_PATTERN.test(title)
        ? 1
        : 2;
    sections.push({ title, body: currentTitle ? `## ${currentTitle}\n${body}` : body, priority });
  };
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+)\s*$/);
    if (heading) {
      flush();
      currentTitle = heading[1].trim();
      currentLines = [];
      continue;
    }
    currentLines.push(line);
  }
  flush();
  return sections;
}

/** Prefer full text; for long docs keep lead + stop/boundary sections first. */
export function excerptMethodBody(
  content: string,
  limit: number,
): { excerpt: string; truncated: boolean; excerpt_mode: "full" | "sections" } {
  if (content.length <= limit) {
    return { excerpt: content, truncated: false, excerpt_mode: "full" };
  }
  const sections = splitMarkdownSections(content);
  const ordered = [
    ...sections.filter((item) => item.priority === 0),
    ...sections.filter((item) => item.priority === 1),
    ...sections.filter((item) => item.priority === 2),
  ];
  const parts: string[] = [];
  let used = 0;
  for (const section of ordered) {
    if (used >= limit) break;
    const remaining = limit - used;
    const chunk = section.body.length <= remaining
      ? section.body
      : `${section.body.slice(0, Math.max(0, remaining - 1))}…`;
    if (!chunk) continue;
    parts.push(chunk);
    used += chunk.length + (parts.length > 1 ? 2 : 0);
  }
  const excerpt = parts.join("\n\n");
  return {
    excerpt: excerpt || content.slice(0, limit),
    truncated: true,
    excerpt_mode: "sections",
  };
}

export function loadSelectedMethodGuidance(
  methodIds: string[],
  options: { perMethodChars?: number; totalChars?: number } = {},
): MethodGuidanceExcerpt[] {
  const perMethodChars = options.perMethodChars ?? BODY_PER_METHOD_CHARS;
  const totalChars = options.totalChars ?? BODY_TOTAL_CHARS;
  const registry = loadMethodRegistry();
  const out: MethodGuidanceExcerpt[] = [];
  let used = 0;
  for (const methodId of unique(methodIds)) {
    if (used >= totalChars) break;
    const method = registry.get(methodId);
    if (!method) continue;
    const file = resolveMethodBodyFile(method);
    if (!file) continue;
    const content = readFileSync(repositoryPath(file), "utf8");
    const remaining = totalChars - used;
    const limit = Math.min(perMethodChars, remaining);
    const { excerpt, truncated, excerpt_mode } = excerptMethodBody(content, limit);
    out.push({
      method_id: methodId,
      file,
      excerpt,
      truncated,
      excerpt_mode,
    });
    used += excerpt.length;
  }
  return out;
}

export function judgmentThresholdCapsForPrompt(): ThresholdCapsProjection {
  const policy = parseYaml("governance/02_合同/judgment_threshold_policy.yaml");
  return {
    formal_rule_ref: String(policy.formal_rule_ref || ""),
    evidence_grade_caps: { ...(policy.evidence_grade_caps || {}) },
    counterevidence_caps: { ...(policy.counterevidence_caps || {}) },
    path_readiness_caps: { ...(policy.path_readiness_caps || {}) },
    level_outputs: { ...(policy.level_outputs || {}) },
    evidence_method_role_to_basket_role: { ...(policy.evidence_method_role_to_basket_role || {}) },
    invariants: [...(policy.invariants || [])].map(String),
  };
}

export function evidenceJudgmentTypeCardsForPrompt(judgmentTypes: string[]) {
  const registry = parseYaml("methods/03_取证/03_registry.yaml");
  const rows = registry.judgment_types || {};
  const types = judgmentTypes.length ? judgmentTypes : Object.keys(rows);
  return Object.fromEntries(
    types
      .filter((type) => rows[type])
      .map((type) => [type, {
        method: `kb03:${rows[type].method}`,
        required_roles: [...(rows[type].required_roles || [])].map(String),
        optional_roles: [...(rows[type].optional_roles || [])].map(String),
        max_completeness_without_direct_data: rows[type].max_completeness_without_direct_data || null,
        auto_add: [...(rows[type].auto_add || [])].map((id: string) => `kb03:${id}`),
        requires_methods: [...(rows[type].requires_methods || [])].map((id: string) => `kb03:${id}`),
        formal_a08: Boolean(rows[type].formal_a08),
      }]),
  );
}

/** Short MCP channel hints for Stage03 — not a substitute for OPS manuals. */
export function mcpChannelHintsForPrompt() {
  return [
    { tool: "query_cninfo", channel: "cninfo", use_for: "A股公告/定期报告/问询函原文" },
    { tool: "query_datayes_finoper", channel: "datayes-stock-finoper-mcp", use_for: "利润表/资产负债表/现金流量表" },
    { tool: "query_datayes_stock", channel: "datayes-stock-mkt/info/eqhld/event", use_for: "行情/公司信息/持仓/事件" },
    { tool: "query_macro_data", channel: "datayes-macro-mcp", use_for: "宏观指标" },
    { tool: "query_market_index", channel: "datayes-index-*", use_for: "指数行情与成分" },
    { tool: "query_fund_data", channel: "datayes-fund-*", use_for: "基金档案/业绩/持仓" },
    { tool: "query_china_policy", channel: "china-policy", use_for: "中央政策原文" },
    { tool: "query_research_reports", channel: "htsc_research_mcp", use_for: "研报观点（须交叉核验）" },
    { tool: "query_caixin_news", channel: "caixin-news", use_for: "财经新闻线索" },
    { tool: "fetch_public_pages", channel: "jina-reader/http", use_for: "URL 正文核验" },
    { tool: "search_public_web", channel: "bing", use_for: "补充线索，不得充当一手事实" },
  ];
}

export function executedMethodsSummary(applications: Array<{
  application_id?: string;
  method_id?: string;
  method_version?: string;
  capability_type?: string;
  status?: string;
  limitations?: string[];
  applicability_boundary?: string;
}>) {
  return applications.map((item) => ({
    application_id: item.application_id || null,
    method_id: item.method_id || null,
    method_version: item.method_version || null,
    capability_type: item.capability_type || null,
    status: item.status || null,
    limitations: [...(item.limitations || [])].map(String).slice(0, 8),
    applicability_boundary: item.applicability_boundary || null,
  }));
}

export function guidanceMethodIdsForStage(
  kind: string,
  candidates: RegisteredMethod[],
  taskText = "",
): string[] {
  if (kind === "stage_02") {
    return prioritizeMethodIdsForStage02(taskText, candidates, {
      maxPerCapability: STAGE02_MAX_PER_CAPABILITY,
    });
  }
  if (kind === "stage_03") {
    return selectMethodIdsForGuidance(candidates, {
      capabilities: ["evidence"],
    });
  }
  if (kind === "stage_04") {
    const ids = selectMethodIdsForGuidance(candidates, {
      capabilities: ["adjudication"],
    });
    if (!ids.includes("kb04:A00") && candidates.some((item) => item.method_id === "kb04:A00")) {
      return ["kb04:A00", ...ids];
    }
    if (!ids.includes("kb04:A00")) {
      const registry = loadMethodRegistry();
      if (registry.has("kb04:A00")) return ["kb04:A00", ...ids];
    }
    return ids;
  }
  return [];
}

export function buildStageGenerationGuidance(input: {
  kind: string;
  candidates: RegisteredMethod[];
  taskText?: string;
  perMethodChars?: number;
  totalChars?: number;
}) {
  const methodIds = guidanceMethodIdsForStage(
    input.kind,
    input.candidates,
    input.taskText || "",
  );
  return {
    method_ids: methodIds,
    selected_method_guidance: loadSelectedMethodGuidance(methodIds, {
      perMethodChars: input.perMethodChars,
      totalChars: input.totalChars,
    }),
  };
}

/** Collect kb03 method ids from MethodApplication rows for Stage03 supplement. */
export function evidenceMethodIdsFromApplications(
  applications: Array<{ method_id?: string; capability_type?: string }>,
): string[] {
  return unique(
    applications
      .filter((item) => item.capability_type === "evidence" || String(item.method_id || "").startsWith("kb03:"))
      .map((item) => String(item.method_id || ""))
      .filter(Boolean),
  );
}
