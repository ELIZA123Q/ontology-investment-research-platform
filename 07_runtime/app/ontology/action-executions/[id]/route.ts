import { NextResponse } from "next/server";
import { OntologyStore } from "@/src/ontology/store";
import { getRuntimeStore } from "@/src/runtime/store";

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const execution = new OntologyStore(getRuntimeStore()).getActionExecution(id);
  return execution ? NextResponse.json(execution) : NextResponse.json({ error: "ActionExecution not found" }, { status: 404 });
}

