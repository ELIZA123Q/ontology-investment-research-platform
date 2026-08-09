import { afterEach, describe, expect, it } from "vitest";
import type { AssetKind, KnowledgeMiner, KnowledgeScope, Task } from "@/src/contracts";
import { KnowledgeLearningService } from "@/src/knowledge/service";
import { AgentKernel } from "@/src/runtime/kernel";
import { RuntimeStore } from "@/src/runtime/store";

const stores: RuntimeStore[] = [];
const makeStore = () => { const store = new RuntimeStore(":memory:"); stores.push(store); return store; };
afterEach(() => { while (stores.length) stores.pop()?.close(); });

function terminalTask(store: RuntimeStore, tenantId = "tenant-a", userId = "user-a", intent: Task["intent"] = "full_research", goal = "研究先进封装") {
  const conversation = store.createConversation(goal, { tenantId, userId });
  const task = store.createTask({ conversationId: conversation.id, goal, intent, status: "completed", budget: { maxModelCalls: 1, maxToolCalls: 1, maxCostUsd: 1 } });
  store.createKnowledgeLock(task.id);
  return { conversation, task };
}

function manualCandidate(store: RuntimeStore, task: Task, scope: KnowledgeScope, kind: AssetKind, identityKey: string, content: Record<string, unknown>, riskLevel: 0 | 1 | 2 | 3, validity: { validFrom?: string; validTo?: string } = {}) {
  const mining = store.createMiningRun(task.id, "test/1");
  const revision = store.putAssetRevision({ assetId: `asset:${store.scopeKey(scope)}:${kind}:${identityKey}`, kind, scope, status: "candidate", content: { ...content, identityKey }, provenanceRefs: [`task:${task.id}`], supersedes: [], ...validity });
  const candidate = store.putCandidate({
    miningRunId: mining.id, taskId: task.id, scope, assetKind: kind, operation: "add", identityKey,
    proposedRevisionId: revision.id, provenanceRefs: [`task:${task.id}`],
    runBaselineFingerprint: store.getKnowledgeLock(task.id)!.fingerprint,
    currentBaselineFingerprint: store.currentBaselineFingerprint(scope), riskLevel, confidence: 0.9, novelty: 1, conflicts: [], status: "proposed",
  });
  store.putCandidateOccurrence({ candidateId: candidate.id, taskId: task.id });
  return candidate;
}

describe("knowledge learning loop", () => {
  it("locks released assets by scope and prevents cross-tenant leakage", () => {
    const store = makeStore();
    const first = terminalTask(store, "tenant-a", "u1");
    const scope: KnowledgeScope = { kind: "tenant", tenantId: "tenant-a" };
    const candidate = manualCandidate(store, first.task, scope, "failure_pattern", "failure:coverage", { reason: "coverage" }, 1);
    store.updateCandidate(candidate.id, { status: "approved", evaluationSummary: { passed: true, scoreDelta: 0.05, severeRegressions: 0, metrics: {} } });
    const release = store.publishRelease({ scope, candidateIds: [candidate.id], createdBy: "tester" });

    const a = terminalTask(store, "tenant-a", "u2", "full_research", "A 后续任务");
    const b = terminalTask(store, "tenant-b", "u2", "full_research", "B 后续任务");
    expect(store.getKnowledgeLock(a.task.id)?.tenantReleaseId).toBe(release.id);
    expect(store.getKnowledgeLock(a.task.id)?.assetRefs.some((ref) => ref.assetId.includes("failure:coverage"))).toBe(true);
    expect(store.getKnowledgeLock(b.task.id)?.assetRefs.some((ref) => ref.assetId.includes("failure:coverage"))).toBe(false);
    expect(store.getKnowledgeLock(a.task.id)?.assetRefs.filter((ref) => ref.authorityRef?.endsWith("registry.yaml"))).toHaveLength(5);
  });

  it("applies global, tenant, then user overlay precedence by stable identity", () => {
    const store = makeStore();
    const identity = "failure:shared";
    for (const [scope, value, task] of [
      [{ kind: "global" } as KnowledgeScope, "global", terminalTask(store, "tenant-a", "u1", "full_research", "global proposal").task],
      [{ kind: "tenant", tenantId: "tenant-a" } as KnowledgeScope, "tenant", terminalTask(store, "tenant-a", "u1", "full_research", "tenant proposal").task],
      [{ kind: "user", tenantId: "tenant-a", userId: "u1" } as KnowledgeScope, "user", terminalTask(store, "tenant-a", "u1", "full_research", "user proposal").task],
    ] as const) {
      const candidate = manualCandidate(store, task, scope, "failure_pattern", identity, { value }, 1);
      store.updateCandidate(candidate.id, { status: "approved" });
      store.publishRelease({ scope, candidateIds: [candidate.id], createdBy: "tester" });
    }
    const next = terminalTask(store, "tenant-a", "u1", "full_research", "优先级检查");
    const selected = store.getKnowledgeLock(next.task.id)!.assetRefs.filter((ref) => ref.identityKey === identity);
    expect(selected).toHaveLength(1);
    expect(selected[0].scope).toEqual({ kind: "user", tenantId: "tenant-a", userId: "u1" });
  });

  it("mines five asset streams deterministically and auto-releases only L1 memory", () => {
    const store = makeStore();
    const { task, conversation } = terminalTask(store);
    store.putArtifact({ conversationId: conversation.id, taskId: task.id, kind: "research_plan", title: "研究方法", status: "verified", data: { method: "证据三角验证", exitCondition: "不足则停止", variables: [{ ontology_node_id: "task_local:demand", name: "先进封装需求", category: "state", variable_kind: "level" }] }, sourceRefs: [], createdBy: "research-lead" });
    store.putArtifact({ conversationId: conversation.id, taskId: task.id, kind: "evidence_package", title: "证据评估", status: "verified", data: { facts: [], sufficient: false, stopReason: "缺少可核验一手来源" }, sourceRefs: [], createdBy: "research-lead" });
    const run = new KnowledgeLearningService(store).runMining(task.id);
    expect(run?.status).toBe("completed");
    const candidates = store.listCandidates({ taskId: task.id });
    expect(new Set(candidates.map((item) => item.assetKind))).toEqual(new Set(["ontology", "method", "failure_pattern", "eval_case", "topic_index"]));
    expect(candidates.find((item) => item.assetKind === "topic_index")?.status).toBe("released");
    expect(candidates.filter((item) => item.riskLevel >= 2).every((item) => item.status === "proposed")).toBe(true);
    expect(store.listMemory(conversation.id).some((item) => item.kind === "topic_index")).toBe(true);
    const next = terminalTask(store, "tenant-a", "user-a", "full_research", "后续任务");
    expect(store.getKnowledgeLock(next.task.id)?.userReleaseId).toBe(store.getCurrentRelease({ kind: "user", tenantId: "tenant-a", userId: "user-a" })?.id);
  });

  it("enforces replay thresholds and role-based approval before release", () => {
    const store = makeStore();
    const first = terminalTask(store, "tenant-a", "u1", "full_research", "任务一");
    const second = terminalTask(store, "tenant-a", "u1", "update_judgment", "任务二");
    const third = terminalTask(store, "tenant-a", "u1", "full_research", "任务三");
    const scope: KnowledgeScope = { kind: "tenant", tenantId: "tenant-a" };
    const candidate = manualCandidate(store, first.task, scope, "method", "method:triangulation", { name: "证据三角验证", evaluationScoreDelta: 0.06 }, 2);
    store.putCandidateOccurrence({ candidateId: candidate.id, taskId: second.task.id });
    store.putCandidateOccurrence({ candidateId: candidate.id, taskId: third.task.id });
    const service = new KnowledgeLearningService(store);
    const evaluated = service.evaluateCandidate(candidate.id);
    expect(evaluated.evaluationSummary).toMatchObject({ passed: true, scoreDelta: 0.06, severeRegressions: 0 });
    expect(() => service.decideCandidate({ candidateId: candidate.id, decision: "approved", reviewer: "张三", reviewerRole: "ontology_steward", note: "方法评测达到发布标准" })).toThrow(/role/);
    const approved = service.decideCandidate({ candidateId: candidate.id, decision: "approved", reviewer: "李四", reviewerRole: "method_owner", note: "跨任务回放通过并达到提升标准" });
    expect(approved.status).toBe("approved");
    const release = service.publishCandidates([candidate.id], "李四");
    expect(release.status).toBe("current");
    expect(store.getCandidate(candidate.id)?.status).toBe("released");
  });

  it("requires multi-role approval for L3 ontology changes", () => {
    const store = makeStore();
    const first = terminalTask(store, "tenant-a", "u1", "full_research", "任务一");
    const second = terminalTask(store, "tenant-a", "u1", "update_judgment", "任务二");
    const scope: KnowledgeScope = { kind: "tenant", tenantId: "tenant-a" };
    const candidate = manualCandidate(store, first.task, scope, "ontology", "ontology:demand", { name: "先进封装需求", compatibilityCheckPassed: true, impactReplayPassed: true }, 3);
    store.putCandidateOccurrence({ candidateId: candidate.id, taskId: second.task.id });
    const service = new KnowledgeLearningService(store);
    expect(service.evaluateCandidate(candidate.id).evaluationSummary?.passed).toBe(true);
    expect(service.decideCandidate({ candidateId: candidate.id, decision: "approved", reviewer: "A", reviewerRole: "ontology_steward", note: "语义定义和边界检查通过" }).status).toBe("review_required");
    expect(service.decideCandidate({ candidateId: candidate.id, decision: "approved", reviewer: "B", reviewerRole: "runtime_owner", note: "运行消费者影响检查通过" }).status).toBe("review_required");
    expect(service.decideCandidate({ candidateId: candidate.id, decision: "approved", reviewer: "C", reviewerRole: "independent_reviewer", note: "独立回归与冲突检查通过" }).status).toBe("approved");
  });

  it("promotes a Skill only after typed contracts and five-run, three-family replay evidence", () => {
    const store = makeStore();
    const tasks = [
      terminalTask(store, "tenant-a", "u1", "full_research", "skill-1").task,
      terminalTask(store, "tenant-a", "u1", "evidence_only", "skill-2").task,
      terminalTask(store, "tenant-a", "u1", "update_judgment", "skill-3").task,
      terminalTask(store, "tenant-a", "u1", "full_research", "skill-4").task,
      terminalTask(store, "tenant-a", "u1", "evidence_only", "skill-5").task,
    ];
    const scope: KnowledgeScope = { kind: "tenant", tenantId: "tenant-a" };
    const candidate = manualCandidate(store, tasks[0], scope, "skill", "skill:evidence-evaluation", {
      typedIO: { input: "EvidencePackage", output: "EvaluationResult" }, permissions: ["read_artifact"],
      failureStates: ["insufficient_evidence"], version: "1.0.0", costBudget: 0.5, latencyBudgetMs: 10_000,
      evaluationScoreDelta: 0.06, severeRegressions: 0,
    }, 3);
    for (const task of tasks.slice(1)) store.putCandidateOccurrence({ candidateId: candidate.id, taskId: task.id });
    const service = new KnowledgeLearningService(store);
    const evaluated = service.evaluateCandidate(candidate.id);
    expect(evaluated.evaluationSummary).toMatchObject({ passed: true, scoreDelta: 0.06, severeRegressions: 0 });
    expect(evaluated.evaluationSummary?.metrics).toMatchObject({ distinct_runs: 5, task_families: 3, skill_contract_valid: 1 });
    service.decideCandidate({ candidateId: candidate.id, decision: "approved", reviewer: "M", reviewerRole: "method_owner", note: "Skill 类型化契约已核验" });
    service.decideCandidate({ candidateId: candidate.id, decision: "approved", reviewer: "R", reviewerRole: "runtime_owner", note: "权限及成本延迟预算已核验" });
    const approved = service.decideCandidate({ candidateId: candidate.id, decision: "approved", reviewer: "I", reviewerRole: "independent_reviewer", note: "独立冻结回放无严重回归" });
    expect(approved.status).toBe("approved");
    service.publishCandidates([candidate.id], "method_owner");

    const kernel = new AgentKernel(store);
    const conversation = store.createConversation("后续使用 Skill", { tenantId: "tenant-a", userId: "u1" });
    const submitted = kernel.submitGoal(conversation.id, "评估新政策证据并输出判断");
    kernel.decideApproval(submitted.approval!.id, "approved");
    const job = store.claimJob()!;
    kernel.executeTask(submitted.task.id);
    store.finishJob(job.id);
    expect(store.listUsage(submitted.task.id).some((item) => item.assetRef.identityKey === "skill:evidence-evaluation" && item.outcome === "used")).toBe(true);
  });

  it("requires applicability and one primary or two independent secondary sources for temporal facts", () => {
    const store = makeStore();
    const { task } = terminalTask(store, "tenant-a", "u1");
    const scope: KnowledgeScope = { kind: "tenant", tenantId: "tenant-a" };
    const candidate = manualCandidate(store, task, scope, "temporal_fact", "fact:qualified", {
      subjectRef: "policy", predicate: "status", value: "effective", recordedAt: "2026-08-09",
      applicabilityScope: "CN semiconductor equipment", sourceRefs: ["source-1"],
      sourceQualifications: [{ sourceId: "source-1", sourceType: "primary", publisherId: "miit" }],
    }, 2);
    const evaluated = new KnowledgeLearningService(store).evaluateCandidate(candidate.id);
    expect(evaluated.evaluationSummary).toMatchObject({ passed: true });
    expect(evaluated.evaluationSummary?.metrics.temporal_valid).toBe(1);
  });

  it("supersedes temporal facts without deleting historical revisions", () => {
    const store = makeStore();
    const first = terminalTask(store, "tenant-a", "u1");
    const scope: KnowledgeScope = { kind: "tenant", tenantId: "tenant-a" };
    const initial = manualCandidate(store, first.task, scope, "temporal_fact", "fact:policy", { identityKey: "fact:policy", subjectRef: "policy", predicate: "status", value: "draft", recordedAt: "2026-01-01", sourceRefs: ["s1"] }, 1);
    store.updateCandidate(initial.id, { status: "approved" });
    store.publishRelease({ scope, candidateIds: [initial.id], createdBy: "tester" });
    const oldRevision = store.getAssetRevision(initial.proposedRevisionId)!;

    const second = terminalTask(store, "tenant-a", "u1", "update_judgment", "政策生效更新");
    const mining = store.createMiningRun(second.task.id, "test/1");
    const target = store.getReleasedAssetByIdentity("fact:policy", "temporal_fact", scope)!;
    const revision = store.putAssetRevision({ assetId: target.assetId, kind: "temporal_fact", scope, status: "candidate", content: { identityKey: "fact:policy", subjectRef: "policy", predicate: "status", value: "effective", recordedAt: "2026-02-01", sourceRefs: ["s2"] }, provenanceRefs: [`task:${second.task.id}`], supersedes: [oldRevision.id] });
    const update = store.putCandidate({ miningRunId: mining.id, taskId: second.task.id, scope, assetKind: "temporal_fact", operation: "modify", identityKey: "fact:policy", targetAssetRef: target, proposedRevisionId: revision.id, provenanceRefs: [`task:${second.task.id}`], runBaselineFingerprint: store.getKnowledgeLock(second.task.id)!.fingerprint, currentBaselineFingerprint: store.currentBaselineFingerprint(scope), riskLevel: 1, confidence: 0.9, novelty: 0.5, conflicts: [], status: "proposed" });
    store.updateCandidate(update.id, { status: "approved" });
    store.publishRelease({ scope, candidateIds: [update.id], createdBy: "tester" });
    const lineage = store.assetLineage(target.assetId);
    expect(lineage.revisions).toHaveLength(2);
    expect(lineage.revisions[0]).toMatchObject({ status: "deprecated" });
    expect(lineage.revisions[0].validTo).toBeTruthy();
    expect(lineage.revisions[1]).toMatchObject({ status: "released" });
  });

  it("filters temporal facts by KnowledgeLock asOf while retaining historical replay", () => {
    const store = makeStore();
    const scope: KnowledgeScope = { kind: "tenant", tenantId: "tenant-a" };
    const sourceTask = terminalTask(store, "tenant-a", "u1").task;
    const candidate = manualCandidate(store, sourceTask, scope, "temporal_fact", "fact:bounded", {
      subjectRef: "policy", predicate: "status", value: "effective", recordedAt: "2025-01-01",
      applicabilityScope: "CN", sourceRefs: ["s1"], sourceQualifications: [{ sourceId: "s1", sourceType: "primary", publisherId: "gov" }],
    }, 1, { validFrom: "2025-01-01T00:00:00.000Z", validTo: "2025-06-01T00:00:00.000Z" });
    store.updateCandidate(candidate.id, { status: "approved" });
    store.publishRelease({ scope, candidateIds: [candidate.id], createdBy: "tester" });

    const conversation = store.createConversation("时态回放", { tenantId: "tenant-a", userId: "u1" });
    const historical = store.createTask({ conversationId: conversation.id, goal: "historical", intent: "full_research", status: "completed", budget: { maxModelCalls: 1, maxToolCalls: 1, maxCostUsd: 1 } });
    const historicalLock = store.createKnowledgeLock(historical.id, "2025-03-01T00:00:00.000Z");
    expect(historicalLock.assetRefs.some((ref) => ref.identityKey === "fact:bounded")).toBe(true);
    const current = store.createTask({ conversationId: conversation.id, goal: "current", intent: "full_research", status: "completed", budget: { maxModelCalls: 1, maxToolCalls: 1, maxCostUsd: 1 } });
    const currentLock = store.createKnowledgeLock(current.id, "2025-07-01T00:00:00.000Z");
    expect(currentLock.assetRefs.some((ref) => ref.identityKey === "fact:bounded")).toBe(false);
    expect(store.getCurrentRelease(scope)?.assetRefs.some((ref) => ref.identityKey === "fact:bounded")).toBe(true);
  });

  it("rolls back by creating a new immutable release linked to the old baseline", () => {
    const store = makeStore();
    const scope: KnowledgeScope = { kind: "tenant", tenantId: "tenant-a" };
    const firstTask = terminalTask(store, "tenant-a", "u1", "full_research", "初始基线").task;
    const first = manualCandidate(store, firstTask, scope, "failure_pattern", "failure:rollback", { value: "v1" }, 1);
    store.updateCandidate(first.id, { status: "approved" });
    const releaseOne = store.publishRelease({ scope, candidateIds: [first.id], createdBy: "tester" });
    const secondTask = terminalTask(store, "tenant-a", "u1", "update_judgment", "更新基线").task;
    const second = manualCandidate(store, secondTask, scope, "failure_pattern", "failure:rollback", { value: "v2" }, 1);
    store.updateCandidate(second.id, { status: "approved" });
    const releaseTwo = store.publishRelease({ scope, candidateIds: [second.id], createdBy: "tester" });

    const rollback = store.rollbackRelease({ releaseId: releaseOne.id, createdBy: "governance_owner" });
    expect(rollback).toMatchObject({ status: "current", parentReleaseId: releaseTwo.id, rollbackOfReleaseId: releaseOne.id });
    expect(rollback.id).not.toBe(releaseOne.id);
    expect(rollback.assetRefs).toEqual(releaseOne.assetRefs);
    expect(store.getRelease(releaseOne.id)?.status).toBe("superseded");
    expect(store.getRelease(releaseTwo.id)?.status).toBe("superseded");
  });

  it("blocks stale concurrent proposals until conflicts are resolved", () => {
    const store = makeStore();
    const first = terminalTask(store, "tenant-a", "u1");
    const second = terminalTask(store, "tenant-a", "u1", "update_judgment", "并发任务");
    const scope: KnowledgeScope = { kind: "tenant", tenantId: "tenant-a" };
    const one = manualCandidate(store, first.task, scope, "failure_pattern", "failure:same", { reason: "v1" }, 1);
    const two = manualCandidate(store, second.task, scope, "failure_pattern", "failure:same", { reason: "v2" }, 2);
    store.updateCandidate(one.id, { status: "approved", evaluationSummary: { passed: true, scoreDelta: 0.05, severeRegressions: 0, metrics: {} } });
    store.publishRelease({ scope, candidateIds: [one.id], createdBy: "tester" });
    expect(() => new KnowledgeLearningService(store).evaluateCandidate(two.id)).toThrow(/conflicts/);
    expect(store.getCandidate(two.id)?.conflicts.length).toBeGreaterThan(0);
  });

  it("keeps delivery terminal state when background mining fails", () => {
    const store = makeStore();
    const { task } = terminalTask(store);
    const failingMiner: KnowledgeMiner = { id: "failing", version: "1", mine: () => { throw new Error("extractor unavailable"); } };
    expect(() => new KnowledgeLearningService(store, [failingMiner]).runMining(task.id)).toThrow("extractor unavailable");
    expect(store.getTask(task.id)?.status).toBe("completed");
    expect(store.getMiningRunByTask(task.id)?.status).toBe("failed");
  });

  it("keeps mining observations, queued jobs, and publish retries idempotent", () => {
    const store = makeStore();
    const { task, conversation } = terminalTask(store);
    store.putArtifact({ conversationId: conversation.id, taskId: task.id, kind: "evidence_package", title: "证据评估", status: "verified", data: { facts: [], sufficient: false, stopReason: "重复证据缺口" }, sourceRefs: [], createdBy: "research-lead" });
    const service = new KnowledgeLearningService(store);
    const firstRun = service.runMining(task.id)!;
    const firstCandidates = store.listCandidates({ taskId: task.id });
    const secondRun = service.runMining(task.id)!;
    expect(secondRun.id).toBe(firstRun.id);
    expect(store.listCandidates({ taskId: task.id })).toHaveLength(firstCandidates.length);
    for (const candidate of firstCandidates) expect(store.listCandidateOccurrences(candidate.id)).toHaveLength(1);

    const firstJob = store.enqueueTask(task.id, "rebuild_knowledge_index");
    expect(store.enqueueTask(task.id, "rebuild_knowledge_index")).toBe(firstJob);
    const publishable = manualCandidate(store, task, { kind: "tenant", tenantId: "tenant-a" }, "failure_pattern", "failure:idempotent-release", { reason: "same" }, 1);
    store.updateCandidate(publishable.id, { status: "approved" });
    expect(service.publishApprovedForTask(task.id)).toHaveLength(1);
    const current = store.getCurrentRelease({ kind: "tenant", tenantId: "tenant-a" })!.id;
    expect(service.publishApprovedForTask(task.id)).toHaveLength(0);
    expect(store.getCurrentRelease({ kind: "tenant", tenantId: "tenant-a" })?.id).toBe(current);
  });

  it("rejects illegal candidate lifecycle transitions", () => {
    const store = makeStore();
    const { task } = terminalTask(store);
    const scope: KnowledgeScope = { kind: "tenant", tenantId: "tenant-a" };
    const candidate = manualCandidate(store, task, scope, "method", "method:illegal", { name: "方法" }, 2);
    expect(() => store.updateCandidate(candidate.id, { status: "released" })).toThrow(/Illegal candidate transition/);
  });

  it("queues mining automatically after the research task settles", () => {
    const store = makeStore();
    const kernel = new AgentKernel(store);
    const conversation = store.createConversation("先进封装", { tenantId: "tenant-a", userId: "u1" });
    const submitted = kernel.submitGoal(conversation.id, "研究先进封装需求并输出判断");
    kernel.decideApproval(submitted.approval!.id, "approved");
    const job = store.claimJob()!;
    kernel.executeTask(submitted.task.id);
    store.finishJob(job.id);
    const miningJob = store.claimJob();
    expect(miningJob).toMatchObject({ taskId: submitted.task.id, kind: "mine_assets" });
    expect(store.getMiningRunByTask(submitted.task.id)?.status).toBe("queued");
    const contextPackage = store.getContextPackage(submitted.task.id);
    expect(contextPackage).toMatchObject({
      taskId: submitted.task.id,
      knowledgeLockId: store.getKnowledgeLock(submitted.task.id)?.id,
      releaseIds: { global: store.getKnowledgeLock(submitted.task.id)?.globalReleaseId },
    });
    expect(contextPackage?.references.every((ref) => ref.reason && ref.version != null)).toBe(true);
    expect(contextPackage?.references.filter((ref) => ref.assetRef)).toHaveLength(store.getKnowledgeLock(submitted.task.id)!.assetRefs.length);

    const selected = contextPackage!.references.find((ref) => ref.assetRef)!.assetRef!;
    const helpful = store.observeAssetUsage({ taskId: submitted.task.id, assetRef: selected, outcome: "helpful", selectedReason: "冻结 Replay 显示该资产减少了证据返工" });
    expect(store.observeAssetUsage({ taskId: submitted.task.id, assetRef: selected, outcome: "helpful", selectedReason: "冻结 Replay 显示该资产减少了证据返工" }).id).toBe(helpful.id);
    expect(store.listEvents(conversation.id).filter((event) => event.type === "asset.helpful")).toHaveLength(1);
    expect(() => store.observeAssetUsage({ taskId: submitted.task.id, assetRef: { ...selected, fingerprint: "sha256:tampered" }, outcome: "regression", selectedReason: "tampered" })).toThrow(/KnowledgeLock/);
  });
});
