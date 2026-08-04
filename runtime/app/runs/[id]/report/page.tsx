import Link from "next/link";
import { latestArtifactMeta, latestArtifactPayload, listSourcesForReview, listWorkItemsForReview } from "@/adapters/db_read_models";
import { PublishButton } from "@/app/components/publish-button";
import { ReportMarkdown } from "@/app/components/report-markdown";
import { parseJson } from "@/engine/types";
import { StageApprovalButton } from "@/app/components/stage-approval-button";
import { StageSceneChrome } from "@/app/components/stage-scene-chrome";
import { StageStatusBadge } from "@/app/components/stage-status-badge";
import { EmptyState } from "@/app/components/empty-state";
import { buildDeliveryResearcherView, buildFormalDeliveryGate } from "@/app/lib/researcher-stage-output";
import { journeyEditHref } from "@/app/lib/research-journey";
import { buildReportClaimSourceIndex } from "@/engine/report_source_index";
import { StageExceptionNotice } from "@/app/components/stage-exception-notice";

export const dynamic = "force-dynamic";

export default async function Report({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const artifact = latestArtifactPayload(id, "stage_05", ["approved", "needs_review"]);
  if (!artifact) {
    return (
      <EmptyState
        title="尚未生成交付稿"
        description="请先确认判断，再进入报告草稿页生成读者可见正文。05 确认时会检查报告是否忠实表达 04。"
        actionHref={journeyEditHref(id, 5)}
        actionLabel="生成交付稿 →"
      />
    );
  }
  const data: any = parseJson(artifact.json_content || "{}", {});
  const claimSourceIndex = buildReportClaimSourceIndex(data, listSourcesForReview(id));
  const blockers = listWorkItemsForReview(id).filter((item) => item.status === "pending" || item.status === "rework");
  const dailyReady = Boolean(artifact.status === "approved" && blockers.length === 0);
  const upstreamStagesApproved = Boolean(
    latestArtifactMeta(id, "stage_01", ["approved"])
    && latestArtifactMeta(id, "stage_02", ["approved"])
    && latestArtifactMeta(id, "stage_03", ["approved"])
    && latestArtifactMeta(id, "stage_04", ["approved"])
  );
  const stagesApproved = Boolean(upstreamStagesApproved && artifact.status === "approved" && blockers.length === 0);
  const stageKinds = ["stage_01", "stage_02", "stage_03", "stage_04", "stage_05"] as const;
  const stagesBelowHq = stageKinds
    .map((s) => {
      const a = latestArtifactPayload(id, s, ["approved"]);
      if (!a) return null;
      const d: any = parseJson(a.json_content || "{}", {});
      return String(d.quality_status || "") === "high_quality_pass" ? null : s;
    })
    .filter((x): x is "stage_01" | "stage_02" | "stage_03" | "stage_04" | "stage_05" => x !== null);
  const allStagesHighQualityPass = stagesBelowHq.length === 0;
  const deliveryGate = buildFormalDeliveryGate({
    artifactApproved: artifact.status === "approved",
    pendingCount: blockers.length,
    allStagesApproved: stagesApproved,
    allStagesHighQualityPass,
  });
  const view = buildDeliveryResearcherView(data, {
    artifactStatus: artifact.status,
    pendingCount: blockers.length,
    stagesApproved,
  });
  const actionableBlockingReasons = [
    blockers.length ? `仍有 ${blockers.length} 项待办` : "",
    !upstreamStagesApproved ? "前四个研究阶段尚未全部确认" : "",
    stagesBelowHq.length
      ? `阶段 ${stagesBelowHq.map((s) => s.replace("stage_", "")).join("、")} 未达到高质量通过（high_quality_pass），不满足正式交付门槛`
      : "",
  ].filter(Boolean);

  return <>
    <StageSceneChrome
      runId={id}
      stage={5}
      status={artifact.status}
      outputCount={view.outputCount}
      statusNote={view.proceed.blockingReasons.length ? undefined : "日常交付条件已满足"}
      showNextStep={false}
      actions={
        <>
          {blockers.length === 0 ? <StageApprovalButton
            runId={id}
            artifactId={artifact.id}
            stage={5}
            status={artifact.status}
          /> : null}
          <StageStatusBadge status={artifact.status} pendingCount={blockers.length} />
          <Link className="button-quiet" href={journeyEditHref(id, 5)}>修改交付稿</Link>
        </>
      }
    />

    <StageExceptionNotice exception={actionableBlockingReasons.length ? {
      title: "尚未达到正式发布条件",
      items: actionableBlockingReasons,
      href: blockers.length ? `/runs/${id}` : journeyEditHref(id, 5),
      actionLabel: blockers.length ? "处理剩余待办 →" : "核对交付稿 →",
    } : null} />

    {deliveryGate.ready ? <section className="release-toolbar" aria-label="交付操作">
      <div><span>已可正式发布</span><strong>报告与来源映射已锁定为同一版本</strong></div>
      <div className="actions">
        <PublishButton
          runId={id}
          disabled={false}
        />
        {dailyReady ? <a className="button-secondary" href={`/api/runs/${id}/report.md`}>导出 Markdown ↓</a> : null}
      </div>
    </section> : null}

    <article className="card markdown report-document"><ReportMarkdown content={artifact.markdown_content} readerView /></article>

    <details className="advanced-tools stage-audit-details delivery-audit-details">
      <summary><div><div className="eyebrow">交付与来源详情</div><strong>发布制品边界与核心主张来源</strong></div><span className="section-meta">按需展开</span></summary>
      <section className="release-package-boundary" aria-label="正式发布制品说明">
        <div><div className="eyebrow">对外交付包</div><strong>报告、必要图表与来源索引</strong><p className="muted">不包含完整证据快照、内部推理审计或方法正文。</p></div>
        <div><div className="eyebrow">内部审计包</div><strong>完整五阶段、证据链与知识锁</strong><p className="muted">用于内部复核、回放和增量更新。</p></div>
      </section>
      {claimSourceIndex.length ? <section className="report-source-index" aria-label="核心主张来源索引">
        <div className="panel-title">
          <div>
            <span>正文复核入口</span>
            <strong>核心主张与来源逐条对应</strong>
          </div>
          <small>{claimSourceIndex.length} 条主张</small>
        </div>
        <p className="muted">这里只展示已绑定到报告主张的来源；逐字引文、正文哈希和完整审计记录保留在证据台与内部研究审计包中。</p>
        <div className="report-source-index-list">
          {claimSourceIndex.map((entry, index) => (
            <details key={`${index}:${entry.statement}`}>
              <summary><span>{index + 1}</span><strong>{entry.statement}</strong><em>{entry.sources.length} 个来源</em></summary>
              <ul>
                {entry.sources.map((source) => (
                  <li key={source.id}>
                    <a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a>
                    <small>{source.publisher} · {source.publishedAt}</small>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      </section> : <p className="muted">当前没有可展示的核心主张来源索引。</p>}
    </details>
  </>;
}
