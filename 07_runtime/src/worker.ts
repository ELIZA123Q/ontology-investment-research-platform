import { AgentKernel } from "@/src/runtime/kernel";
import { RuntimeStore } from "@/src/runtime/store";
import { KnowledgeLearningService } from "@/src/knowledge/service";

const store = new RuntimeStore();
const kernel = new AgentKernel(store);
const learning = new KnowledgeLearningService(store);
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
    if (job.kind === "execute" || job.kind === "resume") kernel.executeTask(job.taskId);
    else if (job.kind === "mine_assets") learning.runMining(job.taskId);
    else if (job.kind === "evaluate_candidate") learning.evaluateCandidatesForTask(job.taskId);
    else if (job.kind === "publish_release") learning.publishApprovedForTask(job.taskId);
    else if (job.kind === "rebuild_knowledge_index") learning.rebuildKnowledgeIndex();
    store.finishJob(job.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retry = job.attempts < 3;
    store.failJob(job.id, message, retry);
    if (!retry && (job.kind === "execute" || job.kind === "resume")) {
      store.updateTaskStatus(job.taskId, "failed");
      if (!store.getMiningRunByTask(job.taskId)) {
        store.createMiningRun(job.taskId, "knowledge-learning/1.0.0");
        store.enqueueTask(job.taskId, "mine_assets");
      }
    }
    console.error(`job ${job.id} failed: ${message}`);
  }
}
store.close();
