import "server-only";
import { getWorkbenchDb } from "./connection";
import { getRun } from "./runs";
import { listArtifacts, createArtifact, supersedeOtherArtifactAttempts } from "./artifacts";
import { listSources } from "./sources";
import { listMarketEvents, listEventImpacts } from "./market_events"; import { listWorkItems } from "./work_items";
import { supersedeWorkItemsForArtifact } from "./work_items";
import { parseManifest } from "../../engine/manifest";
import { extractGraph } from "../../engine/instance_graph";
import { validateRuntimeGraph } from "../../engine/graph_contract";
import { databaseSchemaVersion } from "../db_migrations";
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
  supersedeOtherArtifactAttempts(runId, "instance_graph", artifact.id);
  supersedeWorkItemsForArtifact(runId, "instance_graph", artifact.id, artifact.version, {
    includeApproved: true,
    excludeWorkItemId: options.preserveActionWorkItemId,
  });
  return artifact;
}
export function getDatabaseSchemaVersion() {
  return databaseSchemaVersion(getWorkbenchDb());
}

export function radarBundle() {
  const events = listMarketEvents();
  const impacts = listEventImpacts();
  const pendingWorkItems = listWorkItems(undefined, "pending");
  return {
    events,
    impacts,
    pending_work_items: pendingWorkItems,
    last_refreshed_at: getRadarLastRefreshedAt(),
  };
}

export function getRuntimeMeta(key: string): { key: string; value_json: string; updated_at: string } | undefined {
  return getWorkbenchDb().prepare("SELECT key, value_json, updated_at FROM runtime_meta WHERE key=?").get(key) as
    | { key: string; value_json: string; updated_at: string }
    | undefined;
}

export function setRuntimeMeta(key: string, value: Record<string, unknown>, updatedAt = new Date().toISOString()) {
  getWorkbenchDb().prepare(`
    INSERT INTO runtime_meta(key, value_json, updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at
  `).run(key, JSON.stringify(value), updatedAt);
  return getRuntimeMeta(key)!;
}

export function getRadarLastRefreshedAt(): string | null {
  const row = getRuntimeMeta("radar_last_refresh");
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value_json) as { last_refreshed_at?: string };
    return parsed.last_refreshed_at || row.updated_at || null;
  } catch {
    return row.updated_at || null;
  }
}

export function setRadarLastRefreshedAt(lastRefreshedAt = new Date().toISOString(), lookbackHours?: number) {
  setRuntimeMeta("radar_last_refresh", {
    last_refreshed_at: lastRefreshedAt,
    lookback_hours: lookbackHours ?? null,
  }, lastRefreshedAt);
  return lastRefreshedAt;
}
