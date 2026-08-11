import { NextResponse } from "next/server";
import { AgentKernel, EvidenceIngestionConflictError } from "@/src/runtime/kernel";
import { getRuntimeStore } from "@/src/runtime/store";
import { buildResearcherMaterialResult, ResearcherMaterialError } from "@/src/tools/researcher-material";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > 250_000) throw new ResearcherMaterialError("Researcher material exceeds 250 KB", 413);
    const { id } = await context.params;
    const result = buildResearcherMaterialResult(await request.json());
    const artifact = new AgentKernel(getRuntimeStore()).ingestExternalSource(id, result);
    return NextResponse.json({ artifactId: artifact.id, artifactVersion: artifact.version, taskId: artifact.taskId, status: "captured_for_evidence_review" }, { status: 202 });
  } catch (error) {
    const status = error instanceof ResearcherMaterialError ? error.status : error instanceof EvidenceIngestionConflictError ? 409 : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}
