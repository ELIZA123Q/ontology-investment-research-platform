import Link from "next/link";
import { notFound } from "next/navigation";
import { getMarketEvent, previousComparableRun } from "@/adapters/db";
import {
  getRunOverview,
  latestArtifactPayload,
  listSourcesForAttribution,
} from "@/adapters/db_read_models";
import { runDifferenceAttribution } from "@/engine/metrics";
import { parseJson } from "@/engine/types";
import { evidenceBoundSources } from "@/engine/evidence_sources";
import { publishStatusLabel, researchJobStatusLabel, runStatusLabel } from "@/app/lib/ui-labels";
import { buildResearchOverview, stripInternalReferencePrefix, workItemHref } from "@/engine/research_overview";
import { RunPrimaryAction } from "@/app/components/run-primary-action";
import { STAGES } from "@/engine/types";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const overview = getRunOverview(id);
  if (!overview) notFound();
  const { run, manifest, pendingWorkItems: pending, report, independentReview, baseline, evaluation, jobs } = overview;
  const evidenceData: any = parseJson(overview.stage03Json, {});
  const judgmentData: any = parseJson(overview.stage04Json, {});
  const independentReviewData: any = parseJson(independentReview?.json_content || "{}", {});
  const deliveryReady = Boolean(report && independentReviewData.verdict === "pass" && baseline && evaluation && pending.length === 0);
  const triggerEvent = run.trigger_event_id ? getMarketEvent(run.trigger_event_id) : undefined;
  const previousRun = previousComparableRun(id);
  const previousEvidence = previousRun ? latestArtifactPayload(previousRun.id, "stage_03", ["approved"]) : undefined;
  const currentEvidence = latestArtifactPayload(id, "stage_03", ["approved"]);
  const attribution = previousRun ? runDifferenceAttribution(
    {
      stage03: previousEvidence as any,
      stage04: latestArtifactPayload(previousRun.id, "stage_04", ["approved"]) as any,
      sources: evidenceBoundSources(
        listSourcesForAttribution(previousRun.id) as any,
        parseJson(previousEvidence?.json_content || "{}", {}),
      ),
    },
    {
      stage03: currentEvidence as any,
      stage04: latestArtifactPayload(id, "stage_04", ["approved"]) as any,
      sources: evidenceBoundSources(
        listSourcesForAttribution(id) as any,
        parseJson(currentEvidence?.json_content || "{}", {}),
      ),
    },
  ) : null;
  const completedStages = Object.values(manifest.stages).filter((stage) => stage.stage_status === "complete").length;
  const judgments = judgmentData.judgments || [];
  const evidence = evidenceData.evidence_drafts || [];
  const gaps = evidence.filter((item: any) => item.kind === "gap" || item.kind === "conflict");
  const researchOverview = buildResearchOverview({
    runId: id,
    currentStage: run.current_stage,
    pending,
    deliveryReady,
    judgments,
    evidence,
  });
  const nextStageKind = run.current_stage < 5 ? STAGES[run.current_stage] : undefined;
  const awaitingNextStageReview = nextStageKind
    ? Boolean(latestArtifactPayload(id, nextStageKind, ["needs_review"]))
    : false;
  const activeNextJob = nextStageKind ? jobs.find((job) =>
    job.stage === nextStageKind && ["queued", "running", "retrying", "waiting_for_input", "blocked"].includes(job.status),
  ) : undefined;
  const activeJobReason = activeNextJob
    ? String(parseJson<any>(activeNextJob.result_json || "{}", {}).reason || activeNextJob.last_error || "")
    : "";
  const primaryAction = pending.length === 0 && activeNextJob
    ? {
      ...researchOverview.primaryAction,
      eyebrow: `后台任务 · ${researchJobStatusLabel(activeNextJob.status)}`,
      title: activeNextJob.status === "running"
        ? "AI 正在运行到下一个确认点"
        : activeNextJob.status === "queued" || activeNextJob.status === "retrying"
          ? "AI 任务已提交，等待继续执行"
          : "后台任务需要你处理",
      description: activeJobReason || (activeNextJob.status === "queued"
        ? "worker 取得租约后会自动执行；完成后停在人工确认。"
        : activeNextJob.status === "retrying"
          ? "上次执行中断，将从本阶段起点安全重试。"
          : activeNextJob.status === "running"
            ? "可离开页面；后台完成后会停在人工确认。"
            : "请打开当前阶段检查输入、预算或失败原因。"),
    }
    : researchOverview.primaryAction;
  const constraints = (researchOverview.strongestJudgment?.uncertainties || [])
    .map(stripInternalReferencePrefix)
    .filter(Boolean)
    .slice(0, 2);

  return <>
    <section className="run-summary">
      <div><div className="eyebrow">{run.parent_run_id ? "增量更新" : "研究任务"} · {run.domain === "semiconductor" ? "半导体" : "其他领域"}</div><h1>{run.question}</h1><div className="run-meta"><span>已完成阶段 {completedStages}/5</span><span>状态 {runStatusLabel(run.status)}</span><span>待处理 {pending.length}</span>{run.parent_run_id ? <span>继承自上一轮研究</span> : null}{manifest.validation_summary?.publish_status ? <span>{publishStatusLabel(manifest.validation_summary.publish_status)}</span> : null}</div></div>
      <RunPrimaryAction runId={id} action={primaryAction} autoContinue={pending.length === 0 && run.current_stage < 5 && !awaitingNextStageReview && !activeNextJob} />
    </section>
    {triggerEvent ? <section className="trigger-banner"><div><span>本轮由市场事件触发</span><strong>{triggerEvent.title}</strong><p>{triggerEvent.summary}</p></div><a href={triggerEvent.url} target="_blank" rel="noreferrer">查看来源 ↗</a></section> : null}

    <div className="overview-grid">
      <section className="overview-decision">
        <div className="panel-title"><div><span>研究结论</span><strong>{judgments.length}</strong></div><Link href={`/runs/${id}/judgments`}>查看判断依据 →</Link></div>
        <article className={`conclusion-summary ${gaps.length ? "constrained" : ""}`}><span>{judgments.length ? (judgments.every((item: any) => String(item.strength || item.level || "J0") === "J0") ? "暂不判断" : "阶段性结论") : "等待判断"}</span><h2>{researchOverview.headline}</h2><p>{researchOverview.explanation}</p>{constraints.length ? <div className="conclusion-constraints"><strong>关键约束</strong>{constraints.map((item) => <small key={item}>{item}</small>)}</div> : null}</article>
      </section>
      <aside className="overview-tasks"><div className="panel-title"><div><span>待我处理</span><strong>{pending.length}</strong></div></div>{pending.length ? pending.slice(0, 8).map((item) => <Link href={workItemHref(item.stage, id)} key={item.id}><span>{sceneLabel(item.stage)}</span><strong>{stripInternalReferencePrefix(item.title)}</strong><small>{stripInternalReferencePrefix(item.reason) || "需要人工确认"}</small></Link>) : <div className="queue-empty">当前没有待审事项；主动作已指向下一研究场景。</div>}</aside>
      <section className="overview-evidence"><div className="panel-title"><div><span>证据覆盖</span><strong>{evidence.length}</strong></div><Link href={`/runs/${id}/evidence`}>打开证据台 →</Link></div><div className="coverage-metrics"><div><strong>{evidence.filter((item: any) => item.direction === "support").length}</strong><span>支持</span></div><div><strong>{evidence.filter((item: any) => item.kind === "counter" || item.direction === "weaken").length}</strong><span>反证</span></div><div className={gaps.length ? "risk" : ""}><strong>{gaps.length}</strong><span>冲突 / 缺口</span></div></div><p className="muted">证据数量不代表结论强度；关键判断仍受最薄弱环节约束。</p></section>
    </div>

    {previousRun && attribution ? <section className="card attribution-card"><div className="panel-title"><div><span>同题研究差异</span><strong>{attribution.causes.length}</strong></div><Link href={`/runs/${previousRun.id}`}>查看上一轮 →</Link></div><p>主要变化：{attribution.causes.join("、")}</p><div className="run-meta"><span>新增来源 {attribution.evidence.added_sources.length}</span><span>移除来源 {attribution.evidence.removed_sources.length}</span><span>方法变化 {attribution.methods.changed.length}</span><span>判断变化 {attribution.judgments.changed.length}</span></div></section> : null}

    <div className="section-head"><div><div className="eyebrow">进阶工具</div><h2>实验与知识查询</h2></div><span className="section-meta">不属于研究员默认主链</span></div>
    <div className="grid"><Link className="card run-card" href={`/runs/${id}/object-set`}><span className="card-arrow">↗</span><span className="eyebrow">高级</span><h3>本轮实体关系</h3><p>查看业务实体 ER 图；本体网络请到知识库。</p></Link><Link className="card run-card" href={`/runs/${id}/compare`}><span className="card-arrow">↗</span><span className="eyebrow">实验</span><h3>A/B 对照</h3><p>{baseline ? "同证据基线已冻结，可开始盲评。" : "冻结证据后生成对照基线并盲评。"}</p></Link></div>
  </>;
}

function sceneLabel(stage: string) { return ({ stage_01: "范围", stage_02: "结构", stage_03: "证据", stage_04: "判断", stage_05: "交付" } as Record<string, string>)[stage] || stage; }
