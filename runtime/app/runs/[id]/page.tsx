import Link from "next/link";
import { notFound } from "next/navigation";
import { getRunOverview, latestArtifactPayload, listArtifactLedger } from "@/storage/db_read_models";
import { listEvidenceImpactQueries, listEvidenceRequirementQueries, listVariableUsageQueries } from "@/skills/ontology/research_queries";
import { researcherLanguage, judgmentStrengthLabel } from "@/app/lib/researcher-stage-output";
import { buildResearchAdvancedAnalysis } from "@/runner/advanced_analysis";
import { resolveRunLanding } from "@/runner/run_landing";
import { loadGraphForRun } from "@/skills/ontology/instance_graph";
import { formalStateVariableDisplayNames } from "@/skills/ontology/display_labels";
import { buildOntologyStructureReview } from "@/skills/ontology/structure_review";
import { parseJson } from "@/schemas/types";
import { RunNav } from "@/app/components/run-nav";

export const dynamic = "force-dynamic";

const STAGE_NAMES: Record<string, string> = {
  stage_01: "范围",
  stage_02: "结构",
  stage_03: "证据",
  stage_04: "判断",
  stage_05: "报告",
};

function stageLabel(kind: string): string {
  return STAGE_NAMES[kind] || kind;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function domainLabel(domain: string): string {
  return domain === "semiconductor" ? "半导体" : domain;
}

function strengthClass(strength: string): string {
  switch (strength) {
    case "J3": return "is-strong";
    case "J2": return "is-moderate";
    case "J1": return "is-weak";
    default: return "is-none";
  }
}

function artifactActionLabel(kind: string, status: string): string {
  if (status === "approved") return `${stageLabel(kind)}已确认`;
  if (status === "needs_review") return `${stageLabel(kind)}待审阅`;
  if (status === "running") return `${stageLabel(kind)}生成中`;
  if (status === "failed") return `${stageLabel(kind)}失败`;
  return `${stageLabel(kind)}版本更新`;
}

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

  // Always render dashboard; use landing info for guidance banner
  const showNextAction = landing.kind !== "summary";

  const taskData: any = parseJson(latestArtifactPayload(id, "stage_01", ["approved"])?.json_content || "{}", {});
  const structureData: any = parseJson(latestArtifactPayload(id, "stage_02", ["approved"])?.json_content || "{}", {});
  const evidenceData: any = parseJson(overview.stage03Json, {});
  const judgmentData: any = parseJson(overview.stage04Json, {});
  const expressionData: any = parseJson(latestArtifactPayload(id, "stage_05", ["approved"])?.json_content || "{}", {});

  const judgments = Array.isArray(judgmentData.judgments) ? judgmentData.judgments : [];
  const evidenceDrafts = Array.isArray(evidenceData.evidence_drafts) ? evidenceData.evidence_drafts : [];
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

  // Stat counts
  const evidenceCount = evidenceDrafts.filter((item: any) => item.kind !== "gap").length;
  const counterEvidenceCount = evidenceDrafts.filter(
    (item: any) => item.direction === "counter" || item.evidence_role === "counter"
  ).length;
  const pendingCount = pendingWorkItems.length;
  const completedStageCount = progress.completed_stage_count;

  // Executive points from stage 05
  const executivePoints: string[] = Array.isArray(expressionData.executive_points)
    ? expressionData.executive_points.map(researcherLanguage).filter(Boolean).slice(0, 4)
    : [];

  // Activity feed from artifact ledger (last 8)
  const ledger = listArtifactLedger(id);
  const recentActivity = ledger.slice(0, 8);

  // Quick action hrefs
  const reportHref = `/runs/${id}/report`;
  const evidenceHref = `/runs/${id}/evidence`;
  const judgmentsHref = `/runs/${id}/judgments`;
  const historyHref = `/runs/${id}/history`;
  const insightsHref = `/runs/${id}/insights`;

  const cutoff = String(taskData.time_scope?.as_of || judgmentData.cutoff_at || "");

  // Next action guidance
  const nextActionLabel = landing.kind === "stage_review"
    ? `下一步：${stageLabel(landing.stage || "")}阶段需要你的审阅确认`
    : landing.kind === "job"
      ? `模型正在执行${stageLabel(landing.stage || "")}任务…`
      : landing.kind === "delivery_gate"
        ? "研究阶段已完成，请审阅报告并确认交付"
        : "";

  return (
    <div className="workspace-dashboard">
      {/* Next action banner */}
      {showNextAction && nextActionLabel ? (
        <div className="workspace-next-action">
          <span className="workspace-next-action-icon">→</span>
          <span>{nextActionLabel}</span>
          {landing.href && landing.kind !== "summary" ? (
            <Link href={landing.href} className="workspace-next-action-link">
              前往处理
            </Link>
          ) : null}
        </div>
      ) : null}

      {/* Scene nav */}
      <RunNav runId={id} active="overview" />

      {/* Research header */}
      <section className="workspace-dashboard-head">
        <div>
          <div className="eyebrow">
            {domainLabel(run.domain)}
            {deliveryReady ? " · 已完成研究" : ` · 阶段 ${completedStageCount}/5`}
          </div>
          <h1>{run.question}</h1>
          <div className="run-meta">
            {cutoff ? <span>研究截止 {formatDate(cutoff)}</span> : null}
            <span>更新于 {formatDate(run.updated_at)}</span>
          </div>
        </div>
        <div className="workspace-quick-actions">
          <Link href={reportHref} className="workspace-quick-action">
            阅读报告
          </Link>
          <Link href={evidenceHref} className="workspace-quick-action">
            证据台
          </Link>
          <Link href={insightsHref} className="workspace-quick-action">
            质量查询
          </Link>
          <Link href={judgmentsHref} className="workspace-quick-action">
            判断链
          </Link>
        </div>
      </section>

      {/* Stat cards */}
      <div className="workspace-stat-grid">
        <div className="workspace-stat-card is-evidence">
          <div className="stat-number">{evidenceCount}</div>
          <span className="stat-label">关键证据</span>
        </div>
        <div className="workspace-stat-card is-counter">
          <div className="stat-number">{counterEvidenceCount}</div>
          <span className="stat-label">反证 / 风险</span>
        </div>
        <div className="workspace-stat-card is-pending">
          <div className="stat-number">{pendingCount}</div>
          <span className="stat-label">待验证事项</span>
        </div>
        <div className="workspace-stat-card is-progress">
          <div className="stat-number">
            {completedStageCount}
            <span className="stat-number-sub">/5</span>
          </div>
          <span className="stat-label">研究阶段</span>
          <div className="workspace-progress-bar">
            {[1, 2, 3, 4, 5].map((n) => (
              <span
                key={n}
                className={`workspace-progress-step${
                  n <= completedStageCount ? " is-complete" : ""
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Executive summary / current conclusions */}
      {executivePoints.length > 0 ? (
        <section className="workspace-conclusion card">
          <div className="section-head">
            <div>
              <div className="eyebrow">当前判断</div>
              <h2>总体结论</h2>
            </div>
          </div>
          <ol style={{ margin: 0, paddingLeft: "20px", lineHeight: 1.8 }}>
            {executivePoints.map((point, i) => (
              <li key={i}>{point}</li>
            ))}
          </ol>
        </section>
      ) : null}

      {/* Judgment grid */}
      {judgments.length > 0 ? (
        <section>
          <div className="section-head">
            <div>
              <div className="eyebrow">判断矩阵</div>
              <h2>各项结论说到多强？</h2>
            </div>
            <Link href={judgmentsHref} style={{ fontSize: "13px", color: "var(--green)" }}>
              查看完整依据 →
            </Link>
          </div>
          <div className="workspace-judgment-grid">
            {judgments.map((j: any, i: number) => {
              const sid = String(j.id || j.judgment_id || `J-${i + 1}`);
              const strength = String(j.strength || j.level || "J0");
              const conclusion = researcherLanguage(j.conclusion || j.statement || "尚未形成结论");
              const rationale = researcherLanguage(j.rationale || j.reasoning_summary || j.not_judgeable_reason || "");
              // Count evidence items supporting this judgment
              const supportingEvidence = evidenceDrafts.filter((item: any) => {
                const unitIds = Array.isArray(item.judgment_unit_ids) ? item.judgment_unit_ids.map(String) : [];
                return unitIds.includes(sid) || unitIds.includes(String(j.id || j.judgment_id || ""));
              });
              const counterItems = supportingEvidence.filter((item: any) =>
                item.direction === "counter" || item.evidence_role === "counter"
              );

              return (
                <Link
                  key={sid}
                  href={`/runs/${id}/judgments?focus=${encodeURIComponent(sid)}`}
                  className="workspace-judgment-card"
                >
                  <header>
                    <span className="workspace-judgment-label">判断 {i + 1}</span>
                    <span className={`workspace-judgment-strength ${strengthClass(strength)}`}>
                      {judgmentStrengthLabel(strength)}
                    </span>
                  </header>
                  <h3>{conclusion}</h3>
                  {rationale ? <p>{rationale.slice(0, 120)}{rationale.length > 120 ? "…" : ""}</p> : null}
                  <div className="workspace-judgment-meta">
                    <span>支持证据 {supportingEvidence.length - counterItems.length}</span>
                    {counterItems.length > 0 ? (
                      <span className="is-counter">反证 {counterItems.length}</span>
                    ) : null}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ) : judgments.length === 0 && completedStageCount >= 2 ? (
        <section className="card">
          <div className="section-head">
            <div>
              <div className="eyebrow">判断结论</div>
              <h2>尚未形成判断</h2>
            </div>
          </div>
          <p className="muted">
            研究结构已建立，但判断裁决阶段尚未开始或正在进行中。
            {landing.stage ? ` 当前${stageLabel(landing.stage)}阶段需要你的参与。` : ""}
          </p>
        </section>
      ) : null}

      {/* Quality summary */}
      <section className="workspace-quality-row">
        <div className="workspace-quality-item">
          <span>流程完整性</span>
          <strong>{analysis.quality.process_label}</strong>
        </div>
        <div className="workspace-quality-item">
          <span>研究可判断性</span>
          <strong>{analysis.quality.decision_label}</strong>
          <small>
            {analysis.quality.directional_judgment_count}/{analysis.quality.judgment_count} 项已形成方向
          </small>
        </div>
        <div className="workspace-quality-item">
          <span>结构承接</span>
          <strong>
            {structureReview.adoption.status === "complete"
              ? "完整承接"
              : structureReview.adoption.status === "limited"
                ? "受限承接"
                : structureReview.adoption.status === "broken"
                  ? "存在错误"
                  : "等待下游"}
          </strong>
          <small>
            {structureReview.adoption.judgment_unit_count} 判断单元 ·{" "}
            {structureReview.adoption.evidence_fulfillment.met} 已满足
          </small>
        </div>
      </section>

      {/* Research activity feed */}
      {recentActivity.length > 0 ? (
        <section className="card">
          <div className="section-head">
            <div>
              <div className="eyebrow">研究动态</div>
              <h2>最近操作</h2>
            </div>
            <Link href={historyHref} style={{ fontSize: "13px", color: "var(--green)" }}>
              查看全部历史 →
            </Link>
          </div>
          <div className="workspace-activity-feed">
            {recentActivity.map((item) => (
              <div key={item.id} className="workspace-activity-item">
                <span className="workspace-activity-time">{formatTime(item.created_at)}</span>
                <span className="workspace-activity-action">
                  {artifactActionLabel(item.kind, item.status)}
                </span>
                <span className="workspace-activity-detail">
                  v{item.version}
                  {item.model_name ? ` · ${item.model_name}` : ""}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
