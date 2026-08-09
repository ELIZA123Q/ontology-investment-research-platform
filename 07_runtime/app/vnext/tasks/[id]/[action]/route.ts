import { NextResponse } from "next/server";
import { AgentKernel } from "@/src/runtime/kernel";
import { getRuntimeStore } from "@/src/runtime/store";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string; action: string }> }) {
  try {
    const { id, action } = await context.params;
    const kernel = new AgentKernel(getRuntimeStore());
    if (action === "resume") return NextResponse.json({ jobId: kernel.resumeTask(id) });
    if (action === "cancel") return NextResponse.json(kernel.cancelTask(id));
    if (action === "branch") {
      const body = await request.json().catch(() => ({})) as { goal?: string };
      return NextResponse.json(kernel.branchTask(id, body.goal), { status: 201 });
    }
    return NextResponse.json({ error: "Unknown task action" }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
