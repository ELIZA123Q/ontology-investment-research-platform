import { generateArtifact } from "@/engine/workflow";

export const runtime = "nodejs";
export const maxDuration = 800;

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const artifact = await generateArtifact((await params).id, "baseline", { background: true });
    return Response.json(artifact, { status: 202 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
