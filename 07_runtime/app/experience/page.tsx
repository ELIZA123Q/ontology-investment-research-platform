import Link from "next/link";
import { getExperienceCohort, type ExperienceCohortCase } from "@/runner/experience_cohort_adapter";
import { getWorkbenchDatabaseIdentity } from "@/storage/db";
import { researcherLanguage } from "@/app/lib/researcher-stage-output";

export const dynamic = "force-dynamic";

const scenarioLabels: Record<string, string> = {
  normal_success: "形成判断",
  conflict_stop: "冲突停止",
  insufficient_stop: "证据不足",
  incremental_rejudgment: "增量改判",
  source_invalidation: "来源失效",
};

const ontologyValueLabels: Record<string, string> = {
  semantic_alignment: "口径对齐",
  evidence_threshold: "证据上限",
  competing_explanation: "竞争解释",
  causal_boundary: "因果边界",
  stage_scope_guard: "阶段 / 范围挡门",
  incremental_invalidation: "增量失效",
  source_provenance: "来源血缘",
  cross_run_comparability: "跨任务可比",
  forecast_boundary: "事实 / 预测边界",
};

const statusLabels = {
  planned: "待开始",
  enrolled: "待确认范围",
  running: "研究中",
  completed: "已完成",
};

const gainStatusLabels = {
  insufficient_sample: "样本不足，不能判断流程增益",
  quality_incomplete: "质量对照未完成",
  quality_guardrail_failed: "质量护栏未通过",
  ready_for_provisional_analysis: "可以进行试运行分析",
};

const ontologyContributionLabels = {
  insufficient_sample: "结构化流程贡献样本不足",
  execution_incomplete: "缺少结构化流程执行测量",
  execution_guardrail_failed: "结构化流程执行链不完整",
  no_observed_benefit: "尚未观察到关键研究维度改善",
  ready_for_provisional_contribution_analysis: "可分析结构化研究流程的试运行贡献",
};

const actionLabels: Record<ExperienceCohortCase["progress"]["state"], string> = {
  not_started: "开始并登记 →",
  research_in_progress: "继续研究主链 →",
  baseline_needed: "生成同证据基线 →",
  baseline_review_needed: "核对并确认基线 →",
  independent_review_needed: "完成独立审阅 →",
  paired_review_needed: "完成 A/B 盲评 →",
  measurement_incomplete: "检查体验事件 →",
  analysis_ready: "查看完整结果 →",
  analysis_ready_quality_failed: "查看质量失败结果 →",
};

function caseActionHref(item: ExperienceCohortCase) {
  if (!item.run_id || item.progress.destination === "new_run") {
    return { pathname: "/runs/new", query: { question: item.question, experience_case_id: item.case_id } };
  }
  if (item.progress.destination === "compare") return `/runs/${item.run_id}/compare?mode=cohort`;
  if (item.progress.destination === "judgments") return `/runs/${item.run_id}/judgments`;
  if (item.progress.destination === "report") return `/runs/${item.run_id}/report`;
  return `/runs/${item.run_id}`;
}

function formatRange(metric: { count: number; median: number | null; min: number | null; max: number | null }, suffix = "") {
  if (metric.median === null) return { value: "—", detail: "尚无合格完成任务" };
  return {
    value: `${metric.median}${suffix}`,
    detail: metric.count > 1 ? `${metric.count} 题范围 ${metric.min}—${metric.max}${suffix}` : "1 题，暂不解释波动",
  };
}

function cohortDisplayName(id: string) {
  return id.includes("SEMI") ? "半导体流程体验基线" : "流程体验基线";
}

function caseDisplayName(id: string) {
  const ordinal = id.match(/S0*(\d+)$/i)?.[1];
  return ordinal ? `体验任务 ${ordinal}` : "体验任务";
}

export default function ExperienceCohortPage() {
  const cohort = getExperienceCohort();
  const database = getWorkbenchDatabaseIdentity();
  const summary = cohort.summary;
  const ttfc = formatRange(summary.primary.ttfc_minutes, " 分钟");
  const actions = formatRange(summary.primary.recorded_actions, " 次");
  const firstPass = summary.primary.first_pass.rate;
  const scoreDelta = summary.quality.paired_score_delta;
  const ontologyDelta = summary.ontology_value.ontology_sensitive_score_delta;
  const activeCases = cohort.cases.filter((item) => item.status !== "planned");
  const plannedCases = cohort.cases.filter((item) => item.status === "planned");
  const hasCompletedResearch = summary.completed_run_count > 0;
  return <>
    <div className="pagehead">
      <div>
        <div className="eyebrow">流程体验基线</div>
        <h1>用真实任务判断工作台是否值得</h1>
        <p className="muted">同一证据、同一截止日配对比较；质量不通过时，不宣称效率增益。</p>
      </div>
      <Link className="button-secondary" href="/runs">返回我的研究</Link>
    </div>

    {!database.cohort_eligible ? <div className="notice error">
      <strong>当前连接临时 QA 数据库，不能登记为正式前瞻样本。</strong>
      <div>请切换到持久工作台数据库后再开始案例；此页的计数只代表当前临时库。</div>
      <details><summary>排查信息</summary><div>{database.path}</div></details>
    </div> : null}

    <section className="card cohort-progress">
      <div>
        <span className="eyebrow">{cohortDisplayName(cohort.cohort_id)}</span>
        <strong>{summary.analysis_ready_count}/{cohort.target_gate}</strong>
        <span>可进入配对分析的完整任务</span>
      </div>
      <div className="cohort-progress-copy">
        <h2>{cohort.baseline_ready ? "已达到试运行分析样本门" : "仍在积累前瞻基线"}</h2>
        <p className="muted">已登记 {cohort.enrolled_count}/{cohort.cases.length} 题，完成研究 {summary.completed_run_count} 题。只有体验事件、独立审阅和同证据盲评齐全的任务才计入完整任务。</p>
      </div>
    </section>

    {hasCompletedResearch ? <>
      <section className="cohort-summary-grid" aria-label="前瞻体验汇总">
        <article className="card"><span>首次可用结论</span><strong>{ttfc.value}</strong><small>{ttfc.detail}</small></article>
        <article className="card"><span>研究员操作负担</span><strong>{actions.value}</strong><small>{actions.detail}</small></article>
        <article className="card"><span>一次完成率</span><strong>{firstPass === null ? "—" : `${Math.round(firstPass * 100)}%`}</strong><small>{summary.primary.first_pass.eligible ? `${summary.primary.first_pass.passed}/${summary.primary.first_pass.eligible} 题` : "交付确认后进入分母"}</small></article>
      </section>

      <section className={`card cohort-quality ${summary.quality.guardrail_status}`}>
        <div>
          <span className="eyebrow">质量与成本护栏</span>
          <h2>{gainStatusLabels[summary.workflow_gain_claim_status]}</h2>
          <p className="muted">即使时间或操作变少，只要独立审阅失败或同证据盲评落后，就不能宣称流程增益。</p>
        </div>
        <dl>
          <div><dt>独立审阅</dt><dd>{summary.quality.independent_review_passed}/{summary.quality.independent_review_measured}</dd></div>
          <div><dt>同证据盲评</dt><dd>{summary.quality.paired_reviewed}/{summary.measured_completed_count}</dd></div>
          <div><dt>方案分差中位数</dt><dd>{scoreDelta.median === null ? "—" : `${scoreDelta.median > 0 ? "+" : ""}${scoreDelta.median}`}</dd></div>
          <div><dt>当前产物 Token</dt><dd>{summary.cost.total_current_artifact_tokens || "—"}</dd></div>
        </dl>
      </section>

      <section className="card cohort-ontology-value">
        <div>
          <span className="eyebrow">结构化流程价值证据</span>
          <h2>{ontologyContributionLabels[summary.ontology_value.contribution_status]}</h2>
          <p className="muted">先确认约束、方法与追溯真实执行，再比较来源控制、竞争解释、结论边界和可复盘性。这里衡量整套结构化流程，不把全部差异归因于单一能力。</p>
        </div>
        <dl>
          <div><dt>执行测量完整</dt><dd>{summary.ontology_value.process_measured}/{cohort.target_gate}</dd></div>
          <div><dt>执行护栏通过</dt><dd>{summary.ontology_value.process_complete}/{cohort.target_gate}</dd></div>
          <div><dt>关键维度分差</dt><dd>{ontologyDelta.median === null ? "—" : `${ontologyDelta.median > 0 ? "+" : ""}${ontologyDelta.median}`}</dd></div>
          <div><dt>规则评估数中位数</dt><dd>{summary.ontology_value.rule_evaluation_count.median ?? "—"}</dd></div>
        </dl>
      </section>
    </> : <section className="card cohort-no-results">
      <div className="eyebrow">当前可行动信息</div>
      <h2>先完成正在推进的任务，再展示效率与质量指标</h2>
      <p className="muted">目前没有完成态研究。空白中位数、分差和通过率不具备解释价值，因此暂不展示；完成研究主链、独立审阅与同证据盲评后自动出现。</p>
    </section>}

    {activeCases.length ? <section className="cohort-active-cases">
      <div className="section-head"><div><div className="eyebrow">当前任务</div><h2>继续正在推进的体验任务</h2></div><span className="section-meta">{activeCases.length} 项</span></div>
      <div className="cohort-case-list">{activeCases.map((item) => <ExperienceCaseCard item={item} key={item.case_id} />)}</div>
    </section> : null}

    {plannedCases.length ? <details className="planned-case-queue">
      <summary>
        <div><strong>待开始任务库（{plannedCases.length}）</strong><span>需要新样本时再领取，不占用当前工作面</span></div>
      </summary>
      <div className="cohort-case-list">{plannedCases.map((item) => <ExperienceCaseCard item={item} key={item.case_id} />)}</div>
    </details> : null}
  </>;
}

function ExperienceCaseCard({ item }: { item: ExperienceCohortCase }) {
  return <article className="card cohort-case">
    <div className="cohort-case-head">
      <div><span className="eyebrow">{caseDisplayName(item.case_id)}</span><strong>{item.progress.label}</strong></div>
      <span className={`status ${item.status === "completed" ? "ok" : item.status === "running" ? "running" : ""}`}>{item.information_cutoff} 截止</span>
    </div>
    <h3>{item.question}</h3>
    <p className="muted">{item.decision_context}</p>
    <div className="cohort-tags">{item.scenarios.map((scenario) => <span key={scenario}>{scenarioLabels[scenario] || scenario}</span>)}</div>
    <details className="cohort-case-method">
      <summary>查看这项任务检验什么</summary>
      <div className="cohort-ontology-tags">{item.ontology_value_hypotheses.map((hypothesis) => <span key={hypothesis}>{ontologyValueLabels[hypothesis] || hypothesis}</span>)}</div>
      <div className="cohort-checklist" aria-label={`${item.case_id} 完成门槛`}>
        <span className={item.progress.checklist.research}>研究主链</span>
        <span className={item.progress.checklist.baseline}>同证据基线</span>
        <span className={item.progress.checklist.independent_review}>独立审阅</span>
        <span className={item.progress.checklist.paired_review}>A/B 盲评</span>
        <span className={item.progress.checklist.experience}>体验事件</span>
      </div>
    </details>
    <p className="cohort-next"><strong>下一步：</strong>{researcherLanguage(item.progress.detail)}</p>
    <div className="actions">
      <Link className={item.progress.state === "analysis_ready" ? "button-secondary" : "button"} href={caseActionHref(item)}>{actionLabels[item.progress.state]}</Link>
      {item.run_id ? <Link className="button-quiet" href={`/runs/${item.run_id}`}>{statusLabels[item.status]}</Link> : null}
    </div>
  </article>;
}
