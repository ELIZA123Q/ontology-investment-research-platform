import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateGoldTask, evaluateGoldTasks, type GoldTaskContract } from "@/src/evaluation/gold-task-evaluator";

const tasks = JSON.parse(readFileSync(resolve(process.cwd(), "evals/gold-tasks.json"), "utf8")) as GoldTaskContract[];

describe("gold task contract evaluator", () => {
  it("keeps every representative research route inside its professional contract", () => {
    const results = evaluateGoldTasks(tasks);
    expect(results).toHaveLength(tasks.length);
    expect(results.every((result) => result.passed)).toBe(true);
  });

  it("fails closed when a gold contract requires an impossible node", () => {
    const result = evaluateGoldTask({ ...tasks[0], id: "mutated", expectedRequiredNodes: ["arbitrary_shell"] });
    expect(result.passed).toBe(false);
    expect(result.checks.find((item) => item.id === "required:arbitrary_shell")?.passed).toBe(false);
  });
});
