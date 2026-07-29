import { getWorkItem, updateWorkItem } from "@/adapters/db";
import { validateWorkItemReviewPatch } from "@/engine/work_item_review";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  try {
    const { id, itemId } = await params;
    const current = getWorkItem(itemId);
    if (!current || current.run_id !== id) return Response.json({ error: "工作项不存在" }, { status: 404 });
    const body = await request.json();
    const validation = validateWorkItemReviewPatch(current, body);
    if (!validation.ok) return Response.json({ error: validation.error }, { status: 400 });
    return Response.json(updateWorkItem(itemId, validation.patch));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
