import "server-only";
import { cache } from "react";
import type { Artifact, ArtifactKind, ArtifactStatus } from "../../schemas/types";
import { db } from "./connection";
import { recordResearchExperienceEvent, updateRun, getRun, recomputeRunProgress } from "./runs";
import { parseManifest, recordApprovedStage } from "../../export/manifest";
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
  recomputeRunProgress(runId);
}
export function supersedeOtherArtifactAttempts(runId: string, kind: ArtifactKind, keepId: string) {
  db.prepare("UPDATE artifacts SET status='superseded' WHERE run_id=? AND kind=? AND id<>? AND status IN ('approved','needs_review')")
    .run(runId, kind, keepId);
  recomputeRunProgress(runId);
}
export function approveArtifact(artifact: Artifact) {
  const stage = Number(artifact.kind.slice(-2));
  const approvedAt = new Date().toISOString();
  updateArtifact(artifact.id, { status: "approved", approved_at: approvedAt });
  if (stage) {
    recordResearchExperienceEvent({
      runId: artifact.run_id,
      eventType: "stage_approved",
      actorType: "human",
      stage: artifact.kind,
      targetType: "Artifact",
      targetId: artifact.id,
      outcome: "approved",
      payload: { version: artifact.version },
      dedupeKey: `stage_approved:${artifact.id}`,
      occurredAt: approvedAt,
    });
  }
  const run = getRun(artifact.run_id);
  if (run) {
    const approved = getArtifact(artifact.id)!;
    const manifest = recordApprovedStage(parseManifest(run.manifest_json, run), approved);
    updateRun(run.id, { manifest_json: JSON.stringify(manifest) });
    recomputeRunProgress(run.id);
  } else if (stage) {
    db.prepare("UPDATE research_runs SET current_stage=?, status=?, updated_at=? WHERE id=?").run(
      stage,
      stage === 5 ? "complete" : "in_progress",
      new Date().toISOString(),
      artifact.run_id,
    );
  }
}
