import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { AGENTS, CAPABILITY_RELEASE, SKILLS, TOOLS } from "../src/capabilities/registry";

const runtimeRoot = basename(process.cwd()) === "06_runtime" ? process.cwd() : resolve(process.cwd(), "06_runtime");
const repoRoot = resolve(runtimeRoot, "..");
const failures: string[] = [];

const forbiddenPaths = [
  "vnext", "90_compat", "06_runtime/agents", "06_runtime/skills", "06_runtime/workflow",
  "06_runtime/runner", "06_runtime/storage", "04_context_state/02_memory",
  "04_context_state/03_workspace", "04_context_state/04_runtime", "legacy", "examples",
];
for (const path of forbiddenPaths) if (existsSync(join(repoRoot, path))) failures.push(`forbidden legacy path exists: ${path}`);

const claudeSkills = join(repoRoot, ".claude/skills");
if (existsSync(claudeSkills)) {
  for (const entry of readdirSync(claudeSkills)) {
    const path = join(claudeSkills, entry);
    if (statSync(path).isDirectory() && existsSync(join(path, "SKILL.md"))) failures.push(`duplicated runtime skill body: .claude/skills/${entry}/SKILL.md`);
  }
}

const authorityFiles = [
  "README.md", "02_scenario_task/registry.yaml", "03_agent_capability/registry.yaml",
  "03_agent_capability/01_agents/registry.yaml", "03_agent_capability/02_skills/registry.yaml",
  "03_agent_capability/03_tools/registry.yaml", "04_context_state/registry.yaml",
  "04_context_state/01_context/contract.yaml", "04_context_state/02_state/contract.yaml",
  "04_context_state/03_memory/contract.yaml", "04_context_state/04_workspace/contract.yaml",
  "06_runtime/app-surface.yaml",
  "03_agent_capability/02_skills/external_candidates.json",
];
const forbiddenReferences = [
  "06_runtime/agents", "06_runtime/skills", "06_runtime/workflow", "06_runtime/runner", "06_runtime/storage",
  "04_context_state/02_memory", "04_context_state/03_workspace", "04_context_state/04_runtime",
  "source_of_truth: .claude/skills",
];
for (const file of authorityFiles) {
  const path = join(repoRoot, file);
  if (!existsSync(path)) { failures.push(`missing authority file: ${file}`); continue; }
  const content = readFileSync(path, "utf8");
  for (const token of forbiddenReferences) if (content.includes(token)) failures.push(`${file} still references ${token}`);
}

const compareRelease = (kind: "skills" | "agents" | "tools", runtime: Array<{ id: string; version?: string; lifecycle?: string }>) => {
  const released = CAPABILITY_RELEASE[kind];
  const runtimeIds = [...runtime.map((item) => item.id)].sort();
  const releaseIds = [...released.map((item) => item.id)].sort();
  if (JSON.stringify(runtimeIds) !== JSON.stringify(releaseIds)) failures.push(`${kind} runtime registry differs from Capability Release ${CAPABILITY_RELEASE.releaseId}`);
  for (const entry of released) {
    const bound = runtime.find((item) => item.id === entry.id);
    if (bound?.version && bound.version !== entry.version) failures.push(`${kind} version mismatch for ${entry.id}: release=${entry.version}, runtime=${bound.version}`);
    if (kind === "skills" && bound?.lifecycle !== entry.lifecycle) failures.push(`skill lifecycle mismatch for ${entry.id}: release=${entry.lifecycle}, runtime=${bound?.lifecycle}`);
  }
};
compareRelease("skills", [...SKILLS]);
compareRelease("agents", [...AGENTS].map((agent) => ({ ...agent, lifecycle: agent.lifecycle === "planned" ? "candidate" : agent.lifecycle, version: "1.0.0" })));
compareRelease("tools", [...TOOLS]);
const activeAgents = AGENTS.filter((agent) => agent.lifecycle === "active");
const releasedActiveAgents = CAPABILITY_RELEASE.agents.filter((agent) => agent.lifecycle === "active").map((agent) => agent.id).sort();
if (JSON.stringify(activeAgents.map((agent) => agent.id).sort()) !== JSON.stringify(releasedActiveAgents)) failures.push(`active agents differ from Capability Release: runtime=${activeAgents.map((agent) => agent.id).join(",")}, release=${releasedActiveAgents.join(",")}`);
if (!TOOLS.some((tool) => tool.id === "source.capture") || !TOOLS.some((tool) => tool.id === "source.query")) failures.push("required tool manifests are missing");

const externalCandidatesPath = join(repoRoot, "03_agent_capability/02_skills/external_candidates.json");
if (existsSync(externalCandidatesPath)) {
  const external = JSON.parse(readFileSync(externalCandidatesPath, "utf8")) as {
    activationPolicy?: { directMarketplaceInstallAllowed?: boolean };
    candidates?: Array<{ id?: string; sourceUrl?: string; decision?: string; mapsTo?: string[]; risks?: string[] }>;
  };
  if (external.activationPolicy?.directMarketplaceInstallAllowed !== false) failures.push("external skill policy must forbid direct marketplace activation");
  for (const candidate of external.candidates || []) {
    if (!candidate.id || !candidate.sourceUrl || !candidate.decision || !candidate.mapsTo?.length || !candidate.risks?.length) failures.push(`external skill candidate is incomplete: ${candidate.id || "unknown"}`);
    if (["active", "install", "adopt_directly"].includes(candidate.decision || "")) failures.push(`external skill bypasses intake review: ${candidate.id}`);
  }
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
console.log(`cutover audit passed: release=${CAPABILITY_RELEASE.releaseId}, ${activeAgents.length} active agent, ${SKILLS.filter((skill) => skill.lifecycle === "active").length}/${SKILLS.length} active skills, ${TOOLS.length} tools`);
