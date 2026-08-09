import type { Artifact, AssetRef, AssetRevision, Conversation, Task, TaskNode, TaskStatus } from "@/src/contracts";
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
  counts: { active: number; completed: number; needsAttention: number };
  signals: { available: false; items: []; reason: string };
}

const statusLabel: Record<TaskStatus, string> = {
  planned: "计划生成中",
  queued: "等待执行",
  running: "研究进行中",
  waiting_input: "等待补充信息",
  waiting_approval: "等待确认",
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

export function buildHomeView(store: RuntimeStore): HomeView {
  const research = store.listConversations().map((conversation) => {
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
    if (task.status === "waiting_input") return [{ id: task.id, kind: "input", conversationId: item.conversation.id, taskId: task.id, title: item.conversation.title, detail: "Research Lead 需要你补充研究边界或调整方向。", createdAt: task.updatedAt }];
    if (task.status === "failed") return [{ id: task.id, kind: "failure", conversationId: item.conversation.id, taskId: task.id, title: item.conversation.title, detail: "本轮研究执行失败，可以查看原因后恢复。", createdAt: task.updatedAt }];
    if (task.status === "cancelled") return [{ id: task.id, kind: "resume", conversationId: item.conversation.id, taskId: task.id, title: item.conversation.title, detail: "本轮已取消，可以创建研究分支继续。", createdAt: task.updatedAt }];
    return [];
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return {
    research,
    attention,
    counts: {
      active: research.filter((item) => item.latestTask && !["completed", "cancelled", "failed"].includes(item.latestTask.status)).length,
      completed: research.filter((item) => item.latestTask?.status === "completed").length,
      needsAttention: attention.length,
    },
    signals: { available: false, items: [], reason: "实时网页、PDF 与金融数据来源尚未接入；这里不会生成演示线索。" },
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
