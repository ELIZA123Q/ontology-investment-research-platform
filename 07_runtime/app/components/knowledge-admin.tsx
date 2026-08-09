"use client";

import { useMemo, useState } from "react";
import type { AssetCandidate, AssetRelease, AssetRevision, CandidateDecision, CandidateOccurrence, EvaluationRun, KnowledgeLock } from "@/src/contracts";
import { ArrowIcon, CheckIcon, CloseIcon, SearchIcon } from "@/app/components/icons";

interface CandidateListItem extends AssetCandidate {
  occurrences: CandidateOccurrence[];
  decisions: CandidateDecision[];
  evaluationRuns: EvaluationRun[];
}

interface CandidateDetail {
  candidate: AssetCandidate;
  revision: AssetRevision | null;
  knowledgeLock: KnowledgeLock | null;
  threeWayDiff: { runBaseline: AssetRevision | null; currentBaseline: AssetRevision | null; candidateRevision: AssetRevision | null };
  occurrences: CandidateOccurrence[];
  similarCandidates: AssetCandidate[];
  decisions: CandidateDecision[];
  evaluationRuns: EvaluationRun[];
  currentRelease: AssetRelease | null;
  lineage: { revisions: AssetRevision[]; releases: AssetRelease[] };
}

async function adminRequest<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init?.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((payload as { error?: string }).error || `请求失败：${response.status}`);
  return payload as T;
}

function ContentSummary({ revision, empty }: { revision: AssetRevision | null | undefined; empty: string }) {
  if (!revision) return <div className="admin-diff-empty">{empty}</div>;
  return <div className="admin-diff-content"><div><span>v{revision.version}</span><i>{revision.status}</i></div>{Object.entries(revision.content).slice(0, 12).map(([key, value]) => <section key={key}><strong>{key}</strong><p>{typeof value === "object" ? JSON.stringify(value) : String(value)}</p></section>)}</div>;
}

export function KnowledgeAdminConsole() {
  const [token, setToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [candidates, setCandidates] = useState<CandidateListItem[]>([]);
  const [releases, setReleases] = useState<AssetRelease[]>([]);
  const [selected, setSelected] = useState<CandidateDetail>();
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("已核对来源、差异与回归指标。");
  const [reviewer, setReviewer] = useState("knowledge-governor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const filtered = useMemo(() => candidates.filter((item) => `${item.identityKey} ${item.assetKind} ${item.operation}`.toLowerCase().includes(query.toLowerCase())), [candidates, query]);
  const pending = candidates.filter((item) => !["released", "rejected", "superseded"].includes(item.status)).length;

  async function connect() {
    setBusy(true); setError("");
    try {
      const [nextCandidates, nextReleases] = await Promise.all([
        adminRequest<CandidateListItem[]>("/vnext/internal/knowledge/candidates", token),
        adminRequest<AssetRelease[]>("/vnext/internal/knowledge/releases", token),
      ]);
      setCandidates(nextCandidates); setReleases(nextReleases); setConnected(true);
      if (nextCandidates[0]) await selectCandidate(nextCandidates[0].id);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setConnected(false); }
    finally { setBusy(false); }
  }

  async function selectCandidate(id: string) {
    setError("");
    try { setSelected(await adminRequest<CandidateDetail>(`/vnext/internal/knowledge/candidates/${id}`, token)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  async function refresh() {
    const [nextCandidates, nextReleases] = await Promise.all([
      adminRequest<CandidateListItem[]>("/vnext/internal/knowledge/candidates", token),
      adminRequest<AssetRelease[]>("/vnext/internal/knowledge/releases", token),
    ]);
    setCandidates(nextCandidates); setReleases(nextReleases);
    if (selected) await selectCandidate(selected.candidate.id);
  }

  async function evaluate() {
    if (!selected || busy) return;
    setBusy(true); setError("");
    try { await adminRequest(`/vnext/internal/knowledge/candidates/${selected.candidate.id}/evaluate`, token, { method: "POST", body: "{}" }); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function decide(decision: "approved" | "rejected") {
    if (!selected || !note.trim() || !reviewer.trim() || busy) return;
    setBusy(true); setError("");
    try {
      await adminRequest(`/vnext/internal/knowledge/candidates/${selected.candidate.id}/decision`, token, { method: "POST", body: JSON.stringify({ decision, reviewer: reviewer.trim(), reviewerRole: "governance_owner", note: note.trim() }) });
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function publish() {
    if (!selected || selected.candidate.status !== "approved" || busy) return;
    setBusy(true); setError("");
    try { await adminRequest("/vnext/internal/knowledge/releases", token, { method: "POST", body: JSON.stringify({ action: "publish", candidateIds: [selected.candidate.id], createdBy: reviewer.trim() || "knowledge-governor" }) }); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function rollback(releaseId: string) {
    if (busy) return;
    setBusy(true); setError("");
    try { await adminRequest("/vnext/internal/knowledge/releases", token, { method: "POST", body: JSON.stringify({ action: "rollback", releaseId, createdBy: reviewer.trim() || "knowledge-governor" }) }); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  if (!connected) return <main className="admin-login" id="main-content"><section><span>Internal · Knowledge Governance</span><h1>知识沉淀控制面</h1><p>治理端与研究员工作台完全分离。Admin Token 仅保存在当前页面内存中，刷新后会被清除。</p><label>Admin Token<input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="本地未配置 Token 时可留空" onKeyDown={(event) => { if (event.key === "Enter") void connect(); }} /></label><button className="primary-button" disabled={busy} onClick={() => void connect()}>{busy ? "正在验证" : "进入控制台"}<ArrowIcon /></button>{error && <p className="inline-error" role="alert">{error}</p>}</section></main>;

  return <main className="admin-page" id="main-content">
    <header className="admin-header"><div><span>Internal · Knowledge Governance</span><h1>知识沉淀控制面</h1><p>候选只有完成评测、审批和发布后，才会进入后续 Task 的 Context。</p></div><button onClick={() => { setConnected(false); setToken(""); setSelected(undefined); }}><CloseIcon />断开会话</button></header>
    <section className="admin-metrics"><article><span>待处理候选</span><strong>{pending}</strong></article><article><span>冲突候选</span><strong>{candidates.filter((item) => item.conflicts.length).length}</strong></article><article><span>全部候选</span><strong>{candidates.length}</strong></article><article><span>Release 历史</span><strong>{releases.length}</strong></article></section>
    {error && <p className="admin-error inline-error" role="alert">{error}</p>}
    <div className="admin-layout">
      <aside className="candidate-queue"><header><div><span>候选队列</span><strong>{filtered.length} 项</strong></div><label><SearchIcon /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索稳定标识" /></label></header><div>{filtered.map((item) => <button className={selected?.candidate.id === item.id ? "active" : ""} onClick={() => void selectCandidate(item.id)} key={item.id}><div><span>{item.assetKind}</span><i>L{item.riskLevel}</i></div><strong>{item.identityKey}</strong><p>{item.operation} · {item.status} · 新颖度 {Math.round(item.novelty * 100)}%</p></button>)}</div></aside>
      <section className="candidate-detail">{selected ? <>
        <header><div><span>{selected.candidate.assetKind} · {selected.candidate.operation}</span><h2>{selected.candidate.identityKey}</h2><p>来自 Task {selected.candidate.taskId.slice(0, 12)} · 风险 L{selected.candidate.riskLevel} · {selected.occurrences.length} 次出现</p></div><span className={`status-badge ${selected.candidate.status}`}>{selected.candidate.status}</span></header>
        <section className="three-way-diff"><h3>三方差异</h3><div><article><header>Run 原基线</header><ContentSummary revision={selected.threeWayDiff.runBaseline} empty="本轮没有同标识基线" /></article><article><header>当前 Release</header><ContentSummary revision={selected.threeWayDiff.currentBaseline} empty="当前基线没有此资产" /></article><article className="candidate"><header>候选 Revision</header><ContentSummary revision={selected.threeWayDiff.candidateRevision} empty="候选 Revision 不可用" /></article></div></section>
        <section className="governance-grid"><article><span>Provenance</span><strong>{selected.candidate.provenanceRefs.length} 项引用</strong><p>{selected.candidate.provenanceRefs.slice(0, 3).join("、") || "无来源引用"}</p></article><article><span>Replay 评测</span><strong>{selected.evaluationRuns[0]?.summary.passed ? "通过" : selected.evaluationRuns.length ? "未通过" : "尚未运行"}</strong><p>{selected.evaluationRuns[0] ? `分数变化 ${selected.evaluationRuns[0].summary.scoreDelta} · 严重回归 ${selected.evaluationRuns[0].summary.severeRegressions}` : "发布前必须完成回归检查。"}</p></article><article><span>冲突</span><strong>{selected.candidate.conflicts.length || 0} 项</strong><p>{selected.candidate.conflicts.join("；") || "没有记录未解决冲突。"}</p></article><article><span>血缘</span><strong>{selected.lineage.revisions.length} 个版本</strong><p>{selected.lineage.releases.length} 个 Release 引用了该资产。</p></article></section>
        <section className="governance-actions"><div><label>审核人<input value={reviewer} onChange={(event) => setReviewer(event.target.value)} /></label><label>决策说明<textarea value={note} onChange={(event) => setNote(event.target.value)} /></label></div><div><button disabled={busy} onClick={() => void evaluate()}>运行 Replay 评测</button><button disabled={busy || !note.trim()} onClick={() => void decide("rejected")}>拒绝</button><button disabled={busy || !note.trim()} onClick={() => void decide("approved")}><CheckIcon />批准候选</button><button className="primary-button" disabled={busy || selected.candidate.status !== "approved"} onClick={() => void publish()}>发布 Release<ArrowIcon /></button></div></section>
      </> : <div className="detail-empty">从左侧选择候选。</div>}</section>
    </div>
    <section className="release-history"><header><div><span>Release 历史</span><h2>版本与回滚</h2></div></header><div>{releases.map((release) => <article key={release.id}><div><strong>{release.scope.kind === "global" ? "全局" : release.scope.kind} · {release.status}</strong><p>{release.assetRefs.length} 项资产 · {release.fingerprint.slice(0, 16)}…</p></div><time>{new Date(release.createdAt).toLocaleString("zh-CN")}</time>{release.status !== "current" && <button disabled={busy} onClick={() => void rollback(release.id)}>回滚至此版本</button>}</article>)}</div></section>
  </main>;
}
