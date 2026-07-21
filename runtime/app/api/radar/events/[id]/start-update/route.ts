import { startEventUpdate } from "@/engine/market_radar";
import type { ImpactClassification } from "@/engine/types";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const classification = body.impact_classification
      ? String(body.impact_classification) as ImpactClassification
      : undefined;
    if (classification && !["evidence_update", "structure_revision", "scope_revision"].includes(classification)) {
      return Response.json({ error: "影响分类无效" }, { status: 400 });
    }
    const child = startEventUpdate(id, body.run_id ? String(body.run_id) : undefined, classification);
    return Response.json(child, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
