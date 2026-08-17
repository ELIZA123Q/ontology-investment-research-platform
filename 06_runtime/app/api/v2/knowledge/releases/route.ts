import { NextResponse } from "next/server";
import { getWorkbenchApplication } from "@/src/application/workbench-service";
import { adminError, assertInternalAdmin } from "@/src/knowledge/admin-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertInternalAdmin(request);
    const body = await request.json() as { candidateIds?: unknown; createdBy?: unknown };
    if (!Array.isArray(body.candidateIds) || !body.candidateIds.every((item) => typeof item === "string")) throw new Error("candidateIds must be a string array");
    return NextResponse.json(getWorkbenchApplication().publishKnowledgeRelease(body.candidateIds, String(body.createdBy || "knowledge-steward")), { status: 201 });
  } catch (error) {
    const response = adminError(error); return NextResponse.json(response.body, { status: response.status });
  }
}
