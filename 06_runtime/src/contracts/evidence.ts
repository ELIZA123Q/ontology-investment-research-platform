import { DOMAIN_CATALOG } from "@/src/generated/domain-catalog";
import type { Id, IsoDate } from "@/src/contracts";

export type EvidenceRole =
  typeof DOMAIN_CATALOG.reportGeneration.evidence_role_values[number];
export const ARTIFACT_KINDS =
  DOMAIN_CATALOG.contextState.workspace.artifact_contract.kinds;
export type ArtifactKind = typeof ARTIFACT_KINDS[number];
export type FinancialBasis =
  typeof DOMAIN_CATALOG.companyFundamentalSemantics.measurement_context.runtime_financial_basis_projection.values[number];

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
  assumptions: Array<{
    id: string;
    value: number | string;
    basis: FinancialBasis | "analyst_assumption";
    sourceArtifactRef?: Id;
  }>;
  formulaDependencies: Array<{ output: string; inputs: string[] }>;
  scenarios: Array<{
    id: "base" | "bull" | "bear";
    assumptionIds: string[];
  }>;
  computedOutputs: DeterministicFinancialOutput[];
  reconciliations: FinancialReconciliationCheck[];
  audit: {
    passed: boolean;
    checks: string[];
    errors: string[];
    warnings: string[];
  };
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
  pillars: Array<{
    id: string;
    statement: string;
    status: "intact" | "weakened" | "blocked" | "unresolved";
  }>;
  signals: Array<{
    direction: "strengthen" | "weaken" | "block" | "context";
    sourceArtifactRef: Id;
    note: string;
  }>;
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
  permissionScope?:
    | "public_research_use"
    | "authorized_research_use"
    | "user_supplied"
    | "restricted";
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

/** Full raw document fingerprint; separate from the captured excerpt body hash. */
export interface SourceDocumentAttestation {
  rawContentHash: string;
  byteLength: number;
  mimeType: string;
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
  permissionScope:
    | "public_research_use"
    | "authorized_research_use"
    | "user_supplied"
    | "restricted";
  documentAttestation?: SourceDocumentAttestation;
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
  predicate:
    | "captured_as"
    | "derived_from"
    | "supports"
    | "contradicts"
    | "included_in"
    | "adjudicated_into";
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
