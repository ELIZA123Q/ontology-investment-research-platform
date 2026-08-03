import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getMarketEvent, previousComparableRun } from "@/adapters/db";
import { getRunOverview, latestArtifactPayload, listArtifactLedger, listSourcesForAttribution } from "@/adapters/db_read_models";
import { listEvidenceImpactQueries, listEvidenceRequirementQueries, listVariableUsageQueries } from "@/adapters/ontology_research_queries";
import { researcherLanguage, judgmentStrengthLabel } from "@/app/lib/researcher-stage-output";
import { differenceCauseLabel, runStatusLabel } from "@/app/lib/ui-labels";
import { evidenceBoundSources } from "@/engine/evidence_sources";
import { runDifferenceAttribution } from "@/engine/metrics";
import { buildResearchAdvancedAnalysis } from "@/engine/research_advanced_analysis";
import { resolveRunLanding } from "@/engine/run_landing";
import { loadGraphForRun } from "@/engine/instance_graph";
import { formalStateVariableDisplayNames } from "@/engine/ontology_display_labels";
import { buildOntologyStructureReview, structureReviewActionHref } from "@/engine/ontology_structure_review";
import { parseJson } from "@/engine/types";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const overview = getRunOverview(id);
  if (!overview) notFound();
  const { run, progress, pendingWorkItems, jobs } = overview;
  const deliveryReady = progress.completed_stage_count === 5 && pendingWorkItems.length === 0;
  const landing = resolveRunLanding({
    runId: id,
    progress,
    artifacts: listArtifactLedger(id),
    workItems: pendingWorkItems as any,
    jobs,
    deliveryReady,
  });
  if (landing.kind !== "summary") redirect(landing.href);

  const taskData: any = parseJson(latestArtifactPayload(id, "stage_01", ["approved"])?.json_content || "{}", {});
  const structureData: any = parseJson(latestArtifactPayload(id, "stage_02", ["approved"])?.json_content || "{}", {});
  const evidenceData: any = parseJson(overview.stage03Json, {});
  const judgmentData: any = parseJson(overview.stage04Json, {});
  const expressionData: any = parseJson(latestArtifactPayload(id, "stage_05", ["approved"])?.json_content || "{}", {});
  const judgments = Array.isArray(judgmentData.judgments) ? judgmentData.judgments : [];
  const variableUsages = listVariableUsageQueries();
  const analysis = buildResearchAdvancedAnalysis({
    runId: id,
    evidence: evidenceData,
    judgment: judgmentData,
    impactQueries: listEvidenceImpactQueries(id),
    requirementImpacts: listEvidenceRequirementQueries(id),
    variableUsages,
  });
  const structureReview = buildOntologyStructureReview({
    runId: id,
    structure: structureData,
    evidence: evidenceData,
    judgment: judgmentData,
    graph: loadGraphForRun(id, run.package_path).graph,
    formalStateVariables: formalStateVariableDisplayNames(),
    variableUsages,
  });
  const structureActions = structureReview.recommended_actions.map((item) => ({
    source: "structure" as const,
    title: item.title,
    detail: item.detail,
    implication: item.priority === "high" ? "这会影响判断链完整性，应优先返回责任环节处理。" : "建议核对后再决定是否调整当前结构。",
    href: structureReviewActionHref(id, item),
  }));
  const researchActions = analysis.findings.filter((item) => item.kind !== "cross_run_reuse").map((item) => ({
    source: "research" as const,
    title: item.title,
    detail: item.detail,
    implication: item.implication,
    href: item.kind === "decision_limit"
      ? `/runs/${id}/evidence?focus=${encodeURIComponent(item.target_id || "")}&from=summary`
      : `/runs/${id}/insights`,
  }));
  const actions = [...structureActions, ...researchActions]
    .filter((item, index, values) => values.findIndex((candidate) => candidate.title === item.title) === index)
    .slice(0, 3);
  const executivePoints: string[] = Array.isArray(expressionData.executive_points)
    ? expressionData.executive_points.map(researcherLanguage).filter(Boolean).slice(0, 3)
    : [];
  const triggerEvent = run.trigger_event_id ? getMarketEvent(run.trigger_event_id) : undefined;
  const previousRun = previousComparableRun(id);
  const previousEvidence = previousRun ? latestArtifactPayload(previousRun.id, "stage_03", ["approved"]) : undefined;
  const currentEvidence = latestArtifactPayload(id, "stage_03", ["approved"]);
  const attribution = previousRun ? runDifferenceAttribution(
    {
      stage03: previousEvidence as any,
      stage04: latestArtifactPayload(previousRun.id, "stage_04", ["approved"]) as any,
      sources: evidenceBoundSources(listSourcesForAttribution(previousRun.id) as any, parseJson(previousEvidence?.json_content || "{}", {})),
    },
    {
      stage03: currentEvidence as any,
      stage04: latestArtifactPayload(id, "stage_04", ["approved"]) as any,
      sources: evidenceBoundSources(listSourcesForAttribution(id) as any, parseJson(currentEvidence?.json_content || "{}", {})),
    },
  ) : null;
  const cutoff = String(taskData.time_scope?.as_of || judgmentData.cutoff_at || "");
  const adoptionLabel = structureReview.adoption.status === "complete"
    ? "结构已完整承接"
    : structureReview.adoption.status === "limited"
      ? "结构已承接，研究仍受限制"
      : structureReview.adoption.status === "broken"
        ? "判断链存在关系错误"
        : "等待形成下游判断链";

  return <>
    <section className="research-summary-head">
      <div>
        <div className="eyebrow">已完成研究 · {run.domain === "semiconductor" ? "半导体" : "其他领域"}</div>
        <h1>{run.question}</h1>
        <div className="run-meta"><span>五阶段已确认</span><span>状态 {runStatusLabel("complete")}</span>{cutoff ? <span>研究截止 {formatDate(cutoff)}</span> : null}<span>更新于 {formatDate(run.updated_at)}</span></div>
      </div>
      <div className="actions"><Link className="button" href={`/runs/${id}/report`}>阅读交付报告 →</Link><Link className="button-secondary" href={`/runs/${id}/insights`}>质量与高级查询</Link></div>
    </section>

    {triggerEvent ? <section className="trigger-banner"><div><span>本轮由市场事件触发</span><strong>{triggerEvent.title}</strong><p>{triggerEvent.summary}</p></div><a href={triggerEvent.url} target="_blank" rel="noreferrer">查看来源 ↗</a></section> : null}

    <section className="summary-answer">
      <span>总体回答</span>
      {executivePoints.length ? <ol>{executivePoints.map((point, index) => <li key={`${index}:${point}`}>{point}</li>)}</ol> : <p>{judgments.every((item: any) => String(item.strength || item.level || "J0") === "J0") ? "现有证据不足以形成方向判断，研究结论停在明确边界内。" : "研究已形成有边界的阶段性判断，具体分项见下方判断矩阵。"}</p>}
    </section>

    <section className="summary-section">
      <div className="section-head"><div><div className="eyebrow">判断矩阵</div><h2>各项结论分别说到多强？</h2></div><Link href={`/runs/${id}/judgments`}>查看完整判断依据 →</Link></div>
      <div className="summary-judgment-grid">
        {judgments.map((judgment: any, index: number) => {
          const judgmentId = String(judgment.id || judgment.judgment_id || `J-${index + 1}`);
          const rationale = researcherLanguage(judgment.rationale || judgment.reasoning_summary || judgment.not_judgeable_reason || "");
          return <Link href={`/runs/${id}/judgments?focus=${encodeURIComponent(judgmentId)}`} className="summary-judgment" key={judgmentId}>
            <header><span>判断 {index + 1}</span><strong>{judgmentStrengthLabel(String(judgment.strength || judgment.level || "J0"))}</strong></header>
            <h3>{researcherLanguage(judgment.conclusion || judgment.statement || "尚未形成结论")}</h3>
            {rationale ? <p>{rationale}</p> : null}
          </Link>;
        })}
      </div>
    </section>

    <section className="summary-section summary-quality">
      <div className="section-head"><div><div className="eyebrow">质量与下一步</div><h2>流程是否完整，研究是否可判断？</h2></div><Link href={`/runs/${id}/insights`}>打开完整查询 →</Link></div>
      <div className="summary-quality-axis">
        <article><span>流程完整性</span><strong>{analysis.quality.process_label}</strong><small>只检查来源、关系与表达是否满足流程约束。</small></article>
        <article><span>研究可判断性</span><strong>{analysis.quality.decision_label}</strong><small>{analysis.quality.directional_judgment_count}/{analysis.quality.judgment_count} 项判断已形成方向。</small></article>
        <article className="structure-adoption-axis"><span>研究结构承接</span><strong>{adoptionLabel}</strong><small>
          02：{structureReview.adoption.judgment_unit_count} 个判断 · {structureReview.preflight.formal_bindings.length} 个正式变量 · {structureReview.preflight.task_local_candidates.length} 个本轮候选<br />
          03：证据要求满足 {structureReview.adoption.evidence_fulfillment.met} · 部分 {structureReview.adoption.evidence_fulfillment.partial} · 未满足 {structureReview.adoption.evidence_fulfillment.unmet}<br />
          04：完整 {structureReview.adoption.judgment_chain.complete} · 受限 {structureReview.adoption.judgment_chain.limited} · 错误 {structureReview.adoption.judgment_chain.broken}<br />
          本体作用：{structureReview.observed_contribution_count
            ? `${structureReview.observed_contribution_count} 项已观察到下游作用`
            : "本轮尚未观察到可追溯贡献"}
        </small><Link href={`/runs/${id}/object-set?view=judgments`}>打开判断链审计 →</Link></article>
      </div>
      {actions.length ? <div className="summary-action-list">{actions.map((action, index) => <article key={`${action.source}:${action.title}`}>
        <span>优先行动 {index + 1}</span><h3>{researcherLanguage(action.title)}</h3><p>{researcherLanguage(action.detail)}</p><strong>{researcherLanguage(action.implication)}</strong>
        <Link href={action.href}>查看并处理 →</Link>
      </article>)}</div> : null}
    </section>

    {previousRun && attribution ? <section className="card attribution-card"><div className="panel-title"><div><span>相较上一轮</span><strong>{attribution.causes.length} 类变化</strong></div><Link href={`/runs/${previousRun.id}`}>查看上一轮 →</Link></div><p>主要变化：{attribution.causes.map(differenceCauseLabel).join("、")}</p><div className="run-meta"><span>新增来源 {attribution.evidence.added_sources.length}</span><span>移除来源 {attribution.evidence.removed_sources.length}</span><span>方法变化 {attribution.methods.changed.length}</span><span>判断变化 {attribution.judgments.changed.length}</span></div></section> : null}
  </>;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
