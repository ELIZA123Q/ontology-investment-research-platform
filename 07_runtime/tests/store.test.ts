import { afterEach, describe, expect, it } from "vitest";
import { RuntimeStore } from "@/src/runtime/store";

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
    store.putMemory({ conversationId: conversation.id, kind: "preference", content: "优先一手来源", provenanceArtifactIds: [] });
    expect(store.listMemory(conversation.id)[0]?.kind).toBe("preference");
    store.cacheModelResult("fp", "openai", "model", { text: "cached" });
    expect(store.getCachedModelResult<{ text: string }>("fp")?.text).toBe("cached");
  });

  it("recovers jobs whose worker lease expired", () => {
    const store = makeStore();
    const conversation = store.createConversation("测试");
    const task = store.createTask({ conversationId: conversation.id, goal: "目标", intent: "full_research", status: "queued", budget: { maxModelCalls: 1, maxToolCalls: 1, maxCostUsd: 1 } });
    store.enqueueTask(task.id);
    const claimed = store.claimJob();
    expect(claimed).not.toBeNull();
    store.db.prepare("UPDATE runtime_jobs SET locked_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(claimed!.id);
    expect(store.recoverStaleJobs()).toBe(1);
    expect(store.claimJob()?.taskId).toBe(task.id);
  });
});
