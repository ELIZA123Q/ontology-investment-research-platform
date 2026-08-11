import { AgentKernel } from "@/src/runtime/kernel";
import { RuntimeStore } from "@/src/runtime/store";
import { KnowledgeLearningService } from "@/src/knowledge/service";
import { providerFromEnv } from "@/src/providers/model-provider";
import { randomUUID } from "node:crypto";

const store = new RuntimeStore();
const kernel = new AgentKernel(store);
const learning = new KnowledgeLearningService(store);
const modelProvider = providerFromEnv();
const recovered = store.recoverStaleJobs() + store.recoverStaleNodeJobs();
const workerId = process.env.VNEXT_WORKER_ID?.trim() || `worker:${randomUUID()}`;
store.registerWorker(workerId, process.pid);
let lastHeartbeat = 0;
let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

console.log(`vNext runtime worker started (${workerId}); recovered ${recovered} stale job(s)`);
while (!stopping) {
  if (Date.now() - lastHeartbeat >= 5_000) { store.heartbeatWorker(workerId); lastHeartbeat = Date.now(); }
  const nodeJob = store.claimNodeJob(3);
  if (nodeJob) {
    try {
      if (process.env.VNEXT_MODEL_REASONING_ENABLED === "true") await kernel.prepareModelReasoningNode(nodeJob.taskId, nodeJob.nodeId, modelProvider);
      kernel.executeTaskNode(nodeJob.taskId, nodeJob.nodeId);
      store.finishNodeJob(nodeJob.id);
    } catch (error) {
      store.failNodeJob(nodeJob.id, error instanceof Error ? error.message : String(error), nodeJob.attempts < 3);
    }
    continue;
  }
  const job = store.claimJob();
  if (!job) {
    await new Promise((resolve) => setTimeout(resolve, 750));
    continue;
  }
  try {
    if (job.kind === "execute" || job.kind === "resume") {
      if (process.env.VNEXT_MODEL_DRAFTING_ENABLED === "true") await kernel.prepareModelReportDraft(job.taskId, modelProvider);
      kernel.dispatchTask(job.taskId);
    }
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
store.stopWorker(workerId);
store.close();
