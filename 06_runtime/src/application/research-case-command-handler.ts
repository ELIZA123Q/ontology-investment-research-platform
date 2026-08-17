import { randomUUID } from "node:crypto";
import type { Task } from "@/src/contracts";
import type { AgentKernel } from "@/src/runtime/kernel";
import type { RuntimeStore } from "@/src/runtime/store";
import { buildResearcherMaterialResult } from "@/src/tools/researcher-material";
import {
  CaseCommandConflictError,
  CaseVersionConflictError,
  type ResearchCaseCommand,
  type ResearchCaseV2,
  validateCommand,
} from "@/src/application/research-case-contracts";
import { reduceResearchCaseState } from "@/src/application/research-case-state-reducer";

const json = (value: unknown) => JSON.stringify(value);
const parse = <T>(value: unknown, fallback: T): T => { try { return JSON.parse(String(value)) as T; } catch { return fallback; } };
const now = () => new Date().toISOString();

export class ResearchCaseCommandHandler {
  constructor(
    private readonly store: RuntimeStore,
    private readonly kernel: AgentKernel,
    private readonly requireCase: (id: string) => ResearchCaseV2,
  ) {}

  execute(id: string, command: ResearchCaseCommand): { researchCase: ResearchCaseV2; result: unknown } {
    validateCommand(command);
    const existing = this.store.db.prepare("SELECT status,result_json,error FROM research_case_commands WHERE case_id=? AND idempotency_key=?")
      .get(id, command.idempotencyKey) as { status?: string; result_json?: string; error?: string } | undefined;
    if (existing?.status === "completed") return { researchCase: this.requireCase(id), result: parse(existing.result_json, {}) };
    if (existing?.status === "failed") throw new CaseCommandConflictError(existing.error || "Previous command attempt failed");
    if (existing) throw new CaseCommandConflictError("Command with this idempotencyKey is still running");

    return this.store.transaction(() => {
      const current = this.requireCase(id);
      if (current.version !== command.expectedVersion) throw new CaseVersionConflictError(command.expectedVersion, current.version);
      const transition = reduceResearchCaseState(current, command.type);
      const commandId = randomUUID();
      const stamp = now();
      this.store.db.prepare(`INSERT INTO research_case_commands
        (id,case_id,idempotency_key,command_type,actor_id,expected_version,payload_json,status,created_at,updated_at)
        VALUES (?, ?, ?, ?, 'researcher', ?, ?, 'running', ?, ?)`)
        .run(commandId, id, command.idempotencyKey, command.type, command.expectedVersion, json(command.payload), stamp, stamp);
      const result = this.apply(current, command);
      const updated = this.store.db.prepare("UPDATE research_cases SET version=version+1,status=?,updated_at=? WHERE id=? AND version=?")
        .run(transition.to, stamp, id, command.expectedVersion);
      if (Number(updated.changes) !== 1) throw new CaseVersionConflictError(command.expectedVersion, this.requireCase(id).version);
      this.store.appendEvent({
        conversationId: current.conversationId,
        taskId: current.taskId,
        type: transition.event,
        actorType: "researcher",
        actorId: "researcher",
        payload: { researchCaseId: id, commandId, commandType: command.type, from: transition.from, to: transition.to },
      });
      this.store.db.prepare("UPDATE research_case_commands SET status='completed',result_json=?,updated_at=? WHERE id=?")
        .run(json(result), stamp, commandId);
      return { researchCase: this.requireCase(id), result };
    });
  }

  private apply(researchCase: ResearchCaseV2, command: ResearchCaseCommand): unknown {
    const task = this.store.getTask(researchCase.taskId);
    if (!task) throw new Error(`Task not found: ${researchCase.taskId}`);
    if (command.type === "confirm_plan") return this.decidePending(task, "plan_confirmation");
    if (command.type === "confirm_evidence") return this.decidePending(task, "evidence_confirmation");
    if (command.type === "approve_judgment") return this.decidePending(task, "judgment_confirmation");
    if (command.type === "publish") return this.decidePending(task, "publish_confirmation");
    if (command.type === "attach_material") return this.kernel.ingestion.ingestExternalSource(task.id, buildResearcherMaterialResult(command.payload));
    if (command.type === "retry") return { jobId: this.kernel.resumeTask(task.id) };
    if (command.type === "cancel") return this.kernel.cancelTask(task.id);
    if (command.type === "revise_judgment" || command.type === "revise_report") {
      const artifactId = String(command.payload.artifactId || "");
      const artifactExpectedVersion = Number(command.payload.artifactExpectedVersion);
      const changes = command.payload.changes;
      if (!artifactId || !Number.isInteger(artifactExpectedVersion) || !changes || typeof changes !== "object" || Array.isArray(changes)) throw new Error("Artifact revision requires artifactId, artifactExpectedVersion and changes");
      const artifact = this.store.getArtifact(artifactId);
      const expectedKind = command.type === "revise_judgment" ? "judgment" : "report";
      if (!artifact || artifact.taskId !== task.id || artifact.kind !== expectedKind) throw new Error(`${expectedKind} artifact not found in this ResearchCase`);
      return this.kernel.reviseArtifact(artifactId, artifactExpectedVersion, changes as Record<string, unknown>);
    }
    const exhaustive: never = command.type;
    throw new Error(`Unsupported command: ${exhaustive}`);
  }

  private decidePending(task: Task, kind: "plan_confirmation" | "evidence_confirmation" | "judgment_confirmation" | "publish_confirmation") {
    const approval = this.store.listPendingApprovals(task.conversationId).find((item) => item.taskId === task.id && item.kind === kind);
    if (!approval) throw new CaseCommandConflictError(`No pending ${kind} approval`);
    return this.kernel.decideApproval(approval.id, "approved", `ResearchCase v2 command: ${kind}`);
  }
}
