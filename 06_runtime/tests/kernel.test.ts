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
    expect(settled.status).toBe("waiting_approval");
    const publishApproval = store.listPendingApprovals(conversation.id)[0];
    expect(publishApproval.kind).toBe("publish_confirmation");
    kernel.decideApproval(publishApproval.id, "approved");
    expect(kernel.executeTask(submitted.task.id).status).toBe("completed");
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

  it("keeps an audited deliverable verified but unpublished when the researcher defers publication", () => {
    const { store, kernel, conversation } = setup();
    const submitted = kernel.submitGoal(conversation.id, "研究先进封装需求并形成可发布简报");
    kernel.decideApproval(submitted.approval!.id, "approved");
    expect(kernel.executeTask(submitted.task.id).status).toBe("waiting_approval");
    const approval = store.listPendingApprovals(conversation.id)[0];
    expect(approval.kind).toBe("publish_confirmation");
    const report = store.listArtifacts(submitted.task.id).find((artifact) => artifact.kind === "report")!;
    const deliverableRef = (report.data as { ontologyDeliverableRef: string }).ontologyDeliverableRef;
    kernel.decideApproval(approval.id, "rejected", "等待补充材料");
    expect(store.getTask(submitted.task.id)?.status).toBe("waiting_input");
    expect(kernel.actions.ontology.getObject(deliverableRef)?.properties.lifecycle_status).toBe("verified");
    expect((store.getArtifact(report.id)?.data as { publication?: { status: string } }).publication?.status).toBe("verified_not_published");
    expect(store.listEvents(conversation.id).some((event) => event.type === "report.published")).toBe(false);
  });

  it("pauses for evidence and judgment confirmation before composing a supported report", async () => {
    const { store, kernel, conversation } = setup();
    const candidates = [
      { id: "source:a", uri: "https://issuer-a.test/report", title: "来源 A", sourceType: "primary" as const, locator: "p1", discoveryReason: "test", discoveredAt: "2026-08-09T00:00:00.000Z" },
      { id: "source:b", uri: "https://issuer-b.test/report", title: "来源 B", sourceType: "primary" as const, locator: "p2", discoveryReason: "test", discoveredAt: "2026-08-09T00:00:00.000Z" },
    ];
    kernel.sources.discover = () => candidates;
    kernel.sources.capture = (candidate) => {
      const quote = candidate.id === "source:a" ? "终端需求与客户订单同比增长 30%，并通过产品升级机制驱动先进封装需求" : "有效供给与封装产能利用率连续两个季度提升";
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
    const planSurface = store.listArtifacts(submitted.task.id).find((artifact) => artifact.kind === "ui_surface")!;
    expect((planSurface.data as { data: { methodPlan?: { applications: unknown[] } } }).data.methodPlan?.applications.length).toBeGreaterThan(0);
    kernel.decideApproval(submitted.approval!.id, "approved");
    expect(kernel.executeTask(submitted.task.id).status).toBe("waiting_approval");
    const evidenceApproval = store.listPendingApprovals(conversation.id)[0];
    expect(evidenceApproval.kind).toBe("evidence_confirmation");

    kernel.decideApproval(evidenceApproval.id, "approved");
    expect(kernel.executeTask(submitted.task.id).status).toBe("waiting_approval");
    const judgmentApproval = store.listPendingApprovals(conversation.id)[0];
    expect(judgmentApproval.kind).toBe("judgment_confirmation");
    expect(store.listArtifacts(submitted.task.id).some((artifact) => artifact.kind === "report")).toBe(false);
    expect(() => kernel.decideApproval(judgmentApproval.id, "approved")).toThrow(/reviewed and saved by the researcher/);

    const judgment = store.listArtifacts(submitted.task.id).find((artifact) => artifact.kind === "judgment")!;
    const signalInputs = (judgment.data as { signalInputs: Array<{ evidenceFactRef: string }> }).signalInputs;
    const signalRoles = Object.fromEntries(signalInputs.map((input) => [input.evidenceFactRef, "support"]));
    const revision = kernel.reviseArtifact(judgment.id, judgment.version, {
      statement: "先进封装需求有条件改善，仍需跟踪终端订单兑现",
      confidence: "medium",
      changeConditions: ["终端订单连续两个季度低于预期", "新增产能利用率转弱"],
      signalRoles,
    });
    expect(revision.artifact.version).toBe(2);
    expect(revision.approval?.kind).toBe("judgment_confirmation");
    // Multiple atomic judgment units may have independent pending confirmations;
    // the revised unit receives its own replacement approval below.

    kernel.decideApproval(revision.approval!.id, "approved");
    const committedJudgment = store.getArtifact(judgment.id)!;
    const ontologyJudgmentRef = (committedJudgment.data as { ontologyJudgmentRef?: string }).ontologyJudgmentRef;
    const reasoningChain = (committedJudgment.data as { reasoningChain?: { judgmentUnitRef: string; hypothesisRef: string; signalRefs: string[]; ruleEvaluationRef: string; traceRef: string } }).reasoningChain!;
    expect(committedJudgment.status).toBe("verified");
    expect(kernel.actions.ontology.getObject(ontologyJudgmentRef!)?.properties).toMatchObject({ lifecycle_status: "approved", method_application_refs: ["MA-core_judgments"] });
    expect(kernel.actions.ontology.getObject(reasoningChain.judgmentUnitRef)?.type).toBe("JudgmentUnit");
    expect(kernel.actions.ontology.getObject(reasoningChain.hypothesisRef)?.properties.statement).toBe("先进封装需求有条件改善，仍需跟踪终端订单兑现");
    expect(reasoningChain.signalRefs.length).toBeGreaterThanOrEqual(2);
    expect(kernel.actions.ontology.getObject(reasoningChain.ruleEvaluationRef)?.properties.result).toBe("pass");
    expect(kernel.actions.ontology.getObject(reasoningChain.traceRef)?.type).toBe("ReasoningTrace");
    expect(kernel.actions.ontology.listLinksForObject(reasoningChain.traceRef).filter((link) => link.type === "traceIncludesNode").length).toBeGreaterThanOrEqual(8);
    expect(store.listEvents(conversation.id).find((event) => event.type === "judgment.committed")?.payload).toMatchObject({ reasoningTraceRef: reasoningChain.traceRef });
    const methodPlan = store.listArtifacts(submitted.task.id).find((artifact) => artifact.kind === "method_application")!.data as { applications: Array<{ sectionKey: string; executionStatus: string; gateStatus: string }> };
    expect(methodPlan.applications.find((item) => item.sectionKey === "core_judgments")).toMatchObject({ executionStatus: "executed", gateStatus: "passed" });
    let nextStatus = kernel.executeTask(submitted.task.id).status;
    let nextApproval = store.listPendingApprovals(conversation.id)[0];
    while (nextApproval && nextApproval.kind !== "publish_confirmation") {
      if (nextApproval.kind === "evidence_confirmation") {
        kernel.decideApproval(nextApproval.id, "approved");
      } else if (nextApproval.kind === "judgment_confirmation") {
        const atomic = store.listArtifacts(submitted.task.id).find((artifact) => artifact.kind === "judgment" && artifact.nodeId === nextApproval.nodeId)!;
        const atomicInputs = (atomic.data as { signalInputs: Array<{ evidenceFactRef: string }> }).signalInputs;
        const atomicRevision = kernel.reviseArtifact(atomic.id, atomic.version, {
          statement: (atomic.data as { statement: string }).statement === "暂不可判断" ? "该原子判断在现有证据边界下有条件成立" : (atomic.data as { statement: string }).statement,
          confidence: "medium",
          changeConditions: ["出现同口径反向证据"],
          signalRoles: Object.fromEntries(atomicInputs.map((input) => [input.evidenceFactRef, "support"])),
        });
        kernel.decideApproval(atomicRevision.approval!.id, "approved");
      }
      nextStatus = kernel.executeTask(submitted.task.id).status;
      nextApproval = store.listPendingApprovals(conversation.id)[0];
    }
    expect(nextStatus).toBe("waiting_approval");
    const publishApproval = nextApproval!;
    expect(publishApproval).toBeDefined();
    expect(publishApproval.kind).toBe("publish_confirmation");
    const verifiedReport = store.listArtifacts(submitted.task.id).find((artifact) => artifact.kind === "report")!;
    expect((verifiedReport.data as { publication?: { status: string } }).publication?.status).toBe("verified_not_published");
    const verifiedDeliverableRef = (verifiedReport.data as { ontologyDeliverableRef: string }).ontologyDeliverableRef;
    expect(kernel.actions.ontology.getObject(verifiedDeliverableRef)?.properties.lifecycle_status).toBe("verified");
    kernel.decideApproval(publishApproval.id, "approved");
    expect(kernel.executeTask(submitted.task.id).status).toBe("completed");
    const report = store.listArtifacts(submitted.task.id).find((artifact) => artifact.kind === "report");
    expect((report?.data as { summary: string }).summary.length).toBeGreaterThan(0);
    expect((report?.data as { judgmentBundleRefs: string[] }).judgmentBundleRefs.length).toBeGreaterThan(1);
    expect(report?.sourceRefs).toHaveLength(2);
    expect((report?.data as { claims: unknown[] }).claims).toHaveLength(1);
    expect((report?.data as { qualityEvaluation?: { formalResearchValue: { status: string }; metrics: unknown[] } }).qualityEvaluation).toMatchObject({ formalResearchValue: { status: "not_eligible" } });
    expect((report?.data as { qualityEvaluation?: { metrics: unknown[] } }).qualityEvaluation?.metrics).toHaveLength(8);
    expect(store.listEvents(conversation.id).some((event) => event.type === "report.quality_diagnostics_completed")).toBe(true);
    expect((report?.data as { publication?: { status: string } }).publication?.status).toBe("published");
    const freeze = (report?.data as { evaluationFreeze?: { reportHash: string; evidenceBundleHash: string; reportArtifactVersion: number } }).evaluationFreeze;
    expect(freeze).toMatchObject({ reportArtifactVersion: 3 });
    expect(freeze?.reportHash).toMatch(/^sha256:/);
    expect(freeze?.evidenceBundleHash).toMatch(/^sha256:/);
    const formalMissing = (report?.data as { qualityEvaluation?: { formalResearchValue: { missingPrerequisites: string[] } } }).qualityEvaluation?.formalResearchValue.missingPrerequisites || [];
    expect(formalMissing).not.toContain("冻结且哈希锁定的评测证据包");
    expect(formalMissing).not.toContain("在打开密封裁决前冻结的系统产物哈希");
    expect(formalMissing).toContain("同证据直接生成稿与同证据摘要稿基线");
    expect(store.listEvents(conversation.id).some((event) => event.type === "report.published")).toBe(true);
    expect(store.listEvents(conversation.id).some((event) => event.type === "report.evaluation_inputs_frozen")).toBe(true);
    const deliverableRef = (report?.data as { ontologyDeliverableRef?: string }).ontologyDeliverableRef;
    expect(kernel.actions.ontology.getObject(deliverableRef!)?.properties).toMatchObject({ report_kind: "thematic_research", report_spec_version: "1.0.0", lifecycle_status: "published" });
    expect(kernel.actions.ontology.listLinksForObject(deliverableRef!).some((link) => link.type === "deliverableIncludesJudgment" && link.targetRef.id === ontologyJudgmentRef)).toBe(true);

    const currentJudgment = store.getArtifact(judgment.id)!;
    const secondRevision = kernel.reviseArtifact(currentJudgment.id, currentJudgment.version, {
      statement: "先进封装需求改善幅度下修",
      confidence: "low",
      changeConditions: ["订单重新加速"],
    });
    expect(store.listArtifacts(submitted.task.id).filter((artifact) => artifact.title === "受约束模型章节草拟").every((artifact) => artifact.status === "superseded")).toBe(true);
    kernel.decideApproval(secondRevision.approval!.id, "approved");
    const replacementRef = (store.getArtifact(judgment.id)!.data as { ontologyJudgmentRef: string }).ontologyJudgmentRef;
    const replacementTraceRef = (store.getArtifact(judgment.id)!.data as { reasoningChain: { traceRef: string } }).reasoningChain.traceRef;
    expect(replacementRef).not.toBe(ontologyJudgmentRef);
    expect(replacementTraceRef).not.toBe(reasoningChain.traceRef);
    expect(kernel.actions.ontology.getObject(ontologyJudgmentRef!)?.properties).toMatchObject({ lifecycle_status: "superseded", replacement_ref: replacementRef });
    expect(kernel.actions.ontology.getObject(replacementRef)?.properties.lifecycle_status).toBe("approved");
  });

  it("does not offer judgment approval when generic evidence misses the selected method inputs", () => {
    const { store, kernel, conversation } = setup();
    const candidates = [
      { id: "source:a", uri: "https://issuer-a.test/report", title: "来源 A", sourceType: "primary" as const, locator: "p1", discoveryReason: "test", discoveredAt: "2026-08-09T00:00:00.000Z" },
      { id: "source:b", uri: "https://issuer-b.test/report", title: "来源 B", sourceType: "primary" as const, locator: "p2", discoveryReason: "test", discoveredAt: "2026-08-09T00:00:00.000Z" },
    ];
    kernel.sources.discover = () => candidates;
    kernel.sources.capture = (candidate) => {
      const quote = candidate.id === "source:a" ? "公司收入和利润同比增长" : "市场份额排名保持稳定";
      const body = JSON.stringify({ quote });
      const hash = `sha256:${createHash("sha256").update(body).digest("hex")}`;
      return kernel.provenance.saveSnapshot({
        candidateId: candidate.id, uri: candidate.uri, title: candidate.title, sourceType: candidate.sourceType,
        locator: candidate.locator!, quote, body, contentHash: hash, capturedAt: "2026-08-09T00:01:00.000Z",
        publisherId: new URL(candidate.uri).hostname, permissionScope: "public_research_use",
        acquisition: { connectorId: "test", upstreamSourceId: candidate.id, requestFingerprint: hash, requestParameters: {}, rawResponseHash: hash, retrievedAt: "2026-08-09T00:01:00.000Z" },
      });
    };

    const submitted = kernel.submitGoal(conversation.id, "研究先进封装需求的产业链传导并形成主题报告");
    kernel.decideApproval(submitted.approval!.id, "approved");
    expect(kernel.executeTask(submitted.task.id).status).toBe("waiting_approval");
    while (store.listPendingApprovals(conversation.id)[0]?.kind === "evidence_confirmation") {
      kernel.decideApproval(store.listPendingApprovals(conversation.id)[0].id, "approved");
      expect(kernel.executeTask(submitted.task.id).status).toBe("waiting_approval");
    }
    expect(store.listPendingApprovals(conversation.id)[0].kind).toBe("publish_confirmation");
    expect(store.listArtifacts(submitted.task.id).find((artifact) => artifact.kind === "judgment")?.data).toMatchObject({ disposition: "abstain", methodGateStatus: "blocked" });
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
    const kinds = store.listTaskNodes(submitted.task.id).map((node) => node.kind);
    expect(kinds).toEqual(expect.arrayContaining(["semantic_context", "evidence_discovery", "evidence_capture", "evidence_evaluation"]));
    expect(kinds).not.toEqual(expect.arrayContaining(["judgment", "synthesis", "compose", "audit"]));
    const compilerEvent = store.listEvents(conversation.id).find((event) => event.type === "planner.compiled");
    expect(compilerEvent?.payload).toMatchObject({ source: "repaired_proposal" });
  });
});
