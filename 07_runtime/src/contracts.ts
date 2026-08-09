export type Id = string;
export type IsoDate = string;
export type ActorType = "researcher" | "system" | "agent";
export type TaskStatus =
  | "planned"
  | "queued"
  | "running"
  | "waiting_input"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled";
export type NodeStatus = "pending" | "ready" | "running" | "blocked" | "completed" | "failed" | "cancelled";
export type AgentId = "research-lead" | "evidence-investigator" | "analysis-specialist" | "independent-critic";

export interface Conversation {
  id: Id;
  title: string;
  status: "active" | "archived";
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface Message {
  id: Id;
  conversationId: Id;
  actorType: ActorType;
  actorId: string;
  content: string;
  createdAt: IsoDate;
}

export interface Task {
  id: Id;
  conversationId: Id;
  parentTaskId?: Id;
  goal: string;
  intent: ResearchIntent;
  status: TaskStatus;
  budget: Budget;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export type ResearchIntent = "full_research" | "evidence_only" | "update_judgment" | "compose_only" | "clarify";

export interface Budget {
  maxModelCalls: number;
  maxToolCalls: number;
  maxCostUsd: number;
  deadlineAt?: IsoDate;
}

export interface TaskNode {
  id: Id;
  taskId: Id;
  kind: string;
  title: string;
  capabilityType: "skill" | "service" | "tool" | "policy" | "verifier";
  capabilityId: string;
  assignedAgent: AgentId;
  dependsOn: Id[];
  status: NodeStatus;
  budget: Partial<Budget>;
  inputArtifactIds: Id[];
  outputArtifactIds: Id[];
}

export type ArtifactKind =
  | "research_plan"
  | "evidence_package"
  | "hypothesis_map"
  | "judgment"
  | "report"
  | "review"
  | "ui_surface";

export interface SourceReference {
  sourceId: string;
  uri: string;
  title: string;
  capturedAt: IsoDate;
  locator: string;
  quote: string;
  contentHash: string;
  verification: "unverified" | "verified" | "rejected";
}

export interface Artifact<T = unknown> {
  id: Id;
  conversationId: Id;
  taskId: Id;
  nodeId?: Id;
  kind: ArtifactKind;
  title: string;
  version: number;
  status: "draft" | "verified" | "superseded";
  data: T;
  sourceRefs: SourceReference[];
  createdBy: string;
  createdAt: IsoDate;
}

export interface ContextReference {
  id: string;
  kind: "message" | "artifact" | "memory" | "semantic" | "source";
  version?: number;
  reason: string;
  freshnessAt?: IsoDate;
}

export interface ContextPackage {
  id: Id;
  taskId: Id;
  nodeId: Id;
  references: ContextReference[];
  tokenBudget: number;
  assembledAt: IsoDate;
}

export interface MemoryRecord {
  id: Id;
  conversationId?: Id;
  kind: "preference" | "topic_index" | "validated_failure_pattern";
  content: string;
  provenanceArtifactIds: Id[];
  reviewedAt?: IsoDate;
  createdAt: IsoDate;
}

export interface ApprovalRequest {
  id: Id;
  conversationId: Id;
  taskId: Id;
  nodeId?: Id;
  kind: "risk_action" | "evidence_confirmation" | "judgment_confirmation" | "publish_confirmation" | "plan_confirmation";
  prompt: string;
  status: "pending" | "approved" | "rejected";
  decisionNote?: string;
  createdAt: IsoDate;
  decidedAt?: IsoDate;
}

export interface RunEvent<T = unknown> {
  id: Id;
  sequence: number;
  conversationId: Id;
  taskId?: Id;
  nodeId?: Id;
  type: string;
  actorType: ActorType;
  actorId: string;
  payload: T;
  createdAt: IsoDate;
}

export interface TraceSpan {
  id: Id;
  traceId: Id;
  parentSpanId?: Id;
  conversationId: Id;
  taskId?: Id;
  nodeId?: Id;
  category: "model" | "skill" | "tool" | "agent" | "verifier";
  name: string;
  inputRefs: string[];
  status: "running" | "ok" | "error";
  startedAt: IsoDate;
  endedAt?: IsoDate;
  latencyMs?: number;
  costUsd?: number;
  error?: string;
}

export interface DelegationBrief {
  id: Id;
  taskId: Id;
  nodeId: Id;
  fromAgent: AgentId;
  toAgent: Exclude<AgentId, "research-lead">;
  objective: string;
  successCriteria: string[];
  allowedContextRefs: string[];
  allowedTools: string[];
  outputArtifactKind: ArtifactKind;
  budget: Partial<Budget>;
  stopConditions: string[];
  returnTo: AgentId;
}

export type TrustedComponentKind =
  | "clarification_form"
  | "research_plan"
  | "evidence_matrix"
  | "hypothesis_map"
  | "judgment_card"
  | "comparison_table"
  | "chart"
  | "report_editor"
  | "approval_card"
  | "branch_card"
  | "execution_timeline";

export interface UiSurface {
  id: Id;
  component: TrustedComponentKind;
  title: string;
  data: Record<string, unknown>;
  editableFields: string[];
  artifactId?: Id;
}

export interface Checkpoint {
  id: Id;
  taskId: Id;
  nodeId?: Id;
  phase: "before" | "after" | "failure" | "pause";
  state: Record<string, unknown>;
  createdAt: IsoDate;
}
