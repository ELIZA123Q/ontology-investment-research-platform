"use client";

import { useEffect, useMemo, useState } from "react";

type CandidateStatus = "pending" | "expert_confirmed" | "promoted" | "rejected";
type ChangeStatus = "proposed" | "impact_assessed" | "approved" | "implemented" | "validated" | "released" | "rejected";

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
  anchors: string[];
  similarities: Array<{
    candidate_key: string;
    name: string;
    score: number;
    confidence: "high" | "possible";
    reason: string;
  }>;
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
  change_request: {
    id: string;
    status: ChangeStatus;
    target_ontology_node_id: string;
    required_checks: string[];
    implementation_ref: string;
    migration_ref: string;
    release_fingerprint: string;
    updated_at: string;
    released_at: string | null;
  } | null;
  change_request_events: Array<{
    id: string;
    prior_status: string;
    next_status: ChangeStatus;
    actor_name: string;
    decision_note: string;
    created_at: string;
  }>;
};

const STATUS_LABELS: Record<CandidateStatus, string> = {
  pending: "待专家确认",
  expert_confirmed: "缺口已确认",
  promoted: "变更已受理",
  rejected: "已驳回",
};

const CHANGE_STATUS_LABELS: Record<ChangeStatus, string> = {
  proposed: "变更已提案",
  impact_assessed: "影响已冻结",
  approved: "变更已批准",
  implemented: "实现已提交",
  validated: "检查已通过",
  released: "已正式发布",
  rejected: "变更已驳回",
};

function candidateCategoryLabel(category: string): string {
  return ({
    company: "公司",
    cost: "成本",
    demand: "需求",
    economics: "经济",
    expectation: "预期",
    financial: "财务",
    financial_metric: "财务指标",
    inventory_cycle: "库存周期",
    market: "市场",
    operations: "运营",
    pricing: "定价",
    supply: "供给",
  } as Record<string, string>)[category] || "其他研究变量";
}

function candidateDomainLabel(domain: string): string {
  return ({
    semiconductor: "半导体",
    general: "通用研究",
  } as Record<string, string>)[domain] || "其他领域";
}

function candidateKindLabel(kind: string): string {
  return ({
    observed: "观测型",
    observed_or_adjudicated: "观测或裁决型",
    qualitative_or_derived: "定性或派生型",
    quantitative: "定量型",
  } as Record<string, string>)[kind] || "未分类";
}

export function OntologyCandidateQueue() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [expertName, setExpertName] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [targetId, setTargetId] = useState("");
  const [formalName, setFormalName] = useState("");
  const [formalDefinition, setFormalDefinition] = useState("");
  const [anchors, setAnchors] = useState("");
  const [evidenceProfileRef, setEvidenceProfileRef] = useState("");
  const [decisionUse, setDecisionUse] = useState("");
  const [observationGuidance, setObservationGuidance] = useState("");
  const [counterEvidenceGuidance, setCounterEvidenceGuidance] = useState("");
  const [memberKeys, setMemberKeys] = useState<string[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  async function load(preferredKey?: string) {
    setBusy(true);
    setError("");
    const response = await fetch("/api/90_compat/ontology/candidates");
    const json = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(json.error || "读取候选知识失败");
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
    setFormalName(selected.name || "");
    setFormalDefinition(selected.definitions[0] || "");
    setAnchors(selected.anchors.join(", "));
    setEvidenceProfileRef("");
    setDecisionUse("");
    setObservationGuidance("");
    setCounterEvidenceGuidance("");
    setMemberKeys(selected.similarities.filter((item) => item.confidence === "high").map((item) => item.candidate_key));
  }, [selectedKey, selected?.review.updated_at]);

  async function decide(status: CandidateStatus) {
    if (!selected) return;
    setBusy(true);
    setError("");
    const response = await fetch(`/api/90_compat/ontology/candidates/${encodeURIComponent(selected.candidate_key)}`, {
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
      setError(json.error || "保存评审决定失败");
      return;
    }
    await load(selected.candidate_key);
  }

  async function promote() {
    if (!selected) return;
    setBusy(true);
    setError("");
    const response = await fetch(`/api/90_compat/ontology/candidates/${encodeURIComponent(selected.candidate_key)}/promote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        member_candidate_keys: memberKeys,
        expert_name: expertName,
        decision_note: decisionNote,
        target_ontology_node_id: targetId,
        name: formalName,
        definition: formalDefinition,
        category: selected.category,
        variable_kind: selected.variable_kind,
        anchors: anchors.split(/[,，、]/).map((item) => item.trim()).filter(Boolean),
        evidence_profile_ref: evidenceProfileRef,
        decision_use: decisionUse,
        observation_guidance: observationGuidance,
        counter_evidence_guidance: counterEvidenceGuidance,
      }),
    });
    const json = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(json.error || "自动入库失败，候选已停在可审计步骤");
      return;
    }
    await load(selected.candidate_key);
  }

  const pendingCount = candidates.filter((candidate) => candidate.review.status === "pending").length;
  const reusedCount = candidates.filter((candidate) => candidate.cross_task_reused).length;
  const releasedCount = candidates.filter((candidate) => candidate.change_request?.status === "released").length;

  return (
    <section className="ontology-governance">
      <div className="ontology-governance-metrics">
        <article><strong>{candidates.length}</strong><span>全部研究候选知识</span></article>
        <article><strong>{reusedCount}</strong><span>跨任务重复出现</span></article>
        <article><strong>{pendingCount}</strong><span>等待专家确认</span></article>
        <article><strong>{releasedCount}</strong><span>已正式发布</span></article>
      </div>
      <div className="ontology-governance-note">
        <strong>变更受理不等于正式发布</strong>
        <span>候选受理后还须经过影响分析、批准、实施、验证并绑定正式指纹，才会显示为“已正式发布”。</span>
      </div>
      {error ? <div className="notice error">{error}</div> : null}
      <div className="ontology-governance-layout">
        <aside className="card ontology-candidate-list">
          <div className="panel-title"><h3>知识缺口队列</h3><span>{busy ? "更新中" : `${candidates.length} 项`}</span></div>
          {candidates.map((candidate) => (
            <button
              className={candidate.candidate_key === selectedKey ? "active" : ""}
              key={candidate.candidate_key}
              onClick={() => setSelectedKey(candidate.candidate_key)}
              type="button"
            >
              <span className={`candidate-status ${candidate.review.status}`}>{STATUS_LABELS[candidate.review.status]}</span>
              <strong>{candidate.name}</strong>
              <small>{candidateCategoryLabel(candidate.category)} · {candidate.run_count} 个研究 · {candidate.occurrence_count} 次出现{candidate.run_count > 1 ? " · 建议治理" : ""}</small>
            </button>
          ))}
          {!busy && !candidates.length ? <p className="muted">当前研究没有待治理的本轮候选知识。</p> : null}
        </aside>
        <article className="card ontology-candidate-detail">
          {selected ? (
            <>
              <div className="section-heading">
                <div>
                  <div className="eyebrow">候选知识</div>
                  <h2>{selected.name}</h2>
                  <p className="muted">{candidateCategoryLabel(selected.category)} · {candidateKindLabel(selected.variable_kind)}</p>
                </div>
                <span className={`badge candidate-status ${selected.review.status}`}>{STATUS_LABELS[selected.review.status]}</span>
              </div>
              <dl className="candidate-evidence-grid">
                <div><dt>跨任务频次</dt><dd>{selected.run_count} 个研究 / {selected.occurrence_count} 次</dd></div>
                <div><dt>覆盖领域</dt><dd>{selected.domains.map(candidateDomainLabel).join("、") || "—"}</dd></div>
                <div><dt>复用判断</dt><dd>{selected.cross_task_reused ? "已跨任务重复，优先评审" : "暂为单任务证据"}</dd></div>
                <div>
                  <dt>正式变更状态</dt>
                  <dd>{selected.change_request ? CHANGE_STATUS_LABELS[selected.change_request.status] : "尚未创建变更提案"}</dd>
                </div>
              </dl>
              <h3>出现在哪些研究</h3>
              <ul className="source-list">
                {selected.questions.slice(0, 8).map((question) => <li key={question}>{question}</li>)}
              </ul>
              <h3>定义变体</h3>
              <ul className="source-list">
                {selected.definitions.map((definition) => <li key={definition}>{definition}</li>)}
              </ul>
              {selected.similarities.length ? <>
                <h3>近义候选</h3>
                <div className="candidate-similarity-list">
                  {selected.similarities.map((item) => <label key={item.candidate_key}>
                    <input type="checkbox" checked={memberKeys.includes(item.candidate_key)} disabled={item.confidence !== "high" || Boolean(selected.change_request)} onChange={(event) => setMemberKeys((current) => event.target.checked ? [...current, item.candidate_key] : current.filter((key) => key !== item.candidate_key))} />
                    <span><strong>{item.name}</strong><small>{item.confidence === "high" ? "高置信归组" : "可能相关，仅供参考"} · {(item.score * 100).toFixed(0)}% · {item.reason}</small></span>
                  </label>)}
                </div>
              </> : null}
              <div className="ontology-review-form">
                <div className="field">
                  <label>专家 / 知识库维护人</label>
                  <input value={expertName} onChange={(event) => setExpertName(event.target.value)} placeholder="至少 2 个字符" />
                </div>
                <div className="field">
                  <label>判断理由</label>
                  <textarea value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} placeholder="说明稳定性、跨任务价值、边界或驳回原因（至少 8 字）" />
                </div>
                <div className="field">
                  <label>拟正式知识编号</label>
                  <input value={targetId} onChange={(event) => setTargetId(event.target.value)} placeholder="由知识库维护人填写" />
                </div>
                <div className="field"><label>正式名称</label><input value={formalName} onChange={(event) => setFormalName(event.target.value)} /></div>
                <div className="field"><label>稳定定义</label><textarea value={formalDefinition} onChange={(event) => setFormalDefinition(event.target.value)} /></div>
                <div className="field"><label>对象锚点（逗号分隔）</label><input value={anchors} onChange={(event) => setAnchors(event.target.value)} placeholder="Company, Product, Industry" /></div>
                <div className="field"><label>证据画像 ID</label><input value={evidenceProfileRef} onChange={(event) => setEvidenceProfileRef(event.target.value)} placeholder="必须引用已有 EvidenceProfile" /></div>
                <div className="field"><label>判断用途</label><textarea value={decisionUse} onChange={(event) => setDecisionUse(event.target.value)} placeholder="说明该变量支持什么稳定判断" /></div>
                <div className="field"><label>观察指引</label><textarea value={observationGuidance} onChange={(event) => setObservationGuidance(event.target.value)} placeholder="说明应如何观察和核验" /></div>
                <div className="field"><label>反证指引</label><textarea value={counterEvidenceGuidance} onChange={(event) => setCounterEvidenceGuidance(event.target.value)} placeholder="说明哪些情况会削弱或推翻该变量判断" /></div>
                <div className="actions">
                  <button className="button" disabled={busy || selected.change_request?.status === "released"} onClick={promote} type="button">{busy ? "正在执行治理与校验…" : selected.change_request ? "继续自动入库" : "确认并加入本体"}</button>
                  <button className="button-quiet" disabled={busy || Boolean(selected.change_request)} onClick={() => decide("rejected")} type="button">驳回候选</button>
                </div>
              </div>
              <details>
                <summary>查看内部标识（审计）</summary>
                <p className="muted">{selected.candidate_key}</p>
                <p className="muted">相关变量：{selected.variable_ids.join("、") || "—"}</p>
              </details>
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
              <h3>正式变更历史</h3>
              {selected.change_request_events.length ? (
                <div className="candidate-review-history">
                  {selected.change_request_events.map((event) => (
                    <div key={event.id}>
                      <strong>{event.prior_status === "none" ? "候选受理" : CHANGE_STATUS_LABELS[event.prior_status as ChangeStatus]} → {CHANGE_STATUS_LABELS[event.next_status]}</strong>
                      <span>{event.actor_name} · {new Date(event.created_at).toLocaleString("zh-CN")}</span>
                      <p>{event.decision_note}</p>
                    </div>
                  ))}
                </div>
              ) : <p className="muted">尚未进入正式变更流程。</p>}
            </>
          ) : <p className="muted">从左侧选择一个候选。</p>}
        </article>
      </div>
    </section>
  );
}
