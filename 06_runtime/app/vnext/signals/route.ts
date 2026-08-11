import { NextResponse } from "next/server";
import { getRuntimeStore } from "@/src/runtime/store";
import { assertConversationAccess, listAccessibleConversations, runtimeAccessStatus } from "@/src/security/runtime-access";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const store = getRuntimeStore();
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const conversationId = url.searchParams.get("conversationId") || undefined;
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 30), 1), 100);
    const allowed = new Set(["new", "seen", "dismissed", "promoted"]);
    if (conversationId) assertConversationAccess(store, request, conversationId);
    const accessible = new Set(listAccessibleConversations(store, request).map((conversation) => conversation.id));
    const candidates = store.listSignalCandidates({
      status: status && allowed.has(status) ? status as "new" | "seen" | "dismissed" | "promoted" : undefined,
      conversationId,
      limit: 100,
    }).filter((candidate) => accessible.has(candidate.conversationId)).slice(0, Number.isFinite(limit) ? limit : 30);
    return NextResponse.json(candidates);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: runtimeAccessStatus(error, 400) });
  }
}
