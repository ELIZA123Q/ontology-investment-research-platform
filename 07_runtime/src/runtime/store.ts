import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  ApprovalRequest,
  Artifact,
  Checkpoint,
  Conversation,
  Message,
  MemoryRecord,
  RunEvent,
  Task,
  TaskNode,
} from "@/src/contracts";

const now = () => new Date().toISOString();
const json = (value: unknown) => JSON.stringify(value);
const parse = <T>(value: unknown, fallback: T): T => (typeof value === "string" && value.length ? JSON.parse(value) as T : fallback);

export function defaultDatabasePath(): string {
  return process.env.VNEXT_DB_PATH || resolve(process.cwd(), ".data/vnext.sqlite");
}

export class RuntimeStore {
  readonly db: DatabaseSync;

  constructor(path = defaultDatabasePath()) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), parent_task_id TEXT,
        goal TEXT NOT NULL, intent TEXT NOT NULL, status TEXT NOT NULL, budget_json TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_nodes (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), kind TEXT NOT NULL, title TEXT NOT NULL,
        capability_type TEXT NOT NULL, capability_id TEXT NOT NULL, assigned_agent TEXT NOT NULL, depends_on_json TEXT NOT NULL,
        status TEXT NOT NULL, budget_json TEXT NOT NULL, input_artifact_ids_json TEXT NOT NULL,
        output_artifact_ids_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT NOT NULL, version INTEGER NOT NULL, conversation_id TEXT NOT NULL REFERENCES conversations(id),
        task_id TEXT NOT NULL REFERENCES tasks(id), node_id TEXT, kind TEXT NOT NULL, title TEXT NOT NULL,
        status TEXT NOT NULL, data_json TEXT NOT NULL, source_refs_json TEXT NOT NULL,
        created_by TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (id, version)
      );
      CREATE TABLE IF NOT EXISTS run_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
        conversation_id TEXT NOT NULL REFERENCES conversations(id), task_id TEXT, node_id TEXT,
        type TEXT NOT NULL, actor_type TEXT NOT NULL, actor_id TEXT NOT NULL,
        payload_json TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), node_id TEXT,
        phase TEXT NOT NULL, state_json TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id),
        task_id TEXT NOT NULL REFERENCES tasks(id), node_id TEXT, kind TEXT NOT NULL,
        prompt TEXT NOT NULL, status TEXT NOT NULL, decision_note TEXT, created_at TEXT NOT NULL, decided_at TEXT
      );
      CREATE TABLE IF NOT EXISTS tool_executions (
        idempotency_key TEXT PRIMARY KEY, tool_id TEXT NOT NULL, task_id TEXT NOT NULL,
        status TEXT NOT NULL, result_json TEXT, started_at TEXT NOT NULL, completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS runtime_jobs (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), kind TEXT NOT NULL,
        status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, available_at TEXT NOT NULL,
        locked_at TEXT, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memory_records (
        id TEXT PRIMARY KEY, conversation_id TEXT, kind TEXT NOT NULL, content TEXT NOT NULL,
        provenance_artifact_ids_json TEXT NOT NULL, reviewed_at TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS model_call_cache (
        fingerprint TEXT PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL,
        result_json TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS run_events_conversation_sequence ON run_events(conversation_id, sequence);
      CREATE INDEX IF NOT EXISTS tasks_conversation_updated ON tasks(conversation_id, updated_at);
      CREATE INDEX IF NOT EXISTS task_nodes_task_status ON task_nodes(task_id, status);
      CREATE INDEX IF NOT EXISTS artifacts_task_kind ON artifacts(task_id, kind);
      CREATE INDEX IF NOT EXISTS runtime_jobs_claim ON runtime_jobs(status, available_at);
    `);
    try {
      this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS research_fts USING fts5(ref_id UNINDEXED, kind UNINDEXED, title, body);`);
    } catch {
      // Some SQLite builds omit FTS5. The repository remains usable through structured queries.
    }
  }

  createConversation(title = "新的研究主题"): Conversation {
    const stamp = now();
    const item: Conversation = { id: randomUUID(), title, status: "active", createdAt: stamp, updatedAt: stamp };
    this.db.prepare("INSERT INTO conversations VALUES (?, ?, ?, ?, ?)").run(item.id, item.title, item.status, item.createdAt, item.updatedAt);
    this.appendEvent({ conversationId: item.id, type: "conversation.created", actorType: "system", actorId: "runtime", payload: { title } });
    return item;
  }

  getConversation(id: string): Conversation | null {
    const row = this.db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.mapConversation(row) : null;
  }

  listConversations(): Conversation[] {
    return (this.db.prepare("SELECT * FROM conversations ORDER BY updated_at DESC").all() as Record<string, unknown>[]).map(this.mapConversation);
  }

  addMessage(input: Omit<Message, "id" | "createdAt">): Message {
    const message: Message = { ...input, id: randomUUID(), createdAt: now() };
    this.db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(message.createdAt, message.conversationId);
    this.indexText(message.id, "message", "", message.content);
    this.appendEvent({ conversationId: message.conversationId, type: "message.created", actorType: message.actorType, actorId: message.actorId, payload: message });
    return message;
  }

  listMessages(conversationId: string): Message[] {
    return this.listEvents(conversationId, 0, 10_000).filter((event) => event.type === "message.created").map((event) => event.payload as Message);
  }

  createTask(input: Omit<Task, "id" | "createdAt" | "updatedAt">): Task {
    const stamp = now();
    const task: Task = { ...input, id: randomUUID(), createdAt: stamp, updatedAt: stamp };
    this.db.prepare("INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(task.id, task.conversationId, task.parentTaskId ?? null, task.goal, task.intent, task.status, json(task.budget), stamp, stamp);
    return task;
  }

  getTask(id: string): Task | null {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.mapTask(row) : null;
  }

  getLatestTask(conversationId: string): Task | null {
    const row = this.db.prepare("SELECT * FROM tasks WHERE conversation_id = ? ORDER BY updated_at DESC LIMIT 1").get(conversationId) as Record<string, unknown> | undefined;
    return row ? this.mapTask(row) : null;
  }

  listTasks(conversationId: string): Task[] {
    return (this.db.prepare("SELECT * FROM tasks WHERE conversation_id = ? ORDER BY created_at DESC").all(conversationId) as Record<string, unknown>[]).map(this.mapTask);
  }

  updateTaskStatus(id: string, status: Task["status"]): void {
    this.db.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?").run(status, now(), id);
  }

  addTaskNodes(nodes: TaskNode[]): void {
    const insert = this.db.prepare("INSERT INTO task_nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const n of nodes) insert.run(n.id, n.taskId, n.kind, n.title, n.capabilityType, n.capabilityId, n.assignedAgent, json(n.dependsOn), n.status, json(n.budget), json(n.inputArtifactIds), json(n.outputArtifactIds));
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listTaskNodes(taskId: string): TaskNode[] {
    return (this.db.prepare("SELECT * FROM task_nodes WHERE task_id = ? ORDER BY rowid").all(taskId) as Record<string, unknown>[]).map(this.mapNode);
  }

  getTaskNode(id: string): TaskNode | null {
    const row = this.db.prepare("SELECT * FROM task_nodes WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.mapNode(row) : null;
  }

  updateNode(id: string, patch: Partial<Pick<TaskNode, "status" | "inputArtifactIds" | "outputArtifactIds">>): void {
    const current = this.getTaskNode(id);
    if (!current) throw new Error(`Task node not found: ${id}`);
    const next = { ...current, ...patch };
    this.db.prepare("UPDATE task_nodes SET status = ?, input_artifact_ids_json = ?, output_artifact_ids_json = ? WHERE id = ?")
      .run(next.status, json(next.inputArtifactIds), json(next.outputArtifactIds), id);
  }

  putArtifact<T>(input: Omit<Artifact<T>, "id" | "version" | "createdAt"> & { id?: string }): Artifact<T> {
    const id = input.id || randomUUID();
    const prior = this.db.prepare("SELECT MAX(version) AS version FROM artifacts WHERE id = ?").get(id) as { version?: number | null };
    const artifact: Artifact<T> = { ...input, id, version: Number(prior.version || 0) + 1, createdAt: now() };
    this.db.prepare("INSERT INTO artifacts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(artifact.id, artifact.version, artifact.conversationId, artifact.taskId, artifact.nodeId ?? null, artifact.kind, artifact.title, artifact.status, json(artifact.data), json(artifact.sourceRefs), artifact.createdBy, artifact.createdAt);
    this.indexText(artifact.id, "artifact", artifact.title, json(artifact.data));
    return artifact;
  }

  getArtifact(id: string): Artifact | null {
    const row = this.db.prepare("SELECT * FROM artifacts WHERE id = ? ORDER BY version DESC LIMIT 1").get(id) as Record<string, unknown> | undefined;
    return row ? this.mapArtifact(row) : null;
  }

  listArtifacts(taskId: string): Artifact[] {
    return (this.db.prepare("SELECT a.* FROM artifacts a JOIN (SELECT id, MAX(version) version FROM artifacts GROUP BY id) latest ON a.id=latest.id AND a.version=latest.version WHERE task_id=? ORDER BY created_at").all(taskId) as Record<string, unknown>[]).map(this.mapArtifact);
  }

  appendEvent<T>(input: Omit<RunEvent<T>, "id" | "sequence" | "createdAt">): RunEvent<T> {
    const id = randomUUID();
    const createdAt = now();
    const result = this.db.prepare("INSERT INTO run_events (id, conversation_id, task_id, node_id, type, actor_type, actor_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, input.conversationId, input.taskId ?? null, input.nodeId ?? null, input.type, input.actorType, input.actorId, json(input.payload), createdAt);
    return { ...input, id, sequence: Number(result.lastInsertRowid), createdAt };
  }

  listEvents(conversationId: string, after = 0, limit = 500): RunEvent[] {
    return (this.db.prepare("SELECT * FROM run_events WHERE conversation_id=? AND sequence>? ORDER BY sequence LIMIT ?").all(conversationId, after, limit) as Record<string, unknown>[]).map((r) => ({
      id: String(r.id), sequence: Number(r.sequence), conversationId: String(r.conversation_id), taskId: r.task_id ? String(r.task_id) : undefined, nodeId: r.node_id ? String(r.node_id) : undefined, type: String(r.type), actorType: r.actor_type as RunEvent["actorType"], actorId: String(r.actor_id), payload: parse(r.payload_json, {}), createdAt: String(r.created_at),
    }));
  }

  checkpoint(input: Omit<Checkpoint, "id" | "createdAt">): Checkpoint {
    const item: Checkpoint = { ...input, id: randomUUID(), createdAt: now() };
    this.db.prepare("INSERT INTO checkpoints VALUES (?, ?, ?, ?, ?, ?)").run(item.id, item.taskId, item.nodeId ?? null, item.phase, json(item.state), item.createdAt);
    return item;
  }

  latestCheckpoint(taskId: string): Checkpoint | null {
    const r = this.db.prepare("SELECT * FROM checkpoints WHERE task_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(taskId) as Record<string, unknown> | undefined;
    return r ? { id: String(r.id), taskId: String(r.task_id), nodeId: r.node_id ? String(r.node_id) : undefined, phase: r.phase as Checkpoint["phase"], state: parse(r.state_json, {}), createdAt: String(r.created_at) } : null;
  }

  createApproval(input: Omit<ApprovalRequest, "id" | "status" | "createdAt">): ApprovalRequest {
    const item: ApprovalRequest = { ...input, id: randomUUID(), status: "pending", createdAt: now() };
    this.db.prepare("INSERT INTO approvals (id, conversation_id, task_id, node_id, kind, prompt, status, decision_note, created_at, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)")
      .run(item.id, item.conversationId, item.taskId, item.nodeId ?? null, item.kind, item.prompt, item.status, item.createdAt);
    return item;
  }

  getApproval(id: string): ApprovalRequest | null {
    const r = this.db.prepare("SELECT * FROM approvals WHERE id=?").get(id) as Record<string, unknown> | undefined;
    return r ? this.mapApproval(r) : null;
  }

  listPendingApprovals(conversationId: string): ApprovalRequest[] {
    return (this.db.prepare("SELECT * FROM approvals WHERE conversation_id=? AND status='pending' ORDER BY created_at").all(conversationId) as Record<string, unknown>[]).map(this.mapApproval);
  }

  decideApproval(id: string, status: "approved" | "rejected", note?: string): ApprovalRequest {
    this.db.prepare("UPDATE approvals SET status=?, decision_note=?, decided_at=? WHERE id=? AND status='pending'").run(status, note ?? null, now(), id);
    const item = this.getApproval(id);
    if (!item) throw new Error(`Approval not found: ${id}`);
    return item;
  }

  enqueueTask(taskId: string, kind: "execute" | "resume" = "execute"): string {
    const id = randomUUID();
    const stamp = now();
    this.db.prepare("INSERT INTO runtime_jobs VALUES (?, ?, ?, 'queued', 0, ?, NULL, NULL, ?, ?)").run(id, taskId, kind, stamp, stamp, stamp);
    return id;
  }

  claimJob(): { id: string; taskId: string; kind: string; attempts: number } | null {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db.prepare("SELECT * FROM runtime_jobs WHERE status='queued' AND available_at<=? ORDER BY created_at LIMIT 1").get(now()) as Record<string, unknown> | undefined;
      if (!row) { this.db.exec("COMMIT"); return null; }
      this.db.prepare("UPDATE runtime_jobs SET status='running', attempts=attempts+1, locked_at=?, updated_at=? WHERE id=?").run(now(), now(), String(row.id));
      this.db.exec("COMMIT");
      return { id: String(row.id), taskId: String(row.task_id), kind: String(row.kind), attempts: Number(row.attempts) + 1 };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  finishJob(id: string): void {
    this.db.prepare("UPDATE runtime_jobs SET status='completed', locked_at=NULL, updated_at=? WHERE id=?").run(now(), id);
  }

  failJob(id: string, error: string, retry = true): void {
    const available = new Date(Date.now() + 2_000).toISOString();
    this.db.prepare("UPDATE runtime_jobs SET status=?, available_at=?, locked_at=NULL, last_error=?, updated_at=? WHERE id=?")
      .run(retry ? "queued" : "failed", available, error, now(), id);
  }

  recoverStaleJobs(staleMs = 30_000): number {
    const cutoff = new Date(Date.now() - staleMs).toISOString();
    const result = this.db.prepare("UPDATE runtime_jobs SET status='queued', locked_at=NULL, last_error='worker lease expired', available_at=?, updated_at=? WHERE status='running' AND locked_at<?").run(now(), now(), cutoff);
    return Number(result.changes);
  }

  runToolOnce<T>(input: { key: string; toolId: string; taskId: string }, execute: () => T): { reused: boolean; result: T } {
    const existing = this.db.prepare("SELECT status, result_json FROM tool_executions WHERE idempotency_key=?").get(input.key) as { status?: string; result_json?: string } | undefined;
    if (existing?.status === "completed") return { reused: true, result: parse<T>(existing.result_json, undefined as T) };
    if (existing?.status === "running") throw new Error(`Tool execution already running: ${input.key}`);
    this.db.prepare("INSERT OR REPLACE INTO tool_executions VALUES (?, ?, ?, 'running', NULL, ?, NULL)").run(input.key, input.toolId, input.taskId, now());
    try {
      const result = execute();
      this.db.prepare("UPDATE tool_executions SET status='completed', result_json=?, completed_at=? WHERE idempotency_key=?").run(json(result), now(), input.key);
      return { reused: false, result };
    } catch (error) {
      this.db.prepare("DELETE FROM tool_executions WHERE idempotency_key=?").run(input.key);
      throw error;
    }
  }

  putMemory(input: Omit<MemoryRecord, "id" | "createdAt">): MemoryRecord {
    const item: MemoryRecord = { ...input, id: randomUUID(), createdAt: now() };
    this.db.prepare("INSERT INTO memory_records VALUES (?, ?, ?, ?, ?, ?, ?)").run(item.id, item.conversationId ?? null, item.kind, item.content, json(item.provenanceArtifactIds), item.reviewedAt ?? null, item.createdAt);
    return item;
  }

  listMemory(conversationId?: string): MemoryRecord[] {
    const rows = conversationId
      ? this.db.prepare("SELECT * FROM memory_records WHERE conversation_id=? OR conversation_id IS NULL ORDER BY created_at DESC").all(conversationId)
      : this.db.prepare("SELECT * FROM memory_records ORDER BY created_at DESC").all();
    return (rows as Record<string, unknown>[]).map((r) => ({ id: String(r.id), conversationId: r.conversation_id ? String(r.conversation_id) : undefined, kind: r.kind as MemoryRecord["kind"], content: String(r.content), provenanceArtifactIds: parse(r.provenance_artifact_ids_json, []), reviewedAt: r.reviewed_at ? String(r.reviewed_at) : undefined, createdAt: String(r.created_at) }));
  }

  getCachedModelResult<T>(fingerprint: string): T | null {
    const row = this.db.prepare("SELECT result_json FROM model_call_cache WHERE fingerprint=?").get(fingerprint) as { result_json?: string } | undefined;
    return row ? parse<T>(row.result_json, null as T) : null;
  }

  cacheModelResult(fingerprint: string, provider: string, model: string, result: unknown): void {
    this.db.prepare("INSERT OR REPLACE INTO model_call_cache VALUES (?, ?, ?, ?, ?)").run(fingerprint, provider, model, json(result), now());
  }

  private indexText(refId: string, kind: string, title: string, body: string): void {
    try { this.db.prepare("INSERT INTO research_fts (ref_id, kind, title, body) VALUES (?, ?, ?, ?)").run(refId, kind, title, body); } catch { /* optional FTS */ }
  }

  private mapConversation = (r: Record<string, unknown>): Conversation => ({ id: String(r.id), title: String(r.title), status: r.status as Conversation["status"], createdAt: String(r.created_at), updatedAt: String(r.updated_at) });
  private mapTask = (r: Record<string, unknown>): Task => ({ id: String(r.id), conversationId: String(r.conversation_id), parentTaskId: r.parent_task_id ? String(r.parent_task_id) : undefined, goal: String(r.goal), intent: r.intent as Task["intent"], status: r.status as Task["status"], budget: parse(r.budget_json, { maxModelCalls: 0, maxToolCalls: 0, maxCostUsd: 0 }), createdAt: String(r.created_at), updatedAt: String(r.updated_at) });
  private mapNode = (r: Record<string, unknown>): TaskNode => ({ id: String(r.id), taskId: String(r.task_id), kind: String(r.kind), title: String(r.title), capabilityType: r.capability_type as TaskNode["capabilityType"], capabilityId: String(r.capability_id), assignedAgent: r.assigned_agent as TaskNode["assignedAgent"], dependsOn: parse(r.depends_on_json, []), status: r.status as TaskNode["status"], budget: parse(r.budget_json, {}), inputArtifactIds: parse(r.input_artifact_ids_json, []), outputArtifactIds: parse(r.output_artifact_ids_json, []) });
  private mapArtifact = (r: Record<string, unknown>): Artifact => ({ id: String(r.id), version: Number(r.version), conversationId: String(r.conversation_id), taskId: String(r.task_id), nodeId: r.node_id ? String(r.node_id) : undefined, kind: r.kind as Artifact["kind"], title: String(r.title), status: r.status as Artifact["status"], data: parse(r.data_json, {}), sourceRefs: parse(r.source_refs_json, []), createdBy: String(r.created_by), createdAt: String(r.created_at) });
  private mapApproval = (r: Record<string, unknown>): ApprovalRequest => ({ id: String(r.id), conversationId: String(r.conversation_id), taskId: String(r.task_id), nodeId: r.node_id ? String(r.node_id) : undefined, kind: r.kind as ApprovalRequest["kind"], prompt: String(r.prompt), status: r.status as ApprovalRequest["status"], decisionNote: r.decision_note ? String(r.decision_note) : undefined, createdAt: String(r.created_at), decidedAt: r.decided_at ? String(r.decided_at) : undefined });
}

let singleton: RuntimeStore | undefined;
export function getRuntimeStore(): RuntimeStore {
  singleton ??= new RuntimeStore();
  return singleton;
}
