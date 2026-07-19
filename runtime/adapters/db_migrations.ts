import type { DatabaseSync } from "node:sqlite";

export const LATEST_DATABASE_SCHEMA_VERSION = 6;

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
