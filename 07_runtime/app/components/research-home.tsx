"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Conversation } from "@/src/contracts";
import type { HomeView } from "@/src/ui/view-models";
import { apiRequest, formatRelativeTime, taskStatusLabel } from "@/app/components/client-api";
import { ArrowIcon, CheckIcon, SparkIcon } from "@/app/components/icons";

const intentOptions = [
  { label: "完整研究", prefix: "研究" },
  { label: "只补证据", prefix: "只补充现有判断的一手来源，并核验" },
  { label: "更新判断", prefix: "根据新材料更新判断：" },
  { label: "整理报告", prefix: "整理成可交付研究报告：" },
];

export function ResearchHome() {
  const [view, setView] = useState<HomeView>();
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { void apiRequest<HomeView>("/vnext/home").then(setView).catch((e) => setError(e instanceof Error ? e.message : String(e))); }, []);

  const current = useMemo(() => view?.research.filter((item) => item.latestTask).slice(0, 6) || [], [view]);

  async function startResearch() {
    const content = goal.trim();
    if (!content || busy) return;
    setBusy(true); setError("");
    try {
      const title = content.length > 34 ? `${content.slice(0, 34)}…` : content;
      const conversation = await apiRequest<Conversation>("/vnext/conversations", { method: "POST", body: JSON.stringify({ title }) });
      await apiRequest(`/vnext/conversations/${conversation.id}/messages`, { method: "POST", body: JSON.stringify({ content }) });
      window.location.assign(`/research/${conversation.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  function chooseIntent(prefix: string) {
    setGoal((value) => value.trim() ? value : `${prefix} `);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  return <main className="home-page" id="main-content">
    <section className="home-hero">
      <div className="hero-kicker"><SparkIcon />Research Lead 已就绪</div>
      <h1>从一个值得判断的问题开始</h1>
      <p>说清目标即可。AI 会提出受约束的研究计划，证据不足时明确停止。</p>
      <div className="goal-composer">
        <textarea ref={inputRef} value={goal} onChange={(event) => setGoal(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void startResearch(); } }} placeholder="例如：未来六个月先进封装需求是否会持续改善？给出证据、竞争解释和改判条件。" aria-label="研究目标" />
        <div className="composer-footer"><span>Enter 开始研究 · Shift+Enter 换行</span><button className="primary-button" disabled={!goal.trim() || busy} onClick={() => void startResearch()}>{busy ? "正在创建" : "开始研究"}<ArrowIcon /></button></div>
      </div>
      <div className="intent-row" aria-label="研究方式">{intentOptions.map((item) => <button key={item.label} onClick={() => chooseIntent(item.prefix)}>{item.label}</button>)}</div>
      {error && <p className="inline-error" role="alert">{error}</p>}
    </section>

    <section className="home-grid">
      <div className="home-main-column">
        <section className="section-block attention-block">
          <div className="section-heading"><div><span>需要你处理</span><h2>把注意力留给真正的决策</h2></div><strong>{view?.counts.needsAttention || 0}</strong></div>
          {!view ? <div className="skeleton-list"><i/><i/><i/></div> : view.attention.length ? <div className="attention-list">{view.attention.slice(0, 5).map((item) => <Link key={item.id} href={`/research/${item.conversationId}`} className={`attention-item ${item.kind}`}><span className="attention-symbol">{item.kind === "approval" ? "!" : item.kind === "failure" ? "×" : "→"}</span><div><strong>{item.title}</strong><p>{item.detail}</p></div><time>{formatRelativeTime(item.createdAt)}</time></Link>)}</div> : <div className="resolved-state"><span><CheckIcon /></span><div><strong>没有等待处理的研究</strong><p>计划确认、补充信息和失败恢复会集中出现在这里。</p></div></div>}
        </section>

        <section className="section-block">
          <div className="section-heading"><div><span>我的研究</span><h2>继续最近的判断</h2></div><small>{view?.research.length || 0} 个主题</small></div>
          {!view ? <div className="skeleton-grid"><i/><i/><i/></div> : current.length ? <div className="research-card-grid">{current.map((item) => <Link href={`/research/${item.conversation.id}`} className="research-card" key={item.conversation.id}>
            <div className="card-meta"><span className={`status-badge ${item.latestTask?.status}`}>{item.latestTask ? taskStatusLabel[item.latestTask.status] : "尚未开始"}</span><time>{formatRelativeTime(item.conversation.updatedAt)}</time></div>
            <h3>{item.conversation.title}</h3>
            <p>{item.resultSummary || item.latestTask?.goal || "打开研究主题并补充目标。"}</p>
            <div className="progress-line"><i style={{ width: `${item.progress.total ? Math.round(item.progress.completed / item.progress.total * 100) : 0}%` }} /></div>
            <div className="card-foot"><span>{item.progress.completed}/{item.progress.total || 0} 个研究节点</span><ArrowIcon /></div>
          </Link>)}</div> : <div className="empty-state"><SparkIcon /><strong>还没有研究主题</strong><p>上方输入问题后，研究计划与结果会沉淀在这里。</p></div>}
        </section>
      </div>

      <aside className="home-side-column">
        <section className="section-block signal-block">
          <div className="section-heading"><div><span>研究变化</span><h2>值得重新核验的信号</h2></div></div>
          <div className="signal-unavailable"><i/><strong>实时来源尚未连接</strong><p>{view?.signals.reason || "正在确认数据连接状态…"}</p></div>
        </section>
        <section className="principle-card"><span>工作原则</span><blockquote>确定性负责边界，<br/>Agent 负责路径。</blockquote><p>所有判断都保留证据来源、停止条件与改判条件。</p></section>
      </aside>
    </section>
  </main>;
}
