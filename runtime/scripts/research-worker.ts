import { runResearchWorkerLoop } from "../engine/research_job_runner";

const controller = new AbortController();
const workerId = process.env.RESEARCH_WORKER_ID || `research-worker-${process.pid}`;

process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());

async function main() {
  console.log(`[research-worker] started worker_id=${workerId}`);
  await runResearchWorkerLoop({
    workerId,
    pollMs: Number(process.env.RESEARCH_WORKER_POLL_MS || 2_000),
    signal: controller.signal,
  });
  console.log(`[research-worker] stopped worker_id=${workerId}`);
}

void main().catch((error) => {
  console.error("[research-worker] fatal", error);
  process.exitCode = 1;
});
