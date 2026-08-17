import { NextResponse } from "next/server";
import { getWorkbenchApplication } from "@/src/application/workbench-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return NextResponse.json(getWorkbenchApplication().researchCaseSnapshot(id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 404 });
  }
}
