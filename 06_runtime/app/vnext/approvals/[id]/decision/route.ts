import { NextResponse } from "next/server";
import { AgentKernel } from "@/src/runtime/kernel";
import { ApprovalDecisionConflictError, getRuntimeStore } from "@/src/runtime/store";
import { assertApprovalAccess, runtimeAccessStatus } from "@/src/security/runtime-access";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const store = getRuntimeStore();
    assertApprovalAccess(store, request, id);
    const body = await request.json() as { decision?: "approved" | "rejected"; note?: string };
    if (!body.decision || !["approved", "rejected"].includes(body.decision)) return NextResponse.json({ error: "decision must be approved or rejected" }, { status: 400 });
    return NextResponse.json(new AgentKernel(store).decideApproval(id, body.decision, body.note));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: runtimeAccessStatus(error, error instanceof ApprovalDecisionConflictError ? 409 : 400) });
  }
}
