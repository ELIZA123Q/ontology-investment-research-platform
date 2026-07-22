import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ResearchJob, ResearchJobStatus } from "../engine/types";
import { getWorkbenchDb } from "./db";

const CLAIMABLE_STATUSES = ["queued", "retrying"] as const;
const ACTIVE_DEDUPE_STATUSES = ["queued", "running", "waiting_for_input", "retrying"] as const;
const CANCELLABLE_STATUSES = ["queued", "running", "waiting_for_review", "waiting_for_input", "retrying", "blocked"] as const;

type EnqueueResearchJobInput = {
  runId: string;
  jobType: string;
  stage?: string;
  artifactId?: string | null;
  dedupeKey: string;
  maxAttempts?: number;
  availableAt?: string;
  budget?: Record<string, unknown>;
  inputArtifacts?: Array<{ artifact_id: string; artifact_hash: string; kind?: string }>;
  payload?: Record<string, unknown>;
  now?: string;
};

type ClaimOptions = {
  workerId: string;
  leaseMs: number;
  now?: string;
  jobTypes?: string[];
};

function placeholders(values: readonly unknown[]) {
  return values.map(() => "?").join(",");
}

function withImmediateTransaction<T>(connection: DatabaseSync, operation: () => T): T {
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

function row(connection: DatabaseSync, id: string): ResearchJob | undefined {
  return connection.prepare("SELECT * FROM research_jobs WHERE id=?").get(id) as ResearchJob | undefined;
}

function leaseExpiry(now: string, leaseMs: number) {
  if (!Number.isFinite(leaseMs) || leaseMs < 1_000) throw new Error("任务租约至少为 1 秒");
  return new Date(Date.parse(now) + leaseMs).toISOString();
}

function stableInputHash(inputArtifactsJson: string, payloadJson: string) {
  return `sha256:${createHash("sha256").update(`${inputArtifactsJson}\n${payloadJson}`).digest("hex")}`;
}

export class ResearchJobStore {
  constructor(private readonly connection: DatabaseSync) {}

  get(id: string) {
    return row(this.connection, id);
  }

  listForRun(runId: string): ResearchJob[] {
    return this.connection.prepare(
      "SELECT * FROM research_jobs WHERE run_id=? ORDER BY created_at DESC",
    ).all(runId) as ResearchJob[];
  }

  enqueue(input: EnqueueResearchJobInput): ResearchJob {
    const now = input.now || new Date().toISOString();
    const inputArtifactsJson = JSON.stringify(input.inputArtifacts || []);
    const payloadJson = JSON.stringify(input.payload || {});
    const maxAttempts = Math.max(1, Math.floor(input.maxAttempts || 3));

    return withImmediateTransaction(this.connection, () => {
      const existing = this.connection.prepare(
        `SELECT * FROM research_jobs WHERE dedupe_key=? AND status IN (${placeholders(ACTIVE_DEDUPE_STATUSES)}) ORDER BY created_at DESC LIMIT 1`,
      ).get(input.dedupeKey, ...ACTIVE_DEDUPE_STATUSES) as ResearchJob | undefined;
      if (existing) return existing;

      const job: ResearchJob = {
        id: randomUUID(),
        run_id: input.runId,
        job_type: input.jobType,
        stage: input.stage || "",
        artifact_id: input.artifactId || null,
        status: "queued",
        dedupe_key: input.dedupeKey,
        lease_token: null,
        worker_id: null,
        lease_expires_at: null,
        heartbeat_at: null,
        attempt: 0,
        max_attempts: maxAttempts,
        available_at: input.availableAt || now,
        budget_json: JSON.stringify(input.budget || {}),
        input_artifacts_json: inputArtifactsJson,
        input_hash: stableInputHash(inputArtifactsJson, payloadJson),
        payload_json: payloadJson,
        result_json: "{}",
        last_error: null,
        queued_at: now,
        started_at: null,
        finished_at: null,
        created_at: now,
        updated_at: now,
      };
      this.connection.prepare(`INSERT INTO research_jobs(
        id,run_id,job_type,stage,artifact_id,status,dedupe_key,lease_token,worker_id,lease_expires_at,heartbeat_at,
        attempt,max_attempts,available_at,budget_json,input_artifacts_json,input_hash,payload_json,result_json,last_error,
        queued_at,started_at,finished_at,created_at,updated_at
      ) VALUES(${Array(25).fill("?").join(",")})`).run(...Object.values(job));
      return job;
    });
  }

  recoverExpiredLeases(now = new Date().toISOString()): number {
    const result = this.connection.prepare(`UPDATE research_jobs SET
      status=CASE WHEN attempt >= max_attempts THEN 'blocked' ELSE 'retrying' END,
      available_at=?,
      lease_token=NULL,
      worker_id=NULL,
      lease_expires_at=NULL,
      heartbeat_at=NULL,
      last_error=COALESCE(last_error,'上一个 worker 心跳超时，任务已回收'),
      finished_at=CASE WHEN attempt >= max_attempts THEN ? ELSE NULL END,
      updated_at=?
      WHERE status='running' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?`).run(now, now, now, now);
    return Number(result.changes);
  }

  claimNext(options: ClaimOptions): ResearchJob | undefined {
    const now = options.now || new Date().toISOString();
    return withImmediateTransaction(this.connection, () => {
      this.recoverExpiredLeases(now);
      const typeClause = options.jobTypes?.length
        ? ` AND job_type IN (${placeholders(options.jobTypes)})`
        : "";
      const candidate = this.connection.prepare(`SELECT id FROM research_jobs
        WHERE status IN (${placeholders(CLAIMABLE_STATUSES)})
          AND available_at <= ? AND attempt < max_attempts${typeClause}
        ORDER BY available_at ASC, created_at ASC LIMIT 1`)
        .get(...CLAIMABLE_STATUSES, now, ...(options.jobTypes || [])) as { id: string } | undefined;
      if (!candidate) return undefined;

      const token = randomUUID();
      const expiresAt = leaseExpiry(now, options.leaseMs);
      const result = this.connection.prepare(`UPDATE research_jobs SET
        status='running', lease_token=?, worker_id=?, lease_expires_at=?, heartbeat_at=?,
        attempt=attempt+1, started_at=COALESCE(started_at,?), updated_at=?
        WHERE id=? AND status IN (${placeholders(CLAIMABLE_STATUSES)})`).run(
        token, options.workerId, expiresAt, now, now, now, candidate.id, ...CLAIMABLE_STATUSES,
      );
      return Number(result.changes) === 1 ? row(this.connection, candidate.id) : undefined;
    });
  }

  heartbeat(id: string, leaseToken: string, leaseMs: number, now = new Date().toISOString()): ResearchJob | undefined {
    const result = this.connection.prepare(`UPDATE research_jobs SET
      heartbeat_at=?, lease_expires_at=?, updated_at=?
      WHERE id=? AND status='running' AND lease_token=? AND lease_expires_at > ?`).run(
      now, leaseExpiry(now, leaseMs), now, id, leaseToken, now,
    );
    return Number(result.changes) === 1 ? row(this.connection, id) : undefined;
  }

  hasActiveLease(id: string, leaseToken: string, now = new Date().toISOString()): boolean {
    return Boolean(this.connection.prepare(`SELECT 1 FROM research_jobs
      WHERE id=? AND status='running' AND lease_token=? AND lease_expires_at > ?`).get(id, leaseToken, now));
  }

  bindArtifact(id: string, leaseToken: string, artifactId: string, now = new Date().toISOString()): ResearchJob | undefined {
    const result = this.connection.prepare(`UPDATE research_jobs SET artifact_id=?, updated_at=?
      WHERE id=? AND status='running' AND lease_token=? AND lease_expires_at > ?`).run(
      artifactId, now, id, leaseToken, now,
    );
    return Number(result.changes) === 1 ? row(this.connection, id) : undefined;
  }

  finish(
    id: string,
    leaseToken: string,
    resultPayload: Record<string, unknown>,
    status: Extract<ResearchJobStatus, "waiting_for_review" | "waiting_for_input" | "completed"> = "completed",
    now = new Date().toISOString(),
  ): ResearchJob | undefined {
    const finishedAt = status === "completed" ? now : null;
    const result = this.connection.prepare(`UPDATE research_jobs SET
      status=?, result_json=?, lease_token=NULL, worker_id=NULL, lease_expires_at=NULL,
      heartbeat_at=?, finished_at=?, updated_at=?
      WHERE id=? AND status='running' AND lease_token=? AND lease_expires_at > ?`).run(
      status, JSON.stringify(resultPayload), now, finishedAt, now, id, leaseToken, now,
    );
    return Number(result.changes) === 1 ? row(this.connection, id) : undefined;
  }

  fail(
    id: string,
    leaseToken: string,
    error: string,
    options: { retryable?: boolean; retryDelayMs?: number; now?: string } = {},
  ): ResearchJob | undefined {
    const now = options.now || new Date().toISOString();
    return withImmediateTransaction(this.connection, () => {
      const current = row(this.connection, id);
      if (!current || current.status !== "running" || current.lease_token !== leaseToken
        || !current.lease_expires_at || current.lease_expires_at <= now) return undefined;
      const retryable = options.retryable !== false && current.attempt < current.max_attempts;
      const status: ResearchJobStatus = retryable ? "retrying" : "blocked";
      const availableAt = retryable
        ? new Date(Date.parse(now) + Math.max(0, options.retryDelayMs || 0)).toISOString()
        : now;
      this.connection.prepare(`UPDATE research_jobs SET
        status=?, available_at=?, lease_token=NULL, worker_id=NULL, lease_expires_at=NULL,
        heartbeat_at=NULL, last_error=?, finished_at=?, updated_at=? WHERE id=?`).run(
        status, availableAt, error, retryable ? null : now, now, id,
      );
      return row(this.connection, id);
    });
  }

  cancel(id: string, reason: string, now = new Date().toISOString()): ResearchJob | undefined {
    const result = this.connection.prepare(`UPDATE research_jobs SET
      status='cancelled', lease_token=NULL, worker_id=NULL, lease_expires_at=NULL,
      heartbeat_at=NULL, last_error=?, finished_at=?, updated_at=?
      WHERE id=? AND status IN (${placeholders(CANCELLABLE_STATUSES)})`).run(
      reason, now, now, id, ...CANCELLABLE_STATUSES,
    );
    return Number(result.changes) === 1 ? row(this.connection, id) : undefined;
  }

  resolveReviewForArtifact(
    artifactId: string,
    accepted: boolean,
    now = new Date().toISOString(),
  ): ResearchJob | undefined {
    const status: ResearchJobStatus = accepted ? "completed" : "cancelled";
    const result = this.connection.prepare(`UPDATE research_jobs SET
      status=?, finished_at=?, updated_at=?, last_error=CASE WHEN ? THEN last_error ELSE '产物未获人工确认' END
      WHERE artifact_id=? AND status='waiting_for_review'`).run(status, now, now, accepted ? 1 : 0, artifactId);
    if (Number(result.changes) !== 1) return undefined;
    return this.connection.prepare("SELECT * FROM research_jobs WHERE artifact_id=? ORDER BY created_at DESC LIMIT 1")
      .get(artifactId) as ResearchJob | undefined;
  }
}

export function getResearchJobStore() {
  return new ResearchJobStore(getWorkbenchDb());
}

export function enqueueResearchJob(input: EnqueueResearchJobInput) {
  return getResearchJobStore().enqueue(input);
}

export function listResearchJobsForRun(runId: string) {
  return getResearchJobStore().listForRun(runId);
}

export function resolveResearchJobReview(artifactId: string, accepted: boolean) {
  return getResearchJobStore().resolveReviewForArtifact(artifactId, accepted);
}

export function cancelResearchJob(jobId: string, reason: string) {
  return getResearchJobStore().cancel(jobId, reason);
}
