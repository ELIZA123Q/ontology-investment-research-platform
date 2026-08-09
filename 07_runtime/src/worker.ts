import { AgentKernel } from "@/src/runtime/kernel";
import { RuntimeStore } from "@/src/runtime/store";

const store = new RuntimeStore();
const kernel = new AgentKernel(store);
const recovered = store.recoverStaleJobs();
let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

console.log(`vNext runtime worker started; recovered ${recovered} stale job(s)`);
while (!stopping) {
  const job = store.claimJob();
  if (!job) {
    await new Promise((resolve) => setTimeout(resolve, 750));
    continue;
  }
  try {
    kernel.executeTask(job.taskId);
    store.finishJob(job.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retry = job.attempts < 3;
    store.failJob(job.id, message, retry);
    if (!retry) store.updateTaskStatus(job.taskId, "failed");
    console.error(`job ${job.id} failed: ${message}`);
  }
}
store.close();
