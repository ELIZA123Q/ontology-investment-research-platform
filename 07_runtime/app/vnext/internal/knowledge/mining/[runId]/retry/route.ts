import { NextResponse } from "next/server";
import { adminError, assertInternalAdmin } from "@/src/knowledge/admin-auth";
import { KnowledgeLearningService } from "@/src/knowledge/service";
import { getRuntimeStore } from "@/src/runtime/store";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    assertInternalAdmin(request);
    const { runId } = await context.params;
    return NextResponse.json({ jobId: new KnowledgeLearningService(getRuntimeStore()).retryMining(runId) }, { status: 202 });
  } catch (error) {
    const result = adminError(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
