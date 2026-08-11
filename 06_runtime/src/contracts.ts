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
  tenantId: string;
  userId: string;
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
  researchCaseId: Id;
  parentTaskId?: Id;
  goal: string;
  intent: ResearchIntent;
  reportSpec: ReportSpec;
  status: TaskStatus;
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

export type JudgmentType =
  | "state_measurement" | "trend_direction" | "cycle_phase" | "mechanism_validation"
  | "causal_attribution" | "transmission_path" | "object_differentiation"
  | "impact_realization" | "expectation_gap" | "valuation_impact";

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

export type ArtifactKind =
  | "research_plan"
  | "research_problem_graph"
  | "method_application"
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
  sourceType?: "primary" | "secondary";
  publisherId?: string;
  publishedAt?: IsoDate;
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

export interface SurfacePlanNode {
  id: Id;
  title: string;
  kind: string;
  capability?: string;
  dependsOn: Id[];
}

export interface ResearchPlanSurfaceData {
  intent: ResearchIntent;
  rationale: string;
  nodes: SurfacePlanNode[];
  parallelGroups: string[][];
  stopConditions: string[];
  stopPredicates?: StopPredicate[];
  problemGraph?: Pick<ResearchProblemGraph, "id" | "status" | "nodes" | "edges" | "scenarioRefs" | "taskMotifRefs">;
  principle: string;
  reportSpec?: ReportSpec;
  methodPlan?: ResearchMethodPlan;
}

export interface EvidenceMatrixSurfaceData {
  rows: EvidenceFact[];
  sufficient: boolean;
  gap?: string;
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
  caseIds: Id[];
  baselineReleaseId: Id;
  summary: EvaluationSummary;
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
