import { NextResponse } from "next/server";
import { getRuntimeStore } from "@/src/runtime/store";
import { CaseCommandConflictError, CaseVersionConflictError, ResearchCaseService, type ResearchCaseCommand } from "@/src/runtime-v2/research-case-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const command = await request.json() as ResearchCaseCommand;
    return NextResponse.json(new ResearchCaseService(getRuntimeStore()).execute(id, command));
  } catch (error) {
    const typed = error as { status?: unknown; code?: unknown; message?: unknown; machine?: unknown; from?: unknown; command?: unknown };
    const status = error instanceof CaseVersionConflictError || error instanceof CaseCommandConflictError
      ? 409 : Number.isInteger(typed?.status) ? Number(typed.status) : 400;
    return NextResponse.json({ error: {
      code: String(typed?.code || (status === 409 ? "command_conflict" : "invalid_command")),
      message: error instanceof Error ? error.message : String(error),
      details: { machine: typed?.machine, from: typed?.from, command: typed?.command },
    } }, { status });
  }
}
