import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { LATEST_DATABASE_SCHEMA_VERSION, databaseSchemaVersion, runDatabaseMigrations } from "@/adapters/db_migrations";

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
});
