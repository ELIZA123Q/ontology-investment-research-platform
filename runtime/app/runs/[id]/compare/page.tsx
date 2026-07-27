import Link from "next/link";
import { latestArtifactPayload, listSourcesForReview } from "@/adapters/db_read_models";
import { listResearchJobsForRun } from "@/adapters/research_jobs";
import { BaselineButton } from "@/app/components/baseline-button";
import { CompareWorkspaceLazy } from "@/app/components/compare-workspace-lazy";
import { ReportMarkdown } from "@/app/components/report-markdown";
import { artifactForWorkspace } from "@/app/lib/client-rows";
import { latestJobForStage, researchJobIssueMessage, researchJobStatusLabel } from "@/app/lib/ui-labels";
import { comparisonMetrics } from "@/engine/metrics";
import { ReferenceSceneChrome } from "@/app/components/stage-scene-chrome";

export const dynamic = "force-dynamic";

export default async function Compare({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const baselineRow = latestArtifactPayload(id, "baseline", ["needs_review", "approved"]);
  const runtimeRow = latestArtifactPayload(id, "stage_05", ["needs_review", "approved"]);
  const evidenceRow = latestArtifactPayload(id, "stage_03", ["approved"]);
  const evaluationRow = latestArtifactPayload(id, "evaluation", ["approved"]);
  const latestBaselineJob = latestJobForStage(listResearchJobsForRun(id), "baseline");
  const baselineJob = latestBaselineJob && ["queued", "running", "retrying", "waiting_for_input", "blocked"].includes(latestBaselineJob.status)
    ? latestBaselineJob
    : undefined;
  const baselineJobInFlight = Boolean(baselineJob && ["queued", "running", "retrying"].includes(baselineJob.status));
  const metrics = baselineRow && runtimeRow
    ? comparisonMetrics(
      baselineRow as any,
      runtimeRow as any,
      latestArtifactPayload(id, "stage_03", ["approved"]) as any,
      latestArtifactPayload(id, "stage_04", ["approved"]) as any,
      listSourcesForReview(id) as any,
    )
    : {};
  const baseline = baselineRow ? artifactForWorkspace(baselineRow) : undefined;
  const runtime = runtimeRow ? artifactForWorkspace(runtimeRow) : undefined;
  const evaluation = evaluationRow ? artifactForWorkspace(evaluationRow) : undefined;
  const baselineStatus = baselineRow?.status === "approved"
    ? "approved"
    : baselineRow?.status === "needs_review"
      ? "needs_review"
      : "missing";

  return <>
    <ReferenceSceneChrome
      sceneId="compare"
      actions={<BaselineButton runId={id} artifactId={baselineRow?.id} status={baselineStatus} canGenerate={Boolean(evidenceRow)} inFlight={baselineJobInFlight} />}
    />
    <p className="muted" style={{ marginTop: -8 }}><Link className="backlink" href={`/runs/${id}`}>← 返回研究总览</Link></p>
    {baselineJob && !baselineJobInFlight ? <div className="notice error"><strong>{researchJobStatusLabel(baselineJob.status)}</strong><p>{researchJobIssueMessage(baselineJob.last_error) || "请检查冻结证据或任务状态后重试。"}</p></div> : null}
    {baselineRow?.status === "needs_review" ? <section className="card baseline-review-card">
      <div className="panel-title"><div><span>基线确认</span><strong>待确认</strong></div></div>
      <p>只核查这份草稿是否忠实使用冻结证据、是否误加外部信息。确认者不得担任后续 A/B 盲评评价人。</p>
      <article className="markdown"><ReportMarkdown content={baselineRow.markdown_content} readerView /></article>
    </section> : baseline?.status === "approved" && runtime ? <CompareWorkspaceLazy runId={id} baseline={baseline} runtime={runtime} evaluation={evaluation} metrics={metrics} canEvaluate={runtime.status === "approved"} /> : <div className="card empty-state"><h2>{!evidenceRow ? "先完成并确认证据阶段" : !baseline ? "生成同证据对照基线" : "等待交付报告确认"}</h2><p className="muted">{!evidenceRow ? "对照基线只能使用已冻结、已确认的证据包。" : !baseline ? "点击右上角生成；模型不得搜索或补充证据包外的信息。" : "基线已经确认，交付报告确认后即可开始盲评。"}</p></div>}
  </>;
}
