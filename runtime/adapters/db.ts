import "server-only";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Artifact, ArtifactKind, ArtifactStatus, ResearchRun, SourceRecord } from "../engine/types";
import { createEmptyManifest, parseManifest, recordApprovedStage } from "../engine/manifest";
import { repositoryPath } from "./repo-paths";

const dbPath = process.env.WORKBENCH_DB_PATH
  ? path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.WORKBENCH_DB_PATH)
  : repositoryPath("instances", "00_本机运行", "workbench.sqlite");
mkdirSync(path.dirname(dbPath), { recursive: true });

const globalDb = globalThis as unknown as { workbenchDb?: DatabaseSync };
function getDb() {
  if (globalDb.workbenchDb) return globalDb.workbenchDb;
  const connection = new DatabaseSync(dbPath);
  connection.exec(`
  PRAGMA busy_timeout = 5000;
  PRAGMA foreign_keys = ON;
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
  connection.prepare("UPDATE artifacts SET status='failed', error_message=COALESCE(error_message, '服务中断，请重新生成') WHERE status='running'").run();
  globalDb.workbenchDb = connection;
  return connection;
}

function ensureColumn(connection: DatabaseSync, table: string, column: string, ddl: string) {
  const rows = connection.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!rows.some((row) => row.name === column)) {
    connection.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

const db = new Proxy({} as DatabaseSync, {
  get(_target, property) {
    const connection: any = getDb();
    const value = connection[property];
    return typeof value === "function" ? value.bind(connection) : value;
  },
});

function mapRun(row: any): ResearchRun {
  return {
    id: row.id,
    question: row.question,
    domain: row.domain,
    current_stage: row.current_stage,
    status: row.status,
    package_path: row.package_path ?? null,
    manifest_json: row.manifest_json || "{}",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function listRuns(): ResearchRun[] {
  return (db.prepare("SELECT * FROM research_runs ORDER BY created_at DESC").all() as any[]).map(mapRun);
}
export function getRun(id: string): ResearchRun | undefined {
  const row = db.prepare("SELECT * FROM research_runs WHERE id=?").get(id) as any;
  return row ? mapRun(row) : undefined;
}
export function createRun(question: string, domain: string, packagePath?: string | null): ResearchRun {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const draft = mapRun({
    id,
    question,
    domain,
    current_stage: 0,
    status: "draft",
    package_path: packagePath || null,
    manifest_json: "{}",
    created_at: now,
    updated_at: now,
  });
  const manifest = createEmptyManifest(draft);
  db.prepare(
    "INSERT INTO research_runs(id,question,domain,current_stage,status,package_path,manifest_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
  ).run(id, question, domain, 0, "draft", packagePath || null, JSON.stringify(manifest), now, now);
  return getRun(id)!;
}
export function updateRun(id: string, fields: Partial<Pick<ResearchRun, "package_path" | "manifest_json" | "status" | "current_stage">>): ResearchRun {
  const entries = Object.entries({ ...fields, updated_at: new Date().toISOString() }).filter(([, value]) => value !== undefined);
  if (entries.length) {
    db.prepare(`UPDATE research_runs SET ${entries.map(([key]) => `${key}=?`).join(",")} WHERE id=?`).run(
      ...entries.map(([, value]) => value as string | number | null),
      id,
    );
  }
  return getRun(id)!;
}
export function listArtifacts(runId: string): Artifact[] {
  return db.prepare("SELECT * FROM artifacts WHERE run_id=? ORDER BY created_at DESC").all(runId) as Artifact[];
}
export function getArtifact(id: string): Artifact | undefined {
  return db.prepare("SELECT * FROM artifacts WHERE id=?").get(id) as Artifact | undefined;
}
export function latestArtifact(runId: string, kind: ArtifactKind, statuses?: ArtifactStatus[]): Artifact | undefined {
  const rows = listArtifacts(runId).filter((x) => x.kind === kind && (!statuses || statuses.includes(x.status)));
  return rows.sort((a, b) => b.version - a.version)[0];
}
export function createArtifact(runId: string, kind: ArtifactKind, data: Partial<Artifact> = {}): Artifact {
  const version = Number((db.prepare("SELECT COALESCE(MAX(version),0)+1 v FROM artifacts WHERE run_id=? AND kind=?").get(runId, kind) as { v: number }).v);
  const artifact: Artifact = {
    id: crypto.randomUUID(),
    run_id: runId,
    kind,
    version,
    status: data.status || "running",
    json_content: data.json_content || "{}",
    markdown_content: data.markdown_content || "",
    model_name: data.model_name || null,
    prompt_version: data.prompt_version || "",
    knowledge_version: data.knowledge_version || "",
    input_context: data.input_context || "",
    raw_model_output: data.raw_model_output || "",
    response_id: data.response_id || null,
    token_usage: data.token_usage || "{}",
    tool_usage: data.tool_usage || "{}",
    error_message: data.error_message || null,
    created_at: new Date().toISOString(),
    approved_at: data.approved_at || null,
  };
  db.prepare(`INSERT INTO artifacts VALUES(${Array(18).fill("?").join(",")})`).run(...Object.values(artifact));
  return artifact;
}
export function updateArtifact(
  id: string,
  fields: Partial<
    Pick<
      Artifact,
      | "status"
      | "json_content"
      | "markdown_content"
      | "model_name"
      | "prompt_version"
      | "knowledge_version"
      | "input_context"
      | "raw_model_output"
      | "response_id"
      | "token_usage"
      | "tool_usage"
      | "error_message"
      | "approved_at"
    >
  >,
): Artifact {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (entries.length) db.prepare(`UPDATE artifacts SET ${entries.map(([k]) => `${k}=?`).join(",")} WHERE id=?`).run(...entries.map(([, v]) => v as string | null), id);
  return db.prepare("SELECT * FROM artifacts WHERE id=?").get(id) as Artifact;
}
export function supersedeDownstream(runId: string, afterStage: number) {
  const kinds = ["stage_01", "stage_02", "stage_03", "stage_04", "stage_05"].slice(afterStage);
  if (kinds.length) {
    db.prepare(
      `UPDATE artifacts SET status='superseded' WHERE run_id=? AND kind IN (${kinds.map(() => "?").join(",")}) AND status IN ('approved','needs_review')`,
    ).run(runId, ...kinds);
  }
}
export function approveArtifact(artifact: Artifact) {
  const stage = Number(artifact.kind.slice(-2));
  updateArtifact(artifact.id, { status: "approved", approved_at: new Date().toISOString() });
  const run = getRun(artifact.run_id);
  if (run) {
    const approved = getArtifact(artifact.id)!;
    const manifest = recordApprovedStage(parseManifest(run.manifest_json, run), approved);
    updateRun(run.id, {
      current_stage: stage || run.current_stage,
      status: stage === 5 ? "complete" : "in_progress",
      manifest_json: JSON.stringify(manifest),
    });
  } else if (stage) {
    db.prepare("UPDATE research_runs SET current_stage=?, status=?, updated_at=? WHERE id=?").run(
      stage,
      stage === 5 ? "complete" : "in_progress",
      new Date().toISOString(),
      artifact.run_id,
    );
  }
}
export function listSources(runId: string): SourceRecord[] {
  return db.prepare("SELECT * FROM source WHERE run_id=? ORDER BY accessed_at DESC").all(runId) as SourceRecord[];
}
export function upsertSource(runId: string, input: Omit<SourceRecord, "id" | "run_id" | "normalized_url" | "accessed_at">): SourceRecord {
  const normalized = normalizeUrl(input.url);
  const prior = db.prepare("SELECT * FROM source WHERE run_id=? AND normalized_url=?").get(runId, normalized) as SourceRecord | undefined;
  if (prior) return prior;
  const row: SourceRecord = { id: crypto.randomUUID(), run_id: runId, normalized_url: normalized, accessed_at: new Date().toISOString(), ...input };
  db.prepare(`INSERT INTO source VALUES(${Array(10).fill("?").join(",")})`).run(
    row.id,
    row.run_id,
    row.normalized_url,
    row.url,
    row.title,
    row.publisher,
    row.published_at,
    row.accessed_at,
    row.source_type,
    row.search_excerpt,
  );
  return row;
}
export function normalizeUrl(raw: string) {
  const u = new URL(raw);
  u.hash = "";
  ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach((k) => u.searchParams.delete(k));
  u.hostname = u.hostname.toLowerCase();
  return u.toString().replace(/\/$/, "");
}

export function getRunBundle(id: string) {
  const run = getRun(id);
  return run ? { run, artifacts: listArtifacts(id), sources: listSources(id), manifest: parseManifest(run.manifest_json, run) } : null;
}

export function saveInstanceGraph(runId: string, graph: unknown, note = "") {
  return createArtifact(runId, "instance_graph", {
    status: "approved",
    json_content: JSON.stringify(graph, null, 2),
    markdown_content: note,
    approved_at: new Date().toISOString(),
  });
}
