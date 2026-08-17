import { ONTOLOGY_CATALOG } from "@/src/ontology/generated";
import type { ApprovalRequest, Id, IsoDate, OntologyActorType } from "@/src/contracts";

export interface AccessContext {
  actorId: string;
  actorType: OntologyActorType;
  groups?: string[];
  entitlements?: string[];
  /** `public` is implicit; `internal`, `restricted` and `private` require an explicit grant. */
  accessScopes?: string[];
}

export type EpistemicStatus =
  typeof ONTOLOGY_CATALOG.objects.Judgment.attributes.epistemic_status.allowed_values[number];
export type JudgmentLifecycleStatus =
  typeof ONTOLOGY_CATALOG.objects.Judgment.attributes.lifecycle_status.allowed_values[number];

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
  | {
      operation: "create_object";
      ref: OntologyObjectRef;
      properties: Record<string, unknown>;
    }
  | {
      operation: "update_object";
      ref: OntologyObjectRef;
      properties: Record<string, unknown>;
    }
  | {
      operation: "create_link";
      id: Id;
      type: string;
      sourceRef: OntologyObjectRef;
      targetRef: OntologyObjectRef;
      properties: Record<string, unknown>;
    };

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
