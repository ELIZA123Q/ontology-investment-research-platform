import { notFound } from "next/navigation";
import { getRun } from "@/adapters/db";
import { latestArtifactPayload } from "@/adapters/db_read_models";
import { ResearchGraphLazy } from "@/app/components/research-graph-lazy";
import { buildStructureReviewGraph } from "@/app/lib/structure-graph";
import { scopeDimensionKeyLabel } from "@/engine/ontology_display_labels";
import { parseJson } from "@/engine/types";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function StructurePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) notFound();
  const artifact = latestArtifactPayload(id, "stage_02", ["approved", "needs_review"]);
  const data: any = parseJson(artifact?.json_content || "{}", {});
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

  const hasSummary = Boolean(scopeSummary || methodSummary.length);

  return <>
    <div className="pagehead scene-head">
      <div>
        <div className="eyebrow">研究结构</div>
        <h1>{run.question}</h1>
        <p className="muted">问题 → 变量/路径 → 判断单元 → 证据与竞争解释；实体关系见 <Link href={`/runs/${id}/object-set`}>关系图</Link>，本体网络见 <Link href={`/ontology?runId=${id}`}>知识库</Link>。</p>
      </div>
      <div className="actions">
        <span className={`badge ${artifact?.status === "approved" ? "" : "warn"}`}>
          {artifact?.status === "approved" ? "已确认" : artifact?.status === "needs_review" ? "待确认" : artifact?.status || "尚未开始"}
        </span>
        <Link className="button-secondary" href={`/runs/${id}/stages/2`}>{artifact ? "高级编辑" : "生成研究结构"}</Link>
      </div>
    </div>
    {hasSummary ? (
      <section className="structure-review-summary" aria-label="研究范围与方法登记">
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
        {methodSummary.length ? (
          <article className="structure-review-card">
            <span>方法登记</span>
            <strong>{methodSummary.reduce((sum, group) => sum + group.items.length, 0)} 项已登记</strong>
            <div className="structure-method-tags">
              {methodSummary.map((group) => (
                <span key={group.capability}>
                  {group.label}
                  <em>{group.items.length}</em>
                </span>
              ))}
            </div>
          </article>
        ) : null}
      </section>
    ) : null}
    <ResearchGraphLazy nodes={nodes} edges={edges} emptyMessage="完成阶段 02 后，问题树、变量、传导路径与判断单元会在这里生成。" />
  </>;
}
