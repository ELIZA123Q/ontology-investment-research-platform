import { DOMAIN_CATALOG } from "@/src/generated/domain-catalog";
import type { Artifact } from "@/src/contracts/evidence";
import type {
  Conversation,
  Id,
  IsoDate,
  RunEvent,
  Task,
} from "@/src/contracts";

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

export type CandidateOperation =
  typeof DOMAIN_CATALOG.governance.knowledgePromotion.candidate_operations[number];
export type CandidateStatus =
  typeof DOMAIN_CATALOG.contextState.lifecycle.state_machines.KnowledgeCandidate.states[number];

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
  reviewerRole:
    | "governance_owner"
    | "ontology_steward"
    | "method_owner"
    | "runtime_owner"
    | "independent_reviewer";
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
  assertions: Array<{
    metric: string;
    operator: "gte" | "lte" | "eq";
    expected: number | string | boolean;
  }>;
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
  baselineArtifacts?: Array<{
    track: "direct_qa" | "evidence_summary";
    artifactHash: string;
  }>;
  judgeVersions?: Array<{
    provider: string;
    model: string;
    calibrationLevel: string;
  }>;
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
  baselineArtifacts: Array<{
    track: "direct_qa" | "evidence_summary";
    ref: string;
    artifactHash: string;
    modelId?: string;
  }>;
  judgeVersions: Array<{
    provider: string;
    model: string;
    calibrationLevel?: string;
    calibrationRef?: string;
    calibrationHash?: string;
  }>;
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
