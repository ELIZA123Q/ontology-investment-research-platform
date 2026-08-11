"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApprovalRequest, Artifact, Conversation, Message, RunEvent, Task, TaskNode, UiSurface } from "@/src/contracts";
import { apiRequest, formatRelativeTime, taskStatusLabel, taskStatusText } from "@/app/components/client-api";
import { ArrowIcon, BranchIcon, CloseIcon, MaterialIcon, MenuIcon, PanelIcon, SparkIcon } from "@/app/components/icons";
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

interface MaterialDraft {
  uri: string;
  title: string;
  publisherId: string;
  publishedAt: string;
  sourceType: "primary" | "secondary";
  locator: string;
  quote: string;
  context: string;
  permissionConfirmed: boolean;
}

const EMPTY: Snapshot = { conversation: null, messages: [], task: null, activeTaskId: null, tasks: [], nodes: [], artifacts: [], approvals: [], events: [] };
const EMPTY_MATERIAL: MaterialDraft = { uri: "", title: "", publisherId: "", publishedAt: "", sourceType: "primary", locator: "", quote: "", context: "", permissionConfirmed: false };

export function ResearchWorkspace({ conversationId }: { conversationId: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY);
  const [selectedTaskId, setSelectedTaskId] = useState<string>();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [materialOpen, setMaterialOpen] = useState(false);
  const [materialDraft, setMaterialDraft] = useState<MaterialDraft>(EMPTY_MATERIAL);
  const [materialBusy, setMaterialBusy] = useState(false);
  const [materialError, setMaterialError] = useState("");
  const [materialSuccess, setMaterialSuccess] = useState("");
  const [dockOpen, setDockOpen] = useState(false);
  const [mobileView, setMobileView] = useState<"conversation" | "artifacts">("conversation");
  const [activeSurfaceId, setActiveSurfaceId] = useState<string>("audit");
  const [composerContext, setComposerContext] = useState("");
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
  const researchPulse = useMemo(() => {
    const judgments = snapshot.artifacts.filter((artifact) => artifact.kind === "judgment");
    const judgment = judgments.at(-1);
    const previousJudgment = judgments.at(-2);
    const evidence = [...snapshot.artifacts].reverse().find((artifact) => artifact.kind === "evidence_package" && artifact.title === "证据评估") || [...snapshot.artifacts].reverse().find((artifact) => artifact.kind === "evidence_package");
    const judgmentData = judgment?.data as { statement?: string; disposition?: string } | undefined;
    const evidenceData = evidence?.data as { facts?: unknown[]; stopReason?: string; nextGap?: string; sufficient?: boolean } | undefined;
    const approval = snapshot.approvals[0];
    const nextAction = approval?.prompt || (snapshot.task?.status === "running" ? "等待新制品，可随时创建后续分支" : snapshot.task?.status === "completed" ? "复核判断或从新变化创建更新分支" : "继续补充研究边界");
    const asOf = [...snapshot.artifacts].map((artifact) => artifact.createdAt).sort().at(-1);
    return {
      judgment: judgmentData?.statement || (judgmentData?.disposition === "abstain" ? "暂不可判断" : "尚未形成正式判断"),
      previousJudgment: (previousJudgment?.data as { statement?: string } | undefined)?.statement,
      factCount: evidenceData?.facts?.length || 0,
      gap: evidenceData?.stopReason || evidenceData?.nextGap || (evidenceData?.sufficient ? "核心证据门槛已满足" : "等待定位下一项证据缺口"),
      nextAction,
      asOf,
    };
  }, [snapshot.approvals, snapshot.artifacts, snapshot.task?.status]);

  async function submit(contentOverride?: string) {
    const content = contentOverride?.trim() || `${composerContext ? `[参考制品：${composerContext}] ` : ""}${input.trim()}`;
    if (!content || busy) return;
    setBusy(true); setError(""); setInput(""); setComposerContext("");
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

  async function submitMaterial(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!snapshot.task || materialBusy) return;
    setMaterialBusy(true); setMaterialError(""); setMaterialSuccess("");
    try {
      await apiRequest(`/vnext/tasks/${snapshot.task.id}/materials`, { method: "POST", body: JSON.stringify(materialDraft) });
      setMaterialSuccess("材料快照已保存，并已进入证据复核或局部重算队列。");
      setMaterialDraft(EMPTY_MATERIAL);
      await refresh();
    } catch (e) {
      setMaterialError(e instanceof Error ? e.message : String(e));
    } finally { setMaterialBusy(false); }
  }

  function openMaterialDrawer() {
    setMaterialError(""); setMaterialSuccess(""); setMaterialOpen(true);
  }

  function selectTask(taskId: string) {
    setSelectedTaskId(taskId); setHistoryOpen(false); void refresh(taskId);
  }

  function prepareInstruction(content: string) {
    setInput(content);
    setMobileView("conversation");
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function openEvidenceBoundary() {
    const evidenceSurface = [...surfaceTabs].reverse().find((surface) => surface.component === "evidence_matrix");
    setActiveSurfaceId(evidenceSurface?.id || "audit");
    setDockOpen(true);
    setMobileView("artifacts");
  }

  const canCancel = snapshot.task && ["queued", "running", "waiting_approval", "waiting_input"].includes(snapshot.task.status);
  const canResume = snapshot.task && ["failed", "waiting_input"].includes(snapshot.task.status);
  const canBranch = snapshot.task && ["completed", "cancelled", "failed"].includes(snapshot.task.status);
  const canAddMaterial = snapshot.task && ["planned", "waiting_input", "waiting_approval", "failed"].includes(snapshot.task.status);

  return <main className={`workspace-page ${dockOpen ? "dock-open" : ""}`} id="main-content">
    <header className="workspace-header">
      <div className="workspace-title">
        <button className="icon-button" onClick={() => setHistoryOpen(true)} aria-label="打开研究历史"><MenuIcon /></button>
        <div><span>{snapshot.task ? taskStatusText(snapshot.task) : "研究主题"}</span><h1>{snapshot.task?.goal || snapshot.conversation?.title || "正在打开研究"}</h1></div>
      </div>
      <div className="workspace-progress"><span><i style={{ width: `${progress}%` }}/></span><small>{completed}/{snapshot.nodes.length} 个节点</small></div>
      <div className="workspace-actions">
        {canAddMaterial && <button className="material-action" disabled={materialBusy} onClick={openMaterialDrawer}><MaterialIcon />补充材料</button>}
        {canCancel && <button disabled={busy} onClick={() => void taskAction("cancel")}>取消本轮</button>}
        {canResume && <button disabled={busy} onClick={() => void taskAction("resume")}>恢复研究</button>}
        {canBranch && <button disabled={busy} onClick={() => void taskAction("branch")}><BranchIcon />创建分支</button>}
        <button className={dockOpen ? "icon-button active" : "icon-button"} onClick={() => setDockOpen((value) => !value)} aria-label={dockOpen ? "收起制品" : "打开制品"}><PanelIcon /></button>
      </div>
    </header>

    <section className="workspace-pulse" aria-label="研究脉冲">
      <article><span>当前判断</span><strong>{researchPulse.judgment}</strong></article>
      <article><span>已核验事实</span><strong>{researchPulse.factCount} 条</strong></article>
      <article><span>首要缺口</span><strong>{researchPulse.gap}</strong></article>
      <article><span>下一步</span><strong>{researchPulse.nextAction}</strong></article>
      <time>{researchPulse.asOf ? `数据截止 ${new Date(researchPulse.asOf).toLocaleString("zh-CN")}` : "等待研究制品"}</time>
    </section>

    <section className={`conversation-column ${mobileView === "conversation" ? "mobile-active" : ""}`}>
      <div className="conversation-scroll">
        {!snapshot.messages.length && <div className="conversation-welcome"><span><SparkIcon /></span><h2>继续告诉我你想判断什么</h2><p>目标、范围和希望支持的决策，是 Research Lead 最需要的上下文。</p></div>}
        {snapshot.messages.map((message) => <article className={`chat-message ${message.actorType}`} key={message.id}>
          <div className="message-avatar">{message.actorType === "researcher" ? "你" : "AI"}</div>
          <div><header><strong>{message.actorType === "researcher" ? "你" : "Research Lead"}</strong><time>{formatRelativeTime(message.createdAt)}</time></header><p>{message.content}</p></div>
        </article>)}
        {snapshot.task && <article className={`run-state-card ${snapshot.task.status} ${snapshot.task.outcome || ""}`}><span className="run-pulse"/><div><strong>{taskStatusText(snapshot.task)}</strong><p>{snapshot.task.status === "running" ? "Research Lead 正在沿已确认计划执行；新制品会自动进入右侧工作区。" : snapshot.task.outcome === "stopped_insufficient_evidence" ? "本轮已按证据门停止，没有把缺口包装成判断；可查看证据边界或创建补证分支。" : snapshot.task.outcome === "completed_with_judgment" ? "本轮已形成经研究员复核的正式判断；请继续关注改判条件。" : snapshot.task.status === "failed" ? "执行没有完成。可在查看审计信息后恢复本轮。" : "当前状态变化会通过实时事件同步。"}</p></div><button onClick={() => { setActiveSurfaceId("audit"); setDockOpen(true); }}>查看过程</button></article>}
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
        <div className="composer-shortcuts" aria-label="快捷研究指令">
          <button disabled={busy} onClick={() => void submit(`只补充并核验当前首要证据缺口：${researchPulse.gap}。优先一手来源；若仍不足，请明确停止原因与下一项可操作缺口。`)}>一键补当前缺口</button>
          <button onClick={openEvidenceBoundary}>查看证据为何不足</button>
          <button onClick={() => prepareInstruction(researchPulse.previousJudgment
            ? `比较当前判断“${researchPulse.judgment}”与上一版本“${researchPulse.previousJudgment}”：逐项列出新增/失效证据、措辞变化、置信度变化和改判条件。`
            : "比较本次判断与上一研究分支或上一可用版本：逐项列出新增/失效证据、措辞变化、置信度变化和改判条件。")}>比较上一版本判断</button>
          <button onClick={() => prepareInstruction("比较主假设与竞争解释：")}>比较解释</button>
          <button onClick={() => prepareInstruction("根据新材料更新判断：")}>更新判断</button>
          <button onClick={() => prepareInstruction("整理为研究简报：")}>整理简报</button>
        </div>
        {composerContext && <div className="composer-context"><span>已带入：{composerContext}</span><button onClick={() => setComposerContext("")}>移除</button></div>}
        <textarea ref={textareaRef} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); } }} placeholder={snapshot.task?.status === "waiting_input" ? "补充研究对象、时间范围或希望支持的决策…" : "继续提问，或调整范围、补证据、更新判断…"} aria-label="给 Research Lead 发送消息" />
        <div><span>Enter 发送 · Shift+Enter 换行</span><button className="send-button" disabled={!input.trim() || busy} onClick={() => void submit()} aria-label="发送消息"><ArrowIcon /></button></div>
      </div>
    </section>

    <aside className={`artifact-dock ${mobileView === "artifacts" ? "mobile-active" : ""}`} aria-label="研究制品">
      <header><div><span>研究制品</span><strong>{activeSurface ? activeSurface.title : "运行审计"}</strong></div><div className="artifact-header-actions">{activeSurface && <button onClick={() => { setComposerContext(`${activeSurface.title} · ${surfaceLabels[activeSurface.component]}`); setMobileView("conversation"); requestAnimationFrame(() => textareaRef.current?.focus()); }}>带入对话</button>}<button className="icon-button" onClick={() => setDockOpen(false)} aria-label="收起制品"><CloseIcon /></button></div></header>
      <nav className="artifact-tabs" aria-label="制品类型">{surfaceTabs.map((surface) => <button className={activeSurfaceId === surface.id ? "active" : ""} key={surface.id} onClick={() => setActiveSurfaceId(surface.id)}>{surfaceLabels[surface.component]}</button>)}<button className={activeSurfaceId === "audit" ? "active" : ""} onClick={() => setActiveSurfaceId("audit")}>审计</button></nav>
      <div className="artifact-scroll">{activeSurface ? <SurfaceRenderer surface={activeSurface} nodes={snapshot.nodes} artifacts={snapshot.artifacts} events={snapshot.events} onArtifactEdit={editArtifact} /> : <AuditTimeline events={snapshot.events} />}</div>
    </aside>

    {historyOpen && <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setHistoryOpen(false); }}><aside className="history-drawer">
      <header><div><span>研究历史</span><h2>{snapshot.conversation?.title}</h2></div><button className="icon-button" onClick={() => setHistoryOpen(false)}><CloseIcon /></button></header>
      <Link className="new-research-link" href="/">＋ 发起新研究</Link>
      <div className="task-history">{snapshot.tasks.map((task) => <button className={task.id === snapshot.activeTaskId ? "active" : ""} key={task.id} onClick={() => selectTask(task.id)}><span className={`status-dot ${task.status} ${task.outcome || ""}`}/><div><strong>{task.goal}</strong><small>{taskStatusText(task)} · {new Date(task.createdAt).toLocaleString("zh-CN")}</small>{task.parentTaskId && <i>研究分支</i>}</div></button>)}</div>
    </aside></div>}

    {materialOpen && <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setMaterialOpen(false); }}><aside className="material-drawer">
      <header><div><span>结构化材料摄取</span><h2>补充可定位的研究材料</h2></div><button className="icon-button" onClick={() => setMaterialOpen(false)} aria-label="关闭材料面板"><CloseIcon /></button></header>
      <p className="material-boundary">这里保存来源地址、发布主体、定位和原文摘录。提交只证明快照与摘录完整，不代表事实已经成立；材料仍需经过证据矩阵和研究员确认。</p>
      <form className="material-form" onSubmit={(event) => void submitMaterial(event)}>
        <label>来源地址<input type="url" required value={materialDraft.uri} onChange={(event) => setMaterialDraft((value) => ({ ...value, uri: event.target.value }))} placeholder="https://company.example/report.pdf" /></label>
        <label>材料标题<input required maxLength={300} value={materialDraft.title} onChange={(event) => setMaterialDraft((value) => ({ ...value, title: event.target.value }))} placeholder="2026 年半年度报告" /></label>
        <div className="material-form-grid">
          <label>发布主体<input maxLength={200} value={materialDraft.publisherId} onChange={(event) => setMaterialDraft((value) => ({ ...value, publisherId: event.target.value }))} placeholder="留空则使用来源域名" /></label>
          <label>发布日期<input type="date" value={materialDraft.publishedAt} onChange={(event) => setMaterialDraft((value) => ({ ...value, publishedAt: event.target.value }))} /></label>
        </div>
        <label>来源性质<select value={materialDraft.sourceType} onChange={(event) => setMaterialDraft((value) => ({ ...value, sourceType: event.target.value as MaterialDraft["sourceType"] }))}><option value="primary">一手来源</option><option value="secondary">二手来源</option></select></label>
        <label>原文定位<input required maxLength={1000} value={materialDraft.locator} onChange={(event) => setMaterialDraft((value) => ({ ...value, locator: event.target.value }))} placeholder="第 23 页，经营情况讨论；或表 4 第 2 行" /></label>
        <label>关键原文摘录<textarea required maxLength={20000} value={materialDraft.quote} onChange={(event) => setMaterialDraft((value) => ({ ...value, quote: event.target.value }))} placeholder="粘贴能够直接支持或反驳判断的原文，不要写自己的总结。" /></label>
        <label>包含摘录的上下文（可选）<textarea maxLength={200000} value={materialDraft.context} onChange={(event) => setMaterialDraft((value) => ({ ...value, context: event.target.value }))} placeholder="可粘贴更完整的段落；其中必须原样包含上面的关键摘录。" /></label>
        <label className="material-confirm"><input type="checkbox" checked={materialDraft.permissionConfirmed} onChange={(event) => setMaterialDraft((value) => ({ ...value, permissionConfirmed: event.target.checked }))} /><span>我已核对摘录与原文一致，并确认该材料可用于本次研究。</span></label>
        {materialError && <p className="inline-error" role="alert">{materialError}</p>}
        {materialSuccess && <p className="material-success" role="status">{materialSuccess}</p>}
        <footer><button type="button" onClick={() => setMaterialOpen(false)}>取消</button><button className="primary-button" disabled={materialBusy || !materialDraft.permissionConfirmed} type="submit">{materialBusy ? "正在保存" : "保存并进入证据复核"}<ArrowIcon /></button></footer>
      </form>
    </aside></div>}

    <nav className="mobile-workspace-nav"><button className={mobileView === "conversation" ? "active" : ""} onClick={() => setMobileView("conversation")}>协作</button><button className={mobileView === "artifacts" ? "active" : ""} onClick={() => { setMobileView("artifacts"); setDockOpen(true); }}>制品{surfaceTabs.length ? ` ${surfaceTabs.length}` : ""}</button></nav>
  </main>;
}
