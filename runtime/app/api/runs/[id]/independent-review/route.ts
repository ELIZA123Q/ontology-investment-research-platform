import { createControlledIndependentReview, generateArtifact } from "@/engine/workflow";

export const runtime = "nodejs";
export const maxDuration = 800;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = (await params).id;
    const body = await request.json().catch(() => ({}));
    if (body.mode === "human_controlled") {
      return Response.json(createControlledIndependentReview(id, body.review || {}));
    }
    const artifact = await generateArtifact(id, "independent_review", { background: true });
    return Response.json(artifact, { status: 202 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
