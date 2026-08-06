import { getArtifact } from "@/storage/db";
import { editArtifact } from "@/workflow/stage_transitions";

export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; artifactId: string }> }) {
  try {
    const { id, artifactId } = await params;
    const artifact = getArtifact(artifactId);
    if (!artifact || artifact.run_id !== id) return Response.json({ error: "稿件不存在" }, { status: 404 });
    const body = await req.json();
    const { json_content, markdown_content, prefer_markdown } = body;
    return Response.json(editArtifact(artifactId, json_content, markdown_content, {
      preferMarkdown: Boolean(prefer_markdown),
    }));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
