import { DOMAIN_CATALOG } from "@/src/generated/domain-catalog";

export type Id = string;
export type IsoDate = string;
export type ActorType = "researcher" | "system" | "agent";
export const TASK_STATUS_VALUES = DOMAIN_CATALOG.contextState.state.runtime_status_projection.task_status_values;
export type TaskStatus = typeof TASK_STATUS_VALUES[number];
export const NODE_STATUS_VALUES = DOMAIN_CATALOG.contextState.state.runtime_status_projection.node_status_values;
export type NodeStatus = typeof NODE_STATUS_VALUES[number];
type ActiveAgentDefinition = typeof DOMAIN_CATALOG.capabilities.agents.agents[number];
type CandidateAgentDefinition = typeof DOMAIN_CATALOG.capabilities.agents.candidates[number];
export type AgentId = ActiveAgentDefinition["agent_id"] | CandidateAgentDefinition["agent_id"];
export const RESEARCH_ROLE_VALUES = DOMAIN_CATALOG.roles.map((role) => role.role_id);
export type ResearchRole = typeof RESEARCH_ROLE_VALUES[number];
export type ResearchRunOutcome = "completed_with_judgment" | "stopped_insufficient_evidence" | "cancelled" | "failed";

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

export type ResearchSignalKind = "news" | "announcement";
export type ResearchSignalStatus = "new" | "seen" | "dismissed" | "promoted";

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

export type ResearchIntent = "full_research" | "evidence_only" | "update_judgment" | "compose_only" | "clarify";

export type ReportKind = "company_research" | "industry_research" | "thematic_research" | "evidence_update" | "judgment_update";
export type ReportAudience = "portfolio_manager" | "investment_committee" | "research_analyst" | "client";
export type ReportDepth = "brief" | "standard" | "deep";
export type ReportSectionKey =
  | "executive_summary" | "research_scope" | "core_judgments" | "evidence_analysis"
  | "business_model" | "financial_operating_analysis" | "industry_structure" | "cycle_supply_demand"
  | "competitive_landscape" | "valuation_scenarios" | "mechanism_chain" | "scenario_analysis"
  | "alternative_hypotheses" | "delta_since_prior" | "risks_change_conditions" | "source_appendix";

export type JudgmentType = keyof typeof DOMAIN_CATALOG.governance.judgmentMethodRoutes.routes;

export type EvidenceRole =
  | "demand" | "supply" | "inventory" | "price" | "utilization" | "competition"
  | "business_model" | "financial" | "expectation" | "valuation" | "mechanism" | "risk";
export type SignalRole = "support" | "weaken" | "block" | "context";

export type MethodGateStatus = "selected" | "passed" | "provisional" | "blocked" | "not_applicable";
export type MethodExecutionStatus = "candidate" | "bound" | "executed" | "blocked";

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

export type ProblemGraphNodeType =
  | "root_question"
  | "judgment_unit"
  | "hypothesis"
  | "competing_explanation"
  | "evidence_requirement"
  | "blocking_factor"
  | "synthesis";
export type FrontierState = "proposed" | "unresolved" | "active" | "resolved" | "blocked" | "indeterminate" | "invalidated" | "out_of_scope";
export type ProblemGraphRelation = "requires" | "informs" | "challenges" | "invalidates" | "aggregates" | "reuses";

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

export const ARTIFACT_KINDS = DOMAIN_CATALOG.contextState.workspace.artifact_contract.kinds;
export type ArtifactKind = typeof ARTIFACT_KINDS[number];
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

export type FinancialBasis = "reported" | "restated" | "adjusted" | "guidance" | "internal_prior" | "consensus" | "forecast";

export interface FinancialObservationValue {
  metricId: string;
  metricName?: string;
  period: { start: IsoDate; end: IsoDate };
  businessTime?: IsoDate;
  value: number;
  currency?: string;
  unit?: string;
  dimensions?: Record<string, string | number | boolean | null>;
  basis: FinancialBasis;
  sourceArtifactRef: Id;
}

export interface DeterministicFinancialOutput {
  id: string;
  label: string;
  value: number;
  unit: string;
  formula: string;
  inputObservationRefs: string[];
  scenario: "historical" | "base" | "bull" | "bear";
}

export interface FinancialReconciliationCheck {
  id: string;
  status: "passed" | "failed" | "not_testable";
  inputObservationRefs: string[];
  message: string;
  difference?: number;
  tolerance?: number;
  unit?: string;
}

export interface NormalizedFinancialsData {
  asOf: IsoDate;
  entityRef: Id;
  accountingBasis: "PRC_GAAP" | "IFRS" | "other";
  currency: string;
  unit: string;
  historicalBoundary: { start: IsoDate; end: IsoDate };
  observations: FinancialObservationValue[];
  sourceArtifactRefs: Id[];
  status: "ready" | "insufficient";
  blockers?: string[];
}

export interface FinancialModelData {
  modelScope: "historical_earnings_update" | "forecast_model";
  asOf: IsoDate;
  entityRef: Id;
  accountingBasis: NormalizedFinancialsData["accountingBasis"];
  currency: string;
  unit: string;
  historicalBoundary: { start: IsoDate; end: IsoDate };
  forecastBoundary: { start: IsoDate; end: IsoDate };
  assumptions: Array<{ id: string; value: number | string; basis: FinancialBasis | "analyst_assumption"; sourceArtifactRef?: Id }>;
  formulaDependencies: Array<{ output: string; inputs: string[] }>;
  scenarios: Array<{ id: "base" | "bull" | "bear"; assumptionIds: string[] }>;
  computedOutputs: DeterministicFinancialOutput[];
  reconciliations: FinancialReconciliationCheck[];
  audit: { passed: boolean; checks: string[]; errors: string[]; warnings: string[] };
  sourceArtifactRefs: Id[];
  status: "ready" | "blocked";
}

export interface ValuationAnalysisData {
  asOf: IsoDate;
  financialModelRef: Id;
  modelAuditRef: Id;
  currency: string;
  unit: string;
  methods: Array<"comps" | "dcf" | "sotp">;
  assumptions: string[];
  sensitivities: string[];
  status: "ready" | "blocked";
  blockers?: string[];
}

export interface ThesisStateData {
  asOf: IsoDate;
  version: number;
  pillars: Array<{ id: string; statement: string; status: "intact" | "weakened" | "blocked" | "unresolved" }>;
  signals: Array<{ direction: "strengthen" | "weaken" | "block" | "context"; sourceArtifactRef: Id; note: string }>;
  catalysts: string[];
  invalidationConditions: string[];
  openEvidenceGaps: string[];
  sourceArtifactRefs: Id[];
}

export interface SourceReference {
  sourceId: string;
  uri: string;
  title: string;
  capturedAt: IsoDate;
  locator: string;
  quote: string;
  contentHash: string;
  verification: "unverified" | "verified" | "rejected";
  sourceType?: "primary" | "secondary";
  publisherId?: string;
  publishedAt?: IsoDate;
  permissionScope?: "public_research_use" | "authorized_research_use" | "user_supplied" | "restricted";
}

export interface SourceCandidate {
  id: Id;
  uri: string;
  title: string;
  sourceType: "primary" | "secondary";
  repositoryPath?: string;
  locator?: string;
  discoveryReason: string;
  discoveredAt: IsoDate;
}

export interface SourceAcquisition {
  connectorId: string;
  upstreamSourceId: string;
  requestFingerprint: string;
  requestParameters: Record<string, unknown>;
  rawResponseHash: string;
  retrievedAt: IsoDate;
}

export interface SourceSnapshot {
  id: Id;
  candidateId: Id;
  uri: string;
  title: string;
  sourceType: "primary" | "secondary";
  repositoryPath?: string;
  locator: string;
  quote: string;
  body: string;
  contentHash: string;
  capturedAt: IsoDate;
  publishedAt?: IsoDate;
  publisherId?: string;
  permissionScope: "public_research_use" | "authorized_research_use" | "user_supplied" | "restricted";
  verification: "unverified" | "verified" | "rejected";
  acquisition: SourceAcquisition;
}

export interface EvidenceFact {
  id: Id;
  snapshotId: Id;
  statement: string;
  factType: "reported_fact" | "measurement" | "occurrence" | "forecast";
  businessTime?: IsoDate;
  confidence: "low" | "medium" | "high";
  status: "verified" | "rejected";
  evidenceRoles?: EvidenceRole[];
  createdAt: IsoDate;
}

export interface ProvenanceEdge {
  id: Id;
  fromId: Id;
  toId: Id;
  predicate: "captured_as" | "derived_from" | "supports" | "contradicts" | "included_in" | "adjudicated_into";
  createdAt: IsoDate;
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

export type ReportDisciplineMetricStatus = "passed" | "attention" | "not_applicable";

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
  phase: "before" | "after" | "failure" | "pause";
  state: Record<string, unknown>;
  createdAt: IsoDate;
}

export type OntologyActorType = "researcher" | "agent" | "system" | "ontology_admin";
export interface AccessContext {
  actorId: string;
  actorType: OntologyActorType;
  groups?: string[];
  entitlements?: string[];
  /** `public` is implicit; `internal`, `restricted` and `private` require an explicit grant. */
  accessScopes?: string[];
}
export type EpistemicStatus = "supported" | "contested" | "blocked" | "indeterminate" | "invalidated";
export type JudgmentLifecycleStatus = "proposed" | "review_required" | "approved" | "published" | "superseded";

export interface OntologyObjectRef {
  id: Id;
  type: string;
}

export interface OntologyObject extends OntologyObjectRef {
  version: number;
  status: "active" | "superseded" | "deleted";
  properties: Record<string, unknown>;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface OntologyLink {
  id: Id;
  type: string;
  sourceRef: OntologyObjectRef;
  targetRef: OntologyObjectRef;
  version: number;
  properties: Record<string, unknown>;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export type OntologyEdit =
  | { operation: "create_object"; ref: OntologyObjectRef; properties: Record<string, unknown> }
  | { operation: "update_object"; ref: OntologyObjectRef; properties: Record<string, unknown> }
  | { operation: "create_link"; id: Id; type: string; sourceRef: OntologyObjectRef; targetRef: OntologyObjectRef; properties: Record<string, unknown> };

export interface ActionContext {
  actorType: OntologyActorType;
  actorId: string;
  conversationId?: Id;
  taskId?: Id;
  access?: AccessContext;
}

export interface ActionPreviewRequest {
  targetRefs: OntologyObjectRef[];
  parameters: Record<string, unknown>;
  expectedVersions: Record<string, number>;
  idempotencyKey: string;
  knowledgeLockId?: Id;
  approvalToken?: Id;
}

export interface ActionPreview {
  actionType: string;
  actionVersion: string;
  eligible: boolean;
  errors: string[];
  warnings: string[];
  requiresApproval: boolean;
  approvalKind?: ApprovalRequest["kind"];
  edits: OntologyEdit[];
  outputRefs: OntologyObjectRef[];
  invalidatedRefs: OntologyObjectRef[];
  postCommitEffects: string[];
  catalogFingerprint: string;
}

export interface ActionExecution {
  id: Id;
  actionType: string;
  actionVersion: string;
  status: "applied" | "rejected" | "failed";
  actorType: OntologyActorType;
  actorId: string;
  conversationId?: Id;
  taskId?: Id;
  idempotencyKey: string;
  knowledgeLockId?: Id;
  approvalId?: Id;
  request: ActionPreviewRequest;
  preview: ActionPreview;
  edits: OntologyEdit[];
  outputRefs: OntologyObjectRef[];
  invalidatedRefs: OntologyObjectRef[];
  error?: string;
  createdAt: IsoDate;
  completedAt?: IsoDate;
}

export interface ActionApplyResult {
  execution: ActionExecution;
  objects: OntologyObject[];
  links: OntologyLink[];
  queuedTaskIds: Id[];
  reused: boolean;
}

export type RuntimeJobKind =
  | "execute"
  | "resume"
  | "mine_assets"
  | "evaluate_candidate"
  | "publish_release"
  | "rebuild_knowledge_index";

export type KnowledgeScope =
  | { kind: "global" }
  | { kind: "tenant"; tenantId: string }
  | { kind: "user"; tenantId: string; userId: string };

export type AssetKind =
  | "temporal_fact"
  | "ontology"
  | "dictionary"
  | "data_mapping"
  | "source_profile"
  | "method"
  | "rule"
  | "prompt"
  | "template"
  | "workflow"
  | "case"
  | "eval_case"
  | "failure_pattern"
  | "skill"
  | "preference"
  | "topic_index";

export interface AssetRef {
  assetId: Id;
  kind: AssetKind;
  identityKey?: string;
  scope: KnowledgeScope;
  version: number;
  fingerprint: string;
  authorityRef?: string;
}

export interface KnowledgeLock {
  id: Id;
  taskId: Id;
  scope: KnowledgeScope;
  globalReleaseId: Id;
  tenantReleaseId?: Id;
  userReleaseId?: Id;
  userMemoryVersion?: number;
  asOf: IsoDate;
  assetRefs: AssetRef[];
  fingerprint: string;
  createdAt: IsoDate;
}

export interface AssetRevision {
  id: Id;
  assetId: Id;
  kind: AssetKind;
  scope: KnowledgeScope;
  version: number;
  status: "candidate" | "released" | "deprecated";
  content: Record<string, unknown>;
  contentRef?: string;
  fingerprint: string;
  provenanceRefs: string[];
  validFrom?: IsoDate;
  validTo?: IsoDate;
  supersedes: Id[];
  createdAt: IsoDate;
}

export type CandidateOperation = "add" | "modify" | "split" | "merge" | "deprecate" | "monitor" | "reject" | "no_op";
export type CandidateStatus =
  | "observed"
  | "normalized"
  | "proposed"
  | "evaluating"
  | "review_required"
  | "approved"
  | "rejected"
  | "released"
  | "superseded"
  | "monitor";

export interface MiningRun {
  id: Id;
  taskId: Id;
  status: "queued" | "running" | "completed" | "failed";
  extractorVersion: string;
  knowledgeLockId: Id;
  candidateCount: number;
  error?: string;
  startedAt?: IsoDate;
  completedAt?: IsoDate;
  createdAt: IsoDate;
}

export interface AssetCandidate {
  id: Id;
  miningRunId: Id;
  taskId: Id;
  scope: KnowledgeScope;
  assetKind: AssetKind;
  operation: CandidateOperation;
  identityKey: string;
  targetAssetRef?: AssetRef;
  proposedRevisionId: Id;
  provenanceRefs: string[];
  runBaselineFingerprint: string;
  currentBaselineFingerprint: string;
  riskLevel: 0 | 1 | 2 | 3;
  confidence: number;
  novelty: number;
  conflicts: string[];
  status: CandidateStatus;
  evaluationSummary?: EvaluationSummary;
  decisionNote?: string;
  reviewedBy?: string;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface CandidateOccurrence {
  id: Id;
  candidateId: Id;
  taskId: Id;
  artifactId?: Id;
  eventSequence?: number;
  observedAt: IsoDate;
}

export interface CandidateDecision {
  id: Id;
  candidateId: Id;
  reviewer: string;
  reviewerRole: "governance_owner" | "ontology_steward" | "method_owner" | "runtime_owner" | "independent_reviewer";
  decision: "approved" | "rejected";
  note: string;
  createdAt: IsoDate;
}

export interface EvaluationCase {
  id: Id;
  scope: KnowledgeScope;
  sourceTaskId: Id;
  name: string;
  inputSnapshot: Record<string, unknown>;
  assertions: Array<{ metric: string; operator: "gte" | "lte" | "eq"; expected: number | string | boolean }>;
  status: "candidate" | "active" | "retired";
  deidentified: boolean;
  createdAt: IsoDate;
}

export interface EvaluationSummary {
  passed: boolean;
  scoreDelta: number;
  severeRegressions: number;
  metrics: Record<string, number>;
}

export interface EvaluationRun {
  id: Id;
  candidateId: Id;
  status: "running" | "passed" | "failed";
  protocol?: "knowledge_candidate" | "research_value";
  caseIds: Id[];
  baselineReleaseId: Id;
  frozenInputHash?: string;
  systemArtifactHash?: string;
  baselineArtifacts?: Array<{ track: "direct_qa" | "evidence_summary"; artifactHash: string }>;
  judgeVersions?: Array<{ provider: string; model: string; calibrationLevel: string }>;
  comparableCaseCount?: number;
  blindWinRate?: number;
  formalScoreEligible?: boolean;
  summary: EvaluationSummary;
  createdAt: IsoDate;
  completedAt?: IsoDate;
}

/** A frozen, case-level run for research-value evaluation; separate from knowledge-candidate EvaluationRun. */
export interface ResearchEvaluationRun {
  id: Id;
  caseId: string;
  protocolVersion: string;
  status: "prepared" | "running" | "completed" | "invalid";
  taskInputHash: string;
  evidenceBundleHash: string;
  systemArtifact: { ref: string; artifactHash: string; frozenAt: IsoDate };
  baselineArtifacts: Array<{ track: "direct_qa" | "evidence_summary"; ref: string; artifactHash: string; modelId?: string }>;
  judgeVersions: Array<{ provider: string; model: string; calibrationLevel?: string; calibrationRef?: string; calibrationHash?: string }>;
  formalScoreEligible: boolean;
  metrics: Record<string, number>;
  notes: string[];
  createdAt: IsoDate;
  completedAt?: IsoDate;
}

export interface AssetRelease {
  id: Id;
  scope: KnowledgeScope;
  parentReleaseId?: Id;
  rollbackOfReleaseId?: Id;
  status: "building" | "current" | "superseded" | "failed";
  candidateIds: Id[];
  assetRefs: AssetRef[];
  fingerprint: string;
  createdBy: string;
  createdAt: IsoDate;
}

export interface UsageObservation {
  id: Id;
  taskId: Id;
  assetRef: AssetRef;
  selectedReason: string;
  outcome: "selected" | "used" | "helpful" | "regression";
  observedAt: IsoDate;
}

export interface TemporalFact {
  subjectRef: string;
  predicate: string;
  value: unknown;
  validFrom?: IsoDate;
  validTo?: IsoDate;
  recordedAt: IsoDate;
  sourceRefs: string[];
  applicabilityScope: string;
  supersedes: string[];
  confidence: number;
}

export interface KnowledgeMiningContext {
  task: Task;
  conversation: Conversation;
  artifacts: Artifact[];
  events: RunEvent[];
  knowledgeLock: KnowledgeLock;
}

export interface KnowledgeMinerOutput {
  assetKind: AssetKind;
  identityKey: string;
  content: Record<string, unknown>;
  provenanceRefs: string[];
  confidence: number;
  suggestedOperation?: CandidateOperation;
  riskLevel: 0 | 1 | 2 | 3;
  validFrom?: IsoDate;
  validTo?: IsoDate;
}

export interface KnowledgeMiner {
  id: string;
  version: string;
  mine(context: KnowledgeMiningContext): KnowledgeMinerOutput[];
}
