import { createHash } from "node:crypto";
import type { Budget, FrontierRef, ResearchIntent } from "@/src/contracts";
import { RESEARCH_NODE_CATALOG } from "@/src/runtime/node-catalog";
import { classifyIntent, planResearch, type PlannedNode, type ResearchPlan } from "@/src/runtime/planner";

export interface PlannerProposalNode {
  key: string;
  kind: string;
  title: string;
  dependsOn: string[];
  budget?: Partial<Budget>;
  reason?: string;
  frontierRef?: FrontierRef;
}

export interface PlannerProposal {
  intent: ResearchIntent;
  rationale: string;
  nodes: PlannerProposalNode[];
  parallelGroups?: string[][];
  stopConditions: string[];
}

export interface PlanDiagnostic {
  code: "intent_mismatch" | "unknown_node" | "duplicate_key" | "missing_node" | "missing_frontier" | "invalid_dependency" | "cycle" | "budget_exceeded" | "invalid_shape";
  severity: "error" | "warning";
  message: string;
  nodeKey?: string;
  repaired: boolean;
}

export interface CompiledResearchPlan {
  plan: ResearchPlan;
  source: "proposal" | "repaired_proposal" | "deterministic" | "deterministic_fallback";
  proposalFingerprint: string;
  diagnostics: PlanDiagnostic[];
}

const allowedKinds = new Set(RESEARCH_NODE_CATALOG.map((node) => node.kind));
const TITLES: Record<string, string> = Object.fromEntries(RESEARCH_NODE_CATALOG.map((node) => [node.kind, node.capabilityId]));
const REQUIRED: Record<ResearchIntent, string[]> = {
  clarify: ["clarify"],
  evidence_only: ["semantic_context", "evidence_discovery", "evidence_capture", "evidence_evaluation"],
  update_judgment: ["impact_analysis", "semantic_context", "evidence_discovery", "evidence_capture", "evidence_evaluation", "judgment", "audit"],
  compose_only: ["compose", "audit"],
  full_research: ["semantic_context", "evidence_discovery", "evidence_capture", "evidence_evaluation", "judgment", "compose", "audit"],
};

const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function uniqueKey(kind: string, used: Set<string>): string {
  let key = kind;
  let suffix = 2;
  while (used.has(key)) key = `${kind}_${suffix++}`;
  used.add(key);
  return key;
}

function addDependency(nodes: PlannerProposalNode[], kind: string, dependencyKind: string): void {
  const node = nodes.find((item) => item.kind === kind);
  const dependency = nodes.find((item) => item.kind === dependencyKind);
  if (node && dependency && !node.dependsOn.includes(dependency.key)) node.dependsOn.push(dependency.key);
}

const fallbackFrontier = (kind: string): FrontierRef => ({
  problemGraphId: "pending-problem-graph",
  compilerBoundary: kind === "compose" ? "compose" : kind === "audit" ? "audit" : kind === "judgment" || kind === "synthesis" ? "synthesis" : "scope",
});

function repairProposal(input: PlannerProposal, expectedIntent: ResearchIntent, budget: Budget, diagnostics: PlanDiagnostic[]): ResearchPlan {
  const used = new Set<string>();
  const nodes: PlannerProposalNode[] = [];
  for (const node of Array.isArray(input.nodes) ? input.nodes : []) {
    if (!allowedKinds.has(node.kind)) {
      diagnostics.push({ code: "unknown_node", severity: "error", message: `Unknown node kind removed: ${node.kind}`, nodeKey: node.key, repaired: true });
      continue;
    }
    const requestedKey = node.key?.trim() || node.kind;
    const key = used.has(requestedKey) ? uniqueKey(node.kind, used) : (used.add(requestedKey), requestedKey);
    if (key !== requestedKey) diagnostics.push({ code: "duplicate_key", severity: "error", message: `Duplicate key renamed to ${key}`, nodeKey: requestedKey, repaired: true });
    const frontierRef = node.frontierRef?.problemGraphId ? node.frontierRef : fallbackFrontier(node.kind);
    if (!node.frontierRef?.problemGraphId) diagnostics.push({ code: "missing_frontier", severity: "error", message: `Missing frontierRef repaired for ${key}`, nodeKey: key, repaired: true });
    nodes.push({ key, kind: node.kind, title: node.title?.trim() || TITLES[node.kind], dependsOn: Array.isArray(node.dependsOn) ? [...node.dependsOn] : [], budget: node.budget, reason: node.reason, frontierRef });
  }
  for (const kind of REQUIRED[expectedIntent]) {
    if (nodes.some((node) => node.kind === kind)) continue;
    const key = uniqueKey(kind, used);
    nodes.push({ key, kind, title: TITLES[kind], dependsOn: [], reason: "deterministic compiler inserted required boundary node", frontierRef: fallbackFrontier(kind) });
    diagnostics.push({ code: "missing_node", severity: "error", message: `Required node inserted: ${kind}`, nodeKey: key, repaired: true });
  }
  const keys = new Set(nodes.map((node) => node.key));
  for (const node of nodes) {
    const before = node.dependsOn;
    node.dependsOn = [...new Set(before.filter((key) => key !== node.key && keys.has(key)))];
    if (node.dependsOn.length !== before.length) diagnostics.push({ code: "invalid_dependency", severity: "error", message: `Invalid dependencies removed from ${node.key}`, nodeKey: node.key, repaired: true });
  }

  addDependency(nodes, "semantic_context", "impact_analysis");
  addDependency(nodes, "evidence_discovery", "semantic_context");
  addDependency(nodes, "evidence_discovery", "method_selection");
  addDependency(nodes, "evidence_capture", "evidence_discovery");
  addDependency(nodes, "evidence_evaluation", "evidence_capture");
  addDependency(nodes, "hypothesis", "evidence_evaluation");
  addDependency(nodes, "judgment", nodes.some((node) => node.kind === "hypothesis") ? "hypothesis" : "evidence_evaluation");
  if (expectedIntent !== "compose_only") addDependency(nodes, "compose", "judgment");
  addDependency(nodes, "audit", nodes.some((node) => node.kind === "compose") ? "compose" : "judgment");

  const count = Math.max(1, nodes.length);
  const modelShare = Math.max(0, Math.floor(budget.maxModelCalls / count));
  const toolShare = Math.max(0, Math.floor(budget.maxToolCalls / count));
  const costShare = Math.max(0, budget.maxCostUsd / count);
  for (const node of nodes) {
    const requested = node.budget || {};
    node.budget = {
      maxModelCalls: Math.min(Math.max(0, requested.maxModelCalls ?? modelShare), modelShare),
      maxToolCalls: Math.min(Math.max(0, requested.maxToolCalls ?? toolShare), toolShare),
      maxCostUsd: Math.min(Math.max(0, requested.maxCostUsd ?? costShare), costShare),
    };
  }
  return {
    intent: expectedIntent,
    rationale: input.rationale?.trim() || "Model proposal compiled under deterministic constraints.",
    nodes: nodes.map(({ reason: _reason, ...node }) => ({ ...node, agent: "research-lead" as const })),
    parallelGroups: (input.parallelGroups || []).map((group) => group.filter((key) => keys.has(key))).filter((group) => group.length > 1),
    stopConditions: (input.stopConditions || []).filter((condition) => typeof condition === "string" && condition.trim()).slice(0, 12),
  };
}

function validate(plan: ResearchPlan, expectedIntent: ResearchIntent, budget: Budget): PlanDiagnostic[] {
  const diagnostics: PlanDiagnostic[] = [];
  if (plan.intent !== expectedIntent) diagnostics.push({ code: "intent_mismatch", severity: "error", message: `Expected ${expectedIntent}, received ${plan.intent}`, repaired: false });
  const keys = new Set<string>();
  for (const node of plan.nodes) {
    if (!allowedKinds.has(node.kind)) diagnostics.push({ code: "unknown_node", severity: "error", message: `Unknown node kind: ${node.kind}`, nodeKey: node.key, repaired: false });
    if (!node.frontierRef?.problemGraphId) diagnostics.push({ code: "missing_frontier", severity: "error", message: `Missing frontierRef: ${node.key}`, nodeKey: node.key, repaired: false });
    if (keys.has(node.key)) diagnostics.push({ code: "duplicate_key", severity: "error", message: `Duplicate key: ${node.key}`, nodeKey: node.key, repaired: false });
    keys.add(node.key);
  }
  for (const kind of REQUIRED[expectedIntent]) if (!plan.nodes.some((node) => node.kind === kind)) diagnostics.push({ code: "missing_node", severity: "error", message: `Missing required node: ${kind}`, repaired: false });
  for (const node of plan.nodes) for (const dependency of node.dependsOn) if (dependency === node.key || !keys.has(dependency)) diagnostics.push({ code: "invalid_dependency", severity: "error", message: `${node.key} has invalid dependency ${dependency}`, nodeKey: node.key, repaired: false });

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byKey = new Map(plan.nodes.map((node) => [node.key, node]));
  const visit = (key: string): boolean => {
    if (visiting.has(key)) return true;
    if (visited.has(key)) return false;
    visiting.add(key);
    const cyclic = (byKey.get(key)?.dependsOn || []).some(visit);
    visiting.delete(key);
    visited.add(key);
    return cyclic;
  };
  if (plan.nodes.some((node) => visit(node.key))) diagnostics.push({ code: "cycle", severity: "error", message: "Task graph contains a dependency cycle", repaired: false });

  const sums = plan.nodes.reduce((total, node) => ({
    model: total.model + Number(node.budget?.maxModelCalls || 0),
    tool: total.tool + Number(node.budget?.maxToolCalls || 0),
    cost: total.cost + Number(node.budget?.maxCostUsd || 0),
  }), { model: 0, tool: 0, cost: 0 });
  if (sums.model > budget.maxModelCalls || sums.tool > budget.maxToolCalls || sums.cost > budget.maxCostUsd + 1e-9) diagnostics.push({ code: "budget_exceeded", severity: "error", message: "Node budgets exceed task budget", repaired: false });
  return diagnostics;
}

export function compilePlannerProposal(proposal: PlannerProposal, goal: string, budget: Budget): CompiledResearchPlan {
  const expectedIntent = classifyIntent(goal);
  const diagnostics: PlanDiagnostic[] = [];
  if (!proposal || !Array.isArray(proposal.nodes) || !Array.isArray(proposal.stopConditions)) {
    return { plan: planResearch(goal), source: "deterministic_fallback", proposalFingerprint: fingerprint(proposal), diagnostics: [{ code: "invalid_shape", severity: "error", message: "Planner proposal has invalid shape", repaired: false }] };
  }
  if (proposal.intent !== expectedIntent) diagnostics.push({ code: "intent_mismatch", severity: "error", message: `Intent repaired from ${proposal.intent} to ${expectedIntent}`, repaired: true });
  const repaired = repairProposal(proposal, expectedIntent, budget, diagnostics);
  const remaining = validate(repaired, expectedIntent, budget);
  if (remaining.length) return { plan: planResearch(goal), source: "deterministic_fallback", proposalFingerprint: fingerprint(proposal), diagnostics: [...diagnostics, ...remaining] };
  return { plan: repaired, source: diagnostics.length ? "repaired_proposal" : "proposal", proposalFingerprint: fingerprint(proposal), diagnostics };
}

export function parsePlannerProposal(text: string): PlannerProposal | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  if (!candidate.trim()) return null;
  try { return JSON.parse(candidate) as PlannerProposal; }
  catch { return null; }
}
