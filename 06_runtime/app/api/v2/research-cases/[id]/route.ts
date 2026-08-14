import { NextResponse } from "next/server";
import { getRuntimeStore } from "@/src/runtime/store";
import { ResearchCaseService } from "@/src/runtime-v2/research-case-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return NextResponse.json(new ResearchCaseService(getRuntimeStore()).snapshot(id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 404 });
  }
}
