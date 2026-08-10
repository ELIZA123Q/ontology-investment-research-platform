import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { AGENTS, SKILLS, TOOLS } from "../src/capabilities/registry";

const runtimeRoot = basename(process.cwd()) === "06_runtime" ? process.cwd() : resolve(process.cwd(), "06_runtime");
const repoRoot = resolve(runtimeRoot, "..");
const failures: string[] = [];

const forbiddenPaths = [
  "vnext", "90_compat", "06_runtime/agents", "06_runtime/skills", "06_runtime/workflow",
  "06_runtime/runner", "06_runtime/storage",
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
  "README.md", "CLAUDE.md", "02_scenario_task/registry.yaml", "03_agent_capability/registry.yaml",
  "03_agent_capability/01_agents/registry.yaml", "03_agent_capability/02_skills/registry.yaml",
  "03_agent_capability/03_tools/registry.yaml", "04_context_state/registry.yaml",
  "04_context_state/04_runtime/registry.yaml", "05_control_evaluation/01_架构/five_domain_authority.yaml",
  "07_workspace/registry.yaml",
];
const forbiddenReferences = ["06_runtime/agents", "06_runtime/skills", "06_runtime/workflow", "06_runtime/runner", "06_runtime/storage", "source_of_truth: .claude/skills"];
for (const file of authorityFiles) {
  const path = join(repoRoot, file);
  if (!existsSync(path)) { failures.push(`missing authority file: ${file}`); continue; }
  if (file.endsWith("five_domain_authority.yaml")) continue;
  const content = readFileSync(path, "utf8");
  for (const token of forbiddenReferences) if (content.includes(token)) failures.push(`${file} still references ${token}`);
}

if (SKILLS.length !== 5) failures.push(`expected 5 executable skills, found ${SKILLS.length}`);
const activeAgents = AGENTS.filter((agent) => agent.lifecycle === "active");
if (activeAgents.length !== 1 || activeAgents[0]?.id !== "research-lead") failures.push(`expected only research-lead active, found ${activeAgents.map((agent) => agent.id).join(",")}`);
if (!TOOLS.some((tool) => tool.id === "source.capture") || !TOOLS.some((tool) => tool.id === "financial.mcp")) failures.push("required tool manifests are missing");

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
console.log(`cutover audit passed: ${activeAgents.length} active agent, ${SKILLS.length} skills, ${TOOLS.length} tools`);
