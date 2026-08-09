import { NextResponse } from "next/server";
import { adminError, assertInternalAdmin } from "@/src/knowledge/admin-auth";
import { getRuntimeStore } from "@/src/runtime/store";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertInternalAdmin(request);
    const { id } = await context.params;
    const body = await request.json() as { taskId?: string; version?: number; outcome?: "helpful" | "regression"; reason?: string };
    if (!body.taskId || !body.outcome || !["helpful", "regression"].includes(body.outcome) || !body.reason?.trim()) {
      return NextResponse.json({ error: "taskId, helpful|regression outcome, and reason are required" }, { status: 400 });
    }
    const store = getRuntimeStore();
    const lock = store.getKnowledgeLock(body.taskId);
    if (!lock) return NextResponse.json({ error: "Task KnowledgeLock not found" }, { status: 404 });
    const assetRef = lock.assetRefs.find((ref) => ref.assetId === id && (body.version == null || ref.version === body.version));
    if (!assetRef) return NextResponse.json({ error: "Asset was not selected by this Task KnowledgeLock" }, { status: 409 });
    return NextResponse.json(store.observeAssetUsage({
      taskId: body.taskId, assetRef, outcome: body.outcome, selectedReason: body.reason.trim(),
    }), { status: 201 });
  } catch (error) {
    const result = adminError(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
