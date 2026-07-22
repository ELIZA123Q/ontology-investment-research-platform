import type { ResearchWorkItem, WorkItemStatus } from "./types";

export type WorkItemReviewPatch = {
  status?: WorkItemStatus;
  note?: string;
  resolution?: string;
  reason?: string;
};

export function validateWorkItemReviewPatch(
  current: ResearchWorkItem,
  body: WorkItemReviewPatch,
): { ok: true; patch: { status?: WorkItemStatus; note?: string; resolution?: string; reason?: string } } | { ok: false; error: string } {
  const allowed = new Set<WorkItemStatus>(["pending", "approved", "rework", "dismissed", "superseded"]);
  if (body.status && !allowed.has(body.status)) {
    return { ok: false, error: "非法工作项状态" };
  }
  const terminalDecision = body.status && body.status !== "pending";
  const note = body.note === undefined ? "" : String(body.note).trim();
  if (terminalDecision && note.length < 8) {
    return { ok: false, error: "人工决策必须留下至少 8 个字的核验记录" };
  }
  const resolution = body.resolution === undefined ? "" : String(body.resolution).trim();
  if (terminalDecision && !resolution) {
    return { ok: false, error: "人工决策必须填写处理结论" };
  }
  if (current.kind === "supplement_evidence" && body.status === "approved" && resolution !== "accepted_evidence_gap") {
    return { ok: false, error: "当前仍是证据缺口；只能记录「接受缺口」，不能标成已补证" };
  }
  return {
    ok: true,
    patch: {
      status: body.status,
      note: body.note === undefined ? undefined : note,
      reason: body.reason === undefined ? undefined : String(body.reason),
      resolution: body.resolution === undefined ? undefined : resolution,
    },
  };
}
