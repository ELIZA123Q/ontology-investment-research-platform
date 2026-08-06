import { readFileSync } from "node:fs";
import YAML from "yaml";
import { repositoryPath } from "../../storage/repo_paths";
import { loadOntologyCatalog } from "./catalog_loader";

/** 判断类型中文：与 judgment.yaml allowed_values 及 methods/02_判断结构/README §3.1 对齐。 */
const JUDGMENT_TYPE_LABELS: Record<string, string> = {
  state_measurement: "状态测量",
  trend_direction: "趋势方向",
  cycle_phase: "周期阶段",
  mechanism_validation: "机制验证",
  causal_attribution: "因果归因",
  transmission_path: "传导路径",
  object_differentiation: "对象分化",
  impact_realization: "影响兑现",
  expectation_gap: "预期差",
  valuation_impact: "估值影响",
};

/** 研究问题失败路由：与 schemas.ts questions.failure_route 对齐。 */
const FAILURE_ROUTE_LABELS: Record<string, string> = {
  stop: "停止",
  downgrade: "降级",
  competing_explanation: "转向竞争解释",
  return_to_structure: "回退结构",
};

/** 证据角色：与 evidence.yaml EvidenceRequirement.evidence_role 对齐。 */
const EVIDENCE_ROLE_LABELS: Record<string, string> = {
  support: "支持",
  counter: "反证",
  context: "背景",
  boundary: "边界",
};

/** 运行状态：与 ResearchRun.status 对齐。 */
const RUN_STATUS_LABELS: Record<string, string> = {
  active: "进行中",
  completed: "已完成",
  archived: "已归档",
  blocked: "受阻",
};

/** 变量类型：stage_02 variables.variable_kind 常见值。 */
const VARIABLE_KIND_LABELS: Record<string, string> = {
  observed: "观测型",
  observed_or_adjudicated: "观测或裁决型",
  qualitative_or_derived: "定性或派生型",
  quantitative: "定量型",
};

/** 变量角色：领域 StateVariable.variable_role 常见值。 */
const VARIABLE_ROLE_LABELS: Record<string, string> = {
  primary: "主变量",
  primary_judgment_variable: "主判断变量",
  intermediate_variable: "中间变量",
  market_variable: "市场变量",
  support: "支撑变量",
  target: "目标变量",
};

/** 变量类别：半导体领域常见 category 代码。 */
const VARIABLE_CATEGORY_LABELS: Record<string, string> = {
  company: "公司",
  cost: "成本",
  demand: "需求",
  economics: "经济",
  expectation: "预期",
  financial: "财务",
  inventory_cycle: "库存周期",
  market: "市场",
  operations: "运营",
  pricing: "定价",
  supply: "供给",
};

/** 研究范围维度键：public_contract.yaml scope_graph.dimensions。 */
const SCOPE_DIMENSION_LABELS: Record<string, string> = {
  object: "对象",
  objects: "研究对象",
  geography: "地区",
  customer: "客户",
  metric: "指标",
  indicators: "关键指标",
  time: "时间",
  period: "统计期间",
  currency: "币种",
  as_of: "截止时点",
  scope: "口径范围",
};

/** 锚点常见观测 token（非正式对象类型时）。 */
const ANCHOR_TOKEN_LABELS: Record<string, string> = {
  contract_price: "合同价",
  inventory_days: "库存天数",
  depreciation: "折旧",
  inventory: "库存",
  price: "价格",
};

let cachedFormalStateVariableNames: Map<string, string> | undefined;
let cachedOntologyTypeLabels: Map<string, string> | undefined;

function businessInstanceObjects(doc: unknown): Array<{ id?: string; type?: string; properties?: Record<string, unknown> }> {
  if (!doc || typeof doc !== "object") return [];
  const root = doc as Record<string, unknown>;
  const graph = root.schema_name === "ontology_business_instance_graph" && Array.isArray(root.objects)
    ? root
    : root.business_instance_graph;
  if (!graph || typeof graph !== "object" || !Array.isArray((graph as Record<string, unknown>).objects)) return [];
  return (graph as { objects: Array<{ id?: string; type?: string; properties?: Record<string, unknown> }> }).objects;
}

function labelFromRecord(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const metadata = (raw as Record<string, unknown>).metadata;
  if (metadata && typeof metadata === "object") {
    const label = String((metadata as Record<string, unknown>).label_zh || "").trim();
    if (label) return label;
  }
  return String((raw as Record<string, unknown>).name || "").trim();
}

function loadOntologyTypeLabels(): Map<string, string> {
  if (cachedOntologyTypeLabels) return cachedOntologyTypeLabels;
  cachedOntologyTypeLabels = new Map();
  try {
    const catalog = loadOntologyCatalog();
    for (const definitions of [catalog.object_types, catalog.relation_types, catalog.scenario_types]) {
      for (const [id, raw] of definitions) {
        const label = labelFromRecord(raw);
        if (label) cachedOntologyTypeLabels.set(id, label);
      }
    }
  } catch {
    // 缺文件时跳过
  }
  return cachedOntologyTypeLabels;
}

function lookupLabel(value: string, table: Record<string, string>): string {
  const key = value.trim();
  return table[key] || key;
}

/** 正式领域 StateVariable：英文 id → 中文 name（来自 business_instances.yaml）。 */
export function formalStateVariableDisplayNames(): Map<string, string> {
  if (cachedFormalStateVariableNames) return cachedFormalStateVariableNames;
  cachedFormalStateVariableNames = new Map();
  try {
    const file = repositoryPath("ontology", "02_领域", "semiconductor", "business_instances.yaml");
    const doc = YAML.parse(readFileSync(file, "utf8")) || {};
    for (const object of businessInstanceObjects(doc)) {
      if (object?.type !== "StateVariable") continue;
      const id = String(object.id || object.properties?.id || "").trim();
      const name = String(object.properties?.name || "").trim();
      if (id && name) cachedFormalStateVariableNames.set(id, name);
    }
  } catch {
    // 测试或离线环境缺文件时降级为仅显示原始 id
  }
  return cachedFormalStateVariableNames;
}

export type StructureDisplayLookups = {
  ontologyNames: Map<string, string>;
  unitTitles: Map<string, string>;
  scopeLabels: Map<string, string>;
};

export function buildStructureDisplayLookups(input: {
  variables?: Array<{ id: string; name: string; ontology_node_id?: string }>;
  units?: Array<{ id: string; title: string }>;
  research_scope?: unknown;
}): StructureDisplayLookups {
  const ontologyNames = buildVariableNameLookup(input.variables || []);
  const unitTitles = new Map((input.units || []).map((unit) => [unit.id, unit.title]));
  const scopeLabels = new Map<string, string>();
  if (input.research_scope && typeof input.research_scope === "object") {
    const scope = input.research_scope as Record<string, unknown>;
    const id = String(scope.id || "").trim();
    const label = String(scope.label || "").trim();
    if (id && label) scopeLabels.set(id, label);
  }
  return { ontologyNames, unitTitles, scopeLabels };
}

export function buildVariableNameLookup(
  variables: Array<{ id: string; name: string; ontology_node_id?: string }>,
): Map<string, string> {
  const lookup = new Map(formalStateVariableDisplayNames());
  for (const variable of variables) {
    lookup.set(variable.id, variable.name);
    if (variable.ontology_node_id) lookup.set(variable.ontology_node_id, variable.name);
  }
  return lookup;
}

export function judgmentTypeLabel(type: string): string {
  return lookupLabel(type, JUDGMENT_TYPE_LABELS);
}

export function failureRouteLabel(route: string): string {
  return lookupLabel(route, FAILURE_ROUTE_LABELS);
}

export function evidenceRoleLabel(role: string): string {
  return lookupLabel(role, EVIDENCE_ROLE_LABELS);
}

export function runStatusLabel(status: string): string {
  return lookupLabel(status, RUN_STATUS_LABELS);
}

export function variableKindLabel(kind: string): string {
  return lookupLabel(kind, VARIABLE_KIND_LABELS);
}

export function variableRoleLabel(role: string): string {
  return lookupLabel(role, VARIABLE_ROLE_LABELS);
}

export function variableCategoryLabel(category: string): string {
  return lookupLabel(category, VARIABLE_CATEGORY_LABELS);
}

export function scopeDimensionKeyLabel(key: string): string {
  return lookupLabel(key, SCOPE_DIMENSION_LABELS);
}

export function ontologyTypeLabel(typeOrAnchor: string): string {
  const key = typeOrAnchor.trim();
  return loadOntologyTypeLabels().get(key)
    || ANCHOR_TOKEN_LABELS[key]
    || key;
}

export function anchorLabels(anchors: string[]): string[] {
  return anchors.map((anchor) => ontologyTypeLabel(anchor));
}

export function resolveOntologyDisplayLabel(id: string, lookup: Map<string, string>): string {
  if (lookup.has(id)) return lookup.get(id)!;
  if (id.startsWith("task_local:")) {
    const localId = id.slice("task_local:".length);
    if (lookup.has(localId)) return lookup.get(localId)!;
  }
  return formalStateVariableDisplayNames().get(id) || id;
}

export function resolveOntologyDisplayLabels(ids: string[], lookup: Map<string, string>): string[] {
  return ids.map((id) => resolveOntologyDisplayLabel(id, lookup));
}

export function unitDisplayLabel(id: string, unitTitles: Map<string, string>): string {
  return unitTitles.get(id) || id;
}

export function unitDisplayLabels(ids: string[], unitTitles: Map<string, string>): string[] {
  return ids.map((id) => unitDisplayLabel(id, unitTitles));
}

export function scopeDisplayLabel(ref: string, scopeLabels: Map<string, string>): string {
  return scopeLabels.get(ref) || ref;
}

export type ConceptSource = "formal" | "task_local" | "round_variable";

type ConceptRef = { key: string; label: string; source: ConceptSource };

export function conceptSourceLabel(source: ConceptSource): string {
  return {
    formal: "正式本体",
    task_local: "本轮新建（待入库）",
    round_variable: "本轮变量",
  }[source];
}

function resolveConceptRef(
  id: string,
  variables: Array<{ id: string; name: string; ontology_node_id?: string }>,
  formalNames: Map<string, string>,
): ConceptRef {
  const trimmed = id.trim();
  if (!trimmed) return { key: "", label: "", source: "round_variable" };

  if (trimmed.startsWith("task_local:")) {
    const localId = trimmed.slice("task_local:".length);
    const variable = variables.find((item) => item.id === localId || item.ontology_node_id === trimmed);
    return {
      key: trimmed,
      label: variable?.name || localId,
      source: "task_local",
    };
  }

  if (formalNames.has(trimmed)) {
    return { key: trimmed, label: formalNames.get(trimmed)!, source: "formal" };
  }

  const variable = variables.find((item) => item.id === trimmed || item.ontology_node_id === trimmed);
  if (variable) {
    const binding = String(variable.ontology_node_id || "").trim();
    if (binding.startsWith("task_local:")) {
      return { key: binding, label: variable.name, source: "task_local" };
    }
    if (binding && formalNames.has(binding)) {
      return { key: binding, label: formalNames.get(binding)!, source: "formal" };
    }
    return { key: variable.id, label: variable.name, source: "round_variable" };
  }

  return { key: trimmed, label: trimmed, source: "round_variable" };
}

export function formatConceptLine(ref: ConceptRef): string {
  return `${ref.label} · ${conceptSourceLabel(ref.source)}`;
}

/** 判断单元侧栏：合并 ontology 挂接与本 round 变量，去重后带出来源。 */
export function buildJudgmentUnitConcepts(
  unit: { ontology_node_ids: string[] },
  linkedVariableIds: string[],
  variables: Array<{ id: string; name: string; ontology_node_id?: string }>,
): string[] {
  const formalNames = formalStateVariableDisplayNames();
  const seen = new Set<string>();
  const lines: string[] = [];

  const add = (id: string) => {
    const ref = resolveConceptRef(id, variables, formalNames);
    if (!ref.key || seen.has(ref.key)) return;
    seen.add(ref.key);
    lines.push(formatConceptLine(ref));
  };

  for (const id of unit.ontology_node_ids) add(id);
  for (const id of linkedVariableIds) add(id);

  return lines;
}

/** 状态变量节点：概念挂靠一行说明。 */
export function formatVariableConceptBinding(
  variable: { id: string; name: string; ontology_node_id?: string },
  variables: Array<{ id: string; name: string; ontology_node_id?: string }>,
): string {
  const binding = String(variable.ontology_node_id || "").trim();
  if (!binding) return "—";
  const ref = resolveConceptRef(binding, variables, formalStateVariableDisplayNames());
  if (ref.source === "task_local") {
    return formatConceptLine({ key: ref.key, label: variable.name, source: "task_local" });
  }
  if (ref.source === "formal") {
    return formatConceptLine(ref);
  }
  return formatConceptLine({ key: variable.id, label: variable.name, source: "round_variable" });
}

/** 测试用：清缓存以便重复加载 YAML。 */
export function resetOntologyDisplayLabelCaches(): void {
  cachedFormalStateVariableNames = undefined;
  cachedOntologyTypeLabels = undefined;
}
