import { NextResponse } from "next/server";
import { getWorkbenchApplication } from "@/src/application/workbench-service";
import { adminError, assertInternalAdmin } from "@/src/knowledge/admin-auth";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertInternalAdmin(request);
    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    const candidate = getWorkbenchApplication().decideKnowledgeCandidate({
      candidateId: id,
      decision: String(body.decision) as "approved" | "rejected",
      reviewer: String(body.reviewer || ""),
      reviewerRole: String(body.reviewerRole) as Parameters<ReturnType<typeof getWorkbenchApplication>["decideKnowledgeCandidate"]>[0]["reviewerRole"],
      note: String(body.note || ""),
    });
    return NextResponse.json(candidate);
  } catch (error) {
    const response = adminError(error); return NextResponse.json(response.body, { status: response.status });
  }
}
