import { NextResponse } from "next/server";
import { adminError, assertInternalAdmin } from "@/src/knowledge/admin-auth";
import { KnowledgeLearningService } from "@/src/knowledge/service";
import { getRuntimeStore } from "@/src/runtime/store";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertInternalAdmin(request);
    const { id } = await context.params;
    return NextResponse.json(new KnowledgeLearningService(getRuntimeStore()).evaluateCandidate(id));
  } catch (error) {
    const result = adminError(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
