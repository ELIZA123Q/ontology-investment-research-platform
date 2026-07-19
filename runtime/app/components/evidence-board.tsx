"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ResearchWorkItem, SourceRecord } from "@/engine/types";

type Unit = { id: string; title: string; question: string };
type Evidence = { id: string; statement: string; kind: string; direction: string; source_ids: string[]; judgment_unit_ids: string[]; limitations: string[] };

const lanes = [
  { id: "support", label: "支持证据" },
  { id: "weaken", label: "反证 / 削弱" },
  { id: "conflict", label: "冲突" },
  { id: "gap", label: "缺口" },
];

export function EvidenceBoard({ runId, units, evidence, sources, workItems }: { runId: string; units: Unit[]; evidence: Evidence[]; sources: SourceRecord[]; workItems: ResearchWorkItem[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(evidence[0]?.id || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const selected = evidence.find((item) => item.id === selectedId);
  const sourceMap = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources]);
  const workItem = workItems.find((item) => item.target_id === selectedId && ["evidence_review", "supplement_evidence", "resolve_conflict"].includes(item.kind));
  const terminalReview = workItem && ["approved", "dismissed", "superseded"].includes(workItem.status);

  function laneFor(item: Evidence) {
    if (item.kind === "gap") return "gap";
    if (item.kind === "conflict") return "conflict";
    if (item.kind === "counter" || item.direction === "weaken") return "weaken";
    return "support";
  }

  async function decide(status: "approved" | "rework" | "dismissed") {
    if (!selected) return;
    if (reviewNote.trim().length < 8) {
      setError("请先留下至少 8 个字的核验依据。");
      return;
    }
    setBusy(true); setError("");
    try {
      let itemId = workItem?.id;
      if (!itemId) {
        const create = await fetch(`/api/runs/${runId}/work-items`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
          kind: selected.kind === "gap" ? "supplement_evidence" : selected.kind === "conflict" ? "resolve_conflict" : "evidence_review",
          stage: "stage_03", target_type: "EvidenceDraft", target_id: selected.id,
          title: `${selected.kind === "gap" ? "补齐" : "审阅"}：${selected.statement}`,
          priority: selected.kind === "gap" || selected.kind === "conflict" ? "high" : "medium",
          reason: selected.limitations.join("；"), payload: { direction: selected.direction, judgment_unit_ids: selected.judgment_unit_ids },
        }) });
        const created = await create.json();
        if (!create.ok) throw new Error(created.error || "创建工作项失败");
        itemId = created.id;
      }
      const resolution = status === "approved"
        ? selected.kind === "gap" ? "accepted_evidence_gap" : "accepted_evidence"
        : status === "rework" ? "rework_requested" : "rejected_evidence";
      const response = await fetch(`/api/runs/${runId}/work-items/${itemId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status, note: reviewNote.trim(), resolution }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "更新失败");
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  if (!units.length) return <div className="card empty-state"><h2>尚无证据任务</h2><p className="muted">完成结构阶段后，证据要求会按判断单元展开。</p></div>;
  return <div className="evidence-workspace">
    <div className="evidence-matrix-wrap">
      <div className="evidence-matrix" style={{ gridTemplateColumns: `138px repeat(${units.length}, minmax(250px, 1fr))` }}>
        <div className="matrix-corner">证据角色</div>
        {units.map((unit) => <div className="matrix-unit" key={unit.id}><span>{unit.id}</span><strong>{unit.title}</strong><small>{unit.question}</small></div>)}
        {lanes.map((lane) => <div className="matrix-row" key={lane.id} style={{ display: "contents" }}>
          <div className={`matrix-lane lane-${lane.id}`}>{lane.label}</div>
          {units.map((unit) => <div className="matrix-cell" key={`${lane.id}:${unit.id}`}>
            {evidence.filter((item) => item.judgment_unit_ids.includes(unit.id) && laneFor(item) === lane.id).map((item) => {
              const itemWork = workItems.find((work) => work.target_id === item.id);
              return <button className={`evidence-card lane-${lane.id} ${selectedId === item.id ? "selected" : ""}`} onClick={() => setSelectedId(item.id)} key={item.id}>
                <span>{item.kind}</span><strong>{item.statement}</strong><small>{itemWork?.status || "待审阅"} · 来源 {item.source_ids.length}</small>
              </button>;
            })}
          </div>)}
        </div>)}
      </div>
    </div>
    <aside className="evidence-inspector">
      <div className="eyebrow">Evidence inspector</div>
      <h2>{selected?.statement || "选择一项证据"}</h2>
      {selected ? <>
        <div className="inspector-tags"><span className={`semantic-key lane-${laneFor(selected)}`}>{laneFor(selected)}</span><span className="semantic-key">{workItem?.status || "待审阅"}</span></div>
        <h3>来源</h3>
        {selected.source_ids.length ? <ul className="source-list">{selected.source_ids.map((id) => { const source = sourceMap.get(id); return <li key={id}>{source ? <><a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a><small>等级 {source.source_tier || "S8"} · 独立组 {source.source_group || "未登记"} · 可用性 {source.usability_status || "未评估"} · 正文 {source.retrieval_status || "未抓取"} · 引用定位 {source.quote_verified ? "已验证" : "未验证"} · 定位 {source.locator || source.url} · 抓取 {source.captured_at || source.accessed_at} · hash {(source.content_hash || "未记录").slice(0, 12)}</small>{source.source_quote ? <blockquote>{source.source_quote}</blockquote> : null}{source.failure_detail ? <small className="error-text">{source.failure_detail}</small> : null}</> : id}</li>; })}</ul> : <p className="muted">未绑定来源；只能作为明确的证据缺口，不能确认事实。</p>}
        <h3>局限</h3><p>{selected.limitations.join("；") || "暂无已登记局限"}</p>
        <div className="field"><label>人工核验记录</label><textarea value={reviewNote} disabled={Boolean(terminalReview)} onChange={(event) => setReviewNote(event.target.value)} placeholder={selected.kind === "gap" ? "说明为何接受当前缺口，以及结论必须停在什么边界" : "说明已核对的原文、口径、时间和局限"} /></div>
        <div className="review-actions"><button className="button" disabled={busy || Boolean(terminalReview)} onClick={() => decide("approved")}>{selected.kind === "gap" ? "接受缺口（维持 J0）" : "确认可用"}</button><button className="button-secondary" disabled={busy || Boolean(terminalReview)} onClick={() => decide("rework")}>退回补证</button><button className="button-quiet" disabled={busy || Boolean(terminalReview)} onClick={() => decide("dismissed")}>驳回并重生成</button></div>
        {terminalReview ? <p className="muted">该审阅已收敛；如需改变结论，请重新生成产物，让旧工作项自动 supersede。</p> : null}
        {error ? <div className="notice error">{error}</div> : null}
        <details className="advanced-audit"><summary>高级审计字段</summary><pre>{JSON.stringify(selected, null, 2)}</pre></details>
      </> : null}
    </aside>
  </div>;
}
