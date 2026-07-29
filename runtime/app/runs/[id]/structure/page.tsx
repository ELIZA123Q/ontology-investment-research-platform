import { notFound } from "next/navigation";
import { getRun } from "@/adapters/db";
import { latestArtifactPayload } from "@/adapters/db_read_models";
import { ResearchGraphLazy } from "@/app/components/research-graph-lazy";
import { buildStructureReviewGraph } from "@/app/lib/structure-graph";
import { buildStructureResearcherView, buildStructureStageSummary } from "@/app/lib/researcher-stage-output";
import { scopeDimensionKeyLabel } from "@/engine/ontology_display_labels";
import { parseJson } from "@/engine/types";
import Link from "next/link";
import { StageApprovalButton } from "@/app/components/stage-approval-button";
import { StageSceneChrome } from "@/app/components/stage-scene-chrome";
import { StageStatusBadge } from "@/app/components/stage-status-badge";
import { EmptyState } from "@/app/components/empty-state";
import { journeyEditHref } from "@/app/lib/research-journey";
import { adaptArtifactForRead } from "@/engine/artifact_read_adapter";

export const dynamic = "force-dynamic";

export default async function StructurePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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

  return <>
    <StageSceneChrome
      runId={id}
      stage={2}
      status={artifact.status}
      outputCount={unitSummaries.length}
      subtitle={run.question}
      actions={
        <>
          <StageApprovalButton runId={id} artifactId={artifact.id} stage={2} status={artifact.status} />
          <StageStatusBadge status={artifact.status} />
          <Link className="button-secondary" href={journeyEditHref(id, 2)}>修改结构</Link>
        </>
      }
    />
    {unitSummaries.length ? (
      <>
      <section className="structure-review-summary" aria-label="研究范围">
        {scopeSummary ? (
          <article className="structure-review-card">
            <span>研究范围</span>
            <strong>{scopeSummary.label}</strong>
            {scopeSummary.dimensions.length ? (
              <dl>
                {scopeSummary.dimensions.map((dim) => (
                  <div key={dim.key}>
                    <dt>{scopeDimensionKeyLabel(dim.key)}</dt>
                    <dd>{dim.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <small>尚未登记范围维度</small>
            )}
          </article>
        ) : null}
        {view.proceed.blockingReasons.length ? (
          <article className="structure-review-card">
            <span>确认前注意</span>
            <ul>{view.proceed.blockingReasons.map((item) => <li key={item}>{item}</li>)}</ul>
          </article>
        ) : null}
      </section>
      <section className="stage-unit-list" aria-label="关键判断与必要证据">
        {unitSummaries.map((unit, index) => (
            <article className="stage-unit-card" key={unit.id}>
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
          <div className="eyebrow">审计详情</div>
          <strong>变量、传导路径与方法登记</strong>
        </div>
        <span className="section-meta">需要核对系统拆解时展开</span>
      </summary>
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
