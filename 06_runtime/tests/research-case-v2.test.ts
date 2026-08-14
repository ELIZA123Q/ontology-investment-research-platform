import { afterEach, describe, expect, it } from "vitest";
import { RuntimeStore } from "@/src/runtime/store";
import { CaseVersionConflictError, ResearchCaseService } from "@/src/runtime-v2/research-case-service";
import { InvalidStateTransitionError } from "@/src/runtime/state-machine";

let store: RuntimeStore | undefined;
afterEach(() => store?.close());

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

describe("ResearchCase v2", () => {
  it("creates a governed company case on a fresh schema", () => {
    store = new RuntimeStore(":memory:");
    const service = new ResearchCaseService(store);
    const researchCase = service.create(input);
    expect(researchCase).toMatchObject({ version: 1, companyCode: "688261", status: "draft" });
    const snapshot = service.snapshot(researchCase.id);
    expect(snapshot.runtime.task?.reportSpec.kind).toBe("company_research");
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
});
