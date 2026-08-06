import Link from "next/link";
import { notFound } from "next/navigation";
import { getRun } from "@/storage/db";
import { latestArtifactPayload } from "@/storage/db_read_models";
import { listEvidenceImpactQueries, listEvidenceRequirementQueries, listVariableUsageQueries } from "@/skills/ontology/research_queries";
import { parseJson } from "@/schemas/types";
import { buildResearchAdvancedAnalysis } from "@/runner/advanced_analysis";
import { judgmentStrengthLabel, researcherLanguage } from "@/app/lib/researcher-stage-output";

export const dynamic = "force-dynamic";

const priorityLabel = { high: "优先处理", medium: "需要核对", opportunity: "复用机会" } as const;

export default async function ResearchInsightsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) notFound();
  const evidence = parseJson<Record<string, any>>(
    latestArtifactPayload(id, "stage_03", ["approved", "needs_review"])?.json_content || "{}",
    {},
  );
  const judgment = parseJson<Record<string, any>>(
    latestArtifactPayload(id, "stage_04", ["approved", "needs_review"])?.json_content || "{}",
    {},
  );
  const analysis = buildResearchAdvancedAnalysis({
    runId: id,
    evidence,
    judgment,
    impactQueries: listEvidenceImpactQueries(id),
    requirementImpacts: listEvidenceRequirementQueries(id),
    variableUsages: listVariableUsageQueries(),
  });

  return <>
    <div className="pagehead research-insight-head">
      <div>
        <div className="eyebrow">自动运行 · 质量验证与研究增量</div>
        <h1>哪些结论可信，哪里最值得继续查？</h1>
        <p className="muted">只读取本研究已形成的证据、判断和正式关系；结果会随研究更新自动重算，不会静默改写结论。</p>
      </div>
      <Link className="button-secondary" href={`/runs/${id}`}>返回研究概览</Link>
    </div>

    <section className={`card research-quality-summary is-${analysis.quality.status}`}>
      <div>
        <span className="eyebrow">本次自动检查</span>
        <h2>{analysis.quality.process_label}</h2>
        <p className="muted">研究可判断性：{analysis.quality.decision_label}。流程检查与结论可信度分开呈现，不会把合规误写成高置信结论。</p>
      </div>
      <dl>
        <div><dt>正式事实</dt><dd>{analysis.quality.evidence_fact_count}</dd></div>
        <div><dt>独立来源组</dt><dd>{analysis.quality.source_group_count || "—"}</dd></div>
        <div><dt>尚缺 / 矛盾</dt><dd>{analysis.quality.gap_count}</dd></div>
        <div><dt>可形成方向</dt><dd>{analysis.quality.directional_judgment_count}/{analysis.quality.judgment_count}</dd></div>
      </dl>
    </section>

    <section className="research-finding-section">
      <div className="section-head"><div><div className="eyebrow">这次运行真正发现了什么</div><h2>优先级按对总问题的影响排序</h2></div><span className="section-meta">{analysis.findings.length} 项</span></div>
      <div className="research-finding-list">
        {analysis.findings.map((finding, index) => (
          <article className={`card research-finding is-${finding.priority}`} key={`${finding.kind}:${finding.target_id || index}`}>
            <header><span>{priorityLabel[finding.priority]}</span><small>{finding.kind === "cross_run_reuse" ? "跨研究" : "本研究"}</small></header>
            <h3>{researcherLanguage(finding.title)}</h3>
            <p>{researcherLanguage(finding.detail)}</p>
            <strong>{researcherLanguage(finding.implication)}</strong>
            {finding.kind === "decision_limit" ? <Link href={`/runs/${id}/evidence?focus=${encodeURIComponent(finding.target_id || "")}&from=insights`}>回到证据核对 →</Link> : null}
            {finding.kind === "single_point" ? <Link href={`/runs/${id}/judgments?focus=${encodeURIComponent(finding.target_id || "")}&from=insights`}>回到判断核对 →</Link> : null}
            {finding.kind === "unused_evidence" || finding.kind === "shared_dependency" ? <Link href={`/runs/${id}/evidence`}>回到证据核对 →</Link> : null}
            {finding.kind === "cross_run_reuse" ? <Link href={`/ontology?tab=comparability&runId=${id}`}>检查跨研究口径 →</Link> : null}
          </article>
        ))}
      </div>
    </section>

    <section className="card research-impact-table">
      <div className="section-heading">
        <div><div className="eyebrow">高级查询 · 已自动执行</div><h2>证据改变时，会波及哪些判断？</h2></div>
        <span className="badge">{analysis.impact_queries.length} 条事实链</span>
      </div>
      <div className="research-impact-list">
        {analysis.impact_queries.map((query) => (
          <details key={query.evidence.id}>
            <summary><strong>{query.evidence.label}</strong><span>{query.impacted_judgments.length ? `影响 ${query.impacted_judgments.length} 个判断` : "尚未进入判断"}</span></summary>
            {query.impacted_judgments.map((item) => <p key={item.id}><b>{item.id}</b>{researcherLanguage(item.label)}<small>{judgmentStrengthLabel(item.strength)}</small></p>)}
            {!query.impacted_judgments.length ? <p className="muted">这条事实目前没有可追溯的下游判断，需补关系或移出有效证据集。</p> : null}
          </details>
        ))}
      </div>
    </section>

  </>;
}
