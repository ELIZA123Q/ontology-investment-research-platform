import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { knowledgeBundleManifestSchema } from "@investment/knowledge";
import { assertArtifactAllowed, type WorkOrder, type WorkerResult } from "@investment/domain";
import { DatabaseSync } from "node:sqlite";
import { SqliteRunLockRepository } from "@investment/persistence-sqlite";
import { DeterministicSupervisor, EARNINGS_UPDATE_GRAPH, WorkerRegistry } from "@investment/orchestrator";
import { TypedWorkerAdapter } from "@investment/adapters";

describe("workspace architecture", () => {
  it("enforces directed workspace dependencies", () => {
    expect(() => execFileSync(process.execPath, ["--import", "tsx", "scripts/audit-workspace-architecture.ts"], { cwd: process.cwd(), stdio: "pipe" })).not.toThrow();
  });

  it("rejects malformed knowledge bundle manifests", () => {
    expect(() => knowledgeBundleManifestSchema.parse({ schemaName: "investment_knowledge_bundle_manifest" })).toThrow();
  });

  it("prevents a worker from writing an unauthorized artifact", () => {
    const order = { id: "o", runId: "r", nodeId: "n", nodeKind: "evidence_capture", skillId: "evidence-research", assignedAgent: "evidence-investigator" as const, goal: "g", input: {}, inputArtifactIds: [], allowedOutputKinds: ["evidence_package" as const], knowledgeRefs: [], budget: { maxModelCalls: 1, maxToolCalls: 1, maxCostUsd: 1 }, idempotencyKey: "r:n:1", attempt: 1 };
    const contract = { agentId: "evidence-investigator" as const, contextPolicy: "delegated_slice" as const, writableArtifactKinds: ["evidence_package" as const], allowedNodeKinds: ["evidence_capture"] };
    const artifact = { id: "a", runId: "r", nodeId: "n", kind: "judgment" as const, schemaId: "x", schemaVersion: "1", content: {}, sourceRefs: [], knowledgeRefs: [], createdBy: "evidence-investigator" as const, createdAt: new Date().toISOString() };
    expect(() => assertArtifactAllowed(order, contract, artifact)).toThrow(/does not allow/);
  });

  it("locks a research run to one immutable knowledge bundle", () => {
    const db = new DatabaseSync(":memory:");
    const locks = new SqliteRunLockRepository(db);
    const first = `sha256:${"a".repeat(64)}` as const;
    const second = `sha256:${"b".repeat(64)}` as const;
    locks.installBundle(first, { bundleId: first });
    locks.installBundle(second, { bundleId: second });
    locks.lock({ runId: "run-1", researchCaseId: "case-1", bundleId: first, asOf: "2026-01-01T00:00:00.000Z", lockedAt: "2026-01-01T00:00:00.000Z" });
    expect(() => locks.lock({ runId: "run-1", researchCaseId: "case-1", bundleId: second, asOf: "2026-01-01T00:00:00.000Z", lockedAt: "2026-01-01T00:00:00.000Z" })).toThrow(/cannot switch/);
    db.close();
  });

  it("executes a typed worker only through the deterministic supervisor", async () => {
    const workOrders = new Map<string, WorkOrder>();
    const committed: unknown[] = [];
    const events: string[] = [];
    const order = {
      runId: "run-1", nodeId: "capture-1",
      node: { kind: "evidence_capture", skillId: "evidence-research", assignedAgent: "evidence-investigator" as const, dependsOn: [], outputKinds: ["evidence_package" as const], requiredKnowledgeAssets: ["task:earnings_update"], maxAttempts: 1 },
      goal: "核验业绩快报", input: {}, inputArtifactIds: [],
      knowledgeRefs: [{ bundleId: `sha256:${"a".repeat(64)}` as const, assetId: "task:earnings_update", version: "3.0.0", authorityRef: "02_scenario_task/03_tasks/earnings_update.yaml" }],
      budget: { maxModelCalls: 1, maxToolCalls: 1, maxCostUsd: 1 },
    };
    const repository = {
      findByIdempotencyKey: (key: string) => workOrders.get(key) || null,
      put: (value: WorkOrder) => { workOrders.set(value.idempotencyKey, value); },
      complete: (_value: WorkOrder, _result: WorkerResult) => undefined,
      putArtifact: (artifact: unknown) => { committed.push(artifact); },
      append: (event: { type: string }) => { events.push(event.type); },
    };
    const workers = new WorkerRegistry();
    workers.register(new TypedWorkerAdapter({ agentId: "evidence-investigator", contextPolicy: "delegated_slice", writableArtifactKinds: ["evidence_package"], allowedNodeKinds: ["evidence_capture"] }, async () => ({
      kind: "evidence_package", schemaId: "evidence-package", schemaVersion: "1.0.0", content: { verified: true }, sourceRefs: ["source:fixture"], knowledgeRefs: order.knowledgeRefs,
    })));
    const supervisor = new DeterministicSupervisor(workers, repository, repository, repository);
    expect(() => supervisor.createOrder({ ...order, nodeId: "normalize-1", node: EARNINGS_UPDATE_GRAPH[1] })).toThrow(/dependencies are unresolved/);
    const created = supervisor.createOrder(order);
    expect(supervisor.createOrder(order).id).toBe(created.id);
    expect((await supervisor.execute(created)).status).toBe("completed");
    expect(committed).toHaveLength(1);
    expect(events).toEqual(["work_order.queued", "work_order.started", "work_order.completed"]);
  });
});
