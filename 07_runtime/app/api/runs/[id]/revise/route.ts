import { reviseRunStage, normalizeTargetStage } from "@/workflow/stage_transitions";

export const runtime = "nodejs";
export const maxDuration = 800;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const targetStage = normalizeTargetStage(body.target_stage);
    const result = await reviseRunStage(id, targetStage, String(body.instruction || ""), {
      confirm_downstream_invalidate: Boolean(body.confirm_downstream_invalidate),
    });
    if (result.status === "needs_confirmation") {
      return Response.json(result, { status: 409 });
    }
    if (result.status === "unsupported") {
      return Response.json(result, { status: 501 });
    }
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
