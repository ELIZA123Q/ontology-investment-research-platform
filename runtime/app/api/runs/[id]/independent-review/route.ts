import { generateArtifact } from "@/engine/workflow";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return Response.json(await generateArtifact((await params).id, "independent_review"));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
