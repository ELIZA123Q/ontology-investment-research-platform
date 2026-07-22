"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { prioritizeEvidenceGaps, type EvidenceReviewSuggestion } from "@/engine/evidence_review_assist";
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
  { id: "conflict", label: "冲突" },
  { id: "gap", label: "缺口" },
];

export function EvidenceBoard({
  runId,
  units,
  evidence,
  sources,
  workItems,
  suggestions,
}: {
  runId: string;
  units: Unit[];
  evidence: Evidence[];
  sources: ClientSource[];
  workItems: ClientWorkItem[];
  suggestions: EvidenceReviewSuggestion[];
}) {
  const router = useRouter();
  const gapPriorities = useMemo(() => prioritizeEvidenceGaps({ evidence, workItems }), [evidence, workItems]);
  const [selectedId, setSelectedId] = useState(gapPriorities[0]?.evidence_id || evidence[0]?.id || "");
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [unitFilter, setUnitFilter] = useState("all");
  const selected = evidence.find((item) => item.id === selectedId);
  const sourceMap = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources]);
  const suggestionMap = useMemo(() => new Map(suggestions.map((item) => [item.evidence_id, item])), [suggestions]);
  const workItem = workItems.find((item) => item.target_id === selectedId && ["evidence_review", "supplement_evidence", "resolve_conflict"].includes(item.kind));
  const terminalReview = workItem && ["approved", "dismissed", "superseded"].includes(workItem.status);
  const selectedSuggestion = selected ? suggestionMap.get(selected.id) : undefined;

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
  const approvedCount = evidence.filter((item) => {
    const work = workItems.find((workItem) => workItem.target_id === item.id);
    return work?.status === "approved";
  }).length;
  const gapAcceptedCount = evidence.filter((item) => {
    const work = workItems.find((workItem) => workItem.target_id === item.id);
    return item.kind === "gap" && work?.status === "approved";
  }).length;

  if (!units.length) return <div className="card empty-state"><h2>尚无证据任务</h2><p className="muted">完成结构阶段后，证据要求会按判断单元展开。</p></div>;

  const visibleUnits = unitFilter === "all" ? units : units.filter((unit) => unit.id === unitFilter);

  return <div className="evidence-review-section">
    {gapPriorities.length ? <section className="gap-priority-panel">
      <div className="gap-priority-head"><div><span>优先补证</span><strong>先处理最影响判断的 {Math.min(3, gapPriorities.length)} 个缺口</strong></div><small>排序依据：判断绑定、冲突程度、独立来源要求与审阅状态</small></div>
      <div className="gap-priority-list">{gapPriorities.slice(0, 3).map((item, index) => <button className={selectedId === item.evidence_id ? "selected" : ""} key={item.evidence_id} onClick={() => setSelectedId(item.evidence_id)} type="button"><b>{index + 1}</b><div><span className={`gap-tier tier-${item.tier}`}>{item.label}</span><strong>{item.statement}</strong><small>{item.reason}</small></div></button>)}</div>
    </section> : null}
    <div className="evidence-review-toolbar">
      <div className="run-meta">
        <span>待审 {pendingCount}</span>
        <span>已确认 {approvedCount}</span>
        <span>缺口已接受 {gapAcceptedCount}</span>
        <span>已选 {checkedIds.size}</span>
      </div>
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
        <label className="batch-select-all"><input type="checkbox" checked={checkedIds.size > 0 && checkedIds.size === pendingCount} onChange={(event) => toggleAllPending(event.target.checked)} /> 全选待审</label>
        <button type="button" className="button-secondary" disabled={busy} onClick={() => submitDecisions(buildBatchItems("adopt_high"))}>采纳高置信建议</button>
        <button type="button" className="button-secondary" disabled={busy || !checkedIds.size} onClick={() => submitDecisions(buildBatchItems("accept"))}>批量确认</button>
        <button type="button" className="button-secondary" disabled={busy || !checkedIds.size} onClick={() => submitDecisions(buildBatchItems("accept_gap"))}>批量接受缺口</button>
        <button type="button" className="button-quiet" disabled={busy || !checkedIds.size} onClick={() => submitDecisions(buildBatchItems("rework"))}>批量退回</button>
      </div>
    </div>

    <div className="evidence-workspace">
      <div className="evidence-matrix-wrap">
        <div className="evidence-matrix" style={{ gridTemplateColumns: `170px repeat(${visibleUnits.length}, minmax(250px, 1fr))` }}>
          <div className="matrix-corner">证据角色</div>
          {visibleUnits.map((unit, index) => {
            const originalIndex = units.findIndex((item) => item.id === unit.id);
            return <div className="matrix-unit" key={unit.id}><span>关键判断 {originalIndex + 1}</span><strong>{stripInternalReferencePrefix(unit.title)}</strong><small>{stripInternalReferencePrefix(unit.question)}</small></div>;
          })}
          {lanes.map((lane) => <div className="matrix-row" key={lane.id} style={{ display: "contents" }}>
            <div className={`matrix-lane lane-${lane.id}`}>{lane.label}</div>
            {visibleUnits.map((unit) => <div className="matrix-cell" key={`${lane.id}:${unit.id}`}>
              {evidence.filter((item) => item.judgment_unit_ids.includes(unit.id) && laneFor(item) === lane.id).map((item) => {
                const itemWork = workItems.find((work) => work.target_id === item.id);
                const suggestion = suggestionMap.get(item.id);
                return <div className={`evidence-card-wrap ${selectedId === item.id ? "selected" : ""}`} key={item.id}>
                  <label className="evidence-card-check"><input type="checkbox" checked={checkedIds.has(item.id)} onChange={(event) => toggleChecked(item.id, event.target.checked)} /></label>
                  <button className={`evidence-card lane-${lane.id}`} onClick={() => setSelectedId(item.id)} type="button">
                    <span>{evidenceKindLabel(item.kind)}</span>
                    <strong>{stripInternalReferencePrefix(item.statement)}</strong>
                    <small>{workItemStatusLabel(itemWork?.status || "pending")} · 来源 {item.source_ids.length}</small>
                    {suggestion ? <em className={`suggestion-chip confidence-${suggestion.confidence}`}>{reviewSuggestionLabel(suggestion.suggestion)}</em> : null}
                  </button>
                </div>;
              })}
            </div>)}
          </div>)}
        </div>
      </div>
      <aside className="evidence-inspector">
        <div className="eyebrow">证据详情</div>
        <h2>{selected ? stripInternalReferencePrefix(selected.statement) : "选择一项证据"}</h2>
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
            <div><dt>缺口要求</dt><dd>{stripInternalReferencePrefix(selected.requirement || selected.statement)}</dd></div>
            {selected.evidence_role ? <div><dt>证据角色</dt><dd>{evidenceRoleLabel(selected.evidence_role)}</dd></div> : null}
            {selected.minimum_independent_sources !== undefined ? <div><dt>最低独立来源</dt><dd>{selected.minimum_independent_sources}</dd></div> : null}
          </dl> : null}

          <h3>来源</h3>
          {selected.source_ids.length ? <ul className="source-list">{selected.source_ids.map((id) => {
            const source = sourceMap.get(id);
            return <li key={id}>{source ? <>
              <a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a>
              <small className="source-publisher">
                {source.publisher || "未识别发布者"}
                {source.published_at ? ` · ${formatSourceTime(source.published_at)}` : ""}
              </small>
              {source.source_quote ? <blockquote>{source.source_quote}</blockquote> : null}
              <details className="source-tech-details">
                <summary>技术字段</summary>
                <small>
                  {authorityTypeLabel(source.authority_type || "unknown")} · 等级 {source.source_tier || "S8"} · 独立组 {source.source_group || "未登记"}
                  · {usabilityLabel(source.usability_status || "")} / {retrievalLabel(source.retrieval_status || "")}
                  · 引用 {source.quote_verified ? "已验证" : "未验证"}
                </small>
              </details>
            </> : id}</li>;
          })}</ul> : <p className="muted">尚未挂到来源；只能作为明确的证据缺口，不能确认事实。</p>}

          <h3>局限</h3><p>{selected.limitations.join("；") || "暂无已登记局限"}</p>
          <div className="field"><label>人工核验记录</label><textarea value={reviewNote} disabled={Boolean(terminalReview)} onChange={(event) => setReviewNote(event.target.value)} placeholder={selected.kind === "gap" ? "说明为何接受当前缺口，以及结论必须停在什么边界" : "说明已核对的原文、口径、时间和局限"} /></div>
          <div className="review-actions">
            <button className="button" disabled={busy || Boolean(terminalReview)} onClick={() => decide("approved")} type="button">{selected.kind === "gap" ? "接受缺口（暂不形成方向判断）" : "确认可用"}</button>
            <button className="button-secondary" disabled={busy || Boolean(terminalReview)} onClick={() => decide("rework")} type="button">退回补证</button>
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
