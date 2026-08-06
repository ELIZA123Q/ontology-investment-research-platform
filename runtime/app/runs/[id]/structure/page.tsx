import { notFound } from "next/navigation";
import { getRun } from "@/storage/db";
import { latestArtifactPayload } from "@/storage/db_read_models";
import { ResearchGraphLazy } from "@/app/components/research-graph-lazy";
import { buildStructureReviewGraph } from "@/app/lib/structure-graph";
import { buildStageDecisionView, buildStructureResearcherView, buildStructureStageSummary } from "@/app/lib/researcher-stage-output";
import { formalStateVariableDisplayNames, scopeDimensionKeyLabel } from "@/skills/ontology/display_labels";
import { buildOntologyStructureReview } from "@/skills/ontology/structure_review";
import { parseJson } from "@/schemas/types";
import Link from "next/link";
import { StageApprovalButton } from "@/app/components/stage-approval-button";
import { StageSceneChrome } from "@/app/components/stage-scene-chrome";
import { StageStatusBadge } from "@/app/components/stage-status-badge";
import { EmptyState } from "@/app/components/empty-state";
import { journeyEditHref } from "@/app/lib/research-journey";
import { adaptArtifactForRead } from "@/skills/semantic_review/artifact_read_adapter";
import { DeepLinkFocus } from "@/app/components/deep-link-focus";
import { StageExceptionNotice } from "@/app/components/stage-exception-notice";

export const dynamic = "force-dynamic";

export default async function StructurePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ focus?: string; from?: string }> }) {
  const { id } = await params;
  const q = await searchParams;
  const run = getRun(id);
  if (!run) notFound();
  const artifact = latestArtifactPayload(id, "stage_02", ["approved", "needs_review"]);
  if (!artifact) {
    return (
      <EmptyState
        title="尚未形成研究结构"
        description="先进入结构编辑页拆出关键判断、必要证据与反证，再回到此处审阅确认。"
        actionHref={journeyEditHref(id, 2)}
        actionLabel="生成研究结构 →"
      />
    );
  }
  const data: any = adaptArtifactForRead("stage_02", parseJson(artifact.json_content || "{}", {}));
  const { nodes, edges, scopeSummary, methodSummary } = buildStructureReviewGraph({
    question: data.questions?.[0]?.statement || run.question,
    inherited: Boolean(run.parent_run_id),
    runStatus: run.status,
    research_scope: data.research_scope,
    judgment_units: data.judgment_units,
    variables: data.variables,
    paths: data.paths,
    questions: data.questions,
    evidence_requirements: data.evidence_requirements,
    competing_explanations: data.competing_explanations,
    counter_evidence_directions: data.counter_evidence_directions,
    method_applications: data.method_applications,
  });
  const unitSummaries = buildStructureStageSummary(data);
  const view = buildStructureResearcherView(data, { artifactStatus: artifact.status });
  const structureReview = buildOntologyStructureReview({
    structure: data,
    formalStateVariables: formalStateVariableDisplayNames(),
  });
  const canApprove = structureReview.preflight.status !== "blocked" && view.proceed.blockingReasons.length === 0;
  const blockingIssues = structureReview.preflight.issues
    .filter((item) => item.severity === "blocking")
    .map((item) => item.title);
  const blockingReasons = Array.from(new Set([...blockingIssues, ...view.proceed.blockingReasons]));
  const decision = buildStageDecisionView({
    outcome: view.summary,
    blockingReasons,
    blockingTitle: "研究结构还不能确认",
  });

  return <>
    <DeepLinkFocus id={q.focus} />
    <StageSceneChrome
      runId={id}
      stage={2}
      status={artifact.status}
      outputCount={unitSummaries.length}
      actions={
        <>
          {canApprove ? <StageApprovalButton
            runId={id}
            artifactId={artifact.id}
            stage={2}
            status={artifact.status}
          /> : null}
          <StageStatusBadge status={artifact.status} />
          {canApprove ? <Link className="button-secondary" href={journeyEditHref(id, 2)}>修改结构</Link> : null}
        </>
      }
    />
    {q.from === "audit" ? <div className="notice audit-return-note">已从关系审计定位到相关结构对象；修订并确认后，关系审计会自动重算。</div> : null}
    <StageExceptionNotice exception={decision.exception ? {
      ...decision.exception,
      summary: "只列出会阻止进入证据阶段的问题。",
      href: journeyEditHref(id, 2),
      actionLabel: "修正研究结构 →",
    } : null} />
    {unitSummaries.length ? (
      <>
      <section className="scope-anchor" aria-label="研究范围">
        {scopeSummary ? (
          <><div><span>范围锚点</span><strong>{scopeSummary.label}</strong>{scopeSummary.dimensions.length ? <small>{scopeSummary.dimensions.slice(0, 3).map((dim) => `${scopeDimensionKeyLabel(dim.key)}：${dim.value}`).join("；")}</small> : null}</div><Link href={`/runs/${id}/scope`}>查看 / 修改范围 →</Link></>
        ) : null}
      </section>
      <section className="stage-unit-list" aria-label="关键判断与必要证据">
        {unitSummaries.map((unit, index) => (
            <article id={`focus-${unit.id}`} className={`stage-unit-card${q.focus === unit.id ? " is-deep-linked" : ""}`} key={unit.id}>
              <div className="stage-unit-index">{String(index + 1).padStart(2, "0")}</div>
              <div className="stage-unit-main">
                <span>关键判断 {index + 1}</span>
                <h2>{unit.title}</h2>
                {unit.question && unit.question !== unit.title ? <p>{unit.question}</p> : null}
                <div className="stage-unit-columns">
                  <div>
                    <strong>形成判断前必须拿到</strong>
                    {unit.evidenceRequirements.length ? (
                      <ul>{unit.evidenceRequirements.slice(0, 5).map((item) => <li key={item}>{item}</li>)}</ul>
                    ) : <p className="muted">尚未登记必要证据</p>}
                    {unit.evidenceRequirements.length > 5 ? <small>另有 {unit.evidenceRequirements.length - 5} 项要求</small> : null}
                  </div>
                  <div>
                    <strong>必须检查的反面情况</strong>
                    {[...unit.counterEvidence, ...unit.competingExplanations].length ? (
                      <ul>{[...unit.counterEvidence, ...unit.competingExplanations].slice(0, 4).map((item) => <li key={item}>{item}</li>)}</ul>
                    ) : <p className="muted">尚未登记反证或竞争解释</p>}
                  </div>
                </div>
              </div>
            </article>
          ))}
      </section>
      </>
    ) : (
      <EmptyState
        title="尚未形成关键判断"
        description="结构草稿还没有可审阅的关键判断。请先在编辑页拆题并保存。"
        actionHref={journeyEditHref(id, 2)}
        actionLabel="进入结构编辑 →"
      />
    )}
    <details className="advanced-tools stage-audit-details">
      <summary>
        <div>
          <div className="eyebrow">结构审计</div>
          <strong>本体承接、变量、传导路径与方法</strong>
        </div>
        <span className="section-meta">{structureReview.preflight.issues.length ? `${structureReview.preflight.issues.length} 项记录` : "按需展开"}</span>
      </summary>
      <div className="audit-compact-summary">
        <span>正式口径 {structureReview.preflight.formal_bindings.length}</span>
        <span>本轮候选 {structureReview.preflight.task_local_candidates.length}</span>
        <span>结构问题 {structureReview.preflight.issues.length}</span>
      </div>
      {structureReview.preflight.issues.length ? <ul className="audit-issue-list">{structureReview.preflight.issues.map((item) => <li key={`${item.code}:${item.target_id}`}><strong>{item.severity === "blocking" ? "阻断" : "记录"}</strong>{item.title}</li>)}</ul> : null}
      {methodSummary.length ? (
        <div className="structure-method-tags stage-method-summary">
          {methodSummary.map((group) => (
            <span key={group.capability}>
              {group.label}
              <em>{group.items.length}</em>
            </span>
          ))}
        </div>
      ) : null}
      <ResearchGraphLazy nodes={nodes} edges={edges} emptyMessage="完成结构阶段后，问题树、变量、传导路径与判断单元会在这里生成。" />
    </details>
  </>;
}
