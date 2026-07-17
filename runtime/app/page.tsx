import Link from "next/link";
import { listRuns } from "@/adapters/db";

export const dynamic = "force-dynamic";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export default function Home() {
  const runs = listRuns();
  const completed = runs.filter((run) => run.status === "complete").length;
  const active = runs.filter((run) => run.status !== "complete").length;

  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">Evidence-led research runtime</div>
          <h1>把研究判断，变成可验证的运行。</h1>
          <p>从问题定义、证据取用到判断裁决，每一步都留下结构化依据、反证与版本轨迹。这里不是报告生成器，而是研究决策的操作系统。</p>
          <div className="hero-actions">
            <Link className="button" href="/runs/new">新建研究运行 <span className="button-arrow">→</span></Link>
            <span className="hero-note">5 个阶段 · 人工确认后推进</span>
          </div>
        </div>
        <aside className="runtime-signal" aria-label="运行概览">
          <div className="signal-head"><span>WORKSPACE SIGNAL</span><span className="signal-live">本地在线</span></div>
          <div className="metric"><strong>{runs.length}</strong><span>条可复盘研究运行</span></div>
          <div className="signal-grid">
            <div><strong>{active}</strong><span>进行中</span></div>
            <div><strong>{completed}</strong><span>已完成</span></div>
          </div>
        </aside>
      </section>

      <section>
        <div className="section-head">
          <div><div className="eyebrow">Research runs</div><h2>最近运行</h2></div>
          <span className="section-meta">按创建时间排序 · 共 {runs.length} 条</span>
        </div>
        {runs.length ? (
          <div className="run-list">
            <div className="run-list-head"><span>研究问题</span><span>领域</span><span>阶段进度</span><span>状态</span></div>
            {runs.map((run) => (
              <Link href={`/runs/${run.id}`} className="run-row" key={run.id}>
                <div className="run-title"><strong>{run.question}</strong><span>更新于 {formatDate(run.updated_at)}</span></div>
                <span className="domain-label">{run.domain === "semiconductor" ? "半导体" : "通用领域"}</span>
                <div className="run-progress" aria-label={`阶段 ${run.current_stage}/5`}>
                  {[1, 2, 3, 4, 5].map((stage) => <i className={stage <= run.current_stage ? "done" : ""} key={stage} />)}
                  <span>{run.current_stage}/5</span>
                </div>
                <div className="actions"><span className={`badge ${run.status === "complete" ? "" : run.status === "draft" ? "neutral" : "warn"}`}>{run.status}</span><span className="row-arrow">→</span></div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="card empty-state"><h2>还没有研究运行</h2><p className="muted">从一个具体、可验证的问题开始。</p><Link className="button" href="/runs/new">创建第一条运行</Link></div>
        )}
      </section>
    </>
  );
}
