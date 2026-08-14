import { afterEach, describe, expect, it } from "vitest";
import { evaluateJudgmentThreshold } from "@/src/governance/judgment-threshold";
import { normalizeResearchLanguage } from "@/src/semantic/dictionary-normalizer";
import { buildResearchProblemGraph, selectTaskMotifs, selectWorkflowPattern } from "@/src/runtime/problem-graph";
import { planFromProblemGraph } from "@/src/runtime/planner";
import { AgentKernel } from "@/src/runtime/kernel";
import { RuntimeStore } from "@/src/runtime/store";

const stores: RuntimeStore[] = [];
afterEach(() => { while (stores.length) stores.pop()?.close(); });

describe("01-05 generated Runtime projections", () => {
  it("normalizes aliases and deprecated terms and expands slash-separated ambiguity terms", () => {
    const result = normalizeResearchLanguage("企业 Segment 很紧，需要核验来源快照");
    expect(result.normalizedText).toContain("公司 产业链环节");
    expect(result.canonicalRefs).toEqual(expect.arrayContaining(["ontology:Company", "ontology:ValueChainSegment"]));
    expect(result.ambiguities.map((item) => item.matchedTerm)).toEqual(expect.arrayContaining(["很紧", "快照"]));
  });

  it("selects exactly one governed Workflow Pattern for every executable intent/depth", () => {
    expect(selectWorkflowPattern("full_research", "deep").workflow_id).toBe("deep_research");
    expect(selectWorkflowPattern("full_research", "standard").workflow_id).toBe("quick_research");
    expect(selectWorkflowPattern("update_judgment", "deep").workflow_id).toBe("quick_research");
    expect(selectWorkflowPattern("evidence_only", "brief").workflow_id).toBe("evidence_only");
  });

  it("projects Scenario lifecycle constraints and makes evidence-only a true evidence frontier", () => {
    const store = new RuntimeStore(":memory:"); stores.push(store);
    const conversation = store.createConversation("domain projection");
    const task = store.createTask({ conversationId: conversation.id, goal: "只取证：半导体库存与价格", intent: "evidence_only", status: "planned", budget: { maxModelCalls: 4, maxToolCalls: 10, maxCostUsd: 1 } });
    const graph = store.createProblemGraph(buildResearchProblemGraph({ taskId: task.id, researchCaseId: task.researchCaseId, goal: task.goal, intent: task.intent, reportDepth: "brief" }));
    const root = graph.nodes.find((node) => node.type === "root_question")!;
    expect(root.payload.workflowPatternRef).toBe("evidence_only");
    expect(root.payload.scenarioContracts).toEqual(expect.arrayContaining([expect.objectContaining({ entryConditions: expect.any(Array), completionConditions: expect.any(Array), invalidationConditions: expect.any(Array), updateTriggers: expect.any(Array) })]));
    const plan = planFromProblemGraph(graph, task.budget);
    expect(plan.nodes.some((node) => node.kind === "evidence_evaluation")).toBe(true);
    expect(plan.nodes.some((node) => ["judgment", "synthesis", "compose", "audit"].includes(node.kind))).toBe(false);
    expect(plan.stopConditions.some((condition) => condition.startsWith("scenario entry must hold:"))).toBe(true);
  });

  it("selects composite company coverage without duplicating the narrow company-analysis motif", () => {
    const motifs = selectTaskMotifs("对东微半导开展结构化公司基本面研究", ["fundamental", "quality"]);
    expect(motifs.map((task) => task.task_id)).toEqual(["company_coverage"]);
  });

  it("uses the lowest policy cap for the maximum Judgment level", () => {
    expect(evaluateJudgmentThreshold({ evidenceGrade: "Q4", counterevidenceStatus: "contested", pathReadiness: "ready" }).maxLevel).toBe("J1");
    expect(evaluateJudgmentThreshold({ evidenceGrade: "Q3", counterevidenceStatus: "cleared", pathReadiness: "restricted" }).maxLevel).toBe("J2");
    expect(evaluateJudgmentThreshold({ evidenceGrade: "Q4", counterevidenceStatus: "cleared", pathReadiness: "ready" }).maxLevel).toBe("J4");
  });

  it("assembles every required 04 Context section with provenance and permission metadata", () => {
    const store = new RuntimeStore(":memory:"); stores.push(store);
    const kernel = new AgentKernel(store);
    const conversation = store.createConversation("context projection");
    const submitted = kernel.submitGoal(conversation.id, "研究半导体行业库存周期与价格拐点");
    kernel.decideApproval(submitted.approval!.id, "approved");
    const contextNode = store.listTaskNodes(submitted.task.id).find((node) => node.kind === "semantic_context")!;
    kernel.executeTaskNode(submitted.task.id, contextNode.id);
    const context = store.getContextPackage(submitted.task.id, contextNode.id)!;
    expect(context).toMatchObject({
      identity: { conversationId: conversation.id, taskId: submitted.task.id, nodeId: contextNode.id },
      task: { goal: submitted.task.goal },
      state: { pendingApprovalIds: expect.any(Array) },
      workspace: { workspaceId: `workspace:${submitted.task.id}`, resourceRefs: expect.any(Array) },
      memory: { refs: expect.any(Array) },
      knowledge: { assetRefs: expect.any(Array) },
      capabilities: { agentId: "research-lead", assumedRoleIds: ["research_lead"] },
      policies: { policyRefs: expect.any(Array), permissionFilterResult: { decision: "allowed" } },
      permissionFilterResult: { decision: "allowed" },
    });
    expect(context.references.every((reference) => reference.reason && reference.freshnessAt)).toBe(true);
  });
});
