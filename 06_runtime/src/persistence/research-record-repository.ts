import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ApprovalRequest, RunEvent } from "@/src/contracts/execution";
import type { Artifact } from "@/src/contracts/evidence";

const now = () => new Date().toISOString();
const json = (value: unknown) => JSON.stringify(value);
const parse = <T>(value: unknown, fallback: T): T => typeof value === "string" && value.length ? JSON.parse(value) as T : fallback;

type RecordTransition = { from: string; to: string; event: string };

export interface ResearchRecordRepositoryHooks {
  transaction<T>(work: () => T): T;
  transition(entity: "Artifact" | "Approval", status: string, command: string): RecordTransition;
}

export class SqliteResearchRecordRepository {
  constructor(readonly db: DatabaseSync, private readonly hooks: ResearchRecordRepositoryHooks) {}

  putArtifact<T>(input: Omit<Artifact<T>, "id" | "version" | "createdAt"> & { id?: string }): Artifact<T> {
    const id = input.id || randomUUID();
    const prior = this.db.prepare("SELECT MAX(version) AS version FROM artifacts WHERE id = ?").get(id) as { version?: number | null };
    const artifact: Artifact<T> = { ...input, id, version: Number(prior.version || 0) + 1, createdAt: now() };
    this.db.prepare("INSERT INTO artifacts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(artifact.id, artifact.version, artifact.conversationId, artifact.taskId, artifact.nodeId ?? null, artifact.kind, artifact.title, artifact.status, json(artifact.data), json(artifact.sourceRefs), artifact.createdBy, artifact.createdAt);
    this.indexText(artifact.id, "artifact", artifact.title, json(artifact.data));
    return artifact;
  }

  reviseArtifact<T>(input: {
    id: string;
    expectedVersion: number;
    data: T;
    status?: Artifact["status"];
    createdBy: string;
  }): Artifact<T> {
    return this.reviseArtifacts([input])[0] as Artifact<T>;
  }

  reviseArtifacts(inputs: Array<{
    id: string;
    expectedVersion: number;
    data: unknown;
    status?: Artifact["status"];
    createdBy: string;
  }>): Artifact[] {
    if (!inputs.length) throw new Error("At least one artifact revision is required");
    return this.hooks.transaction(() => {
      const current = inputs.map((input) => {
        const artifact = this.getArtifact(input.id);
        if (!artifact) throw new Error(`Artifact not found: ${input.id}`);
        if (artifact.version !== input.expectedVersion) throw new ArtifactVersionConflictError(input.id, input.expectedVersion, artifact.version);
        return artifact;
      });
      const revisions = inputs.map((input, index): Artifact => ({
        ...current[index],
        version: current[index].version + 1,
        data: input.data,
        status: input.status || "draft",
        createdBy: input.createdBy,
        createdAt: now(),
      }));
      const insert = this.db.prepare("INSERT INTO artifacts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const [index, artifact] of revisions.entries()) {
        const prior = current[index];
        const transition = this.hooks.transition("Artifact", prior.status, "revise");
        const superseded = this.db.prepare("UPDATE artifacts SET status=? WHERE id=? AND version=? AND status=?")
          .run(transition.to, prior.id, prior.version, transition.from);
        if (Number(superseded.changes) !== 1) throw new ArtifactVersionConflictError(prior.id, prior.version, this.getArtifact(prior.id)?.version || prior.version);
        insert.run(artifact.id, artifact.version, artifact.conversationId, artifact.taskId, artifact.nodeId ?? null, artifact.kind, artifact.title, artifact.status, json(artifact.data), json(artifact.sourceRefs), artifact.createdBy, artifact.createdAt);
        this.appendEvent({ conversationId: prior.conversationId, taskId: prior.taskId, nodeId: prior.nodeId, type: transition.event, actorType: "system", actorId: "artifact-service", payload: { artifactId: prior.id, fromVersion: prior.version, toVersion: artifact.version, command: "revise", from: transition.from, to: transition.to } });
      }
      for (const artifact of revisions) this.indexText(artifact.id, "artifact", artifact.title, json(artifact.data));
      return revisions;
    });
  }

  getArtifact(id: string): Artifact | null {
    const row = this.db.prepare("SELECT * FROM artifacts WHERE id = ? ORDER BY version DESC LIMIT 1").get(id) as Record<string, unknown> | undefined;
    return row ? this.mapArtifact(row) : null;
  }

  listArtifacts(taskId: string): Artifact[] {
    return (this.db.prepare("SELECT a.* FROM artifacts a JOIN (SELECT id, MAX(version) version FROM artifacts GROUP BY id) latest ON a.id=latest.id AND a.version=latest.version WHERE task_id=? ORDER BY created_at").all(taskId) as Record<string, unknown>[]).map(this.mapArtifact);
  }

  appendEvent<T>(input: Omit<RunEvent<T>, "id" | "sequence" | "createdAt">): RunEvent<T> {
    const id = randomUUID();
    const createdAt = now();
    const result = this.db.prepare("INSERT INTO run_events (id, conversation_id, task_id, node_id, type, actor_type, actor_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, input.conversationId, input.taskId ?? null, input.nodeId ?? null, input.type, input.actorType, input.actorId, json(input.payload), createdAt);
    return { ...input, id, sequence: Number(result.lastInsertRowid), createdAt };
  }

  listEvents(conversationId: string, after = 0, limit = 5_000): RunEvent[] {
    return (this.db.prepare("SELECT * FROM run_events WHERE conversation_id=? AND sequence>? ORDER BY sequence LIMIT ?").all(conversationId, after, limit) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id), sequence: Number(row.sequence), conversationId: String(row.conversation_id), taskId: row.task_id ? String(row.task_id) : undefined, nodeId: row.node_id ? String(row.node_id) : undefined, type: String(row.type), actorType: row.actor_type as RunEvent["actorType"], actorId: String(row.actor_id), payload: parse(row.payload_json, {}), createdAt: String(row.created_at),
    }));
  }

  createApproval(input: Omit<ApprovalRequest, "id" | "status" | "createdAt">): ApprovalRequest {
    const item: ApprovalRequest = { ...input, id: randomUUID(), status: "pending", createdAt: now() };
    this.db.prepare("INSERT INTO approvals (id, conversation_id, task_id, node_id, kind, prompt, status, decision_note, created_at, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)")
      .run(item.id, item.conversationId, item.taskId, item.nodeId ?? null, item.kind, item.prompt, item.status, item.createdAt);
    return item;
  }

  getApproval(id: string): ApprovalRequest | null {
    const row = this.db.prepare("SELECT * FROM approvals WHERE id=?").get(id) as Record<string, unknown> | undefined;
    return row ? this.mapApproval(row) : null;
  }

  listPendingApprovals(conversationId: string): ApprovalRequest[] {
    return (this.db.prepare("SELECT * FROM approvals WHERE conversation_id=? AND status='pending' ORDER BY created_at").all(conversationId) as Record<string, unknown>[]).map(this.mapApproval);
  }

  supersedePendingApprovals(nodeId: string, note: string): number {
    return this.hooks.transaction(() => {
      const approvals = this.db.prepare("SELECT id FROM approvals WHERE node_id=? AND status='pending'").all(nodeId) as Array<{ id: string }>;
      for (const row of approvals) {
        const approval = this.getApproval(String(row.id))!;
        const transition = this.hooks.transition("Approval", approval.status, "artifact_revised");
        this.db.prepare("UPDATE approvals SET status=?,decision_note=?,decided_at=? WHERE id=? AND status=?")
          .run(transition.to, note, now(), approval.id, transition.from);
        this.appendEvent({ conversationId: approval.conversationId, taskId: approval.taskId, nodeId: approval.nodeId, type: transition.event, actorType: "system", actorId: "artifact-service", payload: { approvalId: approval.id, command: "artifact_revised", from: transition.from, to: transition.to, note } });
      }
      return approvals.length;
    });
  }

  decideApproval(id: string, status: "approved" | "rejected", note?: string): ApprovalRequest {
    return this.hooks.transaction(() => {
      const current = this.getApproval(id);
      if (!current) throw new Error(`Approval not found: ${id}`);
      const command = status === "approved" ? "approve" : "reject";
      const transition = this.hooks.transition("Approval", current.status, command);
      const result = this.db.prepare("UPDATE approvals SET status=?,decision_note=?,decided_at=? WHERE id=? AND status=?")
        .run(transition.to, note ?? null, now(), id, transition.from);
      if (Number(result.changes) !== 1) throw new ApprovalDecisionConflictError(id, current.status);
      this.appendEvent({ conversationId: current.conversationId, taskId: current.taskId, nodeId: current.nodeId, type: transition.event, actorType: "researcher", actorId: "researcher", payload: { approvalId: id, command, from: transition.from, to: transition.to, note } });
      return this.getApproval(id)!;
    });
  }

  private indexText(refId: string, kind: string, title: string, body: string): void {
    try { this.db.prepare("INSERT INTO research_fts (ref_id, kind, title, body) VALUES (?, ?, ?, ?)").run(refId, kind, title, body); } catch { /* optional FTS */ }
  }

  private mapArtifact = (row: Record<string, unknown>): Artifact => ({ id: String(row.id), version: Number(row.version), conversationId: String(row.conversation_id), taskId: String(row.task_id), nodeId: row.node_id ? String(row.node_id) : undefined, kind: row.kind as Artifact["kind"], title: String(row.title), status: row.status as Artifact["status"], data: parse(row.data_json, {}), sourceRefs: parse(row.source_refs_json, []), createdBy: String(row.created_by), createdAt: String(row.created_at) });
  private mapApproval = (row: Record<string, unknown>): ApprovalRequest => ({ id: String(row.id), conversationId: String(row.conversation_id), taskId: String(row.task_id), nodeId: row.node_id ? String(row.node_id) : undefined, kind: row.kind as ApprovalRequest["kind"], prompt: String(row.prompt), status: row.status as ApprovalRequest["status"], decisionNote: row.decision_note ? String(row.decision_note) : undefined, createdAt: String(row.created_at), decidedAt: row.decided_at ? String(row.decided_at) : undefined });
}

export class ArtifactVersionConflictError extends Error {
  constructor(readonly artifactId: string, readonly expectedVersion: number, readonly actualVersion: number) {
    super(`Artifact version conflict: expected ${expectedVersion}, actual ${actualVersion}`);
    this.name = "ArtifactVersionConflictError";
  }
}

export class ApprovalDecisionConflictError extends Error {
  constructor(readonly approvalId: string, readonly actualStatus: ApprovalRequest["status"]) {
    super(`Approval is no longer pending: ${approvalId} is ${actualStatus}`);
    this.name = "ApprovalDecisionConflictError";
  }
}
