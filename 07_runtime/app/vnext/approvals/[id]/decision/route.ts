import { NextResponse } from "next/server";
import { AgentKernel } from "@/src/runtime/kernel";
import { getRuntimeStore } from "@/src/runtime/store";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json() as { decision?: "approved" | "rejected"; note?: string };
    if (!body.decision || !["approved", "rejected"].includes(body.decision)) return NextResponse.json({ error: "decision must be approved or rejected" }, { status: 400 });
    return NextResponse.json(new AgentKernel(getRuntimeStore()).decideApproval(id, body.decision, body.note));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
