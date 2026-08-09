import { NextResponse } from "next/server";
import { AgentKernel } from "@/src/runtime/kernel";
import { getRuntimeStore } from "@/src/runtime/store";

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const kernel = new AgentKernel(getRuntimeStore());
  if (!kernel.store.getConversation(id)) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  return NextResponse.json(kernel.snapshot(id));
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json() as { content?: string };
    if (!body.content?.trim()) return NextResponse.json({ error: "content is required" }, { status: 400 });
    const kernel = new AgentKernel(getRuntimeStore());
    const result = kernel.submitGoal(id, body.content.trim());
    return NextResponse.json({ ...result, snapshot: kernel.snapshot(id) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
