import { NextResponse } from "next/server";
import { getRuntimeStore } from "@/src/runtime/store";
import { identityFromTrustedHeaders } from "@/src/security/runtime-access";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const identity = identityFromTrustedHeaders(request);
  return NextResponse.json(getRuntimeStore().listConversations().filter((conversation) => conversation.tenantId === identity.tenantId && conversation.userId === identity.userId));
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { title?: string };
  const identity = identityFromTrustedHeaders(request);
  return NextResponse.json(getRuntimeStore().createConversation(body.title?.trim() || "新的研究主题", identity), { status: 201 });
}
