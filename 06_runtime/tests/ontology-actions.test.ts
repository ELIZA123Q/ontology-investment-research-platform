import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ActionRejectedError, OntologyActionService } from "@/src/ontology/action-service";
import { ontologyCatalog } from "@/src/ontology/catalog";
import { RuntimeStore } from "@/src/runtime/store";

const stores: RuntimeStore[] = [];
const setup = () => {
  const store = new RuntimeStore(":memory:");
  stores.push(store);
  const conversation = store.createConversation("先进封装");
  const actions = new OntologyActionService(store);
  const created = actions.apply("CreateResearchCase", {
    targetRefs: [], parameters: { title: "先进封装", goal: "判断未来六个月需求", conversationRef: conversation.id },
    expectedVersions: {}, idempotencyKey: `case:${conversation.id}`,
  }, { actorType: "researcher", actorId: "researcher", conversationId: conversation.id });
  const researchCase = created.objects.find((object) => object.type === "ResearchCase")!;
  const task = store.createTask({ conversationId: conversation.id, researchCaseId: researchCase.id, goal: "判断未来六个月需求", intent: "full_research", status: "running", budget: { maxModelCalls: 1, maxToolCalls: 1, maxCostUsd: 1 } });
  store.createKnowledgeLock(task.id);
  const planApproval = store.createApproval({ conversationId: conversation.id, taskId: task.id, kind: "plan_confirmation", prompt: "确认研究问题" });
  store.decideApproval(planApproval.id, "approved");
  const questionResult = actions.apply("CreateResearchQuestion", {
    targetRefs: [{ id: researchCase.id, type: researchCase.type }],
    parameters: { question: "判断未来六个月需求", failureRoute: "competing_explanation", scopeLabel: "测试研究范围", scopeDimensions: {} },
    expectedVersions: { [researchCase.id]: researchCase.version }, approvalToken: planApproval.id, idempotencyKey: `question:${conversation.id}`,
  }, { actorType: "researcher", actorId: "researcher", conversationId: conversation.id, taskId: task.id });
  const researchQuestion = questionResult.objects.find((object) => object.type === "ResearchQuestion")!;
  const researchScope = questionResult.objects.find((object) => object.type === "ResearchScope")!;
  store.putArtifact({ conversationId: conversation.id, taskId: task.id, kind: "method_application", title: "方法执行", status: "verified", data: { applications: [{ id: "MA-core_judgments", executionStatus: "executed", gateStatus: "passed" }] }, sourceRefs: [], createdBy: "test" });
  return { store, conversation, task, actions, researchCase, researchQuestion, researchScope, planApprovalId: planApproval.id, context: { actorType: "agent" as const, actorId: "research-lead", conversationId: conversation.id, taskId: task.id } };
};
afterEach(() => { while (stores.length) stores.pop()?.close(); });

describe("Ontology 5.0 action platform", () => {
  it("loads one semantic and kinetic catalog without investment execution actions", () => {
    expect(ontologyCatalog.platformVersion).toBe("5.0.0");
    expect(ontologyCatalog.listObjectTypes().some((type) => type.id === "ResearchCase")).toBe(true);
    const executionAttributes = ontologyCatalog.getObjectType("ActionExecution").attributes;
    expect(executionAttributes).toHaveProperty("actorType");
    expect(executionAttributes).toHaveProperty("outputRefs");
    expect(executionAttributes).not.toHaveProperty("actor_type");
    expect(ontologyCatalog.listFunctionTypes().some((type) => type.id === "ComputeJudgmentProposal")).toBe(true);
    const actionIds = ontologyCatalog.listActionTypes().map((action) => action.id);
    expect(actionIds).toContain("ApproveJudgment");
    expect(actionIds).toContain("CreateJudgmentUnit");
    expect(actionIds.join(" ").toLowerCase()).not.toMatch(/trade|order|position|rating|targetprice/);
  });

  it("makes low-risk writes idempotent and rejects stale object versions", () => {
    const { actions, researchCase, context } = setup();
    const request = {
      targetRefs: [{ id: researchCase.id, type: researchCase.type }],
      parameters: { title: "来源", uri: "https://example.com/a", publishedAt: "2026-08-01T00:00:00Z", sourceTier: "S1", locator: "p1", contentHash: "sha256:a", capturedAt: "2026-08-02T00:00:00Z", accessScope: "public", quote: "需求增长" },
      expectedVersions: { [`${researchCase.type}:${researchCase.id}`]: researchCase.version }, idempotencyKey: "capture:a",
    };
    const first = actions.apply("CaptureSource", request, context);
    const second = actions.apply("CaptureSource", request, context);
    expect(second.reused).toBe(true);
    expect(second.execution.id).toBe(first.execution.id);
    expect(actions.ontology.getObject(first.execution.id)?.properties).toMatchObject({
      actorType: "agent",
      outputRefs: first.execution.outputRefs,
      invalidatedRefs: first.execution.invalidatedRefs,
    });
    const snapshot = first.objects.find((object) => object.type === "SourceSnapshot")!;
    expect(() => actions.apply("VerifySourceSnapshot", {
      targetRefs: [{ id: snapshot.id, type: snapshot.type }], parameters: { decision: "verified", note: "ok" },
      expectedVersions: { [snapshot.id]: 99 }, idempotencyKey: "verify:stale",
    }, { ...context, actorType: "system" })).toThrow(ActionRejectedError);
    expect(actions.ontology.getActionExecution(first.execution.id)?.status).toBe("applied");
  });

  it("enforces capture-to-fact provenance and researcher approval before supported judgment", () => {
    const { store, actions, researchCase, researchQuestion, researchScope, planApprovalId, task, context } = setup();
    const captured = actions.apply("CaptureSource", {
      targetRefs: [{ id: researchCase.id, type: researchCase.type }],
      parameters: { title: "一手来源", uri: "https://example.com/primary", publishedAt: "2026-08-01T00:00:00Z", sourceTier: "S1", locator: "p1", contentHash: "sha256:primary", capturedAt: "2026-08-02T00:00:00Z", accessScope: "public", quote: "需求增长" },
      expectedVersions: { [researchCase.id]: researchCase.version }, idempotencyKey: "capture:primary",
    }, context);
    const snapshot = captured.objects.find((object) => object.type === "SourceSnapshot")!;
    const verified = actions.apply("VerifySourceSnapshot", {
      targetRefs: [{ id: snapshot.id, type: snapshot.type }], parameters: { decision: "verified", note: "locator and hash passed" },
      expectedVersions: { [snapshot.id]: snapshot.version }, idempotencyKey: "verify:primary",
    }, { ...context, actorType: "system" });
    const currentSnapshot = verified.objects.find((object) => object.type === "SourceSnapshot")!;
    const accepted = actions.apply("AcceptClaim", {
      targetRefs: [{ id: currentSnapshot.id, type: currentSnapshot.type }], parameters: { statement: "需求增长", locator: "p1", cutoffAt: "2026-08-02T00:00:00Z", semanticRefs: [] },
      expectedVersions: { [currentSnapshot.id]: currentSnapshot.version }, idempotencyKey: "claim:primary",
    }, context);
    const claim = accepted.objects.find((object) => object.type === "EvidenceClaim")!;
    const promoted = actions.apply("PromoteEvidenceFact", {
      targetRefs: [{ id: claim.id, type: claim.type }], parameters: { statement: "需求增长", subjectRef: researchCase.id, scopeRef: researchCase.id, cutoffAt: "2026-08-02T00:00:00Z" },
      expectedVersions: { [claim.id]: claim.version }, idempotencyKey: "fact:primary",
    }, context);
    const fact = promoted.objects.find((object) => object.type === "EvidenceFact")!;
    const unitResult = actions.apply("CreateJudgmentUnit", {
      targetRefs: [{ id: researchCase.id, type: researchCase.type }],
      parameters: { statement: "需求有条件增长", judgmentType: "trend_direction", questionRef: researchQuestion.id, scopeLabel: "本轮研究范围", scopeDimensions: { research_case_ref: researchCase.id } },
      expectedVersions: { [researchCase.id]: researchCase.version }, approvalToken: planApprovalId, idempotencyKey: "unit:primary",
    }, context);
    const unit = unitResult.objects.find((object) => object.type === "JudgmentUnit")!;
    const scope = researchScope;
    const hypothesis = actions.apply("AcceptHypothesis", {
      targetRefs: [{ id: researchCase.id, type: researchCase.type }],
      parameters: { statement: "需求有条件增长", judgmentUnitRef: unit.id, direction: "up", timeHorizon: "未来六个月", falsificationConditions: ["新来源反转"], role: "primary" },
      expectedVersions: { [researchCase.id]: actions.ontology.getObject(researchCase.id)!.version }, idempotencyKey: "hypothesis:primary",
    }, context).objects.find((object) => object.type === "Hypothesis")!;
    const judgmentParameters = {
      statement: "需求有条件增长", judgmentType: "trend_direction", timeHorizon: "未来六个月", epistemicStatus: "supported", confidence: "medium",
      scopeRef: scope.id, judgmentUnitRef: unit.id, cutoffAt: "2026-08-02T00:00:00Z", evidenceRefs: [fact.id], methodApplicationRefs: ["MA-core_judgments"],
      signalInputs: [{ evidenceFactRef: fact.id, statement: "需求增长", role: "support" }], hypothesisRefs: [hypothesis.id], conditions: ["一手来源持续"], invalidationConditions: ["新来源反转"],
    };

    const approval = store.createApproval({ conversationId: context.conversationId, taskId: task.id, kind: "judgment_confirmation", prompt: "批准判断？" });
    const preview = actions.preview("ApproveJudgment", {
      targetRefs: [{ id: researchCase.id, type: researchCase.type }], parameters: judgmentParameters,
      expectedVersions: { [researchCase.id]: actions.ontology.getObject(researchCase.id)!.version }, idempotencyKey: "judgment:preview",
    }, context);
    expect(preview).toMatchObject({ eligible: true, requiresApproval: true, approvalKind: "judgment_confirmation" });
    expect(preview.edits.some((edit) => edit.operation === "create_object" && edit.ref.type === "Judgment")).toBe(true);
    expect(preview.edits.some((edit) => edit.operation === "create_object" && edit.ref.type === "Hypothesis")).toBe(false);
    expect(preview.edits.some((edit) => edit.operation === "create_object" && edit.ref.type === "JudgmentUnit")).toBe(false);
    expect(actions.preview("ApproveJudgment", {
      targetRefs: [{ id: researchCase.id, type: researchCase.type }],
      parameters: { ...judgmentParameters, signalInputs: [{ evidenceFactRef: fact.id, statement: "需求增长", role: "context" }] },
      expectedVersions: { [researchCase.id]: actions.ontology.getObject(researchCase.id)!.version }, idempotencyKey: "judgment:context-only",
    }, context)).toMatchObject({ eligible: false, errors: expect.arrayContaining([expect.stringMatching(/support signal/)]) });
    expect(actions.preview("ApproveJudgment", {
      targetRefs: [{ id: researchCase.id, type: researchCase.type }],
      parameters: { ...judgmentParameters, signalInputs: [{ evidenceFactRef: fact.id, statement: "需求增长", role: "block" }] },
      expectedVersions: { [researchCase.id]: actions.ontology.getObject(researchCase.id)!.version }, idempotencyKey: "judgment:block",
    }, context)).toMatchObject({ eligible: false, errors: expect.arrayContaining([expect.stringMatching(/support signal|block signal/)]) });
    expect(() => actions.apply("ApproveJudgment", {
      targetRefs: [{ id: researchCase.id, type: researchCase.type }], parameters: judgmentParameters,
      expectedVersions: { [researchCase.id]: actions.ontology.getObject(researchCase.id)!.version }, idempotencyKey: "judgment:no-approval",
    }, context)).toThrow(ActionRejectedError);
    store.decideApproval(approval.id, "approved");
    const result = actions.apply("ApproveJudgment", {
      targetRefs: [{ id: researchCase.id, type: researchCase.type }], parameters: judgmentParameters,
      expectedVersions: { [researchCase.id]: actions.ontology.getObject(researchCase.id)!.version }, idempotencyKey: "judgment:approved", approvalToken: approval.id,
    }, { ...context, actorType: "researcher", actorId: "researcher" });
    const judgment = result.objects.find((object) => object.type === "Judgment")!;
    expect(judgment.properties).toMatchObject({ epistemic_status: "supported", lifecycle_status: "approved" });
    expect(judgment.properties).not.toHaveProperty("decision_status");
    expect(result.objects.map((object) => object.type)).toEqual(expect.arrayContaining(["Signal", "RuleEvaluation", "Judgment", "ReasoningTrace"]));
    expect(result.objects.some((object) => object.type === "JudgmentUnit")).toBe(false);
    expect(result.objects.some((object) => object.type === "Hypothesis")).toBe(false);
    expect(result.links.map((link) => link.type)).toEqual(expect.arrayContaining(["factSupportsSignal", "signalEvaluatesHypothesis", "judgmentHasRuleEvaluation", "judgmentHasReasoningTrace", "traceIncludesNode"]));
    const traceRef = result.objects.find((object) => object.type === "ReasoningTrace")!.id;
    expect(result.links.filter((link) => link.type === "traceIncludesNode" && link.sourceRef.id === traceRef).length).toBeGreaterThanOrEqual(6);
  });

  it("invalidates downstream formal facts and judgments when a source gets a new snapshot", () => {
    const { store, actions, researchCase, researchQuestion, researchScope, planApprovalId, task, context } = setup();
    const first = actions.apply("CaptureSource", {
      targetRefs: [{ id: researchCase.id, type: researchCase.type }], parameters: { title: "来源", uri: "https://example.com/versioned", publishedAt: "2026-08-01T00:00:00Z", sourceTier: "S1", locator: "v1", contentHash: "sha256:v1", capturedAt: "2026-08-01T00:00:00Z", accessScope: "public", quote: "增长" },
      expectedVersions: { [researchCase.id]: 1 }, idempotencyKey: "capture:v1",
    }, context);
    const snapshot = first.objects.find((object) => object.type === "SourceSnapshot")!;
    const verified = actions.apply("VerifySourceSnapshot", { targetRefs: [{ id: snapshot.id, type: snapshot.type }], parameters: { decision: "verified", note: "ok" }, expectedVersions: { [snapshot.id]: 1 }, idempotencyKey: "verify:v1" }, { ...context, actorType: "system" }).objects.find((object) => object.type === "SourceSnapshot")!;
    const claim = actions.apply("AcceptClaim", { targetRefs: [{ id: verified.id, type: verified.type }], parameters: { statement: "增长", locator: "v1", cutoffAt: "2026-08-01T00:00:00Z", semanticRefs: [] }, expectedVersions: { [verified.id]: verified.version }, idempotencyKey: "claim:v1" }, context).objects.find((object) => object.type === "EvidenceClaim")!;
    const fact = actions.apply("PromoteEvidenceFact", { targetRefs: [{ id: claim.id, type: claim.type }], parameters: { statement: "增长", subjectRef: researchCase.id, scopeRef: researchCase.id, cutoffAt: "2026-08-01T00:00:00Z" }, expectedVersions: { [claim.id]: 1 }, idempotencyKey: "fact:v1" }, context).objects.find((object) => object.type === "EvidenceFact")!;
    const unitResult = actions.apply("CreateJudgmentUnit", {
      targetRefs: [{ id: researchCase.id, type: researchCase.type }],
      parameters: { statement: "增长", judgmentType: "trend_direction", questionRef: researchQuestion.id },
      expectedVersions: { [researchCase.id]: 1 }, approvalToken: planApprovalId, idempotencyKey: "unit:v1",
    }, context);
    const unit = unitResult.objects.find((object) => object.type === "JudgmentUnit")!;
    const scope = researchScope;
    const hypothesis = actions.apply("AcceptHypothesis", {
      targetRefs: [{ id: researchCase.id, type: researchCase.type }],
      parameters: { statement: "增长", judgmentUnitRef: unit.id, direction: "up", timeHorizon: "未来六个月", falsificationConditions: ["新版本"] },
      expectedVersions: { [researchCase.id]: actions.ontology.getObject(researchCase.id)!.version }, idempotencyKey: "hypothesis:v1",
    }, context).objects.find((object) => object.type === "Hypothesis")!;
    const approval = store.createApproval({ conversationId: context.conversationId, taskId: task.id, kind: "judgment_confirmation", prompt: "批准" }); store.decideApproval(approval.id, "approved");
    const judgment = actions.apply("ApproveJudgment", { targetRefs: [{ id: researchCase.id, type: researchCase.type }], parameters: { statement: "增长", judgmentType: "trend_direction", timeHorizon: "未来六个月", epistemicStatus: "supported", confidence: "medium", scopeRef: scope.id, judgmentUnitRef: unit.id, cutoffAt: "2026-08-01T00:00:00Z", evidenceRefs: [fact.id], methodApplicationRefs: ["MA-core_judgments"], signalInputs: [{ evidenceFactRef: fact.id, statement: "增长", role: "support" }], hypothesisRefs: [hypothesis.id], conditions: [], invalidationConditions: ["新版本"] }, expectedVersions: { [researchCase.id]: actions.ontology.getObject(researchCase.id)!.version }, idempotencyKey: "judgment:v1", approvalToken: approval.id }, { ...context, actorType: "researcher" }).objects.find((object) => object.type === "Judgment")!;
    const second = actions.apply("CaptureSource", {
      targetRefs: [{ id: researchCase.id, type: researchCase.type }], parameters: { title: "来源", uri: "https://example.com/versioned", publishedAt: "2026-08-03T00:00:00Z", sourceTier: "S1", locator: "v2", contentHash: "sha256:v2", capturedAt: "2026-08-03T00:00:00Z", accessScope: "public", quote: "增长放缓" },
      expectedVersions: { [researchCase.id]: 1 }, idempotencyKey: "capture:v2",
    }, context);
    expect(second.execution.invalidatedRefs.map((ref) => ref.id)).toEqual(expect.arrayContaining([fact.id, judgment.id]));
    expect(actions.ontology.getObject(fact.id)?.properties.validity_status).toBe("stale");
    expect(actions.ontology.getObject(judgment.id)?.properties).toMatchObject({ epistemic_status: "invalidated", lifecycle_status: "review_required" });
    expect(second.queuedTaskIds).toHaveLength(1);
  });

  it("keeps formal ontology SQL writes behind OntologyStore", () => {
    const sourceRoot = join(process.cwd(), "src");
    const sourceFiles = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith(".ts") ? [path] : [];
    });
    const offenders = sourceFiles(sourceRoot).filter((path) => !path.endsWith(join("ontology", "store.ts"))).filter((path) =>
      /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+ontology_(?:objects|links)/i.test(readFileSync(path, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
