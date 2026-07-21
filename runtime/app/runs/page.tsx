import Link from "next/link";
import { listRuns } from "@/adapters/db";
import { runStatusLabel } from "@/app/lib/ui-labels";

export const dynamic = "force-dynamic";

function domainLabel(domain: string) {
  return domain === "semiconductor" ? "半导体" : "通用";
}

export default function RunsPage() {
  const runs = listRuns();

  return (
    <>
      <div className="pagehead">
        <div>
          <div className="eyebrow">研究项目库</div>
          <h1>我的研究</h1>
          <p className="muted">查看全部研究运行，进入对应问题继续推进或复核判断。</p>
        </div>
        <div className="actions">
          <Link className="button" href="/runs/new">新建研究</Link>
        </div>
      </div>

      {runs.length ? (
        <section className="run-list" aria-label="研究列表">
          <div className="run-list-head">
            <span>研究问题</span>
            <span>领域</span>
            <span>进度</span>
            <span></span>
          </div>
          {runs.map((run) => (
            <Link className="run-row" href={`/runs/${run.id}`} key={run.id}>
              <div className="run-title">
                <strong>{run.question}</strong>
                <span>
                  {run.parent_run_id ? "增量运行" : "原始研究"}
                  {" · "}
                  {runStatusLabel(run.status)}
                </span>
              </div>
              <span className="domain-label">{domainLabel(run.domain)}</span>
              <div className="run-progress" aria-label={`阶段 ${run.current_stage}/5`}>
                {[1, 2, 3, 4, 5].map((stage) => (
                  <i key={stage} className={stage <= run.current_stage ? "done" : undefined} />
                ))}
                <span>{run.current_stage}/5</span>
              </div>
              <span className="row-arrow" aria-hidden="true">→</span>
            </Link>
          ))}
        </section>
      ) : (
        <div className="card empty-state">
          <h2>还没有研究</h2>
          <p className="muted">提出第一个研究问题后，这里会列出全部运行，供随时回看与继续推进。</p>
          <Link className="button" href="/runs/new">提出第一个研究问题 →</Link>
        </div>
      )}
    </>
  );
}
