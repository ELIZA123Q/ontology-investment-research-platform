import { NextResponse } from "next/server";
import type { CandidateDecision } from "@/src/contracts";
import { adminError, assertInternalAdmin } from "@/src/knowledge/admin-auth";
import { KnowledgeLearningService } from "@/src/knowledge/service";
import { getRuntimeStore } from "@/src/runtime/store";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertInternalAdmin(request);
    const { id } = await context.params;
    const body = await request.json() as { decision?: "approved" | "rejected"; reviewer?: string; reviewerRole?: CandidateDecision["reviewerRole"]; note?: string };
    if (!body.decision || !body.reviewer || !body.reviewerRole || !body.note) return NextResponse.json({ error: "decision, reviewer, reviewerRole and note are required" }, { status: 400 });
    return NextResponse.json(new KnowledgeLearningService(getRuntimeStore()).decideCandidate({ candidateId: id, decision: body.decision, reviewer: body.reviewer, reviewerRole: body.reviewerRole, note: body.note }));
  } catch (error) {
    const result = adminError(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
