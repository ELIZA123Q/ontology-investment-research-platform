import { randomUUID } from "node:crypto";
import type { Artifact, ReportSpecInput, Task } from "@/src/contracts";
import { AgentKernel } from "@/src/runtime/kernel";
import { RuntimeStore } from "@/src/runtime/store";
import { transitionState } from "@/src/runtime/state-machine";
import { approvalCommand, taskOutcomeLabel } from "@/src/runtime/state-machine";
import { editableArtifactFields } from "@/src/governance/policy-engine";
import { buildResearcherMaterialResult } from "@/src/tools/researcher-material";

export interface CreateResearchCaseInput {
  companyCode: string;
  companyName: string;
  asOf: string;
  researchQuestion: string;
  primaryLens: string;
  counterLens: string;
  reportSpec: ReportSpecInput;
  sourcePolicy: Record<string, unknown>;
}

export type ResearchCaseCommandType =
  | "confirm_plan" | "attach_material" | "confirm_evidence" | "revise_judgment"
  | "approve_judgment" | "revise_report" | "publish" | "retry" | "cancel";

export interface ResearchCaseCommand {
  type: ResearchCaseCommandType;
  expectedVersion: number;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}

export interface ResearchCaseV2 {
  id: string;
  conversationId: string;
  taskId: string;
  ownerId: string;
  version: number;
  companyCode: string;
  companyName: string;
  asOf: string;
  researchQuestion: string;
  primaryLens: string;
  counterLens: string;
  reportSpec: ReportSpecInput;
  sourcePolicy: Record<string, unknown>;
  status: "draft" | "active" | "waiting_input" | "completed" | "cancelled";
  createdAt: string;
  updatedAt: string;
}

export class CaseVersionConflictError extends Error {
  readonly status = 409;
  constructor(readonly expectedVersion: number, readonly actualVersion: number) {
    super(`ResearchCase version conflict: expected ${expectedVersion}, actual ${actualVersion}`);
  }
}

export class CaseCommandConflictError extends Error {
  readonly status = 409;
  constructor(message: string) { super(message); }
}

const json = (value: unknown) => JSON.stringify(value);
const parse = <T>(value: unknown, fallback: T): T => { try { return JSON.parse(String(value)) as T; } catch { return fallback; } };
const now = () => new Date().toISOString();

export class ResearchCaseService {
  readonly kernel: AgentKernel;

  constructor(readonly store: RuntimeStore) {
    this.kernel = new AgentKernel(store);
  }

  create(input: CreateResearchCaseInput): ResearchCaseV2 {
    const normalized = validateCreateInput(input);
    return this.store.transaction(() => {
      const conversation = this.store.createConversation(`${normalized.companyName}（${normalized.companyCode}）基本面研究`);
      const goal = `截至 ${normalized.asOf}，对 ${normalized.companyName}（${normalized.companyCode}）开展结构化公司基本面研究。研究问题：${normalized.researchQuestion}。主 Lens：${normalized.primaryLens}；反 Lens：${normalized.counterLens}。`;
      const submitted = this.kernel.submitGoal(conversation.id, goal, undefined, {
        reportSpec: { ...normalized.reportSpec, kind: "company_research" },
        lensRefs: [normalized.primaryLens, normalized.counterLens],
      });
      const stamp = now();
      this.store.db.prepare(`INSERT INTO research_cases
        (id,conversation_id,task_id,owner_id,version,company_code,company_name,as_of,research_question,primary_lens,counter_lens,report_spec_json,source_policy_json,status,created_at,updated_at)
        VALUES (?, ?, ?, 'researcher', 1, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`)
        .run(submitted.task.researchCaseId, conversation.id, submitted.task.id, normalized.companyCode, normalized.companyName,
          normalized.asOf, normalized.researchQuestion, normalized.primaryLens, normalized.counterLens,
          json(normalized.reportSpec), json(normalized.sourcePolicy), stamp, stamp);
      this.store.appendEvent({ conversationId: conversation.id, taskId: submitted.task.id, type: "research_case.created", actorType: "researcher", actorId: "researcher", payload: { researchCaseId: submitted.task.researchCaseId, companyCode: normalized.companyCode, companyName: normalized.companyName, asOf: normalized.asOf } });
      return this.requireCase(submitted.task.researchCaseId);
    });
  }

  get(id: string): ResearchCaseV2 | null {
    const row = this.store.db.prepare("SELECT * FROM research_cases WHERE id=?").get(id) as Record<string, unknown> | undefined;
    return row ? this.mapCase(row) : null;
  }

  list(): ResearchCaseV2[] {
    return (this.store.db.prepare("SELECT * FROM research_cases ORDER BY updated_at DESC").all() as Record<string, unknown>[]).map(this.mapCase);
  }

  snapshot(id: string) {
    const researchCase = this.requireCase(id);
    const runtime = this.kernel.snapshot(researchCase.conversationId, researchCase.taskId);
    const pending = runtime.approvals[0];
    const binding = pending ? approvalCommand(pending.kind) : null;
    const artifactPermissions = Object.fromEntries(runtime.artifacts.map((artifact) => {
      if (artifact.kind === "report") return [artifact.id, [...editableArtifactFields("report")]];
      if (artifact.kind !== "judgment") return [artifact.id, []];
      const data = artifact.data as Record<string, unknown>;
      const sufficient = !["abstain", "insufficient"].includes(String(data.disposition || data.confidence));
      return [artifact.id, [...editableArtifactFields("judgment", sufficient)]];
    }));
    return {
      researchCase,
      runtime,
      decisionSpine: decisionSpine(runtime.artifacts, runtime.task),
      intervention: pending && binding ? { approvalId: pending.id, prompt: pending.prompt, ...binding } : null,
      taskOutcome: runtime.task?.outcome ? { value: runtime.task.outcome, label: taskOutcomeLabel(runtime.task.outcome) } : null,
      artifactPermissions,
    };
  }

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
      const transition = transitionState("ResearchCase", current.status, command.type);
      const commandId = randomUUID();
      const stamp = now();
      this.store.db.prepare(`INSERT INTO research_case_commands
        (id,case_id,idempotency_key,command_type,actor_id,expected_version,payload_json,status,created_at,updated_at)
        VALUES (?, ?, ?, ?, 'researcher', ?, ?, 'running', ?, ?)`)
        .run(commandId, id, command.idempotencyKey, command.type, command.expectedVersion, json(command.payload), stamp, stamp);
      const result = this.applyCommand(current, command);
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

  private applyCommand(researchCase: ResearchCaseV2, command: ResearchCaseCommand): unknown {
    const task = this.store.getTask(researchCase.taskId);
    if (!task) throw new Error(`Task not found: ${researchCase.taskId}`);
    if (command.type === "confirm_plan") return this.decidePending(task, "plan_confirmation");
    if (command.type === "confirm_evidence") return this.decidePending(task, "evidence_confirmation");
    if (command.type === "approve_judgment") return this.decidePending(task, "judgment_confirmation");
    if (command.type === "publish") return this.decidePending(task, "publish_confirmation");
    if (command.type === "attach_material") return this.kernel.ingestExternalSource(task.id, buildResearcherMaterialResult(command.payload));
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
    throw new Error(`Unsupported command: ${command.type}`);
  }

  private decidePending(task: Task, kind: "plan_confirmation" | "evidence_confirmation" | "judgment_confirmation" | "publish_confirmation") {
    const approval = this.store.listPendingApprovals(task.conversationId).find((item) => item.taskId === task.id && item.kind === kind);
    if (!approval) throw new CaseCommandConflictError(`No pending ${kind} approval`);
    return this.kernel.decideApproval(approval.id, "approved", `ResearchCase v2 command: ${kind}`);
  }

  private requireCase(id: string): ResearchCaseV2 {
    const researchCase = this.get(id);
    if (!researchCase) throw new Error(`ResearchCase not found: ${id}`);
    return researchCase;
  }

  private mapCase = (row: Record<string, unknown>): ResearchCaseV2 => ({
    id: String(row.id), conversationId: String(row.conversation_id), taskId: String(row.task_id), ownerId: String(row.owner_id), version: Number(row.version),
    companyCode: String(row.company_code), companyName: String(row.company_name), asOf: String(row.as_of), researchQuestion: String(row.research_question),
    primaryLens: String(row.primary_lens), counterLens: String(row.counter_lens),
    reportSpec: parse<ReportSpecInput>(row.report_spec_json, {}), sourcePolicy: parse<Record<string, unknown>>(row.source_policy_json, {}),
    status: row.status as ResearchCaseV2["status"], createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  });
}

function validateCreateInput(input: CreateResearchCaseInput): CreateResearchCaseInput {
  const companyCode = String(input.companyCode || "").trim().toUpperCase();
  const companyName = String(input.companyName || "").trim();
  const researchQuestion = String(input.researchQuestion || "").trim();
  const primaryLens = String(input.primaryLens || "").trim();
  const counterLens = String(input.counterLens || "").trim();
  const asOf = new Date(input.asOf);
  if (!/^(?:SH|SZ)?\d{6}$/.test(companyCode)) throw new Error("companyCode must be a six-digit A-share code with optional SH/SZ prefix");
  if (!companyName || !researchQuestion || !primaryLens || !counterLens) throw new Error("companyName, researchQuestion, primaryLens and counterLens are required");
  if (Number.isNaN(asOf.getTime())) throw new Error("asOf must be a valid ISO date");
  return { ...input, companyCode, companyName, researchQuestion, primaryLens, counterLens, asOf: asOf.toISOString(), reportSpec: input.reportSpec || {}, sourcePolicy: input.sourcePolicy || {} };
}

function validateCommand(command: ResearchCaseCommand): void {
  if (!Number.isInteger(command.expectedVersion) || command.expectedVersion < 1) throw new Error("expectedVersion must be a positive integer");
  if (!command.idempotencyKey?.trim()) throw new Error("idempotencyKey is required");
  if (!command.payload || typeof command.payload !== "object" || Array.isArray(command.payload)) throw new Error("payload must be an object");
}

function decisionSpine(artifacts: Artifact[], task: Task | null) {
  const definitions = [
    ["scope", ["research_plan", "research_problem_graph"]],
    ["evidence", ["evidence_package"]],
    ["business_and_kpi", ["hypothesis_map"]],
    ["financial_model", ["normalized_financials", "financial_model"]],
    ["judgment", ["judgment", "thesis_state"]],
    ["valuation", ["valuation_analysis"]],
    ["report", ["report", "review"]],
  ] as const;
  return definitions.map(([id, kinds]) => {
    const matches = artifacts.filter((artifact) => (kinds as readonly string[]).includes(artifact.kind));
    const latest = matches.at(-1);
    const status = latest?.status === "superseded" ? "invalidated"
      : latest?.status === "verified" ? "ready"
      : task?.status === "waiting_approval" && latest ? "waiting_approval"
      : latest ? "limited"
      : task?.outcome?.startsWith("blocked_") || task?.outcome === "stopped_insufficient_evidence" ? "blocked" : "limited";
    return { id, status, artifactIds: matches.map((artifact) => artifact.id) };
  });
}
