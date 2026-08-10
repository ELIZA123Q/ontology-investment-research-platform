"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApprovalRequest, Artifact, Conversation, Message, RunEvent, Task, TaskNode, UiSurface } from "@/src/contracts";
import { apiRequest, formatRelativeTime, taskStatusLabel } from "@/app/components/client-api";
import { ArrowIcon, BranchIcon, CloseIcon, MenuIcon, PanelIcon, SparkIcon } from "@/app/components/icons";
import { AuditTimeline, isUiSurface, surfaceLabels, SurfaceRenderer } from "@/app/components/surface-registry";

interface Snapshot {
  conversation: Conversation | null;
  messages: Message[];
  task: Task | null;
  activeTaskId: string | null;
  tasks: Task[];
  nodes: TaskNode[];
  artifacts: Artifact[];
  approvals: ApprovalRequest[];
  events: RunEvent[];
}

const EMPTY: Snapshot = { conversation: null, messages: [], task: null, activeTaskId: null, tasks: [], nodes: [], artifacts: [], approvals: [], events: [] };

export function ResearchWorkspace({ conversationId }: { conversationId: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY);
  const [selectedTaskId, setSelectedTaskId] = useState<string>();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [dockOpen, setDockOpen] = useState(false);
  const [mobileView, setMobileView] = useState<"conversation" | "artifacts">("conversation");
  const [activeSurfaceId, setActiveSurfaceId] = useState<string>("audit");
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshSequence = useRef(0);
  const previousSurfaceCount = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const refresh = useCallback(async (taskId = selectedTaskId) => {
    const sequence = ++refreshSequence.current;
    const query = taskId ? `?taskId=${encodeURIComponent(taskId)}` : "";
    const next = await apiRequest<Snapshot>(`/vnext/conversations/${conversationId}/messages${query}`);
    if (sequence !== refreshSequence.current) return;
    setSnapshot(next);
    setSelectedTaskId(next.activeTaskId || undefined);
  }, [conversationId, selectedTaskId]);

  useEffect(() => { void refresh().catch((e) => setError(e instanceof Error ? e.message : String(e))); }, [refresh]);
  useEffect(() => {
    const stream = new EventSource(`/vnext/conversations/${conversationId}/events`);
    stream.onmessage = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => void refresh(), 140);
    };
    stream.onerror = () => { /* EventSource reconnects automatically. */ };
    return () => { stream.close(); if (refreshTimer.current) clearTimeout(refreshTimer.current); };
  }, [conversationId, refresh]);

  const surfaces = useMemo(() => snapshot.artifacts.filter((artifact) => artifact.kind === "ui_surface" && isUiSurface(artifact.data)).map((artifact) => artifact.data as UiSurface), [snapshot.artifacts]);
  const surfaceTabs = useMemo(() => {
    const latest = new Map<UiSurface["component"], UiSurface>();
    for (const surface of surfaces) latest.set(surface.component, surface);
    return [...latest.values()];
  }, [surfaces]);

  useEffect(() => {
    if (surfaces.length > previousSurfaceCount.current) {
      const newest = surfaces.at(-1);
      if (newest) { setActiveSurfaceId(newest.id); setDockOpen(true); }
    }
    previousSurfaceCount.current = surfaces.length;
  }, [surfaces]);

  useEffect(() => {
    if (activeSurfaceId !== "audit" && !surfaceTabs.some((surface) => surface.id === activeSurfaceId)) {
      setActiveSurfaceId(surfaceTabs.at(-1)?.id || "audit");
    }
  }, [activeSurfaceId, surfaceTabs]);

  const activeSurface = surfaceTabs.find((surface) => surface.id === activeSurfaceId);
  const completed = snapshot.nodes.filter((node) => node.status === "completed").length;
  const progress = snapshot.nodes.length ? Math.round(completed / snapshot.nodes.length * 100) : 0;

  async function submit() {
    const content = input.trim();
    if (!content || busy) return;
    setBusy(true); setError(""); setInput("");
    try {
      await apiRequest(`/vnext/conversations/${conversationId}/messages`, { method: "POST", body: JSON.stringify({ content }) });
      setSelectedTaskId(undefined);
      await refresh(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); setInput(content);
    } finally { setBusy(false); }
  }

  async function decide(approval: ApprovalRequest, decision: "approved" | "rejected") {
    if (busy || approval.status !== "pending") return;
    setBusy(true); setError("");
    try {
      await apiRequest(`/vnext/approvals/${approval.id}/decision`, { method: "POST", body: JSON.stringify({ decision, note: decision === "rejected" ? "研究员要求调整计划" : undefined }) });
      if (decision === "rejected") {
        setInput(`请调整研究计划。保留原目标，但重新考虑：`);
        requestAnimationFrame(() => textareaRef.current?.focus());
      }
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function editArtifact(artifactId: string, expectedVersion: number, changes: Record<string, unknown>) {
    setBusy(true); setError("");
    try {
      await apiRequest(`/vnext/artifacts/${artifactId}`, { method: "PATCH", body: JSON.stringify({ expectedVersion, changes }) });
      await refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function taskAction(action: "resume" | "cancel" | "branch") {
    if (!snapshot.task || busy) return;
    setBusy(true); setError("");
    try {
      const body = action === "branch" ? JSON.stringify({ goal: input.trim() || snapshot.task.goal }) : "{}";
      await apiRequest(`/vnext/tasks/${snapshot.task.id}/${action}`, { method: "POST", body });
      setInput(""); setSelectedTaskId(undefined); await refresh(undefined);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  function selectTask(taskId: string) {
    setSelectedTaskId(taskId); setHistoryOpen(false); void refresh(taskId);
  }

  const canCancel = snapshot.task && ["queued", "running", "waiting_approval", "waiting_input"].includes(snapshot.task.status);
  const canResume = snapshot.task && ["failed", "waiting_input"].includes(snapshot.task.status);
  const canBranch = snapshot.task && ["completed", "cancelled", "failed"].includes(snapshot.task.status);

  return <main className={`workspace-page ${dockOpen ? "dock-open" : ""}`} id="main-content">
    <header className="workspace-header">
      <div className="workspace-title">
        <button className="icon-button" onClick={() => setHistoryOpen(true)} aria-label="打开研究历史"><MenuIcon /></button>
        <div><span>{snapshot.task ? taskStatusLabel[snapshot.task.status] : "研究主题"}</span><h1>{snapshot.task?.goal || snapshot.conversation?.title || "正在打开研究"}</h1></div>
      </div>
      <div className="workspace-progress"><span><i style={{ width: `${progress}%` }}/></span><small>{completed}/{snapshot.nodes.length} 个节点</small></div>
      <div className="workspace-actions">
        {canCancel && <button disabled={busy} onClick={() => void taskAction("cancel")}>取消本轮</button>}
        {canResume && <button disabled={busy} onClick={() => void taskAction("resume")}>恢复研究</button>}
        {canBranch && <button disabled={busy} onClick={() => void taskAction("branch")}><BranchIcon />创建分支</button>}
        <button className={dockOpen ? "icon-button active" : "icon-button"} onClick={() => setDockOpen((value) => !value)} aria-label={dockOpen ? "收起制品" : "打开制品"}><PanelIcon /></button>
      </div>
    </header>

    <section className={`conversation-column ${mobileView === "conversation" ? "mobile-active" : ""}`}>
      <div className="conversation-scroll">
        {!snapshot.messages.length && <div className="conversation-welcome"><span><SparkIcon /></span><h2>继续告诉我你想判断什么</h2><p>目标、范围和希望支持的决策，是 Research Lead 最需要的上下文。</p></div>}
        {snapshot.messages.map((message) => <article className={`chat-message ${message.actorType}`} key={message.id}>
          <div className="message-avatar">{message.actorType === "researcher" ? "你" : "AI"}</div>
          <div><header><strong>{message.actorType === "researcher" ? "你" : "Research Lead"}</strong><time>{formatRelativeTime(message.createdAt)}</time></header><p>{message.content}</p></div>
        </article>)}
        {snapshot.task && <article className={`run-state-card ${snapshot.task.status}`}><span className="run-pulse"/><div><strong>{taskStatusLabel[snapshot.task.status]}</strong><p>{snapshot.task.status === "running" ? "Research Lead 正在沿已确认计划执行；新制品会自动进入右侧工作区。" : snapshot.task.status === "completed" ? "本轮已经结束。判断可能仍是“暂不可判断”，请以制品中的证据边界为准。" : snapshot.task.status === "failed" ? "执行没有完成。可在查看审计信息后恢复本轮。" : "当前状态变化会通过实时事件同步。"}</p></div><button onClick={() => { setActiveSurfaceId("audit"); setDockOpen(true); }}>查看过程</button></article>}
        {snapshot.approvals.map((approval) => {
          const judgmentReviewed = approval.kind !== "judgment_confirmation" || snapshot.artifacts.some((artifact) => artifact.kind === "judgment" && artifact.nodeId === approval.nodeId && artifact.createdBy === "researcher");
          const publicationReady = approval.kind !== "publish_confirmation" || snapshot.artifacts.some((artifact) => artifact.kind === "report" && (artifact.data as { publication?: { status?: string } }).publication?.status === "verified_not_published");
          const approvalReady = judgmentReviewed && publicationReady;
          return <article className="approval-card" key={approval.id}>
            <div className="approval-kicker">{approval.kind === "publish_confirmation" ? "正式发布门" : "需要你的判断"}</div><h3>{approval.prompt}</h3><p>{approval.kind === "plan_confirmation" ? "计划只包含受约束节点；确认后交给独立 Worker 执行。" : approval.kind === "judgment_confirmation" && !judgmentReviewed ? "先打开右侧判断卡，完成结构化复核并保存新版本；占位提案不能成为正式 Claim。" : approval.kind === "publish_confirmation" ? "请先在右侧报告中核对正文、专业纪律诊断和正式评测边界。只有你的明确确认能把已核验制品发布。" : "请先在右侧核对或修改对应制品。确认后才会继续生成下游结果。"}</p>
            <div><button disabled={busy} onClick={() => void decide(approval, "rejected")}>{approval.kind === "plan_confirmation" ? "调整计划" : approval.kind === "publish_confirmation" ? "暂不发布" : "退回修改"}</button><button className="primary-button" disabled={busy || !approvalReady} onClick={() => void decide(approval, "approved")}>{approval.kind === "plan_confirmation" ? "确认开始" : approval.kind === "publish_confirmation" ? "确认发布" : !judgmentReviewed ? "先编辑判断" : "确认并继续"}<ArrowIcon /></button></div>
          </article>;
        })}
      </div>
      <div className="workspace-composer">
        {error && <p className="inline-error" role="alert">{error}</p>}
        <textarea ref={textareaRef} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); } }} placeholder={snapshot.task?.status === "waiting_input" ? "补充研究对象、时间范围或希望支持的决策…" : "继续提问，或调整范围、补证据、更新判断…"} aria-label="给 Research Lead 发送消息" />
        <div><span>Enter 发送 · Shift+Enter 换行</span><button className="send-button" disabled={!input.trim() || busy} onClick={() => void submit()} aria-label="发送消息"><ArrowIcon /></button></div>
      </div>
    </section>

    <aside className={`artifact-dock ${mobileView === "artifacts" ? "mobile-active" : ""}`} aria-label="研究制品">
      <header><div><span>研究制品</span><strong>{activeSurface ? activeSurface.title : "运行审计"}</strong></div><button className="icon-button" onClick={() => setDockOpen(false)} aria-label="收起制品"><CloseIcon /></button></header>
      <nav className="artifact-tabs" aria-label="制品类型">{surfaceTabs.map((surface) => <button className={activeSurfaceId === surface.id ? "active" : ""} key={surface.id} onClick={() => setActiveSurfaceId(surface.id)}>{surfaceLabels[surface.component]}</button>)}<button className={activeSurfaceId === "audit" ? "active" : ""} onClick={() => setActiveSurfaceId("audit")}>审计</button></nav>
      <div className="artifact-scroll">{activeSurface ? <SurfaceRenderer surface={activeSurface} nodes={snapshot.nodes} artifacts={snapshot.artifacts} events={snapshot.events} onArtifactEdit={editArtifact} /> : <AuditTimeline events={snapshot.events} />}</div>
    </aside>

    {historyOpen && <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setHistoryOpen(false); }}><aside className="history-drawer">
      <header><div><span>研究历史</span><h2>{snapshot.conversation?.title}</h2></div><button className="icon-button" onClick={() => setHistoryOpen(false)}><CloseIcon /></button></header>
      <Link className="new-research-link" href="/">＋ 发起新研究</Link>
      <div className="task-history">{snapshot.tasks.map((task) => <button className={task.id === snapshot.activeTaskId ? "active" : ""} key={task.id} onClick={() => selectTask(task.id)}><span className={`status-dot ${task.status}`}/><div><strong>{task.goal}</strong><small>{taskStatusLabel[task.status]} · {new Date(task.createdAt).toLocaleString("zh-CN")}</small>{task.parentTaskId && <i>研究分支</i>}</div></button>)}</div>
    </aside></div>}

    <nav className="mobile-workspace-nav"><button className={mobileView === "conversation" ? "active" : ""} onClick={() => setMobileView("conversation")}>协作</button><button className={mobileView === "artifacts" ? "active" : ""} onClick={() => { setMobileView("artifacts"); setDockOpen(true); }}>制品{surfaceTabs.length ? ` ${surfaceTabs.length}` : ""}</button></nav>
  </main>;
}
