import { NextResponse } from "next/server";
import { AgentKernel } from "@/src/runtime/kernel";
import { getRuntimeStore } from "@/src/runtime/store";
import { providerFromEnv } from "@/src/providers/model-provider";
import { requestPlannerProposal } from "@/src/runtime/model-planner";
import type { AssetRef, ReportSpecInput } from "@/src/contracts";
import { assertConversationAccess, assertTaskAccess, identityFromTrustedHeaders, runtimeAccessStatus } from "@/src/security/runtime-access";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const kernel = new AgentKernel(getRuntimeStore());
    assertConversationAccess(kernel.store, request, id);
    const taskId = new URL(request.url).searchParams.get("taskId") || undefined;
    if (taskId && assertTaskAccess(kernel.store, request, taskId).conversationId !== id) return NextResponse.json({ error: "Resource not found" }, { status: 404 });
    return NextResponse.json(kernel.snapshot(id, taskId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: runtimeAccessStatus(error, 400) });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const store = getRuntimeStore();
    assertConversationAccess(store, request, id);
    const identity = identityFromTrustedHeaders(request);
    const body = await request.json() as { content?: string; pinnedAssetRefs?: AssetRef[]; reportSpec?: ReportSpecInput };
    if (!body.content?.trim()) return NextResponse.json({ error: "content is required" }, { status: 400 });
    const kernel = new AgentKernel(store);
    const latestTask = store.getLatestTask(id);
    if (latestTask) {
      store.addMessage({ conversationId: id, actorType: "researcher", actorId: identity.userId, content: body.content.trim() });
      const task = kernel.branchTask(latestTask.id, body.content.trim());
      return NextResponse.json({ task, snapshot: kernel.snapshot(id) }, { status: 201 });
    }
    const planning = process.env.VNEXT_MODEL_PLANNING_ENABLED === "true"
      ? await requestPlannerProposal(store, providerFromEnv(), body.content.trim())
      : { attempted: false, cached: false };
    const result = kernel.submitGoal(id, body.content.trim(), planning.proposal, { pinnedAssetRefs: Array.isArray(body.pinnedAssetRefs) ? body.pinnedAssetRefs : [], reportSpec: body.reportSpec });
    if (planning.attempted) store.appendEvent({ conversationId: id, taskId: result.task.id, type: planning.error ? "planner.model_failed" : "planner.model_completed", actorType: "system", actorId: "model-planner", payload: { provider: planning.provider, model: planning.model, cached: planning.cached, usage: planning.usage, error: planning.error } });
    return NextResponse.json({ ...result, snapshot: kernel.snapshot(id) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: runtimeAccessStatus(error, 400) });
  }
}
