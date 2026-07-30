"use client";

import Link from "next/link";
import { formatElapsedMs } from "@/engine/generation_progress";
import { researcherLanguage } from "@/app/lib/researcher-stage-output";
import { researchJobStatusLabel } from "@/app/lib/ui-labels";
import type { ResearchJobStatus } from "@/engine/types";

export type ValidationIssue = {
  severity: "error" | "warning";
  unit_id?: string;
  code: string;
  message: string;
};

export type ValidationState = {
  ok: boolean;
  summary: string;
  issues: ValidationIssue[];
  suggested_patch: unknown;
};

export function ActiveJobNotice({
  job,
  artifactRunning,
  error,
  needsAttention,
  recoveryHref,
  busy,
  onRetryNow,
}: {
  job?: {
    status: ResearchJobStatus;
    attempt?: number;
    max_attempts?: number;
  };
  artifactRunning: boolean;
  error: string;
  needsAttention: boolean;
  recoveryHref: string;
  busy?: boolean;
  onRetryNow?: () => void;
}) {
  if (!job || artifactRunning) return null;
  const description = job.status === "queued"
    ? "任务已提交，稍后会自动开始生成。"
    : job.status === "retrying"
      ? "上次执行未完成，系统会从本阶段起点自动重试；不需要先取消任务。"
      : job.status === "waiting_for_input"
        ? "上游输入已变化或证据条件不足，请检查后重新提交。"
        : job.status === "blocked"
          ? "本次生成已停止，需要检查当前阶段后重新提交。"
          : "后台任务正在处理。";
  const issueDescription = job.status === "retrying"
    ? error
      .replace("请重新生成；", "系统会自动重试；")
      .replace("请重新提交当前阶段。", "系统会自动重试，也可选择立即重试。")
    : error;
  return (
    <div className={`notice generation-progress${needsAttention ? " generation-progress-stale" : ""}`}>
      <strong>{researchJobStatusLabel(job.status)}</strong>
      <p>{description}</p>
      {typeof job.attempt === "number" && typeof job.max_attempts === "number"
        ? <p className="muted">已完成 {job.attempt}/{job.max_attempts} 次尝试。</p>
        : null}
      {issueDescription ? (
        <details>
          <summary>查看上次失败原因</summary>
          <p className="muted">{issueDescription}</p>
        </details>
      ) : null}
      {job.status === "retrying" && onRetryNow ? (
        <div className="actions">
          <button type="button" className="button" disabled={busy} onClick={onRetryNow}>
            {busy ? "正在启动重试…" : "立即重试"}
          </button>
          <span className="muted">不操作也会由后台自动重试。</span>
        </div>
      ) : needsAttention
        ? <p><Link href={recoveryHref}>处理当前阶段 →</Link></p>
        : job.status !== "retrying"
          ? <p className="muted">页面自动刷新中，每 5 秒同步一次进度。</p>
          : null}
    </div>
  );
}

export function GenerationProgressNotice({
  running,
  progress,
  stale,
  elapsedMs,
}: {
  running: boolean;
  progress: any;
  stale: boolean;
  elapsedMs: number;
}) {
  if (!running) return null;
  return (
    <div className={`notice generation-progress${stale ? " generation-progress-stale" : ""}`}>
      <strong>{stale ? "超过 3 分钟无进度更新，可能卡住；可取消后重试" : "模型持续工作中"}</strong>
      <p>
        已运行 {formatElapsedMs(Number.isFinite(elapsedMs) ? elapsedMs : 0)}
        {progress?.auto_round ? ` · 补证第 ${progress.auto_round}/${progress.max_auto_rounds || "?"} 轮` : ""}
        {progress?.round ? ` · 第 ${progress.round}/${progress.max_rounds || "?"} 轮` : ""}
        {typeof progress?.coverage_rate === "number" ? ` · 覆盖率 ${(progress.coverage_rate * 100).toFixed(0)}%` : ""}
        {typeof progress?.verification_rate === "number" ? ` · 核验率 ${(progress.verification_rate * 100).toFixed(0)}%` : ""}
      </p>
      <p className="muted">{progress?.message ? researcherLanguage(progress.message) : "已开始生成，等待首轮模型响应…"}</p>
      <p className="muted">页面自动刷新中，每 5 秒同步一次进度。</p>
    </div>
  );
}

export function StructureValidationNotice({
  validation,
  busy,
  onApply,
  onDismiss,
}: {
  validation: ValidationState | null;
  busy: boolean;
  onApply: () => void;
  onDismiss: () => void;
}) {
  if (!validation || validation.ok) return null;
  return (
    <div className="notice structure-validation">
      <strong>确认前校验未通过</strong>
      <p>{validation.summary}</p>
      <ul>
        {validation.issues.map((issue, index) => (
          <li key={`${issue.code}-${index}`}>
            {issue.severity === "error" ? "阻断" : "提醒"}
            {issue.unit_id ? ` · ${researcherLanguage(issue.unit_id)}` : ""}
            ：{researcherLanguage(issue.message)}
          </li>
        ))}
      </ul>
      <div className="actions">
        {validation.suggested_patch ? (
          <button type="button" className="button" disabled={busy} onClick={onApply}>采纳建议并保存</button>
        ) : null}
        <button type="button" className="button-secondary" disabled={busy} onClick={onDismiss}>返回修改</button>
      </div>
    </div>
  );
}

export type ClarificationItem = {
  question_id: string;
  question: string;
  impact: string;
};

export function ClarificationSheet({
  items,
  answers,
  editable,
  complete,
  onAnswer,
  onSubmit,
}: {
  items: ClarificationItem[];
  answers: Record<string, string>;
  editable: boolean;
  complete: boolean;
  onAnswer: (questionId: string, answer: string) => void;
  onSubmit: () => void;
}) {
  if (!items.length) return null;
  return (
    <section className="clarify-sheet">
      <header className="clarify-sheet-head">
        <div>
          <p className="clarify-kicker">开始研究前</p>
          <h2>先确认这 {items.length} 件事</h2>
          <p className="muted">一次答完即可；这些选择会决定后续研究怎么拆、时间怎么落、交什么成果。</p>
        </div>
        <span className="clarify-count">{items.length} 问</span>
      </header>
      <ol className="clarify-list">
        {items.map((item, index) => (
          <li key={item.question_id} className="clarify-item">
            <div className="clarify-item-head">
              <span className="clarify-index">{index + 1}</span>
              <div>
                <p className="clarify-question">{item.question}</p>
                <p className="muted clarify-impact">{item.impact}</p>
              </div>
            </div>
            <input
              type="text"
              className="clarify-input"
              aria-label={`回答问题 ${index + 1}`}
              value={answers[item.question_id] || ""}
              onChange={(event) => onAnswer(item.question_id, event.target.value)}
              disabled={!editable}
              placeholder="一句话回答"
            />
          </li>
        ))}
      </ol>
      <div className="clarify-actions">
        <button
          type="button"
          className="button"
          disabled={!editable || !complete}
          onClick={onSubmit}
        >
          全部答完，继续收敛
        </button>
        <p className="muted">提交后会按你的回答重写研究范围，不会直接进入下一阶段。</p>
      </div>
    </section>
  );
}
