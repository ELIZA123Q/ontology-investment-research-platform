import { createHash, randomUUID } from "node:crypto";
import type { ActionPreviewRequest, ApprovalRequest, Artifact, AssetRef, FinancialModelData, JudgmentSurfaceData, MemoryRecord, NormalizedFinancialsData, ReportSpecInput, ReportSurfaceData, ResearchMethodPlan, ResearchPlanSurfaceData, ResearchProblemGraph, SourceCandidate, Task, TaskNode, ThesisStateData, UiSurface, ValuationAnalysisData } from "@/src/contracts";
import { verifyArtifactWrite, verifyModelDraftSections, verifyReportClaims, verifyUiSurface } from "@/src/governance/verifiers";
import { classifyIntent, materializeNodes, planFromProblemGraph, planResearch, type ResearchPlan } from "@/src/runtime/planner";
import { buildResearchProblemGraph } from "@/src/runtime/problem-graph";
import { assertArtifactEditAllowed, editableArtifactFields, minimumIndependentPublishers } from "@/src/governance/policy-engine";
import { compilePlannerProposal, type CompiledResearchPlan, type PlannerProposal } from "@/src/runtime/plan-compiler";
import { getResearchNodeType } from "@/src/runtime/node-catalog";
import { RuntimeStore } from "@/src/runtime/store";
import { LocalSemanticGateway } from "@/src/semantic/local-gateway";
import { ResearchProvenanceStore } from "@/src/semantic/provenance-store";
import { LocalSourceGateway } from "@/src/tools/local-source-gateway";
import { OntologyActionService } from "@/src/ontology/action-service";
import { OntologyFunctionService } from "@/src/ontology/functions";
import { OntologyQueryService } from "@/src/ontology/query-service";
import { reportSpecForGoal } from "@/src/reporting/report-spec";
import { composeProfessionalReport } from "@/src/reporting/report-composer";
import { assessResearchMethods, deriveEvidenceRoles, selectResearchMethods } from "@/src/research/method-router";
import { adaptFinancialDataResult, type FinancialDataToolResult } from "@/src/tools/financial-data-adapter";
import type { ModelProvider } from "@/src/providers/model-provider";
import { requestReportSectionDrafts, type ReportDraftingAttempt } from "@/src/reporting/report-model-drafter";
import { evaluateReportQuality } from "@/src/evaluation/report-quality-evaluator";
import { adaptSourceToolResult, type UnifiedSourceToolResult } from "@/src/tools/source-result-adapter";
import { consensusComparisonStatus, validateFinancialModel, validateNormalizedFinancials, validateValuationAnalysis } from "@/src/research/financial-model-contract";
import { requestBoundedResearchReasoning, type ModelReasoningAttempt } from "@/src/research/model-reasoning";
import { buildDeterministicFinancialModel } from "@/src/research/deterministic-financial-model";
import { assertAgentExecutionAllowed, assertSkillExecutionAllowed, getAgent, isSkillExecutionAllowed, isToolExecutionAllowed, runtimeExecutionScope } from "@/src/capabilities/registry";
import { evaluateJudgmentThreshold, type EvidenceGrade } from "@/src/governance/judgment-threshold";
import { assertApprovalDecisionPermission } from "@/src/governance/permission-policy";

const DEFAULT_BUDGET = { maxModelCalls: 12, maxToolCalls: 30, maxCostUsd: 3 };
const includesAny = (value: string, words: string[]) => words.some((word) => value.includes(word));
const applyProposalPrior = (graphPlan: ResearchPlan, proposalPlan: ResearchPlan): ResearchPlan => {
  const proposalByKind = new Map(proposalPlan.nodes.map((node) => [node.kind, node]));
  return {
    ...graphPlan,
    rationale: `${graphPlan.rationale} 模型提案经确定性编译后仅作为节点预算与停止条件先验：${proposalPlan.rationale}`,
    nodes: graphPlan.nodes.map((node) => ({ ...node, budget: proposalByKind.get(node.kind)?.budget || node.budget })),
    stopConditions: [...new Set([...graphPlan.stopConditions, ...proposalPlan.stopConditions])],
  };
};

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
  context: {
    asOf?: string;
    assembledAt?: string;
    trimmedReason?: string;
    knowledge: Array<Pick<AssetRef, "assetId" | "kind" | "identityKey" | "version" | "authorityRef">>;
    references: Array<{ id: string; kind: "message" | "artifact" | "memory" | "semantic" | "source"; reason: string; freshnessAt?: string }>;
    memory: MemoryRecord[];
  } | null;
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
  readonly ontologyQuery: OntologyQueryService;
  readonly functions: OntologyFunctionService;

  constructor(readonly store: RuntimeStore) {
    this.semantic = new LocalSemanticGateway(store.db);
    this.provenance = new ResearchProvenanceStore(store.db);
    this.sources = new LocalSourceGateway(this.semantic, this.provenance);
    this.actions = new OntologyActionService(store);
    this.ontologyQuery = new OntologyQueryService(this.actions.ontology);
    this.functions = new OntologyFunctionService(this.actions.ontology, this.ontologyQuery);
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
        metric: {
          id: observation.metricId, name: observation.metricName, value: observation.value, unit: observation.unit,
          currency: observation.currency, basis: observation.basis, dimensions: observation.dimensions,
          businessTime: observation.businessTime, periodStart: observation.periodStart, periodEnd: observation.periodEnd,
        },
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

  async prepareModelReasoningNode(taskId: string, nodeId: string, provider: ModelProvider | null): Promise<Artifact | null> {
    const task = this.requireTask(taskId);
    const node = this.store.getTaskNode(nodeId);
    if (!node || node.taskId !== task.id || !["hypothesis", "judgment", "independent_review"].includes(node.kind) || Number(node.budget.maxModelCalls || 0) < 1) return null;
    const artifacts = this.store.listArtifacts(task.id);
    const existing = [...artifacts].reverse().find((artifact) => artifact.kind === "review" && artifact.title === "受约束模型研究推理" && artifact.nodeId === node.id && artifact.status !== "superseded");
    if (existing) return existing;
    const facts = artifacts.filter((artifact) => artifact.kind === "evidence_package" && artifact.title === "证据评估")
      .flatMap((artifact) => (artifact.data as { facts?: import("@/src/contracts").EvidenceFact[] }).facts || [])
      .filter((fact) => fact.status === "verified");
    const authorizedArtifacts = artifacts.filter((artifact) => ["method_application", "evidence_package", "hypothesis_map", "financial_model", "valuation_analysis", "thesis_state", "report"].includes(artifact.kind));
    const attempt = await requestBoundedResearchReasoning(this.store, provider, { task, node, facts, artifacts: authorizedArtifacts });
    if (!attempt.attempted) return null;
    const sourceRefs = [...new Map(authorizedArtifacts.flatMap((artifact) => artifact.sourceRefs).map((source) => [source.sourceId, source])).values()];
    const artifact = this.store.putArtifact({ conversationId: task.conversationId, taskId: task.id, nodeId: node.id, kind: "review", title: "受约束模型研究推理", status: attempt.data ? "verified" : "draft", data: attempt, sourceRefs, createdBy: attempt.provider || provider?.id || "model-reasoning" });
    this.store.appendEvent({ conversationId: task.conversationId, taskId: task.id, nodeId: node.id, type: attempt.data ? "reasoning.model_candidate_verified" : "reasoning.model_candidate_rejected", actorType: "system", actorId: "bounded-model-reasoning", payload: { artifactId: artifact.id, targetKind: node.kind, provider: attempt.provider, model: attempt.model, cached: attempt.cached, fingerprint: attempt.fingerprint, errors: attempt.errors, usage: attempt.usage } });
    return artifact;
  }

  submitGoal(conversationId: string, content: string, proposal?: PlannerProposal, options: { pinnedAssetRefs?: AssetRef[]; reportSpec?: ReportSpecInput; lensRefs?: string[] } = {}): { task: Task; approval?: ApprovalRequest } {
    const conversation = this.store.getConversation(conversationId);
    if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);
    const accessibleRefs = this.store.listReleasedAssetRefs(conversation);
    const accessibleKeys = new Set(accessibleRefs.map((ref) => `${ref.assetId}:${ref.version}:${ref.fingerprint}`));
    const pinnedAssetRefs = options.pinnedAssetRefs || [];
    if (pinnedAssetRefs.some((ref) => !accessibleKeys.has(`${ref.assetId}:${ref.version}:${ref.fingerprint}`))) {
      throw new Error("Pinned knowledge must belong to the current accessible Release");
    }
    this.store.addMessage({ conversationId, actorType: "researcher", actorId: "researcher", content });
    const fallbackIntent = classifyIntent(content);
    const lensResult = fallbackIntent === "clarify" ? { suggestions: [] as Array<Record<string, unknown>> } : this.functions.execute("SuggestResearchLenses", { goal: content }) as { suggestions?: Array<Record<string, unknown>> };
    const suggestedLensRefs = (lensResult.suggestions || []).map((item) => String(item.id || "")).filter(Boolean);
    const lensRefs = options.lensRefs?.length ? options.lensRefs : suggestedLensRefs;
    for (const lensRef of lensRefs) this.functions.execute("AssembleResearchRequirements", { lensRefs: [lensRef] });
    const lensSuggestions = (lensResult.suggestions || []).map((item) => ({
      id: String(item.id), label: typeof item.label_zh === "string" ? item.label_zh : String(item.id), reason: String(item.reason || "研究问题与该 Lens 的研究对象和证据要求匹配"),
      requiredOutputs: Array.isArray(item.required_outputs) ? item.required_outputs.map(String) : [],
      evidenceRoles: Array.isArray(item.evidence_roles) ? item.evidence_roles.map(String) : [],
      stopConditions: Array.isArray(item.stop_conditions) ? item.stop_conditions.map(String) : [],
    }));
    const researchCaseId = this.ensureResearchCase(conversationId, content);
    const reportSpec = reportSpecForGoal(content, options.reportSpec);
    const methodPlan = selectResearchMethods(content, reportSpec);
    const task = this.store.createTask({ conversationId, researchCaseId, goal: content, intent: fallbackIntent, reportSpec, status: "planned", budget: DEFAULT_BUDGET });
    const graph = fallbackIntent === "clarify" ? undefined : this.store.createProblemGraph(buildResearchProblemGraph({ id: `problem-graph:${task.id}`, taskId: task.id, researchCaseId, goal: content, intent: fallbackIntent, reportDepth: reportSpec.depth, lensRefs }));
    const proposalCompiled = proposal ? compilePlannerProposal(proposal, content, DEFAULT_BUDGET) : undefined;
    const deterministicPlan = graph ? planFromProblemGraph(graph, DEFAULT_BUDGET) : planResearch(content);
    const compiled: CompiledResearchPlan = proposalCompiled
      ? { ...proposalCompiled, plan: graph ? applyProposalPrior(deterministicPlan, proposalCompiled.plan) : proposalCompiled.plan }
      : { plan: deterministicPlan, source: graph ? "deterministic" : "deterministic_fallback", proposalFingerprint: requestFingerprint("local", graph ? "problem-graph-compiler" : "clarify-planner", content), diagnostics: [] };
    const plan = compiled.plan;
    this.store.createKnowledgeLock(task.id);
    if (pinnedAssetRefs.length) this.store.appendEvent({ conversationId, taskId: task.id, type: "context.pinned", actorType: "researcher", actorId: "researcher", payload: { assetRefs: pinnedAssetRefs } });
    const nodes = materializeNodes(task.id, plan, task.budget);
    this.store.addTaskNodes(nodes);
    if (graph) this.store.putArtifact({ conversationId, taskId: task.id, kind: "research_problem_graph", title: "Research Problem Graph（待确认）", status: "draft", data: graph, sourceRefs: [], createdBy: "research-lead" });
    const planArtifact = this.store.putArtifact({
      conversationId, taskId: task.id, kind: "research_plan", title: "可调整研究计划", status: "draft",
      data: { ...this.publicPlan(plan, nodes, task.reportSpec, methodPlan, graph, lensSuggestions), planner: { source: compiled.source, proposalFingerprint: compiled.proposalFingerprint, diagnostics: compiled.diagnostics } }, sourceRefs: [], createdBy: "research-lead",
    });
    this.store.appendEvent({ conversationId, taskId: task.id, type: "planner.compiled", actorType: "system", actorId: "plan-compiler", payload: { source: compiled.source, proposalFingerprint: compiled.proposalFingerprint, diagnostics: compiled.diagnostics } });
    this.store.appendEvent({ conversationId, taskId: task.id, type: "plan.proposed", actorType: "agent", actorId: "research-lead", payload: { planArtifactId: planArtifact.id, intent: plan.intent, nodeCount: nodes.length, plannerSource: compiled.source } });
    this.store.checkpoint({ taskId: task.id, phase: "after", state: { milestone: "plan_determined", planArtifactId: planArtifact.id, nodeIds: nodes.map((node) => node.id) } });
    this.store.putArtifact({ conversationId, taskId: task.id, kind: "ui_surface", title: "研究计划", status: "draft", data: this.planSurface(plan, nodes, task.reportSpec, methodPlan, graph, lensSuggestions), sourceRefs: [], createdBy: "research-lead" });

    if (plan.intent === "clarify") {
      this.store.addMessage({ conversationId, actorType: "agent", actorId: "research-lead", content: "在开始研究前，我需要确认研究对象、希望支持的决策和时间范围。你可以直接补充，例如：研究对象 + 未来六个月 + 希望判断的问题。" });
      return { task: this.store.transitionTask(task.id, "request_input", { actorType: "agent", actorId: "research-lead", payload: { reason: "clarification_required" } }) };
    }
    const approval = this.store.createApproval({ conversationId, taskId: task.id, kind: "plan_confirmation", prompt: "按这份动态计划开始研究？你仍可直接修改目标或范围。" });
    const waitingTask = this.store.transitionTask(task.id, "request_approval", { payload: { approvalId: approval.id, kind: approval.kind } });
    return { task: waitingTask, approval };
  }

  decideApproval(id: string, decision: "approved" | "rejected", note?: string): ApprovalRequest {
    const pending = this.store.getApproval(id);
    if (!pending) throw new Error(`Approval not found: ${id}`);
    if (pending.status !== "pending") throw new Error(`Approval is no longer pending: ${id}`);
    assertApprovalDecisionPermission(pending.kind, "researcher");
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
      if (pending.kind === "plan_confirmation") this.materializeConfirmedProblemGraph(approval);
      if (judgmentRequest) this.commitApprovedJudgment(approval, judgmentRequest);
      if (publicationRequest) this.commitApprovedPublication(approval, publicationRequest);
      this.store.transitionTask(approval.taskId, pending.kind === "plan_confirmation" ? "confirm_plan" : "approve", { actorType: "researcher", actorId: "researcher", payload: { approvalId: approval.id, kind: pending.kind } });
      this.store.enqueueTask(approval.taskId, "execute");
    } else {
      this.store.transitionTask(approval.taskId, "reject", { actorType: "researcher", actorId: "researcher", payload: { approvalId: approval.id, kind: pending.kind } });
    }
    return approval;
  }

  executeTask(taskId: string): Task {
    let task = this.requireTask(taskId);
    if (["cancelled", "completed", "paused", "waiting_handoff", "waiting_approval", "waiting_input"].includes(task.status)) return task;
    if (task.status === "queued") task = this.store.transitionTask(taskId, "runtime_start", { actorType: "agent", actorId: "research-lead", payload: { recoveryCheckpoint: this.store.latestCheckpoint(taskId)?.id } });

    let progressed = true;
    while (progressed) {
      progressed = false;
      const nodes = this.store.listTaskNodes(taskId);
      for (const node of nodes) {
        if (!["ready", "pending", "failed"].includes(node.status)) continue;
        const deps = node.dependsOn.map((id) => this.store.getTaskNode(id));
        if (deps.some((dep) => dep?.status === "failed" || dep?.status === "blocked")) {
          this.store.transitionNode(node.id, "dependency_block", {}, { payload: { dependencyIds: node.dependsOn } });
          continue;
        }
        if (!deps.every((dep) => dep?.status === "completed")) continue;
        progressed = true;
        this.executeNode(task, node);
        if (this.requireTask(taskId).status === "waiting_approval") return this.requireTask(taskId);
      }
    }

    const finalNodes = this.store.listTaskNodes(taskId);
    if (finalNodes.some((node) => node.status === "failed")) this.store.transitionTask(taskId, "runtime_fail");
    else if (finalNodes.some((node) => node.status === "blocked")) this.store.transitionTask(taskId, "request_input", { payload: { reason: "blocked_frontier" } });
    else if (finalNodes.every((node) => node.status === "completed" || node.status === "cancelled")) this.store.transitionTask(taskId, "runtime_complete");
    const updated = this.requireTask(taskId);
    this.store.appendEvent({ conversationId: task.conversationId, taskId, type: "task.settled", actorType: "system", actorId: "runtime", payload: { status: updated.status, outcome: updated.outcome } });
    if (["completed", "failed", "cancelled"].includes(updated.status) && !this.store.getMiningRunByTask(taskId)) this.queueMining(taskId);
    return updated;
  }

  /** Phase 2 scheduler entrypoint.  It only queues dependency-ready frontier nodes;
   * workers may claim up to three nodes from the same task. */
  dispatchTask(taskId: string): number {
    let task = this.requireTask(taskId);
    if (["cancelled", "completed", "paused", "waiting_handoff", "waiting_approval", "waiting_input"].includes(task.status)) return 0;
    if (task.status === "queued") task = this.store.transitionTask(taskId, "runtime_start", { actorType: "agent", actorId: "research-lead", payload: { recoveryCheckpoint: this.store.latestCheckpoint(taskId)?.id } });
    let queued = 0;
    for (const node of this.store.listTaskNodes(taskId)) {
      if (!["ready", "pending", "failed"].includes(node.status)) continue;
      const dependencies = node.dependsOn.map((id) => this.store.getTaskNode(id));
      if (dependencies.some((item) => item?.status === "failed" || item?.status === "blocked")) { this.store.transitionNode(node.id, "dependency_block", {}, { payload: { dependencyIds: node.dependsOn } }); continue; }
      if (!dependencies.every((item) => item?.status === "completed")) continue;
      if (node.status === "pending") this.store.transitionNode(node.id, "dependencies_ready");
      else if (node.status === "failed") this.store.transitionNode(node.id, "retry");
      this.store.enqueueNode(taskId, node.id); queued++;
    }
    return queued;
  }

  executeTaskNode(taskId: string, nodeId: string): void {
    const task = this.requireTask(taskId);
    if (["paused", "waiting_handoff", "waiting_approval", "waiting_input", "cancelled", "completed"].includes(task.status)) return;
    const node = this.store.getTaskNode(nodeId);
    if (!node || node.taskId !== taskId || !["ready", "pending", "failed"].includes(node.status)) return;
    if (!node.dependsOn.every((id) => this.store.getTaskNode(id)?.status === "completed")) return;
    this.executeNode(task, node);
    if (this.requireTask(taskId).status === "running") this.dispatchTask(taskId);
    const nodes = this.store.listTaskNodes(taskId);
    if (nodes.every((item) => item.status === "completed" || item.status === "cancelled")) this.store.transitionTask(taskId, "runtime_complete");
  }

  cancelTask(taskId: string): Task {
    const task = this.requireTask(taskId);
    this.store.transitionTask(taskId, "cancel", { actorType: "researcher", actorId: "researcher" });
    for (const node of this.store.listTaskNodes(taskId)) if (["pending", "ready", "running", "blocked", "failed"].includes(node.status)) this.store.transitionNode(node.id, "cancel", {}, { actorType: "researcher", actorId: "researcher" });
    if (!this.store.getMiningRunByTask(taskId)) this.queueMining(taskId);
    return this.requireTask(taskId);
  }

  pauseTask(taskId: string): Task {
    const task = this.requireTask(taskId);
    if (["cancelled", "completed", "failed"].includes(task.status)) throw new Error(`Task ${task.status} cannot be paused`);
    this.store.transitionTask(taskId, "pause", { actorType: "researcher", actorId: "researcher", payload: { checkpointId: this.store.latestCheckpoint(taskId)?.id } });
    return this.requireTask(taskId);
  }

  resumeTask(taskId: string): string {
    const task = this.requireTask(taskId);
    if (task.status === "cancelled") throw new Error("Cancelled task cannot be resumed; branch it instead.");
    for (const node of this.store.listTaskNodes(taskId)) if (node.status === "failed") this.store.transitionNode(node.id, "retry");
    this.store.transitionTask(taskId, "retry", { actorType: "researcher", actorId: "researcher", payload: { checkpointId: this.store.latestCheckpoint(taskId)?.id } });
    const jobId = this.store.enqueueTask(taskId, "resume");
    return jobId;
  }

  branchTask(taskId: string, revisedGoal?: string): Task {
    const parent = this.requireTask(taskId);
    const goal = revisedGoal?.trim() || parent.goal;
    const intent = classifyIntent(goal);
    // A legacy 3.0 task may have no persisted ResearchCase. Branching is a new
    // 4.0 run, so create the aggregate root lazily instead of writing back to the
    // legacy task or attempting dual-write migration.
    const researchCaseId = this.ensureResearchCase(parent.conversationId, goal, parent.researchCaseId);
    const branch = this.store.createTask({ conversationId: parent.conversationId, researchCaseId, parentTaskId: parent.id, goal, intent, reportSpec: parent.reportSpec, status: "planned", budget: parent.budget });
    const graph = intent === "clarify" ? undefined : this.store.createProblemGraph(buildResearchProblemGraph({ id: `problem-graph:${branch.id}`, taskId: branch.id, researchCaseId, goal, intent, reportDepth: branch.reportSpec.depth }));
    const plan = graph ? planFromProblemGraph(graph, branch.budget) : planResearch(goal);
    this.store.createKnowledgeLock(branch.id);
    const nodes = materializeNodes(branch.id, plan, branch.budget);
    this.store.addTaskNodes(nodes);
    const methodPlan = selectResearchMethods(goal, branch.reportSpec);
    if (graph) this.store.putArtifact({ conversationId: branch.conversationId, taskId: branch.id, kind: "research_problem_graph", title: "Research Problem Graph（待确认）", status: "draft", data: graph, sourceRefs: [], createdBy: "research-lead" });
    this.store.putArtifact({ conversationId: branch.conversationId, taskId: branch.id, kind: "research_plan", title: "分支研究计划", status: "draft", data: this.publicPlan(plan, nodes, branch.reportSpec, methodPlan, graph), sourceRefs: [], createdBy: "research-lead" });
    this.store.appendEvent({ conversationId: branch.conversationId, taskId: branch.id, type: "task.branched", actorType: "researcher", actorId: "researcher", payload: { parentTaskId: parent.id, revisedGoal: goal } });
    this.store.checkpoint({ taskId: branch.id, phase: "after", state: { milestone: "plan_determined", parentTaskId: parent.id } });
    const approval = this.store.createApproval({ conversationId: branch.conversationId, taskId: branch.id, kind: "plan_confirmation", prompt: "确认开始这个研究分支？" });
    return this.store.transitionTask(branch.id, "request_approval", { payload: { approvalId: approval.id, kind: approval.kind } });
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
    const evidenceSufficient = current.kind !== "judgment"
      || !["abstain", "insufficient"].includes(String((current.data as Record<string, unknown>).disposition || (current.data as Record<string, unknown>).confidence));
    assertArtifactEditAllowed(current.kind, fields, evidenceSufficient);
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
    for (const node of descendants) {
      if (["ready", "blocked", "completed", "failed"].includes(node.status)) this.store.transitionNode(node.id, "invalidate", { inputArtifactIds: [], outputArtifactIds: [] }, { actorId: "artifact-service", payload: { artifactId, artifactVersion: expectedVersion + 1 } });
    }
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
      const task = this.requireTask(current.taskId);
      if (task.status !== "waiting_approval") this.store.transitionTask(current.taskId, "request_approval", { payload: { approvalId: approval.id, kind: approval.kind, artifactId, artifactVersion: revised.version } });
    } else if (descendants.length) {
      const task = this.requireTask(current.taskId);
      if (task.status !== "queued") this.store.transitionTask(current.taskId, "invalidate", { actorId: "artifact-service", payload: { artifactId, artifactVersion: revised.version } });
      this.store.enqueueTask(current.taskId, "resume");
      this.store.appendEvent({ conversationId: current.conversationId, taskId: current.taskId, nodeId: current.nodeId, type: "artifact.recompute_queued", actorType: "system", actorId: "runtime", payload: { artifactId, artifactVersion: revised.version, nodeIds: descendants.map((node) => node.id) } });
    }
    return { artifact: revised, surfaceArtifact: revisedSurface, invalidatedNodeIds: descendants.map((node) => node.id), approval };
  }

  snapshot(conversationId: string, requestedTaskId?: string): ConversationSnapshot {
    const tasks = this.store.listTasks(conversationId);
    const task = (requestedTaskId ? tasks.find((item) => item.id === requestedTaskId) : undefined) || tasks[0] || null;
    const knowledgeLock = task ? this.store.getKnowledgeLock(task.id) : null;
    const contextPackage = task ? this.store.getContextPackage(task.id) : null;
    return {
      conversation: this.store.getConversation(conversationId), messages: this.store.listMessages(conversationId), task,
      activeTaskId: task?.id || null, tasks,
      nodes: task ? this.store.listTaskNodes(task.id) : [], artifacts: task ? this.store.listArtifacts(task.id) : [],
      approvals: this.store.listPendingApprovals(conversationId), events: this.store.listEvents(conversationId),
      context: task ? {
        asOf: contextPackage?.asOf || knowledgeLock?.asOf,
        assembledAt: contextPackage?.assembledAt,
        trimmedReason: contextPackage?.trimmedReason,
        knowledge: (knowledgeLock?.assetRefs || []).map(({ assetId, kind, identityKey, version, authorityRef }) => ({ assetId, kind, identityKey, version, authorityRef })),
        references: (contextPackage?.references || []).map(({ id, kind, reason, freshnessAt }) => ({ id, kind, reason, freshnessAt })),
        memory: this.store.listMemory(conversationId),
      } : null,
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
    const executionScope = runtimeExecutionScope();
    const executingAgent = assertAgentExecutionAllowed(node.assignedAgent, executionScope);
    if (nodeType.capabilityType === "skill") {
      try {
        assertSkillExecutionAllowed(nodeType.capabilityId, executionScope);
        if (!executingAgent.allowedSkills.includes(nodeType.capabilityId)) throw new Error(`Agent ${executingAgent.id} is not allowed to execute Skill ${nodeType.capabilityId}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.store.transitionNode(node.id, "policy_block", {}, { actorId: "capability-release-gate", payload: { capabilityId: node.capabilityId, error: message } });
        this.store.appendEvent({ conversationId: task.conversationId, taskId: task.id, nodeId: node.id, type: "capability.release_blocked", actorType: "system", actorId: "capability-release-gate", payload: { capabilityId: node.capabilityId, executionScope: runtimeExecutionScope(), error: message } });
        return;
      }
    }
    if (nodeType.outputKind !== "runtime_context") {
      const capabilityCheck = verifyArtifactWrite(node.assignedAgent, nodeType.outputKind);
      if (!capabilityCheck.passed) throw new Error(capabilityCheck.errors.join("; "));
    }
    let currentNode = this.store.getTaskNode(node.id)!;
    if (currentNode.status === "pending") currentNode = this.store.transitionNode(node.id, "dependencies_ready");
    else if (currentNode.status === "failed") currentNode = this.store.transitionNode(node.id, "retry");
    this.store.transitionNode(currentNode.id, "runtime_start", {}, { actorType: "agent", actorId: "research-lead", payload: { capabilityId: node.capabilityId } });
    const started = Date.now();
    this.store.appendEvent({ conversationId: task.conversationId, taskId: task.id, nodeId: node.id, type: `${node.capabilityType}.started`, actorType: "agent", actorId: "research-lead", payload: { capabilityId: node.capabilityId, inputArtifactIds: node.inputArtifactIds } });
    try {
      const artifact = this.executeNodeLocally(task, node);
      this.store.transitionNode(node.id, "runtime_complete", { outputArtifactIds: artifact ? [artifact.id] : [] }, { actorType: "agent", actorId: "research-lead", payload: { capabilityId: node.capabilityId, artifactId: artifact?.id } });
      this.store.appendEvent({ conversationId: task.conversationId, taskId: task.id, nodeId: node.id, type: `${node.capabilityType}.completed`, actorType: "agent", actorId: "research-lead", payload: { capabilityId: node.capabilityId, artifactId: artifact?.id, latencyMs: Date.now() - started } });
      if (nodeType.checkpointAfter) this.store.checkpoint({ taskId: task.id, nodeId: node.id, phase: "after", state: { milestone: node.kind, artifactId: artifact?.id } });
      if (artifact) this.requestMilestoneApproval(task, node, artifact);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.transitionNode(node.id, "runtime_fail", {}, { payload: { capabilityId: node.capabilityId, error: message } });
      this.store.appendEvent({ conversationId: task.conversationId, taskId: task.id, nodeId: node.id, type: `${node.capabilityType}.failed`, actorType: "system", actorId: "runtime", payload: { capabilityId: node.capabilityId, error: message } });
      throw error;
    }
  }

  private executeNodeLocally(task: Task, node: TaskNode): Artifact | null {
    const artifacts = this.store.listArtifacts(task.id);
    const inputArtifacts = artifacts.filter((artifact) => artifact.nodeId && node.dependsOn.includes(artifact.nodeId));
    const problemGraph = this.store.getProblemGraph(task.id);
    const frontierNode = node.frontierRef.problemNodeId ? problemGraph?.nodes.find((item) => item.id === node.frontierRef.problemNodeId) : undefined;
    const base = { conversationId: task.conversationId, taskId: task.id, nodeId: node.id, status: "draft" as const, sourceRefs: [], createdBy: "research-lead" };
    switch (node.kind) {
      case "clarify":
        return this.store.putArtifact({ ...base, kind: "research_plan", title: "待澄清研究目标", data: { questions: ["研究对象是什么？", "希望支持哪项决策？", "时间范围是什么？"] } });
      case "semantic_context":
        {
          const index = this.semantic.buildIndex();
          const selected = this.semantic.searchSync({ text: task.goal, strategies: ["fts", "structured"], limit: 12 });
          const baselineState = this.ontologyQuery.queryObjects({
            typeOrInterface: "StateVariable", limit: 24,
            accessContext: { actorId: "runtime", actorType: "system", accessScopes: ["*"] },
          });
          const goalTerms = task.goal.toLowerCase().split(/[\s，。；、]/).filter((term) => term.length > 1);
          const matchedBaseline = baselineState.filter((item) => {
            const text = JSON.stringify(item.properties).toLowerCase();
            return !goalTerms.length || goalTerms.some((term) => text.includes(term));
          }).slice(0, 12);
          const lock = this.store.getKnowledgeLock(task.id) || this.store.createKnowledgeLock(task.id);
          const pinnedEvent = [...this.store.listEvents(task.conversationId, 0, 10_000)].reverse().find((event) => event.taskId === task.id && event.type === "context.pinned");
          const pinnedRefs = ((pinnedEvent?.payload as { assetRefs?: AssetRef[] } | undefined)?.assetRefs || []);
          const pinnedKeys = new Set(pinnedRefs.map((ref) => `${ref.assetId}:${ref.version}:${ref.fingerprint}`));
          const references = [
            ...lock.assetRefs.map((ref) => ({ id: ref.assetId, kind: "semantic" as const, version: ref.version, reason: pinnedKeys.has(`${ref.assetId}:${ref.version}:${ref.fingerprint}`) ? "pinned by researcher from released knowledge" : "selected from released knowledge baseline", freshnessAt: lock.asOf, assetRef: ref })),
            ...selected.map((ref) => ({ id: ref.refId, kind: "semantic" as const, version: ref.version, reason: `${ref.reason}；${ref.path}`, freshnessAt: new Date().toISOString() })),
            ...matchedBaseline.map((item) => ({ id: item.id, kind: "semantic" as const, version: item.version, reason: "Ontology ObjectSet：已加载领域基线 StateVariable", freshnessAt: lock.asOf })),
          ];
          const memoryRecords = this.store.listMemory(task.conversationId);
          const pendingApprovals = this.store.listPendingApprovals(task.conversationId).filter((approval) => approval.taskId === task.id);
          const latestEvent = this.store.listEvents(task.conversationId).filter((event) => event.taskId === task.id).at(-1);
          const latestCheckpoint = this.store.getLatestCheckpoint(task.id);
          const permissionFilterResult = { decision: "allowed" as const, excludedRefIds: [] as string[], reasons: ["Context 仅包含当前 KnowledgeLock、当前任务制品和允许的 Memory 引用"] };
          const agent = getAgent(node.assignedAgent);
          for (const ref of lock.assetRefs) this.store.observeAssetUsage({ taskId: task.id, assetRef: ref, selectedReason: "context_builder", outcome: "used" });
          this.store.putContextPackage({
            taskId: task.id, nodeId: node.id, knowledgeLockId: lock.id, asOf: lock.asOf,
            releaseIds: { global: lock.globalReleaseId, tenant: lock.tenantReleaseId, user: lock.userReleaseId },
            identity: { conversationId: task.conversationId, taskId: task.id, runId: `task-run:${task.id}`, nodeId: node.id },
            task: { goal: task.goal, intent: task.intent, budget: task.budget, frontierRef: node.frontierRef },
            state: { taskStatus: task.status, nodeStatus: node.status, pendingAction: pendingApprovals[0]?.kind, pendingApprovalIds: pendingApprovals.map((approval) => approval.id), lastEventId: latestEvent?.id, checkpointRef: latestCheckpoint?.id },
            workspace: this.store.getWorkspaceProjection(task.id),
            memory: { refs: memoryRecords.map((memory) => ({ id: memory.id, kind: memory.kind, sourceRef: memory.sourceRef, freshnessAt: memory.freshnessAt })) },
            knowledge: { assetRefs: lock.assetRefs, releaseIds: { global: lock.globalReleaseId, tenant: lock.tenantReleaseId, user: lock.userReleaseId } },
            capabilities: { agentId: node.assignedAgent, assumedRoleIds: agent.canAssumeRoles, capabilityType: node.capabilityType, capabilityId: node.capabilityId, allowedSkillIds: agent.allowedSkills.filter((skillId) => isSkillExecutionAllowed(skillId, runtimeExecutionScope())), allowedToolIds: agent.allowedTools.filter((toolId) => isToolExecutionAllowed(toolId, runtimeExecutionScope())) },
            policies: { policyRefs: ["05_control_evaluation/01_rules/policies/judgment_threshold_policy.yaml", "05_control_evaluation/03_permissions/permission_matrix.yaml"], permissionFilterResult },
            references, tokenBudget: 8_000, trimmedReason: selected.length >= 12 ? "semantic selection limited to the top 12 authorized references" : undefined, permissionFilterResult,
          });
          this.store.appendEvent({ conversationId: task.conversationId, taskId: task.id, nodeId: node.id, type: "semantic.indexed", actorType: "system", actorId: "semantic-gateway", payload: { ...index, ontologyBaseline: { releases: this.ontologyQuery.releases(), matchedStateVariableRefs: matchedBaseline.map((item) => item.id) } } });
        }
        return null;
      case "method_selection":
        return this.store.putArtifact({ ...base, kind: "method_application", title: "章节方法蓝图", data: selectResearchMethods(task.goal, task.reportSpec) });
      case "impact_analysis":
        {
          const parent = task.parentTaskId ? this.store.getProblemGraph(task.parentTaskId) : undefined;
          const text = task.goal.toLowerCase();
          const affected = (parent?.nodes.filter((item) => item.type === "judgment_unit") || []).filter((unit) => {
            const type = String(unit.payload.judgmentType || "");
            if (includesAny(text, ["技术", "成熟度", "良率"])) return type.includes("maturity");
            if (includesAny(text, ["经营", "利润", "业绩", "公告"])) return type.includes("transmission") || type.includes("impact");
            return true;
          });
          for (const unit of affected) this.store.updateProblemGraphNode(unit.id, { state: "invalidated" });
          const invalidatedArtifactIds = affected.flatMap((unit) => unit.resolvedArtifactIds);
          return this.store.putArtifact({ ...base, kind: "research_plan", title: "影响范围", data: { reusedArtifactIds: [], invalidatedArtifactIds, affectedJudgmentUnitRefs: affected.map((item) => item.semanticRef || item.id), reason: affected.length ? "沿 ResearchProblemGraph 的判断单元范围传播失效；只重编译受影响子图。" : "没有识别到需要失效的历史判断单元。" } });
        }
      case "evidence_discovery": {
        const result = this.store.runToolOnce({ key: `${task.id}:${node.id}:source.discover:v2`, toolId: "source.discover", taskId: task.id }, () => {
          const scope = typeof frontierNode?.payload.scope === "string" ? frontierNode.payload.scope : "";
          const candidates = this.sources.discover(`${task.goal} ${scope}`);
          return { candidates, activities: [{ status: candidates.length ? "completed" : "no_match", channel: "local-governed-assets", candidateCount: candidates.length }] };
        }).result;
        this.store.appendEvent({ conversationId: task.conversationId, taskId: task.id, nodeId: node.id, type: "source.discovered", actorType: "system", actorId: "source.discover", payload: { candidateCount: result.candidates.length } });
        return this.store.putArtifact({ ...base, kind: "evidence_package", title: "候选来源", data: { ...result, frontierRef: node.frontierRef } });
      }
      case "evidence_capture": {
        const discovery = [...inputArtifacts].reverse().find((artifact) => artifact.kind === "evidence_package" && artifact.title === "候选来源");
        const candidates = ((discovery?.data as { candidates?: SourceCandidate[] } | undefined)?.candidates || []).slice(0, 4);
        const externalCaptures = artifacts.filter((artifact) => artifact.kind === "evidence_package" && artifact.title === "外部来源快照" && artifact.status === "verified")
          .flatMap((artifact) => (artifact.data as { captures?: Array<{ id: string; ontologySnapshotRef?: string }> }).captures || []);
        const captureInputFingerprint = requestFingerprint("source.capture", "v3", { candidateIds: candidates.map((candidate) => candidate.id), externalSnapshotIds: externalCaptures.map((capture) => capture.id).sort() });
        const result = this.store.runToolOnce({ key: `${task.id}:source.capture:v4:${captureInputFingerprint}`, toolId: "source.capture", taskId: task.id }, () => {
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
        return this.store.putArtifact({ ...base, kind: "evidence_package", title: "来源快照", data: { ...result, frontierRef: node.frontierRef }, sourceRefs });
      }
      case "evidence_evaluation": {
        const captured = [...inputArtifacts].reverse().find((artifact) => artifact.kind === "evidence_package" && artifact.title === "来源快照");
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
        const role = node.frontierRef.evidenceRole || "context";
        const governedMinimum = minimumIndependentPublishers(role);
        const requestedMinimum = Number(frontierNode?.payload.minIndependentPublishers || governedMinimum);
        const minIndependentPublishers = Math.max(governedMinimum, requestedMinimum);
        const functionResult = this.functions.execute("AssessEvidenceUsability", { evidenceRefs: facts.map((fact) => fact.ontologyFactRef).filter(Boolean), judgmentUnitRefs: node.frontierRef.judgmentUnitRef ? [node.frontierRef.judgmentUnitRef] : [] });
        const sufficient = facts.length >= minIndependentPublishers && independentPublishers.size >= minIndependentPublishers && functionResult.sufficient === true;
        const requirementFulfilled = role === "counter" ? Boolean(captured) : sufficient;
        const evidence = this.store.putArtifact({ ...base, status: facts.length ? "verified" : "draft", kind: "evidence_package", title: "证据评估", sourceRefs, data: {
          frontierRef: node.frontierRef, evidenceRole: role, facts, qualifiedEvidenceCount: facts.length, independentPublisherCount: independentPublishers.size, sufficient, requirementFulfilled, functionResult,
          stopReason: requirementFulfilled ? undefined : `本 ${role} 证据要求尚未满足：至少需要 ${minIndependentPublishers} 个独立发布主体。`,
        } });
        if (frontierNode) this.store.updateProblemGraphNode(frontierNode.id, { state: requirementFulfilled ? "resolved" : "blocked", resolvedArtifactIds: [evidence.id] });
        for (const fact of facts) this.provenance.addEdge(fact.id, evidence.id, "included_in");
        this.store.appendEvent({ conversationId: task.conversationId, taskId: task.id, nodeId: node.id, type: "evidence.promoted", actorType: "system", actorId: "provenance-verifier", payload: { factIds: facts.map((fact) => fact.id), sufficient } });
        this.putSurface(task, node, "evidence_matrix", "证据矩阵", { rows: facts, sufficient: requirementFulfilled, gap: requirementFulfilled ? undefined : `补充 ${role} 证据要求所需的独立来源` }, evidence.id);
        return evidence;
      }
      case "financial_normalization": {
        const financialInputs = artifacts.filter((artifact) => artifact.kind === "evidence_package" && artifact.title === "结构化金融数据" && artifact.status === "verified");
        const latest = financialInputs.at(-1);
        const input = latest?.data as { asOf?: string; facts?: Array<{ metric?: { id?: string; name?: string; value?: number; basis?: string; unit?: string; currency?: string; dimensions?: Record<string, string | number | boolean | null>; businessTime?: string; periodStart?: string; periodEnd?: string } }> } | undefined;
        const asOf = input?.asOf || this.store.getKnowledgeLock(task.id)?.asOf || new Date().toISOString();
        const sourceArtifactRefs = latest ? [latest.id] : [];
        const observations = (input?.facts || []).flatMap((fact) => {
          const metric = fact.metric;
          return metric && typeof metric.id === "string" && typeof metric.value === "number" && latest
            ? [{
              metricId: metric.id, metricName: metric.name, value: metric.value,
              basis: metric.basis === "restated" ? "restated" as const : metric.basis === "consensus" ? "consensus" as const : "reported" as const,
              unit: metric.unit || "元", currency: metric.currency || "CNY", dimensions: metric.dimensions,
              businessTime: metric.businessTime || metric.periodEnd || asOf,
              period: { start: metric.periodStart || metric.periodEnd || asOf, end: metric.periodEnd || metric.businessTime || asOf },
              sourceArtifactRef: latest.id,
            }]
            : [];
        });
        const periodStarts = observations.map((item) => Date.parse(item.period.start)).filter(Number.isFinite);
        const periodEnds = observations.map((item) => Date.parse(item.period.end)).filter(Number.isFinite);
        const normalized: NormalizedFinancialsData = {
          asOf, entityRef: task.researchCaseId, accountingBasis: "PRC_GAAP", currency: "CNY", unit: "元",
          historicalBoundary: {
            start: periodStarts.length ? new Date(Math.min(...periodStarts)).toISOString() : asOf,
            end: periodEnds.length ? new Date(Math.max(...periodEnds)).toISOString() : asOf,
          }, observations, sourceArtifactRefs,
          status: observations.length ? "ready" : "insufficient",
          blockers: observations.length ? undefined : ["缺少通过金融数据摄取合同验证的历史财务观测。"],
        };
        const check = validateNormalizedFinancials(normalized);
        return this.store.putArtifact({ ...base, kind: "normalized_financials", title: "规范化财务", status: check.passed && normalized.status === "ready" ? "verified" : "draft", data: { ...normalized, validation: check }, sourceRefs: latest?.sourceRefs || [] });
      }
      case "model_build_or_update": {
        const normalizedArtifact = [...inputArtifacts].reverse().find((artifact) => artifact.kind === "normalized_financials") || [...artifacts].reverse().find((artifact) => artifact.kind === "normalized_financials");
        const normalized = normalizedArtifact?.data as NormalizedFinancialsData | undefined;
        const asOf = normalized?.asOf || this.store.getKnowledgeLock(task.id)?.asOf || new Date().toISOString();
        const model: FinancialModelData = normalized
          ? buildDeterministicFinancialModel(normalized).model
          : {
            modelScope: "historical_earnings_update", asOf, entityRef: task.researchCaseId, accountingBasis: "PRC_GAAP", currency: "CNY", unit: "元",
            historicalBoundary: { start: asOf, end: asOf },
            forecastBoundary: { start: new Date(Date.parse(asOf) + 86_400_000).toISOString(), end: new Date(Date.parse(asOf) + 366 * 86_400_000).toISOString() },
            assumptions: [], formulaDependencies: [], scenarios: [], computedOutputs: [], reconciliations: [],
            audit: { passed: false, checks: [], errors: ["normalized financials are missing"], warnings: [] },
            sourceArtifactRefs: [], status: "blocked",
        };
        const check = validateFinancialModel(model);
        if (!check.passed) {
          model.status = "blocked";
          model.audit = { ...model.audit, passed: false, errors: [...new Set([...model.audit.errors, ...check.errors])] };
        }
        return this.store.putArtifact({ ...base, kind: "financial_model", title: "结构化财务模型", status: model.status === "ready" && model.audit.passed ? "verified" : "draft", data: { ...model, validation: check }, sourceRefs: normalizedArtifact?.sourceRefs || [] });
      }
      case "model_audit": {
        const modelArtifact = [...inputArtifacts].reverse().find((artifact) => artifact.kind === "financial_model") || [...artifacts].reverse().find((artifact) => artifact.kind === "financial_model");
        const model = modelArtifact?.data as FinancialModelData | undefined;
        const check = model ? validateFinancialModel(model) : { passed: false, errors: ["missing financial_model"], warnings: [] };
        return this.store.putArtifact({ ...base, kind: "review", title: "财务模型审计", status: check.passed ? "verified" : "draft", data: { verifier: "financial-model-audit", ...check, modelArtifactRef: modelArtifact?.id }, sourceRefs: modelArtifact?.sourceRefs || [] });
      }
      case "valuation_analysis": {
        const modelArtifact = artifacts.filter((artifact) => artifact.kind === "financial_model").at(-1);
        const auditArtifact = artifacts.filter((artifact) => artifact.kind === "review" && artifact.title === "财务模型审计").at(-1);
        const audit = auditArtifact?.data as { passed?: boolean } | undefined;
        const model = modelArtifact?.data as FinancialModelData | undefined;
        const valuation: ValuationAnalysisData = {
          asOf: model?.asOf || this.store.getKnowledgeLock(task.id)?.asOf || new Date().toISOString(),
          financialModelRef: modelArtifact?.id || "", modelAuditRef: auditArtifact?.id || "", currency: model?.currency || "CNY", unit: model?.unit || "元",
          methods: [], assumptions: [], sensitivities: [], status: "blocked",
          blockers: [audit?.passed ? "缺少经验证的预测输出、估值方法、估值假设与敏感性输入；禁止生成空估值。" : "财务模型审计未通过；估值分析被阻断。"],
        };
        const valuationCheck = validateValuationAnalysis(valuation, model, audit?.passed === true);
        return this.store.putArtifact({ ...base, kind: "valuation_analysis", title: "估值分析", status: valuationCheck.passed ? "verified" : "draft", data: { ...valuation, validation: valuationCheck }, sourceRefs: modelArtifact?.sourceRefs || [] });
      }
      case "thesis_update": {
        const sourceArtifactRefs = inputArtifacts.map((artifact) => artifact.id);
        const asOf = this.store.getKnowledgeLock(task.id)?.asOf || new Date().toISOString();
        const consensusStatus = consensusComparisonStatus(undefined);
        const thesis: ThesisStateData = {
          asOf, version: artifacts.filter((artifact) => artifact.kind === "thesis_state").length + 1,
          pillars: [{ id: "primary_thesis", statement: "等待已验证证据与研究员裁决的命题状态。", status: "unresolved" }],
          signals: sourceArtifactRefs.length ? [{ direction: "context", sourceArtifactRef: sourceArtifactRefs[0], note: "本次更新已登记；尚不代表正式改判。" }] : [],
          catalysts: [], invalidationConditions: ["出现经核验、同口径的反向证据。"], openEvidenceGaps: ["一致预期比较状态：" + consensusStatus],
          sourceArtifactRefs,
        };
        return this.store.putArtifact({ ...base, kind: "thesis_state", title: "命题状态 v" + thesis.version, data: thesis, sourceRefs: inputArtifacts.flatMap((artifact) => artifact.sourceRefs) });
      }
      case "independent_review": {
        const model = artifacts.filter((artifact) => artifact.kind === "financial_model").at(-1);
        const modelCheck = model ? validateFinancialModel(model.data as FinancialModelData) : { passed: true, errors: [], warnings: ["no financial model in review scope"] };
        const reviewScope = artifacts.filter((artifact) => ["report", "financial_model", "valuation_analysis", "thesis_state", "evidence_package"].includes(artifact.kind)).map((artifact) => artifact.id);
        const modelAttempt = [...artifacts].reverse().find((artifact) => artifact.kind === "review" && artifact.title === "受约束模型研究推理" && artifact.nodeId === node.id)?.data as ModelReasoningAttempt | undefined;
        return this.store.putArtifact({ ...base, kind: "review", title: "隔离独立复核", status: modelCheck.passed && !modelAttempt?.errors?.length ? "verified" : "draft", data: {
          verifier: "independent-research-review", passed: modelCheck.passed, errors: modelCheck.errors, warnings: modelCheck.warnings,
          reviewScopeArtifactIds: reviewScope, contextPolicy: "isolated_review", mutationPolicy: "review_only", modelFindings: modelAttempt?.data?.reviewFindings || [], modelTraceRef: modelAttempt?.fingerprint,
        }, sourceRefs: [] });
      }
      case "hypothesis": {
        const modelAttempt = [...artifacts].reverse().find((artifact) => artifact.kind === "review" && artifact.title === "受约束模型研究推理" && artifact.nodeId === node.id)?.data as ModelReasoningAttempt | undefined;
        const result = modelAttempt?.data?.hypotheses.length ? { hypothesisCandidates: modelAttempt.data.hypotheses.map((item) => ({ ...item, status: "candidate", source: "bounded_model" })), evidenceAssignments: modelAttempt.data.evidenceAssignments, modelTraceRef: modelAttempt.fingerprint }
          : this.functions.execute("GenerateHypothesisCandidates", { caseRef: task.researchCaseId, statement: task.goal });
        const artifact = this.store.putArtifact({ ...base, kind: "hypothesis_map", title: "假设与竞争解释", data: { ...result, status: "candidate_only", commitAction: "AcceptHypothesis" } });
        this.putSurface(task, node, "hypothesis_map", "假设与竞争解释", { hypotheses: (result.hypothesisCandidates || []) as Array<{ statement: string; falsificationConditions: string[]; status: string }>, status: "candidate_only" }, artifact.id);
        return artifact;
      }
      case "judgment": {
        const evaluations = inputArtifacts.filter((artifact) => artifact.kind === "evidence_package" && artifact.title === "证据评估");
        const evaluationData = evaluations.map((artifact) => artifact.data as { sufficient?: boolean; requirementFulfilled?: boolean; evidenceRole?: string; independentPublisherCount?: number; facts?: Array<import("@/src/contracts").EvidenceFact & { ontologyFactRef?: string }> });
        const evidenceFacts = evaluationData.flatMap((item) => item.facts || []);
        const evidenceRefs = evidenceFacts.map((fact) => fact.ontologyFactRef).filter((id): id is string => Boolean(id));
        const selectedMethods = inputArtifacts.find((artifact) => artifact.kind === "method_application") || [...artifacts].reverse().find((artifact) => artifact.kind === "method_application");
        const assessedMethods = assessResearchMethods((selectedMethods?.data as ResearchMethodPlan | undefined) || selectResearchMethods(task.goal, task.reportSpec), evidenceFacts, false);
        const coreMethod = assessedMethods.applications.find((item) => item.sectionKey === "core_judgments");
        const methodInputsReady = Boolean(coreMethod && coreMethod.missingEvidenceRoles.length === 0);
        const supportSatisfied = evaluationData.filter((item) => item.evidenceRole === "support").every((item) => item.requirementFulfilled === true);
        const counterSearched = evaluationData.some((item) => item.evidenceRole === "counter" && item.requirementFulfilled === true);
        const boundarySatisfied = evaluationData.filter((item) => item.evidenceRole === "boundary").every((item) => item.requirementFulfilled === true);
        const maximumIndependentPublishers = Math.max(0, ...evaluationData.map((item) => Number(item.independentPublisherCount || 0)));
        const evidenceGrade: EvidenceGrade = !evidenceFacts.length ? "Q0" : maximumIndependentPublishers < 2 ? "Q1" : supportSatisfied && boundarySatisfied ? "Q3" : "Q2";
        const thresholdEvaluation = evaluateJudgmentThreshold({
          evidenceGrade,
          counterevidenceStatus: counterSearched ? "cleared" : "not_checked",
          pathReadiness: methodInputsReady ? "ready" : coreMethod ? "restricted" : "blocked",
        });
        const hasQualified = supportSatisfied && counterSearched && boundarySatisfied && methodInputsReady && ["J2", "J3", "J4"].includes(thresholdEvaluation.maxLevel);
        const computed = this.functions.execute("ComputeJudgmentProposal", { caseRef: task.researchCaseId, evidenceRefs, hypothesisRefs: [], statement: hasQualified ? "证据门槛已满足，等待研究员复核。" : "暂不可判断" });
        const executedMethods = hasQualified ? assessResearchMethods(assessedMethods, evidenceFacts, true) : assessedMethods;
        if (selectedMethods) this.store.reviseArtifacts([{ id: selectedMethods.id, expectedVersion: selectedMethods.version, data: executedMethods, createdBy: "ComputeJudgmentProposal" }]);
        const executedCore = executedMethods.applications.find((item) => item.sectionKey === "core_judgments");
        this.store.appendEvent({ conversationId: task.conversationId, taskId: task.id, nodeId: node.id, type: "method.applications_assessed", actorType: "system", actorId: "research-design", payload: { methodArtifactId: selectedMethods?.id, executedApplicationIds: executedMethods.applications.filter((item) => item.executionStatus === "executed").map((item) => item.id), blockedApplicationIds: executedMethods.applications.filter((item) => item.executionStatus === "blocked").map((item) => item.id) } });
        const proposal = computed.judgmentProposal as Record<string, unknown>;
        const modelAttempt = [...artifacts].reverse().find((artifact) => artifact.kind === "review" && artifact.title === "受约束模型研究推理" && artifact.nodeId === node.id)?.data as ModelReasoningAttempt | undefined;
        const modelJudgment = hasQualified ? modelAttempt?.data?.judgment : null;
        const signalInputs = evidenceFacts.flatMap((fact) => fact.ontologyFactRef ? [{ evidenceFactRef: fact.ontologyFactRef, statement: fact.statement, evidenceRoles: fact.evidenceRoles || [] }] : []);
        const factOntologyRefs = new Map(evidenceFacts.map((fact) => [fact.id, fact.ontologyFactRef]));
        const signalRoles = Object.fromEntries(signalInputs.map((input) => [input.evidenceFactRef, modelAttempt?.data?.evidenceAssignments.find((assignment) => factOntologyRefs.get(assignment.evidenceFactId) === input.evidenceFactRef)?.role || "support" as const]));
        const judgmentData: JudgmentSurfaceData & { commitAction: string | null } = {
          statement: modelJudgment?.statement || String(proposal.statement || "暂不可判断"),
          confidence: modelJudgment?.confidence || (typeof proposal.confidence === "string" ? proposal.confidence : "insufficient"),
          epistemicStatus: proposal.epistemicStatus as JudgmentSurfaceData["epistemicStatus"],
          lifecycleStatus: proposal.lifecycleStatus as JudgmentSurfaceData["lifecycleStatus"],
          evidenceRefs,
          methodApplicationRefs: executedCore ? [executedCore.id] : [],
          methodGateStatus: executedCore?.gateStatus || "blocked",
          judgmentType: executedCore?.judgmentType,
          judgmentLevel: thresholdEvaluation.maxLevel,
          thresholdEvaluation,
          signalInputs,
          signalRoles,
          reasoningRule: { ruleRef: thresholdEvaluation.policyRef, conditions: [
            { id: "verified_evidence", label: "所有信号输入均为已核验 EvidenceFact", passed: signalInputs.length > 0 },
            { id: "executed_method_application", label: "核心 MethodApplication 已执行并通过", passed: executedCore?.executionStatus === "executed" && executedCore.gateStatus === "passed" },
            { id: "support_signal_present", label: "本单元满足支持证据要求", passed: supportSatisfied },
            { id: "counter_search_completed", label: "已完成反证搜索或记录无结果", passed: counterSearched },
            { id: "boundary_covered", label: "已处理适用边界", passed: boundarySatisfied },
          ] },
          disposition: hasQualified ? "review_required" : "abstain",
          changeConditions: hasQualified ? (modelJudgment?.changeConditions.length ? modelJudgment.changeConditions : ["核心方法输入出现反向证据", "关键事实完成同口径刷新"]) : ["补齐方法缺口：" + (coreMethod?.missingEvidenceRoles.join("、") || "未选择核心方法"), "补齐支持、反证或边界证据要求"],
          commitAction: hasQualified ? "ApproveJudgment" : null,
          modelReasoning: modelJudgment ? { fingerprint: modelAttempt?.fingerprint, summary: modelJudgment.reasoningSummary, status: "candidate_only" as const } : undefined,
        };
        const terminalState = hasQualified ? "resolved" : "indeterminate";
        if (frontierNode) this.store.updateProblemGraphNode(frontierNode.id, { state: terminalState, resolvedArtifactIds: [] });
        const judgment = this.store.putArtifact({ ...base, kind: "judgment", title: "当前判断", data: { ...judgmentData, judgmentUnitRef: node.frontierRef.judgmentUnitRef, problemNodeId: frontierNode?.id, frontierState: terminalState, evidenceByRole: evaluationData } });
        if (frontierNode) this.store.updateProblemGraphNode(frontierNode.id, { state: terminalState, resolvedArtifactIds: [judgment.id] });
        this.putSurface(task, node, "judgment_card", `判断单元：${frontierNode?.title || "当前判断"}`, judgmentData, judgment.id);
        return judgment;
      }
      case "synthesis": {
        const graph = this.store.getProblemGraph(task.id);
        const units = graph?.nodes.filter((item) => item.type === "judgment_unit" && item.required) || [];
        const terminal = new Set(["resolved", "blocked", "indeterminate"]);
        if (units.some((item) => !terminal.has(item.state))) throw new Error("Cannot synthesize before every required JudgmentUnit reaches a terminal frontier state");
        const judgments = artifacts.filter((artifact) => artifact.kind === "judgment" && artifact.title === "当前判断");
        const bundle = judgments.map((artifact) => ({ artifactId: artifact.id, ...(artifact.data as Record<string, unknown>) }));
        if (graph) for (const item of graph.nodes.filter((node) => node.type === "synthesis")) this.store.updateProblemGraphNode(item.id, { state: "resolved" });
        return this.store.putArtifact({ ...base, kind: "judgment", title: "判断汇总", data: { judgmentBundle: bundle, frontierSummary: units.map((unit) => ({ judgmentUnitRef: unit.semanticRef || unit.id, title: unit.title, state: unit.state })), synthesisRule: "required units terminal" } });
      }
      case "compose": {
        const synthesis = [...inputArtifacts].reverse().find((artifact) => artifact.kind === "judgment" && artifact.title === "判断汇总");
        const atomicJudgments = artifacts.filter((artifact) => artifact.kind === "judgment" && artifact.title === "当前判断");
        const judgment = [...atomicJudgments].reverse()[0] || synthesis;
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
        const report = this.store.putArtifact({ ...base, kind: "report", title: draft.title, data: { ...(draft.data as unknown as Record<string, unknown>), judgmentBundleRefs: atomicJudgments.map((item) => item.id), synthesisArtifactRef: synthesis?.id }, sourceRefs: draft.sourceRefs });
        const caseObject = this.actions.ontology.getObject(task.researchCaseId);
        if (!caseObject) throw new Error(`ResearchCase not found: ${task.researchCaseId}`);
        const ontologyJudgmentRefs = atomicJudgments.map((item) => typeof item.data === "object" ? String((item.data as { ontologyJudgmentRef?: string }).ontologyJudgmentRef || "") : "").filter(Boolean);
        const created = this.actions.apply("CreateResearchDeliverable", {
          targetRefs: [{ id: caseObject.id, type: caseObject.type }],
          parameters: {
            title: report.title, artifactRef: report.id, judgmentRefs: ontologyJudgmentRefs,
            reportKind: task.reportSpec.kind, audience: task.reportSpec.audience, depth: task.reportSpec.depth,
            reportSpecVersion: task.reportSpec.version, sectionKeys: task.reportSpec.sections,
          },
          expectedVersions: { [`${caseObject.type}:${caseObject.id}`]: caseObject.version },
          idempotencyKey: `create-deliverable:${report.id}`, knowledgeLockId: this.store.getKnowledgeLock(task.id)?.id,
        }, { actorType: "agent", actorId: "research-lead", conversationId: task.conversationId, taskId: task.id });
        const deliverableRef = created.objects.find((object) => object.type === "ResearchDeliverable")?.id;
        const reportWithRef = this.store.putArtifact({ ...report, id: report.id, data: { ...(report.data as unknown as Record<string, unknown>), ontologyDeliverableRef: deliverableRef } });
        this.putSurface(task, node, "report_editor", report.title, reportWithRef.data as ReportSurfaceData, reportWithRef.id);
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
          const verifiedStatus = result.passed && deliverableRef ? "verified" as const : report.status;
          const surfaceCheck = verifyUiSurface(nextSurface);
          if (!surfaceCheck.passed) throw new Error(surfaceCheck.errors.join("; "));
          this.store.reviseArtifacts([
            { id: report.id, expectedVersion: report.version, data: reportData, status: verifiedStatus, createdBy: "report-quality-evaluator" },
            { id: surfaceArtifact.id, expectedVersion: surfaceArtifact.version, data: nextSurface, status: verifiedStatus, createdBy: "report-quality-evaluator" },
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
    if (node.kind === "evidence_evaluation" && (!node.frontierRef.evidenceRole || node.frontierRef.evidenceRole === "support") && (artifact.data as { sufficient?: boolean }).sufficient === true) {
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
    this.store.transitionTask(task.id, "request_approval", { payload: { approvalId: approval.id, kind, artifactId: artifact.id, artifactVersion: artifact.version } });
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
    if (!data.judgmentLevel || !data.thresholdEvaluation || data.judgmentLevel !== data.thresholdEvaluation.maxLevel) throw new Error("Judgment approval requires a deterministic threshold evaluation");
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
    // The approved Problem Graph has already materialized the atomic unit under a
    // plan-confirmation token. A judgment approval must attach to that unit instead
    // of creating a second, unreviewed unit at the point of adjudication.
    const judgmentUnitRef = String((data as JudgmentSurfaceData & { judgmentUnitRef?: string }).judgmentUnitRef || "");
    const judgmentUnit = this.actions.ontology.getObject(judgmentUnitRef);
    if (!judgmentUnit || judgmentUnit.type !== "JudgmentUnit") throw new Error("Judgment approval requires a materialized Problem Graph JudgmentUnit");
    const scope = this.actions.ontology.listLinksForObject(judgmentUnit.id)
      .filter((link) => link.type === "unitUsesScope" && link.sourceRef.id === judgmentUnit.id)
      .map((link) => this.actions.ontology.getObject(link.targetRef.id))
      .find((object) => object?.type === "ResearchScope");
    if (!scope) throw new Error("Materialized JudgmentUnit is missing its ResearchScope");
    const caseAfterUnit = caseObject;
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
          statement, judgmentType, timeHorizon, epistemicStatus: "supported", judgmentLevel: data.judgmentLevel, thresholdEvaluation: data.thresholdEvaluation,
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

  private putSurface<C extends UiSurface["component"]>(task: Task, node: TaskNode, component: C, title: string, data: Extract<UiSurface, { component: C }>["data"], artifactId?: string): Artifact {
    const judgmentState = component === "judgment_card" ? data as JudgmentSurfaceData : undefined;
    const editableFields = component === "judgment_card"
      ? [...editableArtifactFields("judgment", !["abstain", "insufficient"].includes(String(judgmentState?.disposition || judgmentState?.confidence)))]
      : component === "report_editor" ? [...editableArtifactFields("report")] : [];
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
      if (["ready", "blocked", "completed", "failed"].includes(node.status)) this.store.transitionNode(node.id, "invalidate", { inputArtifactIds: [], outputArtifactIds: [] }, { actorId: "artifact-service", payload: { artifactId } });
    }
    const currentTask = this.requireTask(task.id);
    if (currentTask.status !== "queued") this.store.transitionTask(task.id, "invalidate", { actorId: "artifact-service", payload: { artifactId } });
    const jobId = this.store.enqueueTask(task.id, "resume");
    this.store.appendEvent({
      conversationId: task.conversationId, taskId: task.id, nodeId: start.id, type: "connector.evidence_recompute_queued",
      actorType: "system", actorId: "connector-ingestion", payload: { artifactId, startKind, affectedNodeIds: affected.map((node) => node.id), jobId },
    });
  }

  private publicPlan(plan: ResearchPlan, nodes: TaskNode[], reportSpec?: Task["reportSpec"], methodPlan?: ResearchMethodPlan, graph?: ResearchProblemGraph, lensSuggestions?: ResearchPlanSurfaceData["lensSuggestions"]): ResearchPlanSurfaceData {
    return { intent: plan.intent, rationale: plan.rationale, nodes: nodes.map((node) => ({ id: node.id, title: node.title, kind: node.kind, capability: `${node.capabilityType}:${node.capabilityId}`, dependsOn: node.dependsOn, frontierRef: node.frontierRef })), parallelGroups: plan.parallelGroups, stopConditions: plan.stopConditions, stopPredicates: plan.stopPredicates, problemGraph: graph ? { id: graph.id, status: graph.status, nodes: graph.nodes, edges: graph.edges, scenarioRefs: graph.scenarioRefs, taskMotifRefs: graph.taskMotifRefs, lensRefs: graph.lensRefs } : undefined, lensSuggestions, principle: "确定性负责边界，Agent 负责路径", reportSpec, methodPlan };
  }

  /** The plan confirmation is the authorization boundary for the whole reviewed graph.
   * Runtime nodes retain graph IDs; semantic refs are attached here only after approval. */
  private materializeConfirmedProblemGraph(approval: ApprovalRequest): void {
    const task = this.requireTask(approval.taskId);
    const graph = this.store.getProblemGraph(task.id);
    if (!graph || graph.status !== "proposed") return;
    const caseObject = this.actions.ontology.getObject(task.researchCaseId);
    if (!caseObject) throw new Error("ResearchCase missing while materializing confirmed Problem Graph");
    const context = { actorType: "researcher" as const, actorId: "researcher", conversationId: task.conversationId, taskId: task.id };
    const actionBase = { expectedVersions: { [`${caseObject.type}:${caseObject.id}`]: caseObject.version }, approvalToken: approval.id, knowledgeLockId: this.store.getKnowledgeLock(task.id)?.id };
    const roots = graph.nodes.filter((node) => node.type === "root_question");
    for (const root of roots) {
      const result = this.actions.apply("CreateResearchQuestion", {
        targetRefs: [{ id: caseObject.id, type: caseObject.type }], parameters: { question: String(root.payload.question || root.title), failureRoute: "competing_explanation", scopeLabel: "已确认研究范围", scopeDimensions: { graphId: graph.id } },
        ...actionBase, idempotencyKey: `problem-graph:${graph.id}:question:${root.id}`,
      }, context);
      const question = result.objects.find((object) => object.type === "ResearchQuestion");
      if (!question) throw new Error("CreateResearchQuestion did not return a ResearchQuestion");
      this.store.updateProblemGraphNode(root.id, { semanticRef: question.id, state: "active" });
    }
    const fresh = this.store.getProblemGraph(task.id)!;
    const confirmedLensRefs = fresh.lensRefs?.length ? fresh.lensRefs : ["fundamental"];
    for (const root of fresh.nodes.filter((node) => node.type === "root_question" && node.semanticRef)) {
      this.actions.apply("ConfirmResearchMandate", {
        targetRefs: [{ id: caseObject.id, type: caseObject.type }],
        parameters: {
          title: `研究委托：${root.title}`,
          questionRef: root.semanticRef,
          lensRefs: confirmedLensRefs,
          horizon: "本轮研究",
          comparisonBasis: "历史趋势、可比对象与共识预期",
          materialityBoundary: "以已确认 Problem Graph 的判断单元和证据边界为准",
          excludedModules: ["投资评级", "目标价", "仓位", "交易执行"],
        },
        ...actionBase,
        idempotencyKey: `problem-graph:${fresh.id}:mandate:${root.id}`,
      }, context);
    }
    const typeFor = (value: unknown): string => {
      const raw = String(value || "");
      if (raw.includes("cycle")) return "cycle_phase";
      if (raw.includes("transmission") || raw.includes("impact")) return "transmission_path";
      if (raw.includes("maturity")) return "trend_direction";
      return "mechanism_validation";
    };
    for (const unit of fresh.nodes.filter((node) => node.type === "judgment_unit")) {
      const rootId = fresh.edges.find((edge) => edge.fromNodeId === unit.id && edge.relation === "aggregates")?.toNodeId;
      const question = rootId ? fresh.nodes.find((node) => node.id === rootId) : undefined;
      if (!question?.semanticRef) throw new Error("JudgmentUnit is missing its parent ResearchQuestion");
      const result = this.actions.apply("CreateJudgmentUnit", {
        targetRefs: [{ id: caseObject.id, type: caseObject.type }], parameters: { statement: unit.title, judgmentType: typeFor(unit.payload.judgmentType), questionRef: question.semanticRef, scopeLabel: "已确认研究范围", scopeDimensions: { graphId: fresh.id } },
        ...actionBase, idempotencyKey: `problem-graph:${fresh.id}:unit:${unit.id}`,
      }, context);
      const formalUnit = result.objects.find((object) => object.type === "JudgmentUnit");
      if (!formalUnit) throw new Error("CreateJudgmentUnit did not return a JudgmentUnit");
      this.store.updateProblemGraphNode(unit.id, { semanticRef: formalUnit.id, state: "active" });
      const currentUnit = this.actions.ontology.getObject(formalUnit.id)!;
      for (const requirement of fresh.nodes.filter((node) => node.type === "evidence_requirement" && node.payload.judgmentUnitKey === unit.key)) {
        const resultRequirement = this.actions.apply("RegisterEvidenceRequirement", {
          targetRefs: [{ id: currentUnit.id, type: currentUnit.type }], parameters: { requirement: requirement.title, evidenceRole: requirement.payload.evidenceRole, minimumIndependentSources: requirement.payload.minIndependentPublishers, noProfileReason: "task_local" },
          expectedVersions: { [`${currentUnit.type}:${currentUnit.id}`]: currentUnit.version }, idempotencyKey: `problem-graph:${fresh.id}:requirement:${requirement.id}`, knowledgeLockId: actionBase.knowledgeLockId,
        }, { ...context, actorType: "agent", actorId: "research-lead" });
        const formalRequirement = resultRequirement.objects.find((object) => object.type === "EvidenceRequirement");
        if (formalRequirement) this.store.updateProblemGraphNode(requirement.id, { semanticRef: formalRequirement.id, state: "active" });
      }
      const primary = fresh.nodes.find((node) => node.type === "hypothesis" && node.payload.judgmentUnitKey === unit.key);
      if (primary) this.actions.apply("AcceptHypothesis", {
        targetRefs: [{ id: caseObject.id, type: caseObject.type }], parameters: { statement: primary.title, judgmentUnitRef: formalUnit.id, direction: "neutral", timeHorizon: "本轮研究", falsificationConditions: ["支持证据不足", "竞争解释获得更强区分性证据"], role: "primary" },
        expectedVersions: { [`${caseObject.type}:${caseObject.id}`]: caseObject.version }, idempotencyKey: `problem-graph:${fresh.id}:hypothesis:${primary.id}`, knowledgeLockId: actionBase.knowledgeLockId,
      }, { ...context, actorType: "agent", actorId: "research-lead" });
      const competing = fresh.nodes.find((node) => node.type === "competing_explanation" && node.payload.judgmentUnitKey === unit.key);
      if (competing) this.actions.apply("RegisterCompetingExplanation", {
        targetRefs: [{ id: formalUnit.id, type: formalUnit.type }], parameters: { statement: competing.title, discriminatingEvidence: ["区分主假设与竞争解释的直接证据" ] },
        expectedVersions: { [`${formalUnit.type}:${formalUnit.id}`]: formalUnit.version }, idempotencyKey: `problem-graph:${fresh.id}:competing:${competing.id}`, knowledgeLockId: actionBase.knowledgeLockId,
      }, { ...context, actorType: "agent", actorId: "research-lead" });
    }
    for (const node of this.store.getProblemGraph(task.id)!.nodes.filter((node) => node.type === "synthesis")) this.store.updateProblemGraphNode(node.id, { state: "active" });
    const materialized = this.store.getProblemGraph(task.id)!;
    for (const executionNode of this.store.listTaskNodes(task.id)) {
      const frontier = materialized.nodes.find((node) => node.id === executionNode.frontierRef.problemNodeId);
      const unitKey = frontier?.type === "judgment_unit" ? frontier.key : String(frontier?.payload.judgmentUnitKey || "");
      const unit = materialized.nodes.find((node) => node.type === "judgment_unit" && node.key === unitKey);
      if (!frontier && !unit) continue;
      this.store.updateNode(executionNode.id, { frontierRef: { ...executionNode.frontierRef, judgmentUnitRef: unit?.semanticRef || executionNode.frontierRef.judgmentUnitRef, evidenceRequirementRef: frontier?.type === "evidence_requirement" ? frontier.semanticRef || executionNode.frontierRef.evidenceRequirementRef : executionNode.frontierRef.evidenceRequirementRef } });
    }
    this.store.db.prepare("UPDATE problem_graphs SET status='active' WHERE id=?").run(graph.id);
    this.store.appendEvent({ conversationId: task.conversationId, taskId: task.id, type: "problem_graph.materialized", actorType: "researcher", actorId: "researcher", payload: { problemGraphId: graph.id, approvalId: approval.id, lensRefs: confirmedLensRefs } });
  }

  private planSurface(plan: ResearchPlan, nodes: TaskNode[], reportSpec?: Task["reportSpec"], methodPlan?: ResearchMethodPlan, graph?: ResearchProblemGraph, lensSuggestions?: ResearchPlanSurfaceData["lensSuggestions"]): UiSurface {
    const surface: Extract<UiSurface, { component: "research_plan" }> = { id: randomUUID(), component: "research_plan", title: "研究计划", editableFields: [], data: this.publicPlan(plan, nodes, reportSpec, methodPlan, graph, lensSuggestions) };
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
