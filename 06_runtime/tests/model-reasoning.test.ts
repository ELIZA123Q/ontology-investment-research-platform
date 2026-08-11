import { afterEach, describe, expect, it } from "vitest";
import type { Artifact, EvidenceFact, SourceReference, Task, TaskNode } from "@/src/contracts";
import type { ModelProvider } from "@/src/providers/model-provider";
import { requestBoundedResearchReasoning } from "@/src/research/model-reasoning";
import { normalizeReportSpec } from "@/src/reporting/report-spec";
import { RuntimeStore } from "@/src/runtime/store";

const stores: RuntimeStore[] = [];
afterEach(() => { while (stores.length) stores.pop()?.close(); });

const task: Task = {
  id: "task-1", conversationId: "conversation-1", researchCaseId: "case-1", goal: "复核订单增长 20% 是否支持需求改善",
  intent: "update_judgment", reportSpec: normalizeReportSpec({ kind: "judgment_update" }), status: "running",
  budget: { maxModelCalls: 3, maxToolCalls: 3, maxCostUsd: 1 }, createdAt: "2026-08-11T00:00:00Z", updatedAt: "2026-08-11T00:00:00Z",
};
const node: TaskNode = {
  id: "node-1", taskId: task.id, kind: "hypothesis_generation", title: "构建竞争假设", capabilityType: "skill",
  capabilityId: "hypothesis-generation", assignedAgent: "research-lead", dependsOn: [], status: "running", budget: {},
  inputArtifactIds: [], outputArtifactIds: [], frontierRef: { problemGraphId: "graph-1" }, iteration: 0,
};
const fact: EvidenceFact = {
  id: "fact-1", snapshotId: "snapshot-1", statement: "订单同比增长 20%", factType: "measurement",
  confidence: "high", status: "verified", createdAt: "2026-08-11T00:00:00Z",
};
const source: SourceReference = {
  sourceId: fact.snapshotId, uri: "https://issuer.test/announcement", title: "issuer announcement", capturedAt: fact.createdAt,
  locator: "p1", quote: fact.statement, contentHash: "sha256:test", verification: "verified", permissionScope: "public_research_use",
};
const evidenceArtifact: Artifact = {
  id: "artifact-1", conversationId: task.conversationId, taskId: task.id, nodeId: node.id, kind: "evidence_package", title: "证据评估",
  version: 1, status: "verified", data: { facts: [fact] }, sourceRefs: [source], createdBy: "test", createdAt: fact.createdAt,
};

describe("bounded research reasoning", () => {
  it("accepts only hypotheses and candidate judgments grounded in authorized facts", async () => {
    const store = new RuntimeStore(":memory:"); stores.push(store);
    const provider: ModelProvider = { id: "fake", async generate() { return { provider: "fake", model: "reasoner", text: JSON.stringify({
      evidenceAssignments: [{ evidenceFactId: fact.id, role: "support", rationale: "订单增长 20% 支持需求改善" }],
      hypotheses: [{ statement: "需求可能改善", evidenceFactIds: [fact.id], falsificationConditions: ["订单增长 20% 未转化为收入"], distinguishingSignals: ["收入确认"] }],
      judgment: { statement: "需求有条件改善", confidence: "medium", evidenceFactIds: [fact.id], changeConditions: ["订单增长 20% 未转化为收入"], reasoningSummary: "当前仅有订单证据" },
      reviewFindings: [],
    }) }; } };
    const result = await requestBoundedResearchReasoning(store, provider, { task, node, facts: [fact], artifacts: [evidenceArtifact] });
    expect(result.data).toMatchObject({ hypotheses: [{ evidenceFactIds: [fact.id] }], judgment: { evidenceFactIds: [fact.id] } });
  });

  it("rejects fabricated facts, numbers and investment recommendations", async () => {
    const store = new RuntimeStore(":memory:"); stores.push(store);
    const provider: ModelProvider = { id: "fake", async generate() { return { provider: "fake", model: "unsafe", text: JSON.stringify({
      evidenceAssignments: [{ evidenceFactId: "fabricated-fact", role: "support", rationale: "目标价上涨 999%" }],
      hypotheses: [{ statement: "建议买入", evidenceFactIds: ["fabricated-fact"], falsificationConditions: [], distinguishingSignals: [] }],
      judgment: null, reviewFindings: [],
    }) }; } };
    const result = await requestBoundedResearchReasoning(store, provider, { task, node, facts: [fact], artifacts: [evidenceArtifact] });
    expect(result.data).toBeUndefined();
    expect(result.errors?.join(" ")).toMatch(/unauthorized fact|unauthorized EvidenceFact|prohibited investment recommendation|unsupported numeric token|falsification conditions/);
  });

  it("refuses external reasoning when a fact has no permission-scoped provenance", async () => {
    const store = new RuntimeStore(":memory:"); stores.push(store);
    let called = false;
    const provider: ModelProvider = { id: "external", async generate() { called = true; return { provider: "external", model: "x", text: "{}" }; } };
    const result = await requestBoundedResearchReasoning(store, provider, { task, node, facts: [fact], artifacts: [] });
    expect(result.errors).toEqual(["Model data policy forbids external egress"]);
    expect(called).toBe(false);
    expect(store.listModelCalls()).toEqual([expect.objectContaining({ status: "blocked" })]);
  });
});
