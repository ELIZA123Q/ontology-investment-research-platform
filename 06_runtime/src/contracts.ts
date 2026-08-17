import { DOMAIN_CATALOG } from "@/src/generated/domain-catalog";
import type { AssetRef } from "@/src/contracts/knowledge";
import type { ArtifactKind, EvidenceFact, EvidenceRole } from "@/src/contracts/evidence";
import type { EpistemicStatus, JudgmentLifecycleStatus } from "@/src/contracts/ontology";
import type { OntologyContextSlice } from "@/src/semantic/graph-contracts";
import type { ActorType, ApprovalRequest, Id, IsoDate } from "@/src/contracts/execution";
import type {
  AgentId, Budget, FrontierRef, FrontierState, JudgmentType, MethodApplication, MethodGateStatus,
  NodeStatus, ReportSectionKey, ReportSpec, ResearchIntent, ResearchMethodPlan, ResearchProblemGraph,
  ResearchRole, SignalRole, StopPredicate, TaskNode, TaskStatus, WorkspaceProjection,
} from "@/src/contracts/task";
export type { ActorType, ApprovalRequest, Id, IsoDate, OntologyActorType, RunEvent } from "@/src/contracts/execution";
export * from "@/src/contracts/task";

export interface ModelCallRecord {
  id: Id;
  operation: string;
  fingerprint: string;
  provider: string;
  model: string;
  promptVersion: string;
  schemaVersion?: string;
  contextHash: string;
  status: "completed" | "failed" | "cached" | "blocked";
  attempts: number;
  cacheHit: boolean;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
  latencyMs: number;
  error?: string;
  createdAt: IsoDate;
  completedAt: IsoDate;
}

export interface PointInTimeEvidenceEnvelope {
  connectorId: string;
  operation: string;
  subjectRef: string;
  publisherId: string;
  sourceUri: string;
  publishedAt: IsoDate;
  businessTime: IsoDate;
  capturedAt: IsoDate;
  asOf: IsoDate;
  permissionScope: string;
  accountingBasis?: string;
  currency?: string;
  unit?: string;
  rawResponseFingerprint: string;
}

export interface Conversation {
  id: Id;
  title: string;
  tenantId: string;
  userId: string;
  status: "active" | "archived";
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface ResearchTrackingProfile {
  conversationId: Id;
  enabled: boolean;
  symbols: string[];
  keywords: string[];
  updatedAt: IsoDate;
}

export type ResearchSignalKind = typeof DOMAIN_CATALOG.contextState.lifecycle.state_machines.ResearchSignal.kinds[number];
export type ResearchSignalStatus = typeof DOMAIN_CATALOG.contextState.lifecycle.state_machines.ResearchSignal.states[number];

export interface ResearchSignalCandidate {
  id: Id;
  connectorId: string;
  conversationId: Id;
  kind: ResearchSignalKind;
  status: ResearchSignalStatus;
  symbol?: string;
  title: string;
  excerpt: string;
  publisher: string;
  sourceUri: string;
  sourceType: "primary" | "secondary";
  publishedAt: IsoDate;
  capturedAt: IsoDate;
  matchReason: string;
  score: number;
  fingerprint: string;
  promotedTaskId?: Id;
}

export interface SignalRefreshRun {
  id: Id;
  connectorId: string;
  status: "queued" | "running" | "completed" | "partial" | "failed";
  conversationIds: Id[];
  candidateCount: number;
  error?: string;
  createdAt: IsoDate;
  startedAt?: IsoDate;
  completedAt?: IsoDate;
}

export interface Message {
  id: Id;
  conversationId: Id;
  actorType: ActorType;
  actorId: string;
  content: string;
  createdAt: IsoDate;
}

export interface ContextReference {
  id: string;
  kind: "message" | "artifact" | "memory" | "semantic" | "source";
  version?: number;
  reason: string;
  freshnessAt?: IsoDate;
  assetRef?: AssetRef;
}

export interface ContextPackage {
  id: Id;
  taskId: Id;
  nodeId: Id;
  knowledgeLockId: Id;
  asOf: IsoDate;
  releaseIds: { global: Id; tenant?: Id; user?: Id };
  identity: { conversationId: Id; taskId: Id; runId: Id; nodeId: Id };
  task: { goal: string; intent: ResearchIntent; budget: Budget; frontierRef: FrontierRef };
  state: { taskStatus: TaskStatus; nodeStatus: NodeStatus; pendingAction?: string; pendingApprovalIds: Id[]; lastEventId?: Id; checkpointRef?: Id };
  workspace: WorkspaceProjection;
  memory: { refs: Array<{ id: Id; kind: MemoryRecord["kind"]; sourceRef: string; freshnessAt: IsoDate }> };
  knowledge: { assetRefs: AssetRef[]; releaseIds: { global: Id; tenant?: Id; user?: Id } };
  ontology: OntologyContextSlice;
  capabilities: { agentId: AgentId; assumedRoleIds: ResearchRole[]; capabilityType: TaskNode["capabilityType"]; capabilityId: string; allowedSkillIds: string[]; allowedToolIds: string[] };
  policies: { policyRefs: string[]; permissionFilterResult: { decision: "allowed" | "filtered" | "denied"; excludedRefIds: string[]; reasons: string[] } };
  references: ContextReference[];
  tokenBudget: number;
  trimmedReason?: string;
  permissionFilterResult: { decision: "allowed" | "filtered" | "denied"; excludedRefIds: string[]; reasons: string[] };
  assembledAt: IsoDate;
}

export interface MemoryRecord {
  id: Id;
  conversationId?: Id;
  kind: "preference" | "topic_index" | "validated_failure_pattern";
  content: string;
  provenanceArtifactIds: Id[];
  sourceRef: string;
  freshnessAt: IsoDate;
  reviewedAt?: IsoDate;
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

export interface SurfacePlanNode {
  id: Id;
  title: string;
  kind: string;
  capability?: string;
  dependsOn: Id[];
  frontierRef?: FrontierRef;
}

export interface ResearchPlanSurfaceData {
  intent: ResearchIntent;
  rationale: string;
  nodes: SurfacePlanNode[];
  parallelGroups: string[][];
  stopConditions: string[];
  stopPredicates?: StopPredicate[];
  problemGraph?: Pick<ResearchProblemGraph, "id" | "status" | "nodes" | "edges" | "scenarioRefs" | "taskMotifRefs" | "lensRefs">;
  lensSuggestions?: Array<{
    id: string;
    label?: string;
    reason: string;
    requiredOutputs?: string[];
    evidenceRoles?: string[];
    stopConditions?: string[];
  }>;
  principle: string;
  reportSpec?: ReportSpec;
  methodPlan?: ResearchMethodPlan;
}

export interface EvidenceMatrixSurfaceData {
  rows: EvidenceFact[];
  sufficient: boolean;
  gap?: string;
}

export interface EvidenceRequirementResult {
  evidenceRequirementRef: Id;
  judgmentUnitRef: Id;
  evidenceRole: "support" | "counter" | "boundary" | "context";
  fulfilled: boolean;
  qualifiedEvidenceCount: number;
  independentPublisherCount: number;
  stopReason?: string;
}

export interface EvidenceBasketSurfaceData {
  judgmentUnitRef: Id;
  evidenceRole: "support" | "counter" | "boundary" | "context";
  requirementResult: EvidenceRequirementResult;
  facts: EvidenceFact[];
}

export interface JudgmentBundleSurfaceData {
  units: Array<{ judgmentUnitRef: Id; judgmentArtifactRef: Id; frontierState: FrontierState; signalRoles: Record<Id, SignalRole>; blocking?: string }>;
  synthesisRule: "required units terminal";
}

export interface HypothesisCandidateSurfaceData {
  statement: string;
  falsificationConditions: string[];
  status: string;
}

export interface HypothesisMapSurfaceData {
  hypotheses: HypothesisCandidateSurfaceData[];
  status?: string;
}

export interface JudgmentSurfaceData {
  statement: string;
  confidence?: string;
  epistemicStatus?: EpistemicStatus;
  lifecycleStatus?: JudgmentLifecycleStatus;
  disposition?: string;
  evidenceRefs?: string[];
  methodApplicationRefs?: string[];
  methodGateStatus?: MethodGateStatus;
  judgmentType?: JudgmentType;
  judgmentLevel?: "J0" | "J1" | "J2" | "J3" | "J4";
  thresholdEvaluation?: import("@/src/governance/judgment-threshold").JudgmentThresholdEvaluation;
  signalInputs?: Array<{ evidenceFactRef: string; statement: string; evidenceRoles: EvidenceRole[] }>;
  signalRoles?: Record<string, SignalRole>;
  reasoningRule?: { ruleRef: string; conditions: Array<{ id: string; label: string; passed: boolean }> };
  reasoningChain?: {
    judgmentUnitRef: string;
    hypothesisRef: string;
    signalRefs: string[];
    ruleEvaluationRef: string;
    traceRef: string;
  };
  supersedesReasoningTraceRef?: string;
  modelReasoning?: { fingerprint?: string; summary: string; status: "candidate_only" };
  changeConditions: string[];
  ontologyJudgmentRef?: string;
  supersedesOntologyJudgmentRef?: string;
}

export interface ReportSection {
  key: ReportSectionKey;
  title: string;
  status: "ready" | "limited" | "not_applicable";
  paragraphs: string[];
  bullets: string[];
  sourceIds: string[];
  methodApplicationIds?: string[];
  evidenceFactIds?: string[];
  missingInputs?: string[];
  modelDraft?: { provider: string; model: string; fingerprint: string };
}

export type ReportDisciplineMetricStatus = typeof DOMAIN_CATALOG.evaluation.reportQuality.runtime_discipline_diagnostics.statuses[number];

export interface ReportDisciplineMetric {
  id:
    | "citation_provenance"
    | "requested_section_coverage"
    | "method_traceability"
    | "evidence_lineage"
    | "change_condition_operability"
    | "personalization_traceability"
    | "model_drafting_boundary"
    | "abstention_discipline";
  label: string;
  status: ReportDisciplineMetricStatus;
  numerator?: number;
  denominator?: number;
  note: string;
}

export interface FormalResearchValueReadiness {
  framework: "R/U/delta/S/C";
  status: "eligible" | "not_eligible";
  missingPrerequisites: string[];
  protocolRef: string;
  claimBoundary: string;
}

export interface ReportQualityEvaluation {
  kind: "runtime_discipline_diagnostics";
  version: "1.0.0";
  disciplineStatus: "passed" | "attention";
  metrics: ReportDisciplineMetric[];
  formalResearchValue: FormalResearchValueReadiness;
}

export interface ReportSurfaceData {
  summary: string;
  boundary?: string;
  claims?: Array<{ text: string; sourceIds: string[] }>;
  ontologyDeliverableRef?: string;
  reportSpec?: ReportSpec;
  sections?: ReportSection[];
  methodApplications?: MethodApplication[];
  qualityEvaluation?: ReportQualityEvaluation;
  publication?: {
    status: "verified_not_published" | "published";
    ontologyDeliverableRef: string;
    publishedAt?: IsoDate;
    publicationNote?: string;
  };
  evaluationFreeze?: {
    version: "1.0.0";
    status: "frozen_for_evaluation";
    frozenAt: IsoDate;
    reportHash: string;
    evidenceBundleHash: string;
    reportArtifactVersion: number;
    evidenceArtifactId: string;
    evidenceArtifactVersion: number;
    protocolRef: string;
  };
}

export interface ClarificationSurfaceData { questions: string[] }
export interface ComparisonSurfaceData { columns: string[]; rows: Array<Record<string, string | number | null>> }
export interface ChartSurfaceData { chartType: "bar" | "line" | "area"; xKey: string; series: Array<{ key: string; label: string }>; rows: Array<Record<string, string | number | null>> }
export interface ApprovalSurfaceData { prompt: string; kind: ApprovalRequest["kind"] }
export interface BranchSurfaceData { parentTaskId: Id; revisedGoal: string }
export interface TimelineSurfaceData { eventIds: Id[] }

interface UiSurfaceBase<C extends TrustedComponentKind, D> {
  id: Id;
  component: C;
  title: string;
  data: D;
  editableFields: string[];
  artifactId?: Id;
}

export type UiSurface =
  | UiSurfaceBase<"clarification_form", ClarificationSurfaceData>
  | UiSurfaceBase<"research_plan", ResearchPlanSurfaceData>
  | UiSurfaceBase<"evidence_matrix", EvidenceMatrixSurfaceData>
  | UiSurfaceBase<"hypothesis_map", HypothesisMapSurfaceData>
  | UiSurfaceBase<"judgment_card", JudgmentSurfaceData>
  | UiSurfaceBase<"comparison_table", ComparisonSurfaceData>
  | UiSurfaceBase<"chart", ChartSurfaceData>
  | UiSurfaceBase<"report_editor", ReportSurfaceData>
  | UiSurfaceBase<"approval_card", ApprovalSurfaceData>
  | UiSurfaceBase<"branch_card", BranchSurfaceData>
  | UiSurfaceBase<"execution_timeline", TimelineSurfaceData>;

export interface Checkpoint {
  id: Id;
  taskId: Id;
  nodeId?: Id;
  status: "created" | "current" | "superseded";
  phase: "before" | "after" | "failure" | "pause";
  state: Record<string, unknown>;
  createdAt: IsoDate;
}

export * from "@/src/contracts/ontology";
export * from "@/src/contracts/evidence";
export * from "@/src/contracts/knowledge";
