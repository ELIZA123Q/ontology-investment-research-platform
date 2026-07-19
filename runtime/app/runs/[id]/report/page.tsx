import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { latestArtifact, listWorkItems } from "@/adapters/db";
import { RunNav } from "@/app/components/run-nav";
import { PublishButton } from "@/app/components/publish-button";
import { parseJson } from "@/engine/types";

export const dynamic = "force-dynamic";

export default async function Report({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const artifact = latestArtifact(id, "stage_05", ["approved", "needs_review"]);
  const review = latestArtifact(id, "independent_review", ["approved", "needs_review"]);
  const reviewData: any = parseJson(review?.json_content || "{}", {});
  const baseline = latestArtifact(id, "baseline", ["approved"]);
  const evaluation = latestArtifact(id, "evaluation", ["approved"]);
  const blockers = listWorkItems(id).filter((item) => item.status === "pending" || item.status === "rework");
  const ready = Boolean(artifact?.status === "approved" && review?.status === "approved" && reviewData.verdict === "pass" && baseline && evaluation && blockers.length === 0);
  const readinessMessage = !artifact || artifact.status !== "approved" ? "报告表达尚未确认" : !review || review.status !== "approved" ? "独立审阅尚未确认" : reviewData.verdict !== "pass" ? "独立审阅要求返工" : !baseline ? "同冻结证据基线尚未确认" : !evaluation ? "A/B 盲评尚未完成" : `${blockers.length} 个对象级工作项仍需处理`;
  return <>
    <RunNav runId={id} active="delivery" />
    <div className="pagehead scene-head"><div><div className="eyebrow">Delivery desk</div><h1>把获准判断交付给读者</h1><p className="muted">报告不能新增事实或提高结论强度；每条表达都必须回到已审阅判断。</p></div><div className="actions">{artifact ? <a className="button-secondary" href={`/api/runs/${id}/report.md`}>导出 Markdown ↓</a> : null}<PublishButton runId={id} disabled={!ready} /></div></div>
    <section className={`delivery-readiness ${ready ? "ready" : "blocked"}`}><div><span>{ready ? "READY TO DELIVER" : "NOT READY"}</span><strong>{ready ? "审阅、基线与盲评完成，可以进入导出校验" : readinessMessage}</strong></div><div className="readiness-checks"><span className={artifact?.status === "approved" ? "pass" : ""}>报告表达</span><span className={review?.status === "approved" && reviewData.verdict === "pass" ? "pass" : ""}>独立审阅</span><span className={baseline ? "pass" : ""}>同证据基线</span><span className={evaluation ? "pass" : ""}>A/B 盲评</span><span className={!blockers.length ? "pass" : ""}>工作项清零</span></div></section>
    {artifact ? <article className="card markdown report-document"><ReactMarkdown remarkPlugins={[remarkGfm]}>{artifact.markdown_content}</ReactMarkdown></article> : <div className="card empty-state"><h2>报告尚未生成</h2><p className="muted">完成判断裁决后，在阶段 05 生成研究表达。</p><Link className="button" href={`/runs/${id}/stages/5`}>进入表达生成</Link></div>}
  </>;
}
