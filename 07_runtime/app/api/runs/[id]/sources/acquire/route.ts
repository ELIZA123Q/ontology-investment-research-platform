import { acquirePublicSource } from "@/skills/evidence_evaluation/source_acquisition";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const result = await acquirePublicSource(id, await request.json());
    return Response.json(result, { status: result.accepted ? 201 : 422 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
