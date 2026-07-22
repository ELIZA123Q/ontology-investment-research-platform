import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runDatabaseMigrations } from "@/adapters/db_migrations";

vi.mock("server-only", () => ({}));

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = resolve(runtimeRoot, "tests/fixtures/research-worker-process.ts");
const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length) rmSync(tempRoots.pop()!, { recursive: true, force: true });
});

function launchWorker(dbPath: string, mode: "hang" | "complete", workerId: string) {
  return spawn(process.execPath, ["--conditions=react-server", "--import", "tsx", fixturePath], {
    cwd: runtimeRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      WORKBENCH_DB_PATH: dbPath,
      RESEARCH_JOB_LEASE_MS: "1000",
      RESEARCH_WORKER_FIXTURE_MODE: mode,
      RESEARCH_WORKER_ID: workerId,
    },
    stdio: "pipe",
  });
}

function waitForMarker(child: ChildProcessWithoutNullStreams, marker: string, timeoutMs = 8_000) {
  return new Promise<string>((resolveOutput, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`worker marker timeout: ${marker}\n${output}`)), timeoutMs);
    const collect = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes(marker)) {
        clearTimeout(timer);
        resolveOutput(output);
      }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("exit", (code, signal) => {
      if (!output.includes(marker)) {
        clearTimeout(timer);
        reject(new Error(`worker exited before marker code=${code} signal=${signal}\n${output}`));
      }
    });
  });
}

async function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs = 8_000) {
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  const timeout = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
  const [code, signal] = await once(child, "exit") as [number | null, NodeJS.Signals | null];
  clearTimeout(timeout);
  return { code, signal, output };
}

describe("real worker process recovery", () => {
  it("recovers a killed worker, fences its token and exposes the new review state", async () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "ontology-worker-recovery-"));
    tempRoots.push(tempRoot);
    const dbPath = resolve(tempRoot, "workbench.sqlite");
    process.env.WORKBENCH_DB_PATH = dbPath;

    const setup = new DatabaseSync(dbPath);
    setup.exec("PRAGMA foreign_keys = ON");
    runDatabaseMigrations(setup);
    const now = new Date().toISOString();
    setup.prepare(
      "INSERT INTO research_runs(id,question,domain,current_stage,status,manifest_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
    ).run("run-process-recovery", "真实 worker 故障恢复", "semiconductor", 0, "draft", "{}", now, now);
    const { ResearchJobStore } = await import("@/adapters/research_jobs");
    const setupStore = new ResearchJobStore(setup);
    const queued = setupStore.enqueue({
      runId: "run-process-recovery",
      jobType: "generate_artifact",
      stage: "stage_01",
      dedupeKey: "process-recovery-stage-01",
      maxAttempts: 3,
      budget: { hard_timeout_ms: 600_000 },
      payload: {
        run_id: "run-process-recovery",
        kind: "stage_01",
        mode: "regenerate",
        max_auto_rounds: 1,
        initial_source_ids: [],
      },
      now,
    });
    setup.close();

    const first = launchWorker(dbPath, "hang", "worker-before-crash");
    await waitForMarker(first, "artifact_bound");
    const duringCrash = new DatabaseSync(dbPath);
    const runningJob = duringCrash.prepare("SELECT * FROM research_jobs WHERE id=?").get(queued.id) as any;
    const abandonedArtifact = duringCrash.prepare("SELECT * FROM artifacts WHERE id=?").get(runningJob.artifact_id) as any;
    expect(runningJob).toMatchObject({ status: "running", worker_id: "worker-before-crash", attempt: 1 });
    expect(abandonedArtifact.status).toBe("running");
    const oldLeaseToken = String(runningJob.lease_token);
    const leaseExpiresAt = Date.parse(String(runningJob.lease_expires_at));
    duringCrash.close();

    expect(first.kill("SIGKILL")).toBe(true);
    await once(first, "exit");
    await new Promise((resolveWait) => setTimeout(resolveWait, Math.max(0, leaseExpiresAt - Date.now() + 150)));

    const second = launchWorker(dbPath, "complete", "worker-after-restart");
    const restarted = await waitForExit(second);
    expect(restarted).toMatchObject({ code: 0, signal: null });
    expect(restarted.output).toContain("finished status=waiting_for_review attempt=2");

    const verified = new DatabaseSync(dbPath);
    const store = new ResearchJobStore(verified);
    const recoveredJob = store.get(queued.id)!;
    expect(recoveredJob).toMatchObject({
      status: "waiting_for_review",
      attempt: 2,
      worker_id: null,
      lease_token: null,
    });
    expect(store.finish(queued.id, oldLeaseToken, { stale: true }, "completed")).toBeUndefined();
    const artifacts = verified.prepare(
      "SELECT id,status,error_message FROM artifacts WHERE run_id=? ORDER BY version ASC",
    ).all("run-process-recovery") as Array<{ id: string; status: string; error_message: string | null }>;
    expect(artifacts).toHaveLength(2);
    expect(artifacts[0]).toMatchObject({
      id: abandonedArtifact.id,
      status: "failed",
    });
    expect(artifacts[0].error_message).toMatch(/阶段起点重试|JOB_LEASE_RECOVERED/);
    expect(artifacts[1]).toMatchObject({ id: recoveredJob.artifact_id, status: "needs_review" });
    verified.close();

    const statusRoute = await import("@/app/api/runs/[id]/status/route");
    const response = await statusRoute.GET(
      new Request("http://127.0.0.1/api/runs/run-process-recovery/status"),
      { params: Promise.resolve({ id: "run-process-recovery" }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.jobs[0]).toMatchObject({ id: queued.id, status: "waiting_for_review", attempt: 2 });
    expect(body.artifacts.find((item: any) => item.id === recoveredJob.artifact_id)).toMatchObject({ status: "needs_review" });
  }, 20_000);
});
