"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ResearchJobStatus, SourceRecord } from "@/engine/types";
import type { ArtifactPayload } from "@/adapters/db_read_models";
import {
  ControlledScopeProjectionForm,
  ControlledStructureProjectionForm,
  ControlledJudgmentProjectionForm,
  type ApprovedScopeSummary,
  type ControlledScopeProjectionFormHandle,
  type ControlledStructureProjectionFormHandle,
  type ControlledJudgmentProjectionFormHandle,
} from "@/app/components/controlled-projection-forms";
import { artifactStatusLabel, researchJobIssueMessage, researchJobStatusLabel } from "@/app/lib/ui-labels";
import {
  isGenerationProgressStale,
  parseGenerationProgress,
} from "@/engine/generation_progress";
import type { SourceCoverageSummary, SourceFactStatus } from "@/engine/source_coverage";
import {
  clarificationImpactHint,
  isHumanClarificationQuestion,
  synthesizeClarificationQuestion,
} from "@/engine/stage01_contract";
import {
  buildJudgmentStageSummary,
  buildScopeStageSummary,
  buildStructureStageSummary,
  prepareReaderReportMarkdown,
  researcherMarkdown,
} from "@/app/lib/researcher-stage-output";
import { formatJourneyOutput, journeyReviewHref, researchStage } from "@/app/lib/research-journey";
import type { EvidenceSupplementSummary } from "@/engine/evidence_supplement_view";
import {
  Stage3WorkspacePanel,
  Stage5WorkspacePanel,
} from "@/app/components/stage-workspace-panels";
import {
  ActiveJobNotice,
  ClarificationSheet,
  GenerationProgressNotice,
  StructureValidationNotice,
  type ValidationState,
} from "@/app/components/stage-workspace-feedback";

export type { ApprovedScopeSummary };

export type WorkspaceArtifact = ArtifactPayload;
export type WorkspaceJob = {
  id: string;
  status: ResearchJobStatus;
  attempt: number;
  max_attempts: number;
  last_error: string | null;
  available_at: string;
  updated_at: string;
};

export type Stage3SourceCoverageProps = {
  units: Array<{ id: string; title: string }>;
  sources: Array<Pick<SourceRecord, "id" | "title" | "publisher" | "published_at" | "url" | "locator" | "usability_status" | "retrieval_status" | "authority_type" | "source_tier" | "quote_verified" | "failure_detail" | "source_type"> & { fact_status: SourceFactStatus }>;
  controlledSources: Array<{
    id: string;
    title: string;
    publisher: string;
    published_at: string | null;
    authority_type?: string;
  }>;
  coverage: SourceCoverageSummary;
  boundSourceIds: string[];
};

export type Stage4JudgmentProps = {
  units: Array<{ id: string; title: string; ontology_node_ids?: string[] }>;
  evidence: Array<{ id: string; statement: string; judgment_unit_ids: string[]; direction?: string }>;
  methodApplications: Array<{
    application_id: string;
    method_id: string;
    capability_type: string;
    target_judgment_unit_refs: string[];
    precondition_checks: Array<{ precondition_id: string; reason?: string }>;
  }>;
  structureCompetingExplanations: Array<{ explanation_id: string; statement: string; judgment_unit_ids: string[] }>;
};

export function StageWorkspace({
  runId,
  question,
  stage,
  artifact,
  activeJob,
  unlocked,
  approvedScope,
  sourceCoverage,
  judgmentProjection,
  supplementSummary,
}: {
  runId: string;
  question: string;
  stage: number;
  artifact?: WorkspaceArtifact;
  activeJob?: WorkspaceJob;
  unlocked: boolean;
  approvedScope?: ApprovedScopeSummary;
  sourceCoverage?: Stage3SourceCoverageProps;
  judgmentProjection?: Stage4JudgmentProps;
  supplementSummary?: EvidenceSupplementSummary;
}) {
  const router = useRouter();
  const scopeFormRef = useRef<ControlledScopeProjectionFormHandle>(null);
  const structureFormRef = useRef<ControlledStructureProjectionFormHandle>(null);
  const judgmentFormRef = useRef<ControlledJudgmentProjectionFormHandle>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(artifact?.error_message || "");
  const [json, setJson] = useState(artifact?.json_content || "{}");
  const [md, setMd] = useState(artifact?.markdown_content || "");
  const [readerMd, setReaderMd] = useState(prepareReaderReportMarkdown(artifact?.markdown_content || ""));
  const [showAdvancedJson, setShowAdvancedJson] = useState(false);
  const [validation, setValidation] = useState<ValidationState | null>(null);
  const [clarifyAnswers, setClarifyAnswers] = useState<Record<string, string>>({});

  useEffect(() => {
    setJson(artifact?.json_content || "{}");
    setMd(artifact?.markdown_content || "");
    setReaderMd(prepareReaderReportMarkdown(artifact?.markdown_content || ""));
    setError(artifact?.error_message || "");
    setValidation(null);
    setClarifyAnswers({});
  }, [artifact?.id, artifact?.json_content, artifact?.markdown_content, artifact?.error_message, artifact?.tool_usage]);

  let parsedStageJson: any = {};
  try { parsedStageJson = JSON.parse(json || "{}"); } catch { parsedStageJson = {}; }
  const clarificationList = Array.isArray(parsedStageJson?.input_resolution?.clarifications)
    ? parsedStageJson.input_resolution.clarifications
    : [];
  const unresolvedAmbiguities = Array.isArray(parsedStageJson?.input_resolution?.unresolved_structural_ambiguities)
    ? parsedStageJson.input_resolution.unresolved_structural_ambiguities.map(String).filter(Boolean)
    : [];
  const systemUnderstanding = parsedStageJson?.input_resolution?.system_understanding && typeof parsedStageJson.input_resolution.system_understanding === "object"
    ? parsedStageJson.input_resolution.system_understanding
    : {};
  const pendingClarifications = (() => {
    const unanswered = clarificationList.filter((item: any) => !item?.answer);
    if (unanswered.length) return unanswered;
    if (!unresolvedAmbiguities.length) return [];
    return unresolvedAmbiguities.slice(0, 5).map((topic: string, index: number) => ({
      question_id: `UC-${String(clarificationList.length + index + 1).padStart(2, "0")}`,
      topic,
      question: "",
      answer: null,
      answered_at: null,
    }));
  })();
  const needsClarification = stage === 1 && (
    String(parsedStageJson?.task_disposition || "") === "needs_clarification"
    || pendingClarifications.length > 0
  );
  const clarificationItems = pendingClarifications.map((item: any, index: number) => {
    const topicKey = (item?.topic === "structural_ambiguity" && unresolvedAmbiguities[index])
      ? unresolvedAmbiguities[index]
      : (item?.topic || unresolvedAmbiguities[index] || "");
    const raw = String(item?.question || "").trim();
    const humanQuestion = isHumanClarificationQuestion(raw)
      ? raw
      : synthesizeClarificationQuestion({
        topic: topicKey,
        unresolved: unresolvedAmbiguities,
        understanding: systemUnderstanding,
        original_input: parsedStageJson?.original_input || question,
      });
    return {
      question_id: String(item?.question_id || `UC-${String(index + 1).padStart(2, "0")}`),
      topic: topicKey,
      question: humanQuestion,
      impact: clarificationImpactHint(topicKey),
    };
  });
  const allClarifyAnswersFilled = clarificationItems.length > 0
    && clarificationItems.every((item: { question_id: string }) => Boolean(String(clarifyAnswers[item.question_id] || "").trim()));
  const ontologyYamlPreview = String(parsedStageJson?.ontology_view_yaml || "");
  const logicPreview = String(parsedStageJson?.research_logic_markdown || md || "");
  const stage03PrepPreview = String(parsedStageJson?.preparation_markdown || md || "");
  const stage03ManifestPreview = String(parsedStageJson?.instance_manifest_yaml || "");
  const stage04BriefPreview = String(parsedStageJson?.judgment_brief_markdown || md || "");
  const stage04AuditPreview = String(parsedStageJson?.reasoning_audit_yaml || "");
  const stage05AuditPreview = String(parsedStageJson?.expression_audit_yaml || "");
  const injectedAssets = parsedStageJson?.context_injected_assets && typeof parsedStageJson.context_injected_assets === "object"
    ? parsedStageJson.context_injected_assets as {
      knowledge_files?: string[];
      method_guidance_ids?: string[];
      scenario_card_ids?: string[];
      structured_keys?: string[];
    }
    : null;
  const researchValueReview = parsedStageJson?.research_value_review && typeof parsedStageJson.research_value_review === "object"
    ? parsedStageJson.research_value_review as {
      status?: string;
      mode?: string;
      retry_count?: number;
      checks?: Array<{ id: string; pass: boolean; note?: string }>;
    }
    : null;
  const structureSummaries = buildStructureStageSummary(parsedStageJson);
  const judgmentSummaries = buildJudgmentStageSummary(parsedStageJson, judgmentProjection?.evidence || []);
  const scopeSummary = buildScopeStageSummary(parsedStageJson, question);
  const journey = researchStage(stage);

  const jobInFlight = Boolean(activeJob && ["queued", "running", "retrying"].includes(activeJob.status));
  const jobNeedsAttention = Boolean(activeJob && ["waiting_for_input", "blocked"].includes(activeJob.status));
  const activeJobError = researchJobIssueMessage(activeJob?.last_error);
  const displayError = researchJobIssueMessage(error);

  useEffect(() => {
    if (artifact?.status !== "running" && !jobInFlight) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [artifact?.id, artifact?.status, artifact?.tool_usage, activeJob?.id, activeJob?.status, jobInFlight, router]);

  const progress = artifact?.status === "running" ? parseGenerationProgress(artifact.tool_usage) : null;
  const progressStale = progress ? isGenerationProgressStale(progress) : false;
  const liveElapsedMs = progress
    ? Math.max(progress.elapsed_ms, Date.now() - Date.parse(progress.started_at || ""))
    : artifact?.status === "running" && artifact.created_at
      ? Date.now() - Date.parse(artifact.created_at)
      : 0;

  async function call(url: string, options: RequestInit = {}) {
    setBusy(true); setError("");
    try {
      const r = await fetch(url, options); const d = await r.json();
      if (!r.ok) throw new Error(d.error || "操作失败");
      router.refresh(); return d;
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const networkLost = /load failed|failed to fetch|networkerror|fetch failed/i.test(raw);
      setError(networkLost
        ? "与服务器的连接中断。请刷新页面；若状态仍是「生成中」请稍候，后台可能仍在跑。"
        : raw);
      router.refresh();
    }
    finally { setBusy(false); }
  }

  async function saveScope() {
    setError("");
    await scopeFormRef.current?.save();
  }

  async function saveStructure() {
    setError("");
    await structureFormRef.current?.save();
  }

  async function saveJudgment() {
    setError("");
    await judgmentFormRef.current?.save();
  }

  async function saveJson() {
    const d = await call(`/api/runs/${runId}/artifacts/${artifact!.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ json_content: json, markdown_content: md }) });
    if (d) { setJson(d.json_content); setMd(d.markdown_content); }
  }

  async function saveMarkdown() {
    const d = await call(`/api/runs/${runId}/artifacts/${artifact!.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json_content: json, markdown_content: readerMd, prefer_markdown: true }),
    });
    if (d) {
      setJson(d.json_content);
      setMd(d.markdown_content);
      setReaderMd(prepareReaderReportMarkdown(d.markdown_content));
    }
  }

  async function validateStructureBeforeReview() {
    if (!artifact) return;
    setBusy(true);
    setError("");
    setValidation(null);
    try {
      const preflight = await fetch(`/api/runs/${runId}/artifacts/${artifact.id}/validate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "preflight" }),
      });
      const validationBody = await preflight.json();
      if (!preflight.ok) {
        throw new Error(validationBody.error || "确认前校验失败");
      }
      if (!validationBody.ok) {
        setValidation({
          ok: false,
          summary: validationBody.summary || "结构校验未通过",
          issues: validationBody.issues || [],
          suggested_patch: validationBody.suggested_patch || null,
        });
        setError("确认前校验未通过：请审阅下方问题，采纳建议或返回修改。不可强制跳过。");
        return;
      }
      router.push(journeyReviewHref(runId, 2));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function applyStructureSuggestions() {
    if (!artifact) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/runs/${runId}/artifacts/${artifact.id}/validate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "apply_suggestions" }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "采纳建议失败");
      setValidation({
        ok: Boolean(body.ok),
        summary: body.summary || "已写入建议补丁",
        issues: body.issues || [],
        suggested_patch: body.suggested_patch || null,
      });
      if (body.ok) setError("");
      else setError("建议已写入，但仍有待处理问题；请继续修改或再次校验。");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitClarification() {
    const answers = clarificationItems.map((item: { question_id: string }) => ({
      question_id: item.question_id,
      answer: String(clarifyAnswers[item.question_id] || "").trim(),
    }));
    if (!answers.length || answers.some((item: { answer: string }) => !item.answer)) {
      setError("请一次答完全部问题后再提交");
      return;
    }
    setClarifyAnswers({});
    await call(`/api/runs/${runId}/stages/01/clarify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        answers,
        regenerate: true,
      }),
    });
  }

  async function generateStage03(mode: "regenerate" | "evidence_supplement" = "regenerate") {
    await call(`/api/runs/${runId}/stages/${stage}/generate`, {
      method: "POST",
      headers: mode === "evidence_supplement" ? { "content-type": "application/json" } : undefined,
      body: mode === "evidence_supplement" ? JSON.stringify({ mode: "evidence_supplement" }) : undefined,
    });
  }

  const statusText = artifact
    ? `第 ${artifact.version} 版 · ${artifactStatusLabel(artifact.status)}`
    : activeJob ? researchJobStatusLabel(activeJob.status) : "尚未首次生成";
  const formEditable = unlocked && !busy && artifact?.status !== "running" && !jobInFlight;
  const qualityStatus = String(parsedStageJson?.quality_status || "");
  const densityReady = !artifact
    || artifact.status !== "needs_review"
    || qualityStatus === "high_quality_pass"
    || needsClarification;
  const canGenerate = unlocked && !busy && artifact?.status !== "running" && !jobInFlight && !needsClarification;
  const generateLabel = activeJob?.status === "retrying"
    ? "等待自动重试…"
    : activeJob?.status === "queued"
      ? "等待执行…"
      : busy || artifact?.status === "running" || jobInFlight
        ? "模型正在工作…"
    : needsClarification
      ? "请先回答澄清问题"
      : artifact
        ? (stage === 3 ? "重新生成" : "生成新版本")
        : "生成本阶段 →";
  const generateClass = artifact ? "button-secondary" : "button";
  const reviewHref = journeyReviewHref(runId, stage);
  const reviewCta = needsClarification
    ? "请先完成澄清"
    : !densityReady
      ? "还不够完整，暂不能审阅确认"
      : `去${journey?.navLabel || "本阶段"}页确认 →`;

  return <>
    <div className="workspace-toolbar">
      <div className="actions">
        {unlocked ? <>
        {stage === 3 || (artifact && artifact.status !== "failed") ? null : (
          <button className={generateClass} disabled={!canGenerate} onClick={() => call(`/api/runs/${runId}/stages/${stage}/generate`, { method: "POST" })}>{generateLabel}</button>
        )}
        {activeJob && (jobInFlight || activeJob.status === "waiting_for_input") ? <button className="button-quiet" onClick={() => call(`/api/runs/${runId}/jobs/${activeJob.id}/cancel`, { method: "POST" })}>取消生成任务</button> : artifact?.status === "running" ? <button className="button-quiet" onClick={() => call(`/api/runs/${runId}/artifacts/${artifact.id}/cancel`, { method: "POST" })}>取消本次生成</button> : null}
        {stage === 1 ? <>
          <button className="button-secondary" disabled={!formEditable || needsClarification} onClick={saveScope}>{busy ? "正在保存…" : artifact ? "保存研究范围" : "建立研究范围"}</button>
          {artifact?.status === "needs_review" ? <Link className={densityReady && !needsClarification ? "button" : "button-secondary"} href={reviewHref}>{reviewCta}</Link> : null}
        </> : stage === 2 ? <>
          <button className="button-secondary" disabled={!formEditable} onClick={saveStructure}>{busy ? "正在保存…" : artifact ? "保存研究结构" : "建立研究结构"}</button>
          {artifact?.status === "needs_review" ? <button className={densityReady ? "button" : "button-secondary"} disabled={busy || !densityReady} onClick={validateStructureBeforeReview}>{busy ? "正在校验…" : "校验并去结构页确认 →"}</button> : null}
        </> : stage === 3 ? <>
          {!artifact ? (
            <button
              className="button"
              disabled={busy || !unlocked || jobInFlight}
              title="优先查权威与一手来源；结果仍须核验原文并由研究员确认"
              onClick={() => generateStage03("regenerate")}
            >
              让模型自动取证
            </button>
          ) : (
            <>
              <button
                className="button"
                disabled={busy || !unlocked || artifact.status === "running" || jobInFlight}
                title="只补当前尚缺项，不整包重跑；结果仍须核验原文"
                onClick={() => generateStage03("evidence_supplement")}
              >
                按尚缺项补充取证
              </button>
              <button
                className="button-secondary"
                disabled={busy || !unlocked || artifact.status === "running" || jobInFlight}
                title="整包重跑证据准备；已有草稿会生成新版本"
                onClick={() => generateStage03("regenerate")}
              >
                重新生成整包证据
              </button>
              <Link className="button" href={reviewHref}>打开证据审阅 →</Link>
            </>
          )}
          {artifact?.status === "failed" ? (
            <button
              className="button-secondary"
              disabled={busy}
              onClick={() => call(`/api/runs/${runId}/stages/03/generate`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  mode: "explicit_gap_fallback",
                  reason: "公开来源取得或模型结构化提交失败，人工选择登记尚缺的证据",
                }),
              })}
            >
              登记为尚缺的证据
            </button>
          ) : null}
        </> : stage === 4 ? <>
          <button className="button-secondary" disabled={!formEditable || !judgmentProjection} onClick={saveJudgment}>{busy ? "正在保存…" : "保存推理逻辑"}</button>
          {artifact?.status === "needs_review" ? (
            <Link className={densityReady ? "button" : "button-secondary"} href={reviewHref}>{reviewCta}</Link>
          ) : null}
        </> : artifact && artifact.status !== "failed" ? <>
          <button className="button-secondary" disabled={busy} onClick={saveMarkdown}>保存可读稿</button>
          {artifact.status === "needs_review" ? <Link className={densityReady ? "button" : "button-secondary"} href={reviewHref}>{reviewCta}</Link> : null}
        </> : null}
        {stage === 4 && artifact?.status === "failed" ? (
          <details className="toolbar-more">
            <summary>更多</summary>
            <button className="button-quiet" disabled={busy} onClick={() => call(`/api/runs/${runId}/stages/04/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "explicit_j0_fallback", reason: "上游只有研究员确认的尚缺证据，且模型裁决未在硬时限内完成" }) })}>生成「暂不可判断」结论</button>
          </details>
        ) : null}
        {stage !== 3 && artifact && artifact.status !== "failed" ? (
          <details className="toolbar-more">
            <summary>AI 重写（可选）</summary>
            <p className="muted">会根据已确认的上游输入生成一个新版本；当前版本仍保留在历史中。</p>
            <button className="button-quiet" disabled={!canGenerate} onClick={() => call(`/api/runs/${runId}/stages/${stage}/generate`, { method: "POST" })}>{generateLabel}</button>
          </details>
        ) : null}
        </> : null}
      </div>
      <span className="workspace-status">{statusText}</span>
    </div>
    {!unlocked && <div className="notice">当前阶段已锁定。请先 <Link href={prevStageHref(runId, stage)}>完成并确认上一阶段 →</Link></div>}
    <ActiveJobNotice
      job={activeJob}
      artifactRunning={artifact?.status === "running"}
      error={activeJobError}
      needsAttention={jobNeedsAttention}
      recoveryHref={jobRecoveryHref(runId, stage, activeJob?.status || "")}
      busy={busy}
      onRetryNow={activeJob?.status === "retrying"
        ? () => { void call(`/api/runs/${runId}/jobs/${activeJob.id}/retry`, { method: "POST" }); }
        : undefined}
    />
    {displayError && displayError !== activeJobError ? <div className="notice error">{displayError}</div> : null}
    <GenerationProgressNotice
      running={artifact?.status === "running"}
      progress={progress}
      stale={progressStale}
      elapsedMs={liveElapsedMs}
    />
    <StructureValidationNotice
      validation={validation}
      busy={busy}
      onApply={applyStructureSuggestions}
      onDismiss={() => setValidation(null)}
    />
    {needsClarification ? (
      <ClarificationSheet
        items={clarificationItems}
        answers={clarifyAnswers}
        editable={formEditable}
        complete={allClarifyAnswersFilled}
        onAnswer={(questionId, answer) => setClarifyAnswers((previous) => ({
          ...previous,
          [questionId]: answer,
        }))}
        onSubmit={submitClarification}
      />
    ) : null}
    {!unlocked ? (
      <section className="card empty-state">
        <h2>先完成上一阶段</h2>
        <p className="muted">本阶段会直接使用上一阶段已确认的输出。确认前不需要在这里填写任何内容。</p>
        <Link className="button" href={prevStageHref(runId, stage)}>返回上一阶段 →</Link>
      </section>
    ) : stage === 1 && !needsClarification ? <div className="two-col">
      <section className="card scope-panel">
        <div className="panel-head"><h2>研究范围</h2><span>问题 → 判断 → 时间 → 边界</span></div>
        <div className="scope-panel-body">
          {artifact?.status === "running" ? <p className="muted">模型生成中，完成后会自动灌回左侧字段。</p> : (
            <ControlledScopeProjectionForm
              ref={scopeFormRef}
              runId={runId}
              question={question}
              existingJson={artifact?.json_content}
              enabled={formEditable}
              onBusyChange={setBusy}
              onError={setError}
            />
          )}
        </div>
      </section>
      <section className="card editor-panel">
        <div className="panel-head"><h2>本阶段将交付</h2><span>{journey?.nextStep.label.replace("→", "").trim() || "保存后进入下一步"}</span></div>
        <div className="stage-editor-summary-list">
          <article className="stage-editor-summary-card">
            <span>{formatJourneyOutput(journey || { output: "本阶段输出", outputFallback: "本阶段输出" }, { count: scopeSummary.question ? 1 : 0 })}</span>
            <h3>{scopeSummary.question || "尚未形成规范化研究问题"}</h3>
            {scopeSummary.coreObject ? <p><strong>研究对象</strong><br />{scopeSummary.coreObject}</p> : null}
            {scopeSummary.judgmentAction ? <p><strong>要做的判断</strong><br />{scopeSummary.judgmentAction}</p> : null}
            {scopeSummary.timeScope.length ? <>
              <strong>时间口径</strong>
              <ul>{scopeSummary.timeScope.map((item) => <li key={item.label}>{item.label}：{item.value}</li>)}</ul>
            </> : null}
            <strong>边界是否清楚</strong>
            <p>已列明 {scopeSummary.boundaries.length} 项研究边界、{scopeSummary.exclusions.length} 项不研究事项。</p>
            {scopeSummary.reportType ? <p><strong>交付形式</strong><br />{scopeSummary.reportType}</p> : null}
          </article>
        </div>
        <details className="structure-advanced">
          <summary>审计：完整范围说明</summary>
          <article className="markdown preview-pane preview-pane-only">
            {md.trim() ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{researcherMarkdown(md)}</ReactMarkdown> : <p className="muted">尚无完整范围说明。保存研究范围或模型生成后会显示在这里。</p>}
          </article>
        </details>
      </section>
    </div> : stage === 2 ? <div className="two-col">
      <section className="card scope-panel">
        <div className="panel-head"><h2>研究结构</h2><span>修改关键判断、必要证据与反证边界</span></div>
        <div className="scope-panel-body">
          {artifact?.status === "running" ? <p className="muted">模型生成中，完成后会自动灌回左侧字段。</p> : (
            <>
              <ControlledStructureProjectionForm
                ref={structureFormRef}
                runId={runId}
                existingJson={artifact?.json_content}
                enabled={formEditable}
                approvedScope={approvedScope}
                onBusyChange={setBusy}
                onError={setError}
              />
              {artifact ? <details className="structure-advanced" open={showAdvancedJson} onToggle={(event) => setShowAdvancedJson((event.target as HTMLDetailsElement).open)}>
                <summary>高级：原始 JSON（逃生舱）</summary>
                <p className="muted">日常请使用上方表单。直接修改原始内容可能覆盖方法与变量，并使下游产出需要重审。</p>
                <textarea aria-label="结构化内容" className="json-editor" value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} disabled={!formEditable} />
                <button type="button" className="button-secondary" disabled={!formEditable} onClick={saveJson}>保存原始 JSON</button>
              </details> : null}
            </>
          )}
        </div>
      </section>
      <section className="card editor-panel">
        <div className="panel-head"><h2>已保存的结构输出</h2><span>{structureSummaries.length} 个关键判断</span></div>
        <div className="stage-editor-summary-list">
          {structureSummaries.length ? structureSummaries.map((unit, index) => (
            <article className="stage-editor-summary-card" key={unit.id}>
              <span>关键判断 {index + 1}</span>
              <h3>{unit.title}</h3>
              {unit.question && unit.question !== unit.title ? <p>{unit.question}</p> : null}
              <strong>形成判断前必须拿到</strong>
              {unit.evidenceRequirements.length
                ? <ul>{unit.evidenceRequirements.slice(0, 4).map((item) => <li key={item}>{item}</li>)}</ul>
                : <p className="muted">尚未登记必要证据</p>}
              <strong>必须检查的反面情况</strong>
              {[...unit.counterEvidence, ...unit.competingExplanations].length
                ? <ul>{[...unit.counterEvidence, ...unit.competingExplanations].slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul>
                : <p className="muted">尚未登记反证或竞争解释</p>}
            </article>
          )) : <p className="muted">保存研究结构后，这里会按关键判断展示阶段输出。</p>}
        </div>
        <details className="structure-advanced">
          <summary>审计：完整研究逻辑</summary>
          <article className="markdown preview-pane preview-pane-only">
            {logicPreview.trim()
              ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{researcherMarkdown(logicPreview)}</ReactMarkdown>
              : <p className="muted">尚无研究逻辑正文。</p>}
          </article>
        </details>
        <details className="structure-advanced">
          <summary>审计：本体视图</summary>
          <pre className="preview-pane preview-pane-only" style={{ whiteSpace: "pre-wrap", fontSize: "12px" }}>
            {ontologyYamlPreview.trim() || "尚无本体视图 YAML。保存或生成 Stage02 后会写入 ontology_view_yaml。"}
          </pre>
        </details>
      </section>
    </div> : stage === 3 ? (
      <Stage3WorkspacePanel
        runId={runId}
        artifact={artifact}
        sourceCoverage={sourceCoverage}
        supplementSummary={supplementSummary}
        journey={journey}
        preparationPreview={stage03PrepPreview}
        manifestPreview={stage03ManifestPreview}
      />
    ) : stage === 4 ? <div className="two-col">
      <section className="card scope-panel">
        <div className="panel-head"><h2>判断逻辑</h2><span>修改结论、依据、边界与改判条件</span></div>
        <div className="scope-panel-body">
          {artifact?.status === "running" ? <p className="muted">模型生成中，完成后会自动灌回左侧字段。</p> : judgmentProjection ? (
            <>
              <ControlledJudgmentProjectionForm
                ref={judgmentFormRef}
                runId={runId}
                units={judgmentProjection.units}
                evidence={judgmentProjection.evidence}
                methodApplications={judgmentProjection.methodApplications}
                structureCompetingExplanations={judgmentProjection.structureCompetingExplanations}
                existingJson={artifact?.json_content}
                enabled={formEditable}
                variant="workspace"
                onBusyChange={setBusy}
                onError={setError}
              />
              {artifact ? <details className="structure-advanced" open={showAdvancedJson} onToggle={(event) => setShowAdvancedJson((event.target as HTMLDetailsElement).open)}>
                <summary>高级：原始 JSON（逃生舱）</summary>
                <p className="muted">日常请使用上方表单。直接修改原始内容可能覆盖规则与推理链，并使下游产出需要重审。</p>
                <textarea aria-label="结构化内容" className="json-editor" value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} disabled={!formEditable} />
                <button type="button" className="button-secondary" disabled={!formEditable} onClick={saveJson}>保存原始 JSON</button>
              </details> : null}
            </>
          ) : (
            <section className="card empty-state">
              <h2>先确认研究结构与证据</h2>
              <p className="muted">判断裁决依赖已确认的关键判断与事实。</p>
            </section>
          )}
        </div>
      </section>
      <section className="card editor-panel">
        <div className="panel-head"><h2>已保存的判断输出</h2><span>{judgmentSummaries.length} 项判断</span></div>
        <div className="stage-editor-summary-list">
          {judgmentSummaries.length ? judgmentSummaries.map((judgment, index) => (
            <article className="stage-editor-summary-card" key={judgment.id}>
              <div className="stage-editor-summary-head">
                <span>判断 {index + 1}</span>
                <small>{judgment.strengthLabel} · {judgment.statusLabel}</small>
              </div>
              <h3>{judgment.conclusion || judgment.title}</h3>
              {judgment.rationale ? <p>{judgment.rationale}</p> : null}
              <strong>关键依据</strong>
              {judgment.evidence.length
                ? <ul>{judgment.evidence.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul>
                : <p className="muted">当前没有可展示的已确认事实</p>}
              <strong>改判条件</strong>
              {judgment.invalidationConditions.length
                ? <ul>{judgment.invalidationConditions.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul>
                : <p className="muted">尚未登记改判条件</p>}
            </article>
          )) : <p className="muted">保存判断逻辑后，这里会展示结论、强度、依据和改判条件。</p>}
        </div>
        <details className="structure-advanced">
          <summary>审计：完整判断简报</summary>
          <article className="markdown preview-pane preview-pane-only">
            {stage04BriefPreview.trim()
              ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{researcherMarkdown(stage04BriefPreview)}</ReactMarkdown>
              : <p className="muted">尚无可读稿。保存推理逻辑或模型生成后会显示在这里。</p>}
          </article>
        </details>
        <details className="structure-advanced">
          <summary>审计：推理记录</summary>
          <pre className="preview-pane preview-pane-only" style={{ whiteSpace: "pre-wrap", fontSize: "12px" }}>
            {stage04AuditPreview.trim() || "尚无推理审计 YAML。保存或生成 Stage04 后会写入 reasoning_audit_yaml。"}
          </pre>
        </details>
      </section>
    </div> : stage === 5 && artifact ? (
      <Stage5WorkspacePanel
        artifact={artifact}
        readerMarkdown={readerMd}
        rawMarkdown={md}
        auditPreview={stage05AuditPreview}
        json={json}
        editable={formEditable}
        showAdvancedJson={showAdvancedJson}
        onReaderMarkdownChange={setReaderMd}
        onJsonChange={setJson}
        onAdvancedJsonToggle={setShowAdvancedJson}
        onSaveJson={saveJson}
      />
    ) : null}
    {injectedAssets ? (
      <details className="structure-advanced">
        <summary>维护对照：本阶段注入资产</summary>
        <p className="muted">仅供维护 ontology / methods / workflow 时对照，不影响用户澄清与确认。</p>
        <p className="muted">知识文件 {injectedAssets.knowledge_files?.length || 0} · 方法摘录 {injectedAssets.method_guidance_ids?.length || 0} · 场景卡 {(injectedAssets.scenario_card_ids || []).join("、") || "无"} · 结构化键 {(injectedAssets.structured_keys || []).join("、") || "无"}</p>
        {injectedAssets.knowledge_files?.length ? (
          <ul>
            {injectedAssets.knowledge_files.slice(0, 16).map((file) => (
              <li key={file}><code>{file}</code></li>
            ))}
            {(injectedAssets.knowledge_files.length > 16) ? <li className="muted">…共 {injectedAssets.knowledge_files.length} 个</li> : null}
          </ul>
        ) : null}
        {researchValueReview ? (
          <p className="muted">
            00A 研究价值审查：{researchValueReview.status || "skipped"}
            {researchValueReview.mode ? ` · ${researchValueReview.mode}` : ""}
            {typeof researchValueReview.retry_count === "number" ? ` · 重试 ${researchValueReview.retry_count}` : ""}
            {Array.isArray(researchValueReview.checks)
              ? ` · 通过 ${researchValueReview.checks.filter((item) => item.pass).length}/${researchValueReview.checks.length}`
              : ""}
          </p>
        ) : null}
      </details>
    ) : null}
  </>;
}

function prevStageHref(runId: string, stage: number) {
  if (stage <= 2) return journeyReviewHref(runId, 1);
  if (stage === 3) return journeyReviewHref(runId, 2);
  if (stage === 4) return journeyReviewHref(runId, 3);
  return journeyReviewHref(runId, 4);
}

function jobRecoveryHref(runId: string, stage: number, status: string) {
  if (status === "waiting_for_input" && stage === 3) return journeyReviewHref(runId, 3);
  if (status === "waiting_for_input" && stage >= 4) return journeyReviewHref(runId, stage - 1);
  return `/runs/${runId}/stages/${stage}`;
}
