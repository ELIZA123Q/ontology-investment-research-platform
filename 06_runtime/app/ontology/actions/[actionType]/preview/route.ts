import { NextResponse } from "next/server";
import { getWorkbenchApplication } from "@/src/application/workbench-service";
import { runtimeAccessStatus } from "@/src/security/runtime-access";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ actionType: string }> }) {
  try {
    const { actionType } = await context.params;
    const preview = getWorkbenchApplication().previewOntologyAction(actionType, request, await request.json());
    return NextResponse.json(preview, { status: preview.eligible ? 200 : 422 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: runtimeAccessStatus(error, 400) });
  }
}
