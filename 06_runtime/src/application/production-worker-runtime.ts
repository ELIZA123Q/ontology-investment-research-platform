import { randomUUID } from "node:crypto";
import { KnowledgeLearningService } from "@/src/knowledge/service";
import { providerFromEnv, type ModelProvider } from "@/src/providers/model-provider";
import { AgentKernel } from "@/src/runtime/kernel";
import { RuntimeStore } from "@/src/runtime/store";

export interface ProductionWorkerRuntime {
  readonly workerId: string;
  readonly recoveredJobs: number;
  heartbeat(): void;
  runNext(): Promise<boolean>;
  close(): void;
}

async function withLeaseRenewal<T>(renew: () => boolean, work: () => Promise<T> | T): Promise<T> {
  if (!renew()) throw new Error("Worker lost the job lease before execution");
  const timer = setInterval(() => {
    if (!renew()) console.error("Worker lost a job lease while executing");
  }, 5_000);
  try { return await work(); }
  finally { clearInterval(timer); }
}

/**
 * Application port for the production queue worker.
 *
 * The compatibility Kernel/Store remain implementation details while their
 * use cases are migrated into packages. Entrypoints must depend on this port,
 * so the compatibility boundary can shrink without another worker rewrite.
 */
export class LegacyBackedProductionWorkerRuntime implements ProductionWorkerRuntime {
  readonly workerId: string;
  readonly recoveredJobs: number;
  private readonly kernel: AgentKernel;
  private readonly learning: KnowledgeLearningService;

  constructor(
    private readonly store = new RuntimeStore(),
    private readonly modelProvider: ModelProvider | null = providerFromEnv(),
    workerId = process.env.VNEXT_WORKER_ID?.trim() || `worker:${randomUUID()}`,
  ) {
    this.workerId = workerId;
    this.kernel = new AgentKernel(store);
    this.learning = new KnowledgeLearningService(store);
    this.recoveredJobs = store.queue.recoverStaleJobs() + store.queue.recoverStaleNodeJobs();
    store.workers.register(workerId, process.pid);
  }

  heartbeat(): void {
    this.store.workers.heartbeat(this.workerId);
  }

  async runNext(): Promise<boolean> {
    const nodeJob = this.store.queue.claimNodeJob(3, this.workerId);
    if (nodeJob) {
      try {
        await withLeaseRenewal(() => this.store.queue.renewNodeJobLease(nodeJob.id, this.workerId), async () => {
          if (process.env.VNEXT_MODEL_REASONING_ENABLED === "true") {
            await this.kernel.prepareModelReasoningNode(nodeJob.taskId, nodeJob.nodeId, this.modelProvider);
          }
          this.kernel.executeTaskNode(nodeJob.taskId, nodeJob.nodeId);
        });
        this.store.queue.finishNodeJob(nodeJob.id, this.workerId);
      } catch (error) {
        this.store.queue.failNodeJob(nodeJob.id, error instanceof Error ? error.message : String(error), nodeJob.attempts < 3, this.workerId);
      }
      return true;
    }

    const job = this.store.queue.claimJob(this.workerId);
    if (!job) return false;
    try {
      await withLeaseRenewal(() => this.store.queue.renewJobLease(job.id, this.workerId), async () => {
        if (job.kind === "execute" || job.kind === "resume") {
          if (process.env.VNEXT_MODEL_DRAFTING_ENABLED === "true") {
            await this.kernel.prepareModelReportDraft(job.taskId, this.modelProvider);
          }
          this.kernel.dispatchTask(job.taskId);
        } else if (job.kind === "mine_assets") this.learning.runMining(job.taskId);
        else if (job.kind === "evaluate_candidate") this.learning.evaluateCandidatesForTask(job.taskId);
        else if (job.kind === "publish_release") this.learning.publishApprovedForTask(job.taskId);
        else if (job.kind === "rebuild_knowledge_index") this.learning.rebuildKnowledgeIndex();
      });
      this.store.queue.finishJob(job.id, this.workerId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retry = job.attempts < 3;
      this.store.queue.failJob(job.id, message, retry, this.workerId);
      if (!retry && (job.kind === "execute" || job.kind === "resume")) {
        const task = this.store.getTask(job.taskId);
        if (task && ["queued", "running"].includes(task.status)) {
          this.store.transitionTask(job.taskId, "runtime_fail", { actorId: "runtime-worker", payload: { jobId: job.id, error: message } });
        }
        if (!this.store.knowledge.getMiningRunByTask(job.taskId)) {
          this.store.knowledge.createMiningRun(job.taskId, "knowledge-learning/1.0.0");
          this.store.queue.enqueueTask(job.taskId, "mine_assets");
        }
      }
      console.error(`job ${job.id} failed: ${message}`);
    }
    return true;
  }

  close(): void {
    this.store.workers.stop(this.workerId);
    this.store.close();
  }
}

export function createProductionWorkerRuntime(): ProductionWorkerRuntime {
  return new LegacyBackedProductionWorkerRuntime();
}
