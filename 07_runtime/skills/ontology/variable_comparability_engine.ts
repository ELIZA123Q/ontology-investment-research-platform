import { createHash } from "node:crypto";

export const VARIABLE_COMPARABILITY_KEY_VERSION = "variable-comparability-v1";

export type VariableObservation = {
  observation_id: string;
  run_id: string;
  question: string;
  artifact_id: string;
  artifact_version: number;
  variable_id: string;
  name: string;
  ontology_node_id: string;
  category: string;
  variable_kind: string;
  anchors: string[];
  object_scope: unknown;
  geography: unknown;
  metric_ref: unknown;
  unit: unknown;
  time_basis: unknown;
  observation_period: unknown;
  created_at: string;
};

export type VariableComparabilityStatus = "aligned" | "blocked" | "insufficient";

export type VariableComparison = {
  left_observation_id: string;
  right_observation_id: string;
  status: VariableComparabilityStatus;
  comparable_key: string | null;
  reasons: string[];
  matched_dimensions: string[];
};

function canonical(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (Array.isArray(value)) return [...new Set(value.map(canonical).filter(Boolean))].sort().join("|");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${canonical(key)}=${canonical(item)}`)
      .join("|");
  }
  return String(value).normalize("NFKC").trim().toLocaleLowerCase("zh-CN").replace(/\s+/g, " ");
}

function firstDefined(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function nestedRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function display(value: unknown): string {
  if (Array.isArray(value)) return value.map(display).join("、");
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value ?? "");
}

function stableComparableKey(dimensions: Array<[string, unknown, unknown]>): string {
  const material = dimensions.map(([label, leftValue]) => `${label}:${canonical(leftValue)}`).join("||");
  return `cmp:v1:${createHash("sha256").update(material).digest("hex").slice(0, 24)}`;
}

export function extractVariableObservations(rows: Array<{
  run_id: string;
  question: string;
  artifact_id: string;
  artifact_version: number;
  json_content: string;
  created_at: string;
}>): VariableObservation[] {
  const observations: VariableObservation[] = [];
  for (const row of rows) {
    let data: any = {};
    try { data = JSON.parse(row.json_content || "{}"); } catch { data = {}; }
    const dimensions = data.research_scope?.dimensions && typeof data.research_scope.dimensions === "object"
      ? data.research_scope.dimensions as Record<string, unknown>
      : {};
    const timeScope = nestedRecord(dimensions.time_scope);
    for (const variable of Array.isArray(data.variables) ? data.variables : []) {
      const ontologyNodeId = String(variable?.ontology_node_id || "").trim();
      if (!ontologyNodeId || ontologyNodeId.startsWith("task_local:")) continue;
      const variableId = String(variable?.id || "").trim();
      observations.push({
        observation_id: `${row.run_id}:${variableId}`,
        run_id: row.run_id,
        question: row.question,
        artifact_id: row.artifact_id,
        artifact_version: Number(row.artifact_version),
        variable_id: variableId,
        name: String(variable?.name || variableId),
        ontology_node_id: ontologyNodeId,
        category: String(variable?.category || ""),
        variable_kind: String(variable?.variable_kind || ""),
        anchors: Array.isArray(variable?.anchors) ? variable.anchors.map(String) : [],
        object_scope: variable?.object_scope ?? firstDefined(dimensions, ["object_scope", "core_object", "object", "objects", "product", "products", "scope"]),
        geography: variable?.geography ?? firstDefined(dimensions, ["geography", "region", "regions"]),
        metric_ref: variable?.metric_ref ?? firstDefined(dimensions, ["metric", "metrics", "indicator", "indicators"]),
        unit: variable?.unit ?? firstDefined(dimensions, ["unit", "currency"]),
        time_basis: variable?.time_basis
          ?? firstDefined(dimensions, ["time_basis", "frequency", "periodicity"])
          ?? firstDefined(timeScope, ["time_basis", "frequency", "periodicity"]),
        observation_period: variable?.observation_period
          ?? firstDefined(dimensions, ["observation_period", "time", "period", "as_of", "time_as_of", "time_forward", "time_lookback"])
          ?? firstDefined(timeScope, ["as_of", "period", "forward", "lookback"]),
        created_at: row.created_at,
      });
    }
  }
  return observations;
}

export function compareVariableObservations(
  left: VariableObservation,
  right: VariableObservation,
): VariableComparison {
  const reasons: string[] = [];
  const matched: string[] = [];
  const missing: string[] = [];
  const mismatched: string[] = [];
  const dimensions: Array<[string, unknown, unknown]> = [
    ["正式语义对象", left.ontology_node_id, right.ontology_node_id],
    ["变量类别", left.category, right.category],
    ["变量类型", left.variable_kind, right.variable_kind],
    ["对象锚点", left.anchors, right.anchors],
    ["对象/产品范围", left.object_scope, right.object_scope],
    ["地区范围", left.geography, right.geography],
    ["指标口径", left.metric_ref, right.metric_ref],
    ["单位/币种", left.unit, right.unit],
    ["时间基准", left.time_basis, right.time_basis],
  ];
  for (const [label, leftValue, rightValue] of dimensions) {
    const leftCanonical = canonical(leftValue);
    const rightCanonical = canonical(rightValue);
    if (!leftCanonical || !rightCanonical) {
      missing.push(label);
    } else if (leftCanonical !== rightCanonical) {
      mismatched.push(`${label}不同（${display(leftValue)} / ${display(rightValue)}）`);
    } else {
      matched.push(label);
    }
  }
  if (mismatched.length) reasons.push(...mismatched);
  if (missing.length) reasons.push(`缺少可比所需字段：${missing.join("、")}`);
  const status: VariableComparabilityStatus = mismatched.length
    ? "blocked"
    : missing.length
      ? "insufficient"
      : "aligned";
  const comparableKey = status === "aligned"
    ? stableComparableKey(dimensions)
    : null;
  return {
    left_observation_id: left.observation_id,
    right_observation_id: right.observation_id,
    status,
    comparable_key: comparableKey,
    reasons: reasons.length ? reasons : ["正式对象、范围、指标、单位和时间基准一致，可直接比较观测期差异"],
    matched_dimensions: matched,
  };
}

export function buildVariableComparabilityGroups(observations: VariableObservation[]) {
  const grouped = new Map<string, VariableObservation[]>();
  for (const observation of observations) {
    const group = grouped.get(observation.ontology_node_id) || [];
    group.push(observation);
    grouped.set(observation.ontology_node_id, group);
  }
  return [...grouped.entries()].map(([ontologyNodeId, group]) => {
    const comparisons: VariableComparison[] = [];
    for (let leftIndex = 0; leftIndex < group.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < group.length; rightIndex += 1) {
        if (group[leftIndex].run_id === group[rightIndex].run_id) continue;
        comparisons.push(compareVariableObservations(group[leftIndex], group[rightIndex]));
      }
    }
    return {
      ontology_node_id: ontologyNodeId,
      observations: group.sort((left, right) => right.created_at.localeCompare(left.created_at)),
      comparisons,
      aligned_count: comparisons.filter((comparison) => comparison.status === "aligned").length,
      blocked_count: comparisons.filter((comparison) => comparison.status === "blocked").length,
      insufficient_count: comparisons.filter((comparison) => comparison.status === "insufficient").length,
    };
  }).filter((group) => new Set(group.observations.map((observation) => observation.run_id)).size > 1)
    .sort((left, right) => right.observations.length - left.observations.length);
}
