import Link from "next/link";
import { latestArtifactMeta, latestArtifactPayload, listWorkItemsForReview } from "@/adapters/db_read_models";
import { PublishButton } from "@/app/components/publish-button";
import { ReportMarkdown } from "@/app/components/report-markdown";
import { parseJson } from "@/engine/types";
import { StageApprovalButton } from "@/app/components/stage-approval-button";
import { StageSceneChrome } from "@/app/components/stage-scene-chrome";
import { StageStatusBadge } from "@/app/components/stage-status-badge";
import { EmptyState } from "@/app/components/empty-state";
import { buildDeliveryResearcherView } from "@/app/lib/researcher-stage-output";
import { journeyEditHref } from "@/app/lib/research-journey";

export const dynamic = "force-dynamic";

export default async function Report({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const artifact = latestArtifactPayload(id, "stage_05", ["approved", "needs_review"]);
  if (!artifact) {
    return (
      <EmptyState
        title="尚未生成交付稿"
        description="请先确认判断并完成独立审阅所需前置后，再进入报告草稿页生成读者可见正文。"
        actionHref={journeyEditHref(id, 5)}
        actionLabel="生成交付稿 →"
      />
    );
  }
  const data: any = parseJson(artifact.json_content || "{}", {});
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
  const view = buildDeliveryResearcherView(data, {
    artifactStatus: artifact.status,
    reviewPassed,
    pendingCount: blockers.length,
    stagesApproved,
  });

  const readinessItems = [
    {
      id: "report",
      label: "报告表达已确认",
      pass: artifact.status === "approved",
      href: artifact.status === "approved" ? null : null,
      action: artifact.status === "approved" ? null : "在本页确认交付",
    },
    {
      id: "review",
      label: "独立审阅通过",
      pass: reviewPassed,
      href: `/runs/${id}/judgments`,
      action: !review
        ? "先到判断页发起独立审阅"
        : reviewData.verdict === "rework"
          ? "独立审阅要求退回，请先处理问题"
          : "到判断页完成独立审阅确认",
    },
    {
      id: "todos",
      label: "待办已清零",
      pass: blockers.length === 0,
      href: `/runs/${id}`,
      action: blockers.length ? `处理 ${blockers.length} 项剩余待办` : null,
    },
    {
      id: "stages",
      label: "五阶段均已确认",
      pass: stagesApproved,
      href: `/runs/${id}`,
      action: stagesApproved ? null : "返回概览检查未确认阶段",
    },
  ];

  return <>
    <StageSceneChrome
      runId={id}
      stage={5}
      status={artifact.status}
      outputCount={view.outputCount}
      statusNote={view.proceed.blockingReasons[0] || "日常交付条件已满足"}
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
          {dailyReady ? (
            <a className="button-secondary" href={`/api/runs/${id}/report.md`}>导出 Markdown ↓</a>
          ) : null}
          <StageStatusBadge status={artifact.status} pendingCount={blockers.length} />
          <Link className="button-quiet" href={journeyEditHref(id, 5)}>修改交付稿</Link>
        </>
      }
    />

    <section className={`delivery-readiness ${stagesApproved ? "ready" : "blocked"}`} aria-label="交付就绪清单">
      <div>
        <span>{stagesApproved ? "可导出正式包" : "尚未就绪"}</span>
        <strong>
          {stagesApproved
            ? "五个研究阶段均已确认，可导出包含正文、来源与审计记录的正式发布包"
            : view.proceed.blockingReasons.join("；") || "请按清单逐项解阻"}
        </strong>
      </div>
      <ol className="delivery-readiness-list">
        {readinessItems.map((item) => (
          <li key={item.id} className={item.pass ? "pass" : "blocked"}>
            <span>{item.label}</span>
            {item.pass ? <strong>已满足</strong> : (
              item.href && item.action
                ? <Link href={item.href}>{item.action} →</Link>
                : <strong>{item.action || "待处理"}</strong>
            )}
          </li>
        ))}
      </ol>
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
