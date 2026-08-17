import { DOMAIN_CATALOG } from "@/src/generated/domain-catalog";
import { TASK_OUTCOME_VALUES } from "@/src/runtime/state-machine";
import type { EvidenceRole } from "@/src/contracts/evidence";
import type { Id, IsoDate } from "@/src/contracts/execution";

export const TASK_STATUS_VALUES = DOMAIN_CATALOG.contextState.state.runtime_status_projection.task_status_values;
export type TaskStatus = typeof TASK_STATUS_VALUES[number];
export const NODE_STATUS_VALUES = DOMAIN_CATALOG.contextState.state.runtime_status_projection.node_status_values;
export type NodeStatus = typeof NODE_STATUS_VALUES[number];
type ActiveAgentDefinition = typeof DOMAIN_CATALOG.capabilities.agents.agents[number];
type CandidateAgentDefinition = typeof DOMAIN_CATALOG.capabilities.agents.candidates[number];
export type AgentId = ActiveAgentDefinition["agent_id"] | CandidateAgentDefinition["agent_id"];
export const RESEARCH_ROLE_VALUES = DOMAIN_CATALOG.roles.map((role) => role.role_id);
export type ResearchRole = typeof RESEARCH_ROLE_VALUES[number];
export type ResearchRunOutcome = typeof TASK_OUTCOME_VALUES[number];

export type ResearchIntent = typeof DOMAIN_CATALOG.planningContract.runtime_execution_projection.intent_values[number];
export type ReportKind = typeof DOMAIN_CATALOG.reportGeneration.report_spec.kinds[number];
export type ReportAudience = typeof DOMAIN_CATALOG.reportGeneration.report_spec.audiences[number];
export type ReportDepth = typeof DOMAIN_CATALOG.reportGeneration.report_spec.depths[number];
type BaseReportSectionKey = typeof DOMAIN_CATALOG.reportGeneration.report_spec.base_required_sections[number];
type KindRequiredSectionMap = typeof DOMAIN_CATALOG.reportGeneration.report_spec.kind_required_sections;
export type ReportSectionKey = BaseReportSectionKey | KindRequiredSectionMap[keyof KindRequiredSectionMap][number];
export type JudgmentType = keyof typeof DOMAIN_CATALOG.governance.judgmentMethodRoutes.routes;
export type SignalRole = typeof DOMAIN_CATALOG.judgmentCommit.signal_roles.values[number];
export type MethodGateStatus = typeof DOMAIN_CATALOG.governance.publicContract.method_application_contract.gate_statuses[number];
export type MethodExecutionStatus = typeof DOMAIN_CATALOG.governance.publicContract.method_application_contract.execution_statuses[number];

export interface MethodApplication {
  id: string;
  sectionKey: ReportSectionKey;
  judgmentType: JudgmentType;
  frameworkIds: string[];
  evidenceMethodId: string;
  adjudicationMethodId: string;
  requiredEvidenceRoles: EvidenceRole[];
  matchedEvidenceRoles: EvidenceRole[];
  missingEvidenceRoles: EvidenceRole[];
  evidenceFactIds: string[];
  rationale: string;
  gateStatus: MethodGateStatus;
  executionStatus: MethodExecutionStatus;
  sourceRefs: string[];
}

export interface ResearchMethodPlan {
  version: "1.0.0";
  selectionMode: "bounded_default" | "agent_proposal";
  knowledgeVersions: { framework: "2.0.0"; evidence: "3.2.0"; adjudication: "1.0.0" };
  applications: MethodApplication[];
  exitCondition: string;
}

export interface ReportSpec {
  version: "1.0.0";
  kind: ReportKind;
  audience: ReportAudience;
  depth: ReportDepth;
  language: "zh-CN";
  sections: ReportSectionKey[];
  customInstructions?: string;
}

export interface ReportSpecInput {
  kind?: ReportKind;
  audience?: ReportAudience;
  depth?: ReportDepth;
  optionalSections?: ReportSectionKey[];
  customInstructions?: string;
}

export interface Budget {
  maxModelCalls: number;
  maxToolCalls: number;
  maxCostUsd: number;
  deadlineAt?: IsoDate;
}

export interface Task {
  id: Id;
  conversationId: Id;
  researchCaseId: Id;
  parentTaskId?: Id;
  goal: string;
  intent: ResearchIntent;
  reportSpec: ReportSpec;
  status: TaskStatus;
  outcome?: ResearchRunOutcome;
  budget: Budget;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export type ProblemGraphNodeType =
  | "root_question"
  | "judgment_unit"
  | "hypothesis"
  | "competing_explanation"
  | "evidence_requirement"
  | "blocking_factor"
  | "synthesis";
export type FrontierState = typeof DOMAIN_CATALOG.problemGraphContract.runtime_projection.frontier_state_values[number];
export type ProblemGraphRelation = typeof DOMAIN_CATALOG.problemGraphContract.runtime_projection.relation_values[number];

export interface ProblemGraphNode {
  id: Id;
  graphId: Id;
  key: string;
  type: ProblemGraphNodeType;
  title: string;
  state: FrontierState;
  required: boolean;
  motifRef?: string;
  semanticRef?: string;
  payload: Record<string, unknown>;
  resolvedArtifactIds: Id[];
  freshnessAt?: IsoDate;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface ProblemGraphEdge {
  id: Id;
  graphId: Id;
  fromNodeId: Id;
  toNodeId: Id;
  relation: ProblemGraphRelation;
  payload: Record<string, unknown>;
}

export interface ResearchProblemGraph {
  id: Id;
  taskId: Id;
  researchCaseId: Id;
  version: number;
  status: "proposed" | "active" | "settled" | "superseded";
  intentRefs: string[];
  scenarioRefs: string[];
  taskMotifRefs: string[];
  lensRefs?: string[];
  fingerprint: string;
  nodes: ProblemGraphNode[];
  edges: ProblemGraphEdge[];
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface FrontierRef {
  problemGraphId: Id;
  problemNodeId?: Id;
  judgmentUnitRef?: Id;
  evidenceRequirementRef?: Id;
  evidenceRole?: "support" | "counter" | "boundary" | "context";
  compilerBoundary?: "scope" | "synthesis" | "compose" | "audit";
}

export type StopPredicate =
  | { kind: "required_units_terminal" }
  | { kind: "evidence_requirement_fulfilled"; requirementRef: Id }
  | { kind: "budget_exhausted" }
  | { kind: "information_gain_below"; threshold: number }
  | { kind: "researcher_stop" };

export interface TaskNode {
  id: Id;
  taskId: Id;
  kind: string;
  title: string;
  capabilityType: "skill" | "service" | "tool" | "function" | "action" | "policy" | "verifier";
  capabilityId: string;
  assignedAgent: AgentId;
  dependsOn: Id[];
  status: NodeStatus;
  budget: Partial<Budget>;
  inputArtifactIds: Id[];
  outputArtifactIds: Id[];
  frontierRef: FrontierRef;
  iteration: number;
}

export const WORKSPACE_RESOURCE_TYPES = DOMAIN_CATALOG.contextState.workspace.resource_types.map((resource) => resource.id);
export type WorkspaceResourceType = typeof WORKSPACE_RESOURCE_TYPES[number];
export const WORKSPACE_STATUS_VALUES = DOMAIN_CATALOG.contextState.workspace.runtime_projection.workspace_status_values;
export type WorkspaceStatus = typeof WORKSPACE_STATUS_VALUES[number];

export interface WorkspaceResourceRef {
  id: Id;
  kind: WorkspaceResourceType;
  version?: number;
  frozen: boolean;
}

export interface WorkspaceProjection {
  workspaceId: Id;
  sessionId: Id;
  taskId: Id;
  runId: Id;
  status: WorkspaceStatus;
  resourceRefs: WorkspaceResourceRef[];
  updatedAt: IsoDate;
}
