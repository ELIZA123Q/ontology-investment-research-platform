"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest, formatRelativeTime } from "@/app/components/client-api";

interface CaseSummary {
  id: string; version: number; companyCode: string; companyName: string; asOf: string; researchQuestion: string;
  primaryLens: string; counterLens: string; status: "draft" | "active" | "waiting_input" | "completed" | "cancelled"; updatedAt: string;
}

const today = new Date().toISOString().slice(0, 10);

export function CompanyResearchHome() {
  const router = useRouter();
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [form, setForm] = useState({ companyCode: "", companyName: "", asOf: today, researchQuestion: "", primaryLens: "fundamental", counterLens: "quality" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { void apiRequest<CaseSummary[]>("/api/v2/research-cases").then(setCases).catch((reason) => setError(String(reason))); }, []);
  const metrics = useMemo(() => ({ active: cases.filter((item) => item.status === "active").length, waiting: cases.filter((item) => item.status === "draft" || item.status === "waiting_input").length, completed: cases.filter((item) => item.status === "completed").length }), [cases]);

  async function createCase(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const created = await apiRequest<CaseSummary>("/api/v2/research-cases", { method: "POST", body: JSON.stringify({ ...form, reportSpec: { kind: "company_research", audience: "research_analyst", depth: "deep" }, sourcePolicy: { permissionScope: "public_research_use", requireLocatedExcerpt: true } }) });
      router.push(`/research/${created.id}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  return <main className="v2-home">
    <section className="v2-home-hero">
      <div><span className="v2-eyebrow">COMPANY FUNDAMENTALS · CONTROLLED RESEARCH</span><h1>从公司问题出发，形成<br/>可核验、可改判的研究结论</h1><p>先冻结主体、截止日和正反研究视角，再让系统沿证据、财务与判断缺口推进。证据不足也是正式结果。</p></div>
      <dl><div><dt>{metrics.active}</dt><dd>进行中</dd></div><div><dt>{metrics.waiting}</dt><dd>待处理</dd></div><div><dt>{metrics.completed}</dt><dd>已完成</dd></div></dl>
    </section>

    <section className="v2-home-grid">
      <form className="v2-case-form" onSubmit={createCase}>
        <header><span>新建研究案例</span><h2>你要判断哪家公司、什么问题？</h2><p>这里定义的是研究边界，不是让 AI 直接给答案。</p></header>
        <div className="v2-form-row"><label>证券代码<input required placeholder="例如 688261" value={form.companyCode} onChange={(event) => setForm({ ...form, companyCode: event.target.value })}/></label><label>公司名称<input required placeholder="例如 东微半导" value={form.companyName} onChange={(event) => setForm({ ...form, companyName: event.target.value })}/></label><label>研究截止日<input required type="date" value={form.asOf} onChange={(event) => setForm({ ...form, asOf: event.target.value })}/></label></div>
        <label>核心研究问题<textarea required rows={4} placeholder="例如：收入增长能否通过产品结构、客户验证和现金流得到验证？" value={form.researchQuestion} onChange={(event) => setForm({ ...form, researchQuestion: event.target.value })}/></label>
        <div className="v2-form-row lenses"><label>主研究 Lens<select value={form.primaryLens} onChange={(event) => setForm({ ...form, primaryLens: event.target.value })}><option value="fundamental">基本面</option><option value="growth">成长</option><option value="quality">质量</option><option value="value_valuation">价值与估值</option></select></label><label>反向 Lens<select value={form.counterLens} onChange={(event) => setForm({ ...form, counterLens: event.target.value })}><option value="quality">质量审视</option><option value="risk_first">风险优先</option><option value="expectation_gap">预期差</option><option value="value_valuation">估值约束</option></select></label></div>
        {error && <p className="v2-error" role="alert">{error}</p>}
        <footer><small>不会自动生成评级、目标价、仓位或交易指令</small><button disabled={busy}>{busy ? "正在建立问题图…" : "建立研究案例 →"}</button></footer>
      </form>

      <aside className="v2-recent">
        <header><div><span>最近研究</span><h2>继续你的判断</h2></div><small>{cases.length} 个案例</small></header>
        {!cases.length && <div className="v2-empty"><strong>还没有公司研究</strong><p>左侧创建的第一个案例会在这里持续保留其证据、判断和版本。</p></div>}
        {cases.map((item) => <button key={item.id} onClick={() => router.push(`/research/${item.id}`)}><div><span className={`v2-status ${item.status}`}>{statusLabel(item.status)}</span><time>{formatRelativeTime(item.updatedAt)}</time></div><strong>{item.companyName}<small>{item.companyCode}</small></strong><p>{item.researchQuestion}</p><footer><span>{lensLabel(item.primaryLens)} × {lensLabel(item.counterLens)}</span><b>打开案例 →</b></footer></button>)}
      </aside>
    </section>
  </main>;
}

function statusLabel(status: CaseSummary["status"]) { return ({ draft: "待确认计划", active: "研究中", waiting_input: "等待补充", completed: "已完成", cancelled: "已取消" } as const)[status]; }
function lensLabel(lens: string) { return ({ fundamental: "基本面", growth: "成长", quality: "质量", value_valuation: "估值", risk_first: "风险", expectation_gap: "预期差" } as Record<string, string>)[lens] || lens; }
