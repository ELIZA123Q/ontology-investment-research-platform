import { afterEach, describe, expect, it } from "vitest";
import { KnowledgeBundleLoader } from "@investment/knowledge";
import { RuntimeStore } from "@/src/runtime/store";
import { WorkbenchApplicationService } from "@/src/application/workbench-service";
import { KnowledgeLearningService } from "@/src/knowledge/service";
import { resolve } from "node:path";

const stores: RuntimeStore[] = [];
afterEach(() => { while (stores.length) stores.pop()?.close(); });

describe("versioned knowledge bundle integration", () => {
  it("locks every ResearchCase run to the current immutable bundle", () => {
    const loader = new KnowledgeBundleLoader(resolve(process.cwd(), ".data/knowledge-bundles"));
    const current = loader.loadCurrent();
    const store = new RuntimeStore(":memory:"); stores.push(store);
    const app = new WorkbenchApplicationService(store);
    const created = app.createResearchCase({
      companyCode: "688261", companyName: "东微半导", asOf: "2025-12-31T00:00:00.000Z",
      researchQuestion: "业绩快报如何影响既有命题？", primaryLens: "fundamental", counterLens: "expectation_gap",
      reportSpec: { kind: "company_research", audience: "research_analyst", depth: "standard" }, sourcePolicy: {},
    });
    expect(created.bundleId).toBe(current.manifest.bundleId);
    const snapshot = app.researchCaseSnapshot(created.id);
    expect(snapshot.knowledgeRunLock).toMatchObject({ researchCaseId: created.id, bundleId: current.manifest.bundleId });
    expect(snapshot.runtime.events.some((event) => event.type === "knowledge.bundle.locked")).toBe(true);
  });

  it("materializes approved knowledge into the next run without silently mutating the base bundle", () => {
    const store = new RuntimeStore(":memory:"); stores.push(store);
    const app = new WorkbenchApplicationService(store);
    const conversation = store.createConversation("知识晋级");
    const task = store.createTask({ conversationId: conversation.id, goal: "研究业绩更新知识复用", intent: "full_research", status: "completed", budget: { maxModelCalls: 1, maxToolCalls: 1, maxCostUsd: 1 } });
    store.knowledge.createKnowledgeLock(task.id, "2025-12-31T00:00:00.000Z");
    store.putArtifact({ conversationId: conversation.id, taskId: task.id, kind: "research_plan", title: "研究方法", status: "verified", data: { method: "业绩更新口径复核", exitCondition: "口径不完整则停止" }, sourceRefs: [], createdBy: "research-lead" });
    new KnowledgeLearningService(store).runMining(task.id);
    const topic = store.knowledge.listCandidates({ taskId: task.id }).find((item) => item.assetKind === "topic_index")!;
    expect(app.decideKnowledgeCandidate({ candidateId: topic.id, decision: "approved", reviewer: "治理员", reviewerRole: "governance_owner", note: "范围与来源检查均已通过" }).status).toBe("approved");
    const published = app.publishKnowledgeRelease([topic.id], "治理员");

    const created = app.createResearchCase({
      companyCode: "688261", companyName: "东微半导", asOf: "2026-03-31T00:00:00.000Z",
      researchQuestion: "复用已批准方法开展下一次业绩更新", primaryLens: "fundamental", counterLens: "expectation_gap",
      reportSpec: { kind: "company_research", audience: "research_analyst", depth: "standard" }, sourcePolicy: {},
    });
    expect(created.bundleId).not.toBe(published.knowledgeBundleId);
    const effective = new KnowledgeBundleLoader(resolve(process.cwd(), ".data/knowledge-bundles")).load(created.bundleId!);
    expect(Object.keys(effective.bundle.index.assetsById).some((id) => id.startsWith("released:"))).toBe(true);
    expect(store.knowledge.getKnowledgeLock(app.getResearchCase(created.id)!.taskId)?.assetRefs.some((ref) => ref.assetId === topic.targetAssetRef?.assetId || ref.identityKey === topic.identityKey)).toBe(true);
  });
});
