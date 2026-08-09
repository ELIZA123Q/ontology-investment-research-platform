import { NextResponse } from "next/server";
import { getRuntimeStore } from "@/src/runtime/store";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(getRuntimeStore().listConversations());
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { title?: string };
  return NextResponse.json(getRuntimeStore().createConversation(body.title?.trim() || "新的研究主题"), { status: 201 });
}
