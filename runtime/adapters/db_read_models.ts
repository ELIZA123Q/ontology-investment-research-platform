import "server-only";
import { cache } from "react";
import type {
  Artifact,
  ArtifactKind,
  ArtifactStatus,
  ResearchRun,
  ResearchWorkItem,
  SourceRecord,
  WorkItemStatus,
} from "../engine/types";
import { parseManifest } from "../engine/manifest";
import { getRun, getWorkbenchDb } from "./db";
import { listResearchJobsForRun } from "./research_jobs";

/**
 * Page-oriented read models: column-trimmed SELECTs for RSC routes.
 * Workflow / write paths keep using full-row helpers in db.ts.
 */

const ARTIFACT_PAYLOAD_COLUMNS = `
  id, run_id, kind, version, status, json_content, markdown_content,
  model_name, prompt_version, tool_usage, error_message, created_at, approved_at
`.replace(/\s+/g, " ").trim();

const ARTIFACT_META_COLUMNS = `
  id, run_id, kind, version, status, model_name, prompt_version,
  tool_usage, error_message, created_at, approved_at
`.replace(/\s+/g, " ").trim();

const ARTIFACT_LEDGER_COLUMNS = `
  id, kind, version, status, model_name, created_at, approved_at,
  CASE WHEN length(trim(COALESCE(markdown_content,''))) > 0 THEN 1 ELSE 0 END AS has_markdown
`.replace(/\s+/g, " ").trim();

const SOURCE_REVIEW_COLUMNS = `
  id, run_id, normalized_url, url, title, publisher, published_at, accessed_at, source_type,
  source_tier, authority_type, source_group, locator, captured_at, content_hash,
  usability_status, failure_category, failure_detail, final_url, content_mime, http_status,
  retrieval_status, source_quote, quote_verified
`.replace(/\s+/g, " ").trim();

const SOURCE_ATTRIBUTION_COLUMNS = `
  id, normalized_url, url, title, content_hash, usability_status, source_tier
`.replace(/\s+/g, " ").trim();

const WORK_ITEM_REVIEW_COLUMNS = `
  id, run_id, kind, stage, target_type, target_id, title, status, priority, reason, note,
  source_event_id, artifact_id, attempt, resolution, created_at, updated_at, resolved_at, superseded_at
`.replace(/\s+/g, " ").trim();

export type ArtifactPayload = Pick<
  Artifact,
  | "id"
  | "run_id"
  | "kind"
  | "version"
  | "status"
  | "json_content"
  | "markdown_content"
  | "model_name"
  | "prompt_version"
  | "tool_usage"
  | "error_message"
  | "created_at"
  | "approved_at"
>;

export type ArtifactMeta = Pick<
  Artifact,
  | "id"
  | "run_id"
  | "kind"
  | "version"
  | "status"
  | "model_name"
  | "prompt_version"
  | "tool_usage"
  | "error_message"
  | "created_at"
  | "approved_at"
>;

export type ArtifactLedgerRow = {
  id: string;
  kind: ArtifactKind;
  version: number;
  status: ArtifactStatus;
  model_name: string | null;
  created_at: string;
  approved_at: string | null;
  has_markdown: boolean;
};

export type SourceReviewRow = Omit<SourceRecord, "snapshot_text" | "search_excerpt">;

export type SourceAttributionRow = Pick<
  SourceRecord,
  "id" | "normalized_url" | "url" | "title" | "content_hash" | "usability_status" | "source_tier"
>;

export type WorkItemReviewRow = Omit<ResearchWorkItem, "payload_json">;

function mapWorkItemReview(row: any): WorkItemReviewRow {
  return {
    id: String(row.id),
    run_id: String(row.run_id),
    kind: row.kind,
    stage: String(row.stage),
    target_type: String(row.target_type),
    target_id: String(row.target_id),
    title: String(row.title),
    status: row.status,
    priority: row.priority,
    reason: String(row.reason || ""),
    note: String(row.note || ""),
    source_event_id: row.source_event_id ?? null,
    artifact_id: String(row.artifact_id || ""),
    attempt: Number(row.attempt || 0),
    resolution: String(row.resolution || ""),
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
    resolved_at: row.resolved_at ?? null,
    superseded_at: row.superseded_at ?? null,
  };
}

const latestArtifactPayloadCached = cache(function latestArtifactPayloadCached(
  runId: string,
  kind: ArtifactKind,
  statusKey: string,
): ArtifactPayload | undefined {
  const db = getWorkbenchDb();
  if (!statusKey) {
    return db.prepare(
      `SELECT ${ARTIFACT_PAYLOAD_COLUMNS} FROM artifacts WHERE run_id=? AND kind=? ORDER BY version DESC LIMIT 1`,
    ).get(runId, kind) as ArtifactPayload | undefined;
  }
  const statuses = statusKey.split(",") as ArtifactStatus[];
  const placeholders = statuses.map(() => "?").join(",");
  return db.prepare(
    `SELECT ${ARTIFACT_PAYLOAD_COLUMNS} FROM artifacts WHERE run_id=? AND kind=? AND status IN (${placeholders}) ORDER BY version DESC LIMIT 1`,
  ).get(runId, kind, ...statuses) as ArtifactPayload | undefined;
});

export function latestArtifactPayload(
  runId: string,
  kind: ArtifactKind,
  statuses?: ArtifactStatus[],
): ArtifactPayload | undefined {
  return latestArtifactPayloadCached(runId, kind, statuses?.length ? statuses.join(",") : "");
}

const previousArtifactPayloadCached = cache(function previousArtifactPayloadCached(
  runId: string,
  kind: ArtifactKind,
  beforeVersion: number,
): ArtifactPayload | undefined {
  if (!Number.isFinite(beforeVersion) || beforeVersion <= 1) return undefined;
  return getWorkbenchDb().prepare(
    `SELECT ${ARTIFACT_PAYLOAD_COLUMNS} FROM artifacts
     WHERE run_id=? AND kind=? AND version < ?
     ORDER BY version DESC LIMIT 1`,
  ).get(runId, kind, beforeVersion) as ArtifactPayload | undefined;
});

/** 同一 kind 在指定版本之前的最近一版（用于补证 diff）。 */
export function previousArtifactPayload(
  runId: string,
  kind: ArtifactKind,
  beforeVersion: number,
): ArtifactPayload | undefined {
  return previousArtifactPayloadCached(runId, kind, beforeVersion);
}

const latestArtifactMetaCached = cache(function latestArtifactMetaCached(
  runId: string,
  kind: ArtifactKind,
  statusKey: string,
): ArtifactMeta | undefined {
  const db = getWorkbenchDb();
  if (!statusKey) {
    return db.prepare(
      `SELECT ${ARTIFACT_META_COLUMNS} FROM artifacts WHERE run_id=? AND kind=? ORDER BY version DESC LIMIT 1`,
    ).get(runId, kind) as ArtifactMeta | undefined;
  }
  const statuses = statusKey.split(",") as ArtifactStatus[];
  const placeholders = statuses.map(() => "?").join(",");
  return db.prepare(
    `SELECT ${ARTIFACT_META_COLUMNS} FROM artifacts WHERE run_id=? AND kind=? AND status IN (${placeholders}) ORDER BY version DESC LIMIT 1`,
  ).get(runId, kind, ...statuses) as ArtifactMeta | undefined;
});

export function latestArtifactMeta(
  runId: string,
  kind: ArtifactKind,
  statuses?: ArtifactStatus[],
): ArtifactMeta | undefined {
  return latestArtifactMetaCached(runId, kind, statuses?.length ? statuses.join(",") : "");
}

export const listArtifactLedger = cache(function listArtifactLedger(runId: string): ArtifactLedgerRow[] {
  const rows = getWorkbenchDb().prepare(
    `SELECT ${ARTIFACT_LEDGER_COLUMNS} FROM artifacts WHERE run_id=? ORDER BY created_at DESC`,
  ).all(runId) as Array<Omit<ArtifactLedgerRow, "has_markdown"> & { has_markdown: number }>;
  return rows.map((row) => ({
    ...row,
    has_markdown: Boolean(row.has_markdown),
  }));
});

export const listSourcesForReview = cache(function listSourcesForReview(runId: string): SourceReviewRow[] {
  return getWorkbenchDb().prepare(
    `SELECT ${SOURCE_REVIEW_COLUMNS} FROM source WHERE run_id=? ORDER BY accessed_at DESC`,
  ).all(runId) as SourceReviewRow[];
});

export const listSourcesForAttribution = cache(function listSourcesForAttribution(runId: string): SourceAttributionRow[] {
  return getWorkbenchDb().prepare(
    `SELECT ${SOURCE_ATTRIBUTION_COLUMNS} FROM source WHERE run_id=? ORDER BY accessed_at DESC`,
  ).all(runId) as SourceAttributionRow[];
});

export const listWorkItemsForReview = cache(function listWorkItemsForReview(
  runId: string,
  status?: WorkItemStatus,
): WorkItemReviewRow[] {
  const db = getWorkbenchDb();
  const rows = status
    ? db.prepare(
      `SELECT ${WORK_ITEM_REVIEW_COLUMNS} FROM research_work_items WHERE run_id=? AND status=? ORDER BY created_at DESC`,
    ).all(runId, status)
    : db.prepare(
      `SELECT ${WORK_ITEM_REVIEW_COLUMNS} FROM research_work_items WHERE run_id=? ORDER BY created_at DESC`,
    ).all(runId);
  return (rows as any[]).map(mapWorkItemReview);
});

export const listChildRuns = cache(function listChildRuns(parentRunId: string): ResearchRun[] {
  return (getWorkbenchDb().prepare(
    "SELECT * FROM research_runs WHERE parent_run_id=? ORDER BY created_at DESC",
  ).all(parentRunId) as any[]).map((row) => ({
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
  }));
});

export type RunOverview = {
  run: ResearchRun;
  manifest: ReturnType<typeof parseManifest>;
  pendingWorkItems: WorkItemReviewRow[];
  stage03Json: string;
  stage04Json: string;
  report: ArtifactMeta | undefined;
  independentReview: ArtifactPayload | undefined;
  baseline: ArtifactMeta | undefined;
  evaluation: ArtifactMeta | undefined;
  jobs: ReturnType<typeof listResearchJobsForRun>;
};

/** Overview page loader — avoids getRunBundle's full artifacts + snapshot_text dump. */
export const getRunOverview = cache(function getRunOverview(id: string): RunOverview | null {
  const run = getRun(id);
  if (!run) return null;
  const workItems = listWorkItemsForReview(id);
  return {
    run,
    manifest: parseManifest(run.manifest_json, run),
    pendingWorkItems: workItems.filter((item) => item.status === "pending" || item.status === "rework"),
    stage03Json: latestArtifactPayload(id, "stage_03", ["approved", "needs_review"])?.json_content || "{}",
    stage04Json: latestArtifactPayload(id, "stage_04", ["approved", "needs_review"])?.json_content || "{}",
    report: latestArtifactMeta(id, "stage_05", ["approved"]),
    independentReview: latestArtifactPayload(id, "independent_review", ["approved"]),
    baseline: latestArtifactMeta(id, "baseline", ["approved"]),
    evaluation: latestArtifactMeta(id, "evaluation", ["approved"]),
    jobs: listResearchJobsForRun(id),
  };
});

/** Slim status payload for polling — no snapshot_text / raw model dumps. */
export const getRunStatusSnapshot = cache(function getRunStatusSnapshot(id: string) {
  const run = getRun(id);
  if (!run) return null;
  const workItems = listWorkItemsForReview(id);
  return {
    run,
    manifest: parseManifest(run.manifest_json, run),
    artifacts: listArtifactLedger(id),
    sources: listSourcesForAttribution(id),
    work_items: workItems,
    jobs: listResearchJobsForRun(id),
    pending_count: workItems.filter((item) => item.status === "pending" || item.status === "rework").length,
  };
});
