"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { EventImpact, MarketEvent, ResearchRun, ResearchWorkItem } from "@/engine/types";
import { workItemHref } from "@/engine/research_overview";
import { runStatusLabel } from "@/app/lib/ui-labels";
import { researcherLanguage } from "@/app/lib/researcher-stage-output";

const GUIDE_KEY = "radar-guide-seen";
const directionLabel: Record<string, string> = { support: "支持", weaken: "削弱", invalidate: "触发失效", review: "需要复核", context: "背景变化" };
const candidateDirectionLabel: Record<string, string> = { support: "可能支持", weaken: "可能削弱", invalidate: "可能触发失效", review: "需要复核", context: "背景变化" };
const classificationLabel: Record<string, string> = { evidence_update: "仅新增证据（从证据阶段开始）", structure_revision: "判断结构变化（重开结构）", scope_revision: "范围/问题变化（重开范围）" };

export function RadarDashboard({
  initialEvents,
  initialImpacts,
  initialWorkItems,
  initialLastRefreshedAt = null,
  runs,
}: {
  initialEvents: MarketEvent[];
  initialImpacts: EventImpact[];
  initialWorkItems: ResearchWorkItem[];
  initialLastRefreshedAt?: string | null;
  runs: ResearchRun[];
}) {
  const router = useRouter();
  const [events, setEvents] = useState(initialEvents);
  const [impacts, setImpacts] = useState(initialImpacts);
  const [workItems, setWorkItems] = useState(initialWorkItems);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(initialLastRefreshedAt);
  const [selectedId, setSelectedId] = useState(initialEvents[0]?.id || "");
  const [selectedImpactId, setSelectedImpactId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);
  const eventGroups = useMemo(() => buildEventGroups(events), [events]);
  const selectedGroup = eventGroups.find((group) => group.ids.includes(selectedId)) || eventGroups[0];
  const selected = selectedGroup?.event;
  const selectedImpacts = useMemo(() => {
    const ids = new Set(selectedGroup?.ids || []);
    return impacts.filter((impact) => ids.has(impact.event_id));
  }, [impacts, selectedGroup]);
  const selectedImpact = selectedImpacts.find((impact) => impact.id === selectedImpactId) || selectedImpacts[0];
  const [classification, setClassification] = useState<"evidence_update" | "structure_revision" | "scope_revision">("evidence_update");
  const runMap = useMemo(() => new Map(runs.map((run) => [run.id, run])), [runs]);
  const workGroups = useMemo(() => {
    const priorityRank: Record<string, number> = { high: 3, medium: 2, low: 1 };
    const grouped = new Map<string, ResearchWorkItem[]>();
    for (const item of workItems) {
      const current = grouped.get(item.run_id) || [];
      current.push(item);
      grouped.set(item.run_id, current);
    }
    return Array.from(grouped.entries())
      .map(([runId, items]) => {
        const sorted = [...items].sort((a, b) => (priorityRank[b.priority] || 0) - (priorityRank[a.priority] || 0));
        return { runId, item: sorted[0], count: items.length };
      })
      .sort((a, b) => (priorityRank[b.item.priority] || 0) - (priorityRank[a.item.priority] || 0));
  }, [workItems]);
  const recentRuns = useMemo(() => {
    const statusRank: Record<string, number> = { active: 0, in_progress: 0, blocked: 1, complete: 2, completed: 2, draft: 3, archived: 4 };
    return [...runs]
      .sort((a, b) => (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9) || Date.parse(b.updated_at) - Date.parse(a.updated_at))
      .slice(0, 3);
  }, [runs]);

  useEffect(() => {
    try {
      if (!localStorage.getItem(GUIDE_KEY)) setGuideOpen(true);
    } catch {
      // ignore storage errors
    }
  }, []);

  useEffect(() => {
    setSelectedImpactId(selectedImpacts[0]?.id || "");
  }, [selected?.id, selectedImpacts[0]?.id]);

  useEffect(() => {
    setClassification(selectedImpact?.impact_classification || "evidence_update");
  }, [selectedImpact?.id, selectedImpact?.impact_classification]);

  function closeGuide() {
    setGuideOpen(false);
    try {
      localStorage.setItem(GUIDE_KEY, "1");
    } catch {
      // ignore storage errors
    }
  }

  async function refresh() {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/radar/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lookback_hours: 72 }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "刷新失败");
      const radarResponse = await fetch("/api/radar", { cache: "no-store" });
      const radar = await radarResponse.json();
      setEvents(radar.events || []); setImpacts(radar.impacts || []); setWorkItems(radar.pending_work_items || []);
      if (radar.last_refreshed_at) setLastRefreshedAt(radar.last_refreshed_at);
      else if (data.last_refreshed_at) setLastRefreshedAt(data.last_refreshed_at);
      if (radar.events?.[0]?.id) setSelectedId(radar.events[0].id);
      setMessage(`发现 ${data.discovered} 条，新增 ${data.inserted} 条，合并 ${data.deduplicated} 条重复线索`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function startUpdate() {
    if (!selected || !selectedImpact) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/radar/events/${selectedImpact.event_id}/start-update`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ run_id: selectedImpact.run_id, impact_classification: classification }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "创建更新运行失败");
      router.push(classification === "evidence_update" ? `/runs/${data.id}/evidence` : classification === "structure_revision" ? `/runs/${data.id}/structure` : `/runs/${data.id}/stages/1`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }

  return <>
    <section className="radar-head">
      <div>
        <div className="eyebrow">研究雷达</div>
        <h1>今天，什么变化值得重看？</h1>
        <p>系统只把外部事件映射为待核验线索，不会自动改写任何研究判断。</p>
        {workItems.length ? <a className="radar-head-meta" href="#radar-queue">{workGroups.length} 项研究等待处理 →</a> : null}
      </div>
      <div className="radar-head-actions">
        <div className="radar-refresh-meta">
          <button className="button" disabled={busy} onClick={refresh}>{busy ? "正在检索…" : "刷新过去 72 小时"}</button>
          <small>上次刷新：{formatLastRefresh(lastRefreshedAt)}</small>
        </div>
        <Link className="button-secondary" href="/runs/new">新建独立研究</Link>
        <button type="button" className="button-quiet" onClick={() => setGuideOpen(true)}>使用说明</button>
      </div>
    </section>
    {message ? <div className="notice radar-message">{message}</div> : null}
    {error ? <div className="notice error">{error}</div> : null}

    <div className="radar-layout">
      <section className="radar-feed">
        <div className="panel-title"><div><span>外部事件</span><strong>{eventGroups.length}</strong></div><small>{events.length > eventGroups.length ? `${events.length - eventGroups.length} 条相似线索已合并` : "按最新时点排序"}</small></div>
        {eventGroups.length ? eventGroups.map(({ event, ids }) => {
          const idSet = new Set(ids);
          const eventImpacts = impacts.filter((impact) => idSet.has(impact.event_id));
          const strongest = eventImpacts[0];
          return <button className={`radar-event ${selected?.id === event.id ? "selected" : ""}`} onClick={() => setSelectedId(event.id)} key={event.id}>
            <div className="radar-event-top"><span>{event.publisher || event.event_type}</span><time>{formatDate(event.published_at || event.occurred_at || event.discovered_at)}</time></div>
            <strong>{event.title}</strong><p>{event.summary}</p>
            <div className="event-tags">{event.candidate_labels.slice(0, 3).map((label) => <span key={label}>{label}</span>)}{strongest ? <span className={`impact-${strongest.direction}`}>{candidateDirectionLabel[strongest.direction]}</span> : <span>待映射</span>}</div>
          </button>;
        }) : <div className="radar-empty radar-empty-compact"><h2>暂无事件</h2><p>刷新后按研究问题检索公开来源。</p></div>}
      </section>

      <section className="radar-focus">
        {selected ? <>
          <div className="focus-source"><span className={`confidence-${selected.confidence}`}>可信度：{({ high: "高", medium: "中", low: "低" } as Record<string, string>)[selected.confidence] || selected.confidence}</span><a href={selected.url} target="_blank" rel="noreferrer">查看原始来源 ↗</a></div>
          <h2>{selected.title}</h2><p className="focus-summary">{selected.summary}</p>
          <div className="focus-facts"><div><span>发布者</span><strong>{selected.publisher || "未识别"}</strong></div><div><span>发生 / 发布</span><strong>{formatDate(selected.occurred_at || selected.published_at || selected.discovered_at)}</strong></div><div><span>相关主题</span><strong>{selected.candidate_labels.join("、") || "待识别"}</strong></div></div>
          <div className="impact-section"><div className="panel-title"><div><span>对已有判断的影响</span><strong>{selectedImpacts.length}</strong></div>{selectedImpacts.length > 1 ? <small>先点选一条研究再操作</small> : null}</div>
            {selectedImpacts.length ? selectedImpacts.map((impact) => {
              const run = runMap.get(impact.run_id);
              const active = selectedImpact?.id === impact.id;
              return <button type="button" className={`impact-card impact-${impact.direction}${active ? " selected" : ""}`} key={impact.id} onClick={() => setSelectedImpactId(impact.id)} aria-pressed={active}>
                <div><span>{directionLabel[impact.direction]}</span><strong>{Math.round(impact.relevance * 100)}%</strong></div>
                <h3>{run?.question || impact.run_id}</h3>
                {run ? <small>{run.parent_run_id ? "增量研究" : "原始研究"} · {["complete", "completed"].includes(run.status) ? "已完成" : `${runStatusLabel(run.status)} · 已确认 ${run.current_stage}/5 个阶段`}</small> : null}
                <p>{researcherLanguage(impact.rationale)}</p>
                <small>{classificationLabel[impact.impact_classification || "evidence_update"]}</small>
                {impact.matched_condition ? <small>匹配条件：{researcherLanguage(impact.matched_condition)}</small> : null}
              </button>;
            }) : <div className="focus-empty">这条事件尚未与已有判断建立可靠映射，只作为候选线索保留。</div>}
          </div>
          <div className="focus-actions">{selectedImpact ? <select value={classification} onChange={(event) => setClassification(event.target.value as typeof classification)} aria-label="影响分类"><option value="evidence_update">仅新增证据 · 从证据阶段开始</option><option value="structure_revision">判断结构变化 · 重开结构</option><option value="scope_revision">范围/问题变化 · 重开范围</option></select> : null}<button className="button" disabled={busy || !selectedImpact} onClick={startUpdate}>开启增量研究 →</button>{selectedImpact ? <Link className="button-secondary" href={`/runs/${selectedImpact.run_id}`}>查看原判断</Link> : null}</div>
        </> : <div className="radar-focus-empty">
          {runs.length ? <>
            <h2>还没有可核验的事件</h2>
            <p>围绕已有研究问题、跟踪信号与失效条件检索公开来源，核验后再决定是否开启增量研究。</p>
            <button className="button" disabled={busy} onClick={refresh}>{busy ? "正在检索…" : "刷新过去 72 小时"}</button>
          </> : (
            <div className="radar-first-run-card">
              <div className="eyebrow">开始</div>
              <h2>开始你的第一项研究</h2>
              <p>提出研究问题并完成范围与结构后，雷达才能对照已有判断跟踪市场变化。</p>
              <Link className="button" href="/runs/new">提出第一个研究问题 →</Link>
            </div>
          )}
        </div>}
      </section>

      <aside className="radar-queue" id="radar-queue">
        <div className="panel-title"><div><span>我的下一步</span><strong>{workGroups.length}</strong></div><small>{workItems.length} 项待办，按研究归并</small></div>
        {workGroups.length ? workGroups.slice(0, 5).map(({ runId, item, count }) => <Link className={`queue-item priority-${item.priority}`} href={workItemHref(item.stage, runId)} key={runId}><span>{stageLabel(item.stage)}{count > 1 ? ` · ${count} 项` : ""}</span><strong>{researcherLanguage(item.title)}</strong><small>{runMap.get(runId)?.question || "打开研究处理"}</small></Link>) : <div className="queue-empty">当前没有待处理的审阅或补证任务。</div>}
        {workGroups.length > 5 ? <Link className="queue-more" href="/runs">查看其余 {workGroups.length - 5} 项研究 →</Link> : null}
      </aside>
    </div>

    {recentRuns.length ? (
      <section className="research-index research-index-compact">
        <div className="section-head research-index-head">
          <h2>近期研究</h2>
          <Link className="section-meta research-index-link" href="/runs">查看全部 {runs.length} 条 →</Link>
        </div>
        <div className="research-mini-grid">
          {recentRuns.map((run) => (
            <Link href={`/runs/${run.id}`} className="research-mini-card" key={run.id}>
              <div>
                <span>{run.domain === "semiconductor" ? "半导体" : "通用"}</span>
                <span>{run.parent_run_id ? "增量研究" : "原始研究"}</span>
              </div>
              <strong>{run.question}</strong>
              <small>阶段 {run.current_stage}/5 · {runStatusLabel(run.status)}</small>
            </Link>
          ))}
        </div>
      </section>
    ) : (
      <section className="radar-first-run-banner">
        <div>
          <div className="eyebrow">空白工作台</div>
          <h2>开始你的第一项研究</h2>
          <p>新建研究并确认范围后，雷达才会有可对照的判断。</p>
        </div>
        <Link className="button" href="/runs/new">提出第一个研究问题 →</Link>
      </section>
    )}

    {guideOpen ? <RadarGuideDialog runs={runs} onClose={closeGuide} /> : null}
  </>;
}

function RadarGuideDialog({ runs, onClose }: { runs: ResearchRun[]; onClose: () => void }) {
  return (
    <div className="radar-guide-backdrop" onClick={onClose} role="presentation">
      <div className="radar-guide-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-labelledby="radar-guide-title" aria-modal="true">
        <button type="button" className="radar-guide-close" onClick={onClose} aria-label="关闭">×</button>
        <div className="eyebrow">使用流程</div>
        <h2 id="radar-guide-title">从市场变化回到已有判断</h2>
        <p>雷达不会替你下结论。它先定位可能受影响的判断，再让你决定是否开启一次保留原判断的增量研究。</p>
        <ol>
          <li><span>01</span><div><strong>刷新事件</strong><small>围绕研究对象、跟踪信号与失效条件检索。</small></div></li>
          <li><span>02</span><div><strong>检查影响</strong><small>核验来源、时点、可信度与潜在影响方向。</small></div></li>
          <li><span>03</span><div><strong>开启增量研究</strong><small>继承既有范围与结构，从证据阶段开始重审。</small></div></li>
        </ol>
        <div className="radar-guide-actions">
          {runs.length ? <Link className="button-secondary" href="/runs" onClick={onClose}>查看全部研究 →</Link> : <Link className="button-secondary" href="/runs/new" onClick={onClose}>提出第一个研究问题 →</Link>}
          <button type="button" className="button" onClick={onClose}>知道了</button>
        </div>
      </div>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatLastRefresh(value: string | null) {
  if (!value) return "尚未刷新";
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return value;
  const date = new Date(ts);
  const today = new Date();
  const sameDay = date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate();
  const time = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(date);
  if (sameDay) return `今天 ${time}`;
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

export function buildEventGroups(events: MarketEvent[]) {
  const groups: Array<{ event: MarketEvent; ids: string[]; labels: Set<string>; tokens: Set<string>; hour: string; publisher: string }> = [];
  for (const event of events) {
    const labels = new Set((event.candidate_labels || []).map((label) => label.trim().toLowerCase()).filter(Boolean));
    const tokens = new Set(
      `${event.title} ${(event.candidate_labels || []).join(" ")}`
        .match(/\d+(?:\.\d+)?%?|[a-z]+[a-z0-9.-]*/gi)
        ?.map((token) => token.toLowerCase())
        .filter((token) => !["trendforce", "the", "and", "from", "market", "prices"].includes(token)) || [],
    );
    const timestamp = Date.parse(event.published_at || event.occurred_at || event.discovered_at);
    const hour = Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 13) : "";
    const publisher = String(event.publisher || event.event_type || "").trim().toLowerCase();
    const existing = groups.find((group) => {
      if (!hour || group.hour !== hour || group.publisher !== publisher) return false;
      const labelOverlap = [...labels].filter((label) => group.labels.has(label)).length;
      const tokenOverlap = [...tokens].filter((token) => group.tokens.has(token)).length;
      return labelOverlap >= 2 || (labelOverlap >= 1 && tokenOverlap >= 2);
    });
    if (existing) {
      existing.ids.push(event.id);
      labels.forEach((label) => existing.labels.add(label));
      tokens.forEach((token) => existing.tokens.add(token));
    } else {
      groups.push({ event, ids: [event.id], labels, tokens, hour, publisher });
    }
  }
  return groups;
}

function stageLabel(stage: string) {
  return ({ stage_01: "范围", stage_02: "结构", stage_03: "证据", stage_04: "判断", stage_05: "交付" } as Record<string, string>)[stage] || stage;
}
