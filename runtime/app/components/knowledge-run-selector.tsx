import Link from "next/link";
import type { ResearchRun } from "@/engine/types";
import { runStatusLabel } from "@/app/lib/ui-labels";

export function KnowledgeRunSelector({ runs, selectedRun, action, children }: { runs: ResearchRun[]; selectedRun?: ResearchRun; action: string; children?: React.ReactNode }) {
  return <div className="card knowledge-run-selector"><div><span className="knowledge-step-kicker">当前研究任务</span><h2>{selectedRun?.question || "尚无研究任务"}</h2><p className="muted">切换研究后，本页会只展示该研究实际形成和采用的知识。</p>{children}</div>{runs.length ? <form action={action}><label><span>选择研究</span><select name="runId" defaultValue={selectedRun?.id}>{runs.map((run) => <option value={run.id} key={run.id}>{runStatusLabel(run.status)} · {run.question.slice(0, 54)}</option>)}</select></label><button className="button">查看</button></form> : <Link className="button" href="/runs/new">创建第一项研究 →</Link>}</div>;
}
