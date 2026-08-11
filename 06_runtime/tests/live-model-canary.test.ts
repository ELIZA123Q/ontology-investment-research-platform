import { afterEach, describe, expect, it } from "vitest";
import catalogJson from "@/evals/live-canary-cases.json";
import { runLiveCanaryCase, validateLiveCanaryCatalog, type LiveCanaryCatalog } from "@/src/evaluation/live-model-canary";
import type { ModelProvider } from "@/src/providers/model-provider";
import { RuntimeStore } from "@/src/runtime/store";

const catalog = catalogJson as LiveCanaryCatalog;
const stores: RuntimeStore[] = [];
afterEach(() => { while (stores.length) stores.pop()?.close(); });

describe("public live model canary", () => {
  it("freezes only public, point-in-time-safe sources", () => {
    expect(validateLiveCanaryCatalog(catalog)).toEqual([]);
    expect(catalog.cases).toHaveLength(3);
  });

  it("accepts a grounded result and reuses the model cache", async () => {
    const store = new RuntimeStore(":memory:"); stores.push(store);
    let calls = 0;
    const provider: ModelProvider = { id: "deepseek", async generate() { calls += 1; return { provider: "deepseek", model: "v4-flash-test", text: JSON.stringify({
      outcome: "completed_with_judgment", judgment: "收入增长但营业利润未同步改善；该表述不解释具体原因。",
      evidenceUses: [{ factId: "dw-revenue", role: "support" }, { factId: "dw-operating-profit", role: "support" }],
      missingEvidence: ["原因拆解"], changeConditions: ["经审计年度报告修订快报数字"],
    }) }; } };
    const first = await runLiveCanaryCase(store, provider, catalog, catalog.cases[0]);
    const second = await runLiveCanaryCase(store, provider, catalog, catalog.cases[0]);
    expect(first).toMatchObject({ passed: true, cached: false });
    expect(second).toMatchObject({ passed: true, cached: true });
    expect(calls).toBe(1);
  });

  it("rejects a fabricated causal answer on an insufficient case", async () => {
    const store = new RuntimeStore(":memory:"); stores.push(store);
    const provider: ModelProvider = { id: "deepseek", async generate() { return { provider: "deepseek", model: "unsafe", text: JSON.stringify({
      outcome: "completed_with_judgment", judgment: "费用上涨 99% 是唯一原因，建议买入。", evidenceUses: [{ factId: "invented", role: "support" }],
      missingEvidence: [], changeConditions: [],
    }) }; } };
    const result = await runLiveCanaryCase(store, provider, catalog, catalog.cases[2]);
    expect(result.passed).toBe(false);
    expect(result.failures.join(" ")).toMatch(/expected stopped_insufficient_evidence|unauthorized fact|prohibited investment recommendation|unsupported numeric token/);
  });
});
