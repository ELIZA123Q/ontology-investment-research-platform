import { NextResponse } from "next/server";
import { getRuntimeStore } from "@/src/runtime/store";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const artifact = getRuntimeStore().getArtifact(id);
  return artifact ? NextResponse.json(artifact) : NextResponse.json({ error: "Artifact not found" }, { status: 404 });
}
