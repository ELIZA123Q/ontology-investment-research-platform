import { randomUUID } from "node:crypto";
import { assertArtifactAllowed, assertBudgetWithinLimit, DomainInvariantError } from "@investment/domain";
import type { AgentContract, AgentId, ArtifactEnvelope, ArtifactKind, Budget, KnowledgeRef, WorkOrder, WorkerResult } from "@investment/domain";

export interface TaskNodeDefinition {
  kind: string;
  skillId: string;
  assignedAgent: AgentId;
  dependsOn: string[];
  outputKinds: ArtifactKind[];
  requiredKnowledgeAssets: string[];
  maxAttempts: number;
  humanGateAfter?: "evidence_confirmation" | "judgment_confirmation" | "publish_confirmation";
}

export interface WorkOrderRepository {
  findByIdempotencyKey(key: string): WorkOrder | null;
  put(order: WorkOrder): void;
  complete(order: WorkOrder, result: WorkerResult): void;
}

export interface ArtifactRepository {
  putArtifact(artifact: ArtifactEnvelope): void;
}

export interface AuditEventWriter {
  append(event: { runId: string; type: string; actorId: string; payload: Record<string, unknown> }): void;
}

export interface Worker {
  readonly contract: AgentContract;
  execute(order: WorkOrder): Promise<WorkerResult>;
}

export class WorkerRegistry {
  private readonly workers = new Map<AgentId, Worker>();
  register(worker: Worker): void {
    if (this.workers.has(worker.contract.agentId)) throw new Error(`Worker already registered: ${worker.contract.agentId}`);
    this.workers.set(worker.contract.agentId, worker);
  }
  get(agentId: AgentId): Worker {
    const worker = this.workers.get(agentId);
    if (!worker) throw new DomainInvariantError(`Worker is not active: ${agentId}`);
    return worker;
  }
}

export class DeterministicSupervisor {
  constructor(
    readonly workers: WorkerRegistry,
    readonly orders: WorkOrderRepository,
    readonly artifacts: ArtifactRepository,
    readonly events: AuditEventWriter,
  ) {}

  createOrder(input: {
    runId: string; nodeId: string; node: TaskNodeDefinition; goal: string; input: unknown;
    inputArtifactIds: string[]; knowledgeRefs: KnowledgeRef[]; budget: Budget; attempt?: number; completedNodeKinds?: readonly string[];
  }): WorkOrder {
    const completed = new Set(input.completedNodeKinds || []);
    const unresolvedDependencies = input.node.dependsOn.filter((kind) => !completed.has(kind));
    if (unresolvedDependencies.length) throw new DomainInvariantError(`Node dependencies are unresolved: ${unresolvedDependencies.join(", ")}`);
    const required = new Set(input.node.requiredKnowledgeAssets);
    const supplied = new Set(input.knowledgeRefs.map((item) => item.assetId));
    const missing = [...required].filter((item) => !supplied.has(item));
    if (missing.length) throw new DomainInvariantError(`Missing required knowledge assets: ${missing.join(", ")}`);
    const attempt = input.attempt || 1;
    if (attempt > input.node.maxAttempts) throw new DomainInvariantError(`Node ${input.node.kind} exhausted its retry budget`);
    const idempotencyKey = `${input.runId}:${input.nodeId}:${attempt}`;
    const existing = this.orders.findByIdempotencyKey(idempotencyKey);
    if (existing) return existing;
    const order: WorkOrder = {
      id: randomUUID(), runId: input.runId, nodeId: input.nodeId, nodeKind: input.node.kind,
      skillId: input.node.skillId,
      assignedAgent: input.node.assignedAgent, goal: input.goal, input: input.input,
      inputArtifactIds: input.inputArtifactIds, allowedOutputKinds: input.node.outputKinds,
      knowledgeRefs: input.knowledgeRefs, budget: input.budget, idempotencyKey, attempt,
    };
    this.orders.put(order);
    this.events.append({ runId: input.runId, type: "work_order.queued", actorId: "research-lead", payload: { orderId: order.id, nodeId: order.nodeId, assignedAgent: order.assignedAgent } });
    return order;
  }

  async execute(order: WorkOrder): Promise<WorkerResult> {
    const worker = this.workers.get(order.assignedAgent);
    if (!worker.contract.allowedNodeKinds.includes(order.nodeKind)) throw new DomainInvariantError(`Agent ${order.assignedAgent} cannot execute ${order.nodeKind}`);
    this.events.append({ runId: order.runId, type: "work_order.started", actorId: order.assignedAgent, payload: { orderId: order.id, nodeId: order.nodeId } });
    const result = await worker.execute(order);
    assertBudgetWithinLimit(result.usage, order.budget);
    if (result.status === "completed") {
      if (!result.artifact) throw new DomainInvariantError("Completed worker result has no artifact");
      assertArtifactAllowed(order, worker.contract, result.artifact);
      this.artifacts.putArtifact(result.artifact);
    } else if (result.artifact) {
      throw new DomainInvariantError("Non-completed worker result cannot commit an artifact");
    }
    this.orders.complete(order, result);
    this.events.append({ runId: order.runId, type: `work_order.${result.status}`, actorId: order.assignedAgent, payload: { orderId: order.id, nodeId: order.nodeId, artifactId: result.artifact?.id, error: result.error } });
    return result;
  }
}

export const EARNINGS_UPDATE_GRAPH: readonly TaskNodeDefinition[] = [
  { kind: "evidence_capture", skillId: "evidence-research", assignedAgent: "evidence-investigator", dependsOn: [], outputKinds: ["evidence_package"], requiredKnowledgeAssets: ["task:earnings_update"], maxAttempts: 2, humanGateAfter: "evidence_confirmation" },
  { kind: "financial_normalization", skillId: "financial-modeling", assignedAgent: "financial-modeler", dependsOn: ["evidence_capture"], outputKinds: ["normalized_financials"], requiredKnowledgeAssets: ["task:earnings_update"], maxAttempts: 2 },
  { kind: "model_build_or_update", skillId: "financial-modeling", assignedAgent: "financial-modeler", dependsOn: ["financial_normalization"], outputKinds: ["financial_model"], requiredKnowledgeAssets: ["task:earnings_update"], maxAttempts: 2 },
  { kind: "judgment", skillId: "judgment-reasoning", assignedAgent: "research-lead", dependsOn: ["model_build_or_update"], outputKinds: ["judgment"], requiredKnowledgeAssets: ["task:earnings_update"], maxAttempts: 1, humanGateAfter: "judgment_confirmation" },
  { kind: "independent_review", skillId: "independent-research-review", assignedAgent: "independent-critic", dependsOn: ["judgment"], outputKinds: ["review"], requiredKnowledgeAssets: ["skill:independent-research-review"], maxAttempts: 1 },
  { kind: "compose", skillId: "research-delivery", assignedAgent: "research-lead", dependsOn: ["independent_review"], outputKinds: ["report"], requiredKnowledgeAssets: ["skill:research-delivery"], maxAttempts: 1, humanGateAfter: "publish_confirmation" },
] as const;
