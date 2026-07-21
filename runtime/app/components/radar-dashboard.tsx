"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { EventImpact, MarketEvent, ResearchRun, ResearchWorkItem } from "@/engine/types";
import { runStatusLabel } from "@/app/lib/ui-labels";

const directionLabel: Record<string, string> = { support: "支持", weaken: "削弱", invalidate: "触发失效", review: "需要复核", context: "背景变化" };
const classificationLabel: Record<string, string> = { evidence_update: "仅新增证据（从证据阶段开始）", structure_revision: "判断结构变化（重开结构）", scope_revision: "范围/问题变化（重开范围）" };

export function RadarDashboard({ initialEvents, initialImpacts, initialWorkItems, runs }: { initialEvents: MarketEvent[]; initialImpacts: EventImpact[]; initialWorkItems: ResearchWorkItem[]; runs: ResearchRun[] }) {
  const router = useRouter();
  const [events, setEvents] = useState(initialEvents);
  const [impacts, setImpacts] = useState(initialImpacts);
  const [workItems, setWorkItems] = useState(initialWorkItems);
  const [selectedId, setSelectedId] = useState(initialEvents[0]?.id || "");
  const [selectedImpactId, setSelectedImpactId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const selected = events.find((event) => event.id === selectedId) || events[0];
  const selectedImpacts = useMemo(() => impacts.filter((impact) => impact.event_id === selected?.id), [impacts, selected]);
  const selectedImpact = selectedImpacts.find((impact) => impact.id === selectedImpactId) || selectedImpacts[0];
  const [classification, setClassification] = useState<"evidence_update" | "structure_revision" | "scope_revision">("evidence_update");
  const runMap = useMemo(() => new Map(runs.map((run) => [run.id, run])), [runs]);
  const recentRuns = runs.slice(0, 3);

  useEffect(() => {
    setSelectedImpactId(selectedImpacts[0]?.id || "");
  }, [selected?.id, selectedImpacts]);

  useEffect(() => {
    setClassification(selectedImpact?.impact_classification || "evidence_update");
  }, [selectedImpact?.id, selectedImpact?.impact_classification]);

  async function refresh() {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/radar/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lookback_hours: 72 }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "刷新失败");
      const radarResponse = await fetch("/api/radar", { cache: "no-store" });
      const radar = await radarResponse.json();
      setEvents(radar.events || []); setImpacts(radar.impacts || []); setWorkItems(radar.pending_work_items || []);
      if (radar.events?.[0]?.id) setSelectedId(radar.events[0].id);
      setMessage(`发现 ${data.discovered} 条，新增 ${data.inserted} 条，去重 ${data.deduplicated} 条`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function startUpdate() {
    if (!selected || !selectedImpact) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/radar/events/${selected.id}/start-update`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ run_id: selectedImpact.run_id, impact_classification: classification }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "创建更新运行失败");
      router.push(classification === "evidence_update" ? `/runs/${data.id}/evidence` : classification === "structure_revision" ? `/runs/${data.id}/structure` : `/runs/${data.id}/stages/1`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }

  return <>
    <section className="radar-head">
      <div><div className="eyebrow">研究雷达</div><h1>今天，什么变化值得重看？</h1><p>系统只把外部事件映射为待核验线索，不会自动改写任何研究判断。</p></div>
      <div className="radar-head-actions">
        <button className="button" disabled={busy} onClick={refresh}>{busy ? "正在检索…" : "刷新过去 72 小时"}</button>
        <Link className="button-secondary" href="/runs">我的研究（{runs.length}）→</Link>
        <Link className="button-secondary" href="/runs/new">新建研究</Link>
      </div>
    </section>
    {message ? <div className="notice radar-message">{message}</div> : null}
    {error ? <div className="notice error">{error}</div> : null}

    <div className="radar-layout">
      <section className="radar-feed">
        <div className="panel-title"><div><span>外部事件</span><strong>{events.length}</strong></div><small>按最新时点排序</small></div>
        {events.length ? events.map((event) => {
          const eventImpacts = impacts.filter((impact) => impact.event_id === event.id);
          const strongest = eventImpacts[0];
          return <button className={`radar-event ${selected?.id === event.id ? "selected" : ""}`} onClick={() => setSelectedId(event.id)} key={event.id}>
            <div className="radar-event-top"><span>{event.publisher || event.event_type}</span><time>{formatDate(event.published_at || event.occurred_at || event.discovered_at)}</time></div>
            <strong>{event.title}</strong><p>{event.summary}</p>
            <div className="event-tags">{event.candidate_labels.slice(0, 3).map((label) => <span key={label}>{label}</span>)}{strongest ? <span className={`impact-${strongest.direction}`}>{directionLabel[strongest.direction]}</span> : <span>待映射</span>}</div>
          </button>;
        }) : <div className="radar-empty"><div className="radar-empty-icon">⌁</div><h2>还没有市场事件</h2><p>点击“刷新过去 72 小时”，系统会围绕已有研究问题、跟踪信号和失效条件寻找公开来源。</p></div>}
      </section>

      <section className="radar-focus">
        {selected ? <>
          <div className="focus-source"><span className={`confidence-${selected.confidence}`}>可信度：{({ high: "高", medium: "中", low: "低" } as Record<string, string>)[selected.confidence] || selected.confidence}</span><a href={selected.url} target="_blank" rel="noreferrer">查看原始来源 ↗</a></div>
          <h2>{selected.title}</h2><p className="focus-summary">{selected.summary}</p>
          <div className="focus-facts"><div><span>发布者</span><strong>{selected.publisher || "未识别"}</strong></div><div><span>发生 / 发布</span><strong>{formatDate(selected.occurred_at || selected.published_at || selected.discovered_at)}</strong></div><div><span>候选标签（非本体 ID）</span><strong>{selected.candidate_labels.join("、") || "待识别"}</strong></div></div>
          <div className="impact-section"><div className="panel-title"><div><span>对已有判断的影响</span><strong>{selectedImpacts.length}</strong></div>{selectedImpacts.length > 1 ? <small>先点选一条研究再操作</small> : null}</div>
            {selectedImpacts.length ? selectedImpacts.map((impact) => {
              const run = runMap.get(impact.run_id);
              const active = selectedImpact?.id === impact.id;
              return <button type="button" className={`impact-card impact-${impact.direction}${active ? " selected" : ""}`} key={impact.id} onClick={() => setSelectedImpactId(impact.id)} aria-pressed={active}>
                <div><span>{directionLabel[impact.direction]}</span><strong>{Math.round(impact.relevance * 100)}%</strong></div>
                <h3>{run?.question || impact.run_id}</h3>
                <p>{impact.rationale}</p>
                <small>{classificationLabel[impact.impact_classification || "evidence_update"]}</small>
                {impact.matched_condition ? <small>匹配条件：{impact.matched_condition}</small> : null}
              </button>;
            }) : <div className="focus-empty">这条事件尚未与已有判断建立可靠映射，只作为候选线索保留。</div>}
          </div>
          <div className="focus-actions">{selectedImpact ? <select value={classification} onChange={(event) => setClassification(event.target.value as typeof classification)} aria-label="影响分类"><option value="evidence_update">仅新增证据 · 从证据阶段开始</option><option value="structure_revision">判断结构变化 · 重开结构</option><option value="scope_revision">范围/问题变化 · 重开范围</option></select> : null}<button className="button" disabled={busy || !selectedImpact} onClick={startUpdate}>开启增量研究 →</button>{selectedImpact ? <Link className="button-secondary" href={`/runs/${selectedImpact.run_id}`}>查看原判断</Link> : null}</div>
        </> : <div className="radar-onboarding"><div className="eyebrow">使用流程</div><h2>从市场变化回到已有判断</h2><p>雷达不会替你下结论。它先定位可能受影响的判断，再让你决定是否开启一次不可变的增量研究。</p><ol><li><span>01</span><div><strong>刷新事件</strong><small>围绕研究对象、跟踪信号与失效条件检索。</small></div></li><li><span>02</span><div><strong>检查影响</strong><small>核验来源、时点、可信度与潜在影响方向。</small></div></li><li><span>03</span><div><strong>开启增量研究</strong><small>继承既有范围与结构，从证据阶段开始重审。</small></div></li></ol>{runs.length ? <Link className="button-secondary" href="/runs">查看全部研究 →</Link> : <Link className="button-secondary" href="/runs/new">提出第一个研究问题 →</Link>}</div>}
      </section>

      <aside className="radar-queue">
        <div className="panel-title"><div><span>我的下一步</span><strong>{workItems.length}</strong></div><small>待审阅事项</small></div>
        {workItems.length ? workItems.slice(0, 10).map((item) => <Link className={`queue-item priority-${item.priority}`} href={workItemLink(item)} key={item.id}><span>{stageLabel(item.stage)}</span><strong>{item.title}</strong><small>{runMap.get(item.run_id)?.question || item.target_id}</small></Link>) : <div className="queue-empty">当前没有待处理的审阅或补证任务。</div>}
      </aside>
    </div>

    <section className="research-index">
      <div className="section-head">
        <div>
          <div className="eyebrow">近期研究</div>
          <h2>最近在跟的问题</h2>
        </div>
        <Link className="section-meta research-index-link" href="/runs">查看全部 {runs.length} 条 →</Link>
      </div>
      {recentRuns.length ? (
        <div className="research-mini-grid">
          {recentRuns.map((run) => (
            <Link href={`/runs/${run.id}`} className="research-mini-card" key={run.id}>
              <div>
                <span>{run.domain === "semiconductor" ? "半导体" : "通用"}</span>
                <span>{run.parent_run_id ? "增量运行" : "原始研究"}</span>
              </div>
              <strong>{run.question}</strong>
              <small>阶段 {run.current_stage}/5 · {runStatusLabel(run.status)}</small>
            </Link>
          ))}
        </div>
      ) : (
        <div className="research-index-empty">
          <p>还没有研究项目。新建一条问题后，雷达才能对照已有判断跟踪变化。</p>
          <Link className="button-secondary" href="/runs/new">新建研究</Link>
        </div>
      )}
    </section>
  </>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function stageLabel(stage: string) {
  return ({ stage_01: "范围", stage_02: "结构", stage_03: "证据", stage_04: "判断", stage_05: "交付" } as Record<string, string>)[stage] || stage;
}

function workItemLink(item: ResearchWorkItem) {
  if (item.stage === "stage_03") return `/runs/${item.run_id}/evidence`;
  if (item.stage === "stage_04") return `/runs/${item.run_id}/judgments`;
  if (item.stage === "stage_05") return `/runs/${item.run_id}/report`;
  if (item.stage === "stage_02") return `/runs/${item.run_id}/structure`;
  return `/runs/${item.run_id}/stages/1`;
}
