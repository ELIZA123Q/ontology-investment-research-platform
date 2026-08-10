import { NextResponse } from "next/server";
import { OntologyActionService } from "@/src/ontology/action-service";
import { getRuntimeStore } from "@/src/runtime/store";

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return NextResponse.json(new OntologyActionService(getRuntimeStore()).researchCaseGraph(id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 404 });
  }
}

