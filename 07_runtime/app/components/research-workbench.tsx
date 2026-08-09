"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApprovalRequest, Artifact, Conversation, Message, RunEvent, Task, TaskNode, UiSurface } from "@/src/contracts";

type Snapshot = { conversation: Conversation | null; messages: Message[]; task: Task | null; nodes: TaskNode[]; artifacts: Artifact[]; approvals: ApprovalRequest[]; events: RunEvent[] };
const EMPTY: Snapshot = { conversation: null, messages: [], task: null, nodes: [], artifacts: [], approvals: [], events: [] };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers || {}) } });
  if (!response.ok) throw new Error((await response.json().catch(() => ({})) as { error?: string }).error || `请求失败：${response.status}`);
  return response.json() as Promise<T>;
}

export function ResearchWorkbench() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentId, setCurrentId] = useState<string>();
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async (id = currentId) => {
    if (!id) return;
    const next = await request<Snapshot>(`/vnext/conversations/${id}/messages`);
    setSnapshot(next);
  }, [currentId]);

  const loadConversations = useCallback(async () => {
    let items = await request<Conversation[]>("/vnext/conversations");
    if (!items.length) {
      const created = await request<Conversation>("/vnext/conversations", { method: "POST", body: JSON.stringify({ title: "我的第一个研究主题" }) });
      items = [created];
    }
    setConversations(items);
    setCurrentId((id) => id || items[0]?.id);
  }, []);

  useEffect(() => { void loadConversations().catch((e) => setError(String(e))); }, [loadConversations]);
  useEffect(() => { void refresh(); }, [currentId, refresh]);
  useEffect(() => {
    if (!currentId) return;
    const stream = new EventSource(`/vnext/conversations/${currentId}/events`);
    stream.onmessage = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => void refresh(), 120);
    };
    return () => { stream.close(); if (refreshTimer.current) clearTimeout(refreshTimer.current); };
  }, [currentId, refresh]);

  async function newConversation() {
    const created = await request<Conversation>("/vnext/conversations", { method: "POST", body: JSON.stringify({ title: "新的研究主题" }) });
    setConversations((items) => [created, ...items]);
    setCurrentId(created.id);
    setSnapshot(EMPTY);
  }

  async function submit() {
    const content = input.trim();
    if (!content || !currentId || busy) return;
    setBusy(true); setError(""); setInput("");
    try {
      await request(`/vnext/conversations/${currentId}/messages`, { method: "POST", body: JSON.stringify({ content }) });
      await refresh(currentId);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setInput(content); }
    finally { setBusy(false); }
  }

  async function decide(approval: ApprovalRequest, decision: "approved" | "rejected") {
    setBusy(true);
    try {
      await request(`/vnext/approvals/${approval.id}/decision`, { method: "POST", body: JSON.stringify({ decision }) });
      await refresh(approval.conversationId);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function taskAction(action: "resume" | "cancel" | "branch") {
    if (!snapshot.task) return;
    const body = action === "branch" ? JSON.stringify({ goal: input.trim() || snapshot.task.goal }) : "{}";
    await request(`/vnext/tasks/${snapshot.task.id}/${action}`, { method: "POST", body });
    setInput("");
    await refresh();
  }

  const surfaces = useMemo(() => snapshot.artifacts.filter((a) => a.kind === "ui_surface").map((a) => a.data as UiSurface), [snapshot.artifacts]);
  const statusText = snapshot.task ? ({ waiting_approval: "等待你确认", waiting_input: "需要补充", queued: "已进入队列", running: "研究进行中", completed: "本轮已完成", failed: "执行失败", cancelled: "已取消", planned: "计划中" } as Record<string, string>)[snapshot.task.status] : "可以开始研究";

  return <main className="workbench">
    <aside className="topics-pane">
      <div className="brand"><span className="brand-mark">J</span><div><strong>判断</strong><small>研究搭档 vNext</small></div></div>
      <button className="new-topic" onClick={() => void newConversation()}>＋ 新研究主题</button>
      <p className="section-label">研究主题</p>
      <nav className="topic-list">
        {conversations.map((item) => <button key={item.id} className={item.id === currentId ? "topic active" : "topic"} onClick={() => setCurrentId(item.id)}>
          <span className="topic-icon">研</span><span><b>{item.title}</b><small>{new Date(item.updatedAt).toLocaleDateString("zh-CN")}</small></span>
        </button>)}
      </nav>
      <div className="dev-entry"><span>本地优先</span><span>开发者设置 ···</span></div>
    </aside>

    <section className="conversation-pane">
      <header className="conversation-header">
        <div><h1>{snapshot.conversation?.title || "研究搭档"}</h1><p><span className={`status-dot ${snapshot.task?.status || "idle"}`} />{statusText}</p></div>
        {snapshot.task && <div className="header-actions"><button onClick={() => void taskAction("branch")}>创建分支</button><button onClick={() => void taskAction(snapshot.task?.status === "running" ? "cancel" : "resume")}>{snapshot.task.status === "running" ? "取消" : "恢复"}</button></div>}
      </header>
      <div className="messages">
        {!snapshot.messages.length && <div className="welcome">
          <span className="lead-avatar">L</span><h2>你想研究什么？</h2>
          <p>说目标就好。范围、证据、方法和输出形式，我会在真正影响路径时再与你确认。</p>
          <div className="suggestions"><button onClick={() => setInput("研究未来六个月先进封装需求变化，并给出判断与改判条件")}>研究一个行业变化</button><button onClick={() => setInput("只补充现有判断的一手来源，并检查引用是否完整")}>只补一手来源</button></div>
        </div>}
        {snapshot.messages.map((message) => <article className={`message ${message.actorType}`} key={message.id}>
          <div className="avatar">{message.actorType === "researcher" ? "我" : "L"}</div><div><small>{message.actorType === "researcher" ? "你" : "Research Lead"}</small><p>{message.content}</p></div>
        </article>)}
        {snapshot.approvals.map((approval) => <article className="approval" key={approval.id}>
          <div><small>需要你的确认</small><h3>{approval.prompt}</h3><p>计划由受约束的研究节点组成；确认后交给独立 worker 执行。</p></div>
          <div><button className="secondary" disabled={busy} onClick={() => void decide(approval, "rejected")}>调整方向</button><button className="primary" disabled={busy} onClick={() => void decide(approval, "approved")}>确认开始</button></div>
        </article>)}
      </div>
      <div className="composer">
        {error && <p className="error">{error}</p>}
        <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); } }} placeholder="描述研究目标，或说：只补一手来源、把时间改为未来六个月……" />
        <div><span>Enter 发送 · Shift+Enter 换行</span><button disabled={!input.trim() || busy} onClick={() => void submit()}>{busy ? "处理中" : "发送 →"}</button></div>
      </div>
    </section>

    <aside className="canvas-pane">
      <div className="canvas-header"><div><small>动态画布</small><h2>{surfaces.at(-1)?.title || "等待研究任务"}</h2></div><span>{surfaces.length} 个制品视图</span></div>
      <div className="canvas-scroll">
        {surfaces.length ? surfaces.map((surface) => <TrustedSurface key={surface.id} surface={surface} nodes={snapshot.nodes} />) : <div className="empty-canvas"><div>◇</div><p>证据矩阵、判断卡和报告会随任务在这里出现。</p></div>}
        {!!snapshot.events.length && <Timeline events={snapshot.events} />}
      </div>
    </aside>
  </main>;
}

function TrustedSurface({ surface, nodes }: { surface: UiSurface; nodes: TaskNode[] }) {
  if (surface.component === "research_plan") return <section className="surface plan-surface"><div className="surface-kicker">受约束动态计划</div><h3>{surface.title}</h3><p>{String(surface.data.rationale || "")}</p><div className="plan-nodes">{nodes.map((node, index) => <div className={`plan-node ${node.status}`} key={node.id}><span>{index + 1}</span><div><b>{node.title}</b><small>{node.capabilityType} · {node.status}</small></div></div>)}</div><p className="principle">确定性负责边界，Agent 负责路径</p></section>;
  if (surface.component === "evidence_matrix") return <section className="surface"><div className="surface-kicker">证据边界</div><h3>{surface.title}</h3><div className="metric"><strong>0</strong><span>条合格证据</span></div><p>{String(surface.data.gap || "")}</p></section>;
  if (surface.component === "judgment_card") return <section className="surface judgment"><div className="surface-kicker">判断卡</div><h3>{String(surface.data.statement || surface.title)}</h3><span className="confidence">置信度：{String(surface.data.confidence || "待评估")}</span><h4>改判条件</h4><ul>{Array.isArray(surface.data.changeConditions) && surface.data.changeConditions.map((x) => <li key={String(x)}>{String(x)}</li>)}</ul></section>;
  if (surface.component === "report_editor") return <section className="surface"><div className="surface-kicker">可编辑报告</div><h3>{surface.title}</h3><p>{String(surface.data.summary || "")}</p><div className="boundary">{String(surface.data.boundary || "")}</div></section>;
  return <section className="surface"><div className="surface-kicker">可信组件</div><h3>{surface.title}</h3><pre>{JSON.stringify(surface.data, null, 2)}</pre></section>;
}

function Timeline({ events }: { events: RunEvent[] }) {
  const visible = events.filter((event) => !["message.created"].includes(event.type)).slice(-12).reverse();
  return <details className="timeline"><summary>执行与审计详情 <span>{visible.length}</span></summary>{visible.map((event) => <div className="event" key={event.id}><i /><div><b>{event.type}</b><small>{new Date(event.createdAt).toLocaleTimeString("zh-CN")}</small></div></div>)}</details>;
}
