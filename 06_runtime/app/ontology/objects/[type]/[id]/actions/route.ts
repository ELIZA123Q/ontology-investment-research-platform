import { NextResponse } from "next/server";
import { OntologyActionService } from "@/src/ontology/action-service";
import { getRuntimeStore } from "@/src/runtime/store";
import { assertOntologyObjectAccess, identityFromTrustedHeaders, runtimeAccessStatus } from "@/src/security/runtime-access";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ type: string; id: string }> }) {
  try {
    const { type, id } = await context.params;
    const store = getRuntimeStore();
    assertOntologyObjectAccess(store, request, { type, id });
    const identity = identityFromTrustedHeaders(request);
    const actorType = identity.roles.includes("tenant_admin") ? "ontology_admin" : "researcher";
    return NextResponse.json(new OntologyActionService(store).availableActions({ type, id }, { actorType, actorId: identity.userId }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: runtimeAccessStatus(error, 404) });
  }
}
