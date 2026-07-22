import Link from "next/link";
import { redirect } from "next/navigation";
import { latestArtifactPayload, listWorkItemsForReview } from "@/adapters/db_read_models";
import { IndependentReviewButton } from "@/app/components/independent-review-button";
import { ResearchGraphLazy } from "@/app/components/research-graph-lazy";
import { workItemForGraph } from "@/app/lib/client-rows";
import { buildJudgmentReviewGraph } from "@/app/lib/judgment-graph";
import { parseJson } from "@/engine/types";

export const dynamic = "force-dynamic";

export default async function Judgments({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const artifact = latestArtifactPayload(id, "stage_04", ["approved", "needs_review"]);
  // 尚无待审/已确认版本时，审阅页没有生成入口；默认进入阶段编辑页。
  if (!artifact) redirect(`/runs/${id}/stages/4`);
  const evidenceData: any = parseJson(latestArtifactPayload(id, "stage_03", ["approved", "needs_review"])?.json_content || "{}", {});
  const reviewArtifact = latestArtifactPayload(id, "independent_review", ["needs_review", "approved"]);
  const review: any = parseJson(reviewArtifact?.json_content || "{}", {});
  const data: any = parseJson(artifact.json_content || "{}", {});
  const workItems = listWorkItemsForReview(id);
  const evidence = (evidenceData.evidence_drafts || []).map((item: any, index: number) => ({
    ...item,
    id: String(item.id || item.evidence_id || `EV-${index + 1}`),
  }));
  const { nodes, edges, emptyReason } = buildJudgmentReviewGraph({
    stage04: data,
    evidenceDrafts: evidence,
    reviewIssues: review.issues || [],
    workItems: workItems as any,
  });

  return <>
    <div className="pagehead scene-head"><div><div className="eyebrow">判断审阅</div><h1>现有证据，允许说到多强？</h1><p className="muted">从证据、信号、假设、规则评估与推理留痕逐层检查判断；实体关系请到 <Link href={`/runs/${id}/object-set`}>关系图</Link>，本体网络请到 <Link href={`/ontology?runId=${id}`}>知识库</Link>。</p></div><div className="actions">{artifact.status === "approved" ? <IndependentReviewButton runId={id} completed={Boolean(reviewArtifact)} /> : null}<Link className="button-secondary" href={`/runs/${id}/stages/4`}>高级编辑</Link></div></div>
    <ResearchGraphLazy nodes={nodes} edges={edges} runId={id} workItems={workItems.map(workItemForGraph)} emptyMessage={emptyReason || "阶段 04 尚未形成可视化判断。"} />
    {reviewArtifact ? <section className={`review-strip ${review.verdict === "rework" ? "review-rework" : "review-pass"}`}><div><span>独立审阅 · {review.verdict === "pass" ? "通过" : review.verdict === "rework" ? "需返工" : review.verdict}</span><strong>{review.overall_assessment}</strong></div><small>{(review.issues || []).length ? `${review.issues.length} 项问题已标记到推理图` : "未发现需要返工的实质问题"}</small></section> : null}
  </>;
}
