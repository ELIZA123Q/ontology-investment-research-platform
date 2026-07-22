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

  it("allows one worker to claim and extend a fenced lease", () => {
    const queued = store.enqueue({ runId: "run-1", jobType: "generate_artifact", dedupeKey: "claim-once", now: t0 });
    const claimed = store.claimNext({ workerId: "worker-a", leaseMs: 60_000, now: t0 });

    expect(claimed).toMatchObject({ id: queued.id, status: "running", worker_id: "worker-a", attempt: 1 });
    expect(store.claimNext({ workerId: "worker-b", leaseMs: 60_000, now: t0 })).toBeUndefined();
    const heartbeat = store.heartbeat(queued.id, claimed!.lease_token!, 60_000, "2026-07-22T00:00:30.000Z");
    expect(heartbeat?.lease_expires_at).toBe("2026-07-22T00:01:30.000Z");
    expect(store.heartbeat(queued.id, "wrong-token", 60_000, "2026-07-22T00:00:40.000Z")).toBeUndefined();
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
});
