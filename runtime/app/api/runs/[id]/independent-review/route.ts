import { createControlledIndependentReview, generateArtifact } from "@/engine/workflow";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = (await params).id;
    const body = await request.json().catch(() => ({}));
    if (body.mode === "human_controlled") return Response.json(createControlledIndependentReview(id, body.review || {}));
    return Response.json(await generateArtifact(id, "independent_review"));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
