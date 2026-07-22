import "server-only";
import { cache } from "react";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type {
  ActionProposalStatus,
  Artifact,
  ArtifactKind,
  ArtifactStatus,
  EventImpact,
  ImpactClassification,
  MarketEvent,
  ResearchRun,
  ResearchWorkItem,
  SourceRecord,
  StoredActionExecution,
  StoredActionProposal,
  WorkItemStatus,
} from "../engine/types";
import { createChildManifest, createEmptyManifest, parseManifest, recordApprovedStage } from "../engine/manifest";
import { repositoryPath } from "./repo-paths";
import { databaseSchemaVersion, recoverOrphanedRunningArtifacts, runDatabaseMigrations } from "./db_migrations";
import { extractGraph } from "../engine/instance_graph";
import { validateRuntimeGraph } from "../engine/graph_contract";
import { evidenceBoundSourceIds } from "../engine/evidence_sources";

const dbPath = process.env.WORKBENCH_DB_PATH
  ? path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.WORKBENCH_DB_PATH)
  : repositoryPath("instances", "00_本机运行", "workbench.sqlite");
mkdirSync(path.dirname(dbPath), { recursive: true });

const globalDb = globalThis as unknown as { workbenchDb?: DatabaseSync };
function getDb() {
  if (globalDb.workbenchDb) return globalDb.workbenchDb;
  const connection = new DatabaseSync(dbPath);
  connection.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  runDatabaseMigrations(connection);
  // 多进程 worker 会各自打开 SQLite；新进程启动不能误杀其他 worker
  // 仍持有有效 job 租约的 running artifact。仅回收无任务或租约已失效的遗留产物。
  recoverOrphanedRunningArtifacts(connection);
  globalDb.workbenchDb = connection;
  return connection;
}

/** Shared SQLite connection for page-oriented read models. */
export function getWorkbenchDb(): DatabaseSync {
  return getDb();
}

const db = new Proxy({} as DatabaseSync, {
  get(_target, property) {
    const connection: any = getDb();
    const value = connection[property];
    return typeof value === "function" ? value.bind(connection) : value;
  },
});

export function withImmediateTransaction<T>(operation: () => T): T {
  const connection = getDb();
  connection.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    connection.exec("COMMIT");
    return result;
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
}

function mapRun(row: any): ResearchRun {
  return {
    id: row.id,
    question: row.question,
    domain: row.domain,
    current_stage: row.current_stage,
    status: row.status,
    package_path: row.package_path ?? null,
    parent_run_id: row.parent_run_id ?? null,
    trigger_event_id: row.trigger_event_id ?? null,
    trigger_classification: row.trigger_classification ?? null,
    manifest_json: row.manifest_json || "{}",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function listRuns(): ResearchRun[] {
  return (db.prepare("SELECT * FROM research_runs ORDER BY created_at DESC").all() as any[]).map(mapRun);
}
export const getRun = cache(function getRun(id: string): ResearchRun | undefined {
  const row = db.prepare("SELECT * FROM research_runs WHERE id=?").get(id) as any;
  return row ? mapRun(row) : undefined;
});
export function previousComparableRun(runId: string): ResearchRun | undefined {
  const current = getRun(runId);
  if (!current) return undefined;
  const row = db.prepare(
    `SELECT * FROM research_runs
     WHERE id != ? AND domain = ? AND trim(question) = ? AND created_at < ?
     ORDER BY created_at DESC LIMIT 1`,
  ).get(current.id, current.domain, current.question.trim(), current.created_at) as any;
  return row ? mapRun(row) : undefined;
}
export function createRun(
  question: string,
  domain: string,
  packagePath?: string | null,
  options: {
    parentRunId?: string | null;
    triggerEventId?: string | null;
    triggerClassification?: ImpactClassification | null;
  } = {},
): ResearchRun {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const draft = mapRun({
    id,
    question,
    domain,
    current_stage: 0,
    status: "draft",
    package_path: packagePath || null,
    parent_run_id: options.parentRunId || null,
    trigger_event_id: options.triggerEventId || null,
    trigger_classification: options.triggerClassification || null,
    manifest_json: "{}",
    created_at: now,
    updated_at: now,
  });
  const parent = options.parentRunId ? getRun(options.parentRunId) : undefined;
  const manifest = parent
    ? createChildManifest(draft, parent, `sha256:${createHash("sha256").update(parent.manifest_json).digest("hex")}`)
    : createEmptyManifest(draft);
  db.prepare(
    "INSERT INTO research_runs(id,question,domain,current_stage,status,package_path,manifest_json,created_at,updated_at,parent_run_id,trigger_event_id,trigger_classification) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    id,
    question,
    domain,
    0,
    "draft",
    packagePath || null,
    JSON.stringify(manifest),
    now,
    now,
    options.parentRunId || null,
    options.triggerEventId || null,
    options.triggerClassification || null,
  );
  return getRun(id)!;
}
export function updateRun(id: string, fields: Partial<Pick<ResearchRun, "package_path" | "manifest_json" | "status" | "current_stage" | "parent_run_id" | "trigger_event_id" | "trigger_classification">>): ResearchRun {
  const entries = Object.entries({ ...fields, updated_at: new Date().toISOString() }).filter(([, value]) => value !== undefined);
  if (entries.length) {
    db.prepare(`UPDATE research_runs SET ${entries.map(([key]) => `${key}=?`).join(",")} WHERE id=?`).run(
      ...entries.map(([, value]) => value as string | number | null),
      id,
    );
  }
  return getRun(id)!;
}

/** Collect run id and all descendant incremental runs (children first, root last). */
export function collectRunSubtreeIds(rootId: string): string[] {
  const childrenByParent = new Map<string, string[]>();
  for (const run of listRuns()) {
    if (!run.parent_run_id) continue;
    const siblings = childrenByParent.get(run.parent_run_id) || [];
    siblings.push(run.id);
    childrenByParent.set(run.parent_run_id, siblings);
  }
  const ordered: string[] = [];
  const visit = (id: string) => {
    for (const childId of childrenByParent.get(id) || []) visit(childId);
    ordered.push(id);
  };
  visit(rootId);
  return ordered;
}

function deleteRunRecords(runId: string): void {
  // action_executions.proposal_id and action_proposals.work_item_id use RESTRICT —
  // clear them before cascading work items / proposals / the run itself.
  db.prepare("DELETE FROM action_executions WHERE run_id=?").run(runId);
  db.prepare("DELETE FROM action_proposals WHERE run_id=?").run(runId);
  db.prepare("DELETE FROM research_work_items WHERE run_id=?").run(runId);
  db.prepare("DELETE FROM event_impacts WHERE run_id=?").run(runId);
  db.prepare("DELETE FROM artifacts WHERE run_id=?").run(runId);
  db.prepare("DELETE FROM source WHERE run_id=?").run(runId);
  db.prepare("DELETE FROM research_runs WHERE id=?").run(runId);
}

/** Hard-delete a research run and all of its incremental descendant runs. */
export function deleteRun(id: string): { deleted_ids: string[] } {
  const run = getRun(id);
  if (!run) throw new Error("任务不存在");
  const deletedIds = collectRunSubtreeIds(id);
  withImmediateTransaction(() => {
    for (const runId of deletedIds) deleteRunRecords(runId);
  });
  return { deleted_ids: deletedIds };
}

export function createChildRun(
  parentRunId: string,
  triggerEventId: string,
  classification: ImpactClassification = "evidence_update",
): ResearchRun {
  const parent = getRun(parentRunId);
  if (!parent) throw new Error("父运行不存在");
  const child = createRun(parent.question, parent.domain, parent.package_path, {
    parentRunId,
    triggerEventId,
    triggerClassification: classification,
  });
  let manifest = parseManifest(child.manifest_json, child);
  const inheritedStages = classification === "evidence_update"
    ? (["stage_01", "stage_02"] as const)
    : classification === "structure_revision"
      ? (["stage_01"] as const)
      : ([] as const);
  const inheritedSourceIdMap = new Map<string, string>();
  for (const kind of inheritedStages) {
    const inherited = latestArtifact(parent.id, kind, ["approved"]);
    if (!inherited) continue;
    const copy = createArtifact(child.id, kind, {
      status: "approved",
      json_content: inherited.json_content,
      markdown_content: inherited.markdown_content,
      model_name: inherited.model_name,
      prompt_version: inherited.prompt_version,
      knowledge_version: inherited.knowledge_version,
      input_context: inherited.input_context,
      raw_model_output: inherited.raw_model_output,
      response_id: inherited.response_id,
      token_usage: inherited.token_usage,
      tool_usage: inherited.tool_usage,
      approved_at: new Date().toISOString(),
    });
    manifest = recordApprovedStage(manifest, copy);
  }
  const parentGraph = classification === "evidence_update"
    ? latestArtifact(parent.id, "instance_graph", ["approved"])
    : undefined;
  if (classification === "evidence_update") {
    const parentEvidence = latestArtifact(parent.id, "stage_03", ["approved"]);
    const evidenceIds = evidenceBoundSourceIds(parentEvidence ? JSON.parse(parentEvidence.json_content) : {});
    const graphIds = new Set(
      (parentGraph ? extractGraph(JSON.parse(parentGraph.json_content))?.objects || [] : [])
        .filter((object) => object.type === "SourceDocument")
        .map((object) => object.id),
    );
    const inheritableIds = new Set([...evidenceIds, ...graphIds]);
    for (const source of listSources(parent.id).filter((item) => inheritableIds.has(item.id))) {
      const inheritedSource = upsertSource(child.id, {
        url: source.url,
        title: source.title,
        publisher: source.publisher,
        published_at: source.published_at,
        source_type: `inherited:${source.source_type}`,
        source_tier: source.source_tier,
        authority_type: source.authority_type || "unknown",
        source_group: source.source_group,
        search_excerpt: source.search_excerpt,
        locator: source.locator,
        captured_at: source.captured_at,
        content_hash: source.content_hash,
        usability_status: source.usability_status,
        failure_category: source.failure_category,
        failure_detail: source.failure_detail,
        final_url: source.final_url,
        content_mime: source.content_mime,
        http_status: source.http_status,
        retrieval_status: source.retrieval_status,
        snapshot_text: source.snapshot_text,
        source_quote: source.source_quote,
        quote_verified: source.quote_verified,
      });
      inheritedSourceIdMap.set(source.id, inheritedSource.id);
    }
  }
  if (parentGraph) {
    const inheritedPayload = remapStableReferences(JSON.parse(parentGraph.json_content), inheritedSourceIdMap);
    saveInstanceGraph(
      child.id,
      inheritedPayload,
      `inherited snapshot from ${parent.id}; source registry IDs remapped to this run; unaffected objects remain current until replaced by an approved ChangeSet`,
    );
  }
  updateRun(child.id, {
    current_stage: latestArtifact(child.id, "stage_02", ["approved"]) ? 2 : latestArtifact(child.id, "stage_01", ["approved"]) ? 1 : 0,
    status: "in_progress",
    manifest_json: JSON.stringify(manifest),
  });
  return getRun(child.id)!;
}

/**
 * Source rows are run-scoped, while graph references must point at rows in the
 * current run.  A child therefore cannot copy the parent's graph byte-for-byte.
 * Remap exact stable references everywhere in the payload so relation endpoints,
 * projections and any source_id/source_ids properties remain coherent.
 */
function remapStableReferences(value: unknown, idMap: Map<string, string>): unknown {
  if (!idMap.size) return value;
  if (typeof value === "string") return idMap.get(value) || value;
  if (Array.isArray(value)) return value.map((item) => remapStableReferences(item, idMap));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => [key, remapStableReferences(item, idMap)]),
    );
  }
  return value;
}
export function listArtifacts(runId: string): Artifact[] {
  return db.prepare("SELECT * FROM artifacts WHERE run_id=? ORDER BY created_at DESC").all(runId) as Artifact[];
}
export function getArtifact(id: string): Artifact | undefined {
  return db.prepare("SELECT * FROM artifacts WHERE id=?").get(id) as Artifact | undefined;
}
const latestArtifactCached = cache(function latestArtifactCached(
  runId: string,
  kind: ArtifactKind,
  statusKey: string,
): Artifact | undefined {
  if (!statusKey) {
    return db.prepare(
      "SELECT * FROM artifacts WHERE run_id=? AND kind=? ORDER BY version DESC LIMIT 1",
    ).get(runId, kind) as Artifact | undefined;
  }
  const statuses = statusKey.split(",") as ArtifactStatus[];
  const placeholders = statuses.map(() => "?").join(",");
  return db.prepare(
    `SELECT * FROM artifacts WHERE run_id=? AND kind=? AND status IN (${placeholders}) ORDER BY version DESC LIMIT 1`,
  ).get(runId, kind, ...statuses) as Artifact | undefined;
});
export function latestArtifact(runId: string, kind: ArtifactKind, statuses?: ArtifactStatus[]): Artifact | undefined {
  return latestArtifactCached(runId, kind, statuses?.length ? statuses.join(",") : "");
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
export function updateArtifactIfStatus(
  id: string,
  expectedStatus: ArtifactStatus,
  fields: Parameters<typeof updateArtifact>[1],
): Artifact | undefined {
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
  if (!entries.length) return getArtifact(id)?.status === expectedStatus ? getArtifact(id) : undefined;
  const result = db.prepare(
    `UPDATE artifacts SET ${entries.map(([key]) => `${key}=?`).join(",")} WHERE id=? AND status=?`,
  ).run(...entries.map(([, value]) => value as string | null), id, expectedStatus);
  return Number(result.changes) === 1 ? getArtifact(id) : undefined;
}
export function supersedeDownstream(runId: string, afterStage: number) {
  const kinds = ["stage_01", "stage_02", "stage_03", "stage_04", "stage_05"].slice(afterStage) as ArtifactKind[];
  if (afterStage <= 3) kinds.push("baseline");
  if (afterStage <= 4) kinds.push("independent_review");
  if (afterStage <= 5) kinds.push("evaluation");
  if (kinds.length) {
    db.prepare(
      `UPDATE artifacts SET status='superseded' WHERE run_id=? AND kind IN (${kinds.map(() => "?").join(",")}) AND status IN ('approved','needs_review')`,
    ).run(runId, ...kinds);
  }
}
export function supersedeOtherArtifactAttempts(runId: string, kind: ArtifactKind, keepId: string) {
  db.prepare("UPDATE artifacts SET status='superseded' WHERE run_id=? AND kind=? AND id<>? AND status IN ('approved','needs_review')")
    .run(runId, kind, keepId);
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
export function quarantineUnboundWebCitations(runId: string, boundSourceIds: Iterable<string>): number {
  const bound = [...new Set([...boundSourceIds].map(String).filter(Boolean))];
  const exclusion = bound.length ? ` AND id NOT IN (${bound.map(() => "?").join(",")})` : "";
  const result = db.prepare(`UPDATE source SET
    usability_status='rejected',
    failure_category='source_acquisition_failure',
    failure_detail='Web search candidate was not bound to any approved Stage03 evidence draft; retained for retrieval audit only'
    WHERE run_id=? AND source_type='web_citation'${exclusion}`).run(runId, ...bound);
  return Number(result.changes || 0);
}
export function upsertSource(runId: string, input: Omit<SourceRecord, "id" | "run_id" | "normalized_url" | "accessed_at">): SourceRecord {
  const normalized = normalizeUrl(input.url);
  const prior = db.prepare("SELECT * FROM source WHERE run_id=? AND normalized_url=?").get(runId, normalized) as SourceRecord | undefined;
  if (prior) {
    // Radar discoveries are hypotheses about relevance, not stronger source
    // registrations.  Keep the event in market_events, but never let its
    // candidate metadata downgrade an already captured and verified source.
    if (input.source_type === "market_event_candidate"
      && prior.usability_status === "usable"
      && prior.retrieval_status === "captured"
      && Boolean(prior.quote_verified)) {
      return prior;
    }
    db.prepare(`UPDATE source SET
      title=?,publisher=?,published_at=?,source_type=?,source_tier=?,authority_type=?,source_group=?,search_excerpt=?,locator=?,captured_at=?,content_hash=?,
      usability_status=?,failure_category=?,failure_detail=?,final_url=?,content_mime=?,http_status=?,retrieval_status=?,
      snapshot_text=?,source_quote=?,quote_verified=? WHERE id=?`).run(
      input.title, input.publisher, input.published_at, input.source_type,
      input.source_tier || prior.source_tier || "S8",
      input.authority_type || prior.authority_type || "unknown",
      input.source_group || prior.source_group || sourceGroupFromUrl(input.url, input.publisher), input.search_excerpt,
      input.locator ?? prior.locator ?? input.url,
      input.captured_at ?? prior.captured_at ?? new Date().toISOString(),
      input.content_hash ?? prior.content_hash ?? "",
      input.usability_status ?? prior.usability_status ?? "candidate",
      input.failure_category ?? prior.failure_category ?? "",
      input.failure_detail ?? prior.failure_detail ?? "",
      input.final_url ?? prior.final_url ?? input.url,
      input.content_mime ?? prior.content_mime ?? "",
      input.http_status ?? prior.http_status ?? null,
      input.retrieval_status ?? prior.retrieval_status ?? "not_attempted",
      input.snapshot_text ?? prior.snapshot_text ?? "",
      input.source_quote ?? prior.source_quote ?? "",
      input.quote_verified === undefined ? (prior.quote_verified ? 1 : 0) : (input.quote_verified ? 1 : 0), prior.id,
    );
    return db.prepare("SELECT * FROM source WHERE id=?").get(prior.id) as SourceRecord;
  }
  const accessedAt = new Date().toISOString();
  const row: SourceRecord = {
    id: crypto.randomUUID(),
    run_id: runId,
    normalized_url: normalized,
    accessed_at: accessedAt,
    ...input,
    locator: input.locator || input.url,
    captured_at: input.captured_at || accessedAt,
    content_hash: input.content_hash || "",
    usability_status: input.usability_status || "candidate",
    failure_category: input.failure_category || "",
    failure_detail: input.failure_detail || "",
    final_url: input.final_url || input.url,
    content_mime: input.content_mime || "",
    http_status: input.http_status ?? null,
    retrieval_status: input.retrieval_status || "not_attempted",
    source_tier: input.source_tier || "S8",
    authority_type: input.authority_type || "unknown",
    source_group: input.source_group || sourceGroupFromUrl(input.url, input.publisher),
    snapshot_text: input.snapshot_text || "",
    source_quote: input.source_quote || "",
    quote_verified: input.quote_verified ? 1 : 0,
  };
  db.prepare(`INSERT INTO source(
    id,run_id,normalized_url,url,title,publisher,published_at,accessed_at,source_type,search_excerpt,
    source_tier,authority_type,source_group,locator,captured_at,content_hash,usability_status,failure_category,failure_detail,
    final_url,content_mime,http_status,retrieval_status,snapshot_text,source_quote,quote_verified
  ) VALUES(${Array(26).fill("?").join(",")})`).run(
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
    row.source_tier || "S8",
    row.authority_type || "unknown",
    row.source_group || sourceGroupFromUrl(row.url, row.publisher),
    row.locator || row.url,
    row.captured_at || accessedAt,
    row.content_hash || "",
    row.usability_status || "candidate",
    row.failure_category || "",
    row.failure_detail || "",
    row.final_url || row.url,
    row.content_mime || "",
    row.http_status ?? null,
    row.retrieval_status || "not_attempted",
    row.snapshot_text || "",
    row.source_quote || "",
    row.quote_verified ? 1 : 0,
  );
  return row;
}
function sourceGroupFromUrl(rawUrl: string, publisher: string) {
  try {
    return new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return publisher.trim().toLowerCase();
  }
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

export function saveInstanceGraph(
  runId: string,
  graph: unknown,
  note = "",
  options: { preserveActionWorkItemId?: string } = {},
) {
  const extracted = extractGraph(graph);
  if (!extracted) throw new Error("无法从产物中解析 business_instance_graph");
  validateRuntimeGraph(extracted);
  const artifact = createArtifact(runId, "instance_graph", {
    status: "approved",
    json_content: JSON.stringify(graph, null, 2),
    markdown_content: note,
    approved_at: new Date().toISOString(),
  });
  supersedeWorkItemsForArtifact(runId, "instance_graph", artifact.id, artifact.version, {
    includeApproved: true,
    excludeWorkItemId: options.preserveActionWorkItemId,
  });
  return artifact;
}

function mapMarketEvent(row: any): MarketEvent {
  return {
    id: String(row.id),
    dedupe_key: String(row.dedupe_key),
    title: String(row.title),
    summary: String(row.summary),
    url: String(row.url),
    publisher: String(row.publisher || ""),
    occurred_at: row.occurred_at ?? null,
    published_at: row.published_at ?? null,
    event_type: String(row.event_type || "market_update"),
    candidate_labels: parseJsonArray(row.object_labels_json),
    confidence: row.confidence === "high" || row.confidence === "low" ? row.confidence : "medium",
    status: row.status,
    refresh_batch_id: String(row.refresh_batch_id),
    discovered_at: String(row.discovered_at),
  };
}

function parseJsonArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function upsertMarketEvent(input: Omit<MarketEvent, "id" | "status" | "discovered_at">): { event: MarketEvent; inserted: boolean } {
  const existing = db.prepare("SELECT * FROM market_events WHERE dedupe_key=?").get(input.dedupe_key) as any;
  if (existing) return { event: mapMarketEvent(existing), inserted: false };
  const id = crypto.randomUUID();
  const discoveredAt = new Date().toISOString();
  db.prepare("INSERT INTO market_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
    id,
    input.dedupe_key,
    input.title,
    input.summary,
    input.url,
    input.publisher,
    input.occurred_at,
    input.published_at,
    input.event_type,
    JSON.stringify(input.candidate_labels),
    input.confidence,
    "new",
    input.refresh_batch_id,
    discoveredAt,
  );
  return { event: mapMarketEvent(db.prepare("SELECT * FROM market_events WHERE id=?").get(id)), inserted: true };
}

export function listMarketEvents(limit = 60): MarketEvent[] {
  return (db.prepare("SELECT * FROM market_events ORDER BY COALESCE(published_at,occurred_at,discovered_at) DESC LIMIT ?").all(limit) as any[]).map(mapMarketEvent);
}

export function getMarketEvent(id: string): MarketEvent | undefined {
  const row = db.prepare("SELECT * FROM market_events WHERE id=?").get(id) as any;
  return row ? mapMarketEvent(row) : undefined;
}

export function updateMarketEventStatus(id: string, status: MarketEvent["status"]): MarketEvent {
  db.prepare("UPDATE market_events SET status=? WHERE id=?").run(status, id);
  const event = getMarketEvent(id);
  if (!event) throw new Error("市场事件不存在");
  return event;
}

export function upsertEventImpact(input: Omit<EventImpact, "id" | "created_at" | "status">): EventImpact {
  const existing = db.prepare("SELECT * FROM event_impacts WHERE event_id=? AND run_id=? AND judgment_unit_id IS ? AND judgment_id IS ?")
    .get(input.event_id, input.run_id, input.judgment_unit_id, input.judgment_id) as any;
  if (existing) return { ...existing } as EventImpact;
  const row: EventImpact = { ...input, id: crypto.randomUUID(), status: "suggested", created_at: new Date().toISOString() };
  db.prepare(`INSERT INTO event_impacts(
    id,event_id,run_id,judgment_unit_id,judgment_id,matched_condition,direction,relevance,
    rationale,status,created_at,impact_classification
  ) VALUES(${Array(12).fill("?").join(",")})`).run(
    row.id, row.event_id, row.run_id, row.judgment_unit_id, row.judgment_id, row.matched_condition,
    row.direction, row.relevance, row.rationale, row.status, row.created_at, row.impact_classification,
  );
  return row;
}

export function listEventImpacts(eventId?: string): EventImpact[] {
  const rows = eventId
    ? db.prepare("SELECT * FROM event_impacts WHERE event_id=? ORDER BY relevance DESC").all(eventId)
    : db.prepare("SELECT * FROM event_impacts ORDER BY created_at DESC,relevance DESC").all();
  return (rows as any[]).map((row) => ({
    ...row,
    relevance: Number(row.relevance),
    impact_classification: row.impact_classification || "evidence_update",
  })) as EventImpact[];
}

export function updateEventImpactStatus(id: string, status: EventImpact["status"]): EventImpact {
  db.prepare("UPDATE event_impacts SET status=? WHERE id=?").run(status, id);
  const row = db.prepare("SELECT * FROM event_impacts WHERE id=?").get(id) as any;
  if (!row) throw new Error("事件影响不存在");
  return {
    ...row,
    relevance: Number(row.relevance),
    impact_classification: row.impact_classification || "evidence_update",
  } as EventImpact;
}

type WorkItemInput = Omit<
  ResearchWorkItem,
  "id" | "status" | "note" | "artifact_id" | "attempt" | "resolution" | "created_at" | "updated_at" | "resolved_at" | "superseded_at"
> & {
  status?: WorkItemStatus;
  note?: string;
  artifact_id?: string;
  attempt?: number;
  resolution?: string;
};

function mapWorkItem(row: any): ResearchWorkItem {
  return {
    ...row,
    artifact_id: String(row.artifact_id || ""),
    attempt: Number(row.attempt || 0),
    resolution: String(row.resolution || ""),
    superseded_at: row.superseded_at ?? null,
  } as ResearchWorkItem;
}

export function upsertWorkItem(input: WorkItemInput): ResearchWorkItem {
  const artifactId = input.artifact_id || "";
  const attempt = Number(input.attempt || 0);
  if (!getRun(input.run_id)) throw new Error("工作项所属研究任务不存在");
  if (!Number.isInteger(attempt) || attempt < 0) throw new Error("工作项 attempt 必须为非负整数");
  if (artifactId) {
    const artifact = getArtifact(artifactId);
    if (!artifact || artifact.run_id !== input.run_id) throw new Error("工作项绑定的 artifact 不属于当前运行");
    if (artifact.version !== attempt) throw new Error("工作项 attempt 与 artifact 版本不一致");
    const stageMatches = artifact.kind === input.stage;
    const actionGraphBinding = input.kind === "action_review"
      && input.stage === "instance_graph"
      && artifact.kind === "instance_graph";
    const independentReviewBinding = input.kind === "publish_blocker"
      && artifact.kind === "independent_review"
      && ["stage_02", "stage_03", "stage_04"].includes(input.stage);
    if (!stageMatches && !actionGraphBinding && !independentReviewBinding) {
      throw new Error("工作项 stage 与 artifact 类型不一致");
    }
  } else if (input.kind !== "event_review" || !input.source_event_id || attempt !== 0) {
    throw new Error("除事件初筛外，工作项必须绑定具体 artifact 和 attempt");
  }
  const existing = db.prepare(`SELECT * FROM research_work_items
    WHERE run_id=? AND kind=? AND target_type=? AND target_id=? AND artifact_id=? AND attempt=?`)
    .get(input.run_id, input.kind, input.target_type, input.target_id, artifactId, attempt) as any;
  if (existing) return mapWorkItem(existing);
  const now = new Date().toISOString();
  const item: ResearchWorkItem = {
    ...input,
    id: crypto.randomUUID(),
    status: input.status || "pending",
    note: input.note || "",
    artifact_id: artifactId,
    attempt,
    resolution: input.resolution || "",
    created_at: now,
    updated_at: now,
    resolved_at: input.status && input.status !== "pending" ? now : null,
    superseded_at: input.status === "superseded" ? now : null,
  };
  db.prepare(`INSERT INTO research_work_items(
    id,run_id,kind,stage,target_type,target_id,title,status,priority,reason,note,source_event_id,
    artifact_id,attempt,payload_json,resolution,created_at,updated_at,resolved_at,superseded_at
  ) VALUES(${Array(20).fill("?").join(",")})`).run(
    item.id, item.run_id, item.kind, item.stage, item.target_type, item.target_id, item.title,
    item.status, item.priority, item.reason, item.note, item.source_event_id,
    item.artifact_id, item.attempt, item.payload_json, item.resolution,
    item.created_at, item.updated_at, item.resolved_at, item.superseded_at,
  );
  return item;
}

export function listWorkItems(runId?: string, status?: WorkItemStatus): ResearchWorkItem[] {
  let rows: any[];
  if (runId && status) rows = db.prepare("SELECT * FROM research_work_items WHERE run_id=? AND status=? ORDER BY created_at DESC").all(runId, status) as any[];
  else if (runId) rows = db.prepare("SELECT * FROM research_work_items WHERE run_id=? ORDER BY created_at DESC").all(runId) as any[];
  else if (status) rows = db.prepare("SELECT * FROM research_work_items WHERE status=? ORDER BY created_at DESC").all(status) as any[];
  else rows = db.prepare("SELECT * FROM research_work_items ORDER BY created_at DESC").all() as any[];
  return rows.map(mapWorkItem);
}

export function getWorkItem(id: string): ResearchWorkItem | undefined {
  const row = db.prepare("SELECT * FROM research_work_items WHERE id=?").get(id) as any;
  return row ? mapWorkItem(row) : undefined;
}

export function updateWorkItem(id: string, fields: { status?: WorkItemStatus; note?: string; reason?: string; resolution?: string }): ResearchWorkItem {
  const current = db.prepare("SELECT * FROM research_work_items WHERE id=?").get(id) as any;
  if (!current) throw new Error("工作项不存在");
  const status = fields.status || current.status;
  const allowedTransitions: Record<WorkItemStatus, Set<WorkItemStatus>> = {
    pending: new Set(["pending", "approved", "rework", "dismissed", "superseded"]),
    rework: new Set(["rework", "pending", "approved", "dismissed", "superseded"]),
    approved: new Set(["approved", "superseded"]),
    dismissed: new Set(["dismissed", "superseded"]),
    superseded: new Set(["superseded"]),
  };
  if (!allowedTransitions[current.status as WorkItemStatus]?.has(status)) {
    throw new Error(`工作项状态不允许从 ${current.status} 变更为 ${status}`);
  }
  const updatedAt = new Date().toISOString();
  const resolvedAt = status === "pending" || status === "rework" ? null : updatedAt;
  const supersededAt = status === "superseded" ? updatedAt : current.superseded_at;
  db.prepare("UPDATE research_work_items SET status=?,note=?,reason=?,resolution=?,updated_at=?,resolved_at=?,superseded_at=? WHERE id=?").run(
    status,
    fields.note ?? current.note,
    fields.reason ?? current.reason,
    fields.resolution ?? current.resolution ?? "",
    updatedAt,
    resolvedAt,
    supersededAt,
    id,
  );
  const updated = mapWorkItem(db.prepare("SELECT * FROM research_work_items WHERE id=?").get(id));
  syncActionProposalFromWorkItem(updated);
  return updated;
}

export function supersedeWorkItemsForArtifact(
  runId: string,
  stage: string,
  currentArtifactId: string,
  currentAttempt: number,
  options: { includeApproved?: boolean; excludeWorkItemId?: string } = {},
) {
  const now = new Date().toISOString();
  const statuses = options.includeApproved ? "'pending','rework','approved'" : "'pending','rework'";
  const excluded = options.excludeWorkItemId || "";
  const affectedIds = (db.prepare(`SELECT id FROM research_work_items
    WHERE run_id=? AND stage=? AND status IN (${statuses}) AND id<>?
      AND (artifact_id<>? OR attempt<>?)`).all(runId, stage, excluded, currentArtifactId, currentAttempt) as Array<{ id: string }>).map((row) => row.id);
  db.prepare(`UPDATE research_work_items
    SET status='superseded',superseded_at=?,resolved_at=?,updated_at=?,resolution='artifact_regenerated'
    WHERE run_id=? AND stage=? AND status IN (${statuses}) AND id<>?
      AND (artifact_id<>? OR attempt<>?)`).run(now, now, now, runId, stage, excluded, currentArtifactId, currentAttempt);
  for (const id of affectedIds) {
    const item = getWorkItem(id);
    if (item) syncActionProposalFromWorkItem(item);
  }
}

function syncActionProposalFromWorkItem(item: ResearchWorkItem) {
  if (item.kind !== "action_review") return;
  const proposal = db.prepare("SELECT * FROM action_proposals WHERE work_item_id=?").get(item.id) as any;
  if (!proposal || proposal.status === "executed") return;
  const now = new Date().toISOString();
  if (item.status === "approved") {
    db.prepare("UPDATE action_proposals SET status='approved',approved_at=? WHERE id=?").run(now, proposal.id);
  } else if (item.status === "dismissed") {
    db.prepare("UPDATE action_proposals SET status='rejected',approved_at=NULL WHERE id=?").run(proposal.id);
  } else if (item.status === "superseded") {
    db.prepare("UPDATE action_proposals SET status='superseded',approved_at=NULL WHERE id=?").run(proposal.id);
  } else {
    db.prepare("UPDATE action_proposals SET status='pending',approved_at=NULL WHERE id=?").run(proposal.id);
  }
}

function mapActionProposal(row: any): StoredActionProposal {
  return {
    ...row,
    expected_graph_version: Number(row.expected_graph_version),
  } as StoredActionProposal;
}

export function createActionProposalRecord(input: Omit<StoredActionProposal, "status" | "created_at" | "approved_at" | "executed_at" | "execution_id">): StoredActionProposal {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO action_proposals(
    id,run_id,action_id,parameters_json,expected_graph_version,proposal_json,status,work_item_id,
    created_at,approved_at,executed_at,execution_id
  ) VALUES(?,?,?,?,?,?,'pending',?,?,NULL,NULL,NULL)`).run(
    input.id,
    input.run_id,
    input.action_id,
    input.parameters_json,
    input.expected_graph_version,
    input.proposal_json,
    input.work_item_id,
    now,
  );
  return getActionProposal(input.id)!;
}

export function getActionProposal(id: string): StoredActionProposal | undefined {
  const row = db.prepare("SELECT * FROM action_proposals WHERE id=?").get(id) as any;
  return row ? mapActionProposal(row) : undefined;
}

export function listActionProposals(runId: string): StoredActionProposal[] {
  return (db.prepare("SELECT * FROM action_proposals WHERE run_id=? ORDER BY created_at DESC").all(runId) as any[]).map(mapActionProposal);
}

export function markActionProposalExecuted(proposalId: string, executionId: string) {
  const now = new Date().toISOString();
  db.prepare("UPDATE action_proposals SET status='executed',executed_at=?,execution_id=? WHERE id=?")
    .run(now, executionId, proposalId);
  return getActionProposal(proposalId)!;
}

export function getActionExecution(proposalId: string): StoredActionExecution | undefined {
  return db.prepare("SELECT * FROM action_executions WHERE proposal_id=?").get(proposalId) as StoredActionExecution | undefined;
}

export function createActionExecutionRecord(input: StoredActionExecution): StoredActionExecution {
  db.prepare(`INSERT INTO action_executions(
    execution_id,proposal_id,run_id,action_id,graph_version_before,graph_version_after,status,result_json,created_at
  ) VALUES(?,?,?,?,?,?,?,?,?)`).run(
    input.execution_id,
    input.proposal_id,
    input.run_id,
    input.action_id,
    input.graph_version_before,
    input.graph_version_after,
    input.status,
    input.result_json,
    input.created_at,
  );
  return getActionExecution(input.proposal_id)!;
}

export function getDatabaseSchemaVersion() {
  return databaseSchemaVersion(getDb());
}

export function radarBundle() {
  const events = listMarketEvents();
  const impacts = listEventImpacts();
  const pendingWorkItems = listWorkItems(undefined, "pending");
  return { events, impacts, pending_work_items: pendingWorkItems };
}
