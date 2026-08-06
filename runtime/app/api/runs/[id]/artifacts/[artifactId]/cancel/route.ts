import { getArtifact } from "@/storage/db";
import { cancelGeneration } from "@/workflow/stage_transitions";

export const runtime = "nodejs";

export async function POST(_: Request, { params }: { params: Promise<{ id: string; artifactId: string }> }) {
  try {
    const { id, artifactId } = await params;
    const artifact = getArtifact(artifactId);
    if (!artifact || artifact.run_id !== id) return Response.json({ error: "本阶段结果不存在" }, { status: 404 });
    return Response.json(cancelGeneration(artifactId));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
