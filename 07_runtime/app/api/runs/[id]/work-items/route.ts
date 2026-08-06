import { latestArtifact, listWorkItems, upsertWorkItem } from "@/storage/db";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return Response.json({ work_items: listWorkItems(id) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const targetId = String(body.target_id || "").trim();
    if (!targetId) return Response.json({ error: "缺少目标对象编号" }, { status: 400 });
    const stage = String(body.stage || "stage_03");
    if (!["stage_03", "stage_04", "independent_review"].includes(stage)) {
      return Response.json({ error: "只允许为可审阅稿件创建待办" }, { status: 400 });
    }
    const allowedKinds = new Set(["evidence_review", "judgment_review", "supplement_evidence", "resolve_conflict", "publish_blocker"]);
    if (!allowedKinds.has(String(body.kind || "evidence_review"))) {
      return Response.json({ error: "不支持的待办类型" }, { status: 400 });
    }
    const artifact = latestArtifact(id, stage as any, ["approved", "needs_review"]);
    if (!artifact) return Response.json({ error: "当前阶段没有可关联的稿件" }, { status: 409 });
    if (body.artifact_id && String(body.artifact_id) !== artifact.id) {
      return Response.json({ error: "只能关联当前阶段的最新有效稿件" }, { status: 409 });
    }
    if (body.attempt !== undefined && Number(body.attempt) !== artifact.version) {
      return Response.json({ error: "审阅任务版本与当前稿件版本不一致" }, { status: 409 });
    }
    return Response.json(upsertWorkItem({
      run_id: id,
      kind: body.kind || "evidence_review",
      stage,
      target_type: String(body.target_type || "EvidenceDraft"),
      target_id: targetId,
      title: String(body.title || `审阅 ${targetId}`),
      priority: body.priority === "high" || body.priority === "low" ? body.priority : "medium",
      reason: String(body.reason || ""),
      source_event_id: body.source_event_id ? String(body.source_event_id) : null,
      artifact_id: artifact.id,
      attempt: artifact.version,
      payload_json: JSON.stringify(body.payload || {}),
    }), { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
