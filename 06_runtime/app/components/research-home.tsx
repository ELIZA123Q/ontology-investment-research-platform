"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Conversation, ReportAudience, ReportDepth, ReportKind, ReportSectionKey, ResearchTrackingProfile } from "@/src/contracts";
import type { HomeView } from "@/src/ui/view-models";
import { apiRequest, formatRelativeTime, taskStatusText } from "@/app/components/client-api";
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
  const [reportKind, setReportKind] = useState<"auto" | ReportKind>("auto");
  const [audience, setAudience] = useState<ReportAudience>("research_analyst");
  const [depth, setDepth] = useState<ReportDepth>("standard");
  const [optionalSections, setOptionalSections] = useState<ReportSectionKey[]>([]);
  const [customInstructions, setCustomInstructions] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [editingTracking, setEditingTracking] = useState<string>();
  const [trackingSymbols, setTrackingSymbols] = useState("");
  const [trackingKeywords, setTrackingKeywords] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function loadHome() {
    const next = await apiRequest<HomeView>("/vnext/home");
    setView(next);
    return next;
  }

  useEffect(() => { void loadHome().catch((e) => setError(e instanceof Error ? e.message : String(e))); }, []);

  const current = useMemo(() => view?.research.filter((item) => item.latestTask).slice(0, 6) || [], [view]);

  async function startResearch() {
    const content = goal.trim();
    if (!content || busy) return;
    setBusy(true); setError("");
    try {
      const title = content.length > 34 ? `${content.slice(0, 34)}…` : content;
      const conversation = await apiRequest<Conversation>("/vnext/conversations", { method: "POST", body: JSON.stringify({ title }) });
      await apiRequest(`/vnext/conversations/${conversation.id}/messages`, { method: "POST", body: JSON.stringify({ content, reportSpec: { kind: reportKind === "auto" ? undefined : reportKind, audience, depth, optionalSections, customInstructions } }) });
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

  function toggleSection(section: ReportSectionKey) {
    setOptionalSections((items) => items.includes(section) ? items.filter((item) => item !== section) : [...items, section]);
  }

  async function refreshSignals() {
    if (refreshing) return;
    setRefreshing(true); setError("");
    try {
      await apiRequest("/vnext/signals/refresh", { method: "POST", body: "{}" });
      for (let attempt = 0; attempt < 80; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const next = await loadHome();
        if (next.signalRefresh && ["completed", "partial", "failed"].includes(next.signalRefresh.status)) break;
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setRefreshing(false); }
  }

  async function decideSignal(id: string, decision: "seen" | "dismissed" | "use_in_research") {
    setError("");
    try {
      const result = await apiRequest<{ task?: { conversationId: string } }>(`/vnext/signals/${id}/decision`, { method: "POST", body: JSON.stringify({ decision }) });
      if (decision === "use_in_research" && result.task) window.location.assign(`/research/${result.task.conversationId}`);
      else await loadHome();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  function editTracking(profile: ResearchTrackingProfile) {
    setEditingTracking(profile.conversationId);
    setTrackingSymbols(profile.symbols.join("、"));
    setTrackingKeywords(profile.keywords.join("、"));
  }

  async function saveTracking(profile: ResearchTrackingProfile, enabled = profile.enabled) {
    setError("");
    try {
      await apiRequest(`/vnext/conversations/${profile.conversationId}/tracking`, {
        method: "PUT",
        body: JSON.stringify({
          enabled,
          symbols: trackingSymbols.split(/[,，、\s]+/).filter(Boolean),
          keywords: trackingKeywords.split(/[,，、\n]+/).map((item) => item.trim()).filter(Boolean),
        }),
      });
      setEditingTracking(undefined); await loadHome();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
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
      <details className="delivery-settings">
        <summary><span>交付设置</span><strong>{reportKind === "auto" ? "自动识别" : "已指定类型"} · {depth === "brief" ? "简版" : depth === "deep" ? "深度版" : "标准版"}</strong></summary>
        <div className="delivery-grid">
          <label>报告类型<select value={reportKind} onChange={(event) => setReportKind(event.target.value as "auto" | ReportKind)}><option value="auto">根据问题自动识别</option><option value="company_research">公司研究</option><option value="industry_research">行业研究</option><option value="thematic_research">专题研究</option><option value="evidence_update">证据更新</option><option value="judgment_update">判断更新</option></select></label>
          <label>主要读者<select value={audience} onChange={(event) => setAudience(event.target.value as ReportAudience)}><option value="research_analyst">研究员</option><option value="portfolio_manager">投资组合经理</option><option value="investment_committee">投资决策委员会</option><option value="client">客户</option></select></label>
          <label>交付深度<select value={depth} onChange={(event) => setDepth(event.target.value as ReportDepth)}><option value="brief">简版</option><option value="standard">标准版</option><option value="deep">深度版</option></select></label>
        </div>
        <fieldset><legend>希望额外固定查看</legend>{[["alternative_hypotheses", "竞争解释"], ["scenario_analysis", "情景分析"], ["valuation_scenarios", "估值边界"]].map(([value, label]) => <label key={value}><input type="checkbox" checked={optionalSections.includes(value as ReportSectionKey)} onChange={() => toggleSection(value as ReportSectionKey)} />{label}</label>)}</fieldset>
        <label className="delivery-instructions">其他交付要求<input value={customInstructions} onChange={(event) => setCustomInstructions(event.target.value)} maxLength={500} placeholder="例如：重点比较资本开支情景；面向投委会，先结论后证据" /></label>
        <p>证据、风险、改判条件和来源附录始终保留，不能被个性化设置删除。</p>
      </details>
      <div className="intent-row" aria-label="研究方式">{intentOptions.map((item) => <button key={item.label} onClick={() => chooseIntent(item.prefix)}>{item.label}</button>)}</div>
      {error && <p className="inline-error" role="alert">{error}</p>}
    </section>

    <section className="home-grid research-dashboard">
      <div className="home-main-column">
        <section className="section-block attention-block">
          <div className="section-heading"><div><span>需要你处理</span><h2>把注意力留给真正的决策</h2></div><strong>{view?.counts.needsAttention || 0}</strong></div>
          {!view ? <div className="skeleton-list"><i/><i/><i/></div> : view.attention.length ? <div className="attention-list">{view.attention.slice(0, 5).map((item) => <Link key={item.id} href={`/research/${item.conversationId}`} className={`attention-item ${item.kind}`}><span className="attention-symbol">{item.kind === "approval" ? "!" : item.kind === "failure" ? "×" : "→"}</span><div><strong>{item.title}</strong><p>{item.detail}</p></div><time>{formatRelativeTime(item.createdAt)}</time></Link>)}</div> : <div className="resolved-state"><span><CheckIcon /></span><div><strong>没有等待处理的研究</strong><p>计划确认、补充信息和失败恢复会集中出现在这里。</p></div></div>}
        </section>

        <section className="section-block signal-block signal-feed-block">
          <div className="section-heading"><div><span>关注变化</span><h2>只看与当前研究有关的新信息</h2></div><button className="refresh-signals" disabled={refreshing || !view?.tracking.length} onClick={() => void refreshSignals()}>{refreshing ? "正在后台刷新…" : "刷新新闻与公告"}</button></div>
          <div className={`connector-status ${view?.connections.akshare.status === "ready" ? "configured" : "unconfigured"}`}><i/><div><strong>{view?.connections.akshare.status === "ready" ? "AKShare 候选材料源已就绪" : view?.connections.akshare.status === "degraded" ? "AKShare 当前降级" : "AKShare 未启动"}</strong><p>{view?.connections.akshare.detail || "正在检查数据源…"}</p>{view?.signalRefresh?.completedAt && <small>上次刷新 {formatRelativeTime(view.signalRefresh.completedAt)} · {view.signalRefresh.candidateCount} 条变化</small>}</div></div>
          {view?.signalFeed.length ? <div className="research-signal-feed">{view.signalFeed.map((item) => <article key={item.id} className={`research-signal ${item.kind}`}>
            <header><span>{item.kind === "announcement" ? "公告" : "新闻"} · {item.sourceType === "primary" ? "一手链接" : "二手候选"}</span><time>{formatRelativeTime(item.publishedAt)}</time></header>
            <h3>{item.title}</h3><p>{item.excerpt}</p><small>{item.matchReason} · {item.publisher}</small>
            <footer><a href={item.sourceUri} target="_blank" rel="noreferrer">查看原文</a><button onClick={() => void decideSignal(item.id, "dismissed")}>忽略</button><button onClick={() => void decideSignal(item.id, "seen")}>已读</button><button className="primary-button" onClick={() => void decideSignal(item.id, "use_in_research")}>用于研究</button></footer>
          </article>)}</div> : <div className="signal-unavailable"><i/><strong>尚无匹配变化</strong><p>{view?.tracking.length ? "点击刷新后，系统只保留命中研究代码或关键词的公开新闻与公告。" : "先发起一个研究主题，再设置追踪代码与关键词。"}</p></div>}
        </section>

        <section className="section-block">
          <div className="section-heading"><div><span>我的研究</span><h2>继续最近的判断</h2></div><small>{view?.research.length || 0} 个主题</small></div>
          {!view ? <div className="skeleton-grid"><i/><i/><i/></div> : current.length ? <div className="research-card-grid">{current.map((item) => <Link href={`/research/${item.conversation.id}`} className="research-card" key={item.conversation.id}>
            <div className="card-meta"><span className={`status-badge ${item.latestTask?.status} ${item.latestTask?.outcome || ""}`}>{item.latestTask ? taskStatusText(item.latestTask) : "尚未开始"}</span><time>{formatRelativeTime(item.conversation.updatedAt)}</time></div>
            <h3>{item.conversation.title}</h3>
            <p>{item.resultSummary || item.latestTask?.goal || "打开研究主题并补充目标。"}</p>
            <div className="progress-line"><i style={{ width: `${item.progress.total ? Math.round(item.progress.completed / item.progress.total * 100) : 0}%` }} /></div>
            <div className="card-foot"><span>{item.progress.completed}/{item.progress.total || 0} 个研究节点</span><ArrowIcon /></div>
          </Link>)}</div> : <div className="empty-state"><SparkIcon /><strong>还没有研究主题</strong><p>上方输入问题后，研究计划与结果会沉淀在这里。</p></div>}
        </section>
      </div>

      <aside className="home-side-column">
        <section className="section-block tracking-block">
          <div className="section-heading"><div><span>追踪设置</span><h2>让变化流保持克制</h2></div><small>{view?.tracking.length || 0} 个主题</small></div>
          <div className="tracking-list">{view?.tracking.map((profile) => { const conversation = view.research.find((item) => item.conversation.id === profile.conversationId)?.conversation; const editing = editingTracking === profile.conversationId; return <article key={profile.conversationId}>
            <header><div><strong>{conversation?.title || "研究主题"}</strong><small>{profile.enabled ? "已启用" : "已暂停"} · {profile.symbols.length} 个代码 · {profile.keywords.length} 个关键词</small></div><button onClick={() => editTracking(profile)}>编辑</button></header>
            {editing && <div className="tracking-editor"><label>A 股代码<input value={trackingSymbols} onChange={(event) => setTrackingSymbols(event.target.value)} placeholder="600519、000300" /></label><label>关键词<textarea value={trackingKeywords} onChange={(event) => setTrackingKeywords(event.target.value)} placeholder="公司名、产品、产业环节" /></label><div><button onClick={() => setEditingTracking(undefined)}>取消</button><button onClick={() => void saveTracking(profile, !profile.enabled)}>{profile.enabled ? "暂停追踪" : "启用追踪"}</button><button className="primary-button" onClick={() => void saveTracking(profile)}>保存</button></div></div>}
          </article>; })}</div>
        </section>
      </aside>
    </section>
  </main>;
}
