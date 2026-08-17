import { NextResponse } from "next/server";
import { ActionRejectedError } from "@/src/ontology/action-service";
import { getWorkbenchApplication } from "@/src/application/workbench-service";
import { runtimeAccessStatus } from "@/src/security/runtime-access";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ actionType: string }> }) {
  try {
    const { actionType } = await context.params;
    return NextResponse.json(getWorkbenchApplication().applyOntologyAction(actionType, request, await request.json()), { status: 201 });
  } catch (error) {
    if (error instanceof ActionRejectedError) return NextResponse.json(error.preview, { status: 422 });
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: runtimeAccessStatus(error, 400) });
  }
}
