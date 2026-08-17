import { DOMAIN_CATALOG } from "@/src/generated/domain-catalog";

export type Id = string;
export type IsoDate = string;
export type OntologyActorType = typeof DOMAIN_CATALOG.governance.permissions.actor_types[number];
export type ActorType = Exclude<OntologyActorType, "ontology_admin">;

export interface ApprovalRequest {
  id: Id;
  conversationId: Id;
  taskId: Id;
  nodeId?: Id;
  kind: "risk_action" | "evidence_confirmation" | "judgment_confirmation" | "publish_confirmation" | "plan_confirmation";
  prompt: string;
  status: "pending" | "approved" | "rejected" | "superseded";
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
