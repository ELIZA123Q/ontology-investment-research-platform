import { createArtifact, updateArtifactIfStatus } from "../../adapters/db";
import { runNextResearchJob } from "../../engine/research_job_runner";
import type { Artifact } from "../../engine/types";

const mode = process.env.RESEARCH_WORKER_FIXTURE_MODE;
const workerId = process.env.RESEARCH_WORKER_ID || `fixture-worker-${process.pid}`;

if (process.env.NODE_ENV !== "test" || !["hang", "complete"].includes(String(mode))) {
  throw new Error("research-worker-process fixture is test-only and requires hang|complete mode");
}

async function execute(runId: string, kind: Artifact["kind"], options: any): Promise<Artifact> {
  const artifact = createArtifact(runId, kind, {
    status: "running",
    model_name: "fault-injection-fixture",
    token_usage: "{}",
  });
  options?.executionLease?.onArtifactCreated?.(artifact.id);
  console.log(`[fixture-worker] artifact_bound artifact_id=${artifact.id} worker_id=${workerId}`);

  if (mode === "hang") {
    await new Promise<never>(() => {
      setInterval(() => undefined, 1_000);
    });
  }

  options?.executionLease?.assertActive?.();
  const completed = updateArtifactIfStatus(artifact.id, "running", {
    status: "needs_review",
    json_content: JSON.stringify({ normalized_question: "故障恢复后的范围草稿" }),
    token_usage: JSON.stringify({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }),
  });
  if (!completed) throw new Error("fixture artifact lost its active lease");
  return completed;
}

async function main() {
  const result = await runNextResearchJob({ workerId, execute });
  if (!result) {
    console.error(`[fixture-worker] no_claim worker_id=${workerId}`);
    process.exitCode = 2;
  } else {
    console.log(`[fixture-worker] finished status=${result.status} attempt=${result.attempt} worker_id=${workerId}`);
  }
}

void main().catch((error) => {
  console.error("[fixture-worker] fatal", error);
  process.exitCode = 1;
});
