import { NextResponse } from "next/server";
import { getWorkbenchApplication } from "@/src/application/workbench-service";
import { adminError, assertInternalAdmin } from "@/src/knowledge/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertInternalAdmin(request);
    const url = new URL(request.url);
    return NextResponse.json(getWorkbenchApplication().listKnowledgeCandidates({
      status: url.searchParams.get("status") || undefined,
      taskId: url.searchParams.get("taskId") || undefined,
    }));
  } catch (error) { const response = adminError(error); return NextResponse.json(response.body, { status: response.status }); }
}
