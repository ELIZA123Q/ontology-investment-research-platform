import type { ResearchGraphEdge, ResearchGraphNode } from "@/app/components/research-graph";
import {
  normalizeCompetingExplanations,
  normalizeCounterEvidenceDirections,
} from "@/engine/structure_candidates";
import {
  anchorLabels,
  buildJudgmentUnitConcepts,
  buildStructureDisplayLookups,
  evidenceRoleLabel,
  failureRouteLabel,
  formatVariableConceptBinding,
  judgmentTypeLabel,
  resolveOntologyDisplayLabels,
  runStatusLabel,
  scopeDimensionKeyLabel,
  scopeDisplayLabel,
  unitDisplayLabel,
  unitDisplayLabels,
  variableCategoryLabel,
  variableKindLabel,
  variableRoleLabel,
} from "@/engine/ontology_display_labels";

export type StructureGraphTone = ResearchGraphNode["tone"];

export type StructureMethodSummaryGroup = {
  capability: string;
  label: string;
  items: Array<{ application_id: string; method_id: string; unit_refs: string[] }>;
};

export type StructureScopeSummary = {
  id: string;
  label: string;
  dimensions: Array<{ key: string; value: string }>;
} | null;

export type StructureGraphBuildResult = {
  nodes: ResearchGraphNode[];
  edges: ResearchGraphEdge[];
  scopeSummary: StructureScopeSummary;
  methodSummary: StructureMethodSummaryGroup[];
};

type UnitRecord = {
  id: string;
  title: string;
  question: string;
  judgment_type: string;
  scope_ref: string;
  ontology_node_ids: string[];
  evidence_requirements: string[];
};

type VariableRecord = {
  id: string;
  name: string;
  category: string;
  definition: string;
  variable_kind: string;
  anchors: string[];
  ontology_node_id: string;
  role: string;
};

type PathRecord = {
  id: string;
  statement: string;
  variable_ids: string[];
};

type QuestionRecord = {
  failure_route: string;
};

type EvidenceRequirementRecord = {
  id: string;
  requirement: string;
  evidence_role: string;
  minimum_independent_sources: number;
  judgment_unit_ids: string[];
  source?: string;
  source_ref?: string;
};

const CAPABILITY_LABELS: Record<string, string> = {
  judgment_structure: "结构方法",
  evidence: "取证方法",
  adjudication: "裁决方法",
};

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function normalizeUnits(raw: unknown): UnitRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((unit: any, index: number) => ({
    id: String(unit?.id || unit?.judgment_unit_id || `JU-${index + 1}`),
    title: String(unit?.title || unit?.statement || unit?.question || `判断单元 ${index + 1}`),
    question: String(unit?.question || unit?.statement || ""),
    judgment_type: String(unit?.judgment_type || "关键判断"),
    scope_ref: String(unit?.scope_ref || ""),
    ontology_node_ids: asStringArray(unit?.ontology_node_ids || unit?.target_ontology_object_refs),
    evidence_requirements: asStringArray(unit?.evidence_requirements || unit?.evidence_requirement_refs),
  }));
}

function normalizeVariables(raw: unknown): VariableRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((variable: any, index: number) => ({
    id: String(variable?.id || `SV-${index + 1}`),
    name: String(variable?.name || variable?.id || `变量 ${index + 1}`),
    category: String(variable?.category || ""),
    definition: String(variable?.definition || ""),
    variable_kind: String(variable?.variable_kind || ""),
    anchors: asStringArray(variable?.anchors),
    ontology_node_id: String(variable?.ontology_node_id || ""),
    role: String(variable?.role || ""),
  }));
}

function normalizePaths(raw: unknown): PathRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((path: any, index: number) => ({
    id: String(path?.id || `PATH-${index + 1}`),
    statement: String(path?.statement || path?.id || `路径 ${index + 1}`),
    variable_ids: asStringArray(path?.variable_ids),
  }));
}

function normalizeQuestions(raw: unknown): QuestionRecord | null {
  if (!Array.isArray(raw) || !raw.length) return null;
  const first = raw[0];
  if (!first || typeof first !== "object") return null;
  const route = String((first as Record<string, unknown>).failure_route || "").trim();
  return route ? { failure_route: route } : null;
}

function normalizeEvidenceRequirements(raw: unknown): EvidenceRequirementRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item: any, index: number) => ({
    id: String(item?.id || `ER-${index + 1}`),
    requirement: String(item?.requirement || ""),
    evidence_role: String(item?.evidence_role || "support"),
    minimum_independent_sources: Number(item?.minimum_independent_sources ?? 0),
    judgment_unit_ids: asStringArray(item?.judgment_unit_ids),
    source: item?.source ? String(item.source) : undefined,
    source_ref: item?.source_ref ? String(item.source_ref) : undefined,
  }));
}

function formatFailureRoute(route: string): string {
  return failureRouteLabel(route);
}

function formatEvidenceRole(role: string): string {
  return evidenceRoleLabel(role);
}

function findFormalEvidenceRequirement(
  formal: EvidenceRequirementRecord[],
  unitId: string,
  requirementText: string,
): EvidenceRequirementRecord | undefined {
  return formal.find((item) =>
    item.requirement === requirementText
    && (item.judgment_unit_ids.length === 0 || item.judgment_unit_ids.includes(unitId)),
  ) ?? formal.find((item) => item.requirement === requirementText);
}

export function summarizeResearchScope(raw: unknown): StructureScopeSummary {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const label = String(record.label || "").trim();
  const id = String(record.id || "").trim();
  if (!label && !id) return null;
  const dimensionsRaw = record.dimensions && typeof record.dimensions === "object" && !Array.isArray(record.dimensions)
    ? record.dimensions as Record<string, unknown>
    : {};
  const dimensions = Object.entries(dimensionsRaw).map(([key, value]) => ({
    key,
    value: Array.isArray(value)
      ? value.map(String).join("、")
      : typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : value && typeof value === "object"
          ? Object.entries(value as Record<string, unknown>).map(([name, item]) => `${scopeDimensionKeyLabel(name)}：${String(item)}`).join("；")
          : "未填写",
  }));
  return { id: id || "SCOPE", label: label || id, dimensions };
}

export function summarizeMethodApplications(raw: unknown): StructureMethodSummaryGroup[] {
  if (!Array.isArray(raw)) return [];
  const groups = new Map<string, StructureMethodSummaryGroup>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const capability = String(record.capability_type || "unknown");
    if (!groups.has(capability)) {
      groups.set(capability, {
        capability,
        label: CAPABILITY_LABELS[capability] || capability,
        items: [],
      });
    }
    groups.get(capability)!.items.push({
      application_id: String(record.application_id || ""),
      method_id: String(record.method_id || ""),
      unit_refs: asStringArray(record.target_judgment_unit_refs),
    });
  }
  const order = ["judgment_structure", "evidence", "adjudication"];
  return [...groups.values()].sort((a, b) => {
    const ai = order.indexOf(a.capability);
    const bi = order.indexOf(b.capability);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
}

/** 判断单元关联的变量：ontology_node_ids 匹配变量 id 或 ontology_node_id。 */
export function variableIdsForUnit(unit: UnitRecord, variables: VariableRecord[]): string[] {
  if (!unit.ontology_node_ids.length || !variables.length) return [];
  const wanted = new Set(unit.ontology_node_ids);
  return variables
    .filter((variable) => wanted.has(variable.id) || (variable.ontology_node_id && wanted.has(variable.ontology_node_id)))
    .map((variable) => variable.id);
}

function columnLayout(hasVariables: boolean, hasPaths: boolean) {
  if (hasVariables && hasPaths) {
    return { question: 0, variables: 280, paths: 560, units: 860, right: 1180 };
  }
  if (hasVariables) {
    return { question: 0, variables: 300, paths: 300, units: 620, right: 960 };
  }
  if (hasPaths) {
    return { question: 0, variables: 0, paths: 300, units: 620, right: 960 };
  }
  return { question: 0, variables: 0, paths: 0, units: 330, right: 700 };
}

export function buildStructureReviewGraph(input: {
  question: string;
  inherited?: boolean;
  runStatus?: string;
  research_scope?: unknown;
  judgment_units?: unknown;
  variables?: unknown;
  paths?: unknown;
  questions?: unknown;
  evidence_requirements?: unknown;
  competing_explanations?: unknown;
  counter_evidence_directions?: unknown;
  method_applications?: unknown;
}): StructureGraphBuildResult {
  const inherited = Boolean(input.inherited);
  const units = normalizeUnits(input.judgment_units);
  const variables = normalizeVariables(input.variables);
  const paths = normalizePaths(input.paths);
  const questionRecord = normalizeQuestions(input.questions);
  const formalRequirements = normalizeEvidenceRequirements(input.evidence_requirements);
  const display = buildStructureDisplayLookups({
    variables,
    units,
    research_scope: input.research_scope,
  });
  const variableLookup = display.ontologyNames;
  const unitIds = units.map((unit) => unit.id);
  const unitIndex = new Map(unitIds.map((id, index) => [id, index]));
  const variableIds = new Set(variables.map((variable) => variable.id));
  const cols = columnLayout(variables.length > 0, paths.length > 0);
  const questionTone: StructureGraphTone = inherited ? "inherited" : "neutral";
  const unitTone: StructureGraphTone = inherited ? "inherited" : "support";

  const nodes: ResearchGraphNode[] = [];
  const edges: ResearchGraphEdge[] = [];

  const scopeSummary = summarizeResearchScope(input.research_scope);
  const methodSummary = summarizeMethodApplications(input.method_applications);

  const questionDetails: Record<string, unknown> = {
    范围状态: inherited ? "从父运行继承" : "本轮定义",
    运行状态: input.runStatus ? runStatusLabel(input.runStatus) : "—",
  };
  if (scopeSummary) {
    questionDetails.研究范围 = scopeSummary.label;
    questionDetails.范围编号 = scopeSummary.id;
    for (const dim of scopeSummary.dimensions) {
      questionDetails[`范围·${scopeDimensionKeyLabel(dim.key)}`] = dim.value;
    }
  }
  if (questionRecord?.failure_route) {
    questionDetails.失败路由 = formatFailureRoute(questionRecord.failure_route);
  }

  const stackHeight = Math.max(
    units.length * 190,
    variables.length * 120,
    paths.length * 140,
    120,
  );

  nodes.push({
    id: "research-question",
    label: input.question,
    meta: "研究问题",
    tone: questionTone,
    x: cols.question,
    y: Math.max(40, Math.floor(stackHeight / 2) - 40),
    details: questionDetails,
  });

  variables.forEach((variable, index) => {
    const categoryLabel = variableCategoryLabel(variable.category || variable.role || "");
    nodes.push({
      id: variable.id,
      label: variable.name,
      meta: `状态变量 · ${categoryLabel || "观察"}`,
      tone: "neutral",
      x: cols.variables,
      y: index * 120,
      details: {
        定义: variable.definition || "—",
        类别: variable.category ? variableCategoryLabel(variable.category) : "—",
        变量类型: variable.variable_kind ? variableKindLabel(variable.variable_kind) : "—",
        角色: variable.role ? variableRoleLabel(variable.role) : "—",
        锚点: variable.anchors.length ? anchorLabels(variable.anchors) : "—",
        概念挂靠: formatVariableConceptBinding(variable, variables),
      },
    });
  });

  paths.forEach((path, index) => {
    nodes.push({
      id: path.id,
      label: path.statement,
      meta: "传导路径",
      tone: "support",
      x: cols.paths,
      y: index * 140,
      details: {
        路径说明: path.statement,
        涉及变量: path.variable_ids.length ? resolveOntologyDisplayLabels(path.variable_ids, variableLookup) : "—",
      },
    });
    for (const variableId of path.variable_ids) {
      if (!variableIds.has(variableId)) continue;
      edges.push({
        id: `${variableId}-${path.id}`,
        source: variableId,
        target: path.id,
        tone: "support",
        label: "进入路径",
      });
    }
  });

  const unitLinkedVariable = new Map<string, string[]>();
  units.forEach((unit, index) => {
    const linkedVars = variableIdsForUnit(unit, variables);
    unitLinkedVariable.set(unit.id, linkedVars);
    const keyConcepts = buildJudgmentUnitConcepts(unit, linkedVars, variables);
    nodes.push({
      id: unit.id,
      label: unit.title,
      meta: `${unit.id} · ${judgmentTypeLabel(unit.judgment_type)}`,
      tone: unitTone,
      x: cols.units,
      y: index * 190,
      details: {
        判断问题: unit.question || "—",
        判断类型: judgmentTypeLabel(unit.judgment_type),
        研究范围: unit.scope_ref ? scopeDisplayLabel(unit.scope_ref, display.scopeLabels) : "—",
        证据要求: unit.evidence_requirements.length ? unit.evidence_requirements : "—",
        关键概念: keyConcepts.length ? keyConcepts : "—",
      },
    });
    edges.push({
      id: `question-${unit.id}`,
      source: "research-question",
      target: unit.id,
      tone: questionTone,
    });

    const linkedSet = new Set(linkedVars);
    let pathLinked = false;
    if (paths.length > 0 && linkedVars.length) {
      for (const path of paths) {
        if (!path.variable_ids.some((id) => linkedSet.has(id))) continue;
        pathLinked = true;
        edges.push({
          id: `${path.id}-${unit.id}`,
          source: path.id,
          target: unit.id,
          tone: "support",
          label: "路径",
        });
      }
    }
    // 无路径，或有路径但未与本单元变量重叠：变量直连判断单元
    if (linkedVars.length && (!paths.length || !pathLinked)) {
      for (const variableId of linkedVars) {
        edges.push({
          id: `${variableId}-${unit.id}`,
          source: variableId,
          target: unit.id,
          tone: "neutral",
          label: "支撑判断",
        });
      }
    }

    unit.evidence_requirements.forEach((requirement, reqIndex) => {
      const requirementId = `${unit.id}-ER-${reqIndex + 1}`;
      const matched = findFormalEvidenceRequirement(formalRequirements, unit.id, requirement);
      const erDetails: Record<string, unknown> = {
        对应判断: unitDisplayLabel(unit.id, display.unitTitles),
        要求: requirement,
      };
      if (matched) {
        erDetails.证据角色 = formatEvidenceRole(matched.evidence_role);
        erDetails.最低独立来源 = matched.minimum_independent_sources;
      }
      nodes.push({
        id: requirementId,
        label: requirement,
        meta: "必要证据",
        tone: "unknown",
        x: cols.right,
        y: index * 190 + reqIndex * 64,
        details: erDetails,
      });
      edges.push({
        id: `${unit.id}-${requirementId}`,
        source: unit.id,
        target: requirementId,
        tone: "unknown",
      });
    });
  });

  const counters = normalizeCounterEvidenceDirections(input.counter_evidence_directions, { unitIds });
  let unboundCounterIndex = 0;
  counters.forEach((direction, index) => {
    const boundUnits = direction.judgment_unit_ids.filter((unitId) => unitIndex.has(unitId));
    const unbound = !boundUnits.length;
    const anchorIndex = boundUnits.length
      ? Math.min(...boundUnits.map((unitId) => Number(unitIndex.get(unitId) ?? 0)))
      : units.length;
    const erOffset = boundUnits.length
      ? Math.max(...boundUnits.map((unitId) => {
        const unit = units[Number(unitIndex.get(unitId) ?? 0)];
        return unit?.evidence_requirements.length || 0;
      }))
      : 0;
    const y = unbound
      ? units.length * 190 + unboundCounterIndex * 100
      : anchorIndex * 190 + erOffset * 64 + 36 + (index % 2) * 28;
    if (unbound) unboundCounterIndex += 1;
    nodes.push({
      id: direction.direction_id,
      label: direction.statement,
      meta: unbound ? "反证方向 · 待归属" : "反证方向",
      tone: "danger",
      x: unbound ? cols.question : cols.right + 40,
      y,
      details: {
        反证方向: direction.statement,
        归属状态: unbound ? "待归属" : `挂接 ${unitDisplayLabels(boundUnits, display.unitTitles).join("、")}`,
        挂接判断单元: boundUnits.length ? unitDisplayLabels(boundUnits, display.unitTitles) : "—",
      },
    });
    if (unbound) {
      edges.push({
        id: `question-${direction.direction_id}`,
        source: "research-question",
        target: direction.direction_id,
        tone: "danger",
        label: "待归属",
      });
    } else {
      for (const unitId of boundUnits) {
        edges.push({
          id: `${unitId}-${direction.direction_id}`,
          source: unitId,
          target: direction.direction_id,
          tone: "danger",
          label: "反证",
        });
      }
    }
  });

  const competing = normalizeCompetingExplanations(input.competing_explanations, { unitIds });
  let unboundCompetingIndex = 0;
  competing.forEach((explanation, index) => {
    const boundUnits = explanation.judgment_unit_ids.filter((unitId) => unitIndex.has(unitId));
    const unbound = !boundUnits.length;
    const anchorIndex = boundUnits.length
      ? Math.min(...boundUnits.map((unitId) => Number(unitIndex.get(unitId) ?? 0)))
      : units.length;
    const y = unbound
      ? units.length * 190 + unboundCounterIndex * 100 + unboundCompetingIndex * 110
      : anchorIndex * 190 + 70 + (index % 3) * 36;
    if (unbound) unboundCompetingIndex += 1;
    nodes.push({
      id: explanation.explanation_id,
      label: explanation.statement,
      meta: unbound ? "竞争解释 · 待归属" : "竞争解释",
      tone: "weaken",
      x: unbound ? cols.question : cols.right + 280,
      y,
      details: {
        竞争解释: explanation.statement,
        归属状态: unbound ? "待归属" : `挂接 ${unitDisplayLabels(boundUnits, display.unitTitles).join("、")}`,
        挂接判断单元: boundUnits.length ? unitDisplayLabels(boundUnits, display.unitTitles) : "—",
      },
    });
    if (unbound) {
      edges.push({
        id: `question-${explanation.explanation_id}`,
        source: "research-question",
        target: explanation.explanation_id,
        tone: "weaken",
        label: "待归属",
      });
    } else {
      for (const unitId of boundUnits) {
        edges.push({
          id: `${unitId}-${explanation.explanation_id}`,
          source: unitId,
          target: explanation.explanation_id,
          tone: "weaken",
          label: "竞争解释",
        });
      }
    }
  });

  return { nodes, edges, scopeSummary, methodSummary };
}
