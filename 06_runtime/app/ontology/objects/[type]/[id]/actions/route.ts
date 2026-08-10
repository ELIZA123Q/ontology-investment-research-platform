import { NextResponse } from "next/server";
import type { OntologyActorType } from "@/src/contracts";
import { OntologyActionService } from "@/src/ontology/action-service";
import { getRuntimeStore } from "@/src/runtime/store";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ type: string; id: string }> }) {
  try {
    const { type, id } = await context.params;
    const url = new URL(request.url);
    const actorType = (url.searchParams.get("actorType") || "researcher") as OntologyActorType;
    const actorId = url.searchParams.get("actorId") || "researcher";
    return NextResponse.json(new OntologyActionService(getRuntimeStore()).availableActions({ type, id }, { actorType, actorId }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 404 });
  }
}

