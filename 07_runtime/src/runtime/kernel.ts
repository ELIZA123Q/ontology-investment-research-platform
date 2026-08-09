import { createHash, randomUUID } from "node:crypto";
import type { ApprovalRequest, Artifact, Task, TaskNode, UiSurface } from "@/src/contracts";
import { verifyArtifactWrite, verifyReportClaims, verifyUiSurface } from "@/src/governance/verifiers";
import { materializeNodes, planResearch, type ResearchPlan } from "@/src/runtime/planner";
import { getResearchNodeType } from "@/src/runtime/node-catalog";
import { RuntimeStore } from "@/src/runtime/store";

const DEFAULT_BUDGET = { maxModelCalls: 12, maxToolCalls: 30, maxCostUsd: 3 };

export interface ConversationSnapshot {
  conversation: ReturnType<RuntimeStore["getConversation"]>;
  messages: ReturnType<RuntimeStore["listMessages"]>;
  task: Task | null;
  nodes: TaskNode[];
  artifacts: Artifact[];
  approvals: ApprovalRequest[];
  events: ReturnType<RuntimeStore["listEvents"]>;
}

export class AgentKernel {
  constructor(readonly store: RuntimeStore) {}

  submitGoal(conversationId: string, content: string): { task: Task; approval?: ApprovalRequest } {
    const conversation = this.store.getConversation(conversationId);
    if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);
    this.store.addMessage({ conversationId, actorType: "researcher", actorId: "researcher", content });
    const plan = planResearch(content);
    const task = this.store.createTask({ conversationId, goal: content, intent: plan.intent, status: plan.intent === "clarify" ? "waiting_input" : "waiting_approval", budget: DEFAULT_BUDGET });
    const nodes = materializeNodes(task.id, plan, task.budget);
    this.store.addTaskNodes(nodes);
    const planArtifact = this.store.putArtifact({
      conversationId, taskId: task.id, kind: "research_plan", title: "可调整研究计划", status: "draft",
      data: this.publicPlan(plan, nodes), sourceRefs: [], createdBy: "research-lead",
    });
    this.store.appendEvent({ conversationId, taskId: task.id, type: "plan.proposed", actorType: "agent", actorId: "research-lead", payload: { planArtifactId: planArtifact.id, intent: plan.intent, nodeCount: nodes.length } });
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
      }
    }

    const finalNodes = this.store.listTaskNodes(taskId);
    if (finalNodes.some((node) => node.status === "failed")) this.store.updateTaskStatus(taskId, "failed");
    else if (finalNodes.some((node) => node.status === "blocked")) this.store.updateTaskStatus(taskId, "waiting_input");
    else if (finalNodes.every((node) => node.status === "completed" || node.status === "cancelled")) this.store.updateTaskStatus(taskId, "completed");
    const updated = this.requireTask(taskId);
    this.store.appendEvent({ conversationId: task.conversationId, taskId, type: "task.settled", actorType: "system", actorId: "runtime", payload: { status: updated.status } });
    return updated;
  }

  cancelTask(taskId: string): Task {
    const task = this.requireTask(taskId);
    this.store.updateTaskStatus(taskId, "cancelled");
    for (const node of this.store.listTaskNodes(taskId)) if (["pending", "ready", "running"].includes(node.status)) this.store.updateNode(node.id, { status: "cancelled" });
    this.store.appendEvent({ conversationId: task.conversationId, taskId, type: "task.cancelled", actorType: "researcher", actorId: "researcher", payload: {} });
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
    const branch = this.store.createTask({ conversationId: parent.conversationId, parentTaskId: parent.id, goal, intent: plan.intent, status: "waiting_approval", budget: parent.budget });
    const nodes = materializeNodes(branch.id, plan, branch.budget);
    this.store.addTaskNodes(nodes);
    this.store.putArtifact({ conversationId: branch.conversationId, taskId: branch.id, kind: "research_plan", title: "分支研究计划", status: "draft", data: this.publicPlan(plan, nodes), sourceRefs: [], createdBy: "research-lead" });
    this.store.appendEvent({ conversationId: branch.conversationId, taskId: branch.id, type: "task.branched", actorType: "researcher", actorId: "researcher", payload: { parentTaskId: parent.id, revisedGoal: goal } });
    this.store.checkpoint({ taskId: branch.id, phase: "after", state: { milestone: "plan_determined", parentTaskId: parent.id } });
    this.store.createApproval({ conversationId: branch.conversationId, taskId: branch.id, kind: "plan_confirmation", prompt: "确认开始这个研究分支？" });
    return branch;
  }

  snapshot(conversationId: string): ConversationSnapshot {
    const task = this.store.getLatestTask(conversationId);
    return {
      conversation: this.store.getConversation(conversationId), messages: this.store.listMessages(conversationId), task,
      nodes: task ? this.store.listTaskNodes(task.id) : [], artifacts: task ? this.store.listArtifacts(task.id) : [],
      approvals: this.store.listPendingApprovals(conversationId), events: this.store.listEvents(conversationId),
    };
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
        this.store.appendEvent({ conversationId: task.conversationId, taskId: task.id, nodeId: node.id, type: "context.assembled", actorType: "system", actorId: "context-builder", payload: { references: [], tokenBudget: 8_000, persisted: false } });
        return null;
      case "method_selection":
        return this.store.putArtifact({ ...base, kind: "research_plan", title: "研究方法", data: { method: "证据三角验证 + 竞争解释", exitCondition: "关键证据不足时停止并输出暂不可判断" } });
      case "impact_analysis":
        return this.store.putArtifact({ ...base, kind: "research_plan", title: "影响范围", data: { reusedArtifactIds: [], invalidatedArtifactIds: [], reason: "等待可核验的新材料与时间范围元数据" } });
      case "evidence_discovery":
        return this.store.putArtifact({ ...base, kind: "evidence_package", title: "候选来源", data: this.store.runToolOnce({ key: `${task.id}:${node.id}:source.discover:v1`, toolId: "source.discover", taskId: task.id }, () => ({ candidates: [], activities: [{ status: "not_configured", note: "尚未连接来源发现 Tool；未生成虚构来源。" }] })).result });
      case "evidence_capture":
        return this.store.putArtifact({ ...base, kind: "evidence_package", title: "来源快照", data: this.store.runToolOnce({ key: `${task.id}:${node.id}:source.capture:v1`, toolId: "source.capture", taskId: task.id }, () => ({ captures: [], explicitNoAvailableSource: true })).result });
      case "evidence_evaluation": {
        const evidence = this.store.putArtifact({ ...base, kind: "evidence_package", title: "证据评估", data: { facts: [], qualifiedEvidenceCount: 0, sufficient: false, stopReason: "没有经 Source Capture 和 provenance verifier 核验的证据。" } });
        this.putSurface(task, node, "evidence_matrix", "证据矩阵", { rows: [], sufficient: false, gap: "需要连接来源工具或补充可核验材料" }, evidence.id);
        return evidence;
      }
      case "hypothesis":
        return this.store.putArtifact({ ...base, kind: "hypothesis_map", title: "假设与竞争解释", data: { hypotheses: [], status: "deferred_until_evidence" } });
      case "judgment": {
        const hasQualified = artifacts.some((artifact) => artifact.kind === "evidence_package" && typeof artifact.data === "object" && artifact.data && (artifact.data as { sufficient?: boolean }).sufficient === true);
        const judgment = this.store.putArtifact({ ...base, kind: "judgment", title: "当前判断", data: { disposition: hasQualified ? "review_required" : "abstain", confidence: hasQualified ? "medium" : "insufficient", statement: hasQualified ? "证据门槛已满足，等待模型与人工复核。" : "暂不可判断", changeConditions: ["获得经核验的一手来源", "关键事实完成交叉验证"] } });
        this.putSurface(task, node, "judgment_card", "当前判断", judgment.data as Record<string, unknown>, judgment.id);
        return judgment;
      }
      case "compose": {
        const judgment = [...artifacts].reverse().find((artifact) => artifact.kind === "judgment");
        if (task.intent === "compose_only" && !judgment) throw new Error("没有可复用的正式 Judgment；需要先选择历史制品。");
        const report = this.store.putArtifact({ ...base, kind: "report", title: "研究备忘录", data: { summary: judgment ? (judgment.data as { statement?: string }).statement : "当前仅有证据包，未形成判断。", claims: [], boundary: "未形成任何无来源支持的正式 Claim。" } });
        this.putSurface(task, node, "report_editor", "研究备忘录", report.data as Record<string, unknown>, report.id);
        return report;
      }
      case "audit": {
        const report = [...artifacts].reverse().find((artifact) => artifact.kind === "report");
        const result = report ? verifyReportClaims(report.data, report.sourceRefs) : { verifier: "claim-provenance", passed: false, errors: ["missing report"], warnings: [] };
        return this.store.putArtifact({ ...base, kind: "review", title: "确定性审计", data: { ...result, qualityEval: "not_run" } });
      }
      default:
        throw new Error(`No executor for constrained node kind: ${node.kind}`);
    }
  }

  private putSurface(task: Task, node: TaskNode, component: UiSurface["component"], title: string, data: Record<string, unknown>, artifactId?: string): Artifact {
    const surface: UiSurface = { id: randomUUID(), component, title, data, editableFields: [], artifactId };
    const verified = verifyUiSurface(surface);
    if (!verified.passed) throw new Error(verified.errors.join("; "));
    return this.store.putArtifact({ conversationId: task.conversationId, taskId: task.id, nodeId: node.id, kind: "ui_surface", title, status: "draft", data: surface, sourceRefs: [], createdBy: "research-lead" });
  }

  private publicPlan(plan: ResearchPlan, nodes: TaskNode[]): Record<string, unknown> {
    return { intent: plan.intent, rationale: plan.rationale, nodes: nodes.map((node) => ({ id: node.id, title: node.title, kind: node.kind, capability: `${node.capabilityType}:${node.capabilityId}`, dependsOn: node.dependsOn })), parallelGroups: plan.parallelGroups, stopConditions: plan.stopConditions, principle: "确定性负责边界，Agent 负责路径" };
  }

  private planSurface(plan: ResearchPlan, nodes: TaskNode[]): UiSurface {
    const surface: UiSurface = { id: randomUUID(), component: "research_plan", title: "研究计划", editableFields: ["nodes", "stopConditions"], data: this.publicPlan(plan, nodes) };
    const verified = verifyUiSurface(surface);
    if (!verified.passed) throw new Error(verified.errors.join("; "));
    return surface;
  }

  private requireTask(id: string): Task {
    const task = this.store.getTask(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    return task;
  }
}

export function requestFingerprint(provider: string, model: string, input: unknown): string {
  return createHash("sha256").update(JSON.stringify({ provider, model, input })).digest("hex");
}
