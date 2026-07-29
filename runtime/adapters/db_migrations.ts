import type { DatabaseSync } from "node:sqlite";

export const LATEST_DATABASE_SCHEMA_VERSION = 14;

type Migration = {
  version: number;
  description: string;
  apply(connection: DatabaseSync): void;
};

function tableColumns(connection: DatabaseSync, table: string) {
  return connection.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
}

function hasTable(connection: DatabaseSync, table: string) {
  return Boolean(connection.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function ensureColumn(connection: DatabaseSync, table: string, column: string, ddl: string) {
  if (!tableColumns(connection, table).some((row) => row.name === column)) {
    connection.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

const migrations: Migration[] = [
  {
    version: 1,
    description: "research runs, immutable artifacts and source registry",
    apply(connection) {
      connection.exec(`
        CREATE TABLE IF NOT EXISTS research_runs (
          id TEXT PRIMARY KEY, question TEXT NOT NULL, domain TEXT NOT NULL,
          current_stage INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'draft',
          package_path TEXT, manifest_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS artifacts (
          id TEXT PRIMARY KEY, run_id TEXT NOT NULL, kind TEXT NOT NULL, version INTEGER NOT NULL,
          status TEXT NOT NULL, json_content TEXT NOT NULL DEFAULT '{}', markdown_content TEXT NOT NULL DEFAULT '',
          model_name TEXT, prompt_version TEXT NOT NULL DEFAULT '', knowledge_version TEXT NOT NULL DEFAULT '',
          input_context TEXT NOT NULL DEFAULT '', raw_model_output TEXT NOT NULL DEFAULT '', response_id TEXT,
          token_usage TEXT NOT NULL DEFAULT '{}', tool_usage TEXT NOT NULL DEFAULT '{}', error_message TEXT,
          created_at TEXT NOT NULL, approved_at TEXT,
          FOREIGN KEY(run_id) REFERENCES research_runs(id) ON DELETE CASCADE,
          UNIQUE(run_id, kind, version)
        );
        CREATE TABLE IF NOT EXISTS source (
          id TEXT PRIMARY KEY, run_id TEXT NOT NULL, normalized_url TEXT NOT NULL, url TEXT NOT NULL,
          title TEXT NOT NULL, publisher TEXT NOT NULL DEFAULT '', published_at TEXT, accessed_at TEXT NOT NULL,
          source_type TEXT NOT NULL DEFAULT 'web', search_excerpt TEXT NOT NULL DEFAULT '',
          FOREIGN KEY(run_id) REFERENCES research_runs(id) ON DELETE CASCADE,
          UNIQUE(run_id, normalized_url)
        );
        CREATE INDEX IF NOT EXISTS idx_artifacts_run_kind ON artifacts(run_id, kind, version DESC);
        CREATE INDEX IF NOT EXISTS idx_sources_run ON source(run_id);
      `);
      ensureColumn(connection, "research_runs", "package_path", "TEXT");
      ensureColumn(connection, "research_runs", "manifest_json", "TEXT NOT NULL DEFAULT '{}'");
    },
  },
  {
    version: 2,
    description: "event radar, parent runs and object-level work items",
    apply(connection) {
      ensureColumn(connection, "research_runs", "parent_run_id", "TEXT");
      ensureColumn(connection, "research_runs", "trigger_event_id", "TEXT");
      connection.exec(`
        CREATE TABLE IF NOT EXISTS market_events (
          id TEXT PRIMARY KEY, dedupe_key TEXT NOT NULL UNIQUE, title TEXT NOT NULL, summary TEXT NOT NULL,
          url TEXT NOT NULL, publisher TEXT NOT NULL DEFAULT '', occurred_at TEXT, published_at TEXT,
          event_type TEXT NOT NULL DEFAULT 'market_update', object_labels_json TEXT NOT NULL DEFAULT '[]',
          confidence TEXT NOT NULL DEFAULT 'medium', status TEXT NOT NULL DEFAULT 'new',
          refresh_batch_id TEXT NOT NULL, discovered_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS event_impacts (
          id TEXT PRIMARY KEY, event_id TEXT NOT NULL, run_id TEXT NOT NULL, judgment_unit_id TEXT,
          judgment_id TEXT, matched_condition TEXT, direction TEXT NOT NULL, relevance REAL NOT NULL,
          rationale TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'suggested', created_at TEXT NOT NULL,
          FOREIGN KEY(event_id) REFERENCES market_events(id) ON DELETE CASCADE,
          FOREIGN KEY(run_id) REFERENCES research_runs(id) ON DELETE CASCADE,
          UNIQUE(event_id, run_id, judgment_unit_id, judgment_id)
        );
        CREATE TABLE IF NOT EXISTS research_work_items (
          id TEXT PRIMARY KEY, run_id TEXT NOT NULL, kind TEXT NOT NULL, stage TEXT NOT NULL,
          target_type TEXT NOT NULL, target_id TEXT NOT NULL, title TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending', priority TEXT NOT NULL DEFAULT 'medium',
          reason TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', source_event_id TEXT,
          payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, resolved_at TEXT,
          FOREIGN KEY(run_id) REFERENCES research_runs(id) ON DELETE CASCADE,
          FOREIGN KEY(source_event_id) REFERENCES market_events(id) ON DELETE SET NULL,
          UNIQUE(run_id, kind, target_type, target_id)
        );
        CREATE INDEX IF NOT EXISTS idx_events_discovered ON market_events(discovered_at DESC);
        CREATE INDEX IF NOT EXISTS idx_impacts_event ON event_impacts(event_id);
        CREATE INDEX IF NOT EXISTS idx_impacts_run ON event_impacts(run_id);
        CREATE INDEX IF NOT EXISTS idx_work_items_run_status ON research_work_items(run_id,status);
      `);
    },
  },
  {
    version: 3,
    description: "versioned review work, source snapshots and approved idempotent actions",
    apply(connection) {
      ensureColumn(connection, "research_runs", "trigger_classification", "TEXT");
      ensureColumn(connection, "event_impacts", "impact_classification", "TEXT NOT NULL DEFAULT 'evidence_update'");
      ensureColumn(connection, "source", "locator", "TEXT NOT NULL DEFAULT ''");
      ensureColumn(connection, "source", "captured_at", "TEXT");
      ensureColumn(connection, "source", "content_hash", "TEXT NOT NULL DEFAULT ''");
      ensureColumn(connection, "source", "usability_status", "TEXT NOT NULL DEFAULT 'candidate'");
      ensureColumn(connection, "source", "failure_category", "TEXT NOT NULL DEFAULT ''");
      ensureColumn(connection, "source", "failure_detail", "TEXT NOT NULL DEFAULT ''");

      if (hasTable(connection, "research_work_items") && !tableColumns(connection, "research_work_items").some((row) => row.name === "artifact_id")) {
        connection.exec(`
          CREATE TABLE research_work_items_v3 (
            id TEXT PRIMARY KEY, run_id TEXT NOT NULL, kind TEXT NOT NULL, stage TEXT NOT NULL,
            target_type TEXT NOT NULL, target_id TEXT NOT NULL, title TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending', priority TEXT NOT NULL DEFAULT 'medium',
            reason TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', source_event_id TEXT,
            artifact_id TEXT NOT NULL DEFAULT '', attempt INTEGER NOT NULL DEFAULT 0,
            payload_json TEXT NOT NULL DEFAULT '{}', resolution TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL, resolved_at TEXT, superseded_at TEXT,
            FOREIGN KEY(run_id) REFERENCES research_runs(id) ON DELETE CASCADE,
            FOREIGN KEY(source_event_id) REFERENCES market_events(id) ON DELETE SET NULL,
            UNIQUE(run_id, kind, target_type, target_id, artifact_id, attempt)
          );
          INSERT INTO research_work_items_v3(
            id,run_id,kind,stage,target_type,target_id,title,status,priority,reason,note,source_event_id,
            artifact_id,attempt,payload_json,resolution,created_at,updated_at,resolved_at,superseded_at
          )
          SELECT id,run_id,kind,stage,target_type,target_id,title,status,priority,reason,note,source_event_id,
            '',0,payload_json,'',created_at,updated_at,resolved_at,NULL
          FROM research_work_items;
          DROP TABLE research_work_items;
          ALTER TABLE research_work_items_v3 RENAME TO research_work_items;
        `);
      }
      connection.exec(`
        CREATE INDEX IF NOT EXISTS idx_work_items_run_status ON research_work_items(run_id,status);
        CREATE INDEX IF NOT EXISTS idx_work_items_artifact_attempt ON research_work_items(artifact_id,attempt);
        CREATE TABLE IF NOT EXISTS action_proposals (
          id TEXT PRIMARY KEY, run_id TEXT NOT NULL, action_id TEXT NOT NULL,
          parameters_json TEXT NOT NULL, expected_graph_version INTEGER NOT NULL,
          proposal_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', work_item_id TEXT NOT NULL,
          created_at TEXT NOT NULL, approved_at TEXT, executed_at TEXT, execution_id TEXT,
          FOREIGN KEY(run_id) REFERENCES research_runs(id) ON DELETE CASCADE,
          FOREIGN KEY(work_item_id) REFERENCES research_work_items(id) ON DELETE RESTRICT
        );
        CREATE TABLE IF NOT EXISTS action_executions (
          execution_id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL UNIQUE, run_id TEXT NOT NULL,
          action_id TEXT NOT NULL, graph_version_before INTEGER NOT NULL, graph_version_after INTEGER NOT NULL,
          status TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL,
          FOREIGN KEY(proposal_id) REFERENCES action_proposals(id) ON DELETE RESTRICT,
          FOREIGN KEY(run_id) REFERENCES research_runs(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_action_proposals_run_status ON action_proposals(run_id,status);
      `);
    },
  },
  {
    version: 4,
    description: "verifiable source body snapshots and retrieval diagnostics",
    apply(connection) {
      ensureColumn(connection, "source", "final_url", "TEXT NOT NULL DEFAULT ''");
      ensureColumn(connection, "source", "content_mime", "TEXT NOT NULL DEFAULT ''");
      ensureColumn(connection, "source", "http_status", "INTEGER");
      ensureColumn(connection, "source", "retrieval_status", "TEXT NOT NULL DEFAULT 'not_attempted'");
      ensureColumn(connection, "source", "snapshot_text", "TEXT NOT NULL DEFAULT ''");
      ensureColumn(connection, "source", "source_quote", "TEXT NOT NULL DEFAULT ''");
      ensureColumn(connection, "source", "quote_verified", "INTEGER NOT NULL DEFAULT 0");
    },
  },
  {
    version: 5,
    description: "source quality tier and independence group",
    apply(connection) {
      ensureColumn(connection, "source", "source_tier", "TEXT NOT NULL DEFAULT 'S8'");
      ensureColumn(connection, "source", "source_group", "TEXT NOT NULL DEFAULT ''");
    },
  },
  {
    version: 6,
    description: "repair legacy work-item artifact binding field order",
    apply(connection) {
      // Legacy writes shifted these three values by one column. A JSON value
      // in artifact_id is an unambiguous marker because real artifact IDs are
      // UUIDs (or the empty string). SQLite evaluates the assignments from the
      // old row, allowing all three values to be restored atomically.
      connection.exec(`
        UPDATE research_work_items
        SET artifact_id = CAST(attempt AS TEXT),
            attempt = CAST(payload_json AS INTEGER),
            payload_json = artifact_id
        WHERE json_valid(artifact_id) = 1;
      `);
    },
  },
  {
    version: 7,
    description: "enforce one running generation per run and artifact kind",
    apply(connection) {
      connection.exec(`
        UPDATE artifacts
        SET status='failed',
            error_message=COALESCE(error_message, '数据库升级时终止遗留生成租约')
        WHERE status='running';
        CREATE UNIQUE INDEX IF NOT EXISTS idx_artifacts_one_running
        ON artifacts(run_id, kind)
        WHERE status='running';
      `);
    },
  },
  {
    version: 8,
    description: "source authority type taxonomy",
    apply(connection) {
      ensureColumn(connection, "source", "authority_type", "TEXT NOT NULL DEFAULT 'unknown'");
    },
  },
  {
    version: 9,
    description: "durable research jobs with fenced leases, retries and budgets",
    apply(connection) {
      connection.exec(`
        CREATE TABLE IF NOT EXISTS research_jobs (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          job_type TEXT NOT NULL,
          stage TEXT NOT NULL DEFAULT '',
          artifact_id TEXT,
          status TEXT NOT NULL DEFAULT 'queued'
            CHECK(status IN ('queued','running','waiting_for_review','waiting_for_input','retrying','blocked','completed','cancelled')),
          dedupe_key TEXT NOT NULL,
          lease_token TEXT,
          worker_id TEXT,
          lease_expires_at TEXT,
          heartbeat_at TEXT,
          attempt INTEGER NOT NULL DEFAULT 0 CHECK(attempt >= 0),
          max_attempts INTEGER NOT NULL DEFAULT 3 CHECK(max_attempts > 0),
          available_at TEXT NOT NULL,
          budget_json TEXT NOT NULL DEFAULT '{}',
          input_artifacts_json TEXT NOT NULL DEFAULT '[]',
          input_hash TEXT NOT NULL,
          payload_json TEXT NOT NULL DEFAULT '{}',
          result_json TEXT NOT NULL DEFAULT '{}',
          last_error TEXT,
          queued_at TEXT NOT NULL,
          started_at TEXT,
          finished_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(run_id) REFERENCES research_runs(id) ON DELETE CASCADE,
          FOREIGN KEY(artifact_id) REFERENCES artifacts(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_research_jobs_claim
          ON research_jobs(status, available_at, created_at);
        CREATE INDEX IF NOT EXISTS idx_research_jobs_run
          ON research_jobs(run_id, created_at DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_research_jobs_active_dedupe
          ON research_jobs(dedupe_key)
          WHERE status IN ('queued','running','waiting_for_review','waiting_for_input','retrying');
      `);
    },
  },
  {
    version: 10,
    description: "allow new generation after a prior job reaches human review",
    apply(connection) {
      connection.exec(`
        DROP INDEX IF EXISTS idx_research_jobs_active_dedupe;
        CREATE UNIQUE INDEX idx_research_jobs_active_dedupe
          ON research_jobs(dedupe_key)
          WHERE status IN ('queued','running','waiting_for_input','retrying');
      `);
    },
  },
  {
    version: 11,
    description: "cross-run ontology candidate governance and append-only expert decisions",
    apply(connection) {
      connection.exec(`
        CREATE TABLE IF NOT EXISTS ontology_candidate_reviews (
          candidate_key TEXT PRIMARY KEY,
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK(status IN ('pending','expert_confirmed','promoted','rejected')),
          expert_name TEXT NOT NULL DEFAULT '',
          decision_note TEXT NOT NULL DEFAULT '',
          target_ontology_node_id TEXT NOT NULL DEFAULT '',
          reviewed_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ontology_candidate_review_events (
          id TEXT PRIMARY KEY,
          candidate_key TEXT NOT NULL,
          prior_status TEXT NOT NULL,
          next_status TEXT NOT NULL,
          expert_name TEXT NOT NULL,
          decision_note TEXT NOT NULL,
          target_ontology_node_id TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          FOREIGN KEY(candidate_key) REFERENCES ontology_candidate_reviews(candidate_key) ON DELETE RESTRICT
        );
        CREATE INDEX IF NOT EXISTS idx_ontology_candidate_review_status
          ON ontology_candidate_reviews(status, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_ontology_candidate_events_key
          ON ontology_candidate_review_events(candidate_key, created_at DESC);
      `);
    },
  },
  {
    version: 12,
    description: "append-only researcher experience events for workflow KPI measurement",
    apply(connection) {
      connection.exec(`
        CREATE TABLE IF NOT EXISTS research_experience_events (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          actor_type TEXT NOT NULL CHECK(actor_type IN ('human','ai','system')),
          stage TEXT NOT NULL DEFAULT '',
          target_type TEXT NOT NULL DEFAULT '',
          target_id TEXT NOT NULL DEFAULT '',
          outcome TEXT NOT NULL DEFAULT '',
          payload_json TEXT NOT NULL DEFAULT '{}',
          dedupe_key TEXT NOT NULL UNIQUE,
          occurred_at TEXT NOT NULL,
          FOREIGN KEY(run_id) REFERENCES research_runs(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_research_experience_run_time
          ON research_experience_events(run_id, occurred_at);
        CREATE INDEX IF NOT EXISTS idx_research_experience_type
          ON research_experience_events(event_type, occurred_at);
      `);
    },
  },
  {
    version: 13,
    description: "runtime meta key-value store for radar refresh timestamps",
    apply(connection) {
      connection.exec(`
        CREATE TABLE IF NOT EXISTS runtime_meta (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL DEFAULT '{}',
          updated_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 14,
    description: "ontology change requests separate candidate acceptance from formal release",
    apply(connection) {
      connection.exec(`
        CREATE TABLE IF NOT EXISTS ontology_change_requests (
          id TEXT PRIMARY KEY,
          candidate_key TEXT NOT NULL,
          request_version INTEGER NOT NULL DEFAULT 1,
          change_kind TEXT NOT NULL DEFAULT 'add'
            CHECK(change_kind IN ('add','modify','deprecate','split','merge')),
          status TEXT NOT NULL DEFAULT 'proposed'
            CHECK(status IN ('proposed','impact_assessed','approved','implemented','validated','released','rejected')),
          target_ontology_node_id TEXT NOT NULL,
          breaking_change INTEGER NOT NULL DEFAULT 0 CHECK(breaking_change IN (0,1)),
          proposal_note TEXT NOT NULL DEFAULT '',
          impact_report_json TEXT NOT NULL DEFAULT '{}',
          required_checks_json TEXT NOT NULL DEFAULT '[]',
          validation_results_json TEXT NOT NULL DEFAULT '{}',
          implementation_ref TEXT NOT NULL DEFAULT '',
          migration_ref TEXT NOT NULL DEFAULT '',
          release_fingerprint TEXT NOT NULL DEFAULT '',
          created_by TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          released_at TEXT,
          UNIQUE(candidate_key, request_version),
          FOREIGN KEY(candidate_key) REFERENCES ontology_candidate_reviews(candidate_key) ON DELETE RESTRICT
        );
        CREATE TABLE IF NOT EXISTS ontology_change_request_events (
          id TEXT PRIMARY KEY,
          request_id TEXT NOT NULL,
          prior_status TEXT NOT NULL,
          next_status TEXT NOT NULL,
          actor_name TEXT NOT NULL,
          decision_note TEXT NOT NULL,
          evidence_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          FOREIGN KEY(request_id) REFERENCES ontology_change_requests(id) ON DELETE RESTRICT
        );
        CREATE INDEX IF NOT EXISTS idx_ontology_change_requests_status
          ON ontology_change_requests(status, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_ontology_change_requests_candidate
          ON ontology_change_requests(candidate_key, request_version DESC);
        CREATE INDEX IF NOT EXISTS idx_ontology_change_request_events_request
          ON ontology_change_request_events(request_id, created_at DESC);

        INSERT OR IGNORE INTO ontology_change_requests(
          id,candidate_key,request_version,change_kind,status,target_ontology_node_id,
          proposal_note,created_by,created_at,updated_at
        )
        SELECT
          'OCR-legacy-' || substr(candidate_key, 12),
          candidate_key,1,'add','proposed',target_ontology_node_id,
          decision_note,expert_name,COALESCE(reviewed_at,created_at),updated_at
        FROM ontology_candidate_reviews
        WHERE status='promoted' AND target_ontology_node_id <> '';

        INSERT OR IGNORE INTO ontology_change_request_events(
          id,request_id,prior_status,next_status,actor_name,decision_note,evidence_json,created_at
        )
        SELECT
          'OCRE-legacy-' || substr(candidate.candidate_key, 12),
          request.id,'none','proposed',candidate.expert_name,candidate.decision_note,
          json_object(
            'candidate_key', candidate.candidate_key,
            'target_ontology_node_id', candidate.target_ontology_node_id,
            'migration_source', 'ontology_candidate_reviews.status=promoted'
          ),
          COALESCE(candidate.reviewed_at,candidate.created_at)
        FROM ontology_candidate_reviews candidate
        JOIN ontology_change_requests request
          ON request.candidate_key=candidate.candidate_key AND request.request_version=1
        WHERE candidate.status='promoted' AND candidate.target_ontology_node_id <> '';
      `);
    },
  },
];

export function runDatabaseMigrations(connection: DatabaseSync) {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  const applied = new Set(
    (connection.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: number }>).map((row) => Number(row.version)),
  );
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    connection.exec("BEGIN IMMEDIATE");
    try {
      migration.apply(connection);
      connection.prepare("INSERT INTO schema_migrations(version,description,applied_at) VALUES(?,?,?)")
        .run(migration.version, migration.description, new Date().toISOString());
      connection.exec("COMMIT");
    } catch (error) {
      connection.exec("ROLLBACK");
      throw error;
    }
  }
  const current = Number((connection.prepare("SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations").get() as { version: number }).version);
  if (current !== LATEST_DATABASE_SCHEMA_VERSION) {
    throw new Error(`数据库迁移不完整: ${current}/${LATEST_DATABASE_SCHEMA_VERSION}`);
  }
}

export function databaseSchemaVersion(connection: DatabaseSync) {
  if (!hasTable(connection, "schema_migrations")) return 0;
  return Number((connection.prepare("SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations").get() as { version: number }).version);
}

/** Recover legacy running artifacts without terminating another process's valid leased work. */
export function recoverOrphanedRunningArtifacts(connection: DatabaseSync, now = new Date().toISOString()) {
  const result = connection.prepare(`UPDATE artifacts SET
    status='failed', error_message=COALESCE(error_message, '服务中断，后台任务将从阶段起点重试')
    WHERE status='running' AND NOT EXISTS (
      SELECT 1 FROM research_jobs job
      WHERE job.artifact_id=artifacts.id
        AND (
          (job.status='running' AND job.lease_expires_at > ?)
          OR (
            artifacts.kind='stage_03'
            AND job.status IN ('running','retrying')
            AND job.attempt < job.max_attempts
            AND json_valid(artifacts.json_content)
            AND json_type(artifacts.json_content, '$.stage03_batch_checkpoint')='object'
          )
        )
    )`).run(now);
  return Number(result.changes);
}
