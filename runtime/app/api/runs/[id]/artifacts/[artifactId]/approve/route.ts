import { getArtifact } from "@/adapters/db";
import { approve, validateStage02ForApproval } from "@/engine/workflow";

export const runtime = "nodejs";
export const maxDuration = 800;

export async function POST(_: Request, { params }: { params: Promise<{ id: string; artifactId: string }> }) {
  try {
    const { id, artifactId } = await params;
    const artifact = getArtifact(artifactId);
    if (!artifact || artifact.run_id !== id) {
      return Response.json({ error: "本阶段结果不存在" }, { status: 404 });
    }
    if (artifact.kind === "stage_02") {
      const validation = await validateStage02ForApproval(id);
      if (!validation.ok) {
        return Response.json({
          error: "确认前校验未通过，请先采纳建议或返回修改",
          validation,
        }, { status: 400 });
      }
    }
    return Response.json(approve(artifactId));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
