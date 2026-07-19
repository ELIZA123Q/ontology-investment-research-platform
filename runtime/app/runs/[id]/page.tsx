import Link from "next/link";
import { notFound } from "next/navigation";
import { getMarketEvent, getRunBundle, latestArtifact, listSources, listWorkItems, previousComparableRun } from "@/adapters/db";
import { BaselineButton } from "@/app/components/baseline-button";
import { PublishButton } from "@/app/components/publish-button";
import { RunNav } from "@/app/components/run-nav";
import { runDifferenceAttribution } from "@/engine/metrics";
import { parseJson } from "@/engine/types";
import { evidenceBoundSources } from "@/engine/evidence_sources";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bundle = getRunBundle(id);
  if (!bundle) notFound();
  const baseline = latestArtifact(id, "baseline", ["approved"]);
  const evaluation = latestArtifact(id, "evaluation", ["approved"]);
  const evidenceData: any = parseJson(latestArtifact(id, "stage_03", ["approved", "needs_review"])?.json_content || "{}", {});
  const judgmentData: any = parseJson(latestArtifact(id, "stage_04", ["approved", "needs_review"])?.json_content || "{}", {});
  const workItems = listWorkItems(id);
  const pending = workItems.filter((item) => item.status === "pending" || item.status === "rework");
  const report = latestArtifact(id, "stage_05", ["approved"]);
  const independentReview = latestArtifact(id, "independent_review", ["approved"]);
  const independentReviewData: any = parseJson(independentReview?.json_content || "{}", {});
  const deliveryReady = Boolean(report && independentReviewData.verdict === "pass" && baseline && evaluation && pending.length === 0);
  const triggerEvent = bundle.run.trigger_event_id ? getMarketEvent(bundle.run.trigger_event_id) : undefined;
  const previousRun = previousComparableRun(id);
  const previousEvidence = previousRun ? latestArtifact(previousRun.id, "stage_03", ["approved"]) : undefined;
  const currentEvidence = latestArtifact(id, "stage_03", ["approved"]);
  const attribution = previousRun ? runDifferenceAttribution(
    { stage03: previousEvidence, stage04: latestArtifact(previousRun.id, "stage_04", ["approved"]), sources: evidenceBoundSources(listSources(previousRun.id), parseJson(previousEvidence?.json_content || "{}", {})) },
    { stage03: currentEvidence, stage04: latestArtifact(id, "stage_04", ["approved"]), sources: evidenceBoundSources(bundle.sources, parseJson(currentEvidence?.json_content || "{}", {})) },
  ) : null;
  const completedStages = Object.values(bundle.manifest.stages).filter((stage) => stage.stage_status === "complete").length;
  const judgments = judgmentData.judgments || [];
  const evidence = evidenceData.evidence_drafts || [];
  const gaps = evidence.filter((item: any) => item.kind === "gap" || item.kind === "conflict");

  return <>
    <RunNav runId={id} active="overview" />
    <section className="run-summary">
      <div><div className="eyebrow">{bundle.run.parent_run_id ? "Incremental research update" : "Research run"} · {bundle.run.domain === "semiconductor" ? "Semiconductor" : "General"}</div><h1>{bundle.run.question}</h1><div className="run-meta"><span>阶段合同 {completedStages}/5</span><span>状态 {bundle.run.status}</span><span>待处理 {pending.length}</span>{bundle.run.parent_run_id ? <span>继承自父运行</span> : null}{bundle.manifest.validation_summary?.publish_status ? <span>{bundle.manifest.validation_summary.publish_status}</span> : null}</div></div>
      <div className="actions run-actions"><PublishButton runId={id} disabled={!deliveryReady} /><BaselineButton runId={id} /></div>
    </section>
    {triggerEvent ? <section className="trigger-banner"><div><span>本轮由市场事件触发</span><strong>{triggerEvent.title}</strong><p>{triggerEvent.summary}</p></div><a href={triggerEvent.url} target="_blank" rel="noreferrer">查看来源 ↗</a></section> : null}

    <div className="overview-grid">
      <section className="overview-decision">
        <div className="panel-title"><div><span>当前判断</span><strong>{judgments.length}</strong></div><Link href={`/runs/${id}/judgments`}>打开判断图 →</Link></div>
        {judgments.length ? judgments.slice(0, 3).map((judgment: any, index: number) => <article className="decision-row" key={judgment.id || index}><span>{judgment.strength || judgment.level || "J0"}</span><div><strong>{judgment.conclusion || judgment.statement}</strong><p>{(judgment.uncertainties || []).join("；") || judgment.rationale}</p></div></article>) : <div className="overview-empty"><h3>尚未形成正式判断</h3><p>先完成结构和证据准备，系统才能裁决结论强度。</p><Link className="button-secondary" href={`/runs/${id}/structure`}>查看问题树</Link></div>}
      </section>
      <aside className="overview-tasks"><div className="panel-title"><div><span>我的下一步</span><strong>{pending.length}</strong></div></div>{pending.length ? pending.slice(0, 8).map((item) => <Link href={workItemLink(item.stage, id)} key={item.id}><span>{sceneLabel(item.stage)}</span><strong>{item.title}</strong><small>{item.reason || item.target_id}</small></Link>) : bundle.run.current_stage < 5 ? <Link className="next-step-card" href={nextStageLink(bundle.run.current_stage, id)}><span>{nextStageLabel(bundle.run.current_stage)}</span><strong>{nextStageTitle(bundle.run.current_stage)}</strong><small>完成确认后，下一研究场景才会解锁。</small></Link> : <div className="queue-empty">阶段已完成，前往交付台检查发布就绪状态。</div>}</aside>
      <section className="overview-evidence"><div className="panel-title"><div><span>证据覆盖</span><strong>{evidence.length}</strong></div><Link href={`/runs/${id}/evidence`}>打开证据台 →</Link></div><div className="coverage-metrics"><div><strong>{evidence.filter((item: any) => item.direction === "support").length}</strong><span>支持</span></div><div><strong>{evidence.filter((item: any) => item.kind === "counter" || item.direction === "weaken").length}</strong><span>反证</span></div><div className={gaps.length ? "risk" : ""}><strong>{gaps.length}</strong><span>冲突 / 缺口</span></div></div><p className="muted">证据数量不代表结论强度；关键判断仍受最薄弱环节约束。</p></section>
    </div>

    {previousRun && attribution ? <section className="card attribution-card"><div className="panel-title"><div><span>同题运行差异</span><strong>{attribution.causes.length}</strong></div><Link href={`/runs/${previousRun.id}`}>查看上一次运行 →</Link></div><p>主要变化：{attribution.causes.join("、")}</p><div className="run-meta"><span>新增来源 {attribution.evidence.added_sources.length}</span><span>移除来源 {attribution.evidence.removed_sources.length}</span><span>方法变化 {attribution.methods.changed.length}</span><span>判断变化 {attribution.judgments.changed.length}</span></div></section> : null}

    <div className="section-head"><div><div className="eyebrow">Research tools</div><h2>实验与高级资产</h2></div><span className="section-meta">不属于研究员默认主链</span></div>
    <div className="grid"><Link className="card run-card" href={`/runs/${id}/object-set`}><span className="card-arrow">↗</span><span className="eyebrow">Advanced</span><h3>本体实例集合</h3><p>查询正式对象、关系和 Action 提案。</p></Link><Link className="card run-card" href={`/runs/${id}/compare`}><span className="card-arrow">↗</span><span className="eyebrow">Experiment</span><h3>A/B 对照</h3><p>{baseline ? "同证据基线已冻结，可开始盲评。" : "冻结阶段 03 证据后生成直接基线并盲评。"}</p></Link></div>
  </>;
}

function sceneLabel(stage: string) { return ({ stage_01: "范围", stage_02: "结构", stage_03: "证据", stage_04: "判断", stage_05: "交付" } as Record<string, string>)[stage] || stage; }
function workItemLink(stage: string, id: string) { if (stage === "stage_03") return `/runs/${id}/evidence`; if (stage === "stage_04") return `/runs/${id}/judgments`; if (stage === "stage_05") return `/runs/${id}/report`; if (stage === "stage_02") return `/runs/${id}/structure`; return `/runs/${id}/stages/1`; }
function nextStageLink(current: number, id: string) { return current <= 0 ? `/runs/${id}/stages/1` : current === 1 ? `/runs/${id}/stages/2` : current === 2 ? `/runs/${id}/stages/3` : current === 3 ? `/runs/${id}/stages/4` : `/runs/${id}/stages/5`; }
function nextStageLabel(current: number) { return ["范围", "结构", "证据", "判断", "交付"][Math.min(Math.max(current, 0), 4)]; }
function nextStageTitle(current: number) { return ["先把问题收敛为可证伪任务", "确认判断单元与必要证据", "围绕判断单元准备证据", "裁决结论强度与失效边界", "把获准判断表达为报告"][Math.min(Math.max(current, 0), 4)]; }
