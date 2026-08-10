import { NextResponse } from "next/server";
import { AgentKernel } from "@/src/runtime/kernel";
import { ArtifactVersionConflictError, getRuntimeStore } from "@/src/runtime/store";

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const artifact = getRuntimeStore().getArtifact(id);
  return artifact ? NextResponse.json(artifact) : NextResponse.json({ error: "Artifact not found" }, { status: 404 });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json() as { expectedVersion?: number; changes?: Record<string, unknown> };
    if (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) return NextResponse.json({ error: "expectedVersion must be a positive integer" }, { status: 400 });
    if (!body.changes || typeof body.changes !== "object" || Array.isArray(body.changes)) return NextResponse.json({ error: "changes must be an object" }, { status: 400 });
    return NextResponse.json(new AgentKernel(getRuntimeStore()).reviseArtifact(id, Number(body.expectedVersion), body.changes));
  } catch (error) {
    const status = error instanceof ArtifactVersionConflictError ? 409 : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}
