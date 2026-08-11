import { afterEach, describe, expect, it } from "vitest";
import { AgentKernel } from "@/src/runtime/kernel";
import { RuntimeStore } from "@/src/runtime/store";

const stores: RuntimeStore[] = [];
afterEach(() => { while (stores.length) stores.pop()?.close(); });

describe("Research Problem Graph compilation", () => {
  it("compiles industry motifs into isolated judgment-unit frontiers", () => {
    const store = new RuntimeStore(":memory:"); stores.push(store);
    const kernel = new AgentKernel(store);
    const conversation = store.createConversation("problem graph");
    const submitted = kernel.submitGoal(conversation.id, "研究半导体行业库存、价格拐点和产业链利润传导");
    const graph = store.getProblemGraph(submitted.task.id)!;
    const units = graph.nodes.filter((node) => node.type === "judgment_unit");
    expect(units.length).toBeGreaterThanOrEqual(2);
    for (const unit of units) {
      const requirements = graph.edges.filter((edge) => edge.toNodeId === unit.id && edge.relation === "requires" && graph.nodes.find((node) => node.id === edge.fromNodeId)?.type === "evidence_requirement");
      expect(requirements).toHaveLength(3);
    }
    const nodes = store.listTaskNodes(submitted.task.id);
    expect(nodes.every((node) => Boolean(node.frontierRef.problemGraphId))).toBe(true);
    expect(nodes.filter((node) => node.kind === "evidence_evaluation").every((node) => Boolean(node.frontierRef.evidenceRequirementRef) && Boolean(node.frontierRef.evidenceRole))).toBe(true);
  });

  it("materializes the reviewed graph only after plan confirmation", () => {
    const store = new RuntimeStore(":memory:"); stores.push(store);
    const kernel = new AgentKernel(store);
    const conversation = store.createConversation("approval boundary");
    const submitted = kernel.submitGoal(conversation.id, "研究公司业绩传导与竞争解释");
    expect(kernel.actions.ontology.listObjects("ResearchQuestion")).toHaveLength(0);
    kernel.decideApproval(submitted.approval!.id, "approved");
    expect(kernel.actions.ontology.listObjects("ResearchQuestion").length).toBeGreaterThan(0);
    expect(kernel.actions.ontology.listObjects("JudgmentUnit").length).toBeGreaterThan(0);
    expect(kernel.actions.ontology.listObjects("EvidenceRequirement").length).toBeGreaterThan(0);
    expect(store.getProblemGraph(submitted.task.id)?.status).toBe("active");
  });

  it("queues only dependency-ready nodes and preserves the per-task concurrency cap", () => {
    const store = new RuntimeStore(":memory:"); stores.push(store);
    const kernel = new AgentKernel(store);
    const conversation = store.createConversation("scheduler");
    const submitted = kernel.submitGoal(conversation.id, "研究行业周期、产业链约束、公司业绩与技术成熟度");
    kernel.decideApproval(submitted.approval!.id, "approved");
    expect(kernel.dispatchTask(submitted.task.id)).toBeGreaterThan(0);
    const contextJob = store.claimNodeJob(3)!;
    kernel.executeTaskNode(contextJob.taskId, contextJob.nodeId);
    store.finishNodeJob(contextJob.id);
    const claimed = [store.claimNodeJob(3), store.claimNodeJob(3), store.claimNodeJob(3), store.claimNodeJob(3)].filter(Boolean);
    expect(claimed).toHaveLength(3);
  });
});
