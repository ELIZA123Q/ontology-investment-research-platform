"use client";

import { useEffect, useMemo, useState } from "react";

type CandidateStatus = "pending" | "expert_confirmed" | "promoted" | "rejected";

type Candidate = {
  candidate_key: string;
  name: string;
  category: string;
  variable_kind: string;
  occurrence_count: number;
  run_count: number;
  cross_task_reused: boolean;
  questions: string[];
  domains: string[];
  variable_ids: string[];
  definitions: string[];
  review: {
    status: CandidateStatus;
    expert_name: string;
    decision_note: string;
    target_ontology_node_id: string;
    reviewed_at: string | null;
    updated_at: string;
  };
  review_events: Array<{
    id: string;
    prior_status: CandidateStatus;
    next_status: CandidateStatus;
    expert_name: string;
    decision_note: string;
    target_ontology_node_id: string;
    created_at: string;
  }>;
};

const STATUS_LABELS: Record<CandidateStatus, string> = {
  pending: "待专家确认",
  expert_confirmed: "缺口已确认",
  promoted: "已登记晋升",
  rejected: "已驳回",
};

export function OntologyCandidateQueue() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [expertName, setExpertName] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [targetId, setTargetId] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  async function load(preferredKey?: string) {
    setBusy(true);
    setError("");
    const response = await fetch("/api/ontology/candidates");
    const json = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(json.error || "读取本体候选失败");
      return;
    }
    const next = (json.candidates || []) as Candidate[];
    setCandidates(next);
    setSelectedKey((current) => preferredKey || current || next[0]?.candidate_key || "");
  }

  useEffect(() => { load(); }, []);

  const selected = useMemo(
    () => candidates.find((candidate) => candidate.candidate_key === selectedKey) || null,
    [candidates, selectedKey],
  );

  useEffect(() => {
    if (!selected) return;
    setExpertName(selected.review.expert_name || "");
    setDecisionNote(selected.review.decision_note || "");
    setTargetId(selected.review.target_ontology_node_id || "");
  }, [selectedKey, selected?.review.updated_at]);

  async function decide(status: CandidateStatus) {
    if (!selected) return;
    setBusy(true);
    setError("");
    const response = await fetch(`/api/ontology/candidates/${encodeURIComponent(selected.candidate_key)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        status,
        expert_name: expertName,
        decision_note: decisionNote,
        target_ontology_node_id: targetId,
      }),
    });
    const json = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(json.error || "保存专家决策失败");
      return;
    }
    await load(selected.candidate_key);
  }

  const pendingCount = candidates.filter((candidate) => candidate.review.status === "pending").length;
  const reusedCount = candidates.filter((candidate) => candidate.cross_task_reused).length;
  const decidedCount = candidates.length - pendingCount;

  return (
    <section className="ontology-governance">
      <div className="ontology-governance-metrics">
        <article><strong>{candidates.length}</strong><span>当前 task_local 候选</span></article>
        <article><strong>{reusedCount}</strong><span>跨任务重复出现</span></article>
        <article><strong>{pendingCount}</strong><span>等待专家确认</span></article>
        <article><strong>{decidedCount}</strong><span>已有治理决定</span></article>
      </div>
      <div className="ontology-governance-note">
        <strong>晋升不会自动改写正式本体</strong>
        <span>这里记录证据频次、专家判断和拟正式 ID；正式 YAML 仍需由本体维护流程单独评审、校验和发布。</span>
      </div>
      {error ? <div className="notice error">{error}</div> : null}
      <div className="ontology-governance-layout">
        <aside className="card ontology-candidate-list">
          <div className="panel-title"><h3>本体缺口队列</h3><span>{busy ? "更新中" : `${candidates.length} 项`}</span></div>
          {candidates.map((candidate) => (
            <button
              className={candidate.candidate_key === selectedKey ? "active" : ""}
              key={candidate.candidate_key}
              onClick={() => setSelectedKey(candidate.candidate_key)}
              type="button"
            >
              <span className={`candidate-status ${candidate.review.status}`}>{STATUS_LABELS[candidate.review.status]}</span>
              <strong>{candidate.name}</strong>
              <small>{candidate.run_count} 个研究 · {candidate.occurrence_count} 次出现</small>
            </button>
          ))}
          {!busy && !candidates.length ? <p className="muted">当前研究产物没有 task_local 候选。</p> : null}
        </aside>
        <article className="card ontology-candidate-detail">
          {selected ? (
            <>
              <div className="section-heading">
                <div>
                  <div className="eyebrow">候选语义</div>
                  <h2>{selected.name}</h2>
                  <p className="muted">{selected.category} · {selected.variable_kind} · {selected.candidate_key}</p>
                </div>
                <span className={`badge candidate-status ${selected.review.status}`}>{STATUS_LABELS[selected.review.status]}</span>
              </div>
              <dl className="candidate-evidence-grid">
                <div><dt>跨任务频次</dt><dd>{selected.run_count} 个研究 / {selected.occurrence_count} 次</dd></div>
                <div><dt>覆盖领域</dt><dd>{selected.domains.join("、") || "—"}</dd></div>
                <div><dt>变量编号</dt><dd>{selected.variable_ids.join("、") || "—"}</dd></div>
                <div><dt>复用判断</dt><dd>{selected.cross_task_reused ? "已跨任务重复，优先评审" : "暂为单任务证据"}</dd></div>
              </dl>
              <h3>出现在哪些研究</h3>
              <ul className="source-list">
                {selected.questions.slice(0, 8).map((question) => <li key={question}>{question}</li>)}
              </ul>
              <h3>定义变体</h3>
              <ul className="source-list">
                {selected.definitions.map((definition) => <li key={definition}>{definition}</li>)}
              </ul>
              <div className="ontology-review-form">
                <div className="field">
                  <label>专家 / 本体维护人</label>
                  <input value={expertName} onChange={(event) => setExpertName(event.target.value)} placeholder="至少 2 个字符" />
                </div>
                <div className="field">
                  <label>判断理由</label>
                  <textarea value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} placeholder="说明稳定性、跨任务价值、边界或驳回原因（至少 8 字）" />
                </div>
                <div className="field">
                  <label>拟正式本体 ID（仅晋升时必填）</label>
                  <input value={targetId} onChange={(event) => setTargetId(event.target.value)} placeholder="例如 depreciation_intensity" />
                </div>
                <div className="actions">
                  <button className="button-secondary" disabled={busy} onClick={() => decide("expert_confirmed")} type="button">确认这是本体缺口</button>
                  <button className="button" disabled={busy} onClick={() => decide("promoted")} type="button">登记晋升</button>
                  <button className="button-quiet" disabled={busy} onClick={() => decide("rejected")} type="button">驳回候选</button>
                </div>
              </div>
              <h3>决策历史</h3>
              {selected.review_events.length ? (
                <div className="candidate-review-history">
                  {selected.review_events.map((event) => (
                    <div key={event.id}>
                      <strong>{STATUS_LABELS[event.prior_status]} → {STATUS_LABELS[event.next_status]}</strong>
                      <span>{event.expert_name} · {new Date(event.created_at).toLocaleString("zh-CN")}</span>
                      <p>{event.decision_note || "未填写说明"}</p>
                      {event.target_ontology_node_id ? <code>{event.target_ontology_node_id}</code> : null}
                    </div>
                  ))}
                </div>
              ) : <p className="muted">尚无专家决策记录。</p>}
            </>
          ) : <p className="muted">从左侧选择一个候选。</p>}
        </article>
      </div>
    </section>
  );
}
