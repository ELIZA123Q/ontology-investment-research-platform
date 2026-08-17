import { NextResponse } from "next/server";
import { getWorkbenchApplication } from "@/src/application/workbench-service";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const artifact = getWorkbenchApplication().getArtifact(id);
  return artifact ? NextResponse.json(artifact) : NextResponse.json({ error: "Artifact not found" }, { status: 404 });
}
