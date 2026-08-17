import { NextResponse } from "next/server";
import { getWorkbenchApplication, type ResearchCaseCommand } from "@/src/application/workbench-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const command = await request.json() as ResearchCaseCommand;
    return NextResponse.json(getWorkbenchApplication().executeResearchCaseCommand(id, command));
  } catch (error) {
    const typed = error as { status?: unknown; code?: unknown; message?: unknown; machine?: unknown; from?: unknown; command?: unknown };
    const status = Number.isInteger(typed?.status) ? Number(typed.status) : 400;
    return NextResponse.json({ error: {
      code: String(typed?.code || (status === 409 ? "command_conflict" : "invalid_command")),
      message: error instanceof Error ? error.message : String(error),
      details: { machine: typed?.machine, from: typed?.from, command: typed?.command },
    } }, { status });
  }
}
