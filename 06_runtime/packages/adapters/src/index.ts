import type { AgentContract, ArtifactEnvelope, SkillExecutionContext, SkillHandler, WorkOrder, WorkerResult } from "@investment/domain";
import type { Worker } from "@investment/orchestrator";

export type WorkerHandler = (order: WorkOrder) => Promise<Omit<ArtifactEnvelope, "id" | "runId" | "nodeId" | "createdBy" | "createdAt">>;

export class TypedWorkerAdapter implements Worker {
  constructor(readonly contract: AgentContract, readonly handler: WorkerHandler) {}
  async execute(order: WorkOrder): Promise<WorkerResult> {
    try {
      const draft = await this.handler(order);
      return {
        orderId: order.id,
        status: "completed",
        artifact: {
          ...draft,
          knowledgeRefs: order.knowledgeRefs,
          id: `${order.id}:artifact`, runId: order.runId, nodeId: order.nodeId,
          createdBy: this.contract.agentId, createdAt: new Date().toISOString(),
        },
        usage: { modelCalls: 0, toolCalls: 0, costUsd: 0 },
      };
    } catch (error) {
      return { orderId: order.id, status: "failed", error: { code: "worker_failed", message: error instanceof Error ? error.message : String(error), retryable: false }, usage: { modelCalls: 0, toolCalls: 0, costUsd: 0 } };
    }
  }
}

export type SkillArtifactDraft = Omit<ArtifactEnvelope, "id" | "runId" | "nodeId" | "createdBy" | "createdAt">;

export class SkillHandlerRegistry {
  private readonly handlers = new Map<string, SkillHandler<unknown, SkillArtifactDraft>>();

  register<I>(handler: SkillHandler<I, SkillArtifactDraft>): void {
    if (this.handlers.has(handler.skillId)) throw new Error(`Skill handler already registered: ${handler.skillId}`);
    this.handlers.set(handler.skillId, handler as SkillHandler<unknown, SkillArtifactDraft>);
  }

  get(skillId: string): SkillHandler<unknown, SkillArtifactDraft> {
    const handler = this.handlers.get(skillId);
    if (!handler) throw new Error(`No runtime handler is bound for Skill ${skillId}`);
    return handler;
  }

  assertCoverage(skillIds: readonly string[]): void {
    const missing = [...new Set(skillIds)].filter((id) => !this.handlers.has(id));
    if (missing.length) throw new Error(`Missing runtime Skill handlers: ${missing.join(", ")}`);
  }
}

export class TypedSkillWorkerAdapter implements Worker {
  constructor(readonly contract: AgentContract, readonly handlers: SkillHandlerRegistry) {}

  async execute(order: WorkOrder): Promise<WorkerResult> {
    try {
      const context: SkillExecutionContext = {
        runId: order.runId, nodeId: order.nodeId, nodeKind: order.nodeKind, skillId: order.skillId,
        agentId: order.assignedAgent, budget: order.budget, knowledgeRefs: order.knowledgeRefs,
      };
      const draft = await this.handlers.get(order.skillId).execute(context, order.input);
      return {
        orderId: order.id,
        status: "completed",
        artifact: {
          ...draft,
          id: `${order.id}:artifact`, runId: order.runId, nodeId: order.nodeId,
          createdBy: this.contract.agentId, createdAt: new Date().toISOString(),
        },
        usage: { modelCalls: 0, toolCalls: 0, costUsd: 0 },
      };
    } catch (error) {
      return { orderId: order.id, status: "failed", error: { code: "skill_handler_failed", message: error instanceof Error ? error.message : String(error), retryable: false }, usage: { modelCalls: 0, toolCalls: 0, costUsd: 0 } };
    }
  }
}
