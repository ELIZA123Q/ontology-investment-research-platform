export type Id = string;
export type IsoDate = string;
export type Fingerprint = `sha256:${string}`;

export type ResearchCaseStatus = "draft" | "active" | "waiting_input" | "completed" | "cancelled";
export type WorkOrderStatus = "queued" | "running" | "completed" | "failed" | "waiting_input" | "cancelled";
export type AgentId = "research-lead" | "evidence-investigator" | "financial-modeler" | "independent-critic";

export type ArtifactKind =
  | "research_plan"
  | "research_problem_graph"
  | "evidence_package"
  | "normalized_financials"
  | "financial_model"
  | "valuation_analysis"
  | "hypothesis_map"
  | "judgment"
  | "thesis_state"
  | "report"
  | "review";

export interface KnowledgeRef {
  bundleId: Fingerprint;
  assetId: string;
  version: string;
  authorityRef: string;
}

export interface ResearchRunLock {
  runId: Id;
  researchCaseId: Id;
  bundleId: Fingerprint;
  asOf: IsoDate;
  lockedAt: IsoDate;
}

export interface Budget {
  maxModelCalls: number;
  maxToolCalls: number;
  maxCostUsd: number;
  deadlineAt?: IsoDate;
}

export interface ResearchCase {
  id: Id;
  version: number;
  status: ResearchCaseStatus;
  companyCode: string;
  companyName: string;
  researchQuestion: string;
  asOf: IsoDate;
  bundleId: Fingerprint;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface ArtifactEnvelope<T = unknown> {
  id: Id;
  runId: Id;
  nodeId: Id;
  kind: ArtifactKind;
  schemaId: string;
  schemaVersion: string;
  content: T;
  sourceRefs: string[];
  knowledgeRefs: KnowledgeRef[];
  createdBy: AgentId;
  createdAt: IsoDate;
}

export interface WorkOrder<T = unknown> {
  id: Id;
  runId: Id;
  nodeId: Id;
  nodeKind: string;
  skillId: string;
  assignedAgent: AgentId;
  goal: string;
  input: T;
  inputArtifactIds: Id[];
  allowedOutputKinds: ArtifactKind[];
  knowledgeRefs: KnowledgeRef[];
  budget: Budget;
  idempotencyKey: string;
  attempt: number;
}

export interface SkillExecutionContext {
  runId: Id;
  nodeId: Id;
  nodeKind: string;
  skillId: string;
  agentId: AgentId;
  budget: Budget;
  knowledgeRefs: KnowledgeRef[];
}

export interface SkillHandler<I = unknown, O = unknown> {
  readonly skillId: string;
  execute(context: SkillExecutionContext, input: I): Promise<O>;
}

export interface WorkerResult<T = unknown> {
  orderId: Id;
  status: "completed" | "failed" | "waiting_input";
  artifact?: ArtifactEnvelope<T>;
  error?: { code: string; message: string; retryable: boolean };
  usage: { modelCalls: number; toolCalls: number; costUsd: number };
}

export interface AgentContract {
  agentId: AgentId;
  contextPolicy: "conversation" | "delegated_slice" | "isolated_review";
  writableArtifactKinds: readonly ArtifactKind[];
  allowedNodeKinds: readonly string[];
}

export interface CommandEnvelope<T = Record<string, unknown>> {
  commandId: string;
  expectedVersion: number;
  type: string;
  payload: T;
}

export class DomainInvariantError extends Error {
  readonly code = "domain_invariant_failed";
}

export function assertBudgetWithinLimit(used: WorkerResult["usage"], budget: Budget): void {
  if (used.modelCalls > budget.maxModelCalls || used.toolCalls > budget.maxToolCalls || used.costUsd > budget.maxCostUsd) {
    throw new DomainInvariantError("Worker usage exceeds the work-order budget");
  }
}

export function assertArtifactAllowed(order: WorkOrder, contract: AgentContract, artifact: ArtifactEnvelope): void {
  if (artifact.runId !== order.runId || artifact.nodeId !== order.nodeId) throw new DomainInvariantError("Artifact is not bound to its work order");
  if (artifact.createdBy !== order.assignedAgent || contract.agentId !== order.assignedAgent) throw new DomainInvariantError("Artifact author is not the assigned worker");
  if (!order.allowedOutputKinds.includes(artifact.kind)) throw new DomainInvariantError(`Node does not allow artifact kind ${artifact.kind}`);
  if (!contract.writableArtifactKinds.includes(artifact.kind)) throw new DomainInvariantError(`Agent ${contract.agentId} cannot write ${artifact.kind}`);
}
