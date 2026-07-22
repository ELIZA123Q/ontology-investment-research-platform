import Link from "next/link";
import { redirect } from "next/navigation";
import { latestArtifactMeta, latestArtifactPayload, listWorkItemsForReview } from "@/adapters/db_read_models";
import { PublishButton } from "@/app/components/publish-button";
import { ReportMarkdown } from "@/app/components/report-markdown";
import { parseJson } from "@/engine/types";

export const dynamic = "force-dynamic";

export default async function Report({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const artifact = latestArtifactPayload(id, "stage_05", ["approved", "needs_review"]);
  // 尚无待审/已确认版本时，审阅页没有生成入口；默认进入阶段编辑页。
  if (!artifact) redirect(`/runs/${id}/stages/5`);
  const review = latestArtifactPayload(id, "independent_review", ["approved", "needs_review"]);
  const reviewData: any = parseJson(review?.json_content || "{}", {});
  const baseline = latestArtifactMeta(id, "baseline", ["approved"]);
  const evaluation = latestArtifactMeta(id, "evaluation", ["approved"]);
  const blockers = listWorkItemsForReview(id).filter((item) => item.status === "pending" || item.status === "rework");
  const reviewPassed = Boolean(review?.status === "approved" && reviewData.verdict === "pass");
  const dailyReady = Boolean(artifact.status === "approved" && reviewPassed && blockers.length === 0);
  const qualityReady = Boolean(dailyReady && baseline && evaluation);
  const readinessMessage = artifact.status !== "approved"
    ? "报告表达尚未确认"
    : !review || review.status !== "approved"
      ? "独立审阅尚未确认"
      : reviewData.verdict !== "pass"
        ? "独立审阅要求返工"
        : blockers.length
          ? `${blockers.length} 个待办事项仍需处理`
          : "日常交付条件已满足";
  const readinessAction = artifact.status !== "approved"
    ? { href: `/runs/${id}/stages/5`, label: "确认报告表达 →" }
    : !review || review.status !== "approved" || reviewData.verdict !== "pass"
      ? { href: `/runs/${id}/judgments`, label: "处理独立审阅 →" }
      : blockers.length
        ? { href: `/runs/${id}`, label: "处理剩余待办 →" }
        : null;

  return <>
    <div className="pagehead scene-head">
      <div>
        <div className="eyebrow">交付台</div>
        <h1>把获准判断交付给读者</h1>
        <p className="muted">报告不能新增事实或提高结论强度；每条表达都必须回到已审阅判断。</p>
      </div>
      <div className="actions">
        {readinessAction ? (
          <Link className="button" href={readinessAction.href}>{readinessAction.label}</Link>
        ) : dailyReady ? (
          <a className="button" href={`/api/runs/${id}/report.md`}>导出 Markdown ↓</a>
        ) : null}
        <Link className="button-quiet" href={`/runs/${id}/stages/5`}>编辑交付稿</Link>
      </div>
    </div>

    <section className={`delivery-readiness ${dailyReady ? "ready" : "blocked"}`}>
      <div>
        <span>{dailyReady ? "可以交付" : "尚未就绪"}</span>
        <strong>{dailyReady ? "报告与独立审阅已确认，可导出给读者" : readinessMessage}</strong>
      </div>
      <div className="readiness-checks">
        <span className={artifact.status === "approved" ? "pass" : ""}>报告表达</span>
        <span className={reviewPassed ? "pass" : ""}>独立审阅</span>
        <span className={!blockers.length ? "pass" : ""}>待办清零</span>
      </div>
    </section>

    <details className="advanced-tools delivery-quality">
      <summary>
        <div>
          <div className="eyebrow">可选质量实验</div>
          <strong>同证据基线与 A/B 盲评</strong>
        </div>
        <span className="section-meta">{qualityReady ? "已完成" : "不属于日常交付主链"}</span>
      </summary>
      <div className="delivery-quality-body">
        <p className="muted">用于工作台进阶校验与流程对照，不阻断日常交付与 Markdown 导出。</p>
        <div className="readiness-checks">
          <span className={baseline ? "pass" : ""}>同证据基线</span>
          <span className={evaluation ? "pass" : ""}>A/B 盲评</span>
        </div>
        <div className="actions">
          <Link className="button-secondary" href={`/runs/${id}/compare`}>
            {qualityReady ? "查看对照实验 →" : "进入对照实验 →"}
          </Link>
          <PublishButton runId={id} disabled={!qualityReady} />
        </div>
      </div>
    </details>

    <article className="card markdown report-document"><ReportMarkdown content={artifact.markdown_content} /></article>
  </>;
}
