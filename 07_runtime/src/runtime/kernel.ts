import { createHash, randomUUID } from "node:crypto";
import type { ApprovalRequest, Artifact, AssetRef, JudgmentSurfaceData, ReportSurfaceData, ResearchPlanSurfaceData, SourceCandidate, Task, TaskNode, UiSurface } from "@/src/contracts";
import { verifyArtifactWrite, verifyReportClaims, verifyUiSurface } from "@/src/governance/verifiers";
import { materializeNodes, planResearch, type ResearchPlan } from "@/src/runtime/planner";
import { compilePlannerProposal, type CompiledResearchPlan, type PlannerProposal } from "@/src/runtime/plan-compiler";
import { getResearchNodeType } from "@/src/runtime/node-catalog";
import { RuntimeStore } from "@/src/runtime/store";
import { LocalSemanticGateway } from "@/src/semantic/local-gateway";
import { ResearchProvenanceStore } from "@/src/semantic/provenance-store";
import { LocalSourceGateway } from "@/src/tools/local-source-gateway";
import { OntologyActionService } from "@/src/ontology/action-service";
import { OntologyFunctionService } from "@/src/ontology/functions";

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

  submitGoal(conversationId: string, content: string, proposal?: PlannerProposal, options: { pinnedAssetRefs?: AssetRef[] } = {}): { task: Task; approval?: ApprovalRequest } {
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
    const task = this.store.createTask({ conversationId, researchCaseId, goal: content, intent: plan.intent, status: plan.intent === "clarify" ? "waiting_input" : "waiting_approval", budget: DEFAULT_BUDGET });
    this.store.createKnowledgeLock(task.id);
    if (pinnedAssetRefs.length) this.store.appendEvent({ conversationId, taskId: task.id, type: "context.pinned", actorType: "researcher", actorId: "researcher", payload: { assetRefs: pinnedAssetRefs } });
    const nodes = materializeNodes(task.id, plan, task.budget);
    this.store.addTaskNodes(nodes);
    const planArtifact = this.store.putArtifact({
      conversationId, taskId: task.id, kind: "research_plan", title: "可调整研究计划", status: "draft",
      data: { ...this.publicPlan(plan, nodes), planner: { source: compiled.source, proposalFingerprint: compiled.proposalFingerprint, diagnostics: compiled.diagnostics } }, sourceRefs: [], createdBy: "research-lead",
    });
    this.store.appendEvent({ conversationId, taskId: task.id, type: "planner.compiled", actorType: "system", actorId: "plan-compiler", payload: { source: compiled.source, proposalFingerprint: compiled.proposalFingerprint, diagnostics: compiled.diagnostics } });
    this.store.appendEvent({ conversationId, taskId: task.id, type: "plan.proposed", actorType: "agent", actorId: "research-lead", payload: { planArtifactId: planArtifact.id, intent: plan.intent, nodeCount: nodes.length, plannerSource: compiled.source } });
    this.store.checkpoint({ taskId: task.id, phase: "after", state: { milestone: "plan_determined", planArtifactId: planArtifact.id, nodeIds: nodes.map((node) => node.id) } });
    this.store.putArtifact({ conversationId, taskId: task.id, kind: "ui_surface", title: "研究计划", status: "draft", data: this.planSurface(plan, nodes), sourceRefs: [], createdBy: "research-lead" });

    if (plan.intent === "clarify") {
      this.store.addMessage({ conversationId, actorType: "agent", actorId: "research-lead", content: "在开始研究前，我需要确认研究对象、希望支持的决策和时间范围。你可以直接补充，例如：研究对象 + 未来六个月 + 希望判断的问题。" });
      return { task };
    }
    const approval = this.store.createApproval({ conversationId, taskId: task.id, kind: "plan_confirmation", prompt: "按这份动态计划开始研究？你仍可直接修改目标或范围。" });
    this.store.appendEvent({ conversationId, taskId: task.id, type: "approval.requested", actorType: "system", actorId: "runtime", payload: { approvalId: approval.id, kind: approval.kind } });
    return { task, approval };
  }

  decideApproval(id: string, decision: "approved" | "rejected", note?: string): ApprovalRequest {
    const approval = this.store.decideApproval(id, decision, note);
    this.store.appendEvent({ conversationId: approval.conversationId, taskId: approval.taskId, nodeId: approval.nodeId, type: "approval.decided", actorType: "researcher", actorId: "researcher", payload: { approvalId: id, decision, note } });
    this.store.checkpoint({ taskId: approval.taskId, nodeId: approval.nodeId, phase: "after", state: { milestone: "user_confirmation", approvalId: id, decision } });
    if (decision === "approved") {
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
    const branch = this.store.createTask({ conversationId: parent.conversationId, researchCaseId, parentTaskId: parent.id, goal, intent: plan.intent, status: "waiting_approval", budget: parent.budget });
    this.store.createKnowledgeLock(branch.id);
    const nodes = materializeNodes(branch.id, plan, branch.budget);
    this.store.addTaskNodes(nodes);
    this.store.putArtifact({ conversationId: branch.conversationId, taskId: branch.id, kind: "research_plan", title: "分支研究计划", status: "draft", data: this.publicPlan(plan, nodes), sourceRefs: [], createdBy: "research-lead" });
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
    const nextData = { ...(current.data as Record<string, unknown>), ...changes };
    this.verifyArtifactRevision(current.kind, nextData, current.sourceRefs);
    const nextSurface = { ...surface, data: { ...(surface.data as unknown as Record<string, unknown>), ...changes } } as unknown as UiSurface;
    const surfaceCheck = verifyUiSurface(nextSurface);
    if (!surfaceCheck.passed) throw new Error(surfaceCheck.errors.join("; "));

    const revised = this.store.reviseArtifact({ id: current.id, expectedVersion, data: nextData, createdBy: "researcher" });
    const revisedSurface = this.store.reviseArtifact({ id: surfaceArtifact.id, expectedVersion: surfaceArtifact.version, data: nextSurface, createdBy: "researcher" });
    const ownerNode = this.store.getTaskNode(current.nodeId);
    if (!ownerNode) throw new Error(`Artifact owner node not found: ${current.nodeId}`);
    const descendants = this.descendantNodes(current.taskId, ownerNode.id);
    for (const node of descendants) this.store.updateNode(node.id, { status: "pending", inputArtifactIds: [], outputArtifactIds: [] });
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
        return this.store.putArtifact({ ...base, kind: "research_plan", title: "研究方法", data: { method: "证据三角验证 + 竞争解释", exitCondition: "关键证据不足时停止并输出暂不可判断" } });
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
        const result = this.store.runToolOnce({ key: `${task.id}:${node.id}:source.capture:v2`, toolId: "source.capture", taskId: task.id }, () => {
          const snapshots = candidates.map((candidate) => this.sources.capture(candidate));
          const caseObject = this.actions.ontology.getObject(task.researchCaseId);
          if (!caseObject) throw new Error(`ResearchCase not found: ${task.researchCaseId}`);
          const captures = snapshots.map((snapshot) => {
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
          return { captures, explicitNoAvailableSource: snapshots.length === 0 };
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
        const sourceRefs = snapshotIds.flatMap((id) => {
          const snapshot = this.provenance.getSnapshot(id);
          return snapshot ? [this.sources.toSourceReference(snapshot)] : [];
        });
        const facts = captures.flatMap((capture) => {
          const snapshot = this.provenance.getSnapshot(capture.id);
          if (!snapshot || snapshot.verification !== "verified") return [];
          const factType = /预计|预期|展望|expects?|outlook|forecast/i.test(snapshot.quote) ? "forecast" as const : "reported_fact" as const;
          const fact = this.provenance.promoteFact({ snapshotId: capture.id, statement: snapshot.quote, factType, confidence: "medium" });
          if (!capture.ontologySnapshotRef) return [{ ...fact, ontologyFactRef: undefined }];
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
          return [{ ...fact, ontologyFactRef: promoted.objects.find((object) => object.type === "EvidenceFact")?.id }];
        });
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
        const evidenceData = (evidence?.data || {}) as { sufficient?: boolean; facts?: Array<{ ontologyFactRef?: string }> };
        const evidenceRefs = (evidenceData.facts || []).map((fact) => fact.ontologyFactRef).filter((id): id is string => Boolean(id));
        const hasQualified = evidenceData.sufficient === true;
        const computed = this.functions.execute("ComputeJudgmentProposal", { caseRef: task.researchCaseId, evidenceRefs, hypothesisRefs: [], statement: hasQualified ? "证据门槛已满足，等待研究员复核。" : "暂不可判断" });
        const proposal = computed.judgmentProposal as Record<string, unknown>;
        const judgmentData: JudgmentSurfaceData & { commitAction: string | null } = {
          statement: String(proposal.statement || "暂不可判断"),
          confidence: typeof proposal.confidence === "string" ? proposal.confidence : "insufficient",
          epistemicStatus: proposal.epistemicStatus as JudgmentSurfaceData["epistemicStatus"],
          lifecycleStatus: proposal.lifecycleStatus as JudgmentSurfaceData["lifecycleStatus"],
          evidenceRefs,
          disposition: hasQualified ? "review_required" : "abstain",
          changeConditions: ["获得经核验的一手来源", "关键事实完成交叉验证"],
          commitAction: hasQualified ? "ApproveJudgment" : null,
        };
        const judgment = this.store.putArtifact({ ...base, kind: "judgment", title: "当前判断", data: judgmentData });
        this.putSurface(task, node, "judgment_card", "当前判断", judgmentData, judgment.id, hasQualified ? ["statement", "confidence", "changeConditions"] : ["changeConditions"]);
        return judgment;
      }
      case "compose": {
        const judgment = [...artifacts].reverse().find((artifact) => artifact.kind === "judgment");
        if (task.intent === "compose_only" && !judgment) throw new Error("没有可复用的正式 Judgment；需要先选择历史制品。");
        const report = this.store.putArtifact({ ...base, kind: "report", title: "研究备忘录", data: { summary: judgment ? (judgment.data as { statement?: string }).statement : "当前仅有证据包，未形成判断。", claims: [], boundary: "未形成任何无来源支持的正式 Claim。" } });
        const caseObject = this.actions.ontology.getObject(task.researchCaseId);
        if (!caseObject) throw new Error(`ResearchCase not found: ${task.researchCaseId}`);
        const created = this.actions.apply("CreateResearchDeliverable", {
          targetRefs: [{ id: caseObject.id, type: caseObject.type }],
          parameters: { title: report.title, artifactRef: report.id, judgmentRefs: [] },
          expectedVersions: { [`${caseObject.type}:${caseObject.id}`]: caseObject.version },
          idempotencyKey: `create-deliverable:${report.id}`, knowledgeLockId: this.store.getKnowledgeLock(task.id)?.id,
        }, { actorType: "agent", actorId: "research-lead", conversationId: task.conversationId, taskId: task.id });
        const deliverableRef = created.objects.find((object) => object.type === "ResearchDeliverable")?.id;
        const reportWithRef = this.store.putArtifact({ ...report, id: report.id, data: { ...(report.data as Record<string, unknown>), ontologyDeliverableRef: deliverableRef } });
        this.putSurface(task, node, "report_editor", "研究备忘录", reportWithRef.data as ReportSurfaceData, reportWithRef.id, ["summary", "boundary"]);
        return reportWithRef;
      }
      case "audit": {
        const report = [...artifacts].reverse().find((artifact) => artifact.kind === "report");
        const result = report ? verifyReportClaims(report.data, report.sourceRefs) : { verifier: "claim-provenance", passed: false, errors: ["missing report"], warnings: [] };
        const review = this.store.putArtifact({ ...base, kind: "review", title: "确定性审计", data: { ...result, qualityEval: "not_run" } });
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
      prompt = "判断提案已经形成。确认其表述、置信边界和改判条件后继续生成报告？";
    }
    if (!kind) return;
    const approval = this.store.createApproval({ conversationId: task.conversationId, taskId: task.id, nodeId: node.id, kind, prompt });
    this.store.updateTaskStatus(task.id, "waiting_approval");
    this.store.appendEvent({ conversationId: task.conversationId, taskId: task.id, nodeId: node.id, type: "approval.requested", actorType: "system", actorId: "runtime", payload: { approvalId: approval.id, kind, artifactId: artifact.id, artifactVersion: artifact.version } });
    this.store.checkpoint({ taskId: task.id, nodeId: node.id, phase: "pause", state: { milestone: kind, approvalId: approval.id, artifactId: artifact.id, artifactVersion: artifact.version } });
  }

  private putSurface<C extends UiSurface["component"]>(task: Task, node: TaskNode, component: C, title: string, data: Extract<UiSurface, { component: C }>["data"], artifactId?: string, editableFields: string[] = []): Artifact {
    const surface = { id: randomUUID(), component, title, data, editableFields, artifactId } as unknown as Extract<UiSurface, { component: C }>;
    const verified = verifyUiSurface(surface);
    if (!verified.passed) throw new Error(verified.errors.join("; "));
    return this.store.putArtifact({ conversationId: task.conversationId, taskId: task.id, nodeId: node.id, kind: "ui_surface", title, status: "draft", data: surface, sourceRefs: [], createdBy: "research-lead" });
  }

  private publicPlan(plan: ResearchPlan, nodes: TaskNode[]): ResearchPlanSurfaceData {
    return { intent: plan.intent, rationale: plan.rationale, nodes: nodes.map((node) => ({ id: node.id, title: node.title, kind: node.kind, capability: `${node.capabilityType}:${node.capabilityId}`, dependsOn: node.dependsOn })), parallelGroups: plan.parallelGroups, stopConditions: plan.stopConditions, principle: "确定性负责边界，Agent 负责路径" };
  }

  private planSurface(plan: ResearchPlan, nodes: TaskNode[]): UiSurface {
    const surface: Extract<UiSurface, { component: "research_plan" }> = { id: randomUUID(), component: "research_plan", title: "研究计划", editableFields: ["nodes", "stopConditions"], data: this.publicPlan(plan, nodes) };
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
