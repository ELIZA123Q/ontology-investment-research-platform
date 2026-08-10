import { NextResponse } from "next/server";
import { OntologyActionService } from "@/src/ontology/action-service";
import { parseActionHttpBody } from "@/src/ontology/http-contract";
import { getRuntimeStore } from "@/src/runtime/store";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ actionType: string }> }) {
  try {
    const { actionType } = await context.params;
    const body = parseActionHttpBody(await request.json());
    const preview = new OntologyActionService(getRuntimeStore()).preview(actionType, body.request, body.context);
    return NextResponse.json(preview, { status: preview.eligible ? 200 : 422 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
