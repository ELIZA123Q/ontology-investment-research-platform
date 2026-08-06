import Link from "next/link";
import { latestArtifactPayload, listWorkItemsForReview } from "@/storage/db_read_models";
import { ResearchGraphLazy } from "@/app/components/research-graph-lazy";
import { workItemForGraph } from "@/app/lib/client-rows";
import { buildJudgmentReviewGraph } from "@/app/lib/judgment-graph";
import { buildJudgmentResearcherView, buildJudgmentStageSummary, researcherLanguage } from "@/app/lib/researcher-stage-output";
import { parseJson } from "@/schemas/types";
import { StageApprovalButton } from "@/app/components/stage-approval-button";
import { StageSceneChrome } from "@/app/components/stage-scene-chrome";
import { StageStatusBadge } from "@/app/components/stage-status-badge";
import { EmptyState } from "@/app/components/empty-state";
import {
  buildOntologyContributionSummary,
} from "@/skills/ontology/contribution_summary";
import { getRunOntologyResearchValue } from "@/skills/method_selection/knowledge_browser";
import { adaptArtifactForRead } from "@/skills/semantic_review/artifact_read_adapter";
import { journeyEditHref } from "@/app/lib/research-journey";
import { DeepLinkFocus } from "@/app/components/deep-link-focus";
import { StageExceptionNotice } from "@/app/components/stage-exception-notice";

export const dynamic = "force-dynamic";

export default async function Judgments({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ focus?: string; from?: string }> }) {
  const { id } = await params;
  const q = await searchParams;
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
  const data: any = adaptArtifactForRead("stage_04", parseJson(artifact.json_content || "{}", {}));
  const workItems = listWorkItemsForReview(id);
  const evidence = (evidenceData.evidence_drafts || []).map((item: any, index: number) => ({
    ...item,
    id: String(item.id || item.evidence_id || `EV-${index + 1}`),
  }));
  const { nodes, edges, emptyReason } = buildJudgmentReviewGraph({
    stage04: data,
    evidenceDrafts: evidence,
    reviewIssues: [],
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
    <DeepLinkFocus id={q.focus} />
    <StageSceneChrome
      runId={id}
      stage={4}
      status={artifact.status}
      outputCount={judgmentSummaries.length}
      statusNote={pendingJudgmentCount ? undefined : "判断已形成，可继续核对边界或进入交付。"}
      actions={
        <>
          {pendingJudgmentCount === 0 ? <StageApprovalButton runId={id} artifactId={artifact.id} stage={4} status={artifact.status} /> : null}
          <StageStatusBadge status={artifact.status} pendingCount={pendingJudgmentCount} />
          <Link className="button-secondary" href={journeyEditHref(id, 4)}>修改判断</Link>
        </>
      }
    />
    {q.from === "audit" || q.from === "insights" ? <div className="notice audit-return-note">已定位到相关判断；修订并确认后，质量与关系结果会自动重算。</div> : null}
    <StageExceptionNotice exception={pendingJudgmentCount ? {
      title: `${pendingJudgmentCount} 项判断需要逐项确认`,
      summary: "确认或退回后，才能进入交付。",
      href: "#judgment-audit",
      actionLabel: "打开待确认判断 →",
    } : null} />
    {judgmentSummaries.length ? (
      <section className="judgment-output-list" aria-label="研究判断">
        {judgmentSummaries.map((judgment, index) => (
          <article id={`focus-${judgment.id}`} className={`judgment-output-card${q.focus === judgment.id ? " is-deep-linked" : ""}`} key={judgment.id}>
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
            <div className="judgment-output-columns">
              <div>
                <strong>为什么</strong>
                {judgment.rationale ? <p className="judgment-reason">{judgment.rationale}</p> : null}
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
                {judgment.trackingSignals.length ? <details className="judgment-tracking"><summary>后续跟踪（{judgment.trackingSignals.length}）</summary><ul>{judgment.trackingSignals.slice(0, 5).map((item) => <li key={item}>{item}</li>)}</ul></details> : null}
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
    <details id="judgment-audit" className="advanced-tools stage-audit-details" open={pendingJudgmentCount > 0}>
      <summary>
        <div>
          <div className="eyebrow">{pendingJudgmentCount ? "待人工确认" : "审计详情"}</div>
          <strong>{pendingJudgmentCount ? `${pendingJudgmentCount} 项判断需要逐项处理` : "查看证据—信号—假设—规则—判断链路"}</strong>
        </div>
        <span className="section-meta">{pendingJudgmentCount ? "请在下方确认或退回" : "按需展开"}</span>
      </summary>
      {ontologyContribution.headline || ontologyContribution.lines.length ? <div className="judgment-constraint-audit">
        <strong>{researcherLanguage(ontologyContribution.headline)}</strong>
        {ontologyContribution.lines.length ? <ul>{ontologyContribution.lines.map((line) => <li key={`${line.kind}:${line.title}`}><span>{researcherLanguage(line.title)}</span><small>{researcherLanguage(line.detail)}</small></li>)}</ul> : null}
      </div> : null}
      <ResearchGraphLazy nodes={nodes} edges={edges} runId={id} workItems={workItems.map(workItemForGraph)} emptyMessage={emptyReason || "判断阶段尚未形成可视化判断。"} />
    </details>
  </>;
}
