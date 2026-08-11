import { NextResponse } from "next/server";
import { AgentKernel } from "@/src/runtime/kernel";
import { ArtifactVersionConflictError, getRuntimeStore } from "@/src/runtime/store";
import { assertArtifactAccess, runtimeAccessStatus } from "@/src/security/runtime-access";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return NextResponse.json(assertArtifactAccess(getRuntimeStore(), request, id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: runtimeAccessStatus(error, 404) });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const store = getRuntimeStore();
    assertArtifactAccess(store, request, id);
    const body = await request.json() as { expectedVersion?: number; changes?: Record<string, unknown> };
    if (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) return NextResponse.json({ error: "expectedVersion must be a positive integer" }, { status: 400 });
    if (!body.changes || typeof body.changes !== "object" || Array.isArray(body.changes)) return NextResponse.json({ error: "changes must be an object" }, { status: 400 });
    return NextResponse.json(new AgentKernel(store).reviseArtifact(id, Number(body.expectedVersion), body.changes));
  } catch (error) {
    const status = runtimeAccessStatus(error, error instanceof ArtifactVersionConflictError ? 409 : 400);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}
