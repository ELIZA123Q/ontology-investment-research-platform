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
import {
  differenceCauseLabel,
  latestJobForStage,
  researchJobIssueMessage,
  researchJobRecoveryHref,
  researchJobStatusLabel,
  runStatusLabel,
} from "@/app/lib/ui-labels";
import { buildResearchOverview, workItemHref } from "@/engine/research_overview";
import {
  buildOntologyContributionSummary,
} from "@/engine/ontology_contribution_summary";
import { getRunOntologyResearchValue } from "@/engine/knowledge_browser";
import { precheckStage03OntologyConstraints } from "@/engine/ontology_stage03_precheck";
import { RunPrimaryAction } from "@/app/components/run-primary-action";
import { OntologyContributionPanel } from "@/app/components/ontology-contribution-panel";
import { STAGES } from "@/engine/types";
import { buildEvidenceReadinessView, researcherLanguage } from "@/app/lib/researcher-stage-output";
import { researchStageByKind } from "@/app/lib/research-journey";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const overview = getRunOverview(id);
  if (!overview) notFound();
  const { run, manifest, pendingWorkItems: pending, report, independentReview, baseline, jobs } = overview;
  const evidenceData: any = parseJson(overview.stage03Json, {});
  const judgmentData: any = parseJson(overview.stage04Json, {});
  const independentReviewData: any = parseJson(independentReview?.json_content || "{}", {});
  const deliveryReady = Boolean(report && independentReviewData.verdict === "pass" && pending.length === 0);
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
  const nextStageKind = run.current_stage < 5 ? STAGES[run.current_stage] : undefined;
  const awaitingNextStageReview = nextStageKind
    ? Boolean(latestArtifactPayload(id, nextStageKind, ["needs_review"]))
    : false;
  const researchOverview = buildResearchOverview({
    runId: id,
    currentStage: run.current_stage,
    pending,
    awaitingReviewStage: awaitingNextStageReview ? nextStageKind : undefined,
    deliveryReady,
    judgments,
    evidence,
  });
  const latestNextStageJob = nextStageKind ? latestJobForStage(jobs, nextStageKind) : undefined;
  const activeNextJob = latestNextStageJob && ["queued", "running", "retrying", "waiting_for_input", "blocked"].includes(latestNextStageJob.status)
    ? latestNextStageJob
    : undefined;
  const activeJobReason = activeNextJob
    ? researchJobIssueMessage(parseJson<any>(activeNextJob.result_json || "{}", {}).reason || activeNextJob.last_error)
    : "";
  const primaryAction = pending.length === 0 && activeNextJob
    ? {
      ...researchOverview.primaryAction,
      href: researchJobRecoveryHref(id, activeNextJob.stage, activeNextJob.status),
      eyebrow: `生成任务 · ${researchJobStatusLabel(activeNextJob.status)}`,
      title: activeNextJob.status === "running"
        ? "AI 正在运行到下一个确认点"
        : activeNextJob.status === "queued" || activeNextJob.status === "retrying"
          ? "AI 任务已提交，等待继续执行"
          : "生成任务需要你处理",
      description: activeJobReason || (activeNextJob.status === "queued"
        ? "任务已提交，正在等待执行；若长时间未开始，请联系工作台管理员。"
        : activeNextJob.status === "retrying"
          ? "上次执行中断，将从本阶段起点安全重试。"
          : activeNextJob.status === "running"
            ? "可离开页面；后台完成后会停在人工确认。"
            : "请打开当前阶段检查输入、预算或失败原因。"),
      cta: ["waiting_for_input", "blocked"].includes(activeNextJob.status) ? "处理当前阶段 →" : "查看生成进度 →",
    }
    : researchOverview.primaryAction;
  const constraints = (researchOverview.strongestJudgment?.uncertainties || [])
    .map(researcherLanguage)
    .filter(Boolean)
    .slice(0, 2);
  const structureData: any = parseJson(latestArtifactPayload(id, "stage_02", ["approved", "needs_review"])?.json_content || "{}", {});
  const ontologyPrecheck = precheckStage03OntologyConstraints({
    evidence_drafts: evidence,
    sources: listSourcesForAttribution(id) as any,
    default_scope_ref: String(structureData.scope_ref || ""),
    cutoff_at: String((parseJson(latestArtifactPayload(id, "stage_01", ["approved"])?.json_content || "{}", {}) as any).time_scope?.as_of || ""),
  });
  const ontologyContribution = buildOntologyContributionSummary({
    researchValue: getRunOntologyResearchValue(id),
    precheck: run.current_stage >= 3 ? ontologyPrecheck : null,
    judgments,
    limit: 4,
  });
  const pendingGroups = Array.from(pending.reduce((groups, item) => {
    const current = groups.get(item.stage) || [];
    current.push(item);
    groups.set(item.stage, current);
    return groups;
  }, new Map<string, typeof pending>()));
  const showTasks = pending.length > 0;
  const showEvidence = run.current_stage >= 3 || evidence.length > 0 || gaps.length > 0;
  const overviewClass = "overview-grid";
  const readiness = buildEvidenceReadinessView(evidenceData);
  const evidenceReadyLine = [
    readiness.judgmentReadyLabel,
    `事实 ${readiness.factCount}`,
    `尚缺/矛盾 ${readiness.gapCount + readiness.conflictCount}`,
    pending.length ? `待处理 ${pending.length}` : null,
  ].filter(Boolean).join(" · ");

  return <>
    <section className="run-summary">
      <div><div className="eyebrow">{run.parent_run_id ? "增量更新" : "研究任务"} · {run.domain === "semiconductor" ? "半导体" : "其他领域"}</div><h1>{run.question}</h1><div className="run-meta"><span>已完成阶段 {completedStages}/5</span><span>状态 {runStatusLabel(run.status)}</span>{pending.length ? <span>待处理 {pending.length}</span> : null}<span>更新于 {formatRelativeTime(run.updated_at)}</span>{run.parent_run_id ? <span>继承自上一轮研究</span> : null}</div></div>
      <RunPrimaryAction runId={id} action={primaryAction} autoContinue={pending.length === 0 && run.current_stage < 5 && !awaitingNextStageReview && !activeNextJob} />
    </section>
    {triggerEvent ? <section className="trigger-banner"><div><span>本轮由市场事件触发</span><strong>{triggerEvent.title}</strong><p>{triggerEvent.summary}</p></div><a href={triggerEvent.url} target="_blank" rel="noreferrer">查看来源 ↗</a></section> : null}

    <div className={overviewClass}>
      <section className="overview-decision">
        <div className="panel-title"><div><span>研究结论</span>{judgments.length ? <strong>{judgments.length}</strong> : null}</div><Link href={`/runs/${id}/judgments`}>查看判断依据 →</Link></div>
        <article className={`conclusion-summary ${gaps.length ? "constrained" : ""}`}><span>{judgments.length ? (judgments.every((item: any) => String(item.strength || item.level || "J0") === "J0") ? "暂不判断" : "阶段性结论") : "等待判断"}</span><h2>{researcherLanguage(researchOverview.headline)}</h2><p>{researcherLanguage(researchOverview.explanation)}</p>{constraints.length ? <div className="conclusion-constraints"><strong>关键约束</strong>{constraints.map((item) => <small key={item}>{item}</small>)}</div> : null}</article>
        <OntologyContributionPanel summary={ontologyContribution} />
      </section>
      {showTasks ? <aside className="overview-tasks"><div className="panel-title"><div><span>待我处理</span><strong>{pending.length}</strong></div><small>按阶段归并</small></div>{pendingGroups.map(([stage, items]) => <Link href={workItemHref(stage, id)} key={stage}><span>{sceneLabel(stage)}</span><strong>{items.length} 项待处理</strong><small>{stageTaskHint(stage)}</small></Link>)}</aside> : (
        <aside className="overview-tasks overview-tasks-empty">
          <div className="panel-title"><div><span>待我处理</span><strong>0</strong></div></div>
          <p className="muted">当前没有需要人工确认的事项；可继续推进下一阶段。</p>
        </aside>
      )}
      {showEvidence ? <section className="overview-evidence"><div className="panel-title"><div><span>证据就绪度</span></div><Link href={`/runs/${id}/evidence`}>打开证据台 →</Link></div><p className="evidence-ready-line">{evidenceReadyLine}</p><p className="muted">{readiness.note}</p></section> : (
        <section className="overview-evidence overview-evidence-empty">
          <div className="panel-title"><div><span>证据就绪度</span></div></div>
          <p className="muted">进入证据阶段后，这里会摘要判断就绪度与尚缺项。</p>
        </section>
      )}
    </div>

    {previousRun && attribution ? <section className="card attribution-card"><div className="panel-title"><div><span>同题研究差异</span><strong>{attribution.causes.length}</strong></div><Link href={`/runs/${previousRun.id}`}>查看上一轮 →</Link></div><p>主要变化：{attribution.causes.map(differenceCauseLabel).join("、")}</p><div className="run-meta"><span>新增来源 {attribution.evidence.added_sources.length}</span><span>移除来源 {attribution.evidence.removed_sources.length}</span><span>方法变化 {attribution.methods.changed.length}</span><span>判断变化 {attribution.judgments.changed.length}</span></div></section> : null}

    <details className="advanced-tools">
      <summary>
        <div>
          <div className="eyebrow">质量验证与高级查询</div>
          <strong>不影响当前研究结论的附加工具</strong>
        </div>
        <span className="section-meta">不属于研究员默认主链</span>
      </summary>
      <div className="grid">
        <Link className="card run-card" href={`/runs/${id}/compare`}><span className="card-arrow">↗</span><span className="eyebrow">质量实验</span><h3>同证据盲评</h3><p>{baseline ? "对照基线已冻结，可比较两种研究流程。" : "证据确认后，可生成不补充外部信息的对照稿。"}</p></Link>
        <Link className="card run-card" href={`/runs/${id}/object-set`}><span className="card-arrow">↗</span><span className="eyebrow">高级审计</span><h3>本轮实例关系</h3><p>核对具体对象的正式连接和关系缺口；知识类型与规则定义在知识库查看。</p></Link>
        <Link className="card run-card" href="/experience"><span className="card-arrow">↗</span><span className="eyebrow">试运行</span><h3>流程体验基线</h3><p>查看真实任务队列与流程体验指标；不用于评价研究员绩效。</p></Link>
      </div>
    </details>
  </>;
}

function sceneLabel(stage: string) {
  return researchStageByKind(stage)?.navLabel || stage;
}

function stageTaskHint(stage: string) {
  const journey = researchStageByKind(stage);
  return journey?.confirmation || journey?.output || "完成当前阶段的人工确认";
}

function formatRelativeTime(value: string) {
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return value;
  const deltaSec = Math.round((Date.now() - ts) / 1000);
  if (deltaSec < 60) return "刚刚";
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)} 分钟前`;
  if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)} 小时前`;
  if (deltaSec < 86400 * 7) return `${Math.floor(deltaSec / 86400)} 天前`;
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(ts));
}
