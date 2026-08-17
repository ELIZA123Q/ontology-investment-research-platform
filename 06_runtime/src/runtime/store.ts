import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  migrateLegacyRuntimeSchema,
  SqliteConnectorResponseRepository,
  SqliteTaskQueueRepository,
  SqliteWorkerRepository,
} from "@investment/persistence-sqlite";
import { assertToolExecutionAllowed, runtimeExecutionScope } from "@/src/capabilities/registry";
import type {
  Checkpoint,
  Conversation,
  ContextPackage,
  Message,
  MemoryRecord,
  ModelCallRecord,
  ProblemGraphEdge,
  ProblemGraphNode,
  ResearchProblemGraph,
  ResearchSignalCandidate,
  ResearchTrackingProfile,
  SignalRefreshRun,
  WorkspaceProjection,
  Task,
  TaskNode,
} from "@/src/contracts";
import type { Artifact } from "@/src/contracts/evidence";
import type { ApprovalRequest, RunEvent } from "@/src/contracts/execution";
import type {
  RuntimeJobKind,
} from "@/src/contracts/knowledge";
import { normalizeReportSpec } from "@/src/reporting/report-spec";
import { transitionState } from "@/src/runtime/state-machine";
import { SqliteKnowledgeRepository } from "@/src/persistence/knowledge-repository";
import { SqliteResearchRecordRepository } from "@/src/persistence/research-record-repository";
export { ApprovalDecisionConflictError, ArtifactVersionConflictError } from "@/src/persistence/research-record-repository";
const now = () => new Date().toISOString();
const json = (value: unknown) => JSON.stringify(value);
const parse = <T>(value: unknown, fallback: T): T => (typeof value === "string" && value.length ? JSON.parse(value) as T : fallback);
const fingerprint = (value: unknown) => `sha256:${createHash("sha256").update(json(value)).digest("hex")}`;
export function defaultDatabasePath(): string {
  if (process.env.VNEXT_DB_PATH) return process.env.VNEXT_DB_PATH;
  return resolve(process.cwd(), ".data/research-v2.sqlite");
}

export class RuntimeStore {
  readonly db: DatabaseSync;
  readonly connectorResponses: SqliteConnectorResponseRepository;
  readonly knowledge: SqliteKnowledgeRepository;
  readonly queue: SqliteTaskQueueRepository<RuntimeJobKind>;
  readonly records: SqliteResearchRecordRepository;
  readonly workers: SqliteWorkerRepository;
  private transactionDepth = 0;
  private transactionSequence = 0;

  constructor(path = defaultDatabasePath()) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    this.initializeSchema();
    this.connectorResponses = new SqliteConnectorResponseRepository(this.db);
    this.records = new SqliteResearchRecordRepository(this.db, {
      transaction: (work) => this.transaction(work),
      transition: (entity, status, command) => transitionState(entity, status, command),
    });
    this.queue = new SqliteTaskQueueRepository<RuntimeJobKind>(this.db, {
      transaction: (work) => this.transaction(work),
      transition: (status, command) => transitionState("RuntimeJob", status, command),
      task: (taskId) => this.getTask(taskId),
      append: (event) => this.records.appendEvent(event),
    }, "execute");
    this.workers = new SqliteWorkerRepository(this.db);
    this.knowledge = new SqliteKnowledgeRepository(this.db, {
      transaction: (work) => this.transaction(work),
      task: (id) => this.getTask(id),
      conversation: (id) => this.getConversation(id),
      append: (event) => this.records.appendEvent(event),
    });
    this.knowledge.ensureGlobalRelease();
  }

  close(): void {
    this.db.close();
  }

  /**
   * Runs a synchronous unit of work atomically. Nested callers use SAVEPOINTs so
   * aggregate services can own the outer transaction without breaking the
   * smaller atomic store operations they compose.
   */
  transaction<T>(work: () => T): T {
    const outermost = this.transactionDepth === 0;
    const savepoint = `runtime_tx_${++this.transactionSequence}`;
    this.db.exec(outermost ? "BEGIN IMMEDIATE" : `SAVEPOINT ${savepoint}`);
    this.transactionDepth += 1;
    try {
      const result = work();
      this.db.exec(outermost ? "COMMIT" : `RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      if (outermost) this.db.exec("ROLLBACK");
      else {
        this.db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        this.db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      }
      throw error;
    } finally {
      this.transactionDepth -= 1;
    }
  }

  private initializeSchema(): void {
    migrateLegacyRuntimeSchema(this.db);
  }

  listSchemaVersions(): Array<{ version: string; schemaHash: string; createdAt: string }> {
    return (this.db.prepare("SELECT * FROM runtime_schema_versions ORDER BY created_at, version").all() as Record<string, unknown>[])
      .map((row) => ({ version: String(row.version), schemaHash: String(row.schema_hash), createdAt: String(row.created_at) }));
  }

  integrityCheck(): { passed: boolean; details: string[] } {
    const rows = this.db.prepare("PRAGMA integrity_check").all() as Array<Record<string, unknown>>;
    const details = rows.flatMap((row) => Object.values(row).map(String));
    return { passed: details.length === 1 && details[0] === "ok", details };
  }

  createConversation(title = "新的研究主题", identity: { tenantId?: string; userId?: string } = {}): Conversation {
    const stamp = now();
    const item: Conversation = {
      id: randomUUID(), title, tenantId: identity.tenantId?.trim() || "default",
      userId: identity.userId?.trim() || "researcher", status: "active", createdAt: stamp, updatedAt: stamp,
    };
    this.db.prepare("INSERT INTO conversations (id,title,tenant_id,user_id,status,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(item.id, item.title, item.tenantId, item.userId, item.status, item.createdAt, item.updatedAt);
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

  getTrackingProfile(conversationId: string): ResearchTrackingProfile {
    const row = this.db.prepare("SELECT * FROM research_tracking_profiles WHERE conversation_id=?").get(conversationId) as Record<string, unknown> | undefined;
    if (row) return this.mapTrackingProfile(row);
    const conversation = this.getConversation(conversationId);
    if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);
    return { conversationId, enabled: true, symbols: [], keywords: [conversation.title], updatedAt: conversation.updatedAt };
  }

  listEnabledTrackingProfiles(): ResearchTrackingProfile[] {
    return this.listConversations().filter((conversation) => conversation.status === "active").map((conversation) => this.getTrackingProfile(conversation.id)).filter((profile) => profile.enabled);
  }

  putTrackingProfile(input: Omit<ResearchTrackingProfile, "updatedAt">): ResearchTrackingProfile {
    if (!this.getConversation(input.conversationId)) throw new Error(`Conversation not found: ${input.conversationId}`);
    const symbols = [...new Set(input.symbols.map((value) => value.trim()).filter(Boolean))];
    if (symbols.some((value) => !/^\d{6}$/.test(value))) throw new Error("A-share symbols must contain exactly six digits");
    const keywords = [...new Set(input.keywords.map((value) => value.trim()).filter(Boolean))].slice(0, 12);
    if (symbols.length > 20) throw new Error("At most 20 A-share symbols may be tracked");
    if (keywords.some((value) => value.length > 80)) throw new Error("Tracking keywords must be 80 characters or fewer");
    const updatedAt = now();
    this.db.prepare(`INSERT INTO research_tracking_profiles (conversation_id,enabled,symbols_json,keywords_json,updated_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(conversation_id) DO UPDATE SET enabled=excluded.enabled,
      symbols_json=excluded.symbols_json,keywords_json=excluded.keywords_json,updated_at=excluded.updated_at`)
      .run(input.conversationId, input.enabled ? 1 : 0, json(symbols), json(keywords), updatedAt);
    return { ...input, symbols, keywords, updatedAt };
  }

  createSignalRefreshRun(conversationIds: string[], connectorId = "akshare_public"): SignalRefreshRun {
    const createdAt = now();
    const run: SignalRefreshRun = { id: randomUUID(), connectorId, status: "queued", conversationIds, candidateCount: 0, createdAt };
    this.db.prepare(`INSERT INTO signal_refresh_runs (id,connector_id,status,conversation_ids_json,candidate_count,error,created_at,started_at,completed_at)
      VALUES (?, ?, ?, ?, 0, NULL, ?, NULL, NULL)`).run(run.id, connectorId, run.status, json(conversationIds), createdAt);
    return run;
  }

  updateSignalRefreshRun(id: string, patch: { status: SignalRefreshRun["status"]; candidateCount?: number; error?: string }): SignalRefreshRun {
    const current = this.getSignalRefreshRun(id);
    if (!current) throw new Error(`Signal refresh run not found: ${id}`);
    const startedAt = current.startedAt || (patch.status === "running" ? now() : undefined);
    const completedAt = ["completed", "partial", "failed"].includes(patch.status) ? now() : undefined;
    this.db.prepare(`UPDATE signal_refresh_runs SET status=?,candidate_count=?,error=?,started_at=?,completed_at=? WHERE id=?`)
      .run(patch.status, patch.candidateCount ?? current.candidateCount, patch.error || null, startedAt || null, completedAt || null, id);
    return this.getSignalRefreshRun(id)!;
  }

  getSignalRefreshRun(id: string): SignalRefreshRun | null {
    const row = this.db.prepare("SELECT * FROM signal_refresh_runs WHERE id=?").get(id) as Record<string, unknown> | undefined;
    return row ? this.mapSignalRefreshRun(row) : null;
  }

  latestSignalRefreshRun(): SignalRefreshRun | null {
    const row = this.db.prepare("SELECT * FROM signal_refresh_runs ORDER BY created_at DESC LIMIT 1").get() as Record<string, unknown> | undefined;
    return row ? this.mapSignalRefreshRun(row) : null;
  }

  upsertSignalCandidates(inputs: Array<Omit<ResearchSignalCandidate, "id" | "status" | "promotedTaskId"> & { content: string }>): number {
    const statement = this.db.prepare(`INSERT INTO research_signal_candidates
      (id,connector_id,conversation_id,kind,status,symbol,title,excerpt,content_text,publisher,source_uri,source_type,published_at,captured_at,match_reason,score,fingerprint,promoted_task_id)
      VALUES (?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(conversation_id,fingerprint) DO UPDATE SET title=excluded.title,excerpt=excluded.excerpt,content_text=excluded.content_text,
      publisher=excluded.publisher,source_uri=excluded.source_uri,source_type=excluded.source_type,published_at=excluded.published_at,
      captured_at=excluded.captured_at,match_reason=excluded.match_reason,score=excluded.score`);
    return this.transaction(() => {
      let changed = 0;
      for (const input of inputs) {
        const result = statement.run(randomUUID(), input.connectorId, input.conversationId, input.kind, input.symbol || null,
          input.title, input.excerpt, input.content, input.publisher, input.sourceUri, input.sourceType, input.publishedAt,
          input.capturedAt, input.matchReason, input.score, input.fingerprint);
        changed += Number(result.changes);
      }
      return changed;
    });
  }

  listSignalCandidates(options: { status?: ResearchSignalCandidate["status"]; limit?: number; conversationId?: string } = {}): ResearchSignalCandidate[] {
    const clauses: string[] = [];
    const values: Array<string | number> = [];
    if (options.status) { clauses.push("status=?"); values.push(options.status); }
    if (options.conversationId) { clauses.push("conversation_id=?"); values.push(options.conversationId); }
    const limit = Math.min(Math.max(options.limit || 30, 1), 100);
    const rows = this.db.prepare(`SELECT * FROM research_signal_candidates ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY score DESC,published_at DESC LIMIT ?`).all(...values, limit) as Record<string, unknown>[];
    return rows.map(this.mapSignalCandidate);
  }

  getSignalCandidate(id: string): (ResearchSignalCandidate & { content: string }) | null {
    const row = this.db.prepare("SELECT * FROM research_signal_candidates WHERE id=?").get(id) as Record<string, unknown> | undefined;
    return row ? { ...this.mapSignalCandidate(row), content: String(row.content_text) } : null;
  }

  decideSignalCandidate(id: string, status: ResearchSignalCandidate["status"], promotedTaskId?: string): ResearchSignalCandidate {
    const result = this.db.prepare("UPDATE research_signal_candidates SET status=?,promoted_task_id=COALESCE(?,promoted_task_id) WHERE id=?")
      .run(status, promotedTaskId || null, id);
    if (!Number(result.changes)) throw new Error(`Signal candidate not found: ${id}`);
    return this.getSignalCandidate(id)!;
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

  createTask(input: Omit<Task, "id" | "researchCaseId" | "reportSpec" | "createdAt" | "updatedAt"> & { researchCaseId?: string; reportSpec?: Task["reportSpec"] }): Task {
    const stamp = now();
    const id = randomUUID();
    const parentCaseId = input.parentTaskId ? this.getTask(input.parentTaskId)?.researchCaseId : undefined;
    const task: Task = { ...input, id, researchCaseId: input.researchCaseId || parentCaseId || id, reportSpec: input.reportSpec || normalizeReportSpec(), createdAt: stamp, updatedAt: stamp };
    this.db.prepare(`INSERT INTO tasks
      (id,conversation_id,research_case_id,parent_task_id,goal,intent,report_spec_json,status,outcome,budget_json,created_at,updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(task.id, task.conversationId, task.researchCaseId, task.parentTaskId ?? null, task.goal, task.intent, json(task.reportSpec), task.status, task.outcome ?? null, json(task.budget), stamp, stamp);
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

  getLatestTaskForResearchCase(researchCaseId: string): Task | null {
    const row = this.db.prepare("SELECT * FROM tasks WHERE research_case_id = ? ORDER BY updated_at DESC LIMIT 1").get(researchCaseId) as Record<string, unknown> | undefined;
    return row ? this.mapTask(row) : null;
  }

  listTasks(conversationId: string): Task[] {
    return (this.db.prepare("SELECT * FROM tasks WHERE conversation_id = ? ORDER BY created_at DESC").all(conversationId) as Record<string, unknown>[]).map(this.mapTask);
  }

  transitionTask(
    id: string,
    command: string,
    options: { actorType?: RunEvent["actorType"]; actorId?: string; payload?: Record<string, unknown> } = {},
  ): Task {
    return this.transaction(() => {
      const current = this.getTask(id);
      if (!current) throw new Error(`Task not found: ${id}`);
      const transition = transitionState("Task", current.status, command);
      let outcome: Task["outcome"];
      if (transition.to === "cancelled") outcome = "cancelled_by_user";
      else if (transition.to === "failed") outcome = "failed_technical";
      else if (transition.to === "completed") outcome = this.inferTaskOutcome(id);
      const stamp = now();
      const result = this.db.prepare("UPDATE tasks SET status=?,outcome=?,updated_at=? WHERE id=? AND status=?")
        .run(transition.to, outcome ?? null, stamp, id, transition.from);
      if (Number(result.changes) !== 1) throw new Error(`Task transition lost optimistic lock: ${id}`);
      this.appendEvent({
        conversationId: current.conversationId,
        taskId: current.id,
        type: transition.event,
        actorType: options.actorType || "system",
        actorId: options.actorId || "runtime",
        payload: { command, from: transition.from, to: transition.to, ...(options.payload || {}) },
      });
      return this.getTask(id)!;
    });
  }

  private inferTaskOutcome(taskId: string): Task["outcome"] {
    const artifacts = this.listArtifacts(taskId);
    const judgment = [...artifacts].reverse().find((artifact) => artifact.kind === "judgment" && artifact.title === "当前判断");
    const data = judgment?.data as { disposition?: string; lifecycleStatus?: string; ontologyJudgmentRef?: string; statement?: string } | undefined;
    if (data?.ontologyJudgmentRef || data?.lifecycleStatus === "approved" || (data?.disposition === "review_required" && data?.statement && data.statement !== "暂不可判断")) return "completed_supported";
    const evidenceFacts = artifacts.filter((artifact) => artifact.kind === "evidence_package" && artifact.title === "证据评估")
      .flatMap((artifact) => (artifact.data as { facts?: unknown[] }).facts || []);
    if (data?.disposition === "abstain" || data?.statement === "暂不可判断" || evidenceFacts.length === 0) return "stopped_insufficient_evidence";
    return "completed_indeterminate";
  }

  addTaskNodes(nodes: TaskNode[]): void {
    const insert = this.db.prepare(`INSERT INTO task_nodes
      (id,task_id,kind,title,capability_type,capability_id,assigned_agent,depends_on_json,status,budget_json,input_artifact_ids_json,output_artifact_ids_json,frontier_ref_json,iteration)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    this.transaction(() => {
      for (const n of nodes) insert.run(n.id, n.taskId, n.kind, n.title, n.capabilityType, n.capabilityId, n.assignedAgent, json(n.dependsOn), n.status, json(n.budget), json(n.inputArtifactIds), json(n.outputArtifactIds), json(n.frontierRef), n.iteration);
    });
  }

  listTaskNodes(taskId: string): TaskNode[] {
    return (this.db.prepare("SELECT * FROM task_nodes WHERE task_id = ? ORDER BY rowid").all(taskId) as Record<string, unknown>[]).map(this.mapNode);
  }

  getTaskNode(id: string): TaskNode | null {
    const row = this.db.prepare("SELECT * FROM task_nodes WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.mapNode(row) : null;
  }

  updateNode(id: string, patch: Partial<Pick<TaskNode, "inputArtifactIds" | "outputArtifactIds" | "frontierRef" | "iteration">>): void {
    const current = this.getTaskNode(id);
    if (!current) throw new Error(`Task node not found: ${id}`);
    const next = { ...current, ...patch };
    this.db.prepare("UPDATE task_nodes SET status = ?, input_artifact_ids_json = ?, output_artifact_ids_json = ?, frontier_ref_json = ?, iteration = ? WHERE id = ?")
      .run(next.status, json(next.inputArtifactIds), json(next.outputArtifactIds), json(next.frontierRef), next.iteration, id);
  }

  transitionNode(
    id: string,
    command: string,
    patch: Partial<Pick<TaskNode, "inputArtifactIds" | "outputArtifactIds" | "frontierRef" | "iteration">> = {},
    options: { actorType?: RunEvent["actorType"]; actorId?: string; payload?: Record<string, unknown> } = {},
  ): TaskNode {
    return this.transaction(() => {
      const current = this.getTaskNode(id);
      if (!current) throw new Error(`Task node not found: ${id}`);
      const task = this.getTask(current.taskId);
      if (!task) throw new Error(`Task not found: ${current.taskId}`);
      const transition = transitionState("TaskNode", current.status, command);
      const next = { ...current, ...patch, status: transition.to as TaskNode["status"] };
      const result = this.db.prepare("UPDATE task_nodes SET status=?,input_artifact_ids_json=?,output_artifact_ids_json=?,frontier_ref_json=?,iteration=? WHERE id=? AND status=?")
        .run(next.status, json(next.inputArtifactIds), json(next.outputArtifactIds), json(next.frontierRef), next.iteration, id, transition.from);
      if (Number(result.changes) !== 1) throw new Error(`TaskNode transition lost optimistic lock: ${id}`);
      this.appendEvent({
        conversationId: task.conversationId,
        taskId: task.id,
        nodeId: current.id,
        type: transition.event,
        actorType: options.actorType || "system",
        actorId: options.actorId || "runtime",
        payload: { command, from: transition.from, to: transition.to, ...(options.payload || {}) },
      });
      return this.getTaskNode(id)!;
    });
  }

  createProblemGraph(input: Omit<ResearchProblemGraph, "id" | "version" | "fingerprint" | "createdAt" | "updatedAt"> & { id?: string }): ResearchProblemGraph {
    const stamp = now();
    const graph: ResearchProblemGraph = {
      ...input,
      id: input.id || randomUUID(),
      version: 1,
      fingerprint: fingerprint({ taskId: input.taskId, researchCaseId: input.researchCaseId, intentRefs: input.intentRefs, scenarioRefs: input.scenarioRefs, taskMotifRefs: input.taskMotifRefs, nodes: input.nodes, edges: input.edges }),
      createdAt: stamp,
      updatedAt: stamp,
    };
    return this.transaction(() => {
      this.db.prepare(`INSERT INTO problem_graphs
        (id,task_id,research_case_id,version,status,intent_refs_json,scenario_refs_json,task_motif_refs_json,fingerprint,created_at,updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(graph.id, graph.taskId, graph.researchCaseId, graph.version, graph.status, json(graph.intentRefs), json(graph.scenarioRefs), json(graph.taskMotifRefs), graph.fingerprint, stamp, stamp);
      const insertNode = this.db.prepare(`INSERT INTO problem_graph_nodes
        (id,graph_id,node_key,type,title,state,required,motif_ref,semantic_ref,payload_json,resolved_artifact_ids_json,freshness_at,created_at,updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const node of graph.nodes) insertNode.run(node.id, graph.id, node.key, node.type, node.title, node.state, node.required ? 1 : 0, node.motifRef ?? null, node.semanticRef ?? null, json(node.payload), json(node.resolvedArtifactIds), node.freshnessAt ?? null, node.createdAt || stamp, node.updatedAt || stamp);
      const insertEdge = this.db.prepare("INSERT INTO problem_graph_edges (id,graph_id,from_node_id,to_node_id,relation,payload_json) VALUES (?, ?, ?, ?, ?, ?)");
      for (const edge of graph.edges) insertEdge.run(edge.id, graph.id, edge.fromNodeId, edge.toNodeId, edge.relation, json(edge.payload));
      return graph;
    });
  }

  getProblemGraph(taskId: string): ResearchProblemGraph | null {
    const row = this.db.prepare("SELECT * FROM problem_graphs WHERE task_id=?").get(taskId) as Record<string, unknown> | undefined;
    if (!row) return null;
    const graphId = String(row.id);
    const nodes = (this.db.prepare("SELECT * FROM problem_graph_nodes WHERE graph_id=? ORDER BY rowid").all(graphId) as Record<string, unknown>[]).map(this.mapProblemGraphNode);
    const edges = (this.db.prepare("SELECT * FROM problem_graph_edges WHERE graph_id=? ORDER BY rowid").all(graphId) as Record<string, unknown>[]).map(this.mapProblemGraphEdge);
    return { id: graphId, taskId: String(row.task_id), researchCaseId: String(row.research_case_id), version: Number(row.version), status: row.status as ResearchProblemGraph["status"], intentRefs: parse(row.intent_refs_json, []), scenarioRefs: parse(row.scenario_refs_json, []), taskMotifRefs: parse(row.task_motif_refs_json, []), fingerprint: String(row.fingerprint), nodes, edges, createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
  }

  updateProblemGraphNode(id: string, patch: Partial<Pick<ProblemGraphNode, "state" | "semanticRef" | "payload" | "resolvedArtifactIds" | "freshnessAt">>): ProblemGraphNode {
    const row = this.db.prepare("SELECT * FROM problem_graph_nodes WHERE id=?").get(id) as Record<string, unknown> | undefined;
    if (!row) throw new Error(`Problem graph node not found: ${id}`);
    const current = this.mapProblemGraphNode(row);
    const next = { ...current, ...patch, updatedAt: now() };
    this.db.prepare("UPDATE problem_graph_nodes SET state=?,semantic_ref=?,payload_json=?,resolved_artifact_ids_json=?,freshness_at=?,updated_at=? WHERE id=?")
      .run(next.state, next.semanticRef ?? null, json(next.payload), json(next.resolvedArtifactIds), next.freshnessAt ?? null, next.updatedAt, id);
    this.db.prepare("UPDATE problem_graphs SET version=version+1, updated_at=? WHERE id=?").run(next.updatedAt, next.graphId);
    return next;
  }

  putArtifact<T>(input: Omit<Artifact<T>, "id" | "version" | "createdAt"> & { id?: string }): Artifact<T> {
    return this.records.putArtifact(input);
  }

  reviseArtifact<T>(input: {
    id: string;
    expectedVersion: number;
    data: T;
    status?: Artifact["status"];
    createdBy: string;
  }): Artifact<T> {
    return this.records.reviseArtifact(input);
  }

  reviseArtifacts(inputs: Array<{
    id: string;
    expectedVersion: number;
    data: unknown;
    status?: Artifact["status"];
    createdBy: string;
  }>): Artifact[] {
    return this.records.reviseArtifacts(inputs);
  }

  getArtifact(id: string): Artifact | null {
    return this.records.getArtifact(id);
  }

  listArtifacts(taskId: string): Artifact[] {
    return this.records.listArtifacts(taskId);
  }

  appendEvent<T>(input: Omit<RunEvent<T>, "id" | "sequence" | "createdAt">): RunEvent<T> {
    return this.records.appendEvent(input);
  }

  listEvents(conversationId: string, after = 0, limit = 5_000): RunEvent[] {
    return this.records.listEvents(conversationId, after, limit);
  }

  checkpoint(input: Omit<Checkpoint, "id" | "status" | "createdAt">): Checkpoint {
    const item: Checkpoint = { ...input, id: randomUUID(), status: "current", createdAt: now() };
    return this.transaction(() => {
      const task = this.getTask(item.taskId);
      if (!task) throw new Error(`Task not found: ${item.taskId}`);
      const prior = this.latestCheckpoint(item.taskId);
      if (prior) {
        const replaced = transitionState("Checkpoint", prior.status, "replace");
        this.db.prepare("UPDATE checkpoints SET status=? WHERE id=? AND status=?").run(replaced.to, prior.id, replaced.from);
        this.appendEvent({ conversationId: task.conversationId, taskId: task.id, nodeId: prior.nodeId, type: replaced.event, actorType: "system", actorId: "checkpoint-service", payload: { checkpointId: prior.id, replacementId: item.id, command: "replace", from: replaced.from, to: replaced.to } });
      }
      const activated = transitionState("Checkpoint", "created", "activate");
      this.db.prepare("INSERT INTO checkpoints VALUES (?, ?, ?, ?, ?, ?, ?)").run(item.id, item.taskId, item.nodeId ?? null, item.status, item.phase, json(item.state), item.createdAt);
      this.appendEvent({ conversationId: task.conversationId, taskId: task.id, nodeId: item.nodeId, type: activated.event, actorType: "system", actorId: "checkpoint-service", payload: { checkpointId: item.id, command: "activate", from: activated.from, to: activated.to, phase: item.phase } });
      return item;
    });
  }

  getLatestCheckpoint(taskId: string): Checkpoint | null {
    return this.latestCheckpoint(taskId);
  }

  latestCheckpoint(taskId: string): Checkpoint | null {
    const r = this.db.prepare("SELECT * FROM checkpoints WHERE task_id=? AND status='current' ORDER BY created_at DESC, rowid DESC LIMIT 1").get(taskId) as Record<string, unknown> | undefined;
    return r ? { id: String(r.id), taskId: String(r.task_id), nodeId: r.node_id ? String(r.node_id) : undefined, status: r.status as Checkpoint["status"], phase: r.phase as Checkpoint["phase"], state: parse(r.state_json, {}), createdAt: String(r.created_at) } : null;
  }

  getWorkspaceProjection(taskId: string): WorkspaceProjection {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    const artifacts = this.listArtifacts(taskId);
    return {
      workspaceId: `workspace:${task.id}`,
      sessionId: task.conversationId,
      taskId: task.id,
      runId: `task-run:${task.id}`,
      status: task.status === "completed" ? "frozen" : task.status === "cancelled" ? "archived" : "active",
      resourceRefs: [
        { id: `task-input:${task.id}`, kind: "input", frozen: true },
        ...artifacts.map((artifact) => ({
          id: artifact.id,
          kind: artifact.kind === "evidence_package" ? "evidence_snapshot" as const : artifact.status === "verified" ? "final_artifact" as const : "intermediate_artifact" as const,
          version: artifact.version,
          frozen: artifact.status === "verified",
        })),
      ],
      updatedAt: task.updatedAt,
    };
  }

  createApproval(input: Omit<ApprovalRequest, "id" | "status" | "createdAt">): ApprovalRequest {
    return this.records.createApproval(input);
  }

  getApproval(id: string): ApprovalRequest | null {
    return this.records.getApproval(id);
  }

  listPendingApprovals(conversationId: string): ApprovalRequest[] {
    return this.records.listPendingApprovals(conversationId);
  }

  supersedePendingApprovals(nodeId: string, note: string): number {
    return this.records.supersedePendingApprovals(nodeId, note);
  }

  decideApproval(id: string, status: "approved" | "rejected", note?: string): ApprovalRequest {
    return this.records.decideApproval(id, status, note);
  }


  runToolOnce<T>(input: { key: string; toolId: string; taskId: string }, execute: () => T): { reused: boolean; result: T } {
    assertToolExecutionAllowed(input.toolId, runtimeExecutionScope());
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
    this.db.prepare(`INSERT INTO memory_records
      (id,conversation_id,kind,content,provenance_artifact_ids_json,reviewed_at,created_at,source_ref,freshness_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(item.id, item.conversationId ?? null, item.kind, item.content, json(item.provenanceArtifactIds), item.reviewedAt ?? null, item.createdAt, item.sourceRef, item.freshnessAt);
    return item;
  }

  listMemory(conversationId?: string): MemoryRecord[] {
    const rows = conversationId
      ? this.db.prepare("SELECT * FROM memory_records WHERE conversation_id=? OR conversation_id IS NULL ORDER BY created_at DESC").all(conversationId)
      : this.db.prepare("SELECT * FROM memory_records ORDER BY created_at DESC").all();
    return (rows as Record<string, unknown>[]).map((r) => ({ id: String(r.id), conversationId: r.conversation_id ? String(r.conversation_id) : undefined, kind: r.kind as MemoryRecord["kind"], content: String(r.content), provenanceArtifactIds: parse(r.provenance_artifact_ids_json, []), sourceRef: String(r.source_ref || `runtime://memory/${String(r.id)}`), freshnessAt: String(r.freshness_at || r.reviewed_at || r.created_at), reviewedAt: r.reviewed_at ? String(r.reviewed_at) : undefined, createdAt: String(r.created_at) }));
  }

  getCachedModelResult<T>(fingerprint: string): T | null {
    const row = this.db.prepare("SELECT result_json FROM model_call_cache WHERE fingerprint=?").get(fingerprint) as { result_json?: string } | undefined;
    return row ? parse<T>(row.result_json, null as T) : null;
  }

  cacheModelResult(fingerprint: string, provider: string, model: string, result: unknown): void {
    this.db.prepare("INSERT OR REPLACE INTO model_call_cache VALUES (?, ?, ?, ?, ?)").run(fingerprint, provider, model, json(result), now());
  }

  recordModelCall(input: Omit<ModelCallRecord, "id" | "createdAt" | "completedAt"> & { id?: string; createdAt?: string; completedAt?: string }): ModelCallRecord {
    const item: ModelCallRecord = {
      ...input,
      id: input.id || randomUUID(),
      createdAt: input.createdAt || now(),
      completedAt: input.completedAt || now(),
    };
    this.db.prepare(`INSERT INTO model_call_records (
      id, operation, fingerprint, provider, model, prompt_version, schema_version, context_hash,
      status, attempts, cache_hit, input_tokens, output_tokens, estimated_cost_usd,
      latency_ms, error, created_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      item.id, item.operation, item.fingerprint, item.provider, item.model, item.promptVersion,
      item.schemaVersion ?? null, item.contextHash, item.status, item.attempts, item.cacheHit ? 1 : 0,
      item.inputTokens ?? null, item.outputTokens ?? null, item.estimatedCostUsd ?? null,
      item.latencyMs, item.error ?? null, item.createdAt, item.completedAt,
    );
    return item;
  }

  listModelCalls(limit = 100): ModelCallRecord[] {
    const rows = this.db.prepare("SELECT * FROM model_call_records ORDER BY created_at DESC LIMIT ?").all(Math.max(1, Math.min(limit, 1000))) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: String(row.id), operation: String(row.operation), fingerprint: String(row.fingerprint),
      provider: String(row.provider), model: String(row.model), promptVersion: String(row.prompt_version),
      schemaVersion: row.schema_version ? String(row.schema_version) : undefined, contextHash: String(row.context_hash),
      status: row.status as ModelCallRecord["status"], attempts: Number(row.attempts), cacheHit: Boolean(row.cache_hit),
      inputTokens: row.input_tokens === null ? undefined : Number(row.input_tokens),
      outputTokens: row.output_tokens === null ? undefined : Number(row.output_tokens),
      estimatedCostUsd: row.estimated_cost_usd === null ? undefined : Number(row.estimated_cost_usd),
      latencyMs: Number(row.latency_ms), error: row.error ? String(row.error) : undefined,
      createdAt: String(row.created_at), completedAt: String(row.completed_at),
    }));
  }


  putContextPackage(input: Omit<ContextPackage, "id" | "assembledAt">): ContextPackage {
    const task = this.getTask(input.taskId);
    if (!task) throw new Error(`Task not found: ${input.taskId}`);
    const item: ContextPackage = { ...input, id: randomUUID(), assembledAt: now() };
    this.appendEvent({
      conversationId: task.conversationId, taskId: task.id, nodeId: item.nodeId, type: "context.assembled",
      actorType: "system", actorId: "context-builder", payload: item,
    });
    return item;
  }

  getContextPackage(taskId: string, nodeId?: string): ContextPackage | null {
    const task = this.getTask(taskId);
    if (!task) return null;
    const event = [...this.listEvents(task.conversationId, 0, 10_000)].reverse().find((item) =>
      item.taskId === taskId && item.type === "context.assembled" && (!nodeId || item.nodeId === nodeId));
    return event ? event.payload as ContextPackage : null;
  }


  private indexText(refId: string, kind: string, title: string, body: string): void {
    try { this.db.prepare("INSERT INTO research_fts (ref_id, kind, title, body) VALUES (?, ?, ?, ?)").run(refId, kind, title, body); } catch { /* optional FTS */ }
  }


  private mapConversation = (r: Record<string, unknown>): Conversation => ({
    id: String(r.id), title: String(r.title), tenantId: String(r.tenant_id || "default"), userId: String(r.user_id || "researcher"),
    status: r.status as Conversation["status"], createdAt: String(r.created_at), updatedAt: String(r.updated_at),
  });
  private mapTrackingProfile = (r: Record<string, unknown>): ResearchTrackingProfile => ({ conversationId: String(r.conversation_id), enabled: Boolean(r.enabled), symbols: parse<string[]>(r.symbols_json, []), keywords: parse<string[]>(r.keywords_json, []), updatedAt: String(r.updated_at) });
  private mapSignalRefreshRun = (r: Record<string, unknown>): SignalRefreshRun => ({ id: String(r.id), connectorId: String(r.connector_id), status: r.status as SignalRefreshRun["status"], conversationIds: parse<string[]>(r.conversation_ids_json, []), candidateCount: Number(r.candidate_count), error: r.error ? String(r.error) : undefined, createdAt: String(r.created_at), startedAt: r.started_at ? String(r.started_at) : undefined, completedAt: r.completed_at ? String(r.completed_at) : undefined });
  private mapSignalCandidate = (r: Record<string, unknown>): ResearchSignalCandidate => ({ id: String(r.id), connectorId: String(r.connector_id), conversationId: String(r.conversation_id), kind: r.kind as ResearchSignalCandidate["kind"], status: r.status as ResearchSignalCandidate["status"], symbol: r.symbol ? String(r.symbol) : undefined, title: String(r.title), excerpt: String(r.excerpt), publisher: String(r.publisher), sourceUri: String(r.source_uri), sourceType: r.source_type as ResearchSignalCandidate["sourceType"], publishedAt: String(r.published_at), capturedAt: String(r.captured_at), matchReason: String(r.match_reason), score: Number(r.score), fingerprint: String(r.fingerprint), promotedTaskId: r.promoted_task_id ? String(r.promoted_task_id) : undefined });
  private mapTask = (r: Record<string, unknown>): Task => ({ id: String(r.id), conversationId: String(r.conversation_id), researchCaseId: String(r.research_case_id), parentTaskId: r.parent_task_id ? String(r.parent_task_id) : undefined, goal: String(r.goal), intent: r.intent as Task["intent"], reportSpec: normalizeReportSpec(parse(r.report_spec_json, {})), status: r.status as Task["status"], outcome: r.outcome ? r.outcome as Task["outcome"] : undefined, budget: parse(r.budget_json, { maxModelCalls: 0, maxToolCalls: 0, maxCostUsd: 0 }), createdAt: String(r.created_at), updatedAt: String(r.updated_at) });
  private mapNode = (r: Record<string, unknown>): TaskNode => ({ id: String(r.id), taskId: String(r.task_id), kind: String(r.kind), title: String(r.title), capabilityType: r.capability_type as TaskNode["capabilityType"], capabilityId: String(r.capability_id), assignedAgent: r.assigned_agent as TaskNode["assignedAgent"], dependsOn: parse(r.depends_on_json, []), status: r.status as TaskNode["status"], budget: parse(r.budget_json, {}), inputArtifactIds: parse(r.input_artifact_ids_json, []), outputArtifactIds: parse(r.output_artifact_ids_json, []), frontierRef: parse(r.frontier_ref_json, { problemGraphId: `problem-graph:${String(r.task_id)}` }), iteration: Number(r.iteration || 0) });
  private mapProblemGraphNode = (r: Record<string, unknown>): ProblemGraphNode => ({
    id: String(r.id), graphId: String(r.graph_id), key: String(r.node_key), type: r.type as ProblemGraphNode["type"],
    title: String(r.title), state: r.state as ProblemGraphNode["state"], required: Boolean(r.required),
    motifRef: r.motif_ref ? String(r.motif_ref) : undefined, semanticRef: r.semantic_ref ? String(r.semantic_ref) : undefined,
    payload: parse<Record<string, unknown>>(r.payload_json, {}), resolvedArtifactIds: parse<string[]>(r.resolved_artifact_ids_json, []),
    freshnessAt: r.freshness_at ? String(r.freshness_at) : undefined, createdAt: String(r.created_at), updatedAt: String(r.updated_at),
  });
  private mapProblemGraphEdge = (r: Record<string, unknown>): ProblemGraphEdge => ({
    id: String(r.id), graphId: String(r.graph_id), fromNodeId: String(r.from_node_id), toNodeId: String(r.to_node_id),
    relation: r.relation as ProblemGraphEdge["relation"], payload: parse<Record<string, unknown>>(r.payload_json, {}),
  });
}

let singleton: RuntimeStore | undefined;
export function getRuntimeStore(): RuntimeStore {
  singleton ??= new RuntimeStore();
  return singleton;
}
