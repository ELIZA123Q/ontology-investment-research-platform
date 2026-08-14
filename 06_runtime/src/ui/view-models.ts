import type { Artifact, AssetRef, AssetRevision, Conversation, ResearchSignalCandidate, ResearchTrackingProfile, SignalRefreshRun, Task, TaskNode, TaskStatus } from "@/src/contracts";
import type { RuntimeStore } from "@/src/runtime/store";

export interface HomeResearchItem {
  conversation: Conversation;
  latestTask: Task | null;
  progress: { completed: number; total: number };
  resultSummary?: string;
  pendingApprovalCount: number;
}

export interface HomeAttentionItem {
  id: string;
  kind: "approval" | "input" | "failure" | "resume";
  conversationId: string;
  taskId: string;
  title: string;
  detail: string;
  createdAt: string;
}

export interface HomeView {
  research: HomeResearchItem[];
  attention: HomeAttentionItem[];
  actions: { items: Array<HomeAttentionItem & { approvalId?: string }> };
  tracking: ResearchTrackingProfile[];
  signalFeed: ResearchSignalCandidate[];
  signalRefresh: SignalRefreshRun | null;
  counts: { active: number; completed: number; needsAttention: number };
  signals: {
    available: boolean;
    items: Array<{ id: string; conversationId: string; title: string; detail: string; asOf: string }>;
    reason: string;
  };
  connections: {
    configured: boolean;
    allowedConnectorIds: string[];
    observedConnectorIds: string[];
    sourceCaptureCount: number;
    financialBatchCount: number;
    lastIngestedAt?: string;
    akshare: { configured: boolean; status: "ready" | "degraded" | "unavailable"; lastRefreshAt?: string; detail: string };
  };
}

const statusLabel: Record<TaskStatus, string> = {
  planned: "计划生成中",
  queued: "等待执行",
  running: "研究进行中",
  paused: "已暂停",
  waiting_input: "等待补充信息",
  waiting_approval: "等待确认",
  waiting_handoff: "等待协作",
  completed: "研究已完成",
  failed: "执行失败",
  cancelled: "已取消",
};

function latestResult(artifacts: Artifact[]): string | undefined {
  const judgment = [...artifacts].reverse().find((item) => item.kind === "judgment");
  const report = [...artifacts].reverse().find((item) => item.kind === "report");
  const judgmentText = judgment && typeof judgment.data === "object" && judgment.data ? (judgment.data as { statement?: unknown }).statement : undefined;
  const reportText = report && typeof report.data === "object" && report.data ? (report.data as { summary?: unknown }).summary : undefined;
  const value = judgmentText || reportText;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function progress(nodes: TaskNode[]): { completed: number; total: number } {
  return { completed: nodes.filter((node) => node.status === "completed").length, total: nodes.length };
}

export function buildHomeView(store: RuntimeStore, scope?: { tenantId: string; userId: string; roles: string[] }): HomeView {
  const conversations = store.listConversations().filter((conversation) => !scope || (conversation.tenantId === scope.tenantId && (conversation.userId === scope.userId || scope.roles.includes("tenant_admin"))));
  const accessibleConversationIds = new Set(conversations.map((conversation) => conversation.id));
  const research = conversations.map((conversation) => {
    const latestTask = store.getLatestTask(conversation.id);
    const nodes = latestTask ? store.listTaskNodes(latestTask.id) : [];
    const artifacts = latestTask ? store.listArtifacts(latestTask.id) : [];
    return {
      conversation,
      latestTask,
      progress: progress(nodes),
      resultSummary: latestResult(artifacts),
      pendingApprovalCount: store.listPendingApprovals(conversation.id).length,
    };
  });

  const attention = research.flatMap<HomeAttentionItem>((item) => {
    const task = item.latestTask;
    if (!task) return [];
    const approvals = store.listPendingApprovals(item.conversation.id).map((approval) => ({
      id: approval.id,
      kind: "approval" as const,
      conversationId: item.conversation.id,
      taskId: task.id,
      title: item.conversation.title,
      detail: approval.prompt,
      createdAt: approval.createdAt,
    }));
    if (approvals.length) return approvals;
    if (task.status === "waiting_approval") return [{ id: `integrity:${task.id}`, kind: "failure", conversationId: item.conversation.id, taskId: task.id, title: item.conversation.title, detail: "这项研究停在确认阶段，但缺少可处理的确认请求。请重新发起 Goal，或检查执行状态。", createdAt: task.updatedAt }];
    if (task.status === "waiting_input") return [{ id: task.id, kind: "input", conversationId: item.conversation.id, taskId: task.id, title: item.conversation.title, detail: "Research Lead 需要你补充研究边界或调整方向。", createdAt: task.updatedAt }];
    if (task.status === "failed") return [{ id: task.id, kind: "failure", conversationId: item.conversation.id, taskId: task.id, title: item.conversation.title, detail: "本轮研究执行失败，可以查看原因后恢复。", createdAt: task.updatedAt }];
    if (task.status === "cancelled") return [{ id: task.id, kind: "resume", conversationId: item.conversation.id, taskId: task.id, title: item.conversation.title, detail: "本轮已取消，可以创建研究分支继续。", createdAt: task.updatedAt }];
    return [];
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const financialInputs = research.flatMap((item) => {
    if (!item.latestTask) return [];
    return store.listArtifacts(item.latestTask.id).filter((artifact) => artifact.kind === "evidence_package" && artifact.title === "结构化金融数据").flatMap((artifact) => {
      const data = artifact.data as { entity?: { name?: string }; asOf?: string; facts?: Array<{ id?: string; statement?: string; metric?: { name?: string; basis?: string } }> };
      return (data.facts || []).flatMap((fact) => fact.id && fact.statement ? [{
        id: fact.id, conversationId: item.conversation.id, title: `${data.entity?.name || "金融数据"} · ${fact.metric?.name || "指标"}`,
        detail: fact.statement, asOf: data.asOf || artifact.createdAt,
      }] : []);
    });
  }).sort((left, right) => right.asOf.localeCompare(left.asOf)).slice(0, 5);
  const connectorEvents = research.flatMap((item) => store.listEvents(item.conversation.id).filter((event) => event.type === "connector.source_ingested" || event.type === "financial.data_ingested"));
  const allowedConnectorIds = (process.env.VNEXT_CONNECTOR_IDS || "").split(",").map((item) => item.trim()).filter(Boolean);
  const configured = Boolean(process.env.VNEXT_CONNECTOR_INGEST_TOKEN?.trim() && allowedConnectorIds.length);
  const observedConnectorIds = [...new Set(connectorEvents.map((event) => event.actorId))].sort();
  const lastIngestedAt = connectorEvents.map((event) => event.createdAt).sort().at(-1);
  const tracking = conversations.map((conversation) => store.getTrackingProfile(conversation.id)).filter((profile) => profile.enabled);
  const signalFeed = store.listSignalCandidates({ status: "new", limit: 100 }).filter((candidate) => accessibleConversationIds.has(candidate.conversationId)).slice(0, 30);
  const signalRefresh = scope ? null : store.latestSignalRefreshRun();
  const akshareConfigured = Boolean(process.env.VNEXT_AKSHARE_URL?.trim());
  const akshareStatus = signalRefresh?.status === "failed" ? "degraded" : akshareConfigured ? "ready" : "unavailable";

  return {
    research,
    attention,
    actions: { items: attention.map((item) => ({ ...item, approvalId: item.kind === "approval" ? item.id : undefined })) },
    tracking,
    signalFeed,
    signalRefresh,
    counts: {
      active: research.filter((item) => item.latestTask && !["completed", "cancelled", "failed"].includes(item.latestTask.status)).length,
      completed: research.filter((item) => item.latestTask?.status === "completed").length,
      needsAttention: attention.length,
    },
    signals: financialInputs.length
      ? { available: true, items: financialInputs, reason: "以下是已通过时间、单位和来源校验的金融事实候选；进入判断前仍需研究员确认其 Signal 作用。" }
      : { available: false, items: [], reason: configured ? "连接器摄取入口已启用，但尚未返回通过校验的金融观测；这里不会生成演示线索。" : "本地治理材料可用；实时网页、PDF 与金融数据连接器尚未配置，这里不会生成演示线索。" },
    connections: {
      configured, allowedConnectorIds, observedConnectorIds,
      sourceCaptureCount: connectorEvents.filter((event) => event.type === "connector.source_ingested").length,
      financialBatchCount: connectorEvents.filter((event) => event.type === "financial.data_ingested").length,
      lastIngestedAt,
      akshare: {
        configured: akshareConfigured,
        status: akshareStatus,
        lastRefreshAt: signalRefresh?.completedAt,
        detail: signalRefresh?.error || (akshareConfigured ? "AKShare 公开新闻与公告连接器已配置" : "AKShare 连接器未启动"),
      },
    },
  };
}

export interface LibraryItem {
  ref: AssetRef;
  revision: AssetRevision;
  title: string;
  summary: string;
}

export interface LibraryView {
  releaseId: string | null;
  releaseFingerprint: string | null;
  items: LibraryItem[];
}

const textFrom = (content: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = content[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
};

export function buildPublicLibraryView(store: RuntimeStore): LibraryView {
  const release = store.getCurrentRelease({ kind: "global" });
  if (!release) return { releaseId: null, releaseFingerprint: null, items: [] };
  const items = release.assetRefs.flatMap<LibraryItem>((ref) => {
    const persisted = store.getAssetRevisionByRef(ref);
    const revision: AssetRevision | null = persisted || (ref.authorityRef ? {
      id: `release-member:${release.id}:${ref.assetId}`,
      assetId: ref.assetId,
      kind: ref.kind,
      scope: ref.scope,
      version: ref.version,
      status: "released",
      content: { title: ref.identityKey || ref.assetId, description: "仓库权威资产；研究任务会锁定此版本并记录选择原因。" },
      contentRef: ref.authorityRef,
      fingerprint: ref.fingerprint,
      provenanceRefs: [ref.authorityRef],
      supersedes: [],
      createdAt: release.createdAt,
    } : null);
    if (!revision || revision.status !== "released" || revision.scope.kind !== "global") return [];
    const title = textFrom(revision.content, ["title", "name", "label", "identityKey"]) || ref.identityKey || `${ref.kind} · v${ref.version}`;
    const summary = textFrom(revision.content, ["summary", "description", "definition", "content", "statement"]);
    return [{ ref, revision, title, summary }];
  });
  return { releaseId: release.id, releaseFingerprint: release.fingerprint, items };
}
