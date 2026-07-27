import Link from "next/link";
import { redirect } from "next/navigation";
import { latestArtifactMeta, latestArtifactPayload, listWorkItemsForReview } from "@/adapters/db_read_models";
import { PublishButton } from "@/app/components/publish-button";
import { ReportMarkdown } from "@/app/components/report-markdown";
import { parseJson } from "@/engine/types";
import { StageApprovalButton } from "@/app/components/stage-approval-button";
import { StageSceneChrome } from "@/app/components/stage-scene-chrome";

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
  const stagesApproved = Boolean(
    latestArtifactMeta(id, "stage_01", ["approved"])
    && latestArtifactMeta(id, "stage_02", ["approved"])
    && latestArtifactMeta(id, "stage_03", ["approved"])
    && latestArtifactMeta(id, "stage_04", ["approved"])
    && artifact.status === "approved"
    && blockers.length === 0,
  );
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
    ? null
    : !review || review.status !== "approved" || reviewData.verdict !== "pass"
      ? { href: `/runs/${id}/judgments`, label: "处理独立审阅 →" }
      : blockers.length
        ? { href: `/runs/${id}`, label: "处理剩余待办 →" }
        : null;

  return <>
    <StageSceneChrome
      runId={id}
      stage={5}
      status={artifact.status}
      outputCount={dailyReady ? 1 : 0}
      statusNote={readinessMessage}
      actions={
        <>
          <StageApprovalButton
            runId={id}
            artifactId={artifact.id}
            stage={5}
            status={artifact.status}
            canApprove={blockers.length === 0}
            blockingHint={blockers.length ? `先处理 ${blockers.length} 项待办` : undefined}
          />
          {readinessAction ? (
            <Link className="button" href={readinessAction.href}>{readinessAction.label}</Link>
          ) : dailyReady ? (
            <a className="button-secondary" href={`/api/runs/${id}/report.md`}>导出 Markdown ↓</a>
          ) : null}
          <Link className="button-quiet" href={`/runs/${id}/stages/5`}>编辑交付稿</Link>
        </>
      }
    />

    <section className={`delivery-readiness ${stagesApproved ? "ready" : "blocked"}`}>
      <div>
        <span>{stagesApproved ? "可导出正式包" : "尚未就绪"}</span>
        <strong>
          {stagesApproved
            ? "五个研究阶段均已确认，可导出包含正文、来源与审计记录的正式发布包"
            : readinessMessage}
        </strong>
      </div>
      <div className="readiness-checks">
        <span className={artifact.status === "approved" ? "pass" : ""}>报告表达</span>
        <span className={reviewPassed ? "pass" : ""}>独立审阅</span>
        <span className={!blockers.length ? "pass" : ""}>待办清零</span>
      </div>
      <div className="actions" style={{ marginTop: 12 }}>
        <PublishButton runId={id} disabled={!stagesApproved} />
      </div>
    </section>

    <details className="advanced-tools delivery-quality">
      <summary>
        <div>
          <div className="eyebrow">可选质量实验</div>
          <strong>同证据基线与 A/B 盲评</strong>
        </div>
        <span className="section-meta">{qualityReady ? "已完成" : "不属于正式包主链"}</span>
      </summary>
      <div className="delivery-quality-body">
        <p className="muted">用于流程对照实验；正式发布包导出不再依赖盲评。</p>
        <div className="readiness-checks">
          <span className={baseline ? "pass" : ""}>同证据基线</span>
          <span className={evaluation ? "pass" : ""}>A/B 盲评</span>
        </div>
        <div className="actions">
          <Link className="button-secondary" href={`/runs/${id}/compare`}>
            {qualityReady ? "查看对照实验 →" : "进入对照实验 →"}
          </Link>
        </div>
      </div>
    </details>

    <article className="card markdown report-document"><ReportMarkdown content={artifact.markdown_content} readerView /></article>
  </>;
}
