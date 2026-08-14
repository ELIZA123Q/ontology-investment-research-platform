import { afterEach, describe, expect, it } from "vitest";
import { AgentKernel } from "@/src/runtime/kernel";
import { RuntimeStore } from "@/src/runtime/store";
import { buildHomeView, buildPublicLibraryView } from "@/src/ui/view-models";

const stores: RuntimeStore[] = [];
const makeStore = () => { const store = new RuntimeStore(":memory:"); stores.push(store); return store; };
afterEach(() => { while (stores.length) stores.pop()?.close(); });

describe("AI-native frontend view models", () => {
  it("builds one home payload with progress, result and attention", () => {
    const store = makeStore();
    const kernel = new AgentKernel(store);
    const conversation = store.createConversation("先进封装判断");
    const submitted = kernel.submitGoal(conversation.id, "研究未来六个月先进封装需求变化，并给出改判条件");
    const view = buildHomeView(store);
    expect(view.research).toHaveLength(1);
    expect(view.research[0]).toMatchObject({ pendingApprovalCount: 1, progress: { completed: 0 } });
    expect(view.attention[0]).toMatchObject({ kind: "approval", taskId: submitted.task.id });
    expect(view.signals).toMatchObject({ available: false, items: [] });
    expect(view.connections).toMatchObject({ configured: false, allowedConnectorIds: [], observedConnectorIds: [], sourceCaptureCount: 0, financialBatchCount: 0 });
  });

  it("scopes the complete home projection to the authenticated tenant and user", () => {
    const store = makeStore();
    const own = store.createConversation("own", { tenantId: "tenant-a", userId: "analyst-a" });
    const sameTenantOtherUser = store.createConversation("same tenant", { tenantId: "tenant-a", userId: "analyst-b" });
    const foreign = store.createConversation("foreign", { tenantId: "tenant-b", userId: "analyst-a" });
    for (const conversation of [own, sameTenantOtherUser, foreign]) {
      store.createTask({ conversationId: conversation.id, goal: conversation.title, intent: "full_research", status: "running", budget: { maxModelCalls: 1, maxToolCalls: 1, maxCostUsd: 1 } });
    }
    expect(buildHomeView(store, { tenantId: "tenant-a", userId: "analyst-a", roles: ["research_owner"] }).research.map((item) => item.conversation.id)).toEqual([own.id]);
    expect(buildHomeView(store, { tenantId: "tenant-a", userId: "admin-a", roles: ["tenant_admin"] }).research.map((item) => item.conversation.id).sort()).toEqual([own.id, sameTenantOtherUser.id].sort());
  });

  it("surfaces an orphaned approval state as a recoverable integrity issue", () => {
    const store = makeStore();
    const conversation = store.createConversation("缺失审批请求");
    const task = store.createTask({ conversationId: conversation.id, goal: "判断供应链变化", intent: "full_research", status: "waiting_approval", budget: { maxModelCalls: 1, maxToolCalls: 1, maxCostUsd: 1 } });

    const view = buildHomeView(store);

    expect(view.attention).toEqual([expect.objectContaining({ id: `integrity:${task.id}`, kind: "failure", taskId: task.id })]);
    expect(view.counts.needsAttention).toBe(1);
  });

  it("exposes only current released global knowledge and never candidates", () => {
    const store = makeStore();
    const conversation = store.createConversation("候选来源");
    const task = store.createTask({ conversationId: conversation.id, goal: "测试", intent: "full_research", status: "completed", budget: { maxModelCalls: 1, maxToolCalls: 1, maxCostUsd: 1 } });
    const lock = store.createKnowledgeLock(task.id);
    const mining = store.createMiningRun(task.id, "test/1");
    const candidateRevision = store.putAssetRevision({ assetId: "candidate:private", kind: "method", scope: { kind: "global" }, status: "candidate", content: { title: "未发布候选" }, provenanceRefs: ["test"], supersedes: [] });
    store.putCandidate({ miningRunId: mining.id, taskId: task.id, scope: { kind: "global" }, assetKind: "method", operation: "add", identityKey: "method:private", proposedRevisionId: candidateRevision.id, provenanceRefs: ["test"], runBaselineFingerprint: lock.fingerprint, currentBaselineFingerprint: store.currentBaselineFingerprint({ kind: "global" }), riskLevel: 1, confidence: .8, novelty: 1, conflicts: [], status: "proposed" });
    const library = buildPublicLibraryView(store);
    expect(library.items.length).toBeGreaterThan(0);
    expect(library.items.every((item) => item.revision.status === "released" && item.revision.scope.kind === "global")).toBe(true);
    expect(library.items.some((item) => item.title === "未发布候选")).toBe(false);
  });

  it("returns task history and allows selecting an older branch", () => {
    const store = makeStore();
    const kernel = new AgentKernel(store);
    const conversation = store.createConversation("任务历史");
    const first = kernel.submitGoal(conversation.id, "研究 2026 年先进封装供需变化").task;
    const branch = kernel.branchTask(first.id, "把时间范围改为未来六个月并更新判断");
    const latest = kernel.snapshot(conversation.id);
    const selected = kernel.snapshot(conversation.id, first.id);
    expect(latest.activeTaskId).toBe(branch.id);
    expect(latest.tasks).toHaveLength(2);
    expect(selected.activeTaskId).toBe(first.id);
    expect(selected.task?.goal).toContain("2026 年");
  });

  it("accepts only accessible released assets as pinned context", () => {
    const store = makeStore();
    const kernel = new AgentKernel(store);
    const conversation = store.createConversation("固定知识");
    const accessible = store.listReleasedAssetRefs(conversation);
    const submitted = kernel.submitGoal(conversation.id, "基于权威本体研究先进封装", undefined, { pinnedAssetRefs: [accessible[0]] });
    const event = store.listEvents(conversation.id).find((item) => item.taskId === submitted.task.id && item.type === "context.pinned");
    expect(event?.payload).toMatchObject({ assetRefs: [{ assetId: accessible[0].assetId }] });
    expect(() => kernel.submitGoal(conversation.id, "使用未发布知识继续研究", undefined, { pinnedAssetRefs: [{ ...accessible[0], assetId: "candidate:not-released" }] })).toThrow(/current accessible Release/);
  });
});
