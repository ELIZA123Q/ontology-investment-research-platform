import { NextResponse } from "next/server";
import { OntologyActionService } from "@/src/ontology/action-service";
import { getRuntimeStore } from "@/src/runtime/store";
import { assertResearchCaseAccess, runtimeAccessStatus } from "@/src/security/runtime-access";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const store = getRuntimeStore();
    assertResearchCaseAccess(store, request, id);
    return NextResponse.json(new OntologyActionService(store).researchCaseGraph(id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: runtimeAccessStatus(error, 404) });
  }
}
