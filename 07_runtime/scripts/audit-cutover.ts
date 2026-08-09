import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { AGENTS, SKILLS, TOOLS } from "../src/capabilities/registry";

const runtimeRoot = basename(process.cwd()) === "07_runtime" ? process.cwd() : resolve(process.cwd(), "07_runtime");
const repoRoot = resolve(runtimeRoot, "..");
const failures: string[] = [];

const forbiddenPaths = [
  "vnext", "90_compat", "07_runtime/agents", "07_runtime/skills", "07_runtime/workflow",
  "07_runtime/runner", "07_runtime/storage",
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
  "README.md", "CLAUDE.md", "02_tasks/registry.yaml", "03_capabilities/registry.yaml",
  "03_capabilities/01_agents/registry.yaml", "03_capabilities/02_skills/registry.yaml",
  "03_capabilities/03_tools/registry.yaml", "04_execution/registry.yaml",
  "04_execution/04_runtime/registry.yaml", "05_governance/01_架构/five_domain_authority.yaml",
  "06_app/registry.yaml",
];
const forbiddenReferences = ["07_runtime/agents", "07_runtime/skills", "07_runtime/workflow", "07_runtime/runner", "07_runtime/storage", "source_of_truth: .claude/skills"];
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
