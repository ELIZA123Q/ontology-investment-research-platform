import { NextResponse } from "next/server";
import { adminError, assertInternalAdmin } from "@/src/knowledge/admin-auth";
import { KnowledgeLearningService } from "@/src/knowledge/service";
import { getRuntimeStore } from "@/src/runtime/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertInternalAdmin(request);
    return NextResponse.json(getRuntimeStore().listReleases());
  } catch (error) {
    const result = adminError(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}

export async function POST(request: Request) {
  try {
    assertInternalAdmin(request);
    const body = await request.json() as { action?: "publish" | "rollback"; candidateIds?: string[]; releaseId?: string; createdBy?: string };
    if (!body.createdBy?.trim()) return NextResponse.json({ error: "createdBy is required" }, { status: 400 });
    const store = getRuntimeStore();
    if (body.action === "rollback") {
      if (!body.releaseId) return NextResponse.json({ error: "releaseId is required for rollback" }, { status: 400 });
      return NextResponse.json(store.rollbackRelease({ releaseId: body.releaseId, createdBy: body.createdBy.trim() }), { status: 201 });
    }
    if (!body.candidateIds?.length) return NextResponse.json({ error: "candidateIds are required for publish" }, { status: 400 });
    return NextResponse.json(new KnowledgeLearningService(store).publishCandidates(body.candidateIds, body.createdBy.trim()), { status: 201 });
  } catch (error) {
    const result = adminError(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
