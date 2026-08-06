import Link from "next/link";
import { isExperienceCohortRun } from "@/runner/experience_cohort_adapter";
import { latestArtifactPayload, listSourcesForReview } from "@/storage/db_read_models";
import { listResearchJobsForRun } from "@/runner/research_jobs";
import { BaselineButton } from "@/app/components/baseline-button";
import { CompareWorkspaceLazy } from "@/app/components/compare-workspace-lazy";
import { ReportMarkdown } from "@/app/components/report-markdown";
import { artifactForWorkspace } from "@/app/lib/client-rows";
import { latestJobForStage, researchJobIssueMessage, researchJobStatusLabel } from "@/app/lib/ui-labels";
import { comparisonMetrics } from "@/metrics";
import { ReferenceSceneChrome } from "@/app/components/stage-scene-chrome";

export const dynamic = "force-dynamic";

export default async function Compare({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mode?: string }>;
}) {
  const { id } = await params;
  const q = await searchParams;
  const evaluationCenterMode = q.mode === "cohort" && isExperienceCohortRun(id);
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
      hintOverride={evaluationCenterMode
        ? "该任务属于全局体验评测队列；实验操作只在评测中心上下文开放，不进入研究主链。"
        : "历史任务级评测只读保留；普通研究不再从这里生成基线、提交盲评或影响交付。"}
      actions={evaluationCenterMode
        ? <BaselineButton runId={id} artifactId={baselineRow?.id} status={baselineStatus} canGenerate={Boolean(evidenceRow)} inFlight={baselineJobInFlight} />
        : <Link className="button-secondary" href="/experience">前往独立评测中心</Link>}
    />
    <p className="muted" style={{ marginTop: -8 }}><Link className="backlink" href={`/runs/${id}`}>← 返回研究总览</Link></p>
    {evaluationCenterMode && baselineJob && !baselineJobInFlight ? <div className="notice error"><strong>{researchJobStatusLabel(baselineJob.status)}</strong><p>{researchJobIssueMessage(baselineJob.last_error) || "请检查冻结证据或任务状态后重试。"}</p></div> : null}
    {baselineRow?.status === "needs_review" ? <section className="card baseline-review-card">
      <div className="panel-title"><div><span>基线确认</span><strong>待确认</strong></div></div>
      <p>只核查这份草稿是否忠实使用冻结证据、是否误加外部信息。确认者不得担任后续 A/B 盲评评价人。</p>
      <article className="markdown"><ReportMarkdown content={baselineRow.markdown_content} readerView /></article>
    </section> : baseline?.status === "approved" && runtime ? <CompareWorkspaceLazy runId={id} baseline={baseline} runtime={runtime} evaluation={evaluation} metrics={metrics} canEvaluate={evaluationCenterMode && runtime.status === "approved"} readOnly={!evaluationCenterMode} /> : <div className="card empty-state">
      <h2>{evaluationCenterMode ? (!evidenceRow ? "先完成并确认证据阶段" : !baseline ? "生成同证据对照基线" : "等待交付报告确认") : "本任务没有可读取的历史盲评结果"}</h2>
      <p className="muted">{evaluationCenterMode ? (!evidenceRow ? "对照基线只能使用已冻结、已确认的证据包。" : !baseline ? "使用右上角操作生成；模型不得搜索或补充证据包外的信息。" : "基线已经确认，交付报告确认后即可开始盲评。") : "任务主链已移除盲评操作；如需开展严格流程评测，请从独立评测中心登记并进入。"}</p>
    </div>}
  </>;
}
