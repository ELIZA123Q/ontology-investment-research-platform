import Link from "next/link";
import { listRuns } from "@/adapters/db";
import { RunList } from "@/app/components/run-list";

export const dynamic = "force-dynamic";

function descendantCounts(runs: ReturnType<typeof listRuns>): Map<string, number> {
  const childrenByParent = new Map<string, string[]>();
  for (const run of runs) {
    if (!run.parent_run_id) continue;
    const siblings = childrenByParent.get(run.parent_run_id) || [];
    siblings.push(run.id);
    childrenByParent.set(run.parent_run_id, siblings);
  }
  const memo = new Map<string, number>();
  const count = (id: string): number => {
    if (memo.has(id)) return memo.get(id)!;
    let total = 0;
    for (const childId of childrenByParent.get(id) || []) {
      total += 1 + count(childId);
    }
    memo.set(id, total);
    return total;
  };
  for (const run of runs) count(run.id);
  return memo;
}

export default function RunsPage() {
  const runs = listRuns();
  const descendants = descendantCounts(runs);
  const items = runs.map((run) => ({
    id: run.id,
    question: run.question,
    domain: run.domain,
    current_stage: run.current_stage,
    status: run.status,
    parent_run_id: run.parent_run_id,
    descendant_count: descendants.get(run.id) || 0,
    created_at: run.created_at,
    updated_at: run.updated_at,
  }));

  return (
    <>
      <div className="pagehead">
        <div>
          <div className="eyebrow">研究项目库</div>
          <h1>我的研究</h1>
          <p className="muted">按下一步、状态或更新时间找到研究，继续推进或复核判断。</p>
        </div>
        <div className="actions">
          <Link className="button" href="/runs/new">新建研究</Link>
        </div>
      </div>

      {items.length ? (
        <RunList runs={items} />
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
