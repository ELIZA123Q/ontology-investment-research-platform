"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest, formatRelativeTime } from "@/app/components/client-api";
import { KnowledgeGovernancePanel } from "@/app/components/knowledge-governance-panel";

interface CaseSummary {
  id: string; version: number; companyCode: string; companyName: string; asOf: string; researchQuestion: string;
  primaryLens: string; counterLens: string; status: "draft" | "active" | "waiting_input" | "completed" | "cancelled"; updatedAt: string;
  bundleId?: string;
}

const today = new Date().toISOString().slice(0, 10);

export function CompanyResearchHome() {
  const router = useRouter();
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [form, setForm] = useState({ companyCode: "", companyName: "", asOf: today, researchQuestion: "最新业绩相对历史口径发生了什么变化，是否需要调整核心投资命题？", primaryLens: "fundamental", counterLens: "risk_first" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { void apiRequest<CaseSummary[]>("/api/v2/research-cases").then(setCases).catch((reason) => setError(String(reason))); }, []);
  const metrics = useMemo(() => ({ active: cases.filter((item) => item.status === "active").length, waiting: cases.filter((item) => item.status === "draft" || item.status === "waiting_input").length, completed: cases.filter((item) => item.status === "completed").length }), [cases]);

  async function createCase(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const created = await apiRequest<CaseSummary>("/api/v2/research-cases", { method: "POST", body: JSON.stringify({ ...form, reportSpec: { kind: "judgment_update", audience: "research_analyst", depth: "standard" }, sourcePolicy: { permissionScope: "public_research_use", requireLocatedExcerpt: true, preferredProducer: "cninfo.com.cn" } }) });
      router.push(`/research/${created.id}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  return <main className="v2-home">
    <section className="v2-home-hero">
      <div><span className="v2-eyebrow">EARNINGS UPDATE · THESIS REVIEW</span><h1>从正式披露出发，完成<br/>业绩更新与命题复核</h1><p>冻结公司、报告期和正反研究视角，核验实际值、比较边界与命题影响。缺少独立来源或一致预期 vintage 时，系统会正式输出不确定。</p></div>
      <dl><div><dt>{metrics.active}</dt><dd>进行中</dd></div><div><dt>{metrics.waiting}</dt><dd>待处理</dd></div><div><dt>{metrics.completed}</dt><dd>已完成</dd></div></dl>
    </section>

    <section className="v2-home-grid">
      <form className="v2-case-form" onSubmit={createCase}>
        <header><span>新建业绩复核</span><h2>哪家公司、哪个截止日？</h2><p>首版生产能力聚焦业绩更新，不生成评级、目标价或首次覆盖估值。</p></header>
        <div className="v2-form-row"><label>证券代码<input required placeholder="例如 688261" value={form.companyCode} onChange={(event) => setForm({ ...form, companyCode: event.target.value })}/></label><label>公司名称<input required placeholder="例如 东微半导" value={form.companyName} onChange={(event) => setForm({ ...form, companyName: event.target.value })}/></label><label>研究截止日<input required type="date" value={form.asOf} onChange={(event) => setForm({ ...form, asOf: event.target.value })}/></label></div>
        <label>核心复核问题<textarea required rows={4} placeholder="例如：最新业绩是否改变收入兑现、利润质量和核心命题？" value={form.researchQuestion} onChange={(event) => setForm({ ...form, researchQuestion: event.target.value })}/></label>
        <div className="v2-form-row lenses"><label>主研究 Lens<select value={form.primaryLens} onChange={(event) => setForm({ ...form, primaryLens: event.target.value })}><option value="fundamental">基本面兑现</option><option value="growth">成长兑现</option><option value="quality">利润质量</option></select></label><label>反向 Lens<select value={form.counterLens} onChange={(event) => setForm({ ...form, counterLens: event.target.value })}><option value="risk_first">风险优先</option><option value="quality">质量审视</option><option value="expectation_gap">预期差</option></select></label></div>
        {error && <p className="v2-error" role="alert">{error}</p>}
        <footer><small>不会自动生成评级、目标价、仓位或交易指令</small><button disabled={busy}>{busy ? "正在建立问题图…" : "建立研究案例 →"}</button></footer>
      </form>

      <aside className="v2-recent">
        <header><div><span>最近研究</span><h2>继续你的判断</h2></div><small>{cases.length} 个案例</small></header>
        {!cases.length && <div className="v2-empty"><strong>还没有业绩复核</strong><p>左侧创建的第一个案例会持续保留公告快照、判断、不确定项和版本。</p></div>}
        {cases.map((item) => <button key={item.id} onClick={() => router.push(`/research/${item.id}`)}><div><span className={`v2-status ${item.status}`}>{statusLabel(item.status)}</span><time>{formatRelativeTime(item.updatedAt)}</time></div><strong>{item.companyName}<small>{item.companyCode}</small></strong><p>{item.researchQuestion}</p><footer><span>{lensLabel(item.primaryLens)} × {lensLabel(item.counterLens)}{item.bundleId ? ` · KB ${item.bundleId.slice(7, 15)}` : ""}</span><b>打开案例 →</b></footer></button>)}
      </aside>
    </section>
    <KnowledgeGovernancePanel/>
  </main>;
}

function statusLabel(status: CaseSummary["status"]) { return ({ draft: "待确认计划", active: "研究中", waiting_input: "等待补充", completed: "已完成", cancelled: "已取消" } as const)[status]; }
function lensLabel(lens: string) { return ({ fundamental: "基本面", growth: "成长", quality: "质量", value_valuation: "估值", risk_first: "风险", expectation_gap: "预期差" } as Record<string, string>)[lens] || lens; }
