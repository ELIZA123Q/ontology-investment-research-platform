import { NextResponse } from "next/server";
import { getRuntimeStore } from "@/src/runtime/store";
import { assertConversationAccess, runtimeAccessStatus } from "@/src/security/runtime-access";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    assertConversationAccess(getRuntimeStore(), request, id);
    return NextResponse.json(getRuntimeStore().getTrackingProfile(id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: runtimeAccessStatus(error, 404) });
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    assertConversationAccess(getRuntimeStore(), request, id);
    const body = await request.json() as { enabled?: boolean; symbols?: unknown; keywords?: unknown };
    if (!Array.isArray(body.symbols) || !Array.isArray(body.keywords)) return NextResponse.json({ error: "symbols and keywords must be arrays" }, { status: 400 });
    return NextResponse.json(getRuntimeStore().putTrackingProfile({
      conversationId: id,
      enabled: body.enabled !== false,
      symbols: body.symbols.map(String),
      keywords: body.keywords.map(String),
    }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: runtimeAccessStatus(error, 400) });
  }
}
