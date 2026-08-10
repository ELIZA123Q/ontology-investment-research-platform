import { afterEach, describe, expect, it } from "vitest";
import type { ModelProvider } from "@/src/providers/model-provider";
import { requestPlannerProposal } from "@/src/runtime/model-planner";
import { RuntimeStore } from "@/src/runtime/store";

const stores: RuntimeStore[] = [];
afterEach(() => { while (stores.length) stores.pop()?.close(); });

describe("model planner adapter", () => {
  it("caches a structured proposal by request fingerprint", async () => {
    const store = new RuntimeStore(":memory:");
    stores.push(store);
    let calls = 0;
    const provider: ModelProvider = {
      id: "fake",
      async generate() {
        calls += 1;
        return { provider: "fake", model: "planner-test", text: JSON.stringify({
          intent: "evidence_only", rationale: "最小取证路径",
          nodes: [{ key: "context", kind: "semantic_context", title: "上下文", dependsOn: [] }],
          stopConditions: ["没有来源"],
        }), usage: { inputTokens: 10, outputTokens: 20 } };
      },
    };
    const first = await requestPlannerProposal(store, provider, "只取证：研究 HBM 供需");
    const second = await requestPlannerProposal(store, provider, "只取证：研究 HBM 供需");
    expect(first).toMatchObject({ attempted: true, cached: false, provider: "fake", model: "planner-test" });
    expect(second).toMatchObject({ attempted: true, cached: true, proposal: { intent: "evidence_only" } });
    expect(calls).toBe(1);
  });

  it("returns an explicit failure instead of treating prose as a plan", async () => {
    const store = new RuntimeStore(":memory:");
    stores.push(store);
    const provider: ModelProvider = { id: "fake", async generate() { return { provider: "fake", model: "planner-test", text: "直接生成结论即可" }; } };
    const result = await requestPlannerProposal(store, provider, "研究 HBM 供需并形成报告");
    expect(result.proposal).toBeUndefined();
    expect(result.error).toMatch(/not valid JSON/);
  });
});
