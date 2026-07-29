import { describe, expect, it, vi } from "vitest";
import type { Artifact, ResearchJob } from "@/engine/types";
import {
  initializeStage03BatchCheckpoint,
  isResumableStage03Artifact,
  readStage03BatchCheckpoint,
  terminalStage03BatchIds,
  updateStage03BatchCheckpoint,
} from "@/engine/stage03_batch_checkpoint";
import { resolveStage03ResumeArtifactId } from "@/engine/research_job_runner";

vi.mock("server-only", () => ({}));

function runningArtifact(json: unknown): Artifact {
  return {
    id: "stage03-running",
    run_id: "run-checkpoint",
    kind: "stage_03",
    version: 2,
    status: "running",
    json_content: JSON.stringify(json),
    markdown_content: "",
    model_name: "mock",
    prompt_version: "",
    knowledge_version: "",
    input_context: "",
    raw_model_output: "",
    response_id: null,
    token_usage: "{}",
    tool_usage: "{}",
    error_message: null,
    created_at: "2026-07-28T00:00:00.000Z",
    approved_at: null,
  };
}

describe("Stage03 paid-batch checkpoints", () => {
  it("persists terminal batches and keeps only unfinished work resumable", () => {
    let checkpoint = initializeStage03BatchCheckpoint({
      mode: "evidence_supplement",
      baseArtifactId: "stage03-base",
      batches: [
        { batch_id: "EB-01", unit_ids: ["JU-01", "JU-02"] },
        { batch_id: "EB-02", unit_ids: ["JU-03"] },
      ],
      now: "2026-07-28T00:00:00.000Z",
    });
    checkpoint = updateStage03BatchCheckpoint(checkpoint, "EB-01", {
      status: "complete",
      finished_at: "2026-07-28T00:01:00.000Z",
      tool_usage: { search_public_web: 1 },
    });
    checkpoint = updateStage03BatchCheckpoint(checkpoint, "EB-02", {
      status: "in_progress",
      started_at: "2026-07-28T00:02:00.000Z",
    });

    const artifact = runningArtifact({ evidence_drafts: [], stage03_batch_checkpoint: checkpoint });
    expect(isResumableStage03Artifact(artifact)).toBe(true);
    expect(terminalStage03BatchIds(checkpoint)).toEqual(new Set(["EB-01"]));
    expect(readStage03BatchCheckpoint(JSON.parse(artifact.json_content))?.batches).toMatchObject([
      { batch_id: "EB-01", status: "complete" },
      { batch_id: "EB-02", status: "in_progress" },
    ]);
  });

  it("reuses a checkpointed Stage03 artifact but never a plain running artifact", () => {
    const checkpoint = initializeStage03BatchCheckpoint({
      mode: "regenerate",
      batches: [{ batch_id: "EB-01", unit_ids: ["JU-01"] }],
    });
    const resumable = runningArtifact({ stage03_batch_checkpoint: checkpoint });
    const plain = runningArtifact({});
    const job = { artifact_id: resumable.id } as ResearchJob;

    expect(resolveStage03ResumeArtifactId(job, "stage_03", () => resumable)).toBe(resumable.id);
    expect(resolveStage03ResumeArtifactId(job, "stage_03", () => plain)).toBeUndefined();
    expect(resolveStage03ResumeArtifactId(job, "stage_02", () => resumable)).toBeUndefined();
    expect(isResumableStage03Artifact({ ...resumable, status: "failed" })).toBe(false);
  });

  it("marks an interrupted in-flight batch terminal instead of making it replayable", () => {
    let checkpoint = initializeStage03BatchCheckpoint({
      mode: "regenerate",
      batches: [{ batch_id: "EB-01", unit_ids: ["JU-01"] }],
    });
    checkpoint = updateStage03BatchCheckpoint(checkpoint, "EB-01", { status: "in_progress" });
    checkpoint = updateStage03BatchCheckpoint(checkpoint, "EB-01", {
      status: "interrupted",
      error: "跳过以避免重复付费",
    });

    expect(checkpoint.status).toBe("complete");
    expect(terminalStage03BatchIds(checkpoint)).toEqual(new Set(["EB-01"]));
  });
});
