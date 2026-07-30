import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runDatabaseMigrations } from "@/adapters/db_migrations";

vi.mock("server-only", () => ({}));

let connection: DatabaseSync;
let store: import("@/adapters/research_jobs").ResearchJobStore;

const t0 = "2026-07-22T00:00:00.000Z";

beforeEach(async () => {
  connection = new DatabaseSync(":memory:");
  connection.exec("PRAGMA foreign_keys = ON");
  runDatabaseMigrations(connection);
  connection.prepare(
    "INSERT INTO research_runs(id,question,domain,current_stage,status,manifest_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
  ).run("run-1", "job test", "semiconductor", 0, "draft", "{}", t0, t0);
  const { ResearchJobStore } = await import("@/adapters/research_jobs");
  store = new ResearchJobStore(connection);
});

describe("durable research job leases", () => {
  it("deduplicates active submissions and freezes the input hash", () => {
    const first = store.enqueue({
      runId: "run-1",
      jobType: "generate_artifact",
      stage: "stage_03",
      dedupeKey: "run-1:stage_03:input-v1",
      inputArtifacts: [{ artifact_id: "a-1", artifact_hash: "sha256:abc", kind: "stage_02" }],
      payload: { mode: "regenerate" },
      budget: { max_sources: 20, max_rounds: 3 },
      now: t0,
    });
    const duplicate = store.enqueue({
      runId: "run-1",
      jobType: "generate_artifact",
      stage: "stage_03",
      dedupeKey: "run-1:stage_03:input-v1",
      payload: { ignored: true },
      now: t0,
    });

    expect(duplicate.id).toBe(first.id);
    expect(first.input_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.parse(first.budget_json)).toEqual({ max_sources: 20, max_rounds: 3 });
    expect(store.listForRun("run-1")).toHaveLength(1);
  });

  it("lists active jobs across statuses for the global indicator", () => {
    store.enqueue({
      runId: "run-1",
      jobType: "generate_artifact",
      stage: "stage_03",
      dedupeKey: "run-1:stage_03:active",
      now: t0,
    });
    const active = store.listActive();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ run_id: "run-1", stage: "stage_03", status: "queued" });
  });

  it("does not revive an older blocked job after a newer stage job reaches review", () => {
    const blocked = store.enqueue({
      runId: "run-1",
      jobType: "generate_artifact",
      stage: "stage_03",
      dedupeKey: "run-1:stage_03:old",
      now: t0,
    });
    connection.prepare("UPDATE research_jobs SET status='blocked' WHERE id=?").run(blocked.id);
    const review = store.enqueue({
      runId: "run-1",
      jobType: "generate_artifact",
      stage: "stage_03",
      dedupeKey: "run-1:stage_03:new",
      now: "2026-07-22T01:00:00.000Z",
    });
    connection.prepare("UPDATE research_jobs SET status='waiting_for_review' WHERE id=?").run(review.id);

    expect(store.listActive()).toEqual([]);
  });

  it("allows one worker to claim and extend a fenced lease", () => {
    const queued = store.enqueue({ runId: "run-1", jobType: "generate_artifact", dedupeKey: "claim-once", now: t0 });
    const claimed = store.claimNext({ workerId: "worker-a", leaseMs: 60_000, now: t0 });

    expect(claimed).toMatchObject({ id: queued.id, status: "running", worker_id: "worker-a", attempt: 1 });
    expect(store.claimNext({ workerId: "worker-b", leaseMs: 60_000, now: t0 })).toBeUndefined();
    const heartbeat = store.heartbeat(queued.id, claimed!.lease_token!, 60_000, "2026-07-22T00:00:30.000Z");
    expect(heartbeat?.lease_expires_at).toBe("2026-07-22T00:01:30.000Z");
    expect(store.heartbeat(queued.id, "wrong-token", 60_000, "2026-07-22T00:00:40.000Z")).toBeUndefined();
  });

  it("claims only the explicitly authorized job in one-shot mode", () => {
    const older = store.enqueue({
      runId: "run-1", jobType: "generate_artifact", dedupeKey: "older-job", now: t0,
    });
    const authorized = store.enqueue({
      runId: "run-1", jobType: "generate_artifact", dedupeKey: "authorized-job",
      now: "2026-07-22T00:00:01.000Z",
    });
    const claimed = store.claimById(authorized.id, {
      workerId: "one-shot-worker",
      leaseMs: 60_000,
      now: "2026-07-22T00:00:01.000Z",
      jobTypes: ["generate_artifact"],
    });
    expect(claimed).toMatchObject({ id: authorized.id, status: "running", worker_id: "one-shot-worker" });
    expect(store.get(older.id)).toMatchObject({ status: "queued", attempt: 0 });
    expect(store.claimById(older.id, {
      workerId: "wrong-type",
      leaseMs: 60_000,
      now: "2026-07-22T00:00:01.000Z",
      jobTypes: ["not-generate"],
    })).toBeUndefined();
  });

  it("reclaims an expired lease and prevents the old worker from writing back", () => {
    const queued = store.enqueue({ runId: "run-1", jobType: "generate_artifact", dedupeKey: "fenced", now: t0 });
    const first = store.claimNext({ workerId: "worker-old", leaseMs: 60_000, now: t0 })!;
    const recoveryTime = "2026-07-22T00:01:01.000Z";

    expect(store.recoverExpiredLeases(recoveryTime)).toBe(1);
    const second = store.claimNext({ workerId: "worker-new", leaseMs: 60_000, now: recoveryTime })!;
    expect(second.id).toBe(queued.id);
    expect(second.attempt).toBe(2);
    expect(second.lease_token).not.toBe(first.lease_token);
    expect(store.finish(queued.id, first.lease_token!, { stale: true }, "completed", recoveryTime)).toBeUndefined();
    expect(store.finish(queued.id, second.lease_token!, { artifact_id: "artifact-new" }, "waiting_for_review", "2026-07-22T00:01:30.000Z"))
      .toMatchObject({ status: "waiting_for_review", worker_id: null });
    expect(JSON.parse(store.get(queued.id)!.result_json)).toEqual({ artifact_id: "artifact-new" });
  });

  it("retries transient failures up to the configured limit, then blocks", () => {
    const queued = store.enqueue({
      runId: "run-1", jobType: "generate_artifact", dedupeKey: "retry-limit", maxAttempts: 2, now: t0,
    });
    const first = store.claimNext({ workerId: "worker-a", leaseMs: 60_000, now: t0 })!;
    expect(store.fail(queued.id, first.lease_token!, "MODEL_TIMEOUT", {
      retryable: true, retryDelayMs: 10_000, now: "2026-07-22T00:00:10.000Z",
    })).toMatchObject({ status: "retrying", available_at: "2026-07-22T00:00:20.000Z" });
    expect(store.claimNext({ workerId: "worker-b", leaseMs: 60_000, now: "2026-07-22T00:00:19.000Z" })).toBeUndefined();
    const second = store.claimNext({ workerId: "worker-b", leaseMs: 60_000, now: "2026-07-22T00:00:20.000Z" })!;
    expect(second.attempt).toBe(2);
    expect(store.fail(queued.id, second.lease_token!, "MODEL_TIMEOUT_AGAIN", {
      retryable: true, now: "2026-07-22T00:00:30.000Z",
    })).toMatchObject({ status: "blocked", finished_at: "2026-07-22T00:00:30.000Z" });
  });

  it("lets the researcher expedite a scheduled retry without resetting attempt limits", () => {
    const queued = store.enqueue({
      runId: "run-1", jobType: "generate_artifact", dedupeKey: "retry-now", maxAttempts: 3, now: t0,
    });
    const first = store.claimNext({ workerId: "worker-a", leaseMs: 60_000, now: t0 })!;
    store.fail(queued.id, first.lease_token!, "MODEL_TIMEOUT", {
      retryable: true,
      retryDelayMs: 60_000,
      now: "2026-07-22T00:00:10.000Z",
    });

    expect(store.retryNow(queued.id, "2026-07-22T00:00:11.000Z")).toMatchObject({
      status: "retrying",
      attempt: 1,
      max_attempts: 3,
      available_at: "2026-07-22T00:00:11.000Z",
    });
    expect(store.retryNow(queued.id, "2026-07-22T00:00:12.000Z")).toMatchObject({
      status: "retrying",
      attempt: 1,
    });
  });

  it("cancels a running job and invalidates its worker token", () => {
    const queued = store.enqueue({ runId: "run-1", jobType: "generate_artifact", dedupeKey: "cancel", now: t0 });
    const claimed = store.claimNext({ workerId: "worker-a", leaseMs: 60_000, now: t0 })!;
    expect(store.cancel(queued.id, "研究员取消", "2026-07-22T00:00:20.000Z"))
      .toMatchObject({ status: "cancelled", last_error: "研究员取消" });
    expect(store.finish(queued.id, claimed.lease_token!, { stale: true }, "completed", "2026-07-22T00:00:30.000Z"))
      .toBeUndefined();
  });

  it("allows a new version after the prior job reaches human review", () => {
    const first = store.enqueue({ runId: "run-1", jobType: "generate_artifact", dedupeKey: "review-version", now: t0 });
    const claimed = store.claimNext({ workerId: "worker-a", leaseMs: 60_000, now: t0 })!;
    expect(store.finish(first.id, claimed.lease_token!, { artifact_id: "a-1" }, "waiting_for_review", "2026-07-22T00:00:20.000Z"))
      .toMatchObject({ status: "waiting_for_review" });
    const second = store.enqueue({
      runId: "run-1", jobType: "generate_artifact", dedupeKey: "review-version", now: "2026-07-22T00:00:21.000Z",
    });
    expect(second.id).not.toBe(first.id);
    expect(store.listForRun("run-1")).toHaveLength(2);
  });

  it("recovers an already-paid budget result only after its artifact is reviewable", () => {
    const queued = store.enqueue({
      runId: "run-1",
      jobType: "generate_artifact",
      stage: "stage_02",
      dedupeKey: "budget-recovery",
      now: t0,
    });
    const createdAt = "2026-07-22T00:00:10.000Z";
    connection.prepare(`INSERT INTO artifacts(
      id,run_id,kind,version,status,json_content,markdown_content,model_name,prompt_version,knowledge_version,
      input_context,raw_model_output,response_id,token_usage,tool_usage,error_message,created_at,approved_at
    ) VALUES(${Array(18).fill("?").join(",")})`).run(
      "artifact-budget", "run-1", "stage_02", 1, "needs_review", "{\"quality_status\":\"high_quality_pass\"}",
      "# logic", "mock", "", "", "", "", null, "{}", "{\"budget_warning\":\"over\"}", null, createdAt, null,
    );
    connection.prepare(`UPDATE research_jobs SET
      status='waiting_for_input', artifact_id=?, result_json=?
      WHERE id=?`).run(
      "artifact-budget",
      JSON.stringify({
        failure_category: "budget_exceeded",
        artifact_id: "artifact-budget",
        budget_warning: "over",
      }),
      queued.id,
    );

    expect(store.reopenCompletedBudgetResultForReview(queued.id, "wrong-artifact")).toBeUndefined();
    expect(store.reopenCompletedBudgetResultForReview(
      queued.id,
      "artifact-budget",
      "2026-07-22T00:00:30.000Z",
    )).toMatchObject({
      status: "waiting_for_review",
      artifact_id: "artifact-budget",
    });
  });
});
