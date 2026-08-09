import { createHash } from "node:crypto";
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

  it("pauses for evidence and judgment confirmation before composing a supported report", () => {
    const { store, kernel, conversation } = setup();
    const candidates = [
      { id: "source:a", uri: "https://issuer-a.test/report", title: "来源 A", sourceType: "primary" as const, locator: "p1", discoveryReason: "test", discoveredAt: "2026-08-09T00:00:00.000Z" },
      { id: "source:b", uri: "https://issuer-b.test/report", title: "来源 B", sourceType: "primary" as const, locator: "p2", discoveryReason: "test", discoveredAt: "2026-08-09T00:00:00.000Z" },
    ];
    kernel.sources.discover = () => candidates;
    kernel.sources.capture = (candidate) => {
      const quote = candidate.id === "source:a" ? "需求同比增长 30%" : "产能利用率连续两个季度提升";
      const body = JSON.stringify({ quote });
      const hash = `sha256:${createHash("sha256").update(body).digest("hex")}`;
      return kernel.provenance.saveSnapshot({
        candidateId: candidate.id, uri: candidate.uri, title: candidate.title, sourceType: candidate.sourceType,
        locator: candidate.locator!, quote, body, contentHash: hash, capturedAt: "2026-08-09T00:01:00.000Z",
        publisherId: new URL(candidate.uri).hostname, permissionScope: "public_research_use",
        acquisition: { connectorId: "test", upstreamSourceId: candidate.id, requestFingerprint: hash, requestParameters: {}, rawResponseHash: hash, retrievedAt: "2026-08-09T00:01:00.000Z" },
      });
    };

    const submitted = kernel.submitGoal(conversation.id, "研究未来六个月先进封装需求，给出判断和报告");
    kernel.decideApproval(submitted.approval!.id, "approved");
    expect(kernel.executeTask(submitted.task.id).status).toBe("waiting_approval");
    const evidenceApproval = store.listPendingApprovals(conversation.id)[0];
    expect(evidenceApproval.kind).toBe("evidence_confirmation");

    kernel.decideApproval(evidenceApproval.id, "approved");
    expect(kernel.executeTask(submitted.task.id).status).toBe("waiting_approval");
    const judgmentApproval = store.listPendingApprovals(conversation.id)[0];
    expect(judgmentApproval.kind).toBe("judgment_confirmation");
    expect(store.listArtifacts(submitted.task.id).some((artifact) => artifact.kind === "report")).toBe(false);

    const judgment = store.listArtifacts(submitted.task.id).find((artifact) => artifact.kind === "judgment")!;
    const revision = kernel.reviseArtifact(judgment.id, judgment.version, {
      statement: "先进封装需求有条件改善，仍需跟踪终端订单兑现",
      confidence: "medium",
      changeConditions: ["终端订单连续两个季度低于预期", "新增产能利用率转弱"],
    });
    expect(revision.artifact.version).toBe(2);
    expect(revision.approval?.kind).toBe("judgment_confirmation");
    expect(store.getApproval(judgmentApproval.id)?.status).toBe("rejected");

    kernel.decideApproval(revision.approval!.id, "approved");
    expect(kernel.executeTask(submitted.task.id).status).toBe("completed");
    const report = store.listArtifacts(submitted.task.id).find((artifact) => artifact.kind === "report");
    expect(report?.data).toMatchObject({ summary: "先进封装需求有条件改善，仍需跟踪终端订单兑现" });
  });

  it("branches a task without mutating the parent", () => {
    const { store, kernel, conversation } = setup();
    const parent = kernel.submitGoal(conversation.id, "研究 2025-2026 年先进封装需求变化").task;
    const branch = kernel.branchTask(parent.id, "把时间范围改为未来六个月并更新判断");
    expect(branch.parentTaskId).toBe(parent.id);
    expect(branch.researchCaseId).toBe(parent.researchCaseId);
    expect(branch.intent).toBe("update_judgment");
    expect(store.getTask(parent.id)?.goal).toContain("2025-2026");
  });

  it("creates a 4.0 ResearchCase when branching a legacy task without one", () => {
    const { store, kernel, conversation } = setup();
    const legacy = store.createTask({ conversationId: conversation.id, goal: "历史 3.0 任务", intent: "full_research", status: "completed", budget: { maxModelCalls: 1, maxToolCalls: 1, maxCostUsd: 1 } });
    expect(kernel.actions.ontology.getObject(legacy.researchCaseId)).toBeNull();
    const branch = kernel.branchTask(legacy.id, "使用 4.0 局部复核");
    expect(kernel.actions.ontology.getObject(branch.researchCaseId)?.type).toBe("ResearchCase");
    expect(store.getTask(legacy.id)?.researchCaseId).toBe(legacy.id);
  });

  it("records compiler diagnostics and never materializes model-invented nodes", () => {
    const { store, kernel, conversation } = setup();
    const submitted = kernel.submitGoal(conversation.id, "只取证：研究 HBM 供需", {
      intent: "full_research",
      rationale: "跳过取证",
      nodes: [{ key: "remote", kind: "remote_agent_magic", title: "直接生成结论", dependsOn: [] }],
      stopConditions: [],
    });
    expect(store.listTaskNodes(submitted.task.id).some((node) => node.kind === "remote_agent_magic")).toBe(false);
    expect(store.listTaskNodes(submitted.task.id).map((node) => node.kind)).toEqual(["semantic_context", "evidence_discovery", "evidence_capture", "evidence_evaluation"]);
    const compilerEvent = store.listEvents(conversation.id).find((event) => event.type === "planner.compiled");
    expect(compilerEvent?.payload).toMatchObject({ source: "repaired_proposal" });
    expect((compilerEvent?.payload as { diagnostics: Array<{ code: string }> }).diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["intent_mismatch", "unknown_node", "missing_node"]));
  });
});
