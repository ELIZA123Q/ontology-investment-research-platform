import { createProductionWorkerRuntime } from "@/src/application/production-worker-runtime";

const runtime = createProductionWorkerRuntime();
let lastHeartbeat = 0;
let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

console.log(`vNext runtime worker started (${runtime.workerId}); recovered ${runtime.recoveredJobs} stale job(s)`);
while (!stopping) {
  if (Date.now() - lastHeartbeat >= 5_000) { runtime.heartbeat(); lastHeartbeat = Date.now(); }
  if (!await runtime.runNext()) await new Promise((resolve) => setTimeout(resolve, 750));
}
runtime.close();
