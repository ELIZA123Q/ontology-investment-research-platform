import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuntimeStore } from "@/src/runtime/store";
import { CaseVersionConflictError, ResearchCaseService } from "@/src/application/research-case-service";
import { InvalidStateTransitionError } from "@/src/runtime/state-machine";

let store: RuntimeStore | undefined;
const temporaryDirectories: string[] = [];
afterEach(() => {
  store?.close();
  store = undefined;
  while (temporaryDirectories.length) rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
});

const input = {
  companyCode: "688261",
  companyName: "东微半导",
  asOf: "2026-08-13",
  researchQuestion: "收入增长能否通过产品结构和现金流得到验证？",
  primaryLens: "fundamental",
  counterLens: "quality",
  reportSpec: { audience: "research_analyst" as const, depth: "deep" as const },
  sourcePolicy: { permissionScope: "public_research_use" },
};

const material = (publisherId: string, quote: string) => ({
  uri: `https://${publisherId}.test/report.pdf`,
  title: `${publisherId} 定期披露`,
  publisherId,
  publishedAt: "2026-08-01",
  sourceType: "primary",
  locator: "第 3 页，经营回顾",
  quote,
  context: `披露原文开始。${quote}。披露原文结束。`,
  permissionConfirmed: true,
});

describe("ResearchCase v2", () => {
  it("creates a governed company case on a fresh schema", () => {
    store = new RuntimeStore(":memory:");
    const service = new ResearchCaseService(store);
    const researchCase = service.create(input);
    expect(researchCase).toMatchObject({ version: 1, companyCode: "688261", status: "draft" });
    const snapshot = service.snapshot(researchCase.id);
    expect(snapshot.runtime.task?.reportSpec.kind).toBe("judgment_update");
    expect(snapshot.decisionSpine.map((item) => item.id)).toEqual(["scope", "evidence", "business_and_kpi", "financial_model", "judgment", "valuation", "report"]);
  });

  it("executes commands with optimistic versioning and idempotency", () => {
    store = new RuntimeStore(":memory:");
    const service = new ResearchCaseService(store);
    const researchCase = service.create(input);
    const command = { type: "confirm_plan" as const, expectedVersion: 1, idempotencyKey: "confirm-plan-1", payload: {} };
    const first = service.execute(researchCase.id, command);
    expect(first.researchCase.version).toBe(2);
    expect(first.researchCase.status).toBe("active");
    const replay = service.execute(researchCase.id, command);
    expect(replay.researchCase.version).toBe(2);
    expect(() => service.execute(researchCase.id, { ...command, idempotencyKey: "stale-command" })).toThrow(CaseVersionConflictError);
  });

  it("records a governed cancellation outcome", () => {
    store = new RuntimeStore(":memory:");
    const service = new ResearchCaseService(store);
    const researchCase = service.create(input);
    const result = service.execute(researchCase.id, { type: "cancel", expectedVersion: 1, idempotencyKey: "cancel-1", payload: {} });
    expect(result.researchCase.status).toBe("cancelled");
    expect(store.getTask(researchCase.taskId)?.outcome).toBe("cancelled_by_user");
  });

  it("rolls back every aggregate created when case creation fails", () => {
    store = new RuntimeStore(":memory:");
    const service = new ResearchCaseService(store);
    store.db.exec(`CREATE TRIGGER reject_case_insert BEFORE INSERT ON research_cases
      BEGIN SELECT RAISE(ABORT, 'forced case insert failure'); END`);

    expect(() => service.create(input)).toThrow("forced case insert failure");
    for (const table of ["research_cases", "conversations", "tasks", "task_nodes", "artifacts", "approvals", "run_events", "action_executions"]) {
      const row = store.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
      expect(Number(row.count), table).toBe(0);
    }
  });

  it("rolls back Kernel, ontology, queue and event side effects when command commit fails", () => {
    store = new RuntimeStore(":memory:");
    const service = new ResearchCaseService(store);
    const researchCase = service.create(input);
    const beforeEvents = store.listEvents(researchCase.conversationId).length;
    const beforeActions = Number((store.db.prepare("SELECT COUNT(*) AS count FROM action_executions").get() as { count: number }).count);
    store.db.exec(`CREATE TRIGGER reject_case_update BEFORE UPDATE ON research_cases
      BEGIN SELECT RAISE(ABORT, 'forced case update failure'); END`);

    expect(() => service.execute(researchCase.id, { type: "confirm_plan", expectedVersion: 1, idempotencyKey: "atomic-failure", payload: {} }))
      .toThrow("forced case update failure");

    expect(service.get(researchCase.id)).toMatchObject({ version: 1, status: "draft" });
    expect(store.getTask(researchCase.taskId)?.status).toBe("waiting_approval");
    expect(store.listPendingApprovals(researchCase.conversationId)).toHaveLength(1);
    expect(store.listEvents(researchCase.conversationId)).toHaveLength(beforeEvents);
    expect(Number((store.db.prepare("SELECT COUNT(*) AS count FROM runtime_jobs").get() as { count: number }).count)).toBe(0);
    expect(Number((store.db.prepare("SELECT COUNT(*) AS count FROM research_case_commands").get() as { count: number }).count)).toBe(0);
    expect(Number((store.db.prepare("SELECT COUNT(*) AS count FROM action_executions").get() as { count: number }).count)).toBe(beforeActions);
  });

  it("rejects commands after a terminal transition without writing a command record", () => {
    store = new RuntimeStore(":memory:");
    const service = new ResearchCaseService(store);
    const researchCase = service.create(input);
    const cancelled = service.execute(researchCase.id, { type: "cancel", expectedVersion: 1, idempotencyKey: "cancel-terminal", payload: {} }).researchCase;

    expect(() => service.execute(researchCase.id, { type: "confirm_plan", expectedVersion: cancelled.version, idempotencyKey: "after-terminal", payload: {} }))
      .toThrow(InvalidStateTransitionError);
    expect(Number((store.db.prepare("SELECT COUNT(*) AS count FROM research_case_commands WHERE idempotency_key='after-terminal'").get() as { count: number }).count)).toBe(0);
  });

  it("drives material, evidence and judgment revision through the v2 command boundary", () => {
    store = new RuntimeStore(":memory:");
    const service = new ResearchCaseService(store);
    const researchCase = service.create(input);

    let version = service.execute(researchCase.id, { type: "confirm_plan", expectedVersion: 1, idempotencyKey: "flow-plan", payload: {} }).researchCase.version;
    version = service.execute(researchCase.id, { type: "attach_material", expectedVersion: version, idempotencyKey: "flow-material-a", payload: material("issuer-a", "终端需求、客户订单和合同同比增长，收入、利润、毛利与现金流改善，管理层预期产品结构升级机制继续驱动增长，并披露估值敏感性和下行风险") }).researchCase.version;
    version = service.execute(researchCase.id, { type: "attach_material", expectedVersion: version, idempotencyKey: "flow-material-b", payload: material("issuer-b", "有效供给、库存、价格、市场份额和产能利用率连续两个季度改善，竞争位置与资本开支保持稳定") }).researchCase.version;

    const planJob = store.queue.claimJob("v2-test-worker")!;
    expect(planJob.taskId).toBe(researchCase.taskId);
    expect(service.kernel.executeTask(researchCase.taskId).status).toBe("waiting_approval");
    store.queue.finishJob(planJob.id, "v2-test-worker");
    expect(store.listPendingApprovals(researchCase.conversationId)[0].kind).toBe("evidence_confirmation");

    let approval = store.listPendingApprovals(researchCase.conversationId)[0];
    let evidenceRound = 0;
    while (approval?.kind === "evidence_confirmation") {
      version = service.execute(researchCase.id, { type: "confirm_evidence", expectedVersion: version, idempotencyKey: `flow-evidence-${evidenceRound++}`, payload: {} }).researchCase.version;
      const evidenceJob = store.queue.claimJob("v2-test-worker")!;
      expect(service.kernel.executeTask(researchCase.taskId).status).toBe("waiting_approval");
      store.queue.finishJob(evidenceJob.id, "v2-test-worker");
      approval = store.listPendingApprovals(researchCase.conversationId)[0];
    }
    expect(approval.kind).toBe("judgment_confirmation");
    expect(store.listArtifacts(researchCase.taskId).some((artifact) => artifact.kind === "report")).toBe(false);

    const judgment = store.listArtifacts(researchCase.taskId).find((artifact) => artifact.kind === "judgment" && artifact.nodeId === approval.nodeId)!;
    const signalInputs = (judgment.data as { signalInputs: Array<{ evidenceFactRef: string }> }).signalInputs;
    version = service.execute(researchCase.id, {
      type: "revise_judgment", expectedVersion: version, idempotencyKey: "flow-revise-judgment",
      payload: {
        artifactId: judgment.id,
        artifactExpectedVersion: judgment.version,
        changes: {
          statement: "经营改善有条件成立，仍需跟踪订单兑现和现金流",
          confidence: "medium",
          changeConditions: ["订单连续两个季度低于预期"],
          signalRoles: Object.fromEntries(signalInputs.map((item) => [item.evidenceFactRef, "support"])),
        },
      },
    }).researchCase.version;
    const revisedApproval = store.listPendingApprovals(researchCase.conversationId).find((item) => item.nodeId === approval.nodeId)!;
    version = service.execute(researchCase.id, { type: "approve_judgment", expectedVersion: version, idempotencyKey: "flow-approve-judgment", payload: {} }).researchCase.version;

    expect(version).toBe(6 + evidenceRound);
    expect(revisedApproval.status).toBe("pending");
    expect(store.getArtifact(judgment.id)).toMatchObject({ version: 3, status: "verified" });
    expect(store.listEvents(researchCase.conversationId).some((event) => event.type === "judgment.committed")).toBe(true);
  });

  it("reopens a crashed case and recovers its leased job from checkpoint and lifecycle events", () => {
    const directory = mkdtempSync(join(tmpdir(), "research-case-v2-recovery-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "research-v2.sqlite");
    store = new RuntimeStore(databasePath);
    let service = new ResearchCaseService(store);
    const researchCase = service.create(input);
    service.execute(researchCase.id, { type: "confirm_plan", expectedVersion: 1, idempotencyKey: "recovery-plan", payload: {} });
    const leased = store.queue.claimJob("crashed-worker")!;
    store.db.prepare("UPDATE runtime_jobs SET locked_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(leased.id);
    expect(store.latestCheckpoint(researchCase.taskId)).not.toBeNull();
    store.close();

    store = new RuntimeStore(databasePath);
    service = new ResearchCaseService(store);
    expect(service.get(researchCase.id)).toMatchObject({ version: 2, status: "active" });
    expect(store.queue.recoverStaleJobs()).toBe(1);
    expect(store.queue.claimJob("recovery-worker")?.taskId).toBe(researchCase.taskId);
    const events = store.listEvents(researchCase.conversationId);
    expect(events.some((event) => event.type === "job.failed" && (event.payload as { jobId?: string }).jobId === leased.id)).toBe(true);
    expect(events.some((event) => event.type === "job.queued" && (event.payload as { jobId?: string }).jobId === leased.id)).toBe(true);
  });
});
