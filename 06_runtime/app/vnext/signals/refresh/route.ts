import { NextResponse } from "next/server";
import { getRuntimeStore } from "@/src/runtime/store";
import { listAccessibleConversations, runtimeAccessStatus } from "@/src/security/runtime-access";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const store = getRuntimeStore();
  try {
    const body = await request.json().catch(() => ({})) as { conversationIds?: string[] };
    const accessible = new Set(listAccessibleConversations(store, request).map((conversation) => conversation.id));
    const enabled = store.listEnabledTrackingProfiles().filter((profile) => accessible.has(profile.conversationId));
    const requested = new Set(Array.isArray(body.conversationIds) ? body.conversationIds : enabled.map((item) => item.conversationId));
    const profiles = enabled.filter((item) => requested.has(item.conversationId));
    const run = store.createSignalRefreshRun(profiles.map((item) => item.conversationId));
    if (!profiles.length) return NextResponse.json(store.updateSignalRefreshRun(run.id, { status: "completed", candidateCount: 0 }), { status: 202 });

    const connectorUrl = process.env.VNEXT_AKSHARE_URL?.trim();
    const token = process.env.VNEXT_INTERNAL_CONNECTOR_TOKEN?.trim();
    if (!connectorUrl || !token) {
      return NextResponse.json(store.updateSignalRefreshRun(run.id, { status: "failed", error: "AKShare connector is not configured" }), { status: 202 });
    }
    const response = await fetch(`${connectorUrl.replace(/\/$/, "")}/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-vnext-connector-token": token },
      body: JSON.stringify({
        runId: run.id,
        profiles,
        callbackUrl: `${new URL(request.url).origin}/vnext/signals/ingest`,
        callbackToken: token,
      }),
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) throw new Error(`AKShare connector rejected refresh: ${response.status}`);
    return NextResponse.json(store.updateSignalRefreshRun(run.id, { status: "running" }), { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: runtimeAccessStatus(error, 502) });
  }
}
