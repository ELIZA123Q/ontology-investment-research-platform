import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { DOMAIN_CATALOG } from "../src/generated/domain-catalog";
import { AGENTS, CAPABILITY_RELEASE, SKILLS, TOOLS, assertSkillExecutionAllowed } from "../src/capabilities/registry";
import { ontologyCatalog } from "../src/ontology/catalog";
import { RESEARCH_NODE_CATALOG } from "../src/runtime/node-catalog";

const failures: string[] = [];
const tasks = DOMAIN_CATALOG.tasks as unknown as Record<string, {
  graph_motif: { root_question: string; judgment_unit_roles: Array<{ id: string }>; edges: Array<{ from: string; to: string }> };
  runtime_projection: { scenario_refs: string[]; activation_terms: string[]; unit_judgment_types: Record<string, string> };
}>;
const scenarios = DOMAIN_CATALOG.scenarioTypes as unknown as Record<string, {
  task_affordances: Array<{ task_ref: string }>;
  entry_conditions: string[]; completion_conditions: string[]; invalidation_conditions: string[]; update_triggers: string[];
}>;
const workflows = DOMAIN_CATALOG.workflowPatterns as unknown as Record<string, {
  status: string;
  runtime_selection: { routes: Array<{ runtime_intent: string; report_depths: string[] }> };
}>;
const roleIds = new Set(DOMAIN_CATALOG.roles.map((role) => role.role_id));
const routes = DOMAIN_CATALOG.governance.judgmentMethodRoutes.routes as Record<string, unknown>;
if (!DOMAIN_CATALOG.capabilities.skills.execution_contract_defaults.input_kinds.includes("context_package")) failures.push("Skill execution defaults do not require the governed ContextPackage input");

for (const [taskId, task] of Object.entries(tasks)) {
  const endpoints = new Set([task.graph_motif.root_question, ...task.graph_motif.judgment_unit_roles.map((item) => item.id)]);
  if (!task.runtime_projection.activation_terms.length) failures.push(`${taskId}: activation_terms are empty`);
  for (const unit of task.graph_motif.judgment_unit_roles) {
    const judgmentType = task.runtime_projection.unit_judgment_types[unit.id];
    if (!judgmentType) failures.push(`${taskId}:${unit.id} lacks unit_judgment_types binding`);
    else if (!(judgmentType in routes)) failures.push(`${taskId}:${unit.id} references unknown JudgmentType route ${judgmentType}`);
  }
  for (const edge of task.graph_motif.edges) if (!endpoints.has(edge.from) || !endpoints.has(edge.to)) failures.push(`${taskId}: invalid motif edge ${edge.from}->${edge.to}`);
  for (const scenarioRef of task.runtime_projection.scenario_refs) {
    const scenario = scenarios[scenarioRef];
    if (!scenario) failures.push(`${taskId}: unknown Scenario ${scenarioRef}`);
    else if (!scenario.task_affordances.some((item) => item.task_ref === taskId)) failures.push(`${taskId}: Scenario ${scenarioRef} does not afford the task`);
  }
}
for (const [scenarioId, scenario] of Object.entries(scenarios)) {
  for (const affordance of scenario.task_affordances) if (!tasks[affordance.task_ref]) failures.push(`${scenarioId}: unknown task affordance ${affordance.task_ref}`);
  for (const field of ["entry_conditions", "completion_conditions", "invalidation_conditions", "update_triggers"] as const) {
    if (!scenario[field]?.length) failures.push(`${scenarioId}: ${field} is empty`);
  }
}

for (const intent of ["full_research", "evidence_only", "update_judgment", "compose_only"]) {
  for (const depth of ["brief", "standard", "deep"]) {
    const matches = Object.entries(workflows).filter(([, workflow]) => workflow.status === "active_pattern"
      && workflow.runtime_selection?.routes.some((route) => route.runtime_intent === intent && route.report_depths.includes(depth)));
    if (matches.length !== 1) failures.push(`Workflow Pattern selection ${intent}/${depth} matched ${matches.map(([id]) => id).join(",") || "none"}`);
  }
}

for (const node of RESEARCH_NODE_CATALOG.filter((item) => item.capabilityType === "skill")) {
  if (!SKILLS.some((skill) => skill.id === node.capabilityId)) failures.push(`node ${node.kind} references undefined Skill ${node.capabilityId}`);
}
for (const entry of CAPABILITY_RELEASE.skills.filter((item) => item.lifecycle !== "active")) {
  try { assertSkillExecutionAllowed(entry.id, "production"); failures.push(`candidate Skill ${entry.id} was allowed in production`); }
  catch { /* required */ }
}
for (const tool of TOOLS) if (!CAPABILITY_RELEASE.tools.some((entry) => entry.id === tool.id)) failures.push(`Tool ${tool.id} is absent from Release Manifest`);
for (const agent of AGENTS) if (!CAPABILITY_RELEASE.agents.some((entry) => entry.id === agent.id)) failures.push(`Agent ${agent.id} is absent from Release Manifest`);
for (const agent of AGENTS) for (const role of agent.canAssumeRoles) if (!roleIds.has(role)) failures.push(`Agent ${agent.id} references unknown Research Role ${role}`);

for (const relation of Object.keys(DOMAIN_CATALOG.tracePolicy.downstream_invalidation.directions)) {
  if (relation.startsWith("runtime")) continue;
  try { ontologyCatalog.getRelationType(relation); }
  catch { failures.push(`trace policy references unknown Ontology relation ${relation}`); }
}

const runtimeRoot = resolve(process.cwd().endsWith("06_runtime") ? process.cwd() : resolve(process.cwd(), "06_runtime"));
const forbiddenRuntimeKnowledge: Array<[string, RegExp]> = [
  ["src/runtime/problem-graph.ts", /const\s+MOTIFS\b/],
  ["src/runtime/problem-graph.ts", /activation_terms\s*:\s*\[/],
  ["src/governance/judgment-threshold.ts", /evidence_grade_caps\s*=\s*\{/],
  ["src/governance/judgment-threshold.ts", /counterevidence_caps\s*=\s*\{/],
];
for (const [file, pattern] of forbiddenRuntimeKnowledge) if (pattern.test(readFileSync(resolve(runtimeRoot, file), "utf8"))) failures.push(`${file} contains duplicated 01-05 knowledge: ${pattern}`);
const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = resolve(directory, entry.name);
  return entry.isDirectory() ? walk(path) : [path];
});
for (const file of walk(resolve(runtimeRoot, "src"))) {
  if (/\.(ya?ml|md)$/i.test(file)) failures.push(`${file.slice(runtimeRoot.length + 1)} is a definition document inside Runtime src; move knowledge to its 01-05 authority`);
}
const generatedCatalog = readFileSync(resolve(runtimeRoot, "src/generated/domain-catalog.ts"), "utf8");
if (!generatedCatalog.startsWith("// Generated from 01-05 definition authorities")) failures.push("generated domain catalog lacks the protected generated-file header");

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
console.log(`domain coverage audit passed: ${Object.keys(tasks).length} tasks, ${Object.keys(scenarios).length} scenarios, ${Object.keys(workflows).length} workflow patterns, ${SKILLS.length} skills, ${Object.keys(DOMAIN_CATALOG.tracePolicy.downstream_invalidation.directions).length} invalidation relations`);
