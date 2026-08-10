import { NextResponse } from "next/server";
import { AgentKernel } from "@/src/runtime/kernel";
import { getRuntimeStore } from "@/src/runtime/store";
import { providerFromEnv } from "@/src/providers/model-provider";
import { requestPlannerProposal } from "@/src/runtime/model-planner";
import type { AssetRef, ReportSpecInput } from "@/src/contracts";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const kernel = new AgentKernel(getRuntimeStore());
  if (!kernel.store.getConversation(id)) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  const taskId = new URL(request.url).searchParams.get("taskId") || undefined;
  return NextResponse.json(kernel.snapshot(id, taskId));
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json() as { content?: string; pinnedAssetRefs?: AssetRef[]; reportSpec?: ReportSpecInput };
    if (!body.content?.trim()) return NextResponse.json({ error: "content is required" }, { status: 400 });
    const store = getRuntimeStore();
    const kernel = new AgentKernel(store);
    const planning = process.env.VNEXT_MODEL_PLANNING_ENABLED === "true"
      ? await requestPlannerProposal(store, providerFromEnv(), body.content.trim())
      : { attempted: false, cached: false };
    const result = kernel.submitGoal(id, body.content.trim(), planning.proposal, { pinnedAssetRefs: Array.isArray(body.pinnedAssetRefs) ? body.pinnedAssetRefs : [], reportSpec: body.reportSpec });
    if (planning.attempted) store.appendEvent({ conversationId: id, taskId: result.task.id, type: planning.error ? "planner.model_failed" : "planner.model_completed", actorType: "system", actorId: "model-planner", payload: { provider: planning.provider, model: planning.model, cached: planning.cached, usage: planning.usage, error: planning.error } });
    return NextResponse.json({ ...result, snapshot: kernel.snapshot(id) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
