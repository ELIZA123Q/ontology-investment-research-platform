import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { ArtifactVersionConflictError, RuntimeStore } from "@/src/runtime/store";
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
    store.enqueueTask(task.id);
    const claimed = store.claimJob();
    expect(claimed).not.toBeNull();
    store.db.prepare("UPDATE runtime_jobs SET locked_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(claimed!.id);
    expect(store.recoverStaleJobs()).toBe(1);
    expect(store.claimJob()?.taskId).toBe(task.id);
  });

  it("boots a file-backed database with a global knowledge release", () => {
    const directory = mkdtempSync(join(tmpdir(), "vnext-store-"));
    try {
      const store = new RuntimeStore(join(directory, "runtime.sqlite"));
      stores.push(store);
      expect(store.getCurrentRelease({ kind: "global" })?.createdBy).toBe("bootstrap");
    } finally {
      stores.pop()?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("migrates pre-asOf knowledge locks without replacing the database", () => {
    const directory = mkdtempSync(join(tmpdir(), "vnext-migrate-"));
    const path = join(directory, "runtime.sqlite");
    try {
      const legacy = new DatabaseSync(path);
      legacy.exec(`CREATE TABLE knowledge_locks (
        id TEXT PRIMARY KEY, task_id TEXT UNIQUE NOT NULL, scope_json TEXT NOT NULL,
        global_release_id TEXT NOT NULL, tenant_release_id TEXT, user_release_id TEXT, user_memory_version INTEGER,
        asset_refs_json TEXT NOT NULL, fingerprint TEXT NOT NULL, created_at TEXT NOT NULL
      )`);
      legacy.close();
      const store = new RuntimeStore(path);
      stores.push(store);
      const columns = store.db.prepare("PRAGMA table_info(knowledge_locks)").all() as Array<{ name: string }>;
      expect(columns.some((column) => column.name === "as_of")).toBe(true);
    } finally {
      stores.pop()?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("adds research_case_id to legacy tasks without rewriting their identity", () => {
    const directory = mkdtempSync(join(tmpdir(), "vnext-task-migrate-"));
    const path = join(directory, "runtime.sqlite");
    try {
      const legacy = new DatabaseSync(path);
      legacy.exec(`
        CREATE TABLE conversations (
          id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE tasks (
          id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, parent_task_id TEXT,
          goal TEXT NOT NULL, intent TEXT NOT NULL, status TEXT NOT NULL, budget_json TEXT NOT NULL,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        INSERT INTO conversations VALUES ('legacy-conversation', '历史会话', 'active', '2026-01-01', '2026-01-01');
        INSERT INTO tasks VALUES ('legacy-task', 'legacy-conversation', NULL, '历史目标', 'full_research', 'completed', '{}', '2026-01-01', '2026-01-01');
      `);
      legacy.close();
      const store = new RuntimeStore(path);
      stores.push(store);
      const columns = store.db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
      expect(columns.some((column) => column.name === "research_case_id")).toBe(true);
      expect(columns.some((column) => column.name === "report_spec_json")).toBe(true);
      expect(store.getTask("legacy-task")?.researchCaseId).toBe("legacy-task");
      expect(store.getTask("legacy-task")?.reportSpec.sections).toContain("source_appendix");
    } finally {
      stores.pop()?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
