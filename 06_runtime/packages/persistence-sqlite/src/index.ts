import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ArtifactEnvelope, ResearchRunLock, WorkOrder, WorkerResult } from "@investment/domain";
import type { ArtifactRepository, AuditEventWriter, WorkOrderRepository } from "@investment/orchestrator";

const encode = (value: unknown) => JSON.stringify(value);
const decode = <T>(value: unknown): T => JSON.parse(String(value)) as T;
const timestamp = () => new Date().toISOString();
const fingerprint = (value: unknown) => `sha256:${createHash("sha256").update(encode(value)).digest("hex")}`;

export function migrateLegacyRuntimeSchema(db: DatabaseSync): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT 'default', user_id TEXT NOT NULL DEFAULT 'researcher', status TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), research_case_id TEXT NOT NULL DEFAULT '', parent_task_id TEXT,
        goal TEXT NOT NULL, intent TEXT NOT NULL, report_spec_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL, outcome TEXT, budget_json TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS research_cases (
        id TEXT PRIMARY KEY, conversation_id TEXT UNIQUE NOT NULL REFERENCES conversations(id),
        task_id TEXT UNIQUE NOT NULL REFERENCES tasks(id), owner_id TEXT NOT NULL, version INTEGER NOT NULL,
        company_code TEXT NOT NULL, company_name TEXT NOT NULL, as_of TEXT NOT NULL,
        research_question TEXT NOT NULL, primary_lens TEXT NOT NULL, counter_lens TEXT NOT NULL,
        report_spec_json TEXT NOT NULL, source_policy_json TEXT NOT NULL, status TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS research_case_commands (
        id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES research_cases(id), idempotency_key TEXT NOT NULL,
        command_type TEXT NOT NULL, actor_id TEXT NOT NULL, expected_version INTEGER NOT NULL, payload_json TEXT NOT NULL,
        status TEXT NOT NULL, result_json TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(case_id,idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS task_nodes (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), kind TEXT NOT NULL, title TEXT NOT NULL,
        capability_type TEXT NOT NULL, capability_id TEXT NOT NULL, assigned_agent TEXT NOT NULL, depends_on_json TEXT NOT NULL,
        status TEXT NOT NULL, budget_json TEXT NOT NULL, input_artifact_ids_json TEXT NOT NULL,
        output_artifact_ids_json TEXT NOT NULL, frontier_ref_json TEXT NOT NULL DEFAULT '{}', iteration INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS node_jobs (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), node_id TEXT NOT NULL REFERENCES task_nodes(id),
        status TEXT NOT NULL, attempts INTEGER NOT NULL, available_at TEXT NOT NULL, locked_at TEXT, last_error TEXT,
        leased_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(node_id, status)
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
        status TEXT NOT NULL, phase TEXT NOT NULL, state_json TEXT NOT NULL, created_at TEXT NOT NULL
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
        locked_at TEXT, last_error TEXT, leased_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memory_records (
        id TEXT PRIMARY KEY, conversation_id TEXT, kind TEXT NOT NULL, content TEXT NOT NULL,
        provenance_artifact_ids_json TEXT NOT NULL, source_ref TEXT NOT NULL DEFAULT '',
        freshness_at TEXT NOT NULL DEFAULT '', reviewed_at TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS model_call_cache (
        fingerprint TEXT PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL,
        result_json TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS model_call_records (
        id TEXT PRIMARY KEY, operation TEXT NOT NULL, fingerprint TEXT NOT NULL,
        provider TEXT NOT NULL, model TEXT NOT NULL, prompt_version TEXT NOT NULL,
        schema_version TEXT, context_hash TEXT NOT NULL, status TEXT NOT NULL,
        attempts INTEGER NOT NULL, cache_hit INTEGER NOT NULL,
        input_tokens INTEGER, output_tokens INTEGER, estimated_cost_usd REAL,
        latency_ms INTEGER NOT NULL, error TEXT, created_at TEXT NOT NULL, completed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS worker_heartbeats (
        worker_id TEXT PRIMARY KEY, pid INTEGER NOT NULL, status TEXT NOT NULL,
        started_at TEXT NOT NULL, heartbeat_at TEXT NOT NULL, stopped_at TEXT
      );
      CREATE TABLE IF NOT EXISTS runtime_schema_versions (
        version TEXT PRIMARY KEY, schema_hash TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS connector_response_blobs (
        fingerprint TEXT PRIMARY KEY, connector_id TEXT NOT NULL, operation TEXT NOT NULL,
        body TEXT NOT NULL, byte_length INTEGER NOT NULL, permission_scope TEXT NOT NULL,
        replayability TEXT NOT NULL, usage_restriction TEXT NOT NULL, risk_disclosure TEXT,
        captured_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS research_tracking_profiles (
        conversation_id TEXT PRIMARY KEY REFERENCES conversations(id), enabled INTEGER NOT NULL,
        symbols_json TEXT NOT NULL, keywords_json TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS signal_refresh_runs (
        id TEXT PRIMARY KEY, connector_id TEXT NOT NULL, status TEXT NOT NULL,
        conversation_ids_json TEXT NOT NULL, candidate_count INTEGER NOT NULL DEFAULT 0,
        error TEXT, created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS research_signal_candidates (
        id TEXT PRIMARY KEY, connector_id TEXT NOT NULL, conversation_id TEXT NOT NULL REFERENCES conversations(id),
        kind TEXT NOT NULL, status TEXT NOT NULL, symbol TEXT, title TEXT NOT NULL, excerpt TEXT NOT NULL,
        content_text TEXT NOT NULL, publisher TEXT NOT NULL, source_uri TEXT NOT NULL, source_type TEXT NOT NULL,
        published_at TEXT NOT NULL, captured_at TEXT NOT NULL, match_reason TEXT NOT NULL, score REAL NOT NULL,
        fingerprint TEXT NOT NULL, promoted_task_id TEXT, UNIQUE(conversation_id, fingerprint)
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
      CREATE TABLE IF NOT EXISTS research_evaluation_runs (
        id TEXT PRIMARY KEY, case_id TEXT NOT NULL, protocol_version TEXT NOT NULL, status TEXT NOT NULL,
        task_input_hash TEXT NOT NULL, evidence_bundle_hash TEXT NOT NULL, system_artifact_json TEXT NOT NULL,
        baseline_artifacts_json TEXT NOT NULL, judge_versions_json TEXT NOT NULL, formal_score_eligible INTEGER NOT NULL,
        metrics_json TEXT NOT NULL, notes_json TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT
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
      CREATE INDEX IF NOT EXISTS research_cases_updated ON research_cases(updated_at DESC);
      CREATE INDEX IF NOT EXISTS task_nodes_task_status ON task_nodes(task_id, status);
      CREATE INDEX IF NOT EXISTS node_jobs_claim ON node_jobs(status, available_at, task_id);
      CREATE INDEX IF NOT EXISTS artifacts_task_kind ON artifacts(task_id, kind);
      CREATE INDEX IF NOT EXISTS runtime_jobs_claim ON runtime_jobs(status, available_at);
      CREATE INDEX IF NOT EXISTS model_call_records_operation_created ON model_call_records(operation, created_at DESC);
      CREATE INDEX IF NOT EXISTS connector_response_blobs_connector ON connector_response_blobs(connector_id, operation, captured_at);
      CREATE INDEX IF NOT EXISTS research_signal_feed ON research_signal_candidates(status, score DESC, published_at DESC);
      CREATE INDEX IF NOT EXISTS signal_refresh_runs_created ON signal_refresh_runs(created_at DESC);
      CREATE INDEX IF NOT EXISTS asset_candidates_status_risk ON asset_candidates(status, risk_level, updated_at);
      CREATE INDEX IF NOT EXISTS asset_candidates_identity ON asset_candidates(identity_key, asset_kind);
      CREATE INDEX IF NOT EXISTS asset_revisions_lookup ON asset_revisions(asset_id, version DESC);
      CREATE INDEX IF NOT EXISTS asset_releases_current ON asset_releases(scope_key, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS asset_usage_task ON asset_usage(task_id, observed_at);
      CREATE INDEX IF NOT EXISTS research_evaluation_runs_case_created ON research_evaluation_runs(case_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS ontology_objects_type_status ON ontology_objects(type, status, updated_at);
      CREATE INDEX IF NOT EXISTS ontology_links_source ON ontology_links(source_id, type);
      CREATE INDEX IF NOT EXISTS ontology_links_target ON ontology_links(target_id, type);
      CREATE INDEX IF NOT EXISTS action_executions_context ON action_executions(conversation_id, task_id, created_at);
    `);
    db.prepare("INSERT OR IGNORE INTO runtime_schema_versions (version,schema_hash,created_at) VALUES ('2.0.0', ?, ?)")
      .run(fingerprint({ schema: "runtime-v2", version: "2.0.0" }), timestamp());
    try {
      db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS research_fts USING fts5(ref_id UNINDEXED, kind UNINDEXED, title, body);`);
    } catch {
      // Some SQLite builds omit FTS5. The repository remains usable through structured queries.
    }
  }


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

export class SqliteConnectorResponseRepository {
  constructor(readonly db: DatabaseSync) {}

  put(input: ConnectorResponseBlobInput): ConnectorResponseBlobMetadata {
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
    const existing = this.get(input.fingerprint);
    if (existing) {
      const comparable = ({ fingerprint, connectorId, operation, byteLength, permissionScope, replayability, usageRestriction, riskDisclosure, capturedAt }: ConnectorResponseBlobMetadata) =>
        ({ fingerprint, connectorId, operation, byteLength, permissionScope, replayability, usageRestriction, riskDisclosure, capturedAt });
      if (encode(comparable(existing)) !== encode(comparable(normalized))) {
        throw new Error("connector response fingerprint is already bound to different metadata");
      }
      return existing;
    }
    this.db.prepare(`INSERT INTO connector_response_blobs
      (fingerprint,connector_id,operation,body,byte_length,permission_scope,replayability,usage_restriction,risk_disclosure,captured_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(normalized.fingerprint, normalized.connectorId, normalized.operation, normalized.body, normalized.byteLength,
        normalized.permissionScope, normalized.replayability, normalized.usageRestriction, normalized.riskDisclosure || null, normalized.capturedAt);
    return this.get(input.fingerprint)!;
  }

  get(fingerprint: string): ConnectorResponseBlobMetadata | null {
    const row = this.db.prepare(`SELECT fingerprint,connector_id,operation,byte_length,permission_scope,replayability,
      usage_restriction,risk_disclosure,captured_at FROM connector_response_blobs WHERE fingerprint=?`).get(fingerprint) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      fingerprint: String(row.fingerprint), connectorId: String(row.connector_id), operation: String(row.operation),
      byteLength: Number(row.byte_length), permissionScope: String(row.permission_scope),
      replayability: String(row.replayability) as ConnectorResponseBlobMetadata["replayability"],
      usageRestriction: String(row.usage_restriction), riskDisclosure: row.risk_disclosure ? String(row.risk_disclosure) : undefined,
      capturedAt: String(row.captured_at),
    };
  }
}

export interface WorkerHealth {
  status: "ready" | "stale" | "unmanaged";
  workerId?: string;
  pid?: number;
  heartbeatAt?: string;
  ageMs?: number;
  activeWorkers?: number;
}

export interface RuntimeQueueStats {
  queued: number;
  running: number;
  failed: number;
  deadLetter: number;
  retrying: number;
  oldestQueuedAgeMs?: number;
  nodeQueued: number;
  nodeRunning: number;
  nodeFailed: number;
  nodeDeadLetter: number;
  nodeRetrying: number;
  nodeOldestQueuedAgeMs?: number;
}

export class SqliteWorkerRepository {
  constructor(readonly db: DatabaseSync) {}

  register(workerId: string, pid: number): void {
    const stamp = new Date().toISOString();
    this.db.prepare(`INSERT INTO worker_heartbeats (worker_id,pid,status,started_at,heartbeat_at,stopped_at)
      VALUES (?, ?, 'ready', ?, ?, NULL)
      ON CONFLICT(worker_id) DO UPDATE SET pid=excluded.pid,status='ready',started_at=excluded.started_at,heartbeat_at=excluded.heartbeat_at,stopped_at=NULL`)
      .run(workerId, pid, stamp, stamp);
  }

  heartbeat(workerId: string): void {
    this.db.prepare("UPDATE worker_heartbeats SET status='ready',heartbeat_at=? WHERE worker_id=? AND stopped_at IS NULL")
      .run(new Date().toISOString(), workerId);
  }

  stop(workerId: string): void {
    const stamp = new Date().toISOString();
    this.db.prepare("UPDATE worker_heartbeats SET status='stopped',heartbeat_at=?,stopped_at=? WHERE worker_id=?")
      .run(stamp, stamp, workerId);
  }

  health(maxAgeMs = 15_000): WorkerHealth {
    const row = this.db.prepare("SELECT * FROM worker_heartbeats WHERE stopped_at IS NULL ORDER BY heartbeat_at DESC LIMIT 1").get() as Record<string, unknown> | undefined;
    if (!row) return { status: "unmanaged", activeWorkers: 0 };
    const heartbeatAt = String(row.heartbeat_at);
    const ageMs = Math.max(0, Date.now() - Date.parse(heartbeatAt));
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const activeWorkers = Number((this.db.prepare("SELECT COUNT(*) AS count FROM worker_heartbeats WHERE stopped_at IS NULL AND heartbeat_at>=?").get(cutoff) as { count: number }).count);
    return { status: ageMs <= maxAgeMs ? "ready" : "stale", workerId: String(row.worker_id), pid: Number(row.pid), heartbeatAt, ageMs, activeWorkers };
  }

  queueStats(): RuntimeQueueStats {
    const count = (table: "runtime_jobs" | "node_jobs", status: string) =>
      Number((this.db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE status=?`).get(status) as { count: number }).count);
    const retrying = (table: "runtime_jobs" | "node_jobs") =>
      Number((this.db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE status='queued' AND attempts>0`).get() as { count: number }).count);
    const oldestAge = (table: "runtime_jobs" | "node_jobs") => {
      const row = this.db.prepare(`SELECT MIN(created_at) AS oldest FROM ${table} WHERE status='queued'`).get() as { oldest?: string | null };
      return row.oldest ? Math.max(0, Date.now() - Date.parse(row.oldest)) : undefined;
    };
    const failed = count("runtime_jobs", "failed");
    const nodeFailed = count("node_jobs", "failed");
    return {
      queued: count("runtime_jobs", "queued"), running: count("runtime_jobs", "running"), failed,
      deadLetter: failed, retrying: retrying("runtime_jobs"), oldestQueuedAgeMs: oldestAge("runtime_jobs"),
      nodeQueued: count("node_jobs", "queued"), nodeRunning: count("node_jobs", "running"), nodeFailed,
      nodeDeadLetter: nodeFailed, nodeRetrying: retrying("node_jobs"), nodeOldestQueuedAgeMs: oldestAge("node_jobs"),
    };
  }
}

export type RuntimeQueueCommand = "lease" | "runtime_complete" | "runtime_fail" | "retry";

export interface RuntimeQueueAuditEvent {
  conversationId: string;
  taskId: string;
  nodeId?: string;
  type: string;
  actorType: "system";
  actorId: string;
  payload: Record<string, unknown>;
}

export interface RuntimeQueueHooks {
  transaction<T>(work: () => T): T;
  transition(status: string, command: RuntimeQueueCommand): { from: string; to: string; event: string };
  task(taskId: string): { id: string; conversationId: string } | null;
  append(event: RuntimeQueueAuditEvent): void;
}

export class SqliteTaskQueueRepository<JobKind extends string> {
  constructor(
    readonly db: DatabaseSync,
    private readonly hooks: RuntimeQueueHooks,
    private readonly defaultKind: JobKind,
  ) {}

  enqueueTask(taskId: string, kind: JobKind = this.defaultKind): string {
    const existing = this.db.prepare("SELECT id FROM runtime_jobs WHERE task_id=? AND kind=? AND status IN ('queued','running') ORDER BY created_at LIMIT 1")
      .get(taskId, kind) as { id?: string } | undefined;
    if (existing?.id) return existing.id;
    const id = randomUUID();
    const stamp = timestamp();
    this.db.prepare("INSERT INTO runtime_jobs (id,task_id,kind,status,attempts,available_at,locked_at,last_error,leased_by,created_at,updated_at) VALUES (?, ?, ?, 'queued', 0, ?, NULL, NULL, NULL, ?, ?)").run(id, taskId, kind, stamp, stamp, stamp);
    const task = this.hooks.task(taskId);
    if (task) this.hooks.append({ conversationId: task.conversationId, taskId, type: "job.queued", actorType: "system", actorId: "runtime-queue", payload: { jobId: id, kind, status: "queued" } });
    return id;
  }

  claimJob(workerId?: string): { id: string; taskId: string; kind: JobKind; attempts: number } | null {
    return this.hooks.transaction(() => {
      const row = this.db.prepare("SELECT * FROM runtime_jobs WHERE status='queued' AND available_at<=? ORDER BY created_at LIMIT 1").get(timestamp()) as Record<string, unknown> | undefined;
      if (!row) return null;
      const transition = this.hooks.transition(String(row.status), "lease");
      this.db.prepare("UPDATE runtime_jobs SET status=?,attempts=attempts+1,locked_at=?,leased_by=?,updated_at=? WHERE id=? AND status=?").run(transition.to, timestamp(), workerId || null, timestamp(), String(row.id), transition.from);
      const task = this.hooks.task(String(row.task_id));
      if (task) this.hooks.append({ conversationId: task.conversationId, taskId: task.id, type: transition.event, actorType: "system", actorId: workerId || "runtime-worker", payload: { jobId: String(row.id), command: "lease", from: transition.from, to: transition.to } });
      return { id: String(row.id), taskId: String(row.task_id), kind: String(row.kind) as JobKind, attempts: Number(row.attempts) + 1 };
    });
  }

  finishJob(id: string, workerId?: string): void {
    this.hooks.transaction(() => {
      const row = this.db.prepare("SELECT * FROM runtime_jobs WHERE id=?").get(id) as Record<string, unknown> | undefined;
      if (!row) throw new Error(`Runtime job not found: ${id}`);
      const transition = this.hooks.transition(String(row.status), "runtime_complete");
      const result = this.db.prepare(`UPDATE runtime_jobs SET status=?,locked_at=NULL,leased_by=NULL,updated_at=? WHERE id=? AND status=?${workerId ? " AND leased_by=?" : ""}`).run(transition.to, timestamp(), id, transition.from, ...(workerId ? [workerId] : []));
      if (Number(result.changes) !== 1) throw new Error(`Runtime job lease is not owned by ${workerId || "current worker"}: ${id}`);
      const task = this.hooks.task(String(row.task_id));
      if (task) this.hooks.append({ conversationId: task.conversationId, taskId: task.id, type: transition.event, actorType: "system", actorId: workerId || "runtime-worker", payload: { jobId: id, command: "runtime_complete", from: transition.from, to: transition.to } });
    });
  }

  failJob(id: string, error: string, retry = true, workerId?: string): void {
    this.hooks.transaction(() => {
      const row = this.db.prepare("SELECT * FROM runtime_jobs WHERE id=?").get(id) as Record<string, unknown> | undefined;
      if (!row) throw new Error(`Runtime job not found: ${id}`);
      const failed = this.hooks.transition(String(row.status), "runtime_fail");
      const result = this.db.prepare(`UPDATE runtime_jobs SET status=?,locked_at=NULL,leased_by=NULL,last_error=?,updated_at=? WHERE id=? AND status=?${workerId ? " AND leased_by=?" : ""}`)
        .run(failed.to, error, timestamp(), id, failed.from, ...(workerId ? [workerId] : []));
      if (Number(result.changes) !== 1) throw new Error(`Runtime job lease is not owned by ${workerId || "current worker"}: ${id}`);
      const task = this.hooks.task(String(row.task_id));
      if (task) this.hooks.append({ conversationId: task.conversationId, taskId: task.id, type: failed.event, actorType: "system", actorId: workerId || "runtime-worker", payload: { jobId: id, command: "runtime_fail", from: failed.from, to: failed.to, error } });
      if (retry) {
        const queued = this.hooks.transition(failed.to, "retry");
        this.db.prepare("UPDATE runtime_jobs SET status=?,available_at=?,updated_at=? WHERE id=? AND status=?")
          .run(queued.to, new Date(Date.now() + 2_000).toISOString(), timestamp(), id, queued.from);
        if (task) this.hooks.append({ conversationId: task.conversationId, taskId: task.id, type: queued.event, actorType: "system", actorId: "runtime-queue", payload: { jobId: id, command: "retry", from: queued.from, to: queued.to, error } });
      }
    });
  }

  recoverStaleJobs(staleMs = 30_000): number {
    const cutoff = new Date(Date.now() - staleMs).toISOString();
    return this.hooks.transaction(() => {
      const rows = this.db.prepare("SELECT id FROM runtime_jobs WHERE status='running' AND locked_at<?").all(cutoff) as Array<{ id: string }>;
      for (const row of rows) {
        this.failJob(String(row.id), "worker lease expired", true);
        this.db.prepare("UPDATE runtime_jobs SET available_at=? WHERE id=?").run(timestamp(), String(row.id));
      }
      return rows.length;
    });
  }

  enqueueNode(taskId: string, nodeId: string): string {
    const existing = this.db.prepare("SELECT id FROM node_jobs WHERE node_id=? AND status IN ('queued','running') ORDER BY created_at LIMIT 1").get(nodeId) as { id?: string } | undefined;
    if (existing?.id) return existing.id;
    const id = randomUUID(); const stamp = timestamp();
    this.db.prepare("INSERT INTO node_jobs (id,task_id,node_id,status,attempts,available_at,locked_at,last_error,leased_by,created_at,updated_at) VALUES (?, ?, ?, 'queued', 0, ?, NULL, NULL, NULL, ?, ?)").run(id, taskId, nodeId, stamp, stamp, stamp);
    const task = this.hooks.task(taskId);
    if (task) this.hooks.append({ conversationId: task.conversationId, taskId, nodeId, type: "job.queued", actorType: "system", actorId: "node-queue", payload: { jobId: id, kind: "execute_node", status: "queued" } });
    return id;
  }

  renewJobLease(id: string, workerId: string): boolean {
    const result = this.db.prepare("UPDATE runtime_jobs SET locked_at=?, updated_at=? WHERE id=? AND status='running' AND leased_by=?").run(timestamp(), timestamp(), id, workerId);
    return Number(result.changes) === 1;
  }

  claimNodeJob(maxConcurrencyPerTask = 3, workerId?: string): { id: string; taskId: string; nodeId: string; attempts: number } | null {
    return this.hooks.transaction(() => {
      const rows = this.db.prepare("SELECT * FROM node_jobs WHERE status='queued' AND available_at<=? ORDER BY created_at").all(timestamp()) as Record<string, unknown>[];
      const row = rows.find((candidate) => Number((this.db.prepare("SELECT COUNT(*) AS count FROM node_jobs WHERE task_id=? AND status='running'").get(String(candidate.task_id)) as { count: number }).count) < maxConcurrencyPerTask);
      if (!row) return null;
      const transition = this.hooks.transition(String(row.status), "lease");
      this.db.prepare("UPDATE node_jobs SET status=?,attempts=attempts+1,locked_at=?,leased_by=?,updated_at=? WHERE id=? AND status=?").run(transition.to, timestamp(), workerId || null, timestamp(), String(row.id), transition.from);
      const task = this.hooks.task(String(row.task_id));
      if (task) this.hooks.append({ conversationId: task.conversationId, taskId: task.id, nodeId: String(row.node_id), type: transition.event, actorType: "system", actorId: workerId || "runtime-worker", payload: { jobId: String(row.id), command: "lease", from: transition.from, to: transition.to } });
      return { id: String(row.id), taskId: String(row.task_id), nodeId: String(row.node_id), attempts: Number(row.attempts) + 1 };
    });
  }

  renewNodeJobLease(id: string, workerId: string): boolean { const result = this.db.prepare("UPDATE node_jobs SET locked_at=?,updated_at=? WHERE id=? AND status='running' AND leased_by=?").run(timestamp(), timestamp(), id, workerId); return Number(result.changes) === 1; }
  finishNodeJob(id: string, workerId?: string): void {
    this.hooks.transaction(() => {
      const row = this.db.prepare("SELECT * FROM node_jobs WHERE id=?").get(id) as Record<string, unknown> | undefined;
      if (!row) throw new Error(`Node job not found: ${id}`);
      const transition = this.hooks.transition(String(row.status), "runtime_complete");
      const result = this.db.prepare(`UPDATE node_jobs SET status=?,locked_at=NULL,leased_by=NULL,updated_at=? WHERE id=? AND status=?${workerId ? " AND leased_by=?" : ""}`).run(transition.to, timestamp(), id, transition.from, ...(workerId ? [workerId] : []));
      if (Number(result.changes) !== 1) throw new Error(`Node job lease is not owned by ${workerId || "current worker"}: ${id}`);
      const task = this.hooks.task(String(row.task_id));
      if (task) this.hooks.append({ conversationId: task.conversationId, taskId: task.id, nodeId: String(row.node_id), type: transition.event, actorType: "system", actorId: workerId || "runtime-worker", payload: { jobId: id, command: "runtime_complete", from: transition.from, to: transition.to } });
    });
  }
  failNodeJob(id: string, error: string, retry = true, workerId?: string): void {
    this.hooks.transaction(() => {
      const row = this.db.prepare("SELECT * FROM node_jobs WHERE id=?").get(id) as Record<string, unknown> | undefined;
      if (!row) throw new Error(`Node job not found: ${id}`);
      const failed = this.hooks.transition(String(row.status), "runtime_fail");
      const result = this.db.prepare(`UPDATE node_jobs SET status=?,locked_at=NULL,leased_by=NULL,last_error=?,updated_at=? WHERE id=? AND status=?${workerId ? " AND leased_by=?" : ""}`).run(failed.to, error, timestamp(), id, failed.from, ...(workerId ? [workerId] : []));
      if (Number(result.changes) !== 1) throw new Error(`Node job lease is not owned by ${workerId || "current worker"}: ${id}`);
      const task = this.hooks.task(String(row.task_id));
      if (task) this.hooks.append({ conversationId: task.conversationId, taskId: task.id, nodeId: String(row.node_id), type: failed.event, actorType: "system", actorId: workerId || "runtime-worker", payload: { jobId: id, command: "runtime_fail", from: failed.from, to: failed.to, error } });
      if (retry) {
        const queued = this.hooks.transition(failed.to, "retry");
        this.db.prepare("UPDATE node_jobs SET status=?,available_at=?,updated_at=? WHERE id=? AND status=?").run(queued.to, new Date(Date.now() + 2_000).toISOString(), timestamp(), id, queued.from);
        if (task) this.hooks.append({ conversationId: task.conversationId, taskId: task.id, nodeId: String(row.node_id), type: queued.event, actorType: "system", actorId: "node-queue", payload: { jobId: id, command: "retry", from: queued.from, to: queued.to, error } });
      }
    });
  }
  recoverStaleNodeJobs(staleMs = 30_000): number {
    const cutoff = new Date(Date.now() - staleMs).toISOString();
    return this.hooks.transaction(() => {
      const rows = this.db.prepare("SELECT id FROM node_jobs WHERE status='running' AND locked_at<?").all(cutoff) as Array<{ id: string }>;
      for (const row of rows) {
        this.failNodeJob(String(row.id), "worker lease expired", true);
        this.db.prepare("UPDATE node_jobs SET available_at=? WHERE id=?").run(timestamp(), String(row.id));
      }
      return rows.length;
    });
  }
}
export class SqliteUnitOfWork {
  private depth = 0;
  constructor(readonly db: DatabaseSync) {}
  run<T>(work: () => T): T {
    if (this.depth) return work();
    this.depth += 1;
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = work(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
    finally { this.depth -= 1; }
  }
}

export function migrateDecisionCore(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_bundle_registry (
      bundle_id TEXT PRIMARY KEY, manifest_json TEXT NOT NULL, installed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS research_run_locks (
      run_id TEXT PRIMARY KEY, research_case_id TEXT NOT NULL, bundle_id TEXT NOT NULL,
      as_of TEXT NOT NULL, locked_at TEXT NOT NULL,
      FOREIGN KEY(bundle_id) REFERENCES knowledge_bundle_registry(bundle_id)
    );
    CREATE TABLE IF NOT EXISTS orchestrator_work_orders (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL, node_id TEXT NOT NULL, idempotency_key TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL, order_json TEXT NOT NULL, result_json TEXT, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orchestrator_artifacts (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL, node_id TEXT NOT NULL, kind TEXT NOT NULL,
      envelope_json TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS decision_audit_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, type TEXT NOT NULL,
      actor_id TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `);
}

export class SqliteRunLockRepository {
  constructor(readonly db: DatabaseSync) { migrateDecisionCore(db); }
  installBundle(bundleId: string, manifest: unknown): void {
    this.db.prepare("INSERT OR IGNORE INTO knowledge_bundle_registry(bundle_id,manifest_json,installed_at) VALUES(?,?,?)")
      .run(bundleId, encode(manifest), new Date().toISOString());
  }
  lock(value: ResearchRunLock): ResearchRunLock {
    const existing = this.get(value.runId);
    if (existing) {
      if (existing.bundleId !== value.bundleId) throw new Error("A research run cannot switch knowledge bundles");
      return existing;
    }
    this.db.prepare("INSERT INTO research_run_locks(run_id,research_case_id,bundle_id,as_of,locked_at) VALUES(?,?,?,?,?)")
      .run(value.runId, value.researchCaseId, value.bundleId, value.asOf, value.lockedAt);
    return value;
  }
  get(runId: string): ResearchRunLock | null {
    const row = this.db.prepare("SELECT * FROM research_run_locks WHERE run_id=?").get(runId) as Record<string, unknown> | undefined;
    return row ? { runId: String(row.run_id), researchCaseId: String(row.research_case_id), bundleId: String(row.bundle_id) as ResearchRunLock["bundleId"], asOf: String(row.as_of), lockedAt: String(row.locked_at) } : null;
  }
}

export class SqliteOrchestratorRepository implements WorkOrderRepository, ArtifactRepository, AuditEventWriter {
  constructor(readonly db: DatabaseSync) { migrateDecisionCore(db); }
  findByIdempotencyKey(key: string): WorkOrder | null {
    const row = this.db.prepare("SELECT order_json FROM orchestrator_work_orders WHERE idempotency_key=?").get(key) as { order_json?: string } | undefined;
    return row?.order_json ? decode<WorkOrder>(row.order_json) : null;
  }
  put(order: WorkOrder): void {
    this.db.prepare("INSERT INTO orchestrator_work_orders(id,run_id,node_id,idempotency_key,status,order_json,updated_at) VALUES(?,?,?,?,?,?,?)")
      .run(order.id, order.runId, order.nodeId, order.idempotencyKey, "queued", encode(order), new Date().toISOString());
  }
  complete(order: WorkOrder, result: WorkerResult): void {
    this.db.prepare("UPDATE orchestrator_work_orders SET status=?,result_json=?,updated_at=? WHERE id=?")
      .run(result.status, encode(result), new Date().toISOString(), order.id);
  }
  putArtifact(artifact: ArtifactEnvelope): void {
    this.db.prepare("INSERT INTO orchestrator_artifacts(id,run_id,node_id,kind,envelope_json,created_at) VALUES(?,?,?,?,?,?)")
      .run(artifact.id, artifact.runId, artifact.nodeId, artifact.kind, encode(artifact), artifact.createdAt);
  }
  append(event: { runId: string; type: string; actorId: string; payload: Record<string, unknown> }): void {
    this.db.prepare("INSERT INTO decision_audit_events(run_id,type,actor_id,payload_json,created_at) VALUES(?,?,?,?,?)")
      .run(event.runId, event.type, event.actorId, encode(event.payload), new Date().toISOString());
  }
  listArtifacts(runId: string): ArtifactEnvelope[] {
    return (this.db.prepare("SELECT envelope_json FROM orchestrator_artifacts WHERE run_id=? ORDER BY rowid").all(runId) as Array<{ envelope_json: string }>).map((row) => decode<ArtifactEnvelope>(row.envelope_json));
  }
  listEvents(runId: string): Array<{ sequence: number; type: string; actorId: string; payload: Record<string, unknown>; createdAt: string }> {
    return (this.db.prepare("SELECT * FROM decision_audit_events WHERE run_id=? ORDER BY sequence").all(runId) as Record<string, unknown>[]).map((row) => ({
      sequence: Number(row.sequence), type: String(row.type), actorId: String(row.actor_id), payload: decode<Record<string, unknown>>(row.payload_json), createdAt: String(row.created_at),
    }));
  }
  listOrders(runId: string): Array<{ order: WorkOrder; result?: WorkerResult }> {
    return (this.db.prepare("SELECT order_json,result_json FROM orchestrator_work_orders WHERE run_id=? ORDER BY rowid").all(runId) as Array<{ order_json: string; result_json?: string }>).map((row) => ({
      order: decode<WorkOrder>(row.order_json), result: row.result_json ? decode<WorkerResult>(row.result_json) : undefined,
    }));
  }
}
