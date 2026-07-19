import { getWorkItem, updateWorkItem } from "@/adapters/db";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  try {
    const { id, itemId } = await params;
    const current = getWorkItem(itemId);
    if (!current || current.run_id !== id) return Response.json({ error: "工作项不存在" }, { status: 404 });
    const body = await request.json();
    const allowed = new Set(["pending", "approved", "rework", "dismissed"]);
    if (body.status && !allowed.has(body.status)) return Response.json({ error: "非法工作项状态" }, { status: 400 });
    const terminalDecision = body.status && body.status !== "pending";
    const note = body.note === undefined ? "" : String(body.note).trim();
    if (terminalDecision && note.length < 8) {
      return Response.json({ error: "人工决策必须留下至少 8 个字的核验记录" }, { status: 400 });
    }
    const resolution = body.resolution === undefined ? "" : String(body.resolution).trim();
    if (terminalDecision && !resolution) {
      return Response.json({ error: "人工决策必须填写 resolution" }, { status: 400 });
    }
    if (current.kind === "supplement_evidence" && body.status === "approved" && resolution !== "accepted_evidence_gap") {
      return Response.json({ error: "当前产物仍是证据缺口；只能明确记录 accepted_evidence_gap，不得伪装成已补证" }, { status: 400 });
    }
    return Response.json(updateWorkItem(itemId, {
      status: body.status,
      note: body.note === undefined ? undefined : note,
      reason: body.reason === undefined ? undefined : String(body.reason),
      resolution: body.resolution === undefined ? undefined : resolution,
    }));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
