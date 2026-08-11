import { NextResponse } from "next/server";
import { OntologyActionService } from "@/src/ontology/action-service";
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
    const preview = new OntologyActionService(store).preview(actionType, trustedRequest, trustedContext);
    return NextResponse.json(preview, { status: preview.eligible ? 200 : 422 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: runtimeAccessStatus(error, 400) });
  }
}
