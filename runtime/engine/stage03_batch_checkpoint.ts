import type { Artifact } from "./types";

export type Stage03BatchTerminalStatus = "complete" | "failed" | "interrupted";
export type Stage03BatchStatus = "pending" | "in_progress" | Stage03BatchTerminalStatus;

export type Stage03BatchCheckpointEntry = {
  batch_id: string;
  target_unit_ids: string[];
  status: Stage03BatchStatus;
  started_at?: string;
  paid_model_started_at?: string;
  finished_at?: string;
  error?: string;
  tool_usage?: unknown;
  unchanged_evidence_ids?: string[];
};

export type Stage03BatchCheckpoint = {
  version: 1;
  mode: "regenerate" | "evidence_supplement";
  base_artifact_id?: string;
  status: "in_progress" | "complete";
  planned_batch_ids: string[];
  batches: Stage03BatchCheckpointEntry[];
  updated_at: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function readStage03BatchCheckpoint(data: unknown): Stage03BatchCheckpoint | undefined {
  if (!isRecord(data) || !isRecord(data.stage03_batch_checkpoint)) return undefined;
  const raw = data.stage03_batch_checkpoint;
  if (raw.version !== 1 || !["regenerate", "evidence_supplement"].includes(String(raw.mode))) return undefined;
  if (!Array.isArray(raw.planned_batch_ids) || !Array.isArray(raw.batches)) return undefined;
  const batches = raw.batches
    .filter(isRecord)
    .map((entry) => ({
      batch_id: String(entry.batch_id || ""),
      target_unit_ids: Array.isArray(entry.target_unit_ids) ? entry.target_unit_ids.map(String) : [],
      status: ["pending", "in_progress", "complete", "failed", "interrupted"].includes(String(entry.status))
        ? entry.status as Stage03BatchStatus
        : "pending",
      ...(entry.started_at ? { started_at: String(entry.started_at) } : {}),
      ...(entry.paid_model_started_at ? { paid_model_started_at: String(entry.paid_model_started_at) } : {}),
      ...(entry.finished_at ? { finished_at: String(entry.finished_at) } : {}),
      ...(entry.error ? { error: String(entry.error) } : {}),
      ...(entry.tool_usage !== undefined ? { tool_usage: entry.tool_usage } : {}),
      ...(Array.isArray(entry.unchanged_evidence_ids)
        ? { unchanged_evidence_ids: entry.unchanged_evidence_ids.map(String) }
        : {}),
    }))
    .filter((entry) => entry.batch_id);
  return {
    version: 1,
    mode: raw.mode as Stage03BatchCheckpoint["mode"],
    ...(raw.base_artifact_id ? { base_artifact_id: String(raw.base_artifact_id) } : {}),
    status: raw.status === "complete" ? "complete" : "in_progress",
    planned_batch_ids: raw.planned_batch_ids.map(String),
    batches,
    updated_at: String(raw.updated_at || ""),
  };
}

export function isResumableStage03Artifact(artifact: Artifact | undefined): boolean {
  if (!artifact || artifact.kind !== "stage_03" || artifact.status !== "running") return false;
  try {
    const checkpoint = readStage03BatchCheckpoint(JSON.parse(artifact.json_content || "{}"));
    return Boolean(checkpoint && checkpoint.status === "in_progress");
  } catch {
    return false;
  }
}

export function initializeStage03BatchCheckpoint(input: {
  mode: Stage03BatchCheckpoint["mode"];
  batches: Array<{ batch_id: string; unit_ids: string[] }>;
  baseArtifactId?: string;
  prior?: Stage03BatchCheckpoint;
  now?: string;
}): Stage03BatchCheckpoint {
  const now = input.now || new Date().toISOString();
  const plannedBatchIds = input.batches.map((batch) => batch.batch_id);
  const priorById = new Map((input.prior?.batches || []).map((entry) => [entry.batch_id, entry]));
  const samePlan = input.prior?.mode === input.mode
    && input.prior.planned_batch_ids.length === plannedBatchIds.length
    && input.prior.planned_batch_ids.every((id, index) => id === plannedBatchIds[index]);
  return {
    version: 1,
    mode: input.mode,
    ...(input.baseArtifactId ? { base_artifact_id: input.baseArtifactId } : {}),
    status: "in_progress",
    planned_batch_ids: plannedBatchIds,
    batches: input.batches.map((batch) => {
      const prior = samePlan ? priorById.get(batch.batch_id) : undefined;
      return prior
        ? { ...prior, target_unit_ids: [...batch.unit_ids] }
        : { batch_id: batch.batch_id, target_unit_ids: [...batch.unit_ids], status: "pending" };
    }),
    updated_at: now,
  };
}

export function updateStage03BatchCheckpoint(
  checkpoint: Stage03BatchCheckpoint,
  batchId: string,
  patch: Partial<Omit<Stage03BatchCheckpointEntry, "batch_id" | "target_unit_ids">>,
  now = new Date().toISOString(),
): Stage03BatchCheckpoint {
  const batches = checkpoint.batches.map((entry) => (
    entry.batch_id === batchId ? { ...entry, ...patch } : entry
  ));
  const complete = batches.every((entry) => ["complete", "failed", "interrupted"].includes(entry.status));
  return {
    ...checkpoint,
    status: complete ? "complete" : "in_progress",
    batches,
    updated_at: now,
  };
}

export function terminalStage03BatchIds(checkpoint: Stage03BatchCheckpoint): Set<string> {
  return new Set(
    checkpoint.batches
      .filter((entry) => ["complete", "failed", "interrupted"].includes(entry.status))
      .map((entry) => entry.batch_id),
  );
}
