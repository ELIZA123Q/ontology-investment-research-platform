import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

const runtimeRoot = resolve(import.meta.dirname, "..");
const root = resolve(runtimeRoot, "..");
const violations: string[] = [];

const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const walk = (directory: string): string[] => readdirSync(directory).flatMap((name) => {
  const path = resolve(directory, name);
  if (["node_modules", ".next", "coverage", ".data"].includes(name)) return [];
  return statSync(path).isDirectory() ? walk(path) : [path];
});

for (const path of ["06_runtime/contracts/artifact_editing_contract.yaml", "06_runtime/evals"]) {
  const absolute = resolve(root, path);
  const material = existsSync(absolute) && (!statSync(absolute).isDirectory() || walk(absolute).length > 0);
  if (material) violations.push(`${path}: declaration authority belongs in 01-05`);
}

const sourceFiles = walk(resolve(runtimeRoot, "src")).filter((path) => /\.(?:ts|tsx)$/.test(path));
const businessTypeNames = [
  "ResearchSignalKind", "ResearchSignalStatus", "ResearchIntent", "ReportKind", "ReportAudience", "ReportDepth",
  "ReportSectionKey", "EvidenceRole", "SignalRole", "MethodGateStatus", "MethodExecutionStatus", "FrontierState",
  "ProblemGraphRelation", "FinancialBasis", "ReportDisciplineMetricStatus", "EpistemicStatus", "JudgmentLifecycleStatus",
  "CandidateOperation", "CandidateStatus", "TaskStatus", "NodeStatus", "ResearchRunOutcome",
];

const contracts = read("06_runtime/src/contracts.ts");
for (const name of businessTypeNames) {
  const declaration = contracts.match(new RegExp(`export\\s+type\\s+${name}\\s*=([\\s\\S]*?);`))?.[1] || "";
  if (declaration && !/(?:DOMAIN_CATALOG|ONTOLOGY_CATALOG|TASK_OUTCOME_VALUES|TASK_STATUS_VALUES|NODE_STATUS_VALUES|BaseReportSectionKey|KindRequiredSectionMap)/.test(declaration)) {
    violations.push(`06_runtime/src/contracts.ts: ${name} must be derived from a generated 01-05 catalog`);
  }
}

for (const absolute of sourceFiles) {
  const path = relative(root, absolute);
  const body = readFileSync(absolute, "utf8");
  if (path !== "06_runtime/src/runtime/store.ts") {
    if (/updateTaskStatus\s*\(/.test(body) || /UPDATE\s+tasks\s+SET\s+status/i.test(body)) {
      violations.push(`${path}: Task state may only change through RuntimeStore.transitionTask`);
    }
    if (/UPDATE\s+task_nodes\s+SET\s+status/i.test(body) || /updateNode\([^\n]*status\s*:/.test(body)) {
      violations.push(`${path}: TaskNode state may only change through RuntimeStore.transitionNode`);
    }
  }
  if (path !== "06_runtime/src/governance/policy-engine.ts" && /requiredRuns\s*=|requiredFamilies\s*=|requiredDelta\s*=/.test(body)) {
    violations.push(`${path}: knowledge promotion thresholds must come from 05`);
  }
  if (/return\s+\["(?:method_owner|ontology_steward|governance_owner)"/.test(body)) {
    violations.push(`${path}: approval roles must come from 05`);
  }
  if (/assertions\s*:\s*\[\{\s*metric\s*:\s*"severe_regressions"/.test(body)) {
    violations.push(`${path}: evaluation-case defaults must come from 05`);
  }
}

const appSurface = read("06_runtime/app-surface.yaml");
if (/^\s*(?:editable_fields|permissions|approval_roles|thresholds|eval_cases)\s*:/m.test(appSurface)) {
  violations.push("06_runtime/app-surface.yaml: route registry cannot own permissions, editing rules, thresholds or eval cases");
}

if (violations.length) {
  console.error(["runtime authority audit failed", ...violations.map((item) => `- ${item}`)].join("\n"));
  process.exit(1);
}

console.log(`runtime authority audit passed: ${sourceFiles.length} Runtime source files scanned; business types and state writes are bound to 01-05 projections`);
