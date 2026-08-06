import "server-only";
import type { ResearchWorkItem, WorkItemStatus } from "../../schemas/types";
import { db } from "./connection";
import { getRun, recordResearchExperienceEvent } from "./runs";
import { getArtifact } from "./artifacts";
type WorkItemInput = Omit<
  ResearchWorkItem,
  "id" | "status" | "note" | "artifact_id" | "attempt" | "resolution" | "created_at" | "updated_at" | "resolved_at" | "superseded_at"
> & {
  status?: WorkItemStatus;
  note?: string;
  artifact_id?: string;
  attempt?: number;
  resolution?: string;
};

function mapWorkItem(row: any): ResearchWorkItem {
  return {
    ...row,
    artifact_id: String(row.artifact_id || ""),
    attempt: Number(row.attempt || 0),
    resolution: String(row.resolution || ""),
    superseded_at: row.superseded_at ?? null,
  } as ResearchWorkItem;
}

export function upsertWorkItem(input: WorkItemInput): ResearchWorkItem {
  const artifactId = input.artifact_id || "";
  const attempt = Number(input.attempt || 0);
  if (!getRun(input.run_id)) throw new Error("工作项所属研究任务不存在");
  if (!Number.isInteger(attempt) || attempt < 0) throw new Error("工作项 attempt 必须为非负整数");
  if (artifactId) {
    const artifact = getArtifact(artifactId);
    if (!artifact || artifact.run_id !== input.run_id) throw new Error("工作项绑定的 artifact 不属于当前运行");
    if (artifact.version !== attempt) throw new Error("工作项 attempt 与 artifact 版本不一致");
    const stageMatches = artifact.kind === input.stage;
    const actionGraphBinding = input.kind === "action_review"
      && input.stage === "instance_graph"
      && artifact.kind === "instance_graph";
    const independentReviewBinding = input.kind === "publish_blocker"
      && artifact.kind === "independent_review"
      && ["stage_02", "stage_03", "stage_04"].includes(input.stage);
    if (!stageMatches && !actionGraphBinding && !independentReviewBinding) {
      throw new Error("工作项 stage 与 artifact 类型不一致");
    }
  } else if (input.kind !== "event_review" || !input.source_event_id || attempt !== 0) {
    throw new Error("除事件初筛外，工作项必须绑定具体 artifact 和 attempt");
  }
  const existing = db.prepare(`SELECT * FROM research_work_items
    WHERE run_id=? AND kind=? AND target_type=? AND target_id=? AND artifact_id=? AND attempt=?`)
    .get(input.run_id, input.kind, input.target_type, input.target_id, artifactId, attempt) as any;
  if (existing) return mapWorkItem(existing);
  const now = new Date().toISOString();
  const item: ResearchWorkItem = {
    ...input,
    id: crypto.randomUUID(),
    status: input.status || "pending",
    note: input.note || "",
    artifact_id: artifactId,
    attempt,
    resolution: input.resolution || "",
    created_at: now,
    updated_at: now,
    resolved_at: input.status && input.status !== "pending" ? now : null,
    superseded_at: input.status === "superseded" ? now : null,
  };
  db.prepare(`INSERT INTO research_work_items(
    id,run_id,kind,stage,target_type,target_id,title,status,priority,reason,note,source_event_id,
    artifact_id,attempt,payload_json,resolution,created_at,updated_at,resolved_at,superseded_at
  ) VALUES(${Array(20).fill("?").join(",")})`).run(
    item.id, item.run_id, item.kind, item.stage, item.target_type, item.target_id, item.title,
    item.status, item.priority, item.reason, item.note, item.source_event_id,
    item.artifact_id, item.attempt, item.payload_json, item.resolution,
    item.created_at, item.updated_at, item.resolved_at, item.superseded_at,
  );
  return item;
}

export function listWorkItems(runId?: string, status?: WorkItemStatus): ResearchWorkItem[] {
  let rows: any[];
  if (runId && status) rows = db.prepare("SELECT * FROM research_work_items WHERE run_id=? AND status=? ORDER BY created_at DESC").all(runId, status) as any[];
  else if (runId) rows = db.prepare("SELECT * FROM research_work_items WHERE run_id=? ORDER BY created_at DESC").all(runId) as any[];
  else if (status) rows = db.prepare("SELECT * FROM research_work_items WHERE status=? ORDER BY created_at DESC").all(status) as any[];
  else rows = db.prepare("SELECT * FROM research_work_items ORDER BY created_at DESC").all() as any[];
  return rows.map(mapWorkItem);
}

export function getWorkItem(id: string): ResearchWorkItem | undefined {
  const row = db.prepare("SELECT * FROM research_work_items WHERE id=?").get(id) as any;
  return row ? mapWorkItem(row) : undefined;
}

export function updateWorkItem(id: string, fields: { status?: WorkItemStatus; note?: string; reason?: string; resolution?: string }): ResearchWorkItem {
  const current = db.prepare("SELECT * FROM research_work_items WHERE id=?").get(id) as any;
  if (!current) throw new Error("工作项不存在");
  const status = fields.status || current.status;
  const allowedTransitions: Record<WorkItemStatus, Set<WorkItemStatus>> = {
    pending: new Set(["pending", "approved", "rework", "dismissed", "superseded"]),
    rework: new Set(["rework", "pending", "approved", "dismissed", "superseded"]),
    approved: new Set(["approved", "superseded"]),
    dismissed: new Set(["dismissed", "superseded"]),
    superseded: new Set(["superseded"]),
  };
  if (!allowedTransitions[current.status as WorkItemStatus]?.has(status)) {
    throw new Error(`工作项状态不允许从 ${current.status} 变更为 ${status}`);
  }
  const updatedAt = new Date().toISOString();
  const resolvedAt = status === "pending" || status === "rework" ? null : updatedAt;
  const supersededAt = status === "superseded" ? updatedAt : current.superseded_at;
  db.prepare("UPDATE research_work_items SET status=?,note=?,reason=?,resolution=?,updated_at=?,resolved_at=?,superseded_at=? WHERE id=?").run(
    status,
    fields.note ?? current.note,
    fields.reason ?? current.reason,
    fields.resolution ?? current.resolution ?? "",
    updatedAt,
    resolvedAt,
    supersededAt,
    id,
  );
  const updated = mapWorkItem(db.prepare("SELECT * FROM research_work_items WHERE id=?").get(id));
  if (status !== current.status && ["approved", "rework", "dismissed"].includes(status)) {
    recordResearchExperienceEvent({
      runId: updated.run_id,
      eventType: "work_item_decision",
      actorType: "human",
      stage: updated.stage,
      targetType: updated.target_type,
      targetId: updated.target_id,
      outcome: status,
      payload: { work_item_id: updated.id, kind: updated.kind, attempt: updated.attempt },
      dedupeKey: `work_item_decision:${updated.id}:${current.status}:${status}:${updatedAt}`,
      occurredAt: updatedAt,
    });
  }
  syncActionProposalFromWorkItem(updated);
  return updated;
}

export function supersedeWorkItemsForArtifact(
  runId: string,
  stage: string,
  currentArtifactId: string,
  currentAttempt: number,
  options: { includeApproved?: boolean; excludeWorkItemId?: string } = {},
) {
  const now = new Date().toISOString();
  const statuses = options.includeApproved ? "'pending','rework','approved'" : "'pending','rework'";
  const excluded = options.excludeWorkItemId || "";
  const affectedIds = (db.prepare(`SELECT id FROM research_work_items
    WHERE run_id=? AND stage=? AND status IN (${statuses}) AND id<>?
      AND (artifact_id<>? OR attempt<>?)`).all(runId, stage, excluded, currentArtifactId, currentAttempt) as Array<{ id: string }>).map((row) => row.id);
  db.prepare(`UPDATE research_work_items
    SET status='superseded',superseded_at=?,resolved_at=?,updated_at=?,resolution='artifact_regenerated'
    WHERE run_id=? AND stage=? AND status IN (${statuses}) AND id<>?
      AND (artifact_id<>? OR attempt<>?)`).run(now, now, now, runId, stage, excluded, currentArtifactId, currentAttempt);
  for (const id of affectedIds) {
    const item = getWorkItem(id);
    if (item) syncActionProposalFromWorkItem(item);
  }
}

function syncActionProposalFromWorkItem(item: ResearchWorkItem) {
  if (item.kind !== "action_review") return;
  const proposal = db.prepare("SELECT * FROM action_proposals WHERE work_item_id=?").get(item.id) as any;
  if (!proposal || proposal.status === "executed") return;
  const now = new Date().toISOString();
  if (item.status === "approved") {
    db.prepare("UPDATE action_proposals SET status='approved',approved_at=? WHERE id=?").run(now, proposal.id);
  } else if (item.status === "dismissed") {
    db.prepare("UPDATE action_proposals SET status='rejected',approved_at=NULL WHERE id=?").run(proposal.id);
  } else if (item.status === "superseded") {
    db.prepare("UPDATE action_proposals SET status='superseded',approved_at=NULL WHERE id=?").run(proposal.id);
  } else {
    db.prepare("UPDATE action_proposals SET status='pending',approved_at=NULL WHERE id=?").run(proposal.id);
  }
}
