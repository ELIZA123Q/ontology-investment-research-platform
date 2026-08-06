import { getWorkItem, latestArtifact, listWorkItems, updateWorkItem, upsertWorkItem } from "@/storage/db";
import { validateWorkItemReviewPatch } from "@/runner/work_item_review";
import type { WorkItemStatus } from "@/schemas/types";

export const runtime = "nodejs";

type BatchItem = {
  item_id?: string;
  target_id?: string;
  status: WorkItemStatus;
  note: string;
  resolution: string;
  kind?: string;
  title?: string;
  reason?: string;
  priority?: string;
  payload?: unknown;
};

function workItemForTarget(runId: string, targetId: string) {
  return listWorkItems(runId).find((item) =>
    item.target_id === targetId
    && ["evidence_review", "supplement_evidence", "resolve_conflict"].includes(item.kind),
  );
}

function ensureWorkItem(runId: string, item: BatchItem, evidenceKind?: string) {
  if (item.item_id) {
    const existing = getWorkItem(String(item.item_id));
    if (!existing || existing.run_id !== runId) throw new Error(`工作项不存在: ${item.item_id}`);
    return existing;
  }
  const targetId = String(item.target_id || "").trim();
  if (!targetId) throw new Error("批量项缺少 target_id 或 item_id");
  const current = workItemForTarget(runId, targetId);
  if (current) return current;
  const artifact = latestArtifact(runId, "stage_03", ["approved", "needs_review"]);
  if (!artifact) throw new Error("当前没有可关联的 Stage03 稿件");
  const kind = evidenceKind === "gap"
    ? "supplement_evidence"
    : evidenceKind === "conflict"
      ? "resolve_conflict"
      : "evidence_review";
  return upsertWorkItem({
    run_id: runId,
    kind,
    stage: "stage_03",
    target_type: "EvidenceDraft",
    target_id: targetId,
    title: String(item.title || `审阅 ${targetId}`),
    priority: item.priority === "high" || item.priority === "low" ? item.priority : "medium",
    reason: String(item.reason || ""),
    source_event_id: null,
    artifact_id: artifact.id,
    attempt: artifact.version,
    payload_json: JSON.stringify(item.payload || {}),
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const items = Array.isArray(body.items) ? body.items as BatchItem[] : [];
    if (!items.length) return Response.json({ error: "缺少批量审阅项" }, { status: 400 });

    const evidenceKinds = body.evidence_kinds && typeof body.evidence_kinds === "object"
      ? body.evidence_kinds as Record<string, string>
      : {};

    const results: Array<{ id: string; target_id?: string; ok: boolean; error?: string }> = [];
    for (const item of items) {
      try {
        const targetId = String(item.target_id || "").trim();
        const evidenceKind = targetId ? evidenceKinds[targetId] : undefined;
        const current = ensureWorkItem(id, item, evidenceKind);
        const validation = validateWorkItemReviewPatch(current, item);
        if (!validation.ok) {
          results.push({ id: current.id, target_id: current.target_id, ok: false, error: validation.error });
          continue;
        }
        updateWorkItem(current.id, validation.patch);
        results.push({ id: current.id, target_id: current.target_id, ok: true });
      } catch (error) {
        results.push({
          id: String(item.item_id || ""),
          target_id: String(item.target_id || ""),
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const ok = results.every((item) => item.ok);
    return Response.json({ ok, results }, { status: ok ? 200 : 207 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
