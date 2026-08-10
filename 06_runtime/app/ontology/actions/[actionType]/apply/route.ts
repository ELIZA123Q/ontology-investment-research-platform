import { NextResponse } from "next/server";
import { ActionRejectedError, OntologyActionService } from "@/src/ontology/action-service";
import { parseActionHttpBody } from "@/src/ontology/http-contract";
import { getRuntimeStore } from "@/src/runtime/store";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ actionType: string }> }) {
  try {
    const { actionType } = await context.params;
    const body = parseActionHttpBody(await request.json());
    return NextResponse.json(new OntologyActionService(getRuntimeStore()).apply(actionType, body.request, body.context), { status: 201 });
  } catch (error) {
    if (error instanceof ActionRejectedError) return NextResponse.json(error.preview, { status: 422 });
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
