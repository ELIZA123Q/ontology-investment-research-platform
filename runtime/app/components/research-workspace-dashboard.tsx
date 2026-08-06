"use client";

import type { ReactNode } from "react";
import Link from "next/link";

/** Props passed from the server page (runs/[id]/page.tsx) */
export type WorkspaceDashboardProps = {
  runId: string;
  runQuestion: string;
  runDomain: string;
  runCutoff: string;
  runUpdatedAt: string;
  judgments: Array<{
    id?: string;
    judgment_id?: string;
    conclusion?: string;
    statement?: string;
    strength?: string;
    level?: string;
    rationale?: string;
    reasoning_summary?: string;
    not_judgeable_reason?: string;
    evidence_ids?: string[];
  }>;
  executivePoints: string[];
  /** Stat counts */
  evidenceCount: number;
  counterEvidenceCount: number;
  pendingCount: number;
  completedStageCount: number;
  /** Quality labels */
  processQualityLabel: string;
  decisionQualityLabel: string;
  directionalCount: number;
  totalJudgmentCount: number;
  /** Quick actions */
  reportHref: string;
  evidenceHref: string;
  insightsHref: string;
  objectSetHref: string;
  /** children rendered below dashboard */
  children?: ReactNode;
};

function domainLabel(domain: string): string {
  return domain === "semiconductor" ? "半导体" : domain;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function judgmentStrengthLabel(strength: string): string {
  switch (strength) {
    case "J3":
      return "强支持";
    case "J2":
      return "较强支持";
    case "J1":
      return "弱支持";
    case "J0":
      return "暂不可判断";
    default:
      return strength || "—";
  }
}

function strengthClass(strength: string): string {
  switch (strength) {
    case "J3":
      return "is-strong";
    case "J2":
      return "is-moderate";
    case "J1":
      return "is-weak";
    default:
      return "is-none";
  }
}

export function ResearchWorkspaceDashboard({
  runId,
  runQuestion,
  runDomain,
  runCutoff,
  runUpdatedAt,
  judgments,
  executivePoints,
  evidenceCount,
  counterEvidenceCount,
  pendingCount,
  completedStageCount,
  processQualityLabel,
  decisionQualityLabel,
  directionalCount,
  totalJudgmentCount,
  reportHref,
  evidenceHref,
  insightsHref,
  objectSetHref,
  children,
}: WorkspaceDashboardProps) {
  return (
    <div className="workspace-dashboard">
      {/* Summary head */}
      <section className="workspace-dashboard-head">
        <div>
          <div className="eyebrow">
            {domainLabel(runDomain)}
            {completedStageCount === 5 ? " · 已完成研究" : " · 研究中"}
          </div>
          <h1>{runQuestion}</h1>
          <div className="run-meta">
            {runCutoff ? <span>研究截止 {formatDate(runCutoff)}</span> : null}
            <span>更新于 {formatDate(runUpdatedAt)}</span>
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
          <Link href={objectSetHref} className="workspace-quick-action">
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
            <span style={{ fontSize: "16px", color: "var(--muted)" }}>
              /5
            </span>
          </div>
          <span className="stat-label">阶段完成</span>
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

      {/* Executive summary */}
      {executivePoints.length > 0 ? (
        <section className="card">
          <div className="section-head">
            <div>
              <div className="eyebrow">总体判断</div>
              <h2>当前结论</h2>
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
        <section className="card">
          <div className="section-head">
            <div>
              <div className="eyebrow">判断矩阵</div>
              <h2>各项结论说到多强？</h2>
            </div>
          </div>
          <div className="summary-judgment-grid">
            {judgments.map((j, i) => {
              const sid = String(j.id || j.judgment_id || `J-${i + 1}`);
              const strength = String(j.strength || j.level || "J0");
              return (
                <Link
                  key={sid}
                  href={`/runs/${runId}/judgments?focus=${encodeURIComponent(sid)}`}
                  className="summary-judgment"
                >
                  <header>
                    <span>判断 {i + 1}</span>
                    <span
                      className="badge"
                      style={
                        strength === "J3"
                          ? { background: "var(--green-soft)", color: "var(--green)" }
                          : strength === "J2"
                            ? { background: "#e4f0ea", color: "#215f42" }
                            : strength === "J1"
                              ? { background: "var(--amber-soft)", color: "var(--amber)" }
                              : { background: "var(--red-soft)", color: "var(--red)" }
                      }
                    >
                      {judgmentStrengthLabel(strength)}
                    </span>
                  </header>
                  <h3>{j.conclusion || j.statement || "尚未形成结论"}</h3>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Quality summary */}
      <section className="card" style={{ display: "flex", gap: "24px", flexWrap: "wrap" }}>
        <div style={{ minWidth: "200px" }}>
          <div className="eyebrow">流程完整性</div>
          <strong style={{ fontSize: "20px" }}>{processQualityLabel}</strong>
        </div>
        <div style={{ minWidth: "200px" }}>
          <div className="eyebrow">研究可判断性</div>
          <strong style={{ fontSize: "20px" }}>{decisionQualityLabel}</strong>
          <small
            style={{
              display: "block",
              marginTop: "4px",
              color: "var(--muted)",
              fontSize: "12px",
            }}
          >
            {directionalCount}/{totalJudgmentCount} 项已形成方向判断
          </small>
        </div>
      </section>

      {/* Children (original page content for stage pages, etc.) */}
      {children}
    </div>
  );
}
