import Link from "next/link";
import { latestArtifactPayload, listWorkItemsForReview } from "@/adapters/db_read_models";
import { IndependentReviewButton } from "@/app/components/independent-review-button";
import { ResearchGraphLazy } from "@/app/components/research-graph-lazy";
import { workItemForGraph } from "@/app/lib/client-rows";
import { buildJudgmentReviewGraph } from "@/app/lib/judgment-graph";
import { buildJudgmentResearcherView, buildJudgmentStageSummary } from "@/app/lib/researcher-stage-output";
import { parseJson } from "@/engine/types";
import { StageApprovalButton } from "@/app/components/stage-approval-button";
import { StageSceneChrome } from "@/app/components/stage-scene-chrome";
import { StageStatusBadge } from "@/app/components/stage-status-badge";
import { EmptyState } from "@/app/components/empty-state";
import { OntologyContributionPanel } from "@/app/components/ontology-contribution-panel";
import {
  buildOntologyContributionSummary,
} from "@/engine/ontology_contribution_summary";
import { getRunOntologyResearchValue } from "@/engine/knowledge_browser";
import { adaptArtifactForRead } from "@/engine/artifact_read_adapter";
import { journeyEditHref } from "@/app/lib/research-journey";

export const dynamic = "force-dynamic";

export default async function Judgments({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const artifact = latestArtifactPayload(id, "stage_04", ["approved", "needs_review"]);
  if (!artifact) {
    return (
      <EmptyState
        title="尚未形成研究判断"
        description="请先完成证据确认，再进入判断草稿页生成有边界的结论。"
        actionHref={journeyEditHref(id, 4)}
        actionLabel="进入判断草稿 →"
      />
    );
  }
  const evidenceData: any = parseJson(latestArtifactPayload(id, "stage_03", ["approved", "needs_review"])?.json_content || "{}", {});
  const reviewArtifact = latestArtifactPayload(id, "independent_review", ["needs_review", "approved"]);
  const review: any = parseJson(reviewArtifact?.json_content || "{}", {});
  const data: any = adaptArtifactForRead("stage_04", parseJson(artifact.json_content || "{}", {}));
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
  const judgmentSummaries = buildJudgmentStageSummary(data, evidence);
  const pendingJudgmentCount = workItems.filter((item) =>
    item.stage === "stage_04" && (item.status === "pending" || item.status === "rework"),
  ).length;
  const view = buildJudgmentResearcherView(data, evidence, {
    artifactStatus: artifact.status,
    pendingCount: pendingJudgmentCount,
  });
  const ontologyContribution = buildOntologyContributionSummary({
    researchValue: getRunOntologyResearchValue(id),
    judgments: data.judgments || [],
    limit: 4,
  });

  return <>
    <StageSceneChrome
      runId={id}
      stage={4}
      status={artifact.status}
      outputCount={judgmentSummaries.length}
      statusNote={pendingJudgmentCount ? `仍有 ${pendingJudgmentCount} 项判断等待人工确认。` : "判断已形成，可继续核对边界或进入交付。"}
      actions={
        <>
          <StageApprovalButton runId={id} artifactId={artifact.id} stage={4} status={artifact.status} canApprove={pendingJudgmentCount === 0} blockingHint={pendingJudgmentCount ? `先处理 ${pendingJudgmentCount} 项待核对判断` : undefined} />
          {artifact.status === "approved" ? <IndependentReviewButton runId={id} completed={Boolean(reviewArtifact)} /> : null}
          <StageStatusBadge status={artifact.status} pendingCount={pendingJudgmentCount} />
          <Link className="button-secondary" href={journeyEditHref(id, 4)}>修改判断</Link>
        </>
      }
    />
    <OntologyContributionPanel
      summary={ontologyContribution}
      title="因何约束停在当前强度"
      linkLabel="补全 / 限制 / 关联 →"
    />
    {judgmentSummaries.length ? (
      <section className="judgment-output-list" aria-label="研究判断">
        {judgmentSummaries.map((judgment, index) => (
          <article className="judgment-output-card" key={judgment.id}>
            <header>
              <div>
                <span>判断 {index + 1}</span>
                <h2>{judgment.conclusion || judgment.title}</h2>
              </div>
              <div className="judgment-strength">
                <strong>{judgment.strengthLabel}</strong>
                <small>{judgment.statusLabel}</small>
              </div>
            </header>
            {judgment.rationale ? <p className="judgment-rationale">{judgment.rationale}</p> : null}
            <div className="judgment-output-columns">
              <div>
                <strong>关键依据</strong>
                {judgment.evidence.length ? <ul>{judgment.evidence.slice(0, 4).map((item) => <li key={item}>{item}</li>)}</ul> : <p className="muted">当前没有可展示的已确认事实</p>}
              </div>
              <div>
                <strong>边界与竞争解释</strong>
                {[...judgment.uncertainties, ...judgment.competingExplanations].length
                  ? <ul>{[...judgment.uncertainties, ...judgment.competingExplanations].slice(0, 4).map((item) => <li key={item}>{item}</li>)}</ul>
                  : <p className="muted">未登记额外边界</p>}
              </div>
              <div>
                <strong>改判条件</strong>
                {judgment.invalidationConditions.length
                  ? <ul>{judgment.invalidationConditions.slice(0, 4).map((item) => <li key={item}>{item}</li>)}</ul>
                  : <p className="muted">尚未登记改判条件</p>}
                {judgment.trackingSignals.length ? (
                  <>
                    <strong>跟踪信号</strong>
                    <ul>{judgment.trackingSignals.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul>
                  </>
                ) : null}
              </div>
            </div>
          </article>
        ))}
      </section>
    ) : (
      <EmptyState
        title="尚未形成判断"
        description={emptyReason || view.summary || "请先完成证据确认。"}
        actionHref={journeyEditHref(id, 4)}
        actionLabel="进入判断草稿 →"
      />
    )}
    {reviewArtifact ? <section className={`review-strip ${review.verdict === "rework" ? "review-rework" : "review-pass"}`}><div><span>独立审阅 · {review.verdict === "pass" ? "通过" : review.verdict === "rework" ? "退回修改" : review.verdict}</span><strong>{(review.issues || []).length ? `${review.issues.length} 项问题需要处理` : "结论强度、证据边界与推理链未发现实质问题"}</strong></div><small>审阅记录已冻结</small></section> : null}
    <details className="advanced-tools stage-audit-details" open={pendingJudgmentCount > 0}>
      <summary>
        <div>
          <div className="eyebrow">{pendingJudgmentCount ? "待人工确认" : "审计详情"}</div>
          <strong>{pendingJudgmentCount ? `${pendingJudgmentCount} 项判断需要逐项处理` : "查看证据—信号—假设—规则—判断链路"}</strong>
        </div>
        <span className="section-meta">{pendingJudgmentCount ? "请在下方确认或退回" : "按需展开"}</span>
      </summary>
      <ResearchGraphLazy nodes={nodes} edges={edges} runId={id} workItems={workItems.map(workItemForGraph)} emptyMessage={emptyReason || "判断阶段尚未形成可视化判断。"} />
      {reviewArtifact?.markdown_content || review.overall_assessment ? (
        <details className="nested-audit-copy">
          <summary>查看独立审阅全文</summary>
          <p>{review.overall_assessment}</p>
        </details>
      ) : null}
    </details>
  </>;
}
