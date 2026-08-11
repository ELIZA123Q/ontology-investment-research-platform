import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateGoldTasks, type GoldTaskContract } from "../src/evaluation/gold-task-evaluator";

const file = resolve(process.cwd(), "evals/gold-tasks.json");
const tasks = JSON.parse(readFileSync(file, "utf8")) as GoldTaskContract[];
const results = evaluateGoldTasks(tasks);

for (const result of results) {
  console.log(`${result.passed ? "PASS" : "FAIL"} ${result.taskId} (${result.intent})`);
  for (const item of result.checks.filter((candidate) => !candidate.passed)) console.error(`  - ${item.id}: ${item.note}`);
}

const passed = results.filter((result) => result.passed).length;
console.log(`gold contract evals: ${passed}/${results.length} passed`);
if (passed !== results.length) process.exit(1);
