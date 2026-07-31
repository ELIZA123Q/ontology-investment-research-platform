"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { prioritizeEvidenceGaps, type EvidenceReviewSuggestion } from "@/engine/evidence_review_assist";
import {
  evidenceChangeBadge,
  evidenceChangeIds,
  type EvidenceSupplementSummary,
} from "@/engine/evidence_supplement_view";
import { stripInternalReferencePrefix } from "@/engine/research_overview";

type ClientSource = {
  id: string;
  title: string;
  publisher: string;
  published_at: string | null;
  url: string;
  locator?: string;
  usability_status?: string;
  retrieval_status?: string;
  authority_type?: string;
  source_tier?: string;
  source_group?: string;
  quote_verified?: boolean;
  source_quote?: string;
  failure_detail?: string;
};

type ClientWorkItem = {
  id: string;
  run_id: string;
  kind: string;
  stage: string;
  target_type: string;
  target_id: string;
  title: string;
  status: string;
  priority: string;
  reason: string;
  note: string;
  resolution: string;
  artifact_id: string;
  attempt: number;
  created_at: string;
  updated_at: string;
  source_event_id: string | null;
};
import {
  authorityTypeLabel,
  confidenceLabel,
  directionLabel,
  directnessLabel,
  evidenceKindLabel,
  evidenceRoleLabel,
  reviewSuggestionLabel,
  retrievalLabel,
  sourceTierLabel,
  usabilityLabel,
  workItemStatusLabel,
} from "@/app/lib/ui-labels";

type Unit = { id: string; title: string; question: string };
type Evidence = {
  id: string;
  statement: string;
  kind: string;
  direction: string;
  directness?: string;
  source_ids: string[];
  judgment_unit_ids: string[];
  limitations: string[];
  requirement?: string;
  evidence_role?: string;
  minimum_independent_sources?: number;
};

const lanes = [
  { id: "support", label: "支持证据" },
  { id: "weaken", label: "反证 / 削弱" },
  { id: "conflict", label: "相互矛盾" },
  { id: "gap", label: "尚缺的证据" },
];

type ExtraGapPriority = {
  evidence_id: string;
  tier: "blocking" | "limiting" | "supplementary";
  label: "阻断主判断" | "限制判断强度" | "补充完善";
  statement: string;
  reason: string;
  score: number;
};

export function EvidenceBoard({
  runId,
  units,
  evidence,
  sources,
  workItems,
  suggestions,
  supplementSummary = null,
  artifactVersion,
  extraGapPriorities = [],
  ontologyPrecheckHints = [],
}: {
  runId: string;
  units: Unit[];
  evidence: Evidence[];
  sources: ClientSource[];
  workItems: ClientWorkItem[];
  suggestions: EvidenceReviewSuggestion[];
  supplementSummary?: EvidenceSupplementSummary | null;
  artifactVersion?: number;
  /** EvidenceProfile / 本体预检等只读缺口提示（不写入产物） */
  extraGapPriorities?: ExtraGapPriority[];
  ontologyPrecheckHints?: string[];
}) {
  const router = useRouter();
  const gapPriorities = useMemo(() => {
    const base = prioritizeEvidenceGaps({ evidence, workItems });
    const deduped = new Map<string, ExtraGapPriority>();
    for (const item of [...extraGapPriorities, ...base]) {
      const key = `${item.evidence_id}::${item.statement}`;
      if (!deduped.has(key)) deduped.set(key, item);
    }
    return [...deduped.values()]
      .sort((a, b) => b.score - a.score || a.evidence_id.localeCompare(b.evidence_id));
  }, [evidence, workItems, extraGapPriorities]);
  const coveragePriorities = gapPriorities.filter((item) => item.evidence_id.startsWith("PROFILE:"));
  const actualGapPriorities = gapPriorities.filter((item) => !item.evidence_id.startsWith("PROFILE:"));
  const uniqueOntologyPrecheckHints = useMemo(
    () => Array.from(new Set(ontologyPrecheckHints)),
    [ontologyPrecheckHints],
  );
  const changeIds = useMemo(() => evidenceChangeIds(supplementSummary), [supplementSummary]);
  const [selectedId, setSelectedId] = useState(actualGapPriorities[0]?.evidence_id || evidence[0]?.id || "");
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [unitFilter, setUnitFilter] = useState("all");
  // 补证后默认展示全量证据，避免收紧到只看待核对变更导致看不到完整上下文；
  // 顶部"本轮补证结果"面板（含新增/变更角标）已能提示本轮差异，用户需聚焦时再手动切换。
  const [focusChanges, setFocusChanges] = useState(false);
  const selected = evidence.find((item) => item.id === selectedId);
  const sourceMap = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources]);
  const suggestionMap = useMemo(() => new Map(suggestions.map((item) => [item.evidence_id, item])), [suggestions]);
  const workItem = workItems.find((item) => item.target_id === selectedId && ["evidence_review", "supplement_evidence", "resolve_conflict"].includes(item.kind));
  const terminalReview = workItem && ["approved", "dismissed", "superseded"].includes(workItem.status);
  const selectedSuggestion = selected && !terminalReview ? suggestionMap.get(selected.id) : undefined;

  useEffect(() => {
    if (!selected) {
      setReviewNote("");
      return;
    }
    if (terminalReview && workItem?.note) {
      setReviewNote(workItem.note);
      return;
    }
    const suggestion = suggestionMap.get(selected.id);
    setReviewNote(suggestion?.note || "");
  }, [selectedId, selected, terminalReview, workItem?.note, suggestionMap]);

  function laneFor(item: Evidence) {
    if (item.kind === "gap") return "gap";
    if (item.kind === "conflict") return "conflict";
    if (item.kind === "counter" || item.direction === "weaken") return "weaken";
    return "support";
  }

  function toggleChecked(id: string, checked: boolean) {
    setCheckedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAllPending(checked: boolean) {
    if (!checked) {
      setCheckedIds(new Set());
      return;
    }
    const pending = evidence.filter((item) => {
      const work = workItems.find((workItem) => workItem.target_id === item.id);
      return !work || work.status === "pending";
    });
    setCheckedIds(new Set(pending.map((item) => item.id)));
  }

  async function submitDecisions(items: Array<{ target_id: string; status: string; note: string; resolution: string }>) {
    if (!items.length) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/runs/${runId}/work-items/batch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items,
          evidence_kinds: Object.fromEntries(evidence.map((item) => [item.id, item.kind])),
        }),
      });
      const data = await response.json();
      if (!response.ok && response.status !== 207) throw new Error(data.error || "批量更新失败");
      const failed = (data.results || []).filter((item: { ok: boolean }) => !item.ok);
      if (failed.length) throw new Error(failed.map((item: { error?: string }) => item.error).filter(Boolean).join("；") || "部分条目更新失败");
      setCheckedIds(new Set());
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function decide(status: "approved" | "rework" | "dismissed") {
    if (!selected) return;
    if (reviewNote.trim().length < 8) {
      setError("请先留下至少 8 个字的核验依据。");
      return;
    }
    const resolution = status === "approved"
      ? selected.kind === "gap" ? "accepted_evidence_gap" : "accepted_evidence"
      : status === "rework" ? "rework_requested" : "rejected_evidence";
    await submitDecisions([{ target_id: selected.id, status, note: reviewNote.trim(), resolution }]);
  }

  function buildBatchItems(mode: "accept" | "accept_gap" | "rework" | "adopt_high") {
    const targets = checkedIds.size
      ? evidence.filter((item) => checkedIds.has(item.id))
      : evidence;
    const items: Array<{ target_id: string; status: string; note: string; resolution: string }> = [];
    for (const item of targets) {
      const work = workItems.find((workItem) => workItem.target_id === item.id);
      if (work && ["approved", "dismissed", "superseded"].includes(work.status)) continue;
      const suggestion = suggestionMap.get(item.id);
      if (mode === "adopt_high") {
        if (!suggestion || suggestion.confidence !== "high") continue;
        if (suggestion.suggestion === "accept_evidence") {
          items.push({ target_id: item.id, status: "approved", note: suggestion.note, resolution: "accepted_evidence" });
        } else if (suggestion.suggestion === "accept_gap" && item.kind === "gap") {
          items.push({ target_id: item.id, status: "approved", note: suggestion.note, resolution: "accepted_evidence_gap" });
        }
        continue;
      }
      const note = (suggestion?.note || reviewNote || "").trim();
      if (note.length < 8) continue;
      if (mode === "accept" && item.kind !== "gap") {
        items.push({ target_id: item.id, status: "approved", note, resolution: "accepted_evidence" });
      } else if (mode === "accept_gap" && item.kind === "gap") {
        items.push({ target_id: item.id, status: "approved", note, resolution: "accepted_evidence_gap" });
      } else if (mode === "rework") {
        items.push({ target_id: item.id, status: "rework", note, resolution: "rework_requested" });
      }
    }
    return items;
  }

  const pendingCount = evidence.filter((item) => {
    const work = workItems.find((workItem) => workItem.target_id === item.id);
    return !work || work.status === "pending";
  }).length;
  if (!units.length) return <div className="card empty-state"><h2>尚无证据任务</h2><p className="muted">完成结构阶段后，证据要求会按判断单元展开。</p></div>;

  const visibleEvidence = evidence.filter((item) => {
    if (unitFilter !== "all" && !item.judgment_unit_ids.includes(unitFilter)) return false;
    if (focusChanges && changeIds.size > 0 && !changeIds.has(item.id)) return false;
    return true;
  });
  const selectedUnits = selected
    ? units.filter((unit) => selected.judgment_unit_ids.includes(unit.id))
    : [];
  const pendingChangeCount = evidence.filter((item) => {
    if (!changeIds.has(item.id)) return false;
    const work = workItems.find((workItem) => workItem.target_id === item.id);
    return !work || work.status === "pending" || work.status === "rework";
  }).length;
  const displayEvidenceStatement = (item: Evidence, maxLength = 220) => {
    const statement = stripInternalReferencePrefix(item.statement).replace(/\s+/g, " ").trim();
    if (statement.length <= maxLength) return statement;
    const primarySource = item.source_ids.length === 1 ? sourceMap.get(item.source_ids[0]) : undefined;
    const sourceTitle = primarySource?.title?.replace(/\s+/g, " ").trim();
    if (sourceTitle && sourceTitle.length <= maxLength) return sourceTitle;
    return `${statement.slice(0, maxLength).trimEnd()}…`;
  };

  return <div className="evidence-review-section">
    {supplementSummary ? (
      <section className={`supplement-result-panel${supplementSummary.zero_material_change ? " empty" : ""}`}>
        <div className="supplement-result-head">
          <div>
            <span>本轮补证结果{artifactVersion ? ` · 第 ${artifactVersion} 版` : ""}</span>
            <strong>{supplementSummary.headline}</strong>
          </div>
          {changeIds.size > 0 ? (
            <button
              type="button"
              className="button-secondary"
              onClick={() => setFocusChanges((value) => !value)}
            >
              {focusChanges ? "查看全部证据" : `只看待核对变更（${pendingChangeCount}）`}
            </button>
          ) : null}
        </div>
        {supplementSummary.detail_lines.length ? (
          <ul className="supplement-result-meta">
            {supplementSummary.detail_lines.map((line) => <li key={line}>{line}</li>)}
          </ul>
        ) : null}
        <p className="muted">
          {supplementSummary.zero_material_change
            ? "点了补证不等于一定补到材料。可再跑一轮，或在下方接受尚缺并限制结论。"
            : "变更项默认待核对；未改动且上一版已确认的条目会继承审阅状态。批量确认是签字放行，不是再取证。"}
        </p>
      </section>
    ) : null}
    {uniqueOntologyPrecheckHints.length ? <section className="gap-priority-panel ontology-precheck-panel">
      <div className="gap-priority-head"><div><span>判断前口径核对</span><strong>{Math.min(3, uniqueOntologyPrecheckHints.length)} 项可能限制结论强度</strong></div><small>这是证据阶段的预检提示；判断阶段会按正式规则重算，未补齐时可能限制强度或退回补证。</small></div>
      <ul className="gap-priority-list">{uniqueOntologyPrecheckHints.slice(0, 3).map((hint, index) => <li key={`${index}:${hint}`}><small>{hint.replace(/^将在判断确认时挡门：/, "")}</small></li>)}</ul>
    </section> : null}
    {coveragePriorities.length ? <section className="gap-priority-panel">
      <div className="gap-priority-head"><div><span>最低证据组合</span><strong>{Math.min(3, coveragePriorities.length)} 项覆盖限制</strong></div><small>这些要求来自关键变量的最低证据组合，不等同于已经登记的“尚缺证据”；补齐后才能提高判断上限。</small></div>
      <div className="gap-priority-list">{coveragePriorities.slice(0, 3).map((item, index) => <div className="gap-priority-static" key={`${item.evidence_id}:${item.statement}`}><b>{index + 1}</b><div><span className={`gap-tier tier-${item.tier}`}>{item.label}</span><strong>{item.statement}</strong><small>{item.reason}</small></div></div>)}</div>
    </section> : null}
    {actualGapPriorities.length ? <section className="gap-priority-panel">
      <div className="gap-priority-head"><div><span>优先补证</span><strong>先处理最影响判断的 {Math.min(3, actualGapPriorities.length)} 项已登记缺口</strong></div><small>只展示证据稿中已经登记的尚缺、冲突或待处理事项。</small></div>
      <div className="gap-priority-list">{actualGapPriorities.slice(0, 3).map((item, index) => <button className={selectedId === item.evidence_id ? "selected" : ""} key={`${item.evidence_id}:${item.statement}`} onClick={() => setSelectedId(item.evidence_id)} type="button"><b>{index + 1}</b><div><span className={`gap-tier tier-${item.tier}`}>{item.label}</span><strong>{item.statement}</strong><small>{item.reason}</small></div></button>)}</div>
    </section> : null}
    <div className="evidence-review-toolbar">
      <div className="review-batch-actions">
        <label className="unit-filter">
          <span>判断单元</span>
          <select value={unitFilter} onChange={(event) => setUnitFilter(event.target.value)} aria-label="按判断单元过滤">
            <option value="all">全部单元</option>
            {units.map((unit, index) => (
              <option key={unit.id} value={unit.id}>关键判断 {index + 1} · {stripInternalReferencePrefix(unit.title)}</option>
            ))}
          </select>
        </label>
        {pendingCount ? <>
          <span className="section-meta">待核对 {pendingCount} · 已选 {checkedIds.size}</span>
          <label className="batch-select-all"><input type="checkbox" checked={checkedIds.size > 0 && checkedIds.size === pendingCount} onChange={(event) => toggleAllPending(event.target.checked)} /> 全选待核对</label>
          <button type="button" className="button-secondary" disabled={busy} onClick={() => submitDecisions(buildBatchItems("adopt_high"))} title="只采纳系统已给出理由的高置信建议">采纳高置信建议</button>
          <button type="button" className="button-secondary" disabled={busy || !checkedIds.size} onClick={() => submitDecisions(buildBatchItems("accept"))} title="对已勾选的事实草稿签字放行；不会再去取源">批量确认已选事实</button>
          <button type="button" className="button-secondary" disabled={busy || !checkedIds.size} onClick={() => submitDecisions(buildBatchItems("accept_gap"))} title="明确接受尚缺，后续判断必须受边界约束">批量接受尚缺（限制结论）</button>
          <button type="button" className="button-quiet" disabled={busy || !checkedIds.size} onClick={() => submitDecisions(buildBatchItems("rework"))}>批量退回修改</button>
        </> : null}
      </div>
    </div>

    <div className="evidence-workspace">
      <div className="evidence-list-wrap">
        {lanes.map((lane) => {
          const laneEvidence = visibleEvidence.filter((item) => laneFor(item) === lane.id);
          if (!laneEvidence.length) return null;
          return <section className={`evidence-lane-section lane-${lane.id}`} key={lane.id}>
            <header><strong>{lane.label}</strong><span>{laneEvidence.length} 项</span></header>
            <div className="evidence-list">
              {laneEvidence.map((item) => {
                const itemWork = workItems.find((work) => work.target_id === item.id);
                const terminal = itemWork && ["approved", "dismissed", "superseded"].includes(itemWork.status);
                const suggestion = terminal ? undefined : suggestionMap.get(item.id);
                const relatedUnits = units.filter((unit) => item.judgment_unit_ids.includes(unit.id));
                const changeBadge = evidenceChangeBadge(item.id, supplementSummary);
                const cardStatement = displayEvidenceStatement(item);
                return <div className={`evidence-list-card lane-${lane.id} ${selectedId === item.id ? "selected" : ""}${changeBadge ? ` change-${changeBadge}` : ""}`} key={item.id}>
                  <label className="evidence-card-check" aria-label={`选择 ${cardStatement}`}><input type="checkbox" checked={checkedIds.has(item.id)} onChange={(event) => toggleChecked(item.id, event.target.checked)} /></label>
                  <button onClick={() => setSelectedId(item.id)} type="button">
                    <div className="evidence-list-meta">
                      <span>{evidenceKindLabel(item.kind)}</span>
                      <span>{workItemStatusLabel(itemWork?.status || "pending")}</span>
                      <span>{item.source_ids.length ? `${item.source_ids.length} 个来源` : "尚无来源"}</span>
                      {changeBadge === "added" ? <span className="change-badge added">本轮新增</span> : null}
                      {changeBadge === "changed" ? <span className="change-badge changed">本轮变更</span> : null}
                    </div>
                    <strong>{cardStatement}</strong>
                    <div className="evidence-related-units">
                      <span>影响</span>
                      {relatedUnits.length
                        ? relatedUnits.map((unit) => <em key={unit.id}>{stripInternalReferencePrefix(unit.title)}</em>)
                        : <em>研究背景</em>}
                    </div>
                    {suggestion ? <small className={`suggestion-chip confidence-${suggestion.confidence}`}>{reviewSuggestionLabel(suggestion.suggestion)}</small> : null}
                  </button>
                </div>;
              })}
            </div>
          </section>;
        })}
        {!visibleEvidence.length ? <div className="empty-state"><h2>没有符合筛选条件的证据</h2><p className="muted">{focusChanges ? "本轮没有可筛选的变更项，可切换查看全部。" : "切换关键判断查看其他证据。"}</p></div> : null}
      </div>
      <aside className="evidence-inspector">
        <div className="eyebrow">证据详情</div>
        <h2>{selected ? displayEvidenceStatement(selected, 280) : "选择一项证据"}</h2>
        {selected ? <>
          <div className="inspector-tags">
            <span className={`semantic-key lane-${laneFor(selected)}`}>{lanes.find((lane) => lane.id === laneFor(selected))?.label}</span>
            <span className="semantic-key">{workItemStatusLabel(workItem?.status || "pending")}</span>
            <span className="semantic-key">{evidenceKindLabel(selected.kind)}</span>
            <span className="semantic-key">{directionLabel(selected.direction)}</span>
            {selected.directness ? <span className="semantic-key">{directnessLabel(selected.directness)}</span> : null}
          </div>

          {selectedSuggestion ? <div className={`review-suggestion confidence-${selectedSuggestion.confidence}`}>
            <strong>{reviewSuggestionLabel(selectedSuggestion.suggestion)}</strong>
            <span>置信 {confidenceLabel(selectedSuggestion.confidence)}</span>
            <ul>{selectedSuggestion.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
          </div> : null}

          {selected.kind === "gap" ? <dl className="evidence-attr-grid">
            <div><dt>尚缺要求</dt><dd>{stripInternalReferencePrefix(selected.requirement || selected.statement)}</dd></div>
            {selected.evidence_role ? <div><dt>证据角色</dt><dd>{evidenceRoleLabel(selected.evidence_role)}</dd></div> : null}
            {selected.minimum_independent_sources !== undefined ? <div><dt>最低独立来源</dt><dd>{selected.minimum_independent_sources}</dd></div> : null}
          </dl> : null}

          {stripInternalReferencePrefix(selected.statement).replace(/\s+/g, " ").trim().length > 280 ? (
            <details className="evidence-full-statement">
              <summary>查看完整事实表述</summary>
              <p>{stripInternalReferencePrefix(selected.statement)}</p>
            </details>
          ) : null}

          <div className="evidence-trace" aria-label="证据追溯路径">
            <span>来源</span><b>→</b><span>逐字引文</span><b>→</b><span>已确认事实</span><b>→</b><span>关键判断</span>
          </div>

          <h3>影响哪些判断</h3>
          {selectedUnits.length ? <ul className="evidence-related-list">
            {selectedUnits.map((unit) => <li key={unit.id}>{stripInternalReferencePrefix(unit.title)}</li>)}
          </ul> : <p className="muted">该项仅作为研究背景，尚未绑定关键判断。</p>}

          <h3>来源与逐字引文</h3>
          {selected.source_ids.length ? <ul className="source-list">{selected.source_ids.map((id) => {
            const source = sourceMap.get(id);
            return <li key={id}>{source ? <>
              <div className="source-review-head">
                {/^https?:\/\//i.test(source.url || "") ? (
                  <a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a>
                ) : (
                  <span className="source-title-no-link">{source.title} <small className="mcp-note">（MCP 快照，无可点击原文；靠快照字段复核）</small></span>
                )}
                <small className="source-publisher">
                  {source.publisher || "未识别发布者"}
                  {source.published_at ? ` · ${formatSourceTime(source.published_at)}` : ""}
                </small>
              </div>
              <div className="source-review-status">
                <span>{source.quote_verified ? "逐字引文已核验" : "逐字引文待核验"}</span>
                {source.locator ? <span>定位：{source.locator}</span> : null}
              </div>
              {source.source_quote ? (
                <details className="source-quote" open={source.source_quote.length <= 360}>
                  <summary>查看逐字引文</summary>
                  <blockquote>{source.source_quote}</blockquote>
                </details>
              ) : <p className="muted">尚未登记可复核逐字引文。</p>}
              <details className="source-tech-details">
                <summary>技术字段</summary>
                <small>
                  {authorityTypeLabel(source.authority_type || "unknown")} · {sourceTierLabel(source.source_tier || "S8")} · 独立来源组 {source.source_group || "未登记"}
                  · {usabilityLabel(source.usability_status || "")} / {retrievalLabel(source.retrieval_status || "")}
                  · 引用 {source.quote_verified ? "已验证" : "未验证"}
                </small>
              </details>
            </> : id}</li>;
          })}</ul> : <p className="muted">尚未挂到来源；只能登记为尚缺的证据，不能确认事实。</p>}

          <h3>局限</h3><p>{selected.limitations.join("；") || "暂无已登记局限"}</p>
          <div className="field"><label>人工核验记录</label><textarea value={reviewNote} disabled={Boolean(terminalReview)} onChange={(event) => setReviewNote(event.target.value)} placeholder={selected.kind === "gap" ? "说明为何确认当前暂缺，以及结论必须停在什么边界" : "说明已核对的原文、口径、时间和局限"} /></div>
          <div className="review-actions">
            <button className="button" disabled={busy || Boolean(terminalReview)} onClick={() => decide("approved")} type="button">{selected.kind === "gap" ? "确认暂缺（限制结论）" : "确认可用"}</button>
            <button className="button-secondary" disabled={busy || Boolean(terminalReview)} onClick={() => decide("rework")} type="button">退回修改</button>
            <button className="button-quiet" disabled={busy || Boolean(terminalReview)} onClick={() => decide("dismissed")} type="button">驳回</button>
          </div>
          {terminalReview ? <p className="muted">该审阅已结束；如需改变结论，请重新生成稿件，旧审阅任务会自动作废并由新版本取代。</p> : null}
          {error ? <div className="notice error">{error}</div> : null}
        </> : null}
      </aside>
    </div>
  </div>;
}

function formatSourceTime(value: string) {
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return value;
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(ts));
}
