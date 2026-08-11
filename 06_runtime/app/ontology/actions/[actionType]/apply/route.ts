import { NextResponse } from "next/server";
import { ActionRejectedError, OntologyActionService } from "@/src/ontology/action-service";
import { parseActionHttpBody } from "@/src/ontology/http-contract";
import { getRuntimeStore } from "@/src/runtime/store";
import { assertOntologyObjectAccess, runtimeAccessStatus, trustedActionContext } from "@/src/security/runtime-access";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ actionType: string }> }) {
  try {
    const { actionType } = await context.params;
    const body = parseActionHttpBody(await request.json());
    const store = getRuntimeStore();
    const trustedContext = trustedActionContext(store, request, body.context);
    for (const ref of body.request.targetRefs) assertOntologyObjectAccess(store, request, ref);
    const trustedRequest = actionType === "CreateResearchCase" ? { ...body.request, parameters: { ...body.request.parameters, conversationRef: trustedContext.conversationId } } : body.request;
    return NextResponse.json(new OntologyActionService(store).apply(actionType, trustedRequest, trustedContext), { status: 201 });
  } catch (error) {
    if (error instanceof ActionRejectedError) return NextResponse.json(error.preview, { status: 422 });
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: runtimeAccessStatus(error, 400) });
  }
}
