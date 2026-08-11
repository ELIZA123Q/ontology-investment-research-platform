import { NextResponse } from "next/server";
import { getRuntimeStore } from "@/src/runtime/store";
import { assertActionExecutionAccess, runtimeAccessStatus } from "@/src/security/runtime-access";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return NextResponse.json(assertActionExecutionAccess(getRuntimeStore(), request, id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: runtimeAccessStatus(error, 404) });
  }
}
