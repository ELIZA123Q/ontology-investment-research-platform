import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  ApprovalRequest,
  Artifact,
  AssetCandidate,
  AssetKind,
  AssetRef,
  AssetRelease,
  AssetRevision,
  CandidateDecision,
  CandidateOccurrence,
  CandidateStatus,
  Checkpoint,
  Conversation,
  ContextPackage,
  EvaluationCase,
  EvaluationRun,
  EvaluationSummary,
  KnowledgeLock,
  KnowledgeScope,
  Message,
  MemoryRecord,
  MiningRun,
  ProblemGraphEdge,
  ProblemGraphNode,
  ResearchProblemGraph,
  RunEvent,
  RuntimeJobKind,
  Task,
  TaskNode,
  UsageObservation,
} from "@/src/contracts";
import { normalizeReportSpec } from "@/src/reporting/report-spec";

const now = () => new Date().toISOString();
const json = (value: unknown) => JSON.stringify(value);
const parse = <T>(value: unknown, fallback: T): T => (typeof value === "string" && value.length ? JSON.parse(value) as T : fallback);
const fingerprint = (value: unknown) => `sha256:${createHash("sha256").update(json(value)).digest("hex")}`;
const GLOBAL_AUTHORITY_REFS: AssetRef[] = [
  ["semantic", "ontology", "01_semantic_knowledge/registry.yaml"],
  ["tasks", "workflow", "02_scenario_task/registry.yaml"],
  ["capabilities", "method", "03_agent_capability/registry.yaml"],
  ["execution", "case", "04_context_state/registry.yaml"],
  ["governance", "rule", "05_control_evaluation/registry.yaml"],
].map(([domain, kind, authorityRef]) => ({
  assetId: `authority:${domain}`,
  kind: kind as AssetKind,
  identityKey: `authority:${domain}`,
  scope: { kind: "global" },
  version: 1,
  fingerprint: fingerprint({ authorityRef, version: 1 }),
  authorityRef,
}));

export interface ConnectorResponseBlobMetadata {
  fingerprint: string;
  connectorId: string;
  operation: string;
  byteLength: number;
  permissionScope: string;
  replayability: "replayable" | "time_sensitive" | "non_replayable";
  usageRestriction: string;
  riskDisclosure?: string;
  capturedAt: string;
}

export interface ConnectorResponseBlobInput extends ConnectorResponseBlobMetadata {
  body: string;
}

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

  putConnectorResponseBlob(input: ConnectorResponseBlobInput): ConnectorResponseBlobMetadata {
    const calculated = `sha256:${createHash("sha256").update(input.body, "utf8").digest("hex")}`;
    if (calculated !== input.fingerprint) throw new Error("connector response body does not match its fingerprint");
    if (!input.connectorId.trim() || !input.operation.trim()) throw new Error("connector response identity is required");
    if (!input.usageRestriction.trim()) throw new Error("connector response usage restriction is required");
    if (Number.isNaN(Date.parse(input.capturedAt))) throw new Error("connector response capturedAt must be an ISO timestamp");
    const byteLength = Buffer.byteLength(input.body, "utf8");
    if (input.byteLength !== byteLength) throw new Error("connector response byte length mismatch");
    const normalized = {
      ...input,
      connectorId: input.connectorId.trim(),
      operation: input.operation.trim(),
      usageRestriction: input.usageRestriction.trim(),
      riskDisclosure: input.riskDisclosure?.trim() || undefined,
      capturedAt: new Date(input.capturedAt).toISOString(),
      byteLength,
    };
    const existing = this.getConnectorResponseBlobMetadata(input.fingerprint);
    if (existing) {
      const comparable = ({ fingerprint: hash, connectorId, operation, byteLength: bytes, permissionScope, replayability, usageRestriction, riskDisclosure, capturedAt }: ConnectorResponseBlobMetadata) =>
        ({ fingerprint: hash, connectorId, operation, byteLength: bytes, permissionScope, replayability, usageRestriction, riskDisclosure, capturedAt });
      if (json(comparable(existing)) !== json(comparable(normalized))) throw new Error("connector response fingerprint is already bound to different metadata");
      return existing;
    }
    this.db.prepare(`INSERT INTO connector_response_blobs
      (fingerprint,connector_id,operation,body,byte_length,permission_scope,replayability,usage_restriction,risk_disclosure,captured_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(normalized.fingerprint, normalized.connectorId, normalized.operation, normalized.body, normalized.byteLength,
        normalized.permissionScope, normalized.replayability, normalized.usageRestriction, normalized.riskDisclosure || null, normalized.capturedAt);
    return this.getConnectorResponseBlobMetadata(input.fingerprint)!;
  }

  getConnectorResponseBlobMetadata(fingerprintValue: string): ConnectorResponseBlobMetadata | null {
    const row = this.db.prepare(`SELECT fingerprint,connector_id,operation,byte_length,permission_scope,replayability,
      usage_restriction,risk_disclosure,captured_at FROM connector_response_blobs WHERE fingerprint=?`).get(fingerprintValue) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      fingerprint: String(row.fingerprint), connectorId: String(row.connector_id), operation: String(row.operation),
      byteLength: Number(row.byte_length), permissionScope: String(row.permission_scope),
      replayability: String(row.replayability) as ConnectorResponseBlobMetadata["replayability"],
      usageRestriction: String(row.usage_restriction), riskDisclosure: row.risk_disclosure ? String(row.risk_disclosure) : undefined,
      capturedAt: String(row.captured_at),
    };
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT 'default', user_id TEXT NOT NULL DEFAULT 'researcher', status TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), research_case_id TEXT NOT NULL DEFAULT '', parent_task_id TEXT,
        goal TEXT NOT NULL, intent TEXT NOT NULL, report_spec_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL, budget_json TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_nodes (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), kind TEXT NOT NULL, title TEXT NOT NULL,
        capability_type TEXT NOT NULL, capability_id TEXT NOT NULL, assigned_agent TEXT NOT NULL, depends_on_json TEXT NOT NULL,
        status TEXT NOT NULL, budget_json TEXT NOT NULL, input_artifact_ids_json TEXT NOT NULL,
        output_artifact_ids_json TEXT NOT NULL, frontier_ref_json TEXT NOT NULL DEFAULT '{}', iteration INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS problem_graphs (
        id TEXT PRIMARY KEY, task_id TEXT UNIQUE NOT NULL REFERENCES tasks(id), research_case_id TEXT NOT NULL,
        version INTEGER NOT NULL, status TEXT NOT NULL, intent_refs_json TEXT NOT NULL, scenario_refs_json TEXT NOT NULL,
        task_motif_refs_json TEXT NOT NULL, fingerprint TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS problem_graph_nodes (
        id TEXT PRIMARY KEY, graph_id TEXT NOT NULL REFERENCES problem_graphs(id), node_key TEXT NOT NULL,
        type TEXT NOT NULL, title TEXT NOT NULL, state TEXT NOT NULL, required INTEGER NOT NULL,
        motif_ref TEXT, semantic_ref TEXT, payload_json TEXT NOT NULL, resolved_artifact_ids_json TEXT NOT NULL,
        freshness_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(graph_id, node_key)
      );
      CREATE TABLE IF NOT EXISTS problem_graph_edges (
        id TEXT PRIMARY KEY, graph_id TEXT NOT NULL REFERENCES problem_graphs(id), from_node_id TEXT NOT NULL REFERENCES problem_graph_nodes(id),
        to_node_id TEXT NOT NULL REFERENCES problem_graph_nodes(id), relation TEXT NOT NULL, payload_json TEXT NOT NULL,
        UNIQUE(graph_id, from_node_id, to_node_id, relation)
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
      CREATE TABLE IF NOT EXISTS connector_response_blobs (
        fingerprint TEXT PRIMARY KEY, connector_id TEXT NOT NULL, operation TEXT NOT NULL,
        body TEXT NOT NULL, byte_length INTEGER NOT NULL, permission_scope TEXT NOT NULL,
        replayability TEXT NOT NULL, usage_restriction TEXT NOT NULL, risk_disclosure TEXT,
        captured_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS knowledge_locks (
        id TEXT PRIMARY KEY, task_id TEXT UNIQUE NOT NULL REFERENCES tasks(id), scope_json TEXT NOT NULL,
        global_release_id TEXT NOT NULL, tenant_release_id TEXT, user_release_id TEXT, user_memory_version INTEGER,
        as_of TEXT NOT NULL, asset_refs_json TEXT NOT NULL, fingerprint TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mining_runs (
        id TEXT PRIMARY KEY, task_id TEXT UNIQUE NOT NULL REFERENCES tasks(id), status TEXT NOT NULL,
        extractor_version TEXT NOT NULL, knowledge_lock_id TEXT NOT NULL REFERENCES knowledge_locks(id),
        candidate_count INTEGER NOT NULL DEFAULT 0, error TEXT, started_at TEXT, completed_at TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS asset_revisions (
        id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, kind TEXT NOT NULL, scope_json TEXT NOT NULL,
        version INTEGER NOT NULL, status TEXT NOT NULL, content_json TEXT NOT NULL, content_ref TEXT,
        fingerprint TEXT NOT NULL, provenance_refs_json TEXT NOT NULL, valid_from TEXT, valid_to TEXT,
        supersedes_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(asset_id, version)
      );
      CREATE TABLE IF NOT EXISTS asset_candidates (
        id TEXT PRIMARY KEY, mining_run_id TEXT NOT NULL REFERENCES mining_runs(id), task_id TEXT NOT NULL REFERENCES tasks(id),
        scope_json TEXT NOT NULL, asset_kind TEXT NOT NULL, operation TEXT NOT NULL, identity_key TEXT NOT NULL,
        target_asset_ref_json TEXT, proposed_revision_id TEXT NOT NULL REFERENCES asset_revisions(id),
        provenance_refs_json TEXT NOT NULL, run_baseline_fingerprint TEXT NOT NULL,
        current_baseline_fingerprint TEXT NOT NULL, risk_level INTEGER NOT NULL,
        confidence REAL NOT NULL, novelty REAL NOT NULL, conflicts_json TEXT NOT NULL,
        status TEXT NOT NULL, evaluation_summary_json TEXT, decision_note TEXT, reviewed_by TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(mining_run_id, identity_key)
      );
      CREATE TABLE IF NOT EXISTS candidate_occurrences (
        id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL REFERENCES asset_candidates(id), task_id TEXT NOT NULL REFERENCES tasks(id),
        artifact_id TEXT, event_sequence INTEGER, observed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS candidate_decisions (
        id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL REFERENCES asset_candidates(id), reviewer TEXT NOT NULL,
        reviewer_role TEXT NOT NULL, decision TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(candidate_id, reviewer_role, reviewer)
      );
      CREATE TABLE IF NOT EXISTS evaluation_cases (
        id TEXT PRIMARY KEY, scope_json TEXT NOT NULL, source_task_id TEXT NOT NULL REFERENCES tasks(id),
        name TEXT NOT NULL, input_snapshot_json TEXT NOT NULL, assertions_json TEXT NOT NULL,
        status TEXT NOT NULL, deidentified INTEGER NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS evaluation_runs (
        id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL REFERENCES asset_candidates(id), status TEXT NOT NULL,
        case_ids_json TEXT NOT NULL, baseline_release_id TEXT NOT NULL, summary_json TEXT NOT NULL,
        created_at TEXT NOT NULL, completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS asset_releases (
        id TEXT PRIMARY KEY, scope_json TEXT NOT NULL, scope_key TEXT NOT NULL, parent_release_id TEXT,
        rollback_of_release_id TEXT, status TEXT NOT NULL, candidate_ids_json TEXT NOT NULL, asset_refs_json TEXT NOT NULL,
        fingerprint TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS release_members (
        release_id TEXT NOT NULL REFERENCES asset_releases(id), asset_id TEXT NOT NULL, revision_id TEXT NOT NULL REFERENCES asset_revisions(id),
        PRIMARY KEY(release_id, asset_id)
      );
      CREATE TABLE IF NOT EXISTS asset_usage (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), asset_ref_json TEXT NOT NULL,
        selected_reason TEXT NOT NULL, outcome TEXT NOT NULL, observed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ontology_objects (
        id TEXT PRIMARY KEY, type TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL,
        properties_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ontology_links (
        id TEXT PRIMARY KEY, type TEXT NOT NULL, source_id TEXT NOT NULL, source_type TEXT NOT NULL,
        target_id TEXT NOT NULL, target_type TEXT NOT NULL, version INTEGER NOT NULL,
        properties_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(type, source_id, target_id)
      );
      CREATE TABLE IF NOT EXISTS action_executions (
        id TEXT PRIMARY KEY, action_type TEXT NOT NULL, action_version TEXT NOT NULL, status TEXT NOT NULL,
        actor_type TEXT NOT NULL, actor_id TEXT NOT NULL, conversation_id TEXT, task_id TEXT,
        idempotency_key TEXT NOT NULL, knowledge_lock_id TEXT, approval_id TEXT,
        request_json TEXT NOT NULL, preview_json TEXT NOT NULL, edits_json TEXT NOT NULL,
        output_refs_json TEXT NOT NULL, invalidated_refs_json TEXT NOT NULL, error TEXT,
        created_at TEXT NOT NULL, completed_at TEXT, UNIQUE(action_type, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS run_events_conversation_sequence ON run_events(conversation_id, sequence);
      CREATE INDEX IF NOT EXISTS tasks_conversation_updated ON tasks(conversation_id, updated_at);
      CREATE INDEX IF NOT EXISTS task_nodes_task_status ON task_nodes(task_id, status);
      CREATE INDEX IF NOT EXISTS artifacts_task_kind ON artifacts(task_id, kind);
      CREATE INDEX IF NOT EXISTS runtime_jobs_claim ON runtime_jobs(status, available_at);
      CREATE INDEX IF NOT EXISTS connector_response_blobs_connector ON connector_response_blobs(connector_id, operation, captured_at);
      CREATE INDEX IF NOT EXISTS asset_candidates_status_risk ON asset_candidates(status, risk_level, updated_at);
      CREATE INDEX IF NOT EXISTS asset_candidates_identity ON asset_candidates(identity_key, asset_kind);
      CREATE INDEX IF NOT EXISTS asset_revisions_lookup ON asset_revisions(asset_id, version DESC);
      CREATE INDEX IF NOT EXISTS asset_releases_current ON asset_releases(scope_key, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS asset_usage_task ON asset_usage(task_id, observed_at);
      CREATE INDEX IF NOT EXISTS ontology_objects_type_status ON ontology_objects(type, status, updated_at);
      CREATE INDEX IF NOT EXISTS ontology_links_source ON ontology_links(source_id, type);
      CREATE INDEX IF NOT EXISTS ontology_links_target ON ontology_links(target_id, type);
      CREATE INDEX IF NOT EXISTS action_executions_context ON action_executions(conversation_id, task_id, created_at);
    `);
    this.ensureColumn("conversations", "tenant_id", "TEXT NOT NULL DEFAULT 'default'");
    this.ensureColumn("conversations", "user_id", "TEXT NOT NULL DEFAULT 'researcher'");
    this.ensureColumn("knowledge_locks", "user_release_id", "TEXT");
    this.ensureColumn("knowledge_locks", "as_of", "TEXT");
    this.ensureColumn("asset_releases", "rollback_of_release_id", "TEXT");
    this.ensureColumn("tasks", "research_case_id", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("tasks", "report_spec_json", "TEXT NOT NULL DEFAULT '{}'");
    this.ensureColumn("task_nodes", "frontier_ref_json", "TEXT NOT NULL DEFAULT '{}'");
    this.ensureColumn("task_nodes", "iteration", "INTEGER NOT NULL DEFAULT 0");
    try {
      this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS research_fts USING fts5(ref_id UNINDEXED, kind UNINDEXED, title, body);`);
    } catch {
      // Some SQLite builds omit FTS5. The repository remains usable through structured queries.
    }
    this.ensureGlobalRelease();
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((item) => item.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
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
      (id,conversation_id,research_case_id,parent_task_id,goal,intent,report_spec_json,status,budget_json,created_at,updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(task.id, task.conversationId, task.researchCaseId, task.parentTaskId ?? null, task.goal, task.intent, json(task.reportSpec), task.status, json(task.budget), stamp, stamp);
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
    const insert = this.db.prepare(`INSERT INTO task_nodes
      (id,task_id,kind,title,capability_type,capability_id,assigned_agent,depends_on_json,status,budget_json,input_artifact_ids_json,output_artifact_ids_json,frontier_ref_json,iteration)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const n of nodes) insert.run(n.id, n.taskId, n.kind, n.title, n.capabilityType, n.capabilityId, n.assignedAgent, json(n.dependsOn), n.status, json(n.budget), json(n.inputArtifactIds), json(n.outputArtifactIds), json(n.frontierRef), n.iteration);
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
    this.db.exec("BEGIN IMMEDIATE");
    try {
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
      this.db.exec("COMMIT");
      return graph;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
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
    const id = input.id || randomUUID();
    const prior = this.db.prepare("SELECT MAX(version) AS version FROM artifacts WHERE id = ?").get(id) as { version?: number | null };
    const artifact: Artifact<T> = { ...input, id, version: Number(prior.version || 0) + 1, createdAt: now() };
    this.db.prepare("INSERT INTO artifacts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(artifact.id, artifact.version, artifact.conversationId, artifact.taskId, artifact.nodeId ?? null, artifact.kind, artifact.title, artifact.status, json(artifact.data), json(artifact.sourceRefs), artifact.createdBy, artifact.createdAt);
    this.indexText(artifact.id, "artifact", artifact.title, json(artifact.data));
    return artifact;
  }

  reviseArtifact<T>(input: {
    id: string;
    expectedVersion: number;
    data: T;
    status?: Artifact["status"];
    createdBy: string;
  }): Artifact<T> {
    return this.reviseArtifacts([input])[0] as Artifact<T>;
  }

  reviseArtifacts(inputs: Array<{
    id: string;
    expectedVersion: number;
    data: unknown;
    status?: Artifact["status"];
    createdBy: string;
  }>): Artifact[] {
    if (!inputs.length) throw new Error("At least one artifact revision is required");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = inputs.map((input) => {
        const artifact = this.getArtifact(input.id);
        if (!artifact) throw new Error(`Artifact not found: ${input.id}`);
        if (artifact.version !== input.expectedVersion) throw new ArtifactVersionConflictError(input.id, input.expectedVersion, artifact.version);
        return artifact;
      });
      const revisions = inputs.map((input, index): Artifact => ({
        ...current[index],
        version: current[index].version + 1,
        data: input.data,
        status: input.status || "draft",
        createdBy: input.createdBy,
        createdAt: now(),
      }));
      const insert = this.db.prepare("INSERT INTO artifacts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const artifact of revisions) {
        insert.run(artifact.id, artifact.version, artifact.conversationId, artifact.taskId, artifact.nodeId ?? null, artifact.kind, artifact.title, artifact.status, json(artifact.data), json(artifact.sourceRefs), artifact.createdBy, artifact.createdAt);
      }
      this.db.exec("COMMIT");
      for (const artifact of revisions) this.indexText(artifact.id, "artifact", artifact.title, json(artifact.data));
      return revisions;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
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

  supersedePendingApprovals(nodeId: string, note: string): number {
    const result = this.db.prepare("UPDATE approvals SET status='rejected', decision_note=?, decided_at=? WHERE node_id=? AND status='pending'")
      .run(note, now(), nodeId);
    return Number(result.changes);
  }

  decideApproval(id: string, status: "approved" | "rejected", note?: string): ApprovalRequest {
    const result = this.db.prepare("UPDATE approvals SET status=?, decision_note=?, decided_at=? WHERE id=? AND status='pending'").run(status, note ?? null, now(), id);
    const item = this.getApproval(id);
    if (!item) throw new Error(`Approval not found: ${id}`);
    if (Number(result.changes) !== 1) throw new ApprovalDecisionConflictError(id, item.status);
    return item;
  }

  enqueueTask(taskId: string, kind: RuntimeJobKind = "execute"): string {
    const existing = this.db.prepare("SELECT id FROM runtime_jobs WHERE task_id=? AND kind=? AND status IN ('queued','running') ORDER BY created_at LIMIT 1")
      .get(taskId, kind) as { id?: string } | undefined;
    if (existing?.id) return existing.id;
    const id = randomUUID();
    const stamp = now();
    this.db.prepare("INSERT INTO runtime_jobs VALUES (?, ?, ?, 'queued', 0, ?, NULL, NULL, ?, ?)").run(id, taskId, kind, stamp, stamp, stamp);
    return id;
  }

  claimJob(): { id: string; taskId: string; kind: RuntimeJobKind; attempts: number } | null {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db.prepare("SELECT * FROM runtime_jobs WHERE status='queued' AND available_at<=? ORDER BY created_at LIMIT 1").get(now()) as Record<string, unknown> | undefined;
      if (!row) { this.db.exec("COMMIT"); return null; }
      this.db.prepare("UPDATE runtime_jobs SET status='running', attempts=attempts+1, locked_at=?, updated_at=? WHERE id=?").run(now(), now(), String(row.id));
      this.db.exec("COMMIT");
      return { id: String(row.id), taskId: String(row.task_id), kind: String(row.kind) as RuntimeJobKind, attempts: Number(row.attempts) + 1 };
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

  scopeKey(scope: KnowledgeScope): string {
    if (scope.kind === "global") return "global";
    if (scope.kind === "tenant") return `tenant:${scope.tenantId}`;
    return `user:${scope.tenantId}:${scope.userId}`;
  }

  getCurrentRelease(scope: KnowledgeScope): AssetRelease | null {
    const row = this.db.prepare("SELECT * FROM asset_releases WHERE scope_key=? AND status='current' ORDER BY created_at DESC LIMIT 1")
      .get(this.scopeKey(scope)) as Record<string, unknown> | undefined;
    return row ? this.mapRelease(row) : null;
  }

  getRelease(id: string): AssetRelease | null {
    const row = this.db.prepare("SELECT * FROM asset_releases WHERE id=?").get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRelease(row) : null;
  }

  listReleases(scope?: KnowledgeScope): AssetRelease[] {
    const rows = scope
      ? this.db.prepare("SELECT * FROM asset_releases WHERE scope_key=? ORDER BY created_at DESC").all(this.scopeKey(scope))
      : this.db.prepare("SELECT * FROM asset_releases ORDER BY created_at DESC").all();
    return (rows as Record<string, unknown>[]).map(this.mapRelease);
  }

  listReleasedAssetRefs(identity: { tenantId: string; userId: string }): AssetRef[] {
    const global = this.getCurrentRelease({ kind: "global" })?.assetRefs || [];
    const tenant = this.getCurrentRelease({ kind: "tenant", tenantId: identity.tenantId })?.assetRefs || [];
    const user = this.getCurrentRelease({ kind: "user", tenantId: identity.tenantId, userId: identity.userId })?.assetRefs || [];
    return this.mergeAssetRefs(this.mergeAssetRefs(global, tenant), user);
  }

  listReleasedAssetRevisions(identity: { tenantId: string; userId: string }): AssetRevision[] {
    return this.listReleasedAssetRefs(identity)
      .map((ref) => this.getAssetRevisionByRef(ref))
      .filter((revision): revision is AssetRevision => revision !== null && revision.status === "released");
  }

  createKnowledgeLock(taskId: string, requestedAsOf?: string): KnowledgeLock {
    const existing = this.getKnowledgeLock(taskId);
    if (existing) return existing;
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    const conversation = this.getConversation(task.conversationId);
    if (!conversation) throw new Error(`Conversation not found: ${task.conversationId}`);
    const tenantScope: KnowledgeScope = { kind: "tenant", tenantId: conversation.tenantId };
    const userScope: KnowledgeScope = { kind: "user", tenantId: conversation.tenantId, userId: conversation.userId };
    const globalRelease = this.getCurrentRelease({ kind: "global" });
    if (!globalRelease) throw new Error("Global knowledge baseline is missing");
    const tenantRelease = this.getCurrentRelease(tenantScope);
    const userRelease = this.getCurrentRelease(userScope);
    const asOf = requestedAsOf || task.createdAt;
    if (!Number.isFinite(Date.parse(asOf))) throw new Error(`Invalid knowledge asOf: ${asOf}`);
    const mergedRefs = this.mergeAssetRefs(this.mergeAssetRefs(globalRelease.assetRefs, tenantRelease?.assetRefs || []), userRelease?.assetRefs || []);
    const refs = mergedRefs.filter((ref) => this.isAssetRefActive(ref, asOf));
    const memoryRow = this.db.prepare("SELECT COUNT(*) count FROM memory_records WHERE conversation_id=? OR conversation_id IS NULL")
      .get(task.conversationId) as { count: number };
    const lockInput = {
      taskId, scope: userScope, globalReleaseId: globalRelease.id, tenantReleaseId: tenantRelease?.id,
      userReleaseId: userRelease?.id, userMemoryVersion: Number(memoryRow.count), asOf, assetRefs: refs,
    };
    const item: KnowledgeLock = { id: randomUUID(), ...lockInput, fingerprint: fingerprint(lockInput), createdAt: now() };
    this.db.prepare(`INSERT INTO knowledge_locks
      (id,task_id,scope_json,global_release_id,tenant_release_id,user_release_id,user_memory_version,as_of,asset_refs_json,fingerprint,created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(item.id, item.taskId, json(item.scope), item.globalReleaseId, item.tenantReleaseId ?? null,
        item.userReleaseId ?? null, item.userMemoryVersion ?? null, item.asOf, json(item.assetRefs), item.fingerprint, item.createdAt);
    for (const ref of item.assetRefs) this.observeAssetUsage({ taskId, assetRef: ref, selectedReason: "knowledge_lock", outcome: "selected" });
    return item;
  }

  getKnowledgeLock(taskId: string): KnowledgeLock | null {
    const row = this.db.prepare("SELECT * FROM knowledge_locks WHERE task_id=?").get(taskId) as Record<string, unknown> | undefined;
    return row ? this.mapKnowledgeLock(row) : null;
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

  createMiningRun(taskId: string, extractorVersion: string): MiningRun {
    const existing = this.getMiningRunByTask(taskId);
    if (existing) return existing;
    const lock = this.createKnowledgeLock(taskId);
    const item: MiningRun = {
      id: randomUUID(), taskId, status: "queued", extractorVersion,
      knowledgeLockId: lock.id, candidateCount: 0, createdAt: now(),
    };
    this.db.prepare("INSERT INTO mining_runs VALUES (?, ?, ?, ?, ?, 0, NULL, NULL, NULL, ?)")
      .run(item.id, item.taskId, item.status, item.extractorVersion, item.knowledgeLockId, item.createdAt);
    return item;
  }

  getMiningRunByTask(taskId: string): MiningRun | null {
    const row = this.db.prepare("SELECT * FROM mining_runs WHERE task_id=?").get(taskId) as Record<string, unknown> | undefined;
    return row ? this.mapMiningRun(row) : null;
  }

  updateMiningRun(id: string, patch: Partial<Pick<MiningRun, "status" | "candidateCount" | "error" | "startedAt" | "completedAt">>): MiningRun {
    const row = this.db.prepare("SELECT * FROM mining_runs WHERE id=?").get(id) as Record<string, unknown> | undefined;
    if (!row) throw new Error(`Mining run not found: ${id}`);
    const current = this.mapMiningRun(row);
    const next = { ...current, ...patch };
    this.db.prepare("UPDATE mining_runs SET status=?, candidate_count=?, error=?, started_at=?, completed_at=? WHERE id=?")
      .run(next.status, next.candidateCount, next.error ?? null, next.startedAt ?? null, next.completedAt ?? null, id);
    return next;
  }

  putAssetRevision(input: Omit<AssetRevision, "id" | "version" | "fingerprint" | "createdAt"> & { id?: string }): AssetRevision {
    const prior = this.db.prepare("SELECT MAX(version) version FROM asset_revisions WHERE asset_id=?").get(input.assetId) as { version?: number | null };
    const version = Number(prior.version || 0) + 1;
    const value = { assetId: input.assetId, kind: input.kind, scope: input.scope, content: input.content, contentRef: input.contentRef, validFrom: input.validFrom, validTo: input.validTo, supersedes: input.supersedes };
    const item: AssetRevision = { ...input, id: input.id || randomUUID(), version, fingerprint: fingerprint(value), createdAt: now() };
    this.db.prepare("INSERT INTO asset_revisions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(item.id, item.assetId, item.kind, json(item.scope), item.version, item.status, json(item.content), item.contentRef ?? null,
        item.fingerprint, json(item.provenanceRefs), item.validFrom ?? null, item.validTo ?? null, json(item.supersedes), item.createdAt);
    return item;
  }

  getAssetRevision(id: string): AssetRevision | null {
    const row = this.db.prepare("SELECT * FROM asset_revisions WHERE id=?").get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRevision(row) : null;
  }

  getAssetRevisionByRef(ref: AssetRef): AssetRevision | null {
    const row = this.db.prepare("SELECT * FROM asset_revisions WHERE asset_id=? AND version=?")
      .get(ref.assetId, ref.version) as Record<string, unknown> | undefined;
    return row ? this.mapRevision(row) : null;
  }

  getReleasedAssetByIdentity(identityKey: string, kind: AssetKind, scope: KnowledgeScope): AssetRef | null {
    const release = this.getCurrentRelease(scope);
    if (!release) return null;
    for (const ref of release.assetRefs) {
      if (ref.kind !== kind) continue;
      if (ref.identityKey === identityKey) return ref;
      const row = this.db.prepare("SELECT content_json FROM asset_revisions WHERE asset_id=? AND version=?")
        .get(ref.assetId, ref.version) as { content_json?: string } | undefined;
      const content = parse<Record<string, unknown>>(row?.content_json, {});
      if (String(content.identityKey || "") === identityKey) return ref;
    }
    return null;
  }

  putCandidate(input: Omit<AssetCandidate, "id" | "createdAt" | "updatedAt"> & { id?: string }): AssetCandidate {
    const stamp = now();
    const item: AssetCandidate = { ...input, id: input.id || randomUUID(), createdAt: stamp, updatedAt: stamp };
    this.db.prepare(`INSERT INTO asset_candidates (
      id,mining_run_id,task_id,scope_json,asset_kind,operation,identity_key,target_asset_ref_json,proposed_revision_id,
      provenance_refs_json,run_baseline_fingerprint,current_baseline_fingerprint,risk_level,confidence,novelty,
      conflicts_json,status,evaluation_summary_json,decision_note,reviewed_by,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(item.id, item.miningRunId, item.taskId, json(item.scope), item.assetKind, item.operation, item.identityKey,
        item.targetAssetRef ? json(item.targetAssetRef) : null, item.proposedRevisionId, json(item.provenanceRefs),
        item.runBaselineFingerprint, item.currentBaselineFingerprint, item.riskLevel, item.confidence, item.novelty,
        json(item.conflicts), item.status, item.evaluationSummary ? json(item.evaluationSummary) : null,
        item.decisionNote ?? null, item.reviewedBy ?? null, item.createdAt, item.updatedAt);
    return item;
  }

  getCandidate(id: string): AssetCandidate | null {
    const row = this.db.prepare("SELECT * FROM asset_candidates WHERE id=?").get(id) as Record<string, unknown> | undefined;
    return row ? this.mapCandidate(row) : null;
  }

  listCandidates(filters: { status?: CandidateStatus; scope?: KnowledgeScope; taskId?: string } = {}): AssetCandidate[] {
    const clauses: string[] = [];
    const args: string[] = [];
    if (filters.status) { clauses.push("status=?"); args.push(filters.status); }
    if (filters.scope) { clauses.push("scope_json=?"); args.push(json(filters.scope)); }
    if (filters.taskId) { clauses.push("task_id=?"); args.push(filters.taskId); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return (this.db.prepare(`SELECT * FROM asset_candidates ${where} ORDER BY updated_at DESC`).all(...args) as Record<string, unknown>[]).map(this.mapCandidate);
  }

  findCandidatesByIdentity(identityKey: string, kind: AssetKind): AssetCandidate[] {
    return (this.db.prepare("SELECT * FROM asset_candidates WHERE identity_key=? AND asset_kind=? ORDER BY updated_at DESC")
      .all(identityKey, kind) as Record<string, unknown>[]).map(this.mapCandidate);
  }

  updateCandidate(id: string, patch: Partial<Pick<AssetCandidate, "status" | "operation" | "targetAssetRef" | "currentBaselineFingerprint" | "conflicts" | "evaluationSummary" | "decisionNote" | "reviewedBy">>): AssetCandidate {
    const current = this.getCandidate(id);
    if (!current) throw new Error(`Candidate not found: ${id}`);
    if (patch.status && patch.status !== current.status) {
      const allowed: Record<CandidateStatus, CandidateStatus[]> = {
        observed: ["normalized", "rejected"], normalized: ["proposed", "rejected"],
        proposed: ["evaluating", "monitor", "rejected", ...(current.riskLevel <= 1 ? ["approved" as CandidateStatus] : [])],
        evaluating: ["review_required", "rejected"], review_required: ["approved", "rejected", "monitor"],
        approved: ["released", "superseded"], released: ["superseded"], rejected: [], superseded: [],
        monitor: ["proposed", "rejected"],
      };
      if (!allowed[current.status].includes(patch.status)) throw new Error(`Illegal candidate transition: ${current.status} -> ${patch.status}`);
    }
    const next = { ...current, ...patch, updatedAt: now() };
    this.db.prepare(`UPDATE asset_candidates SET status=?,operation=?,target_asset_ref_json=?,current_baseline_fingerprint=?,conflicts_json=?,
      evaluation_summary_json=?,decision_note=?,reviewed_by=?,updated_at=? WHERE id=?`)
      .run(next.status, next.operation, next.targetAssetRef ? json(next.targetAssetRef) : null, next.currentBaselineFingerprint, json(next.conflicts),
        next.evaluationSummary ? json(next.evaluationSummary) : null, next.decisionNote ?? null,
        next.reviewedBy ?? null, next.updatedAt, id);
    return next;
  }

  putCandidateOccurrence(input: Omit<CandidateOccurrence, "id" | "observedAt">): CandidateOccurrence {
    const existing = this.db.prepare(`SELECT * FROM candidate_occurrences
      WHERE candidate_id=? AND task_id=? AND artifact_id IS ? ORDER BY observed_at LIMIT 1`)
      .get(input.candidateId, input.taskId, input.artifactId ?? null) as Record<string, unknown> | undefined;
    if (existing) return {
      id: String(existing.id), candidateId: String(existing.candidate_id), taskId: String(existing.task_id),
      artifactId: existing.artifact_id ? String(existing.artifact_id) : undefined,
      eventSequence: existing.event_sequence == null ? undefined : Number(existing.event_sequence),
      observedAt: String(existing.observed_at),
    };
    const item: CandidateOccurrence = { ...input, id: randomUUID(), observedAt: now() };
    this.db.prepare("INSERT INTO candidate_occurrences VALUES (?, ?, ?, ?, ?, ?)")
      .run(item.id, item.candidateId, item.taskId, item.artifactId ?? null, item.eventSequence ?? null, item.observedAt);
    return item;
  }

  listCandidateOccurrences(candidateId: string): CandidateOccurrence[] {
    return (this.db.prepare("SELECT * FROM candidate_occurrences WHERE candidate_id=? ORDER BY observed_at").all(candidateId) as Record<string, unknown>[])
      .map((r) => ({ id: String(r.id), candidateId: String(r.candidate_id), taskId: String(r.task_id), artifactId: r.artifact_id ? String(r.artifact_id) : undefined, eventSequence: r.event_sequence == null ? undefined : Number(r.event_sequence), observedAt: String(r.observed_at) }));
  }

  putCandidateDecision(input: Omit<CandidateDecision, "id" | "createdAt">): CandidateDecision {
    const item: CandidateDecision = { ...input, id: randomUUID(), createdAt: now() };
    this.db.prepare("INSERT INTO candidate_decisions VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(item.id, item.candidateId, item.reviewer, item.reviewerRole, item.decision, item.note, item.createdAt);
    return item;
  }

  listCandidateDecisions(candidateId: string): CandidateDecision[] {
    return (this.db.prepare("SELECT * FROM candidate_decisions WHERE candidate_id=? ORDER BY created_at").all(candidateId) as Record<string, unknown>[])
      .map((r) => ({ id: String(r.id), candidateId: String(r.candidate_id), reviewer: String(r.reviewer), reviewerRole: r.reviewer_role as CandidateDecision["reviewerRole"], decision: r.decision as CandidateDecision["decision"], note: String(r.note), createdAt: String(r.created_at) }));
  }

  putEvaluationCase(input: Omit<EvaluationCase, "id" | "createdAt">): EvaluationCase {
    const item: EvaluationCase = { ...input, id: randomUUID(), createdAt: now() };
    this.db.prepare("INSERT INTO evaluation_cases VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(item.id, json(item.scope), item.sourceTaskId, item.name, json(item.inputSnapshot), json(item.assertions), item.status, item.deidentified ? 1 : 0, item.createdAt);
    return item;
  }

  listEvaluationCases(scope?: KnowledgeScope): EvaluationCase[] {
    const rows = scope
      ? this.db.prepare("SELECT * FROM evaluation_cases WHERE scope_json=? ORDER BY created_at").all(json(scope))
      : this.db.prepare("SELECT * FROM evaluation_cases ORDER BY created_at").all();
    return (rows as Record<string, unknown>[]).map(this.mapEvaluationCase);
  }

  putEvaluationRun(input: Omit<EvaluationRun, "id" | "createdAt">): EvaluationRun {
    const item: EvaluationRun = { ...input, id: randomUUID(), createdAt: now() };
    this.db.prepare("INSERT INTO evaluation_runs VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(item.id, item.candidateId, item.status, json(item.caseIds), item.baselineReleaseId, json(item.summary), item.createdAt, item.completedAt ?? null);
    return item;
  }

  listEvaluationRuns(candidateId: string): EvaluationRun[] {
    return (this.db.prepare("SELECT * FROM evaluation_runs WHERE candidate_id=? ORDER BY created_at DESC").all(candidateId) as Record<string, unknown>[]).map(this.mapEvaluationRun);
  }

  publishRelease(input: { scope: KnowledgeScope; candidateIds: string[]; createdBy: string }): AssetRelease {
    const current = this.getCurrentRelease(input.scope);
    const refs = new Map((current?.assetRefs || []).map((ref) => [ref.assetId, ref]));
    const revisions: AssetRevision[] = [];
    for (const candidateId of input.candidateIds) {
      const candidate = this.getCandidate(candidateId);
      if (!candidate || candidate.status !== "approved") throw new Error(`Candidate is not approved: ${candidateId}`);
      if (json(candidate.scope) !== json(input.scope)) throw new Error("Release cannot mix knowledge scopes");
      if (candidate.currentBaselineFingerprint !== (current?.fingerprint || this.emptyReleaseFingerprint(input.scope))) throw new Error(`Candidate requires rebase: ${candidateId}`);
      if (candidate.conflicts.length) throw new Error(`Candidate has unresolved conflicts: ${candidateId}`);
      const revision = this.getAssetRevision(candidate.proposedRevisionId);
      if (!revision) throw new Error(`Revision not found: ${candidate.proposedRevisionId}`);
      revisions.push(revision);
      if (candidate.operation === "deprecate") refs.delete(revision.assetId);
      else refs.set(revision.assetId, this.assetRef(revision));
    }
    const assetRefs = [...refs.values()].sort((a, b) => a.assetId.localeCompare(b.assetId));
    const releaseInput = { scope: input.scope, parentReleaseId: current?.id, rollbackOfReleaseId: undefined, candidateIds: input.candidateIds, assetRefs };
    const release: AssetRelease = {
      id: randomUUID(), ...releaseInput, status: "current", fingerprint: fingerprint(releaseInput),
      createdBy: input.createdBy, createdAt: now(),
    };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (current) this.db.prepare("UPDATE asset_releases SET status='superseded' WHERE id=?").run(current.id);
      this.insertRelease(release);
      const memberInsert = this.db.prepare("INSERT INTO release_members VALUES (?, ?, ?)");
      for (const ref of release.assetRefs) {
        const revision = this.db.prepare("SELECT id FROM asset_revisions WHERE asset_id=? AND version=?").get(ref.assetId, ref.version) as { id: string } | undefined;
        if (revision) memberInsert.run(release.id, ref.assetId, revision.id);
      }
      for (const revision of revisions) {
        const retained = release.assetRefs.some((ref) => ref.assetId === revision.assetId);
        if (retained) {
          this.db.prepare("UPDATE asset_revisions SET status='deprecated', valid_to=CASE WHEN kind='temporal_fact' THEN COALESCE(valid_to, ?) ELSE valid_to END WHERE asset_id=? AND id<>? AND status='released'")
            .run(release.createdAt, revision.assetId, revision.id);
        }
        this.db.prepare("UPDATE asset_revisions SET status=? WHERE id=?").run(retained ? "released" : "deprecated", revision.id);
      }
      for (const id of input.candidateIds) this.db.prepare("UPDATE asset_candidates SET status='released',updated_at=? WHERE id=?").run(now(), id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return release;
  }

  rollbackRelease(input: { releaseId: string; createdBy: string }): AssetRelease {
    const target = this.getRelease(input.releaseId);
    if (!target) throw new Error(`Release not found: ${input.releaseId}`);
    const current = this.getCurrentRelease(target.scope);
    if (!current) throw new Error("Current Release is missing");
    if (current.id === target.id) throw new Error("Target Release is already current");
    const releaseInput = {
      scope: target.scope, parentReleaseId: current.id, rollbackOfReleaseId: target.id,
      candidateIds: [] as string[], assetRefs: target.assetRefs,
    };
    const release: AssetRelease = {
      id: randomUUID(), ...releaseInput, status: "current", fingerprint: fingerprint(releaseInput),
      createdBy: input.createdBy, createdAt: now(),
    };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE asset_releases SET status='superseded' WHERE id=?").run(current.id);
      this.insertRelease(release);
      const memberInsert = this.db.prepare("INSERT INTO release_members VALUES (?, ?, ?)");
      for (const ref of release.assetRefs) {
        const revision = this.getAssetRevisionByRef(ref);
        if (revision) memberInsert.run(release.id, ref.assetId, revision.id);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return release;
  }

  putUsage(input: Omit<UsageObservation, "id" | "observedAt">): UsageObservation {
    const encodedRef = json(input.assetRef);
    const existing = this.db.prepare(`SELECT * FROM asset_usage
      WHERE task_id=? AND asset_ref_json=? AND selected_reason=? AND outcome=? ORDER BY observed_at LIMIT 1`)
      .get(input.taskId, encodedRef, input.selectedReason, input.outcome) as Record<string, unknown> | undefined;
    if (existing) return this.mapUsage(existing);
    const item: UsageObservation = { ...input, id: randomUUID(), observedAt: now() };
    this.db.prepare("INSERT INTO asset_usage VALUES (?, ?, ?, ?, ?, ?)")
      .run(item.id, item.taskId, encodedRef, item.selectedReason, item.outcome, item.observedAt);
    return item;
  }

  observeAssetUsage(input: Omit<UsageObservation, "id" | "observedAt">): UsageObservation {
    const task = this.getTask(input.taskId);
    if (!task) throw new Error(`Task not found: ${input.taskId}`);
    const lock = this.getKnowledgeLock(input.taskId);
    if (!lock) throw new Error(`KnowledgeLock not found: ${input.taskId}`);
    const selected = lock.assetRefs.find((ref) => ref.assetId === input.assetRef.assetId && ref.version === input.assetRef.version && ref.fingerprint === input.assetRef.fingerprint);
    if (!selected) throw new Error("Usage asset is not part of the Task KnowledgeLock");
    const prior = this.listUsage(input.taskId).find((item) => item.assetRef.assetId === selected.assetId && item.assetRef.version === selected.version && item.outcome === input.outcome && item.selectedReason === input.selectedReason);
    if (prior) return prior;
    const item = this.putUsage({ ...input, assetRef: selected });
    this.appendEvent({
      conversationId: task.conversationId, taskId: task.id, type: `asset.${input.outcome}`,
      actorType: input.outcome === "helpful" || input.outcome === "regression" ? "researcher" : "system",
      actorId: input.outcome === "helpful" || input.outcome === "regression" ? "knowledge-reviewer" : "runtime",
      payload: { usageObservationId: item.id, assetRef: selected, reason: input.selectedReason, knowledgeLockId: lock.id },
    });
    return item;
  }

  listUsage(taskId?: string): UsageObservation[] {
    const rows = taskId
      ? this.db.prepare("SELECT * FROM asset_usage WHERE task_id=? ORDER BY observed_at").all(taskId)
      : this.db.prepare("SELECT * FROM asset_usage ORDER BY observed_at DESC").all();
    return (rows as Record<string, unknown>[]).map(this.mapUsage);
  }

  assetLineage(assetId: string): { revisions: AssetRevision[]; releases: AssetRelease[]; candidates: AssetCandidate[]; usage: UsageObservation[] } {
    const revisions = (this.db.prepare("SELECT * FROM asset_revisions WHERE asset_id=? ORDER BY version").all(assetId) as Record<string, unknown>[]).map(this.mapRevision);
    const releases = this.listReleases().filter((release) => release.assetRefs.some((ref) => ref.assetId === assetId));
    const revisionIds = new Set(revisions.map((item) => item.id));
    const candidates = this.listCandidates().filter((candidate) => revisionIds.has(candidate.proposedRevisionId) || candidate.targetAssetRef?.assetId === assetId);
    const usage = this.listUsage().filter((item) => item.assetRef.assetId === assetId);
    return { revisions, releases, candidates, usage };
  }

  currentBaselineFingerprint(scope: KnowledgeScope): string {
    return this.getCurrentRelease(scope)?.fingerprint || this.emptyReleaseFingerprint(scope);
  }

  private ensureGlobalRelease(): void {
    const scope: KnowledgeScope = { kind: "global" };
    const current = this.getCurrentRelease(scope);
    if (current && (current.createdBy !== "bootstrap" || current.assetRefs.length > 0)) return;
    const input = { scope, parentReleaseId: current?.id, rollbackOfReleaseId: undefined, candidateIds: [] as string[], assetRefs: GLOBAL_AUTHORITY_REFS };
    const release: AssetRelease = { id: randomUUID(), ...input, status: "current", fingerprint: fingerprint(input), createdBy: "bootstrap", createdAt: now() };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (current) this.db.prepare("UPDATE asset_releases SET status='superseded' WHERE id=?").run(current.id);
      this.insertRelease(release);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private emptyReleaseFingerprint(scope: KnowledgeScope): string {
    return fingerprint({ scope, parentReleaseId: undefined, candidateIds: [], assetRefs: [] });
  }

  private insertRelease(release: AssetRelease): void {
    this.db.prepare(`INSERT INTO asset_releases
      (id,scope_json,scope_key,parent_release_id,rollback_of_release_id,status,candidate_ids_json,asset_refs_json,fingerprint,created_by,created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(release.id, json(release.scope), this.scopeKey(release.scope), release.parentReleaseId ?? null,
        release.rollbackOfReleaseId ?? null, release.status, json(release.candidateIds), json(release.assetRefs),
        release.fingerprint, release.createdBy, release.createdAt);
  }

  private assetRef(revision: AssetRevision): AssetRef {
    const identityKey = typeof revision.content.identityKey === "string" ? revision.content.identityKey : undefined;
    return { assetId: revision.assetId, kind: revision.kind, identityKey, scope: revision.scope, version: revision.version, fingerprint: revision.fingerprint, authorityRef: revision.contentRef };
  }

  private isAssetRefActive(ref: AssetRef, asOf: string): boolean {
    if (ref.kind !== "temporal_fact") return true;
    const revision = this.getAssetRevisionByRef(ref);
    if (!revision) return false;
    const point = Date.parse(asOf);
    const starts = revision.validFrom ? Date.parse(revision.validFrom) : Number.NEGATIVE_INFINITY;
    const ends = revision.validTo ? Date.parse(revision.validTo) : Number.POSITIVE_INFINITY;
    return starts <= point && point < ends;
  }

  private mergeAssetRefs(base: AssetRef[], overlay: AssetRef[]): AssetRef[] {
    const key = (ref: AssetRef) => ref.identityKey ? `${ref.kind}:${ref.identityKey}` : ref.assetId;
    const refs = new Map(base.map((ref) => [key(ref), ref]));
    for (const ref of overlay) refs.set(key(ref), ref);
    return [...refs.values()].sort((a, b) => a.assetId.localeCompare(b.assetId));
  }

  private indexText(refId: string, kind: string, title: string, body: string): void {
    try { this.db.prepare("INSERT INTO research_fts (ref_id, kind, title, body) VALUES (?, ?, ?, ?)").run(refId, kind, title, body); } catch { /* optional FTS */ }
  }

  private mapKnowledgeLock = (r: Record<string, unknown>): KnowledgeLock => ({ id: String(r.id), taskId: String(r.task_id), scope: parse<KnowledgeScope>(r.scope_json, { kind: "global" }), globalReleaseId: String(r.global_release_id), tenantReleaseId: r.tenant_release_id ? String(r.tenant_release_id) : undefined, userReleaseId: r.user_release_id ? String(r.user_release_id) : undefined, userMemoryVersion: r.user_memory_version == null ? undefined : Number(r.user_memory_version), asOf: r.as_of ? String(r.as_of) : String(r.created_at), assetRefs: parse<AssetRef[]>(r.asset_refs_json, []), fingerprint: String(r.fingerprint), createdAt: String(r.created_at) });
  private mapMiningRun = (r: Record<string, unknown>): MiningRun => ({ id: String(r.id), taskId: String(r.task_id), status: r.status as MiningRun["status"], extractorVersion: String(r.extractor_version), knowledgeLockId: String(r.knowledge_lock_id), candidateCount: Number(r.candidate_count), error: r.error ? String(r.error) : undefined, startedAt: r.started_at ? String(r.started_at) : undefined, completedAt: r.completed_at ? String(r.completed_at) : undefined, createdAt: String(r.created_at) });
  private mapRevision = (r: Record<string, unknown>): AssetRevision => ({ id: String(r.id), assetId: String(r.asset_id), kind: r.kind as AssetKind, scope: parse<KnowledgeScope>(r.scope_json, { kind: "global" }), version: Number(r.version), status: r.status as AssetRevision["status"], content: parse<Record<string, unknown>>(r.content_json, {}), contentRef: r.content_ref ? String(r.content_ref) : undefined, fingerprint: String(r.fingerprint), provenanceRefs: parse<string[]>(r.provenance_refs_json, []), validFrom: r.valid_from ? String(r.valid_from) : undefined, validTo: r.valid_to ? String(r.valid_to) : undefined, supersedes: parse<string[]>(r.supersedes_json, []), createdAt: String(r.created_at) });
  private mapCandidate = (r: Record<string, unknown>): AssetCandidate => ({ id: String(r.id), miningRunId: String(r.mining_run_id), taskId: String(r.task_id), scope: parse<KnowledgeScope>(r.scope_json, { kind: "global" }), assetKind: r.asset_kind as AssetKind, operation: r.operation as AssetCandidate["operation"], identityKey: String(r.identity_key), targetAssetRef: r.target_asset_ref_json ? parse<AssetRef>(r.target_asset_ref_json, {} as AssetRef) : undefined, proposedRevisionId: String(r.proposed_revision_id), provenanceRefs: parse<string[]>(r.provenance_refs_json, []), runBaselineFingerprint: String(r.run_baseline_fingerprint), currentBaselineFingerprint: String(r.current_baseline_fingerprint), riskLevel: Number(r.risk_level) as AssetCandidate["riskLevel"], confidence: Number(r.confidence), novelty: Number(r.novelty), conflicts: parse<string[]>(r.conflicts_json, []), status: r.status as CandidateStatus, evaluationSummary: r.evaluation_summary_json ? parse<EvaluationSummary>(r.evaluation_summary_json, { passed: false, scoreDelta: 0, severeRegressions: 0, metrics: {} }) : undefined, decisionNote: r.decision_note ? String(r.decision_note) : undefined, reviewedBy: r.reviewed_by ? String(r.reviewed_by) : undefined, createdAt: String(r.created_at), updatedAt: String(r.updated_at) });
  private mapEvaluationCase = (r: Record<string, unknown>): EvaluationCase => ({ id: String(r.id), scope: parse<KnowledgeScope>(r.scope_json, { kind: "global" }), sourceTaskId: String(r.source_task_id), name: String(r.name), inputSnapshot: parse<Record<string, unknown>>(r.input_snapshot_json, {}), assertions: parse<EvaluationCase["assertions"]>(r.assertions_json, []), status: r.status as EvaluationCase["status"], deidentified: Boolean(r.deidentified), createdAt: String(r.created_at) });
  private mapEvaluationRun = (r: Record<string, unknown>): EvaluationRun => ({ id: String(r.id), candidateId: String(r.candidate_id), status: r.status as EvaluationRun["status"], caseIds: parse<string[]>(r.case_ids_json, []), baselineReleaseId: String(r.baseline_release_id), summary: parse<EvaluationSummary>(r.summary_json, { passed: false, scoreDelta: 0, severeRegressions: 0, metrics: {} }), createdAt: String(r.created_at), completedAt: r.completed_at ? String(r.completed_at) : undefined });
  private mapRelease = (r: Record<string, unknown>): AssetRelease => ({ id: String(r.id), scope: parse<KnowledgeScope>(r.scope_json, { kind: "global" }), parentReleaseId: r.parent_release_id ? String(r.parent_release_id) : undefined, rollbackOfReleaseId: r.rollback_of_release_id ? String(r.rollback_of_release_id) : undefined, status: r.status as AssetRelease["status"], candidateIds: parse<string[]>(r.candidate_ids_json, []), assetRefs: parse<AssetRef[]>(r.asset_refs_json, []), fingerprint: String(r.fingerprint), createdBy: String(r.created_by), createdAt: String(r.created_at) });
  private mapUsage = (r: Record<string, unknown>): UsageObservation => ({ id: String(r.id), taskId: String(r.task_id), assetRef: parse<AssetRef>(r.asset_ref_json, {} as AssetRef), selectedReason: String(r.selected_reason), outcome: r.outcome as UsageObservation["outcome"], observedAt: String(r.observed_at) });

  private mapConversation = (r: Record<string, unknown>): Conversation => ({
    id: String(r.id), title: String(r.title), tenantId: String(r.tenant_id || "default"), userId: String(r.user_id || "researcher"),
    status: r.status as Conversation["status"], createdAt: String(r.created_at), updatedAt: String(r.updated_at),
  });
  private mapTask = (r: Record<string, unknown>): Task => ({ id: String(r.id), conversationId: String(r.conversation_id), researchCaseId: r.research_case_id ? String(r.research_case_id) : String(r.id), parentTaskId: r.parent_task_id ? String(r.parent_task_id) : undefined, goal: String(r.goal), intent: r.intent as Task["intent"], reportSpec: normalizeReportSpec(parse(r.report_spec_json, {})), status: r.status as Task["status"], budget: parse(r.budget_json, { maxModelCalls: 0, maxToolCalls: 0, maxCostUsd: 0 }), createdAt: String(r.created_at), updatedAt: String(r.updated_at) });
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
  private mapArtifact = (r: Record<string, unknown>): Artifact => ({ id: String(r.id), version: Number(r.version), conversationId: String(r.conversation_id), taskId: String(r.task_id), nodeId: r.node_id ? String(r.node_id) : undefined, kind: r.kind as Artifact["kind"], title: String(r.title), status: r.status as Artifact["status"], data: parse(r.data_json, {}), sourceRefs: parse(r.source_refs_json, []), createdBy: String(r.created_by), createdAt: String(r.created_at) });
  private mapApproval = (r: Record<string, unknown>): ApprovalRequest => ({ id: String(r.id), conversationId: String(r.conversation_id), taskId: String(r.task_id), nodeId: r.node_id ? String(r.node_id) : undefined, kind: r.kind as ApprovalRequest["kind"], prompt: String(r.prompt), status: r.status as ApprovalRequest["status"], decisionNote: r.decision_note ? String(r.decision_note) : undefined, createdAt: String(r.created_at), decidedAt: r.decided_at ? String(r.decided_at) : undefined });
}

export class ArtifactVersionConflictError extends Error {
  constructor(readonly artifactId: string, readonly expectedVersion: number, readonly actualVersion: number) {
    super(`Artifact version conflict: expected ${expectedVersion}, actual ${actualVersion}`);
    this.name = "ArtifactVersionConflictError";
  }
}

export class ApprovalDecisionConflictError extends Error {
  constructor(readonly approvalId: string, readonly actualStatus: ApprovalRequest["status"]) {
    super(`Approval is no longer pending: ${approvalId} is ${actualStatus}`);
    this.name = "ApprovalDecisionConflictError";
  }
}

let singleton: RuntimeStore | undefined;
export function getRuntimeStore(): RuntimeStore {
  singleton ??= new RuntimeStore();
  return singleton;
}
