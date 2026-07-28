import { getArtifact } from "@/adapters/db";
import { validateStage02ForApproval } from "@/engine/workflow";

export const runtime = "nodejs";
export const maxDuration = 800;

export async function POST(request: Request, { params }: { params: Promise<{ id: string; artifactId: string }> }) {
  try {
    const { id, artifactId } = await params;
    const artifact = getArtifact(artifactId);
    if (!artifact || artifact.run_id !== id) {
      return Response.json({ error: "本阶段结果不存在" }, { status: 404 });
    }
    if (artifact.kind !== "stage_02") {
      return Response.json({ error: "当前仅支持 Stage02 确认前校验" }, { status: 501 });
    }
    const body = await request.json().catch(() => ({}));
    const mode = String(body.mode || "preflight");
    const validation = await validateStage02ForApproval(id, {
      applySuggestedPatch: mode === "apply_suggestions",
    });
    if (mode === "apply_suggestions" && !validation.artifact && !validation.ok) {
      return Response.json(validation, { status: 400 });
    }
    return Response.json({ ...validation, artifact_id: validation.artifact?.id || artifactId });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
