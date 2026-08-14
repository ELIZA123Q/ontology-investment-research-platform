import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const runtimeRoot = resolve(import.meta.dirname, "..");
const root = resolve(runtimeRoot, "..");
const violations: string[] = [];

const forbiddenRuntimeAuthorities = [
  "06_runtime/contracts/artifact_editing_contract.yaml",
];

for (const relative of forbiddenRuntimeAuthorities) {
  if (existsSync(resolve(root, relative))) violations.push(`${relative}: authority belongs in 01-05`);
}

const forbiddenSourcePatterns: Array<{ file: string; pattern: RegExp; note: string }> = [
  { file: "06_runtime/src/knowledge/service.ts", pattern: /requiredRuns\s*=|requiredFamilies\s*=|requiredDelta\s*=/, note: "knowledge promotion thresholds must come from 05" },
  { file: "06_runtime/src/knowledge/service.ts", pattern: /return \["(?:method_owner|ontology_steward|governance_owner)"\]/, note: "approval roles must come from 05" },
  { file: "06_runtime/src/runtime/kernel.ts", pattern: /role === "support" \? 2 : 1/, note: "evidence thresholds must come from 05" },
];

for (const rule of forbiddenSourcePatterns) {
  const body = readFileSync(resolve(root, rule.file), "utf8");
  if (rule.pattern.test(body)) violations.push(`${rule.file}: ${rule.note}`);
}

if (violations.length) {
  console.error(["runtime authority audit failed", ...violations.map((item) => `- ${item}`)].join("\n"));
  process.exit(1);
}

console.log("runtime authority audit passed: state, evidence, approval and knowledge policies are projected from 01-05");
