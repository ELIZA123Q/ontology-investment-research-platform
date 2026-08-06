import type { BusinessInstanceGraph } from "./instance_graph/types";
import { deriveOntologyResearchValue, type OntologyResearchEffect } from "./research_value";
import {
  buildJudgmentRelationAudits,
  type JudgmentRelationAudit,
  type RelationRepairStage,
} from "../semantic_review/relation_audit";

export type BindingSummary = {
  variable_id: string;
  variable_name: string;
  ontology_node_id: string;
  ontology_label: string;
  used_downstream: boolean;
};

export type CandidateSummary = {
  variable_id: string;
  variable_name: string;
  ontology_node_id: string;
};

export type StructureReviewIssue = {
  code: string;
  severity: "attention" | "blocking";
  title: string;
  detail: string;
  target_id: string;
  repair_stage: RelationRepairStage | "ontology";
};

export type OntologyIntervention = OntologyResearchEffect & {
  source: "structure" | "rule" | "graph";
};

export type StructureReviewAction = {
  code: string;
  priority: "high" | "medium";
  title: string;
  detail: string;
  target_id: string;
  repair_stage: RelationRepairStage | "ontology";
};

export type OntologyStructureReview = {
  preflight: {
    status: "ready" | "attention" | "blocked";
    formal_bindings: BindingSummary[];
    task_local_candidates: CandidateSummary[];
    issues: StructureReviewIssue[];
  };
  adoption: {
    status: "complete" | "limited" | "broken" | "not_ready";
    judgment_unit_count: number;
    evidence_fulfillment: { met: number; partial: number; unmet: number };
    judgment_chain: { complete: number; limited: number; broken: number };
  };
  interventions: OntologyIntervention[];
  observed_contribution_count: number;
  recommended_actions: StructureReviewAction[];
  audits: JudgmentRelationAudit[];
};

type StructureVariable = {
  id?: string;
  name?: string;
  ontology_node_id?: string;
};

type StructureUnit = {
  id?: string;
  judgment_unit_id?: string;
  title?: string;
  scope_ref?: string;
  ontology_node_ids?: string[];
  evidence_requirements?: unknown[];
};

type VariableUsage = {
  source?: "formal" | "task_local";
  run_count: number;
  occurrences: Array<{ run_id?: string; variable_id?: string; name?: string }>;
};

function values(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))]
    : [];
}

function idOf(value: any, fallback = "") {
  return String(value?.id || value?.judgment_unit_id || fallback).trim();
}

function formalLabelMap(value?: ReadonlyMap<string, string> | Record<string, string>) {
  if (value instanceof Map) return new Map(value);
  return new Map(Object.entries(value || {}));
}

function requirementUnitRefs(item: any): string[] {
  return strings(item?.judgment_unit_ids || item?.target_judgment_unit_refs);
}

function hasRequirementForUnit(structure: Record<string, any>, unit: StructureUnit, unitId: string) {
  if (values(unit.evidence_requirements).length) return true;
  return values(structure.evidence_requirements).some((item) => {
    const refs = requirementUnitRefs(item);
    return refs.length === 0 || refs.includes(unitId);
  });
}

function hasCounterForUnit(structure: Record<string, any>, unitId: string) {
  return [...values(structure.counter_evidence_directions), ...values(structure.competing_explanations)]
    .some((item) => {
      const refs = requirementUnitRefs(item);
      return refs.length === 0 || refs.includes(unitId);
    });
}

function issue(
  code: string,
  severity: StructureReviewIssue["severity"],
  title: string,
  detail: string,
  targetId: string,
  repairStage: StructureReviewIssue["repair_stage"] = "structure",
): StructureReviewIssue {
  return { code, severity, title, detail, target_id: targetId, repair_stage: repairStage };
}

function dedupeIssues(issues: StructureReviewIssue[]) {
  return [...new Map(issues.map((item) => [`${item.code}:${item.target_id}`, item])).values()];
}

function actionFromIssue(item: StructureReviewIssue): StructureReviewAction {
  return {
    code: item.code,
    priority: item.severity === "blocking" ? "high" : "medium",
    title: item.title,
    detail: item.detail,
    target_id: item.target_id,
    repair_stage: item.repair_stage,
  };
}

export function structureReviewActionHref(runId: string, action: Pick<StructureReviewAction, "repair_stage" | "target_id">) {
  if (action.repair_stage === "ontology") {
    return `/ontology?tab=governance&runId=${encodeURIComponent(runId)}`;
  }
  const path = action.repair_stage === "structure"
    ? "structure"
    : action.repair_stage === "evidence"
      ? "evidence"
      : "judgments";
  return `/runs/${runId}/${path}?focus=${encodeURIComponent(action.target_id)}&from=structure-review`;
}

/**
 * 汇总 02 事前结构检查、03 证据要求履行和 04 判断链审计。
 * 这是按当前有效产物即时派生的只读结果，不创建新的研究产物。
 */
export function buildOntologyStructureReview(input: {
  runId?: string;
  structure?: Record<string, any>;
  evidence?: Record<string, any>;
  judgment?: Record<string, any>;
  graph?: BusinessInstanceGraph;
  formalStateVariables?: ReadonlyMap<string, string> | Record<string, string>;
  variableUsages?: VariableUsage[];
}): OntologyStructureReview {
  const structure = input.structure || {};
  const units = values(structure.judgment_units) as StructureUnit[];
  const variables = values(structure.variables) as StructureVariable[];
  const formalLabels = formalLabelMap(input.formalStateVariables);
  const graph = input.graph;
  const audits = graph ? buildJudgmentRelationAudits(graph) : [];
  const downstreamStateIds = new Set(audits.flatMap((audit) => audit.stateVariables.map((item) => item.id)));
  const preflightIssues: StructureReviewIssue[] = [];
  const formalBindings: BindingSummary[] = [];
  const candidates: CandidateSummary[] = [];
  const validVariableRefs = new Set<string>();

  for (const variable of variables) {
    const variableId = String(variable.id || "").trim();
    const variableName = String(variable.name || variableId || "未命名变量").trim();
    const ontologyId = String(variable.ontology_node_id || "").trim();
    if (ontologyId === `task_local:${variableId}`) {
      if (variableId) validVariableRefs.add(variableId);
      validVariableRefs.add(ontologyId);
      candidates.push({ variable_id: variableId, variable_name: variableName, ontology_node_id: ontologyId });
      continue;
    }
    if (!ontologyId || !formalLabels.has(ontologyId)) {
      preflightIssues.push(issue(
        "invalid_variable_binding",
        "blocking",
        `“${variableName}”未绑定有效正式口径`,
        ontologyId
          ? `${ontologyId} 既不是正式 StateVariable，也不是 task_local:${variableId}`
          : "变量缺少 ontology_node_id，不能进入后续跨任务推理。",
        variableId || ontologyId || "variables",
      ));
      continue;
    }
    formalBindings.push({
      variable_id: variableId,
      variable_name: variableName,
      ontology_node_id: ontologyId,
      ontology_label: formalLabels.get(ontologyId) || ontologyId,
      used_downstream: downstreamStateIds.has(variableId) || downstreamStateIds.has(ontologyId),
    });
    if (variableId) validVariableRefs.add(variableId);
    validVariableRefs.add(ontologyId);
  }

  const scopeId = String(structure.research_scope?.id || "").trim();
  if (!units.length) {
    preflightIssues.push(issue("missing_units", "blocking", "尚未形成关键判断", "至少需要一个可分别取证和裁决的关键判断。", "judgment_units"));
  }
  if (!scopeId) {
    preflightIssues.push(issue("missing_scope", "blocking", "尚未登记研究范围", "对象、时间或口径边界无法进入后续判断。", "research_scope"));
  }

  for (const [index, unit] of units.entries()) {
    const unitId = idOf(unit, `unit-${index + 1}`);
    const unitTitle = String(unit.title || unitId);
    const scopeRef = String(unit.scope_ref || "").trim();
    if (!scopeRef || (scopeId && scopeRef !== scopeId)) {
      preflightIssues.push(issue("unit_scope_missing", "blocking", `“${unitTitle}”未绑定当前研究范围`, "关键判断必须明确继承当前任务的对象、时间和口径边界。", unitId));
    }
    const ontologyRefs = strings(unit.ontology_node_ids);
    if (!ontologyRefs.length) {
      preflightIssues.push(issue("unit_variable_missing", "blocking", `“${unitTitle}”尚未绑定状态变量`, "无法明确这项判断实际观察和比较什么。", unitId));
    } else {
      const unresolved = ontologyRefs.filter((ref) => !validVariableRefs.has(ref) && !formalLabels.has(ref));
      if (unresolved.length) {
        preflightIssues.push(issue("unit_variable_unresolved", "blocking", `“${unitTitle}”引用了未解析变量`, unresolved.join("、"), unitId));
      }
    }
    if (!hasRequirementForUnit(structure, unit, unitId)) {
      preflightIssues.push(issue("unit_requirement_missing", "blocking", `“${unitTitle}”缺少必要证据`, "没有必要证据要求，03 无法按判断组织取证。", unitId));
    }
    if (!hasCounterForUnit(structure, unitId)) {
      preflightIssues.push(issue("unit_counter_missing", "attention", `“${unitTitle}”尚未登记反面情况`, "建议补充反证方向或竞争解释；这不会单独阻塞结构确认。", unitId));
    }
  }

  const preflight = dedupeIssues(preflightIssues);
  const blocking = preflight.some((item) => item.severity === "blocking");
  const attention = candidates.length > 0 || preflight.some((item) => item.severity === "attention");
  const chain = {
    complete: audits.filter((item) => item.status === "complete").length,
    limited: audits.filter((item) => item.status === "limited").length,
    broken: audits.filter((item) => item.status === "broken").length,
  };
  const fulfillmentRows = audits.flatMap((audit) => audit.requirements);
  const fulfillment = {
    met: fulfillmentRows.filter((item) => item.fulfillment === "met").length,
    partial: fulfillmentRows.filter((item) => item.fulfillment === "partial").length,
    unmet: fulfillmentRows.filter((item) => item.fulfillment === "unmet").length,
  };
  const adoptionStatus = !audits.length
    ? "not_ready" as const
    : chain.broken
      ? "broken" as const
      : chain.limited || fulfillment.partial || fulfillment.unmet
        ? "limited" as const
        : "complete" as const;

  const value = deriveOntologyResearchValue({
    structure,
    judgment: input.judgment || {},
    graph,
    labelForOntologyRef: (ref) => formalLabels.get(ref) || ref,
  });
  const interventions: OntologyIntervention[] = value.effects.map((effect) => {
    if (effect.id.startsWith("completion:binding:")) {
      const binding = formalBindings.find((item) => effect.object_refs.includes(item.variable_id));
      return {
        ...effect,
        source: "structure" as const,
        status: binding?.used_downstream ? "applied" as const : "registered" as const,
        observed_contribution: Boolean(binding?.used_downstream),
        result: binding?.used_downstream
          ? "承接：该正式口径已进入后续判断链"
          : "登记：尚未观察到该正式口径进入后续判断",
      };
    }
    return {
      ...effect,
      source: effect.id.startsWith("constraint:rule:") ? "rule" as const : "graph" as const,
    };
  });

  const auditIssues: StructureReviewIssue[] = audits.flatMap((audit) => audit.issues.map((item) => ({
    code: item.code,
    severity: item.severity === "error" ? "blocking" as const : "attention" as const,
    title: item.title,
    detail: item.impact,
    target_id: item.targetId,
    repair_stage: item.repairStage,
  })));
  const governanceIssues = candidates.flatMap((candidate) => {
    const repeated = (input.variableUsages || []).find((usage) => usage.source === "task_local"
      && usage.run_count > 1
      && usage.occurrences.some((occurrence) => occurrence.variable_id === candidate.variable_id
        && (!input.runId || occurrence.run_id === input.runId)));
    return repeated ? [issue(
      "repeated_task_local_candidate",
      "attention",
      `“${candidate.variable_name}”已在多个研究重复出现`,
      `该任务内候选已出现在 ${repeated.run_count} 个研究中，建议进入知识缺口治理，而不是继续逐任务复制口径。`,
      candidate.variable_id,
      "ontology",
    )] : [];
  });
  const recommendedActions = dedupeIssues([...preflight, ...auditIssues, ...governanceIssues])
    .map(actionFromIssue)
    .sort((left, right) => (left.priority === right.priority ? 0 : left.priority === "high" ? -1 : 1));

  return {
    preflight: {
      status: blocking ? "blocked" : attention ? "attention" : "ready",
      formal_bindings: formalBindings,
      task_local_candidates: candidates,
      issues: preflight,
    },
    adoption: {
      status: adoptionStatus,
      judgment_unit_count: units.length,
      evidence_fulfillment: fulfillment,
      judgment_chain: chain,
    },
    interventions,
    observed_contribution_count: interventions.filter((item) => item.observed_contribution).length,
    recommended_actions: recommendedActions,
    audits,
  };
}
