import { afterEach, describe, expect, it } from "vitest";
import { AgentKernel } from "@/src/runtime/kernel";
import { RuntimeStore } from "@/src/runtime/store";
import { buildHomeView } from "@/src/ui/view-models";

const stores: RuntimeStore[] = [];
afterEach(() => { while (stores.length) stores.pop()?.close(); });

describe("platform architecture acceptance", () => {
  it.each([
    ["company", "研究贵州茅台收入质量与现金流，列出改判条件"],
    ["industry", "研究半导体行业景气与供需冲突证据"],
    ["macro", "研究全球通胀变化对资产配置的影响"],
    ["event", "评估出口管制事件对产业链的影响并保留竞争解释"],
  ])("materializes governed problem-frontier nodes for a %s task", (_kind, goal) => {
    const store = new RuntimeStore(":memory:"); stores.push(store);
    const kernel = new AgentKernel(store);
    const conversation = store.createConversation(String(_kind));
    const submitted = kernel.submitGoal(conversation.id, goal);
    const nodes = store.listTaskNodes(submitted.task.id);
    expect(nodes.length).toBeGreaterThanOrEqual(5);
    expect(nodes.every((node) => node.frontierRef.problemGraphId === `problem-graph:${submitted.task.id}` && node.iteration === 0)).toBe(true);
    expect(nodes.some((node) => node.kind === "evidence_discovery")).toBe(true);
    expect(nodes.some((node) => node.kind === "evidence_evaluation")).toBe(true);
    expect(submitted.approval).toMatchObject({ kind: "plan_confirmation", status: "pending" });
    expect(buildHomeView(store).actions.items).toEqual(expect.arrayContaining([expect.objectContaining({ approvalId: submitted.approval!.id })]));
  });

  it("abstains instead of fabricating evidence and still produces a traceable, unpublished artifact", () => {
    const store = new RuntimeStore(":memory:"); stores.push(store);
    const kernel = new AgentKernel(store);
    const conversation = store.createConversation("缺证架构验收");
    const submitted = kernel.submitGoal(conversation.id, "研究一个没有可核验材料的新主题，禁止猜测");
    kernel.decideApproval(submitted.approval!.id, "approved");
    expect(kernel.executeTask(submitted.task.id).status).toBe("waiting_approval");
    const artifacts = store.listArtifacts(submitted.task.id);
    expect(artifacts.find((artifact) => artifact.kind === "judgment")?.data).toMatchObject({ disposition: "abstain", statement: "暂不可判断" });
    const report = artifacts.find((artifact) => artifact.kind === "report")!;
    expect(report).toMatchObject({ status: "verified", sourceRefs: [] });
    expect((report.data as { publication: { status: string }; claims: unknown[] }).publication.status).toBe("verified_not_published");
    expect((report.data as { claims: unknown[] }).claims).toEqual([]);
    expect(store.listPendingApprovals(conversation.id)[0]).toMatchObject({ kind: "publish_confirmation", status: "pending" });
  });
});
