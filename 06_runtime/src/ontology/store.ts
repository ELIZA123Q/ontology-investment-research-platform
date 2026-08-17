import { randomUUID } from "node:crypto";
import type { ActionExecution, OntologyEdit, OntologyLink, OntologyObject, OntologyObjectRef } from "@/src/contracts/ontology";
import { RuntimeStore } from "@/src/runtime/store";

const now = () => new Date().toISOString();
const json = (value: unknown) => JSON.stringify(value);
const parse = <T>(value: unknown, fallback: T): T => typeof value === "string" && value.length ? JSON.parse(value) as T : fallback;

export class OntologyStore {
  constructor(private readonly runtime: RuntimeStore) {}

  getObject(id: string): OntologyObject | null {
    const row = this.runtime.db.prepare("SELECT * FROM ontology_objects WHERE id=?").get(id) as Record<string, unknown> | undefined;
    return row ? this.mapObject(row) : null;
  }

  listObjects(type?: string): OntologyObject[] {
    const rows = type
      ? this.runtime.db.prepare("SELECT * FROM ontology_objects WHERE type=? AND status<>'deleted' ORDER BY updated_at").all(type)
      : this.runtime.db.prepare("SELECT * FROM ontology_objects WHERE status<>'deleted' ORDER BY updated_at").all();
    return (rows as Record<string, unknown>[]).map(this.mapObject);
  }

  getLink(id: string): OntologyLink | null {
    const row = this.runtime.db.prepare("SELECT * FROM ontology_links WHERE id=?").get(id) as Record<string, unknown> | undefined;
    return row ? this.mapLink(row) : null;
  }

  listLinksForObject(id: string): OntologyLink[] {
    return (this.runtime.db.prepare("SELECT * FROM ontology_links WHERE source_id=? OR target_id=? ORDER BY created_at").all(id, id) as Record<string, unknown>[]).map(this.mapLink);
  }

  getActionExecution(id: string): ActionExecution | null {
    const row = this.runtime.db.prepare("SELECT * FROM action_executions WHERE id=?").get(id) as Record<string, unknown> | undefined;
    return row ? this.mapExecution(row) : null;
  }

  findActionExecution(actionType: string, idempotencyKey: string): ActionExecution | null {
    const row = this.runtime.db.prepare("SELECT * FROM action_executions WHERE action_type=? AND idempotency_key=?").get(actionType, idempotencyKey) as Record<string, unknown> | undefined;
    return row ? this.mapExecution(row) : null;
  }

  recordRejected(execution: ActionExecution): ActionExecution {
    const stamp = execution.completedAt || now();
    return this.runtime.transaction(() => {
      this.insertExecution(execution);
      this.createObject({
        operation: "create_object", ref: { id: execution.id, type: "ActionExecution" },
        properties: {
          actionType: execution.actionType, actionVersion: execution.actionVersion, status: execution.status,
          actorType: execution.actorType, actorId: execution.actorId, conversationId: execution.conversationId,
          taskId: execution.taskId, idempotencyKey: execution.idempotencyKey,
          knowledgeLockId: execution.knowledgeLockId, approvalId: execution.approvalId,
          request: execution.request, preview: execution.preview, edits: execution.edits,
          outputRefs: execution.outputRefs, invalidatedRefs: execution.invalidatedRefs,
          error: execution.error || null, createdAt: execution.createdAt, completedAt: stamp,
        },
      }, stamp);
      if (execution.conversationId) {
        this.runtime.appendEvent({
          conversationId: execution.conversationId, taskId: execution.taskId, type: `ontology.action.${execution.status}`,
          actorType: execution.actorType === "ontology_admin" ? "system" : execution.actorType,
          actorId: execution.actorId, payload: { actionExecutionId: execution.id, actionType: execution.actionType, error: execution.error },
        });
      }
      return execution;
    });
  }

  commit(execution: ActionExecution): { execution: ActionExecution; objects: OntologyObject[]; links: OntologyLink[] } {
    const stamp = now();
    const completed: ActionExecution = { ...execution, status: "applied", completedAt: stamp };
    const touchedObjects: OntologyObject[] = [];
    const touchedLinks: OntologyLink[] = [];
    return this.runtime.transaction(() => {
      for (const target of completed.request.targetRefs) {
        const current = this.getObject(target.id);
        const expected = completed.request.expectedVersions[`${target.type}:${target.id}`]
          ?? completed.request.expectedVersions[target.id];
        if (!current || current.type !== target.type || expected == null || current.version !== expected) {
          throw new Error(`Ontology optimistic lock failed for ${target.type}:${target.id}`);
        }
      }
      for (const edit of completed.edits) {
        if (edit.operation === "create_object") touchedObjects.push(this.createObject(edit, stamp));
        else if (edit.operation === "update_object") touchedObjects.push(this.updateObject(edit, stamp));
        else touchedLinks.push(this.createLink(edit, stamp));
      }
      this.insertExecution(completed);
      const actionObject = this.createObject({
        operation: "create_object",
        ref: { id: completed.id, type: "ActionExecution" },
        properties: {
          actionType: completed.actionType, actionVersion: completed.actionVersion, status: completed.status,
          actorType: completed.actorType, actorId: completed.actorId, conversationId: completed.conversationId,
          taskId: completed.taskId, idempotencyKey: completed.idempotencyKey,
          knowledgeLockId: completed.knowledgeLockId, approvalId: completed.approvalId,
          request: completed.request, preview: completed.preview, edits: completed.edits,
          outputRefs: completed.outputRefs, invalidatedRefs: completed.invalidatedRefs,
          error: completed.error, createdAt: completed.createdAt, completedAt: completed.completedAt,
        },
      }, stamp);
      touchedObjects.push(actionObject);
      for (const ref of [...completed.outputRefs, ...completed.invalidatedRefs]) {
        if (!this.getObject(ref.id)) continue;
        touchedLinks.push(this.createLink({
          operation: "create_link", id: randomUUID(), type: "actionEditedObject",
          sourceRef: { id: completed.id, type: "ActionExecution" }, targetRef: ref, properties: {},
        }, stamp));
      }
      if (completed.conversationId) {
        this.runtime.appendEvent({
          conversationId: completed.conversationId, taskId: completed.taskId, type: "ontology.action.applied",
          actorType: completed.actorType === "ontology_admin" ? "system" : completed.actorType,
          actorId: completed.actorId,
          payload: { actionExecutionId: completed.id, actionType: completed.actionType, outputRefs: completed.outputRefs, invalidatedRefs: completed.invalidatedRefs },
        });
      }
      return { execution: completed, objects: touchedObjects, links: touchedLinks };
    });
  }

  private createObject(edit: Extract<OntologyEdit, { operation: "create_object" }>, stamp: string): OntologyObject {
    if (this.getObject(edit.ref.id)) throw new Error(`Ontology object already exists: ${edit.ref.id}`);
    const object: OntologyObject = { ...edit.ref, version: 1, status: "active", properties: edit.properties, createdAt: stamp, updatedAt: stamp };
    this.runtime.db.prepare("INSERT INTO ontology_objects VALUES (?, ?, 1, 'active', ?, ?, ?)")
      .run(object.id, object.type, json(object.properties), stamp, stamp);
    return object;
  }

  private updateObject(edit: Extract<OntologyEdit, { operation: "update_object" }>, stamp: string): OntologyObject {
    const existing = this.getObject(edit.ref.id);
    if (!existing || existing.type !== edit.ref.type) throw new Error(`Ontology object not found: ${edit.ref.type}:${edit.ref.id}`);
    const properties = { ...existing.properties, ...edit.properties };
    const status = String(edit.properties.lifecycle_status || edit.properties.lifecycleStatus || "") === "superseded" ? "superseded" : existing.status;
    this.runtime.db.prepare("UPDATE ontology_objects SET version=version+1,status=?,properties_json=?,updated_at=? WHERE id=?")
      .run(status, json(properties), stamp, existing.id);
    return { ...existing, version: existing.version + 1, status, properties, updatedAt: stamp };
  }

  private createLink(edit: Extract<OntologyEdit, { operation: "create_link" }>, stamp: string): OntologyLink {
    if (!this.getObject(edit.sourceRef.id) || !this.getObject(edit.targetRef.id)) throw new Error(`Ontology link endpoints must exist: ${edit.type}`);
    const existing = this.runtime.db.prepare("SELECT * FROM ontology_links WHERE type=? AND source_id=? AND target_id=?")
      .get(edit.type, edit.sourceRef.id, edit.targetRef.id) as Record<string, unknown> | undefined;
    if (existing) return this.mapLink(existing);
    const link: OntologyLink = { id: edit.id, type: edit.type, sourceRef: edit.sourceRef, targetRef: edit.targetRef, version: 1, properties: edit.properties, createdAt: stamp, updatedAt: stamp };
    this.runtime.db.prepare("INSERT INTO ontology_links VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)")
      .run(link.id, link.type, link.sourceRef.id, link.sourceRef.type, link.targetRef.id, link.targetRef.type, json(link.properties), stamp, stamp);
    return link;
  }

  private insertExecution(execution: ActionExecution): void {
    this.runtime.db.prepare(`INSERT INTO action_executions
      (id,action_type,action_version,status,actor_type,actor_id,conversation_id,task_id,idempotency_key,knowledge_lock_id,approval_id,request_json,preview_json,edits_json,output_refs_json,invalidated_refs_json,error,created_at,completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(execution.id, execution.actionType, execution.actionVersion, execution.status, execution.actorType, execution.actorId,
        execution.conversationId ?? null, execution.taskId ?? null, execution.idempotencyKey, execution.knowledgeLockId ?? null,
        execution.approvalId ?? null, json(execution.request), json(execution.preview), json(execution.edits),
        json(execution.outputRefs), json(execution.invalidatedRefs), execution.error ?? null, execution.createdAt, execution.completedAt ?? null);
  }

  private mapObject = (row: Record<string, unknown>): OntologyObject => ({
    id: String(row.id), type: String(row.type), version: Number(row.version), status: row.status as OntologyObject["status"],
    properties: parse<Record<string, unknown>>(row.properties_json, {}), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  });
  private mapLink = (row: Record<string, unknown>): OntologyLink => ({
    id: String(row.id), type: String(row.type), sourceRef: { id: String(row.source_id), type: String(row.source_type) },
    targetRef: { id: String(row.target_id), type: String(row.target_type) }, version: Number(row.version),
    properties: parse<Record<string, unknown>>(row.properties_json, {}), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  });
  private mapExecution = (row: Record<string, unknown>): ActionExecution => ({
    id: String(row.id), actionType: String(row.action_type), actionVersion: String(row.action_version), status: row.status as ActionExecution["status"],
    actorType: row.actor_type as ActionExecution["actorType"], actorId: String(row.actor_id), conversationId: row.conversation_id ? String(row.conversation_id) : undefined,
    taskId: row.task_id ? String(row.task_id) : undefined, idempotencyKey: String(row.idempotency_key), knowledgeLockId: row.knowledge_lock_id ? String(row.knowledge_lock_id) : undefined,
    approvalId: row.approval_id ? String(row.approval_id) : undefined, request: parse(row.request_json, {} as ActionExecution["request"]), preview: parse(row.preview_json, {} as ActionExecution["preview"]),
    edits: parse<OntologyEdit[]>(row.edits_json, []), outputRefs: parse<OntologyObjectRef[]>(row.output_refs_json, []), invalidatedRefs: parse<OntologyObjectRef[]>(row.invalidated_refs_json, []),
    error: row.error ? String(row.error) : undefined, createdAt: String(row.created_at), completedAt: row.completed_at ? String(row.completed_at) : undefined,
  });
}
