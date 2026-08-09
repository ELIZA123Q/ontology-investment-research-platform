import { afterEach, describe, expect, it } from "vitest";
import { AgentKernel } from "@/src/runtime/kernel";
import { RuntimeStore } from "@/src/runtime/store";

const stores: RuntimeStore[] = [];
const setup = () => { const store = new RuntimeStore(":memory:"); stores.push(store); return { store, kernel: new AgentKernel(store), conversation: store.createConversation("先进封装") }; };
afterEach(() => { while (stores.length) stores.pop()?.close(); });

describe("single-agent vertical slice", () => {
  it("plans, waits for approval, queues and completes without fabricating evidence", () => {
    const { store, kernel, conversation } = setup();
    const submitted = kernel.submitGoal(conversation.id, "研究未来六个月先进封装需求变化，给出判断与改判条件");
    expect(submitted.task.status).toBe("waiting_approval");
    expect(submitted.approval?.status).toBe("pending");
    kernel.decideApproval(submitted.approval!.id, "approved");
    const job = store.claimJob();
    expect(job?.taskId).toBe(submitted.task.id);
    const settled = kernel.executeTask(submitted.task.id);
    store.finishJob(job!.id);
    expect(settled.status).toBe("completed");
    const artifacts = store.listArtifacts(submitted.task.id);
    const judgment = artifacts.find((artifact) => artifact.kind === "judgment");
    expect(judgment?.data).toMatchObject({ disposition: "abstain", statement: "暂不可判断" });
    const report = artifacts.find((artifact) => artifact.kind === "report");
    expect(report?.sourceRefs).toEqual([]);
    expect((report?.data as { claims: unknown[] }).claims).toEqual([]);
  });

  it("checkpoints milestones, not every event", () => {
    const { store, kernel, conversation } = setup();
    const submitted = kernel.submitGoal(conversation.id, "研究先进封装需求，并输出证据和判断");
    kernel.decideApproval(submitted.approval!.id, "approved");
    kernel.executeTask(submitted.task.id);
    const eventCount = Number((store.db.prepare("SELECT COUNT(*) count FROM run_events WHERE task_id=?").get(submitted.task.id) as { count: number }).count);
    const checkpointCount = Number((store.db.prepare("SELECT COUNT(*) count FROM checkpoints WHERE task_id=?").get(submitted.task.id) as { count: number }).count);
    expect(eventCount).toBeGreaterThan(checkpointCount);
    expect(checkpointCount).toBeGreaterThanOrEqual(4);
  });

  it("branches a task without mutating the parent", () => {
    const { store, kernel, conversation } = setup();
    const parent = kernel.submitGoal(conversation.id, "研究 2025-2026 年先进封装需求变化").task;
    const branch = kernel.branchTask(parent.id, "把时间范围改为未来六个月并更新判断");
    expect(branch.parentTaskId).toBe(parent.id);
    expect(branch.intent).toBe("update_judgment");
    expect(store.getTask(parent.id)?.goal).toContain("2025-2026");
  });
});
