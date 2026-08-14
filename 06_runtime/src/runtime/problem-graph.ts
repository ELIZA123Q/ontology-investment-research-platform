import { randomUUID } from "node:crypto";
import type { JudgmentType, ProblemGraphEdge, ProblemGraphNode, ReportDepth, ResearchIntent, ResearchProblemGraph } from "@/src/contracts";
import { DOMAIN_CATALOG } from "@/src/generated/domain-catalog";
import { normalizeResearchLanguage } from "@/src/semantic/dictionary-normalizer";
import { minimumIndependentPublishers } from "@/src/governance/policy-engine";

type UnitRole = { id: string; purpose: string; required: boolean };
type MotifEdge = { from: string; to: string; relation: ProblemGraphEdge["relation"] };
type TaskDefinition = {
  task_id: string;
  name: string;
  objective: string;
  completion_criteria: string[];
  uncertainty_policy: Record<string, unknown>;
  graph_motif: {
    root_question: string;
    judgment_unit_roles: UnitRole[];
    edges: MotifEdge[];
    competing_explanation_policy: { required_for?: string[]; minimum?: number };
    aggregation: { mode: string; required_units: string[]; allow_partial_with_gaps: boolean };
  };
  runtime_projection: {
    scenario_refs: string[];
    activation_terms: string[];
    selection_priority?: number;
    suppresses_when_selected?: string[];
    default_when_no_match?: boolean;
    unit_judgment_types: Record<string, JudgmentType>;
  };
};

const TASKS = DOMAIN_CATALOG.tasks as unknown as Record<string, TaskDefinition>;
type ScenarioDefinition = {
  task_affordances: Array<{ task_ref: string }>;
  entry_conditions: string[];
  completion_conditions: string[];
  invalidation_conditions: string[];
  update_triggers: string[];
};
type WorkflowPattern = {
  workflow_id: string;
  description: string;
  runtime_selection: { routes: Array<{ runtime_intent: ResearchIntent; report_depths: ReportDepth[] }> };
  planning_hints: { allow_parallel_evidence: boolean; allow_replanning: boolean; require_competing_explanation: boolean };
  graph_prior: { convergence: string; replan_on: string[] };
  human_gates: string[];
};
const SCENARIOS = DOMAIN_CATALOG.scenarioTypes as unknown as Record<string, ScenarioDefinition>;
const WORKFLOW_PATTERNS = DOMAIN_CATALOG.workflowPatterns as unknown as Record<string, WorkflowPattern>;
const stamp = () => new Date().toISOString();

export function selectWorkflowPattern(intent: ResearchIntent, reportDepth: ReportDepth): WorkflowPattern {
  const matches = Object.values(WORKFLOW_PATTERNS).filter((pattern) =>
    pattern.runtime_selection.routes.some((route) => route.runtime_intent === intent && route.report_depths.includes(reportDepth)));
  if (matches.length !== 1) throw new Error(`Workflow Pattern selection must resolve exactly once for ${intent}/${reportDepth}; got ${matches.length}`);
  return matches[0];
}

/** Select task motifs from declarative activation hints owned by 02_scenario_task. */
export function selectTaskMotifs(goal: string, lensRefs: string[] = []): TaskDefinition[] {
  const text = `${normalizeResearchLanguage(goal).normalizedText} ${lensRefs.join(" ")}`.toLowerCase();
  const matched = Object.values(TASKS).filter((task) => task.runtime_projection.activation_terms.some((term) => text.includes(term.toLowerCase())));
  const selected = matched.length ? matched : Object.values(TASKS).filter((task) => task.runtime_projection.default_when_no_match);
  const suppressed = new Set(selected.flatMap((task) => task.runtime_projection.suppresses_when_selected || []));
  const result = selected.filter((task) => !suppressed.has(task.task_id))
    .sort((left, right) => (right.runtime_projection.selection_priority || 0) - (left.runtime_projection.selection_priority || 0));
  for (const task of result) {
    for (const scenarioRef of task.runtime_projection.scenario_refs) {
      const scenario = SCENARIOS[scenarioRef];
      if (!scenario) throw new Error(`Task ${task.task_id} references unknown Scenario ${scenarioRef}`);
      if (!scenario.task_affordances.some((item) => item.task_ref === task.task_id)) {
        throw new Error(`Scenario ${scenarioRef} does not afford Task ${task.task_id}`);
      }
    }
  }
  return result;
}

export function buildResearchProblemGraph(input: {
  id?: string;
  taskId: string;
  researchCaseId: string;
  goal: string;
  intent: ResearchIntent;
  reportDepth?: ReportDepth;
  lensRefs?: string[];
}): Omit<ResearchProblemGraph, "version" | "fingerprint" | "createdAt" | "updatedAt"> {
  const id = input.id || randomUUID();
  const createdAt = stamp();
  const nodes: ProblemGraphNode[] = [];
  const edges: ProblemGraphEdge[] = [];
  const node = (key: string, type: ProblemGraphNode["type"], title: string, required: boolean, motifRef: string | undefined, payload: Record<string, unknown> = {}): ProblemGraphNode => {
    const value: ProblemGraphNode = { id: randomUUID(), graphId: id, key, type, title, state: type === "synthesis" ? "proposed" : "unresolved", required, motifRef, payload, resolvedArtifactIds: [], createdAt, updatedAt: createdAt };
    nodes.push(value);
    return value;
  };
  const edge = (from: ProblemGraphNode, to: ProblemGraphNode, relation: ProblemGraphEdge["relation"], payload: Record<string, unknown> = {}) => {
    if (edges.some((item) => item.fromNodeId === from.id && item.toNodeId === to.id && item.relation === relation)) return;
    edges.push({ id: randomUUID(), graphId: id, fromNodeId: from.id, toNodeId: to.id, relation, payload });
  };

  const roots: ProblemGraphNode[] = [];
  const sharedUnits = new Map<string, ProblemGraphNode>();
  const normalization = normalizeResearchLanguage(input.goal);
  const workflowPattern = selectWorkflowPattern(input.intent, input.reportDepth || "standard");
  for (const task of selectTaskMotifs(input.goal, input.lensRefs || [])) {
    const motif = task.graph_motif;
    const root = node(`${task.task_id}:${motif.root_question}`, "root_question", `${task.name}：${input.goal}`, true, task.task_id, {
      question: input.goal,
      scenarioRefs: task.runtime_projection.scenario_refs,
      lensRefs: input.lensRefs || [],
      completionCriteria: task.completion_criteria,
      uncertaintyPolicy: task.uncertainty_policy,
      aggregation: motif.aggregation,
      workflowPatternRef: workflowPattern.workflow_id,
      workflowPrior: {
        planningHints: {
          allowParallelEvidence: workflowPattern.planning_hints.allow_parallel_evidence,
          allowReplanning: workflowPattern.planning_hints.allow_replanning,
          requireCompetingExplanation: workflowPattern.planning_hints.require_competing_explanation,
        },
        graphPrior: { convergence: workflowPattern.graph_prior.convergence, replanOn: workflowPattern.graph_prior.replan_on },
        humanGates: workflowPattern.human_gates,
      },
      scenarioContracts: task.runtime_projection.scenario_refs.map((scenarioRef) => ({
        scenarioRef,
        entryConditions: SCENARIOS[scenarioRef].entry_conditions,
        completionConditions: SCENARIOS[scenarioRef].completion_conditions,
        invalidationConditions: SCENARIOS[scenarioRef].invalidation_conditions,
        updateTriggers: SCENARIOS[scenarioRef].update_triggers,
      })),
      dictionaryNormalization: normalization,
    });
    const byRole = new Map<string, ProblemGraphNode>([[motif.root_question, root]]);
    for (const role of motif.judgment_unit_roles) {
      const judgmentType = task.runtime_projection.unit_judgment_types[role.id];
      if (!judgmentType) throw new Error(`Task ${task.task_id} unit ${role.id} is missing a governed JudgmentType binding`);
      const equivalenceKey = `${judgmentType}:${role.purpose}`;
      let unit = sharedUnits.get(equivalenceKey);
      if (!unit) {
        unit = node(`${task.task_id}:${role.id}`, "judgment_unit", role.purpose, role.required, task.task_id, { judgmentType, roleId: role.id, equivalenceKey });
        sharedUnits.set(equivalenceKey, unit);
        const hypothesis = node(`${task.task_id}:${role.id}:primary`, "hypothesis", `主假设：${role.purpose}成立`, role.required, task.task_id, { role: "primary", judgmentUnitKey: unit.key });
        edge(hypothesis, unit, "informs");
        if ((motif.competing_explanation_policy.required_for || []).includes(role.id)) {
          const competing = node(`${task.task_id}:${role.id}:competing`, "competing_explanation", `竞争解释：${role.purpose}并非由主路径驱动`, role.required, task.task_id, { role: "competing", judgmentUnitKey: unit.key, minimum: motif.competing_explanation_policy.minimum || 1 });
          edge(competing, hypothesis, "challenges");
        }
        for (const evidenceRole of ["support", "counter", "boundary"] as const) {
          const requirement = node(`${task.task_id}:${role.id}:evidence:${evidenceRole}`, "evidence_requirement", `${evidenceRole === "support" ? "支持" : evidenceRole === "counter" ? "反证" : "边界"}证据：${role.purpose}`, role.required, task.task_id, {
            evidenceRole, judgmentUnitKey: unit.key, minIndependentPublishers: minimumIndependentPublishers(evidenceRole),
            requiredSourceTypes: evidenceRole === "support" ? ["primary", "secondary"] : ["primary"], scope: role.purpose,
          });
          edge(requirement, unit, "requires", { evidenceRole });
        }
      } else if (role.required && !unit.required) {
        unit.required = true;
      }
      byRole.set(role.id, unit);
      edge(unit, root, "aggregates", { structuralProjection: "question_decomposes_into_unit" });
    }
    for (const declared of motif.edges) {
      const from = byRole.get(declared.from);
      const to = byRole.get(declared.to);
      if (!from || !to) throw new Error(`Task ${task.task_id} has invalid motif edge ${declared.from} -> ${declared.to}`);
      edge(from, to, declared.relation, { declaredBy: `02_scenario_task/03_tasks/${task.task_id}.yaml` });
    }
    roots.push(root);
  }
  for (const ambiguity of normalization.ambiguities) {
    const blocker = node(`ambiguity:${ambiguity.term}`, "blocking_factor", `待冻结口径：${ambiguity.term}`, ambiguity.ambiguity === "high", undefined, { ambiguity: ambiguity.ambiguity, possibleMeanings: ambiguity.possible_meanings, distinguish: ambiguity.distinguish, resolutionRule: ambiguity.resolution_rule });
    for (const root of roots) edge(blocker, root, "challenges", { sourceRef: "01_semantic_knowledge/02_dictionary/04_ambiguity_rules.yaml" });
  }
  const synthesis = node("synthesis", "synthesis", "综合各判断单元并保留局部不确定性", true, undefined, {
    requiredTerminalStates: ["resolved", "blocked", "indeterminate"],
    workflowPatternRef: workflowPattern.workflow_id,
    convergence: workflowPattern.graph_prior.convergence,
  });
  for (const root of roots) edge(root, synthesis, "aggregates");
  return {
    id, taskId: input.taskId, researchCaseId: input.researchCaseId, status: "proposed",
    intentRefs: [input.intent], scenarioRefs: [...new Set(roots.flatMap((root) => root.payload.scenarioRefs as string[] || []))],
    taskMotifRefs: [...new Set(nodes.map((item) => item.motifRef).filter(Boolean) as string[])], lensRefs: input.lensRefs || [], nodes, edges,
  };
}

export function graphNodeByKey(graph: ResearchProblemGraph, key: string): ProblemGraphNode {
  const result = graph.nodes.find((item) => item.key === key);
  if (!result) throw new Error(`Problem graph node not found: ${key}`);
  return result;
}

export function judgmentUnitRequirements(graph: ResearchProblemGraph, unit: ProblemGraphNode): ProblemGraphNode[] {
  return graph.edges.filter((edge) => edge.toNodeId === unit.id && edge.relation === "requires")
    .map((edge) => graph.nodes.find((node) => node.id === edge.fromNodeId))
    .filter((node): node is ProblemGraphNode => node !== undefined && node.type === "evidence_requirement");
}
