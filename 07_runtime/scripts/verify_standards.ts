/**
 * verify_standards.ts — 验证 90_compat/ontology / 90_compat/methods/workflow/governance
 * 三层标准文件完整性。
 *
 * 用法: npm run verify:standards
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import YAML from "yaml";

const PROJECT_ROOT = resolve(import.meta.dirname!, "..", "..");
const RUNTIME_ROOT = resolve(import.meta.dirname!, "..");

function repoPath(p: string) {
  return resolve(PROJECT_ROOT, p);
}

function runtimePath(p: string) {
  return resolve(RUNTIME_ROOT, p);
}

function checkExists(filePath: string, label: string): boolean {
  const ok = existsSync(filePath);
  console.log(ok ? `  ✓ ${label}` : `  ✗ MISSING: ${label} (${filePath})`);
  return ok;
}

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFiles(full));
    } else {
      results.push(relative(PROJECT_ROOT, full));
    }
  }
  return results;
}

// ─── 1. Ontology 本体文件检查 ───
console.log("\n=== Ontology 本体文件 ===");
const ontDir = repoPath("ontology");
const ontFiles = listFiles(ontDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".md"));
let ontOk = 0;
for (const f of ontFiles) {
  if (checkExists(repoPath(f), f)) ontOk++;
}

const ontologyModelRegistry = YAML.parse(
  readFileSync(repoPath("01_semantic/01_ontology/model_registry.yaml"), "utf8"),
) as Record<string, unknown>;
const requiredOntYaml = [
  "01_semantic/01_ontology/meta_schema.yaml",
  "01_semantic/01_ontology/model_registry.yaml",
  ...(Array.isArray(ontologyModelRegistry.model_files)
    ? ontologyModelRegistry.model_files.map((file) => `01_semantic/01_ontology/${String(file)}`)
    : []),
];
console.log("\n  关键本体模型文件:");
for (const f of requiredOntYaml) {
  checkExists(repoPath(f), f);
}

// ─── 2. Methods 方法论文件检查 ───
console.log("\n=== Methods 方法论文件 ===");
const methodDir = repoPath("methods");
const methodFiles = listFiles(methodDir).filter((f) => f.endsWith(".md") || f.endsWith(".yaml"));
let methodOk = 0;
for (const f of methodFiles) {
  if (checkExists(repoPath(f), f)) methodOk++;
}

// ─── 3. Workflow 工作流文件检查 ───
console.log("\n=== Workflow 工作流文件 ===");
const wfDir = repoPath("workflow");
const wfFiles = listFiles(wfDir).filter((f) => f.endsWith(".md") || f.endsWith(".yaml"));
let wfOk = 0;
for (const f of wfFiles) {
  if (checkExists(repoPath(f), f)) wfOk++;
}

// ─── 4. Governance 治理文件检查 ───
console.log("\n=== Governance 治理文件 ===");
const govDir = repoPath("governance");
const govFiles = listFiles(govDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".py"));
let govOk = 0;
for (const f of govFiles) {
  if (checkExists(repoPath(f), f)) govOk++;
}

// ─── 5. Runtime Context 注册表验证 ───
console.log("\n=== Runtime Context 注册表 ===");
const registryPath = repoPath("05_governance/01_架构/runtime_contexts.yaml");
if (!existsSync(registryPath)) {
  console.error("  ✗ 运行时上下文注册表缺失！");
} else {
  const registry = YAML.parse(readFileSync(registryPath, "utf8")) as any;
  const stages = registry.stages || {};
  let allRegFiles = 0;
  let allRegMissing = 0;
  for (const [stage, config] of Object.entries<any>(stages)) {
    const assets: string[] = config.assets || [];
    let missing = 0;
    for (const f of assets) {
      if (!existsSync(repoPath(f))) {
        console.log(`  ✗ [${stage}] 注册但缺失: ${f}`);
        missing++;
      }
    }
    allRegFiles += assets.length;
    allRegMissing += missing;
    if (missing === 0) {
      console.log(`  ✓ [${stage}] ${assets.length} 文件全部就绪`);
    }
  }
  console.log(`\n  注册文件: ${allRegFiles}, 缺失: ${allRegMissing}`);
}

// ─── 6. Runtime 关键引擎文件 ───
console.log("\n=== Runtime 引擎文件 ===");
const requiredRuntime = [
  "engine/workflow.ts",
  "engine/prompts.ts",
  "engine/semantic_execution.ts",
  "engine/context_assembler.ts",
  "engine/knowledge.ts",
];
for (const f of requiredRuntime) {
  checkExists(runtimePath(f), f);
}

// ─── 总结 ───
console.log("\n=== 总结 ===");
const totalOnt = ontFiles.length;
const totalMethod = methodFiles.length;
const totalWF = wfFiles.length;
const totalGov = govFiles.length;

console.log(`  Ontology:  ${ontOk}/${totalOnt} 文件`);
console.log(`  Methods:   ${methodOk}/${totalMethod} 文件`);
console.log(`  Workflow:  ${wfOk}/${totalWF} 文件`);
console.log(`  Governance: ${govOk}/${totalGov} 文件`);
console.log(`  Runtime:    ${requiredRuntime.length} 核心引擎文件`);
console.log(`  总计:       ${ontOk + methodOk + wfOk + govOk}/${totalOnt + totalMethod + totalWF + totalGov} 标准文件`);

const hasIssues = ontOk < totalOnt || methodOk < totalMethod || wfOk < totalWF || govOk < totalGov;
if (hasIssues) {
  console.error("\n  ⚠ 存在缺失文件，请修复后重试。");
  process.exit(1);
} else {
  console.log("\n  ✓ 所有标准文件完整。");
  process.exit(0);
}
