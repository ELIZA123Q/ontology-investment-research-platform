import type { ApprovalRequest, OntologyActorType } from "@/src/contracts";
import { DOMAIN_CATALOG } from "@/src/generated/domain-catalog";

type GlobalInvariant = { id: string; effect: "deny" | "require_approval"; actors?: OntologyActorType[]; operations?: string[]; operation?: string; action?: string };
const invariants = DOMAIN_CATALOG.governance.permissions.global_invariants as unknown as GlobalInvariant[];

export function assertGlobalActionPermission(actionType: string, actorType: OntologyActorType): void {
  for (const invariant of invariants) {
    if (invariant.effect !== "deny" || !invariant.actors?.includes(actorType) || invariant.action !== actionType) continue;
    throw new Error(`Permission policy ${invariant.id} denies ${actorType} applying ${actionType}`);
  }
}

export function assertApprovalDecisionPermission(kind: ApprovalRequest["kind"], actorType: OntologyActorType): void {
  const operation = kind;
  for (const invariant of invariants) {
    if (invariant.effect !== "deny" || !invariant.actors?.includes(actorType) || !invariant.operations?.includes(operation)) continue;
    throw new Error(`Permission policy ${invariant.id} denies ${actorType} deciding ${kind}`);
  }
}
