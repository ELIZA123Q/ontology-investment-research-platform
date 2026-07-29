import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { LATEST_DATABASE_SCHEMA_VERSION, databaseSchemaVersion, recoverOrphanedRunningArtifacts, runDatabaseMigrations } from "@/adapters/db_migrations";

describe("database migrations", () => {
  it("initializes a clean database to the latest explicit schema and is idempotent", () => {
    const connection = new DatabaseSync(":memory:");
    runDatabaseMigrations(connection);
    runDatabaseMigrations(connection);
    expect(databaseSchemaVersion(connection)).toBe(LATEST_DATABASE_SCHEMA_VERSION);
    const workItemColumns = (connection.prepare("PRAGMA table_info(research_work_items)").all() as Array<{ name: string }>).map((row) => row.name);
    expect(workItemColumns).toEqual(expect.arrayContaining(["artifact_id", "attempt", "resolution", "superseded_at"]));
    const sourceColumns = (connection.prepare("PRAGMA table_info(source)").all() as Array<{ name: string }>).map((row) => row.name);
    expect(sourceColumns).toEqual(expect.arrayContaining([
      "source_tier", "source_group", "locator", "captured_at", "content_hash", "usability_status", "snapshot_text", "source_quote", "quote_verified", "retrieval_status",
    ]));
    expect(connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='action_proposals'").get()).toBeTruthy();
    const jobColumns = (connection.prepare("PRAGMA table_info(research_jobs)").all() as Array<{ name: string }>).map((row) => row.name);
    expect(jobColumns).toEqual(expect.arrayContaining([
      "status", "lease_token", "worker_id", "lease_expires_at", "heartbeat_at", "attempt", "max_attempts",
      "budget_json", "input_artifacts_json", "input_hash", "payload_json", "result_json",
    ]));
    expect(connection.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_research_jobs_active_dedupe'").get()).toBeTruthy();
    expect(connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ontology_candidate_reviews'").get()).toBeTruthy();
    expect(connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ontology_candidate_review_events'").get()).toBeTruthy();
    expect(connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='research_experience_events'").get()).toBeTruthy();
    expect(connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='runtime_meta'").get()).toBeTruthy();
    expect(connection.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_artifacts_one_running'").get()).toBeTruthy();
    const now = "2026-07-20T00:00:00Z";
    connection.prepare(
      "INSERT INTO research_runs(id,question,domain,current_stage,status,manifest_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
    ).run("run-lock", "lock", "semiconductor", 0, "draft", "{}", now, now);
    const insertRunning = connection.prepare(
      "INSERT INTO artifacts(id,run_id,kind,version,status,created_at) VALUES(?,?,?,?,?,?)",
    );
    insertRunning.run("artifact-1", "run-lock", "stage_03", 1, "running", now);
    expect(() => insertRunning.run("artifact-2", "run-lock", "stage_03", 2, "running", now)).toThrow();
    connection.close();
  });

  it("repairs legacy work-item artifact, attempt and payload field rotation", () => {
    const connection = new DatabaseSync(":memory:");
    runDatabaseMigrations(connection);
    const now = "2026-07-18T00:00:00Z";
    connection.prepare(`INSERT INTO research_runs(
      id,question,domain,current_stage,status,package_path,manifest_json,created_at,updated_at,parent_run_id,trigger_event_id,trigger_classification
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run("run-legacy", "legacy", "semiconductor", 0, "draft", null, "{}", now, now, null, null, null);
    connection.prepare(`INSERT INTO research_work_items(
      id,run_id,kind,stage,target_type,target_id,title,status,priority,reason,note,source_event_id,
      artifact_id,attempt,payload_json,resolution,created_at,updated_at,resolved_at,superseded_at
    ) VALUES(${Array(20).fill("?").join(",")})`).run(
      "wi-legacy", "run-legacy", "evidence_review", "stage_03", "EvidenceDraft", "EV-1", "legacy",
      "pending", "medium", "", "", null,
      "{\"legacy\":true}", "artifact-v3", "3", "", now, now, null, null,
    );
    connection.prepare("DELETE FROM schema_migrations WHERE version=6").run();
    runDatabaseMigrations(connection);
    const repaired = connection.prepare("SELECT artifact_id,attempt,payload_json FROM research_work_items WHERE id='wi-legacy'").get() as any;
    expect(repaired).toEqual({ artifact_id: "artifact-v3", attempt: 3, payload_json: "{\"legacy\":true}" });
    connection.close();
  });

  it("recovers only orphaned running artifacts and preserves a valid worker lease", () => {
    const connection = new DatabaseSync(":memory:");
    connection.exec("PRAGMA foreign_keys = ON");
    runDatabaseMigrations(connection);
    const now = "2026-07-22T00:00:00.000Z";
    connection.prepare(
      "INSERT INTO research_runs(id,question,domain,current_stage,status,manifest_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
    ).run("run-recovery", "recovery", "semiconductor", 0, "draft", "{}", now, now);
    const insertArtifact = connection.prepare(
      "INSERT INTO artifacts(id,run_id,kind,version,status,created_at) VALUES(?,?,?,?,?,?)",
    );
    insertArtifact.run("artifact-leased", "run-recovery", "stage_01", 1, "running", now);
    insertArtifact.run("artifact-orphan", "run-recovery", "stage_02", 1, "running", now);
    connection.prepare(`INSERT INTO research_jobs(
      id,run_id,job_type,stage,artifact_id,status,dedupe_key,lease_token,worker_id,lease_expires_at,heartbeat_at,
      attempt,max_attempts,available_at,input_hash,queued_at,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      "job-leased", "run-recovery", "generate_artifact", "stage_01", "artifact-leased", "running", "leased",
      "token", "worker-a", "2026-07-22T00:02:00.000Z", now, 1, 3, now, "sha256:test", now, now, now,
    );

    expect(recoverOrphanedRunningArtifacts(connection, "2026-07-22T00:01:00.000Z")).toBe(1);
    expect((connection.prepare("SELECT status FROM artifacts WHERE id='artifact-leased'").get() as any).status).toBe("running");
    expect((connection.prepare("SELECT status FROM artifacts WHERE id='artifact-orphan'").get() as any).status).toBe("failed");
    connection.close();
  });

  it("preserves an expired Stage03 artifact only when a retryable job has a batch checkpoint", () => {
    const connection = new DatabaseSync(":memory:");
    connection.exec("PRAGMA foreign_keys = ON");
    runDatabaseMigrations(connection);
    const now = "2026-07-28T00:00:00.000Z";
    for (const runId of ["run-checkpoint", "run-plain"]) {
      connection.prepare(
        "INSERT INTO research_runs(id,question,domain,current_stage,status,manifest_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
      ).run(runId, "recovery", "semiconductor", 2, "active", "{}", now, now);
    }
    const checkpointJson = JSON.stringify({
      stage03_batch_checkpoint: {
        version: 1,
        mode: "regenerate",
        status: "in_progress",
        planned_batch_ids: ["EB-01"],
        batches: [{ batch_id: "EB-01", target_unit_ids: ["JU-01"], status: "in_progress" }],
        updated_at: now,
      },
    });
    connection.prepare(
      "INSERT INTO artifacts(id,run_id,kind,version,status,json_content,created_at) VALUES(?,?,?,?,?,?,?)",
    ).run("artifact-checkpoint", "run-checkpoint", "stage_03", 1, "running", checkpointJson, now);
    connection.prepare(
      "INSERT INTO artifacts(id,run_id,kind,version,status,json_content,created_at) VALUES(?,?,?,?,?,?,?)",
    ).run("artifact-plain", "run-plain", "stage_03", 1, "running", "{}", now);
    const insertJob = connection.prepare(`INSERT INTO research_jobs(
      id,run_id,job_type,stage,artifact_id,status,dedupe_key,lease_token,worker_id,lease_expires_at,heartbeat_at,
      attempt,max_attempts,available_at,input_hash,queued_at,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    insertJob.run(
      "job-checkpoint", "run-checkpoint", "generate_artifact", "stage_03", "artifact-checkpoint", "running", "checkpoint",
      "old-token", "dead-worker", "2026-07-28T00:00:30.000Z", now, 1, 3, now, "sha256:test", now, now, now,
    );
    insertJob.run(
      "job-plain", "run-plain", "generate_artifact", "stage_03", "artifact-plain", "running", "plain",
      "old-token", "dead-worker", "2026-07-28T00:00:30.000Z", now, 1, 3, now, "sha256:test", now, now, now,
    );

    expect(recoverOrphanedRunningArtifacts(connection, "2026-07-28T00:01:00.000Z")).toBe(1);
    expect((connection.prepare("SELECT status FROM artifacts WHERE id='artifact-checkpoint'").get() as any).status).toBe("running");
    expect((connection.prepare("SELECT status FROM artifacts WHERE id='artifact-plain'").get() as any).status).toBe("failed");
    connection.close();
  });
});
