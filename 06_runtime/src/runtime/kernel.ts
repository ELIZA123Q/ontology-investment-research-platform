import { createHash, randomUUID } from "node:crypto";
import type { ActionPreviewRequest, ApprovalRequest, Artifact, AssetRef, JudgmentSurfaceData, ReportSpecInput, ReportSurfaceData, ResearchMethodPlan, ResearchPlanSurfaceData, SourceCandidate, Task, TaskNode, UiSurface } from "@/src/contracts";
import { verifyArtifactWrite, verifyModelDraftSections, verifyReportClaims, verifyUiSurface } from "@/src/governance/verifiers";
import { materializeNodes, planResearch, type ResearchPlan } from "@/src/runtime/planner";
import { compilePlannerProposal, type CompiledResearchPlan, type PlannerProposal } from "@/src/runtime/plan-compiler";
import { getResearchNodeType } from "@/src/runtime/node-catalog";
import { RuntimeStore } from "@/src/runtime/store";
import { LocalSemanticGateway } from "@/src/semantic/local-gateway";
import { ResearchProvenanceStore } from "@/src/semantic/provenance-store";
import { LocalSourceGateway } from "@/src/tools/local-source-gateway";
import { OntologyActionService } from "@/src/ontology/action-service";
import { OntologyFunctionService } from "@/src/ontology/functions";
import { reportSpecForGoal } from "@/src/reporting/report-spec";
import { composeProfessionalReport } from "@/src/reporting/report-composer";
import { assessResearchMethods, deriveEvidenceRoles, selectResearchMethods } from "@/src/research/method-router";
import { adaptFinancialDataResult, type FinancialDataToolResult } from "@/src/tools/financial-data-adapter";
import type { ModelProvider } from "@/src/providers/model-provider";
import { requestReportSectionDrafts, type ReportDraftingAttempt } from "@/src/reporting/report-model-drafter";
import { evaluateReportQuality } from "@/src/evaluation/report-quality-evaluator";
import { adaptSourceToolResult, type UnifiedSourceToolResult } from "@/src/tools/source-result-adapter";

const DEFAULT_BUDGET = { maxModelCalls: 12, maxToolCalls: 30, maxCostUsd: 3 };

export interface ConversationSnapshot {
  conversation: ReturnType<RuntimeStore["getConversation"]>;
  messages: ReturnType<RuntimeStore["listMessages"]>;
  task: Task | null;
  activeTaskId: string | null;
  tasks: Task[];
  nodes: TaskNode[];
  artifacts: Artifact[];
  approvals: ApprovalRequest[];
  events: ReturnType<RuntimeStore["listEvents"]>;
}

export interface ArtifactRevisionResult {
  artifact: Artifact;
  surfaceArtifact: Artifact;
  invalidatedNodeIds: string[];
  approval?: ApprovalRequest;
}

interface PreparedJudgmentCommit {
  request: ActionPreviewRequest;
  previousJudgmentRef?: string;
  judgmentUnitRef: string;
  hypothesisRef: string;
}

interface PreparedPublicationCommit {
  request: ActionPreviewRequest;
  reportArtifactId: string;
  deliverableRef: string;
}

export class EvidenceIngestionConflictError extends Error {}

export class AgentKernel {
  readonly semantic: LocalSemanticGateway;
  readonly provenance: ResearchProvenanceStore;
  readonly sources: LocalSourceGateway;
  readonly actions: OntologyActionService;
  readonly functions: OntologyFunctionService;

  constructor(readonly store: RuntimeStore) {
    this.semantic = new LocalSemanticGateway(store.db);
    this.provenance = new ResearchProvenanceStore(store.db);
    this.sources = new LocalSourceGateway(this.semantic, this.provenance);
    this.actions = new OntologyActionService(store);
    this.functions = new OntologyFunctionService();
  }

  ingestExternalSource(taskId: string, input: UnifiedSourceToolResult): Artifact {
    const task = this.requireTask(taskId);
    this.assertEvidenceIngestionAllowed(task);
    const adapted = adaptSourceToolResult(input);
    const ingestionKey = requestFingerprint(input.connectorId, input.operation, { requestFingerprint: adapted.snapshot.acquisition.requestFingerprint, contentHash: adapted.snapshot.contentHash });
    const existing = this.store.listArtifacts(task.id).find((artifact) => artifact.kind === "evidence_package" && artifact.title === "外部来源快照" && (artifact.data as { ingestionKey?: string }).ingestionKey === ingestionKey);
    if (existing) return existing;
    const snapshot = this.provenance.saveSnapshot(adapted.snapshot);
    if (snapshot.verification !== "verified") {
      this.store.appendEvent({ conversationId: task.conversationId, taskId: task.id, type: "connector.ingestion_rejected", actorType: "system", actorId: input.connectorId, payload: { kind: "source_capture", ingestionKey, snapshotId: snapshot.id, verification: snapshot.verification } });
      throw new Error("External source capture failed provenance verification");
    }
    const caseObject = this.actions.ontology.getObject(task.researchCaseId);
    if (!caseObject) throw new Error(`ResearchCase not found: ${task.researchCaseId}`);
    const captured = this.actions.apply("CaptureSource", {
      targetRefs: [{ id: caseObject.id, type: caseObject.type }], parameters: {
        title: snapshot.title, uri: snapshot.uri, publishedAt: snapshot.publishedAt || snapshot.capturedAt,
        sourceTier: snapshot.sourceType === "primary" ? "S1" : "S3", locator: snapshot.locator, contentHash: snapshot.contentHash,
        capturedAt: snapshot.capturedAt, accessScope: snapshot.permissionScope, quote: snapshot.quote,
      }, expectedVersions: { [`${caseObject.type}:${caseObject.id}`]: caseObject.version },
      idempotencyKey: `capture-external:${snapshot.id}`, knowledgeLockId: this.store.getKnowledgeLock(task.id)?.id,
    }, { actorType: "system", actorId: input.connectorId, conversationId: task.conversationId, taskId: task.id });
    const ontologySnapshot = captured.objects.find((object) => object.type === "SourceSnapshot");
    if (!ontologySnapshot) throw new Error("CaptureSource did not create an external SourceSnapshot");
    const verified = this.actions.apply("VerifySourceSnapshot", {
      targetRefs: [{ id: ontologySnapshot.id, type: ontologySnapshot.type }], parameters: { decision: snapshot.verification, note: "external connector adapter and provenance verifier passed" },
      expectedVersions: { [`${ontologySnapshot.type}:${ontologySnapshot.id}`]: ontologySnapshot.version },
      idempotencyKey: `verify-external:${snapshot.id}`, knowledgeLockId: this.store.getKnowledgeLock(task.id)?.id,
    }, { actorType: "system", actorId: "provenance-verifier", conversationId: task.conversationId, taskId: task.id });
    const verifiedSnapshot = verified.objects.find((object) => object.type === "SourceSnapshot");
    if (!verifiedSnapshot) throw new Error("VerifySourceSnapshot did not return the external SourceSnapshot");
    const { body: _body, ...safeSnapshot } = snapshot;
    const artifact = this.store.putArtifact({
      conversationId: task.conversationId, taskId: task.id, kind: "evidence_package", title: "外部来源快照", status: "verified",
      data: { ingestionKey, connectorId: input.connectorId, operation: input.operation, captures: [{ ...safeSnapshot, ontologySnapshotRef: verifiedSnapshot.id }] },
      sourceRefs: [this.sources.toSourceReference(snapshot)], createdBy: input.connectorId,
    });
    this.store.appendEvent({ conversationId: task.conversationId, taskId: task.id, type: "connector.source_ingested", actorType: "system", actorId: input.connectorId, payload: { artifactId: artifact.id, ingestionKey, snapshotId: snapshot.id, ontologySnapshotRef: verifiedSnapshot.id, publisherId: snapshot.publisherId } });
    this.queueEvidenceRecompute(task, "evidence_capture", artifact.id);
    return artifact;
  }

  ingestFinancialData(taskId: string, input: FinancialDataToolResult): Artifact {
    const task = this.requireTask(taskId);
    this.assertEvidenceIngestionAllowed(task);
    const adapted = adaptFinancialDataResult(input);
    const providerResponseRef = input.providerResponse && adapted.providerResponse
      ? this.store.putConnectorResponseBlob({
        ...adapted.providerResponse,
        body: input.providerResponse.body,
        fingerprint: adapted.providerResponse.contentHash,
        connectorId: input.connectorId,
        operation: input.operation,
        permissionScope: input.permissionScope,
        capturedAt: input.retrievedAt,
      })
      : undefined;
    const ingestionKey = requestFingerprint(input.connectorId, input.operation, { asOf: adapted.asOf, snapshots: adapted.observations.map((item) => item.source.snapshot.contentHash) });
    const existing = this.store.listArtifacts(task.id).find((artifact) => artifact.kind === "evidence_package" && (artifact.data as { ingestionKey?: string }).ingestionKey === ingestionKey);
    if (existing) return existing;
    const caseObject = this.actions.ontology.getObject(task.researchCaseId);
    if (!caseObject) throw new Error(`ResearchCase not found: ${task.researchCaseId}`);
    const captured = adapted.observations.map((observation) => {
      const snapshot = this.provenance.saveSnapshot(observation.source.snapshot);
      const capture = this.actions.apply("CaptureSource", {
        targetRefs: [{ id: caseObject.id, type: caseObject.type }],
        parameters: {
          title: snapshot.title, uri: snapshot.uri, publishedAt: snapshot.publishedAt || snapshot.capturedAt,
          sourceTier: snapshot.sourceType === "primary" ? "S1" : "S3", locator: snapshot.locator,
          contentHash: snapshot.contentHash, capturedAt: snapshot.capturedAt, accessScope: snapshot.permissionScope, quote: snapshot.quote,
        },
        expectedVersions: { [`${caseObject.type}:${caseObject.id}`]: caseObject.version },
        idempotencyKey: `capture-financial:${snapshot.id}`, knowledgeLockId: this.store.getKnowledgeLock(task.id)?.id,
      }, { actorType: "system", actorId: input.connectorId, conversationId: task.conversationId, taskId: task.id });
      const ontologySnapshot = capture.objects.find((object) => object.type === "SourceSnapshot");
      if (!ontologySnapshot) throw new Error("CaptureSource did not create a financial SourceSnapshot");
      const verified = this.actions.apply("VerifySourceSnapshot", {
        targetRefs: [{ id: ontologySnapshot.id, type: ontologySnapshot.type }],
        parameters: { decision: snapshot.verification, note: "financial data adapter and provenance verifier passed" },
        expectedVersions: { [`${ontologySnapshot.type}:${ontologySnapshot.id}`]: ontologySnapshot.version },
        idempotencyKey: `verify-financial:${snapshot.id}`, knowledgeLockId: this.store.getKnowledgeLock(task.id)?.id,
      }, { actorType: "system", actorId: "provenance-verifier", conversationId: task.conversationId, taskId: task.id });
      const verifiedSnapshot = verified.objects.find((object) => object.type === "SourceSnapshot");
      if (!verifiedSnapshot) throw new Error("VerifySourceSnapshot did not return the financial SourceSnapshot");
      return { observation, snapshot, ontologySnapshot: verifiedSnapshot };
    });
    const facts = captured.map(({ observation, snapshot, ontologySnapshot }) => {
      const fact = this.provenance.promoteFact({ snapshotId: snapshot.id, statement: observation.statement, factType: observation.factType, businessTime: observation.businessTime, confidence: "medium" });
      const accepted = this.actions.apply("AcceptClaim", {
        targetRefs: [{ id: ontologySnapshot.id, type: ontologySnapshot.type }],
        parameters: { statement: observation.statement, locator: snapshot.locator, cutoffAt: adapted.asOf, semanticRefs: [adapted.entity.id, observation.metricId] },
        expectedVersions: { [`${ontologySnapshot.type}:${ontologySnapshot.id}`]: ontologySnapshot.version },
        idempotencyKey: `accept-financial-claim:${snapshot.id}`, knowledgeLockId: this.store.getKnowledgeLock(task.id)?.id,
      }, { actorType: "agent", actorId: "research-lead", conversationId: task.conversationId, taskId: task.id });
      const claim = accepted.objects.find((object) => object.type === "EvidenceClaim");
      if (!claim) throw new Error("AcceptClaim did not create a financial EvidenceClaim");
      const promoted = this.actions.apply("PromoteEvidenceFact", {
        targetRefs: [{ id: claim.id, type: claim.type }],
        parameters: { statement: observation.statement, subjectRef: task.researchCaseId, scopeRef: task.researchCaseId, cutoffAt: adapted.asOf },
        expectedVersions: { [`${claim.type}:${claim.id}`]: claim.version },
        idempotencyKey: `promote-financial-fact:${snapshot.id}`, knowledgeLockId: this.store.getKnowledgeLock(task.id)?.id,
      }, { actorType: "agent", actorId: "research-lead", conversationId: task.conversationId, taskId: task.id });
      return {
        ...fact, ontologyFactRef: promoted.objects.find((object) => object.type === "EvidenceFact")?.id,
        evidenceRoles: deriveEvidenceRoles(`${observation.metricName} ${observation.statement}`),
        metric: { id: observation.metricId, name: observation.metricName, value: observation.value, unit: observation.unit, currency: observation.currency, basis: observation.basis, dimensions: observation.dimensions },
      };
    });
    const sourceRefs = captured.map(({ snapshot }) => this.sources.toSourceReference(snapshot));
    const artifact = this.store.putArtifact({
      conversationId: task.conversationId, taskId: task.id, kind: "evidence_package", title: "结构化金融数据", status: "verified",
      data: { ingestionKey, connectorId: input.connectorId, operation: input.operation, entity: adapted.entity, asOf: adapted.asOf, providerResponseRef, facts }, sourceRefs, createdBy: input.connectorId,
    });
    for (const fact of facts) this.provenance.addEdge(fact.id, artifact.id, "included_in");
    this.store.appendEvent({ conversationId: task.conversationId, taskId: task.id, type: "financial.data_ingested", actorType: "system", actorId: input.connectorId, payload: { artifactId: artifact.id, entity: adapted.entity, asOf: adapted.asOf, responseFingerprint: providerResponseRef?.fingerprint, factIds: facts.map((fact) => fact.id), ontologyFactRefs: facts.map((fact) => fact.ontologyFactRef) } });
    this.queueEvidenceRecompute(task, "evidence_evaluation", artifact.id);
    return artifact;
  }

  async prepareModelReportDraft(taskId: string, provider: ModelProvider | null): Promise<Artifact | null> {
    const task = this.requireTask(taskId);
    const composeNode = this.store.listTaskNodes(task.id).find((node) => node.kind === "compose");
    if (!composeNode || !["pending", "ready", "failed"].includes(composeNode.status) || Number(composeNode.budget.maxModelCalls || 0) < 1) return null;
    if (!composeNode.dependsOn.every((id) => this.store.getTaskNode(id)?.status === "completed")) return null;
    if (this.store.listPendingApprovals(task.conversationId).some((approval) => approval.taskId === task.id)) return null;
    const artifacts = this.store.listArtifacts(task.id);
    const existing = [...artifacts].reverse().find((artifact) => artifact.kind === "review" && artifact.title === "受约束模型章节草拟" && artifact.nodeId === composeNode.id && artifact.status !== "superseded");
    if (existing) return existing;
    const judgment = [...artifacts].reverse().find((artifact) => artifact.kind === "judgment");
    const evidence = [...artifacts].reverse().find((artifact) => artifact.kind === "evidence_package" && artifact.title === "证据评估");
    const hypotheses = [...artifacts].reverse().find((artifact) => artifact.kind === "hypothesis_map");
    const methods = [...artifacts].reverse().find((artifact) => artifact.kind === "method_application");
    const evidenceData = evidence?.data as { facts?: Array<import("@/src/contracts").EvidenceFact & { ontologyFactRef?: string }>; sufficient?: boolean; stopReason?: string } | undefined;
    const reportInput = {
      task, judgment: judgment?.data as JudgmentSurfaceData | undefined, evidence: evidenceData,
      hypotheses: hypotheses?.data as import("@/src/contracts").HypothesisMapSurfaceData | undefined,
      methodPlan: methods?.data as ResearchMethodPlan | undefined, sourceRefs: evidence?.sourceRefs || [],
    };
    const baseline = composeProfessionalReport(reportInput);
    const attempt = await requestReportSectionDrafts(this.store, provider, {
      task, baseline, judgment: reportInput.judgment, evidenceFacts: evidenceData?.facts || [], sourceRefs: baseline.sourceRefs,
    });
    if (!attempt.attempted) return null;
    const artifact = this.store.putArtifact({
      conversationId: task.conversationId, taskId: task.id, nodeId: composeNode.id, kind: "review", title: "受约束模型章节草拟",
      status: attempt.drafts?.length ? "verified" : "draft", data: attempt, sourceRefs: baseline.sourceRefs, createdBy: attempt.provider || provider?.id || "model-drafter",
    });
    this.store.appendEvent({
      conversationId: task.conversationId, taskId: task.id, nodeId: composeNode.id,
      type: attempt.drafts?.length ? "report.model_draft_verified" : "report.model_draft_rejected", actorType: "system", actorId: "report-model-drafter",
      payload: { artifactId: artifact.id, provider: attempt.provider, model: attempt.model, cached: attempt.cached, fingerprint: attempt.fingerprint, sectionKeys: attempt.drafts?.map((draft) => draft.sectionKey) || [], errors: attempt.errors, usage: attempt.usage },
    });
    return artifact;
  }

  submitGoal(conversationId: string, content: string, proposal?: PlannerProposal, options: { pinnedAssetRefs?: AssetRef[]; reportSpec?: ReportSpecInput } = {}): { task: Task; approval?: ApprovalRequest } {
    const conversation = this.store.getConversation(conversationId);
    if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);
    const accessibleRefs = this.store.listReleasedAssetRefs(conversation);
    const accessibleKeys = new Set(accessibleRefs.map((ref) => `${ref.assetId}:${ref.version}:${ref.fingerprint}`));
    const pinnedAssetRefs = options.pinnedAssetRefs || [];
    if (pinnedAssetRefs.some((ref) => !accessibleKeys.has(`${ref.assetId}:${ref.version}:${ref.fingerprint}`))) {
      throw new Error("Pinned knowledge must belong to the current accessible Release");
    }
    this.store.addMessage({ conversationId, actorType: "researcher", actorId: "researcher", content });
    const compiled: CompiledResearchPlan = proposal
      ? compilePlannerProposal(proposal, content, DEFAULT_BUDGET)
      : { plan: planResearch(content), source: "deterministic", proposalFingerprint: requestFingerprint("local", "deterministic-planner", content), diagnostics: [] };
    const plan = compiled.plan;
    const researchCaseId = this.ensureResearchCase(conversationId, content);
    const reportSpec = reportSpecForGoal(content, options.reportSpec);
    const methodPlan = selectResearchMethods(content, reportSpec);
    const task = this.store.createTask({ conversationId, researchCaseId, goal: content, intent: plan.intent, reportSpec, status: plan.intent === "clarify" ? "waiting_input" : "waiting_approval", budget: DEFAULT_BUDGET });
    this.store.createKnowledgeLock(task.id);
    if (pinnedAssetRefs.length) this.store.appendEvent({ conversationId, taskId: task.id, type: "context.pinned", actorType: "researcher", actorId: "researcher", payload: { assetRefs: pinnedAssetRefs } });
    const nodes = materializeNodes(task.id, plan, task.budget);
    this.store.addTaskNodes(nodes);
    const planArtifact = this.store.putArtifact({
      conversationId, taskId: task.id, kind: "research_plan", title: "可调整研究计划", status: "draft",
      data: { ...this.publicPlan(plan, nodes, task.reportSpec, methodPlan), planner: { source: compiled.source, proposalFingerprint: compiled.proposalFingerprint, diagnostics: compiled.diagnostics } }, sourceRefs: [], createdBy: "research-lead",
    });
    this.store.appendEvent({ conversationId, taskId: task.id, type: "planner.compiled", actorType: "system", actorId: "plan-compiler", payload: { source: compiled.source, proposalFingerprint: compiled.proposalFingerprint, diagnostics: compiled.diagnostics } });
    this.store.appendEvent({ conversationId, taskId: task.id, type: "plan.proposed", actorType: "agent", actorId: "research-lead", payload: { planArtifactId: planArtifact.id, intent: plan.intent, nodeCount: nodes.length, plannerSource: compiled.source } });
    this.store.checkpoint({ taskId: task.id, phase: "after", state: { milestone: "plan_determined", planArtifactId: planArtifact.id, nodeIds: nodes.map((node) => node.id) } });
    this.store.putArtifact({ conversationId, taskId: task.id, kind: "ui_surface", title: "研究计划", status: "draft", data: this.planSurface(plan, nodes, task.reportSpec, methodPlan), sourceRefs: [], createdBy: "research-lead" });

    if (plan.intent === "clarify") {
      this.store.addMessage({ conversationId, actorType: "agent", actorId: "research-lead", content: "在开始研究前，我需要确认研究对象、希望支持的决策和时间范围。你可以直接补充，例如：研究对象 + 未来六个月 + 希望判断的问题。" });
      return { task };
    }
    const approval = this.store.createApproval({ conversationId, taskId: task.id, kind: "plan_confirmation", prompt: "按这份动态计划开始研究？你仍可直接修改目标或范围。" });
    this.store.appendEvent({ conversationId, taskId: task.id, type: "approval.requested", actorType: "system", actorId: "runtime", payload: { approvalId: approval.id, kind: approval.kind } });
    return { task, approval };
  }

  decideApproval(id: string, decision: "approved" | "rejected", note?: string): ApprovalRequest {
    const pending = this.store.getApproval(id);
    if (!pending) throw new Error(`Approval not found: ${id}`);
    if (pending.status !== "pending") throw new Error(`Approval is no longer pending: ${id}`);
    const judgmentRequest = decision === "approved" && pending.kind === "judgment_confirmation"
      ? this.prepareJudgmentCommit(pending)
      : undefined;
    const publicationRequest = decision === "approved" && pending.kind === "publish_confirmation"
      ? this.preparePublicationCommit(pending, note)
      : undefined;
    if (judgmentRequest) {
      const preview = this.actions.preview("ApproveJudgment", judgmentRequest.request, { actorType: "researcher", actorId: "researcher", conversationId: pending.conversationId, taskId: pending.taskId });
      if (!preview.eligible) throw new Error(preview.errors.join("; "));
      if (judgmentRequest.previousJudgmentRef) {
        const prior = this.actions.ontology.getObject(judgmentRequest.previousJudgmentRef);
        if (!prior || prior.type !== "Judgment") throw new Error("Previous formal Judgment is missing");
        const supersedePreview = this.actions.preview("SupersedeJudgment", {
          targetRefs: [{ id: prior.id, type: prior.type }], parameters: { reason: "研究员批准了修订后的判断", replacementRef: "pending" },
          expectedVersions: { [`${prior.type}:${prior.id}`]: prior.version }, idempotencyKey: `preview-supersede:${prior.id}`,
        }, { actorType: "researcher", actorId: "researcher", conversationId: pending.conversationId, taskId: pending.taskId });
        if (!supersedePreview.eligible) throw new Error(supersedePreview.errors.join("; "));
      }
    }
    if (publicationRequest) {
      const preview = this.actions.preview("PublishDeliverable", publicationRequest.request, { actorType: "researcher", actorId: "researcher", conversationId: pending.conversationId, taskId: pending.taskId });
      if (!preview.eligible) throw new Error(preview.errors.join("; "));
    }
    const approval = this.store.decideApproval(id, decision, note);
    this.store.appendEvent({ conversationId: approval.conversationId, taskId: approval.taskId, nodeId: approval.nodeId, type: "approval.decided", actorType: "researcher", actorId: "researcher", payload: { approvalId: id, decision, note } });
    this.store.checkpoint({ taskId: approval.taskId, nodeId: approval.nodeId, phase: "after", state: { milestone: "user_confirmation", approvalId: id, decision } });
    if (decision === "approved") {
      if (judgmentRequest) this.commitApprovedJudgment(approval, judgmentRequest);
      if (publicationRequest) this.commitApprovedPublication(approval, publicationRequest);
      this.store.updateTaskStatus(approval.taskId, "queued");
      this.store.enqueueTask(approval.taskId, "execute");
    } else {
      this.store.updateTaskStatus(approval.taskId, "waiting_input");
    }
    return approval;
  }

  executeTask(taskId: string): Task {
    const task = this.requireTask(taskId);
    if (["cancelled", "completed"].includes(task.status)) return task;
    this.store.updateTaskStatus(taskId, "running");
    this.store.appendEvent({ conversationId: task.conversationId, taskId, type: "task.started", actorType: "agent", actorId: "research-lead", payload: { recoveryCheckpoint: this.store.latestCheckpoint(taskId)?.id } });

    let progressed = true;
    while (progressed) {
      progressed = false;
      const nodes = this.store.listTaskNodes(taskId);
      for (const node of nodes) {
        if (!["ready", "pending", "failed"].includes(node.status)) continue;
        const deps = node.dependsOn.map((id) => this.store.getTaskNode(id));
        if (deps.some((dep) => dep?.status === "failed" || dep?.status === "blocked")) {
          this.store.updateNode(node.id, { status: "blocked" });
          continue;
        }
        if (!deps.every((dep) => dep?.status === "completed")) continue;
        progressed = true;
        this.executeNode(task, node);
        if (this.requireTask(taskId).status === "waiting_approval") return this.requireTask(taskId);
      }
    }

    const finalNodes = this.store.listTaskNodes(taskId);
    if (finalNodes.some((node) => node.status === "failed")) this.store.updateTaskStatus(taskId, "failed");
    else if (finalNodes.some((node) => node.status === "blocked")) this.store.updateTaskStatus(taskId, "waiting_input");
    else if (finalNodes.every((node) => node.status === "completed" || node.status === "cancelled")) this.store.updateTaskStatus(taskId, "completed");
    const updated = this.requireTask(taskId);
    this.store.appendEvent({ conversationId: task.conversationId, taskId, type: "task.settled", actorType: "system", actorId: "runtime", payload: { status: updated.status } });
    if (["completed", "failed", "cancelled"].includes(updated.status) && !this.store.getMiningRunByTask(taskId)) this.queueMining(taskId);
    return updated;
  }

  cancelTask(taskId: string): Task {
    const task = this.requireTask(taskId);
    this.store.updateTaskStatus(taskId, "cancelled");
    for (const node of this.store.listTaskNodes(taskId)) if (["pending", "ready", "running"].includes(node.status)) this.store.updateNode(node.id, { status: "cancelled" });
    this.store.appendEvent({ conversationId: task.conversationId, taskId, type: "task.cancelled", actorType: "researcher", actorId: "researcher", payload: {} });
    if (!this.store.getMiningRunByTask(taskId)) this.queueMining(taskId);
    return this.requireTask(taskId);
  }

  resumeTask(taskId: string): string {
    const task = this.requireTask(taskId);
    if (task.status === "cancelled") throw new Error("Cancelled task cannot be resumed; branch it instead.");
    for (const node of this.store.listTaskNodes(taskId)) if (node.status === "failed") this.store.updateNode(node.id, { status: "pending" });
    this.store.updateTaskStatus(taskId, "queued");
    const jobId = this.store.enqueueTask(taskId, "resume");
    this.store.appendEvent({ conversationId: task.conversationId, taskId, type: "task.resume_queued", actorType: "researcher", actorId: "researcher", payload: { jobId, checkpointId: this.store.latestCheckpoint(taskId)?.id } });
    return jobId;
  }

  branchTask(taskId: string, revisedGoal?: string): Task {
    const parent = this.requireTask(taskId);
    const goal = revisedGoal?.trim() || parent.goal;
    const plan = planResearch(goal);
    // A legacy 3.0 task may have no persisted ResearchCase. Branching is a new
    // 4.0 run, so create the aggregate root lazily instead of writing back to the
    // legacy task or attempting dual-write migration.
    const researchCaseId = this.ensureResearchCase(parent.conversationId, goal, parent.researchCaseId);
    const branch = this.store.createTask({ conversationId: parent.conversationId, researchCaseId, parentTaskId: parent.id, goal, intent: plan.intent, reportSpec: parent.reportSpec, status: "waiting_approval", budget: parent.budget });
    this.store.createKnowledgeLock(branch.id);
    const nodes = materializeNodes(branch.id, plan, branch.budget);
    this.store.addTaskNodes(nodes);
    const methodPlan = selectResearchMethods(goal, branch.reportSpec);
    this.store.putArtifact({ conversationId: branch.conversationId, taskId: branch.id, kind: "research_plan", title: "分支研究计划", status: "draft", data: this.publicPlan(plan, nodes, branch.reportSpec, methodPlan), sourceRefs: [], createdBy: "research-lead" });
    this.store.appendEvent({ conversationId: branch.conversationId, taskId: branch.id, type: "task.branched", actorType: "researcher", actorId: "researcher", payload: { parentTaskId: parent.id, revisedGoal: goal } });
    this.store.checkpoint({ taskId: branch.id, phase: "after", state: { milestone: "plan_determined", parentTaskId: parent.id } });
    this.store.createApproval({ conversationId: branch.conversationId, taskId: branch.id, kind: "plan_confirmation", prompt: "确认开始这个研究分支？" });
    return branch;
  }

  reviseArtifact(artifactId: string, expectedVersion: number, changes: Record<string, unknown>): ArtifactRevisionResult {
    const current = this.store.getArtifact(artifactId);
    if (!current) throw new Error(`Artifact not found: ${artifactId}`);
    if (!current.nodeId) throw new Error("Only node-produced artifacts can be edited");
    const surfaceArtifact = [...this.store.listArtifacts(current.taskId)].reverse().find((artifact) => {
      if (artifact.kind !== "ui_surface" || !artifact.data || typeof artifact.data !== "object") return false;
      return (artifact.data as { artifactId?: string }).artifactId === artifactId;
    });
    if (!surfaceArtifact) throw new Error("Editable surface not found for artifact");
    const surface = surfaceArtifact.data as UiSurface;
    const fields = Object.keys(changes);
    if (!fields.length) throw new Error("At least one artifact change is required");
    const forbidden = fields.filter((field) => !surface.editableFields.includes(field));
    if (forbidden.length) throw new Error(`Fields are not editable: ${forbidden.join(", ")}`);
    const nextData = current.kind === "judgment"
      ? refreshJudgmentReasoningRule({ ...(current.data as Record<string, unknown>), ...changes })
      : { ...(current.data as Record<string, unknown>), ...changes };
    if (current.kind === "judgment" && typeof nextData.ontologyJudgmentRef === "string" && nextData.ontologyJudgmentRef) {
      nextData.supersedesOntologyJudgmentRef = nextData.ontologyJudgmentRef;
      delete nextData.ontologyJudgmentRef;
      const reasoningChain = nextData.reasoningChain as JudgmentSurfaceData["reasoningChain"] | undefined;
      if (reasoningChain?.traceRef) nextData.supersedesReasoningTraceRef = reasoningChain.traceRef;
      delete nextData.reasoningChain;
      nextData.lifecycleStatus = "proposed";
      nextData.commitAction = "ApproveJudgment";
    }
    this.verifyArtifactRevision(current.kind, nextData, current.sourceRefs);
    const nextSurfaceData = current.kind === "judgment"
      ? refreshJudgmentReasoningRule({ ...(surface.data as unknown as Record<string, unknown>), ...changes })
      : { ...(surface.data as unknown as Record<string, unknown>), ...changes };
    if (current.kind === "judgment" && typeof nextSurfaceData.ontologyJudgmentRef === "string" && nextSurfaceData.ontologyJudgmentRef) {
      nextSurfaceData.supersedesOntologyJudgmentRef = nextSurfaceData.ontologyJudgmentRef;
      delete nextSurfaceData.ontologyJudgmentRef;
      const reasoningChain = nextSurfaceData.reasoningChain as JudgmentSurfaceData["reasoningChain"] | undefined;
      if (reasoningChain?.traceRef) nextSurfaceData.supersedesReasoningTraceRef = reasoningChain.traceRef;
      delete nextSurfaceData.reasoningChain;
      nextSurfaceData.lifecycleStatus = "proposed";
    }
    const nextSurface = { ...surface, data: nextSurfaceData } as unknown as UiSurface;
    const surfaceCheck = verifyUiSurface(nextSurface);
    if (!surfaceCheck.passed) throw new Error(surfaceCheck.errors.join("; "));

    const [revised, revisedSurface] = this.store.reviseArtifacts([
      { id: current.id, expectedVersion, data: nextData, createdBy: "researcher" },
      { id: surfaceArtifact.id, expectedVersion: surfaceArtifact.version, data: nextSurface, createdBy: "researcher" },
    ]);
    const ownerNode = this.store.getTaskNode(current.nodeId);
    if (!ownerNode) throw new Error(`Artifact owner node not found: ${current.nodeId}`);
    const descendants = this.descendantNodes(current.taskId, ownerNode.id);
    for (const node of descendants) this.store.updateNode(node.id, { status: "pending", inputArtifactIds: [], outputArtifactIds: [] });
    if (current.kind === "judgment") {
      const staleModelDrafts = this.store.listArtifacts(current.taskId).filter((artifact) => artifact.kind === "review" && artifact.title === "受约束模型章节草拟" && artifact.status !== "superseded");
      for (const draft of staleModelDrafts) this.store.reviseArtifacts([{ id: draft.id, expectedVersion: draft.version, status: "superseded", data: { ...(draft.data as Record<string, unknown>), invalidatedByArtifactId: current.id, invalidatedByVersion: expectedVersion + 1 }, createdBy: "artifact-invalidation" }]);
    }
    this.store.appendEvent({
      conversationId: current.conversationId, taskId: current.taskId, nodeId: current.nodeId, type: "artifact.edited",
      actorType: "researcher", actorId: "researcher",
      payload: { artifactId, fromVersion: current.version, toVersion: revised.version, fields, invalidatedNodeIds: descendants.map((node) => node.id) },
    });

    let approval: ApprovalRequest | undefined;
    if (current.kind === "judgment") {
      this.store.supersedePendingApprovals(current.nodeId, `已被 Artifact ${artifactId} v${revised.version} 取代`);
      approval = this.store.createApproval({
        conversationId: current.conversationId, taskId: current.taskId, nodeId: current.nodeId, kind: "judgment_confirmation",
        prompt: `判断已按你的修改更新为 v${revised.version}。确认后重新生成下游报告？`,
      });
      this.store.updateTaskStatus(current.taskId, "waiting_approval");
      this.store.appendEvent({ conversationId: current.conversationId, taskId: current.taskId, nodeId: current.nodeId, type: "approval.requested", actorType: "system", actorId: "runtime", payload: { approvalId: approval.id, kind: approval.kind, artifactId, artifactVersion: revised.version } });
    } else if (descendants.length) {
      this.store.updateTaskStatus(current.taskId, "queued");
      this.store.enqueueTask(current.taskId, "resume");
      this.store.appendEvent({ conversationId: current.conversationId, taskId: current.taskId, nodeId: current.nodeId, type: "artifact.recompute_queued", actorType: "system", actorId: "runtime", payload: { artifactId, artifactVersion: revised.version, nodeIds: descendants.map((node) => node.id) } });
    }
    return { artifact: revised, surfaceArtifact: revisedSurface, invalidatedNodeIds: descendants.map((node) => node.id), approval };
  }

  snapshot(conversationId: string, requestedTaskId?: string): ConversationSnapshot {
    const tasks = this.store.listTasks(conversationId);
    const task = (requestedTaskId ? tasks.find((item) => item.id === requestedTaskId) : undefined) || tasks[0] || null;
    return {
      conversation: this.store.getConversation(conversationId), messages: this.store.listMessages(conversationId), task,
      activeTaskId: task?.id || null, tasks,
      nodes: task ? this.store.listTaskNodes(task.id) : [], artifacts: task ? this.store.listArtifacts(task.id) : [],
      approvals: this.store.listPendingApprovals(conversationId), events: this.store.listEvents(conversationId),
    };
  }

  private ensureResearchCase(conversationId: string, goal: string, preferredId?: string): string {
    const preferred = preferredId ? this.actions.ontology.getObject(preferredId) : null;
    if (preferred?.type === "ResearchCase" && preferred.status === "active") return preferred.id;
    const existing = this.actions.ontology.listObjects("ResearchCase")
      .find((object) => object.properties.conversation_ref === conversationId && object.status === "active");
    if (existing) return existing.id;
    const conversation = this.store.getConversation(conversationId);
    if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);
    const created = this.actions.apply("CreateResearchCase", {
      targetRefs: [], parameters: { title: conversation.title, goal, conversationRef: conversationId }, expectedVersions: {},
      idempotencyKey: `create-case:${conversationId}`,
    }, { actorType: "researcher", actorId: conversation.userId, conversationId });
    const researchCase = created.objects.find((object) => object.type === "ResearchCase");
    if (!researchCase) throw new Error("CreateResearchCase did not return a ResearchCase");
    return researchCase.id;
  }

  private executeNode(task: Task, node: TaskNode): void {
    const nodeType = getResearchNodeType(node.kind);
    if (nodeType.outputKind !== "runtime_context") {
      const capabilityCheck = verifyArtifactWrite(node.assignedAgent, nodeType.outputKind);
      if (!capabilityCheck.passed) throw new Error(capabilityCheck.errors.join("; "));
    }
    this.store.updateNode(node.id, { status: "running" });
    const started = Date.now();
    this.store.appendEvent({ conversationId: task.conversationId, taskId: task.id, nodeId: node.id, type: `${node.capabilityType}.started`, actorType: "agent", actorId: "research-lead", payload: { capabilityId: node.capabilityId, inputArtifactIds: node.inputArtifactIds } });
    try {
      const artifact = this.executeNodeLocally(task, node);
      this.store.updateNode(node.id, { status: "completed", outputArtifactIds: artifact ? [artifact.id] : [] });
      this.store.appendEvent({ conversationId: task.conversationId, taskId: task.id, nodeId: node.id, type: `${node.capabilityType}.completed`, actorType: "agent", actorId: "research-lead", payload: { capabilityId: node.capabilityId, artifactId: artifact?.id, latencyMs: Date.now() - started } });
      if (nodeType.checkpointAfter) this.store.checkpoint({ taskId: task.id, nodeId: node.id, phase: "after", state: { milestone: node.kind, artifactId: artifact?.id } });
      if (artifact) this.requestMilestoneApproval(task, node, artifact);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.updateNode(node.id, { status: "failed" });
      this.store.appendEvent({ conversationId: task.conversationId, taskId: task.id, nodeId: node.id, type: `${node.capabilityType}.failed`, actorType: "system", actorId: "runtime", payload: { capabilityId: node.capabilityId, error: message } });
      throw error;
    }
  }

  private executeNodeLocally(task: Task, node: TaskNode): Artifact | null {
    const artifacts = this.store.listArtifacts(task.id);
    const base = { conversationId: task.conversationId, taskId: task.id, nodeId: node.id, status: "draft" as const, sourceRefs: [], createdBy: "research-lead" };
    switch (node.kind) {
      case "clarify":
        return this.store.putArtifact({ ...base, kind: "research_plan", title: "待澄清研究目标", data: { questions: ["研究对象是什么？", "希望支持哪项决策？", "时间范围是什么？"] } });
      case "semantic_context":
        {
          const index = this.semantic.buildIndex();
          const selected = this.semantic.searchSync({ text: task.goal, strategies: ["fts", "structured"], limit: 12 });
          const lock = this.store.getKnowledgeLock(task.id) || this.store.createKnowledgeLock(task.id);
          const pinnedEvent = [...this.store.listEvents(task.conversationId, 0, 10_000)].reverse().find((event) => event.taskId === task.id && event.type === "context.pinned");
          const pinnedRefs = ((pinnedEvent?.payload as { assetRefs?: AssetRef[] } | undefined)?.assetRefs || []);
          const pinnedKeys = new Set(pinnedRefs.map((ref) => `${ref.assetId}:${ref.version}:${ref.fingerprint}`));
          const references = [
            ...lock.assetRefs.map((ref) => ({ id: ref.assetId, kind: "semantic" as const, version: ref.version, reason: pinnedKeys.has(`${ref.assetId}:${ref.version}:${ref.fingerprint}`) ? "pinned by researcher from released knowledge" : "selected from released knowledge baseline", freshnessAt: lock.asOf, assetRef: ref })),
            ...selected.map((ref) => ({ id: ref.refId, kind: "semantic" as const, version: ref.version, reason: `${ref.reason}；${ref.path}`, freshnessAt: new Date().toISOString() })),
          ];
          for (const ref of lock.assetRefs) this.store.observeAssetUsage({ taskId: task.id, assetRef: ref, selectedReason: "context_builder", outcome: "used" });
          this.store.putContextPackage({
            taskId: task.id, nodeId: node.id, knowledgeLockId: lock.id, asOf: lock.asOf,
            releaseIds: { global: lock.globalReleaseId, tenant: lock.tenantReleaseId, user: lock.userReleaseId },
            references, tokenBudget: 8_000,
          });
          this.store.appendEvent({ conversationId: task.conversationId, taskId: task.id, nodeId: node.id, type: "semantic.indexed", actorType: "system", actorId: "semantic-gateway", payload: index });
        }
        return null;
      case "method_selection":
        return this.store.putArtifact({ ...base, kind: "method_application", title: "章节方法蓝图", data: selectResearchMethods(task.goal, task.reportSpec) });
      case "impact_analysis":
        return this.store.putArtifact({ ...base, kind: "research_plan", title: "影响范围", data: { reusedArtifactIds: [], invalidatedArtifactIds: [], reason: "等待可核验的新材料与时间范围元数据" } });
      case "evidence_discovery": {
        const result = this.store.runToolOnce({ key: `${task.id}:${node.id}:source.discover:v2`, toolId: "source.discover", taskId: task.id }, () => {
          const candidates = this.sources.discover(task.goal);
          return { candidates, activities: [{ status: candidates.length ? "completed" : "no_match", channel: "local-governed-assets", candidateCount: candidates.length }] };
        }).result;
        this.store.appendEvent({ conversationId: task.conversationId, taskId: task.id, nodeId: node.id, type: "source.discovered", actorType: "system", actorId: "source.discover", payload: { candidateCount: result.candidates.length } });
        return this.store.putArtifact({ ...base, kind: "evidence_package", title: "候选来源", data: result });
      }
      case "evidence_capture": {
        const discovery = [...artifacts].reverse().find((artifact) => artifact.kind === "evidence_package" && artifact.title === "候选来源");
        const candidates = ((discovery?.data as { candidates?: SourceCandidate[] } | undefined)?.candidates || []).slice(0, 4);
        const externalCaptures = artifacts.filter((artifact) => artifact.kind === "evidence_package" && artifact.title === "外部来源快照" && artifact.status === "verified")
          .flatMap((artifact) => (artifact.data as { captures?: Array<{ id: string; ontologySnapshotRef?: string }> }).captures || []);
        const captureInputFingerprint = requestFingerprint("source.capture", "v3", { candidateIds: candidates.map((candidate) => candidate.id), externalSnapshotIds: externalCaptures.map((capture) => capture.id).sort() });
        const result = this.store.runToolOnce({ key: `${task.id}:${node.id}:source.capture:v3:${captureInputFingerprint}`, toolId: "source.capture", taskId: task.id }, () => {
          const snapshots = candidates.map((candidate) => this.sources.capture(candidate));
          const caseObject = this.actions.ontology.getObject(task.researchCaseId);
          if (!caseObject) throw new Error(`ResearchCase not found: ${task.researchCaseId}`);
          const localCaptures = snapshots.map((snapshot) => {
            const captured = this.actions.apply("CaptureSource", {
              targetRefs: [{ id: caseObject.id, type: caseObject.type }],
              parameters: {
                title: snapshot.title, uri: snapshot.uri, publishedAt: snapshot.publishedAt || snapshot.capturedAt,
                sourceTier: snapshot.sourceType === "primary" ? "S1" : "S3", locator: snapshot.locator,
                contentHash: snapshot.contentHash, capturedAt: snapshot.capturedAt,
                accessScope: snapshot.permissionScope, quote: snapshot.quote,
              },
              expectedVersions: { [`${caseObject.type}:${caseObject.id}`]: caseObject.version },
              idempotencyKey: `capture-source:${snapshot.id}`, knowledgeLockId: this.store.getKnowledgeLock(task.id)?.id,
            }, { actorType: "system", actorId: "source.capture", conversationId: task.conversationId, taskId: task.id });
            const ontologySnapshot = captured.objects.find((object) => object.type === "SourceSnapshot");
            if (!ontologySnapshot) throw new Error("CaptureSource did not create SourceSnapshot");
            this.actions.apply("VerifySourceSnapshot", {
              targetRefs: [{ id: ontologySnapshot.id, type: ontologySnapshot.type }],
              parameters: { decision: snapshot.verification, note: "provenance verifier result" },
              expectedVersions: { [`${ontologySnapshot.type}:${ontologySnapshot.id}`]: ontologySnapshot.version },
              idempotencyKey: `verify-source:${snapshot.id}`, knowledgeLockId: this.store.getKnowledgeLock(task.id)?.id,
            }, { actorType: "system", actorId: "provenance-verifier", conversationId: task.conversationId, taskId: task.id });
            const { body: _body, ...safeSnapshot } = snapshot;
            return { ...safeSnapshot, ontologySnapshotRef: ontologySnapshot.id };
          });
          const captures = [...new Map([...localCaptures, ...externalCaptures].map((capture) => [capture.id, capture])).values()];
          return { captures, explicitNoAvailableSource: captures.length === 0, externalCaptureCount: externalCaptures.length };
        }).result;
        const sourceRefs = result.captures.map((capture) => {
          const snapshot = this.provenance.getSnapshot(capture.id);
          if (!snapshot) throw new Error(`Captured snapshot missing from provenance store: ${capture.id}`);
          return this.sources.toSourceReference(snapshot);
        });
        this.store.appendEvent({ conversationId: task.conversationId, taskId: task.id, nodeId: node.id, type: "source.captured", actorType: "system", actorId: "source.capture", payload: { snapshotIds: result.captures.map((capture) => capture.id), verifiedCount: sourceRefs.filter((ref) => ref.verification === "verified").length } });
        return this.store.putArtifact({ ...base, kind: "evidence_package", title: "来源快照", data: result, sourceRefs });
      }
      case "evidence_evaluation": {
        const captured = [...artifacts].reverse().find((artifact) => artifact.kind === "evidence_package" && artifact.title === "来源快照");
        const captures = ((captured?.data as { captures?: Array<{ id: string; ontologySnapshotRef?: string }> } | undefined)?.captures || []);
        const snapshotIds = captures.map((item) => item.id);
        const capturedSourceRefs = snapshotIds.flatMap((id) => {
          const snapshot = this.provenance.getSnapshot(id);
          return snapshot ? [this.sources.toSourceReference(snapshot)] : [];
        });
        const capturedFacts = captures.flatMap((capture) => {
          const snapshot = this.provenance.getSnapshot(capture.id);
          if (!snapshot || snapshot.verification !== "verified") return [];
          const factType = /预计|预期|展望|expects?|outlook|forecast/i.test(snapshot.quote) ? "forecast" as const : "reported_fact" as const;
          const fact = this.provenance.promoteFact({ snapshotId: capture.id, statement: snapshot.quote, factType, confidence: "medium" });
          const evidenceRoles = deriveEvidenceRoles(fact.statement);
          if (!capture.ontologySnapshotRef) return [{ ...fact, evidenceRoles, ontologyFactRef: undefined }];
          const ontologySnapshot = this.actions.ontology.getObject(capture.ontologySnapshotRef);
          if (!ontologySnapshot) throw new Error(`Ontology SourceSnapshot not found: ${capture.ontologySnapshotRef}`);
          const accepted = this.actions.apply("AcceptClaim", {
            targetRefs: [{ id: ontologySnapshot.id, type: ontologySnapshot.type }],
            parameters: { statement: snapshot.quote, locator: snapshot.locator, cutoffAt: snapshot.capturedAt, semanticRefs: [] },
            expectedVersions: { [`${ontologySnapshot.type}:${ontologySnapshot.id}`]: ontologySnapshot.version },
            idempotencyKey: `accept-claim:${snapshot.id}`, knowledgeLockId: this.store.getKnowledgeLock(task.id)?.id,
          }, { actorType: "agent", actorId: "research-lead", conversationId: task.conversationId, taskId: task.id });
          const claim = accepted.objects.find((object) => object.type === "EvidenceClaim");
          if (!claim) throw new Error("AcceptClaim did not create EvidenceClaim");
          const promoted = this.actions.apply("PromoteEvidenceFact", {
            targetRefs: [{ id: claim.id, type: claim.type }],
            parameters: { statement: snapshot.quote, subjectRef: task.researchCaseId, scopeRef: task.researchCaseId, cutoffAt: snapshot.capturedAt },
            expectedVersions: { [`${claim.type}:${claim.id}`]: claim.version },
            idempotencyKey: `promote-fact:${snapshot.id}`, knowledgeLockId: this.store.getKnowledgeLock(task.id)?.id,
          }, { actorType: "agent", actorId: "research-lead", conversationId: task.conversationId, taskId: task.id });
          return [{ ...fact, evidenceRoles, ontologyFactRef: promoted.objects.find((object) => object.type === "EvidenceFact")?.id }];
        });
        const financialArtifacts = artifacts.filter((artifact) => artifact.kind === "evidence_package" && artifact.title === "结构化金融数据" && artifact.status === "verified");
        const financialFacts = financialArtifacts.flatMap((artifact) => (artifact.data as { facts?: Array<import("@/src/contracts").EvidenceFact & { ontologyFactRef?: string }> }).facts || []);
        const facts = [...new Map([...capturedFacts, ...financialFacts].filter((fact) => fact.status === "verified").map((fact) => [fact.id, fact])).values()];
        const sourceRefs = [...new Map([...capturedSourceRefs, ...financialArtifacts.flatMap((artifact) => artifact.sourceRefs)].map((source) => [source.sourceId, source])).values()];
        const independentPublishers = new Set(sourceRefs.map((source) => source.publisherId).filter(Boolean));
        const functionResult = this.functions.execute("AssessEvidenceUsability", { evidenceRefs: facts.map((fact) => fact.ontologyFactRef).filter(Boolean), judgmentUnitRefs: [] });
        const sufficient = facts.length >= 2 && independentPublishers.size >= 2 && functionResult.sufficient === true;
        const evidence = this.store.putArtifact({ ...base, status: facts.length ? "verified" : "draft", kind: "evidence_package", title: "证据评估", sourceRefs, data: {
          facts, qualifiedEvidenceCount: facts.length, independentPublisherCount: independentPublishers.size, sufficient, functionResult,
          stopReason: sufficient ? undefined : "至少需要两份经 Source Capture 和 provenance verifier 核验、且发布主体不同的相关来源。",
        } });
        for (const fact of facts) this.provenance.addEdge(fact.id, evidence.id, "included_in");
        this.store.appendEvent({ conversationId: task.conversationId, taskId: task.id, nodeId: node.id, type: "evidence.promoted", actorType: "system", actorId: "provenance-verifier", payload: { factIds: facts.map((fact) => fact.id), sufficient } });
        this.putSurface(task, node, "evidence_matrix", "证据矩阵", { rows: facts, sufficient, gap: sufficient ? undefined : "补充第二份可独立定位且发布主体不同的来源" }, evidence.id);
        return evidence;
      }
      case "hypothesis": {
        const result = this.functions.execute("GenerateHypothesisCandidates", { caseRef: task.researchCaseId, statement: task.goal });
        const artifact = this.store.putArtifact({ ...base, kind: "hypothesis_map", title: "假设与竞争解释", data: { ...result, status: "candidate_only", commitAction: "AcceptHypothesis" } });
        this.putSurface(task, node, "hypothesis_map", "假设与竞争解释", { hypotheses: (result.hypothesisCandidates || []) as Array<{ statement: string; falsificationConditions: string[]; status: string }>, status: "candidate_only" }, artifact.id);
        return artifact;
      }
      case "judgment": {
        const evidence = [...artifacts].reverse().find((artifact) => artifact.kind === "evidence_package" && artifact.title === "证据评估");
        const evidenceData = (evidence?.data || {}) as { sufficient?: boolean; facts?: Array<import("@/src/contracts").EvidenceFact & { ontologyFactRef?: string }> };
        const evidenceRefs = (evidenceData.facts || []).map((fact) => fact.ontologyFactRef).filter((id): id is string => Boolean(id));
        const selectedMethods = [...artifacts].reverse().find((artifact) => artifact.kind === "method_application");
        const assessedMethods = assessResearchMethods((selectedMethods?.data as ResearchMethodPlan | undefined) || selectResearchMethods(task.goal, task.reportSpec), evidenceData.facts || [], false);
        const coreMethod = assessedMethods.applications.find((item) => item.sectionKey === "core_judgments");
        const methodInputsReady = Boolean(coreMethod && coreMethod.missingEvidenceRoles.length === 0);
        const hasQualified = evidenceData.sufficient === true && methodInputsReady;
        const computed = this.functions.execute("ComputeJudgmentProposal", { caseRef: task.researchCaseId, evidenceRefs, hypothesisRefs: [], statement: hasQualified ? "证据门槛已满足，等待研究员复核。" : "暂不可判断" });
        const executedMethods = hasQualified ? assessResearchMethods(assessedMethods, evidenceData.facts || [], true) : assessedMethods;
        if (selectedMethods) this.store.reviseArtifacts([{ id: selectedMethods.id, expectedVersion: selectedMethods.version, data: executedMethods, createdBy: "ComputeJudgmentProposal" }]);
        const executedCore = executedMethods.applications.find((item) => item.sectionKey === "core_judgments");
        this.store.appendEvent({ conversationId: task.conversationId, taskId: task.id, nodeId: node.id, type: "method.applications_assessed", actorType: "system", actorId: "research-design", payload: { methodArtifactId: selectedMethods?.id, executedApplicationIds: executedMethods.applications.filter((item) => item.executionStatus === "executed").map((item) => item.id), blockedApplicationIds: executedMethods.applications.filter((item) => item.executionStatus === "blocked").map((item) => item.id) } });
        const proposal = computed.judgmentProposal as Record<string, unknown>;
        const signalInputs = (evidenceData.facts || []).flatMap((fact) => fact.ontologyFactRef ? [{ evidenceFactRef: fact.ontologyFactRef, statement: fact.statement, evidenceRoles: fact.evidenceRoles || [] }] : []);
        const signalRoles = Object.fromEntries(signalInputs.map((input) => [input.evidenceFactRef, "context" as const]));
        const judgmentData: JudgmentSurfaceData & { commitAction: string | null } = {
          statement: String(proposal.statement || "暂不可判断"),
          confidence: typeof proposal.confidence === "string" ? proposal.confidence : "insufficient",
          epistemicStatus: proposal.epistemicStatus as JudgmentSurfaceData["epistemicStatus"],
          lifecycleStatus: proposal.lifecycleStatus as JudgmentSurfaceData["lifecycleStatus"],
          evidenceRefs,
          methodApplicationRefs: executedCore ? [executedCore.id] : [],
          methodGateStatus: executedCore?.gateStatus || "blocked",
          judgmentType: executedCore?.judgmentType,
          signalInputs,
          signalRoles,
          reasoningRule: { ruleRef: "judgment_evidence_threshold", conditions: [
            { id: "verified_evidence", label: "所有信号输入均为已核验 EvidenceFact", passed: signalInputs.length > 0 },
            { id: "executed_method_application", label: "核心 MethodApplication 已执行并通过", passed: executedCore?.executionStatus === "executed" && executedCore.gateStatus === "passed" },
            { id: "support_signal_present", label: "研究员至少指定一条支持信号", passed: false },
            { id: "no_block_signal", label: "不存在阻断信号", passed: true },
          ] },
          disposition: hasQualified ? "review_required" : "abstain",
          changeConditions: hasQualified ? ["核心方法输入出现反向证据", "关键事实完成同口径刷新"] : ["补齐方法缺口：" + (coreMethod?.missingEvidenceRoles.join("、") || "未选择核心方法"), "关键事实完成交叉验证"],
          commitAction: hasQualified ? "ApproveJudgment" : null,
        };
        const judgment = this.store.putArtifact({ ...base, kind: "judgment", title: "当前判断", data: judgmentData });
        this.putSurface(task, node, "judgment_card", "当前判断", judgmentData, judgment.id, hasQualified ? ["statement", "confidence", "changeConditions", "signalRoles"] : ["changeConditions"]);
        return judgment;
      }
      case "compose": {
        const judgment = [...artifacts].reverse().find((artifact) => artifact.kind === "judgment");
        if (task.intent === "compose_only" && !judgment) throw new Error("没有可复用的正式 Judgment；需要先选择历史制品。");
        const evidence = [...artifacts].reverse().find((artifact) => artifact.kind === "evidence_package" && artifact.title === "证据评估");
        const hypotheses = [...artifacts].reverse().find((artifact) => artifact.kind === "hypothesis_map");
        const methods = [...artifacts].reverse().find((artifact) => artifact.kind === "method_application");
        const modelDraftArtifact = [...artifacts].reverse().find((artifact) => artifact.kind === "review" && artifact.title === "受约束模型章节草拟" && artifact.status === "verified");
        const modelDrafting = modelDraftArtifact?.data as ReportDraftingAttempt | undefined;
        const draft = composeProfessionalReport({
          task, judgment: judgment?.data as JudgmentSurfaceData | undefined,
          evidence: evidence?.data as { facts?: import("@/src/contracts").EvidenceFact[]; sufficient?: boolean; stopReason?: string } | undefined,
          hypotheses: hypotheses?.data as import("@/src/contracts").HypothesisMapSurfaceData | undefined,
          methodPlan: methods?.data as ResearchMethodPlan | undefined,
          sourceRefs: evidence?.sourceRefs || [],
          modelDrafting: modelDrafting?.drafts?.length ? modelDrafting : undefined,
        });
        const report = this.store.putArtifact({ ...base, kind: "report", title: draft.title, data: draft.data, sourceRefs: draft.sourceRefs });
        const caseObject = this.actions.ontology.getObject(task.researchCaseId);
        if (!caseObject) throw new Error(`ResearchCase not found: ${task.researchCaseId}`);
        const ontologyJudgmentRef = judgment && typeof judgment.data === "object" ? String((judgment.data as { ontologyJudgmentRef?: string }).ontologyJudgmentRef || "") : "";
        const created = this.actions.apply("CreateResearchDeliverable", {
          targetRefs: [{ id: caseObject.id, type: caseObject.type }],
          parameters: {
            title: report.title, artifactRef: report.id, judgmentRefs: ontologyJudgmentRef ? [ontologyJudgmentRef] : [],
            reportKind: task.reportSpec.kind, audience: task.reportSpec.audience, depth: task.reportSpec.depth,
            reportSpecVersion: task.reportSpec.version, sectionKeys: task.reportSpec.sections,
          },
          expectedVersions: { [`${caseObject.type}:${caseObject.id}`]: caseObject.version },
          idempotencyKey: `create-deliverable:${report.id}`, knowledgeLockId: this.store.getKnowledgeLock(task.id)?.id,
        }, { actorType: "agent", actorId: "research-lead", conversationId: task.conversationId, taskId: task.id });
        const deliverableRef = created.objects.find((object) => object.type === "ResearchDeliverable")?.id;
        const reportWithRef = this.store.putArtifact({ ...report, id: report.id, data: { ...(report.data as unknown as Record<string, unknown>), ontologyDeliverableRef: deliverableRef } });
        this.putSurface(task, node, "report_editor", report.title, reportWithRef.data as ReportSurfaceData, reportWithRef.id, ["summary", "boundary"]);
        return reportWithRef;
      }
      case "audit": {
        const report = [...artifacts].reverse().find((artifact) => artifact.kind === "report");
        const evidence = [...artifacts].reverse().find((artifact) => artifact.kind === "evidence_package" && artifact.title === "证据评估");
        const facts = ((evidence?.data as { facts?: import("@/src/contracts").EvidenceFact[] } | undefined)?.facts || []);
        const claimResult = report ? verifyReportClaims(report.data, report.sourceRefs) : { verifier: "claim-provenance", passed: false, errors: ["missing report"], warnings: [] };
        const modelResult = report ? verifyModelDraftSections(report.data as ReportSurfaceData, report.sourceRefs, facts) : { verifier: "model-section-boundary", passed: false, errors: ["missing report"], warnings: [] };
        const result = { verifier: "citation-and-expression", passed: claimResult.passed && modelResult.passed, errors: [...claimResult.errors, ...modelResult.errors], warnings: [...claimResult.warnings, ...modelResult.warnings], checks: [claimResult, modelResult] };
        const qualityEvaluation = report ? evaluateReportQuality({ report: report.data as ReportSurfaceData, sourceRefs: report.sourceRefs, evidenceFacts: facts }) : undefined;
        const review = this.store.putArtifact({ ...base, kind: "review", title: "确定性审计", data: { ...result, qualityEvaluation } });
        if (report && qualityEvaluation) {
          const deliverableRef = String((report.data as ReportSurfaceData).ontologyDeliverableRef || "");
          const reportData = {
            ...(report.data as ReportSurfaceData), qualityEvaluation,
            ...(result.passed && deliverableRef ? { publication: { status: "verified_not_published" as const, ontologyDeliverableRef: deliverableRef } } : {}),
          };
          const surfaceArtifact = [...artifacts].reverse().find((artifact) => artifact.kind === "ui_surface" && (artifact.data as { artifactId?: string }).artifactId === report.id);
          if (!surfaceArtifact) throw new Error("Report surface is missing during quality evaluation");
          const surface = surfaceArtifact.data as Extract<UiSurface, { component: "report_editor" }>;
          const nextSurface = { ...surface, data: reportData };
          const surfaceCheck = verifyUiSurface(nextSurface);
          if (!surfaceCheck.passed) throw new Error(surfaceCheck.errors.join("; "));
          this.store.reviseArtifacts([
            { id: report.id, expectedVersion: report.version, data: reportData, status: report.status, createdBy: "report-quality-evaluator" },
            { id: surfaceArtifact.id, expectedVersion: surfaceArtifact.version, data: nextSurface, status: surfaceArtifact.status, createdBy: "report-quality-evaluator" },
          ]);
          this.store.appendEvent({
            conversationId: task.conversationId, taskId: task.id, nodeId: node.id, type: "report.quality_diagnostics_completed",
            actorType: "system", actorId: "report-quality-evaluator",
            payload: { reviewArtifactId: review.id, disciplineStatus: qualityEvaluation.disciplineStatus, formalResearchValueStatus: qualityEvaluation.formalResearchValue.status, missingFormalPrerequisites: qualityEvaluation.formalResearchValue.missingPrerequisites },
          });
        }
        const deliverableRef = report && typeof report.data === "object" && report.data ? String((report.data as { ontologyDeliverableRef?: string }).ontologyDeliverableRef || "") : "";
        if (deliverableRef && result.passed) {
          const deliverable = this.actions.ontology.getObject(deliverableRef);
          if (deliverable) this.actions.apply("VerifyResearchDeliverable", {
            targetRefs: [{ id: deliverable.id, type: deliverable.type }], parameters: { verifierRef: review.id, passed: true },
            expectedVersions: { [`${deliverable.type}:${deliverable.id}`]: deliverable.version },
            idempotencyKey: `verify-deliverable:${review.id}`, knowledgeLockId: this.store.getKnowledgeLock(task.id)?.id,
          }, { actorType: "system", actorId: "citation-and-expression", conversationId: task.conversationId, taskId: task.id });
        }
        return review;
      }
      default:
        throw new Error(`No executor for constrained node kind: ${node.kind}`);
    }
  }

  private queueMining(taskId: string): void {
    this.store.createMiningRun(taskId, "knowledge-learning/1.0.0");
    this.store.enqueueTask(taskId, "mine_assets");
  }

  private requestMilestoneApproval(task: Task, node: TaskNode, artifact: Artifact): void {
    let kind: ApprovalRequest["kind"] | undefined;
    let prompt = "";
    if (node.kind === "evidence_evaluation" && (artifact.data as { sufficient?: boolean }).sufficient === true) {
      kind = "evidence_confirmation";
      prompt = "关键证据已经达到最低门槛。确认这些证据可以进入判断环节？";
    }
    if (node.kind === "judgment" && (artifact.data as { disposition?: string }).disposition === "review_required") {
      kind = "judgment_confirmation";
      prompt = "判断提案已经形成。请先在判断卡中复核并保存表述、置信边界和改判条件，再确认生成报告。";
    }
    if (node.kind === "audit" && (artifact.data as { passed?: boolean }).passed === true) {
      const report = [...this.store.listArtifacts(task.id)].reverse().find((item) => item.kind === "report");
      const deliverableRef = report && typeof report.data === "object" ? String((report.data as ReportSurfaceData).ontologyDeliverableRef || "") : "";
      if (deliverableRef && this.actions.ontology.getObject(deliverableRef)?.properties.lifecycle_status === "verified") {
        kind = "publish_confirmation";
        prompt = "报告已通过确定性审计并显示专业质量边界。确认发布当前版本？";
      }
    }
    if (!kind) return;
    const approval = this.store.createApproval({ conversationId: task.conversationId, taskId: task.id, nodeId: node.id, kind, prompt });
    this.store.updateTaskStatus(task.id, "waiting_approval");
    this.store.appendEvent({ conversationId: task.conversationId, taskId: task.id, nodeId: node.id, type: "approval.requested", actorType: "system", actorId: "runtime", payload: { approvalId: approval.id, kind, artifactId: artifact.id, artifactVersion: artifact.version } });
    this.store.checkpoint({ taskId: task.id, nodeId: node.id, phase: "pause", state: { milestone: kind, approvalId: approval.id, artifactId: artifact.id, artifactVersion: artifact.version } });
  }

  private preparePublicationCommit(approval: ApprovalRequest, note?: string): PreparedPublicationCommit {
    const report = [...this.store.listArtifacts(approval.taskId)].reverse().find((artifact) => artifact.kind === "report");
    if (!report) throw new Error("Publish approval has no report artifact");
    const deliverableRef = typeof report.data === "object" && report.data ? String((report.data as ReportSurfaceData).ontologyDeliverableRef || "") : "";
    const deliverable = deliverableRef ? this.actions.ontology.getObject(deliverableRef) : null;
    if (!deliverable || deliverable.type !== "ResearchDeliverable") throw new Error("Publish approval has no governed ResearchDeliverable");
    if (deliverable.properties.lifecycle_status !== "verified") throw new Error("ResearchDeliverable must remain verified until publication approval is applied");
    return {
      reportArtifactId: report.id,
      deliverableRef,
      request: {
        targetRefs: [{ id: deliverable.id, type: deliverable.type }],
        parameters: { publicationNote: note?.trim() || "研究员确认发布当前已核验版本" },
        expectedVersions: { [`${deliverable.type}:${deliverable.id}`]: deliverable.version },
        idempotencyKey: `publish-deliverable:${deliverable.id}:approval:${approval.id}`,
        knowledgeLockId: this.store.getKnowledgeLock(approval.taskId)?.id,
      },
    };
  }

  private commitApprovedPublication(approval: ApprovalRequest, prepared: PreparedPublicationCommit): void {
    const request = { ...prepared.request, approvalToken: approval.id };
    const result = this.actions.apply("PublishDeliverable", request, {
      actorType: "researcher", actorId: "researcher", conversationId: approval.conversationId, taskId: approval.taskId,
    });
    const published = result.objects.find((object) => object.id === prepared.deliverableRef && object.type === "ResearchDeliverable");
    if (!published || published.properties.lifecycle_status !== "published") throw new Error("PublishDeliverable did not publish the ResearchDeliverable");
    const report = this.store.getArtifact(prepared.reportArtifactId);
    if (!report || report.kind !== "report") throw new Error("Published report artifact is missing");
    const surfaceArtifact = [...this.store.listArtifacts(approval.taskId)].reverse().find((artifact) => artifact.kind === "ui_surface" && (artifact.data as { artifactId?: string }).artifactId === report.id);
    if (!surfaceArtifact) throw new Error("Published report surface is missing");
    const evidence = [...this.store.listArtifacts(approval.taskId)].reverse().find((artifact) => artifact.kind === "evidence_package" && artifact.title === "证据评估");
    if (!evidence) throw new Error("Published report has no frozen evidence package");
    const currentReportData = report.data as ReportSurfaceData;
    const reportHash = `sha256:${requestFingerprint("runtime", "formal-evaluation-report-freeze/1.0.0", {
      reportSpec: currentReportData.reportSpec, summary: currentReportData.summary, boundary: currentReportData.boundary,
      claims: currentReportData.claims, sections: currentReportData.sections, methodApplications: currentReportData.methodApplications,
      sourceRefs: report.sourceRefs,
    })}`;
    const evidenceBundleHash = `sha256:${requestFingerprint("runtime", "formal-evaluation-evidence-freeze/1.0.0", { data: evidence.data, sourceRefs: evidence.sourceRefs })}`;
    const frozenAt = String(published.properties.published_at || new Date().toISOString());
    const evaluationFreeze: NonNullable<ReportSurfaceData["evaluationFreeze"]> = {
      version: "1.0.0", status: "frozen_for_evaluation", frozenAt, reportHash, evidenceBundleHash,
      reportArtifactVersion: report.version, evidenceArtifactId: evidence.id, evidenceArtifactVersion: evidence.version,
      protocolRef: "05_control_evaluation/05_evals/protocols/02_案例与数据契约.md",
    };
    const facts = ((evidence.data as { facts?: import("@/src/contracts").EvidenceFact[] }).facts || []);
    const qualityEvaluation = evaluateReportQuality({
      report: currentReportData, sourceRefs: report.sourceRefs, evidenceFacts: facts,
      formalPrerequisites: { frozenArtifactHash: reportHash, frozenEvidenceBundleHash: evidenceBundleHash },
    });
    const reportData: ReportSurfaceData = {
      ...currentReportData,
      qualityEvaluation,
      evaluationFreeze,
      publication: {
        status: "published" as const,
        ontologyDeliverableRef: prepared.deliverableRef,
        publishedAt: frozenAt,
        publicationNote: String(published.properties.publication_note || ""),
      },
    };
    const surface = surfaceArtifact.data as Extract<UiSurface, { component: "report_editor" }>;
    const nextSurface = { ...surface, data: reportData };
    const surfaceCheck = verifyUiSurface(nextSurface);
    if (!surfaceCheck.passed) throw new Error(surfaceCheck.errors.join("; "));
    this.store.reviseArtifacts([
      { id: report.id, expectedVersion: report.version, data: reportData, status: "verified", createdBy: "PublishDeliverable" },
      { id: surfaceArtifact.id, expectedVersion: surfaceArtifact.version, data: nextSurface, status: "verified", createdBy: "PublishDeliverable" },
    ]);
    this.store.appendEvent({
      conversationId: approval.conversationId, taskId: approval.taskId, nodeId: approval.nodeId, type: "report.published",
      actorType: "researcher", actorId: "researcher",
      payload: { artifactId: report.id, artifactVersion: report.version + 1, ontologyDeliverableRef: prepared.deliverableRef, actionExecutionId: result.execution.id, approvalId: approval.id },
    });
    this.store.appendEvent({
      conversationId: approval.conversationId, taskId: approval.taskId, nodeId: approval.nodeId, type: "report.evaluation_inputs_frozen",
      actorType: "system", actorId: "report-quality-evaluator",
      payload: { artifactId: report.id, artifactVersion: report.version + 1, reportHash, evidenceBundleHash, evidenceArtifactId: evidence.id, evidenceArtifactVersion: evidence.version, formalResearchValueStatus: qualityEvaluation.formalResearchValue.status, missingFormalPrerequisites: qualityEvaluation.formalResearchValue.missingPrerequisites },
    });
  }

  private prepareJudgmentCommit(approval: ApprovalRequest): PreparedJudgmentCommit {
    if (!approval.nodeId) throw new Error("Judgment approval is missing its node");
    const node = this.store.getTaskNode(approval.nodeId);
    const artifactId = node?.outputArtifactIds[0];
    const artifact = artifactId ? this.store.getArtifact(artifactId) : null;
    if (!artifact || artifact.kind !== "judgment") throw new Error("Judgment artifact is missing for approval");
    if (artifact.createdBy !== "researcher") throw new Error("Judgment must be reviewed and saved by the researcher before approval");
    const task = this.requireTask(approval.taskId);
    const data = artifact.data as JudgmentSurfaceData;
    if (data.disposition !== "review_required" || data.epistemicStatus !== "supported") throw new Error("Only a supported review-required Judgment can be approved");
    const evidenceRefs = Array.isArray(data.evidenceRefs) ? data.evidenceRefs : [];
    if (!evidenceRefs.length) throw new Error("Judgment approval requires verified EvidenceFact references");
    const methodApplicationRefs = Array.isArray(data.methodApplicationRefs) ? data.methodApplicationRefs : [];
    if (data.methodGateStatus !== "passed" || !methodApplicationRefs.length) throw new Error("Judgment approval requires an executed adjudication MethodApplication");
    const methodArtifact = [...this.store.listArtifacts(task.id)].reverse().find((item) => item.kind === "method_application");
    const methodPlan = methodArtifact?.data as ResearchMethodPlan | undefined;
    if (!methodPlan || methodApplicationRefs.some((id) => !methodPlan.applications.some((item) => item.id === id && item.executionStatus === "executed" && item.gateStatus === "passed"))) {
      throw new Error("Judgment MethodApplication references are not executed and gate-passed");
    }
    const signalInputs = Array.isArray(data.signalInputs) ? data.signalInputs : [];
    const signalRoles = data.signalRoles || {};
    if (!signalInputs.length || signalInputs.some((item) => !evidenceRefs.includes(item.evidenceFactRef))) throw new Error("Judgment reasoning requires signal inputs from its EvidenceFact references");
    if (!signalInputs.some((item) => signalRoles[item.evidenceFactRef] === "support")) throw new Error("Judgment reasoning requires at least one researcher-confirmed support signal");
    if (signalInputs.some((item) => signalRoles[item.evidenceFactRef] === "block")) throw new Error("A supported Judgment cannot be approved while a block signal is present");
    if (!data.judgmentType) throw new Error("Judgment reasoning requires a governed judgment type");
    const evidenceArtifact = [...this.store.listArtifacts(task.id)].reverse().find((item) => item.kind === "evidence_package" && item.title === "证据评估");
    const cutoffAt = evidenceArtifact?.sourceRefs.map((source) => source.capturedAt).sort().at(-1) || new Date().toISOString();
    const caseObject = this.actions.ontology.getObject(task.researchCaseId);
    if (!caseObject) throw new Error(`ResearchCase not found: ${task.researchCaseId}`);
    const timeHorizon = inferTimeHorizon(task.goal);
    const statement = data.statement;
    const judgmentType = data.judgmentType;
    const invalidationConditions = data.changeConditions;
    const context = { actorType: "researcher" as const, actorId: "researcher", conversationId: approval.conversationId, taskId: approval.taskId };
    const caseTarget = [{ id: caseObject.id, type: caseObject.type }];
    const idempotencyBase = `approve-judgment:${artifact.id}:v${artifact.version}`;
    const knowledgeLockId = this.store.getKnowledgeLock(task.id)?.id;
    const unitResult = this.actions.apply("CreateJudgmentUnit", {
      targetRefs: caseTarget,
      parameters: {
        statement,
        judgmentType,
        scopeLabel: "本轮研究范围",
        scopeDimensions: { research_case_ref: caseObject.id, judgment_statement: statement },
      },
      expectedVersions: { [`${caseObject.type}:${caseObject.id}`]: caseObject.version },
      idempotencyKey: `create-judgment-unit:${idempotencyBase}`,
      knowledgeLockId,
    }, context);
    const judgmentUnit = unitResult.objects.find((object) => object.type === "JudgmentUnit");
    const scope = unitResult.objects.find((object) => object.type === "ResearchScope")
      || this.actions.ontology.listLinksForObject(caseObject.id)
        .filter((link) => link.type === "caseHasScope" && link.sourceRef.id === caseObject.id)
        .map((link) => this.actions.ontology.getObject(link.targetRef.id))
        .find((object) => object?.type === "ResearchScope");
    if (!judgmentUnit || !scope) throw new Error("CreateJudgmentUnit did not produce JudgmentUnit and ResearchScope");
    const caseAfterUnit = this.actions.ontology.getObject(caseObject.id);
    if (!caseAfterUnit) throw new Error(`ResearchCase missing after CreateJudgmentUnit: ${caseObject.id}`);
    const hypothesisResult = this.actions.apply("AcceptHypothesis", {
      targetRefs: caseTarget,
      parameters: {
        statement,
        judgmentUnitRef: judgmentUnit.id,
        direction: "neutral",
        timeHorizon,
        falsificationConditions: invalidationConditions.length ? invalidationConditions : ["关键证伪条件尚未显式登记"],
        role: "primary",
      },
      expectedVersions: { [`${caseAfterUnit.type}:${caseAfterUnit.id}`]: caseAfterUnit.version },
      idempotencyKey: `accept-hypothesis:${idempotencyBase}`,
      knowledgeLockId,
    }, context);
    const hypothesis = hypothesisResult.objects.find((object) => object.type === "Hypothesis");
    if (!hypothesis) throw new Error("AcceptHypothesis did not create a Hypothesis");
    const caseAfterHypothesis = this.actions.ontology.getObject(caseObject.id);
    if (!caseAfterHypothesis) throw new Error(`ResearchCase missing after AcceptHypothesis: ${caseObject.id}`);
    return {
      request: {
        targetRefs: caseTarget,
        parameters: {
          statement, judgmentType, timeHorizon, epistemicStatus: "supported",
          confidence: ["low", "medium", "high"].includes(String(data.confidence)) ? data.confidence : "medium",
          scopeRef: scope.id, judgmentUnitRef: judgmentUnit.id, cutoffAt, evidenceRefs, methodApplicationRefs,
          signalInputs: signalInputs.map((item) => ({ evidenceFactRef: item.evidenceFactRef, statement: item.statement, role: signalRoles[item.evidenceFactRef] || "context" })),
          hypothesisRefs: [hypothesis.id], conditions: [],
          invalidationConditions,
        },
        expectedVersions: { [`${caseAfterHypothesis.type}:${caseAfterHypothesis.id}`]: caseAfterHypothesis.version },
        idempotencyKey: idempotencyBase,
        knowledgeLockId,
      },
      previousJudgmentRef: data.supersedesOntologyJudgmentRef,
      judgmentUnitRef: judgmentUnit.id,
      hypothesisRef: hypothesis.id,
    };
  }

  private commitApprovedJudgment(approval: ApprovalRequest, prepared: PreparedJudgmentCommit): void {
    const task = this.requireTask(approval.taskId);
    const result = this.actions.apply("ApproveJudgment", { ...prepared.request, approvalToken: approval.id }, {
      actorType: "researcher", actorId: "researcher", conversationId: approval.conversationId, taskId: approval.taskId,
    });
    const formal = result.objects.find((object) => object.type === "Judgment");
    if (!formal) throw new Error("ApproveJudgment did not create a formal Judgment");
    const judgmentUnit = this.actions.ontology.getObject(prepared.judgmentUnitRef);
    const hypothesis = this.actions.ontology.getObject(prepared.hypothesisRef);
    const signals = result.objects.filter((object) => object.type === "Signal");
    const ruleEvaluation = result.objects.find((object) => object.type === "RuleEvaluation");
    const trace = result.objects.find((object) => object.type === "ReasoningTrace");
    if (!judgmentUnit || judgmentUnit.type !== "JudgmentUnit" || !hypothesis || hypothesis.type !== "Hypothesis" || !signals.length || !ruleEvaluation || !trace) {
      throw new Error("ApproveJudgment did not create a complete formal reasoning chain");
    }
    const reasoningChain: NonNullable<JudgmentSurfaceData["reasoningChain"]> = {
      judgmentUnitRef: judgmentUnit.id,
      hypothesisRef: hypothesis.id,
      signalRefs: signals.map((signal) => signal.id),
      ruleEvaluationRef: ruleEvaluation.id,
      traceRef: trace.id,
    };
    const node = approval.nodeId ? this.store.getTaskNode(approval.nodeId) : null;
    const artifact = node?.outputArtifactIds[0] ? this.store.getArtifact(node.outputArtifactIds[0]) : null;
    if (!artifact || artifact.kind !== "judgment") throw new Error("Approved Judgment artifact is missing");
    const surfaceArtifact = [...this.store.listArtifacts(task.id)].reverse().find((item) => item.kind === "ui_surface" && (item.data as { artifactId?: string }).artifactId === artifact.id);
    if (!surfaceArtifact) throw new Error("Judgment surface is missing");
    let supersedeExecutionId: string | undefined;
    if (prepared.previousJudgmentRef) {
      const prior = this.actions.ontology.getObject(prepared.previousJudgmentRef);
      if (!prior || prior.type !== "Judgment") throw new Error("Previous formal Judgment is missing after approval");
      const superseded = this.actions.apply("SupersedeJudgment", {
        targetRefs: [{ id: prior.id, type: prior.type }], parameters: { reason: "研究员批准了修订后的判断", replacementRef: formal.id },
        expectedVersions: { [`${prior.type}:${prior.id}`]: prior.version }, idempotencyKey: `supersede-judgment:${prior.id}:with:${formal.id}`, approvalToken: approval.id,
      }, { actorType: "researcher", actorId: "researcher", conversationId: approval.conversationId, taskId: approval.taskId });
      supersedeExecutionId = superseded.execution.id;
    }
    const data = { ...(artifact.data as Record<string, unknown>), ontologyJudgmentRef: formal.id, supersedesOntologyJudgmentRef: undefined, reasoningChain, lifecycleStatus: "approved", commitAction: null };
    const surface = surfaceArtifact.data as UiSurface;
    const nextSurface = { ...surface, data: { ...(surface.data as unknown as Record<string, unknown>), ontologyJudgmentRef: formal.id, supersedesOntologyJudgmentRef: undefined, reasoningChain, lifecycleStatus: "approved" } } as unknown as UiSurface;
    const [revised] = this.store.reviseArtifacts([
      { id: artifact.id, expectedVersion: artifact.version, data, status: "verified", createdBy: "ApproveJudgment" },
      { id: surfaceArtifact.id, expectedVersion: surfaceArtifact.version, data: nextSurface, status: "verified", createdBy: "ApproveJudgment" },
    ]);
    this.store.appendEvent({ conversationId: task.conversationId, taskId: task.id, nodeId: node?.id, type: "judgment.committed", actorType: "researcher", actorId: "researcher", payload: { artifactId: revised.id, artifactVersion: revised.version, ontologyJudgmentRef: formal.id, reasoningTraceRef: trace.id, judgmentUnitRef: judgmentUnit.id, hypothesisRef: hypothesis.id, signalRefs: signals.map((signal) => signal.id), ruleEvaluationRef: ruleEvaluation.id, supersededJudgmentRef: prepared.previousJudgmentRef, supersededReasoningTraceRef: (artifact.data as JudgmentSurfaceData).supersedesReasoningTraceRef, actionExecutionId: result.execution.id, supersedeExecutionId } });
  }

  private putSurface<C extends UiSurface["component"]>(task: Task, node: TaskNode, component: C, title: string, data: Extract<UiSurface, { component: C }>["data"], artifactId?: string, editableFields: string[] = []): Artifact {
    const surface = { id: randomUUID(), component, title, data, editableFields, artifactId } as unknown as Extract<UiSurface, { component: C }>;
    const verified = verifyUiSurface(surface);
    if (!verified.passed) throw new Error(verified.errors.join("; "));
    return this.store.putArtifact({ conversationId: task.conversationId, taskId: task.id, nodeId: node.id, kind: "ui_surface", title, status: "draft", data: surface, sourceRefs: [], createdBy: "research-lead" });
  }

  private assertEvidenceIngestionAllowed(task: Task): void {
    if (["completed", "cancelled"].includes(task.status)) throw new EvidenceIngestionConflictError("A published or cancelled task cannot be mutated by a connector; create an update branch instead");
    if (task.status === "running") throw new EvidenceIngestionConflictError("A connector cannot mutate evidence while the task is running; retry when it reaches a checkpoint");
  }

  private queueEvidenceRecompute(task: Task, startKind: "evidence_capture" | "evidence_evaluation", artifactId: string): void {
    const start = this.store.listTaskNodes(task.id).find((node) => node.kind === startKind);
    if (!start) return;
    const affected = [start, ...this.descendantNodes(task.id, start.id)];
    if (!affected.some((node) => ["completed", "failed", "blocked", "cancelled"].includes(node.status))) return;
    for (const node of affected) {
      this.store.supersedePendingApprovals(node.id, `新连接器材料 ${artifactId} 要求重新计算证据及下游制品`);
      this.store.updateNode(node.id, { status: "pending", inputArtifactIds: [], outputArtifactIds: [] });
    }
    this.store.updateTaskStatus(task.id, "queued");
    const jobId = this.store.enqueueTask(task.id, "resume");
    this.store.appendEvent({
      conversationId: task.conversationId, taskId: task.id, nodeId: start.id, type: "connector.evidence_recompute_queued",
      actorType: "system", actorId: "connector-ingestion", payload: { artifactId, startKind, affectedNodeIds: affected.map((node) => node.id), jobId },
    });
  }

  private publicPlan(plan: ResearchPlan, nodes: TaskNode[], reportSpec?: Task["reportSpec"], methodPlan?: ResearchMethodPlan): ResearchPlanSurfaceData {
    return { intent: plan.intent, rationale: plan.rationale, nodes: nodes.map((node) => ({ id: node.id, title: node.title, kind: node.kind, capability: `${node.capabilityType}:${node.capabilityId}`, dependsOn: node.dependsOn })), parallelGroups: plan.parallelGroups, stopConditions: plan.stopConditions, principle: "确定性负责边界，Agent 负责路径", reportSpec, methodPlan };
  }

  private planSurface(plan: ResearchPlan, nodes: TaskNode[], reportSpec?: Task["reportSpec"], methodPlan?: ResearchMethodPlan): UiSurface {
    const surface: Extract<UiSurface, { component: "research_plan" }> = { id: randomUUID(), component: "research_plan", title: "研究计划", editableFields: [], data: this.publicPlan(plan, nodes, reportSpec, methodPlan) };
    const verified = verifyUiSurface(surface);
    if (!verified.passed) throw new Error(verified.errors.join("; "));
    return surface;
  }

  private requireTask(id: string): Task {
    const task = this.store.getTask(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    return task;
  }

  private descendantNodes(taskId: string, nodeId: string): TaskNode[] {
    const nodes = this.store.listTaskNodes(taskId);
    const descendants = new Set<string>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of nodes) {
        if (descendants.has(node.id)) continue;
        if (node.dependsOn.some((dependency) => dependency === nodeId || descendants.has(dependency))) {
          descendants.add(node.id);
          changed = true;
        }
      }
    }
    return nodes.filter((node) => descendants.has(node.id));
  }

  private verifyArtifactRevision(kind: Artifact["kind"], data: Record<string, unknown>, sourceRefs: Artifact["sourceRefs"]): void {
    const requireText = (value: unknown, field: string) => {
      if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be non-empty text`);
    };
    const requireTextList = (value: unknown, field: string) => {
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) throw new Error(`${field} must be a list of non-empty text`);
    };
    if (kind === "judgment") {
      requireText(data.statement, "statement");
      requireTextList(data.changeConditions, "changeConditions");
      if (data.confidence !== undefined && !["low", "medium", "high", "insufficient"].includes(String(data.confidence))) throw new Error("confidence is invalid");
      const signalInputs = Array.isArray(data.signalInputs) ? data.signalInputs as Array<{ evidenceFactRef?: unknown }> : [];
      const signalRoles = data.signalRoles && typeof data.signalRoles === "object" && !Array.isArray(data.signalRoles) ? data.signalRoles as Record<string, unknown> : {};
      const inputRefs = signalInputs.map((item) => String(item.evidenceFactRef || "")).filter(Boolean);
      if (inputRefs.length) {
        if (Object.keys(signalRoles).some((ref) => !inputRefs.includes(ref)) || inputRefs.some((ref) => !(ref in signalRoles))) throw new Error("signalRoles must classify every signal input and no other object");
        if (Object.values(signalRoles).some((role) => !["support", "weaken", "block", "context"].includes(String(role)))) throw new Error("signalRoles contains an invalid role");
        if (data.disposition === "review_required" && !Object.values(signalRoles).includes("support")) throw new Error("A reviewable Judgment requires at least one support signal");
        if (data.disposition === "review_required" && Object.values(signalRoles).includes("block")) throw new Error("A supported Judgment cannot be saved while a block signal is present");
      }
    } else if (kind === "report") {
      requireText(data.summary, "summary");
      if (data.boundary !== undefined && typeof data.boundary !== "string") throw new Error("boundary must be text");
      const reportCheck = verifyReportClaims(data, sourceRefs);
      if (!reportCheck.passed) throw new Error(reportCheck.errors.join("; "));
    } else {
      throw new Error(`Artifact kind is not editable: ${kind}`);
    }
  }
}

export function requestFingerprint(provider: string, model: string, input: unknown): string {
  return createHash("sha256").update(JSON.stringify({ provider, model, input })).digest("hex");
}

function inferTimeHorizon(goal: string): string {
  const normalized = goal.replace(/\s+/g, "");
  const match = normalized.match(/(?:未来|后续)?(?:[一二三四五六七八九十百]+|\d+)(?:至|[-—])?(?:[一二三四五六七八九十百]+|\d+)?(?:个月|季度|年)|(?:本|下)(?:季度|年度)/);
  return match?.[0] || "由当前 Task 目标定义";
}

function refreshJudgmentReasoningRule(data: Record<string, unknown>): Record<string, unknown> {
  const roles = data.signalRoles && typeof data.signalRoles === "object" && !Array.isArray(data.signalRoles)
    ? data.signalRoles as Record<string, unknown>
    : {};
  const prior = data.reasoningRule && typeof data.reasoningRule === "object"
    ? data.reasoningRule as NonNullable<JudgmentSurfaceData["reasoningRule"]>
    : undefined;
  if (!prior) return data;
  return {
    ...data,
    reasoningRule: {
      ...prior,
      conditions: prior.conditions.map((condition) => {
        if (condition.id === "support_signal_present") return { ...condition, passed: Object.values(roles).includes("support") };
        if (condition.id === "no_block_signal") return { ...condition, passed: !Object.values(roles).includes("block") };
        return condition;
      }),
    },
  };
}
