import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runDatabaseMigrations } from "@/adapters/db_migrations";
import type { Artifact, ResearchJob } from "@/engine/types";

vi.mock("server-only", () => ({}));

let connection: DatabaseSync;
let store: import("@/adapters/research_jobs").ResearchJobStore;

function insertRun() {
  const now = new Date().toISOString();
  connection.prepare(
    "INSERT INTO research_runs(id,question,domain,current_stage,status,manifest_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
  ).run("run-worker", "worker test", "semiconductor", 0, "draft", "{}", now, now);
}

function insertArtifact(id: string): Artifact {
  const now = new Date().toISOString();
  connection.prepare(`INSERT INTO artifacts(
    id,run_id,kind,version,status,json_content,markdown_content,model_name,prompt_version,knowledge_version,
    input_context,raw_model_output,response_id,token_usage,tool_usage,error_message,created_at,approved_at
  ) VALUES(${Array(18).fill("?").join(",")})`).run(
    id, "run-worker", "stage_01", 1, "needs_review", "{}", "", "mock", "", "", "", "", null, "{}", "{}", null, now, null,
  );
  return connection.prepare("SELECT * FROM artifacts WHERE id=?").get(id) as Artifact;
}

beforeEach(async () => {
  connection = new DatabaseSync(":memory:");
  connection.exec("PRAGMA foreign_keys = ON");
  runDatabaseMigrations(connection);
  insertRun();
  const { ResearchJobStore } = await import("@/adapters/research_jobs");
  store = new ResearchJobStore(connection);
});

describe("replayable research job runner", () => {
  it("binds the generated artifact and stops at human review", async () => {
    const now = new Date().toISOString();
    const queued = store.enqueue({
      runId: "run-worker",
      jobType: "generate_artifact",
      stage: "stage_01",
      dedupeKey: "runner-success",
      payload: { run_id: "run-worker", kind: "stage_01", mode: "regenerate", max_auto_rounds: null },
      now,
    });
    const claimed = store.claimNext({ workerId: "worker-test", leaseMs: 3_600_000, now })!;
    const artifact = insertArtifact("artifact-worker");
    const { executeClaimedGenerationJob } = await import("@/engine/research_job_runner");

    const completed = await executeClaimedGenerationJob(claimed, store, async (_runId, _kind, options) => {
      options?.executionLease?.assertActive();
      options?.executionLease?.onArtifactCreated?.(artifact.id);
      return artifact;
    });

    expect(completed).toMatchObject({ id: queued.id, status: "waiting_for_review", artifact_id: artifact.id });
    expect(JSON.parse(completed!.result_json)).toMatchObject({
      artifact_id: artifact.id,
      artifact_version: 1,
      new_source_count: 0,
      total_source_count: 0,
    });
  });

  it("detects missing or changed frozen inputs before replay", async () => {
    const { verifyFrozenJobInputs } = await import("@/engine/research_job_runner");
    const artifact = { id: "a-1", kind: "stage_02", version: 2, json_content: "{\"changed\":true}" } as Artifact;
    const inputArtifactsJson = JSON.stringify([{ artifact_id: "a-1", artifact_hash: "sha256:stale" }]);
    const payloadJson = "{}";
    const { createHash } = await import("node:crypto");
    const job = {
      input_artifacts_json: inputArtifactsJson,
      payload_json: payloadJson,
      input_hash: `sha256:${createHash("sha256").update(`${inputArtifactsJson}\n${payloadJson}`).digest("hex")}`,
    } as ResearchJob;

    expect(verifyFrozenJobInputs(job, (id) => id === artifact.id ? artifact : undefined)).toEqual({
      ok: false,
      reason: "冻结输入已变化：stage_02 v2",
    });
    expect(verifyFrozenJobInputs(job, () => undefined)).toEqual({ ok: false, reason: "冻结输入不存在：a-1" });
    expect(verifyFrozenJobInputs({ ...job, input_hash: "sha256:tampered" }, () => artifact)).toEqual({
      ok: false,
      reason: "任务输入 hash 不匹配，拒绝执行可能被修改的 payload",
    });
  });

  it("keeps an already-paid over-budget artifact reviewable with a budget warning", async () => {
    const now = new Date().toISOString();
    const queued = store.enqueue({
      runId: "run-worker",
      jobType: "generate_artifact",
      stage: "stage_01",
      dedupeKey: "runner-budget",
      budget: { max_tokens: 100, hard_timeout_ms: 10_000 },
      payload: { run_id: "run-worker", kind: "stage_01", mode: "regenerate", max_auto_rounds: null, initial_source_ids: [] },
      now,
    });
    const claimed = store.claimNext({ workerId: "worker-budget", leaseMs: 60_000, now })!;
    const artifact = insertArtifact("artifact-over-budget");
    const { executeClaimedGenerationJob } = await import("@/engine/research_job_runner");
    const result = await executeClaimedGenerationJob(claimed, store, async (_runId, _kind, options) => {
      expect(options?.maxSourceCount).toBeUndefined();
      options?.executionLease?.onArtifactCreated?.(artifact.id);
      return { ...artifact, token_usage: JSON.stringify({ total_tokens: 101 }) };
    });

    expect(result).toMatchObject({ id: queued.id, status: "waiting_for_review" });
    expect(JSON.parse(result!.result_json)).toMatchObject({
      failure_category: "budget_exceeded",
      artifact_id: artifact.id,
    });
    expect(JSON.parse(result!.result_json).budget_warning).toContain("JOB_BUDGET_EXCEEDED");
  });

  it("fences a hung execution when the job hard timeout is reached", async () => {
    const now = new Date().toISOString();
    const queued = store.enqueue({
      runId: "run-worker",
      jobType: "generate_artifact",
      stage: "stage_01",
      dedupeKey: "runner-timeout",
      budget: { hard_timeout_ms: 20 },
      payload: { run_id: "run-worker", kind: "stage_01", mode: "regenerate", max_auto_rounds: null, initial_source_ids: [] },
      now,
    });
    const claimed = store.claimNext({ workerId: "worker-timeout", leaseMs: 60_000, now })!;
    const { executeClaimedGenerationJob } = await import("@/engine/research_job_runner");
    const result = await executeClaimedGenerationJob(claimed, store, async () => new Promise<Artifact>(() => undefined));

    expect(result).toMatchObject({ id: queued.id, status: "waiting_for_input" });
    expect(JSON.parse(result!.result_json).reason).toContain("JOB_HARD_TIMEOUT");
  });
});
