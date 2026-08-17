import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArtifactVersionConflictError, RuntimeStore } from "@/src/runtime/store";
import type { TaskNode } from "@/src/contracts";
import { randomUUID } from "node:crypto";
import { normalizeReportSpec } from "@/src/reporting/report-spec";

const stores: RuntimeStore[] = [];
const makeStore = () => { const store = new RuntimeStore(":memory:"); stores.push(store); return store; };
afterEach(() => { while (stores.length) stores.pop()?.close(); });

describe("runtime store", () => {
  it("uses event log for messages and avoids parallel trace/context entities", () => {
    const store = makeStore();
    const conversation = store.createConversation("测试");
    store.addMessage({ conversationId: conversation.id, actorType: "researcher", actorId: "researcher", content: "研究目标" });
    expect(store.listMessages(conversation.id)).toHaveLength(1);
    const tables = (store.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((row) => row.name);
    expect(tables).toContain("run_events");
    expect(tables).not.toContain("messages");
    expect(tables).not.toContain("trace_spans");
    expect(tables).not.toContain("context_packages");
  });

  it("deduplicates side-effect tools by idempotency key", () => {
    const store = makeStore();
    const conversation = store.createConversation("测试");
    const task = store.createTask({ conversationId: conversation.id, goal: "目标", intent: "full_research", status: "running", budget: { maxModelCalls: 1, maxToolCalls: 1, maxCostUsd: 1 } });
    let calls = 0;
    const first = store.runToolOnce({ key: "capture-1", toolId: "source.capture", taskId: task.id }, () => ({ value: ++calls }));
    const second = store.runToolOnce({ key: "capture-1", toolId: "source.capture", taskId: task.id }, () => ({ value: ++calls }));
    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.result.value).toBe(1);
    expect(calls).toBe(1);
  });

  it("stores only governed memory kinds and cached model fingerprints", () => {
    const store = makeStore();
    const conversation = store.createConversation("测试");
    store.putMemory({ conversationId: conversation.id, kind: "preference", content: "优先一手来源", provenanceArtifactIds: [], sourceRef: "researcher://preference/source-priority", freshnessAt: new Date().toISOString() });
    expect(store.listMemory(conversation.id)[0]?.kind).toBe("preference");
    store.cacheModelResult("fp", "openai", "model", { text: "cached" });
    expect(store.getCachedModelResult<{ text: string }>("fp")?.text).toBe("cached");
  });

  it("revises artifacts with optimistic locking and preserves version history", () => {
    const store = makeStore();
    const conversation = store.createConversation("测试");
    const task = store.createTask({ conversationId: conversation.id, goal: "目标", intent: "full_research", status: "running", budget: { maxModelCalls: 1, maxToolCalls: 1, maxCostUsd: 1 } });
    const artifact = store.putArtifact({ conversationId: conversation.id, taskId: task.id, kind: "judgment", title: "判断", status: "draft", data: { statement: "初稿" }, sourceRefs: [], createdBy: "research-lead" });
    const revised = store.reviseArtifact({ id: artifact.id, expectedVersion: 1, data: { statement: "研究员修订" }, createdBy: "researcher" });
    expect(revised).toMatchObject({ id: artifact.id, version: 2, data: { statement: "研究员修订" } });
    expect(() => store.reviseArtifact({ id: artifact.id, expectedVersion: 1, data: { statement: "覆盖别人修改" }, createdBy: "researcher" })).toThrow(ArtifactVersionConflictError);
    expect(Number((store.db.prepare("SELECT COUNT(*) count FROM artifacts WHERE id=?").get(artifact.id) as { count: number }).count)).toBe(2);
  });

  it("preserves optional report sections across task persistence", () => {
    const store = makeStore();
    const conversation = store.createConversation("报告规格");
    const reportSpec = normalizeReportSpec({ kind: "industry_research", optionalSections: ["scenario_analysis"] });
    const task = store.createTask({ conversationId: conversation.id, goal: "行业研究", intent: "full_research", reportSpec, status: "planned", budget: { maxModelCalls: 1, maxToolCalls: 1, maxCostUsd: 1 } });
    expect(task.reportSpec.sections).toContain("scenario_analysis");
    expect(store.getTask(task.id)?.reportSpec).toEqual(reportSpec);
  });

  it("recovers jobs whose worker lease expired", () => {
    const store = makeStore();
    const conversation = store.createConversation("测试");
    const task = store.createTask({ conversationId: conversation.id, goal: "目标", intent: "full_research", status: "queued", budget: { maxModelCalls: 1, maxToolCalls: 1, maxCostUsd: 1 } });
    store.queue.enqueueTask(task.id);
    const claimed = store.queue.claimJob();
    expect(claimed).not.toBeNull();
    store.db.prepare("UPDATE runtime_jobs SET locked_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(claimed!.id);
    expect(store.queue.recoverStaleJobs()).toBe(1);
    expect(store.queue.claimJob()?.taskId).toBe(task.id);
  });

  it("binds job completion to the worker that owns the lease and exposes retry/dead-letter queue metrics", () => {
    const store = makeStore();
    const conversation = store.createConversation("租约");
    const task = store.createTask({ conversationId: conversation.id, goal: "目标", intent: "full_research", status: "queued", budget: { maxModelCalls: 1, maxToolCalls: 1, maxCostUsd: 1 } });
    store.queue.enqueueTask(task.id);
    const claimed = store.queue.claimJob("worker:a")!;
    expect(store.queue.renewJobLease(claimed.id, "worker:a")).toBe(true);
    expect(store.queue.renewJobLease(claimed.id, "worker:b")).toBe(false);
    expect(() => store.queue.finishJob(claimed.id, "worker:b")).toThrow(/lease is not owned/);
    store.queue.failJob(claimed.id, "retryable", true, "worker:a");
    expect(store.workers.queueStats()).toMatchObject({ queued: 1, retrying: 1, deadLetter: 0 });
    store.db.prepare("UPDATE runtime_jobs SET available_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(claimed.id);
    const retried = store.queue.claimJob("worker:a")!;
    store.queue.failJob(retried.id, "terminal", false, "worker:a");
    expect(store.workers.queueStats()).toMatchObject({ failed: 1, deadLetter: 1 });
  });

  it("tracks node-job lease ownership and clears it during stale recovery", () => {
    const store = makeStore();
    const conversation = store.createConversation("节点租约");
    const task = store.createTask({ conversationId: conversation.id, goal: "目标", intent: "full_research", status: "queued", budget: { maxModelCalls: 1, maxToolCalls: 1, maxCostUsd: 1 } });
    const node: TaskNode = { id: randomUUID(), taskId: task.id, kind: "semantic_context", title: "上下文", capabilityType: "function", capabilityId: "context", assignedAgent: "research-lead", dependsOn: [], budget: {}, status: "pending", inputArtifactIds: [], outputArtifactIds: [], frontierRef: { problemGraphId: "graph", compilerBoundary: "scope" }, iteration: 0 };
    store.addTaskNodes([node]);
    store.queue.enqueueNode(task.id, node.id);
    const claimed = store.queue.claimNodeJob(3, "worker:a")!;
    expect(store.queue.renewNodeJobLease(claimed.id, "worker:a")).toBe(true);
    expect(() => store.queue.finishNodeJob(claimed.id, "worker:b")).toThrow(/lease is not owned/);
    store.db.prepare("UPDATE node_jobs SET locked_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(claimed.id);
    expect(store.queue.recoverStaleNodeJobs()).toBe(1);
    expect(store.db.prepare("SELECT leased_by FROM node_jobs WHERE id=?").get(claimed.id)).toMatchObject({ leased_by: null });
  });

  it("boots a file-backed database with a global knowledge release", () => {
    const directory = mkdtempSync(join(tmpdir(), "vnext-store-"));
    try {
      const store = new RuntimeStore(join(directory, "runtime.sqlite"));
      stores.push(store);
      expect(store.knowledge.getCurrentRelease({ kind: "global" })?.createdBy).toBe("bootstrap");
    } finally {
      stores.pop()?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

});
