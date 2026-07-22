"use client";

import { useEffect, useRef, useState } from "react";
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
import { SourceCoveragePanel } from "@/app/components/source-coverage-panel";
import { artifactModelLabel, artifactStatusLabel, researchJobStatusLabel } from "@/app/lib/ui-labels";
import {
  formatElapsedMs,
  isGenerationProgressStale,
  parseGenerationProgress,
} from "@/engine/generation_progress";
import type { SourceCoverageSummary, SourceFactStatus } from "@/engine/source_coverage";

export type { ApprovedScopeSummary };

export type WorkspaceArtifact = ArtifactPayload;
export type WorkspaceJob = {
  id: string;
  status: ResearchJobStatus;
  attempt: number;
  max_attempts: number;
  last_error: string | null;
  updated_at: string;
};

export type Stage3SourceCoverageProps = {
  units: Array<{ id: string; title: string }>;
  sources: Array<Pick<SourceRecord, "id" | "title" | "publisher" | "published_at" | "url" | "locator" | "usability_status" | "retrieval_status" | "authority_type" | "source_tier" | "quote_verified" | "failure_detail"> & { fact_status: SourceFactStatus }>;
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

type ValidationIssue = {
  severity: "error" | "warning";
  unit_id?: string;
  code: string;
  message: string;
};

type ValidationState = {
  ok: boolean;
  summary: string;
  issues: ValidationIssue[];
  suggested_patch: unknown;
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
}) {
  const router = useRouter();
  const scopeFormRef = useRef<ControlledScopeProjectionFormHandle>(null);
  const structureFormRef = useRef<ControlledStructureProjectionFormHandle>(null);
  const judgmentFormRef = useRef<ControlledJudgmentProjectionFormHandle>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(artifact?.error_message || "");
  const [json, setJson] = useState(artifact?.json_content || "{}");
  const [md, setMd] = useState(artifact?.markdown_content || "");
  const [showAdvancedJson, setShowAdvancedJson] = useState(false);
  const [validation, setValidation] = useState<ValidationState | null>(null);

  useEffect(() => {
    setJson(artifact?.json_content || "{}");
    setMd(artifact?.markdown_content || "");
    setError(artifact?.error_message || "");
    setValidation(null);
  }, [artifact?.id, artifact?.json_content, artifact?.markdown_content, artifact?.error_message, artifact?.tool_usage]);

  const jobInFlight = Boolean(activeJob && ["queued", "running", "retrying"].includes(activeJob.status));
  const jobNeedsAttention = Boolean(activeJob && ["waiting_for_input", "blocked"].includes(activeJob.status));

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

  async function saveJson() {
    const d = await call(`/api/runs/${runId}/artifacts/${artifact!.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ json_content: json, markdown_content: md }) });
    if (d) { setJson(d.json_content); setMd(d.markdown_content); }
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

  async function confirmStage02() {
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
      const approved = await fetch(`/api/runs/${runId}/artifacts/${artifact.id}/approve`, { method: "POST" });
      const approvedBody = await approved.json();
      if (!approved.ok) {
        if (approvedBody.validation) {
          setValidation({
            ok: false,
            summary: approvedBody.validation.summary || "结构校验未通过",
            issues: approvedBody.validation.issues || [],
            suggested_patch: approvedBody.validation.suggested_patch || null,
          });
        }
        throw new Error(approvedBody.error || "确认失败");
      }
      setValidation(null);
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

  async function generateStage03(mode: "regenerate" | "evidence_supplement" = "regenerate") {
    await call(`/api/runs/${runId}/stages/${stage}/generate`, {
      method: "POST",
      headers: mode === "evidence_supplement" ? { "content-type": "application/json" } : undefined,
      body: mode === "evidence_supplement" ? JSON.stringify({ mode: "evidence_supplement" }) : undefined,
    });
  }

  const statusText = artifact
    ? `第 ${artifact.version} 版 · ${artifactStatusLabel(artifact.status)} · ${artifactModelLabel(artifact.model_name, artifact.status)}`
    : activeJob ? researchJobStatusLabel(activeJob.status) : "尚未首次生成";
  const formEditable = unlocked && !busy && artifact?.status !== "running" && !jobInFlight;
  const canApprove = Boolean(artifact && artifact.status === "needs_review");

  return <>
    <div className="workspace-toolbar">
      <div className="actions">
        {stage === 3 && artifact ? <>
          <button className="button" disabled={busy || !unlocked || artifact?.status === "running" || jobInFlight} onClick={() => generateStage03("regenerate")}>{busy || artifact?.status === "running" || jobInFlight ? "模型正在工作…" : "重新生成"}</button>
          <button className="button-secondary" disabled={busy || !unlocked || artifact?.status === "running" || jobInFlight} onClick={() => generateStage03("evidence_supplement")}>补充取证</button>
        </> : <button className="button" disabled={busy || !unlocked || artifact?.status === "running" || jobInFlight} onClick={() => call(`/api/runs/${runId}/stages/${stage}/generate`, { method: "POST" })}>{busy || artifact?.status === "running" || jobInFlight ? "模型正在工作…" : artifact ? "生成新版本" : "生成本阶段 →"}</button>}
        {activeJob && (jobInFlight || jobNeedsAttention) ? <button className="button-secondary" onClick={() => call(`/api/runs/${runId}/jobs/${activeJob.id}/cancel`, { method: "POST" })}>取消后台任务</button> : artifact?.status === "running" ? <button className="button-secondary" onClick={() => call(`/api/runs/${runId}/artifacts/${artifact.id}/cancel`, { method: "POST" })}>取消本次生成</button> : null}
        {stage === 3 && artifact?.status === "failed" && <button className="button-secondary" disabled={busy} onClick={() => call(`/api/runs/${runId}/stages/03/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "explicit_gap_fallback", reason: "公开来源取得或模型结构化提交失败，人工选择登记显式证据缺口" }) })}>登记为显式证据缺口</button>}
        {stage === 4 && artifact?.status === "failed" && <button className="button-secondary" disabled={busy} onClick={() => call(`/api/runs/${runId}/stages/04/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "explicit_j0_fallback", reason: "上游只有经人工接受的证据缺口，且模型裁决未在硬时限内完成" }) })}>生成「暂不可判断」结论</button>}
        {stage === 1 ? <>
          <button className="button-secondary" disabled={!formEditable} onClick={saveScope}>{busy ? "正在保存…" : artifact ? "保存研究范围" : "建立研究范围"}</button>
          {artifact && artifact.status !== "failed" ? <button className="button-secondary" disabled={busy || !canApprove} onClick={() => call(`/api/runs/${runId}/artifacts/${artifact.id}/approve`, { method: "POST" })}>确认并进入下一阶段</button> : null}
        </> : stage === 2 ? <>
          <button className="button-secondary" disabled={!formEditable} onClick={saveStructure}>{busy ? "正在保存…" : artifact ? "保存研究结构" : "建立研究结构"}</button>
          {artifact && artifact.status !== "failed" ? <button className="button-secondary" disabled={busy || !canApprove} onClick={confirmStage02}>{busy ? "正在校验…" : "确认并进入下一阶段"}</button> : null}
        </> : stage === 3 ? <>
          {artifact && artifact.status !== "failed" ? (
            <button className="button-secondary" disabled={busy || !canApprove} onClick={() => call(`/api/runs/${runId}/artifacts/${artifact.id}/approve`, { method: "POST" })}>确认并进入下一阶段</button>
          ) : null}
        </> : stage === 4 ? <>
          <button className="button-secondary" disabled={!formEditable || !judgmentProjection} onClick={saveJudgment}>{busy ? "正在保存…" : "保存推理逻辑"}</button>
          {artifact && artifact.status !== "failed" ? (
            <button className="button-secondary" disabled={busy || !canApprove} onClick={() => call(`/api/runs/${runId}/artifacts/${artifact.id}/approve`, { method: "POST" })}>确认并进入下一阶段</button>
          ) : null}
        </> : artifact && artifact.status !== "failed" ? <>
          <button className="button-secondary" disabled={busy} onClick={saveJson}>保存结构化内容</button>
          <button className="button-secondary" disabled={busy || artifact.status !== "needs_review"} onClick={() => call(`/api/runs/${runId}/artifacts/${artifact.id}/approve`, { method: "POST" })}>确认并进入下一阶段</button>
        </> : null}
      </div>
      <span className="workspace-status">{statusText}</span>
    </div>
    {!unlocked && <div className="notice">当前阶段已锁定。请先完成并确认上一阶段。</div>}
    {activeJob && artifact?.status !== "running" ? <div className={`notice generation-progress${jobNeedsAttention ? " generation-progress-stale" : ""}`}><strong>{researchJobStatusLabel(activeJob.status)}</strong><p>后台任务第 {activeJob.attempt}/{activeJob.max_attempts} 次尝试。{activeJob.status === "queued" ? "worker 将在取得租约后开始生成。" : activeJob.status === "retrying" ? "上次执行中断，将从本阶段起点安全重试。" : activeJob.status === "waiting_for_input" ? "冻结的上游输入已变化或证据条件不足，请检查后重新提交。" : activeJob.status === "blocked" ? "已达到重试上限，需要人工检查错误后重新提交。" : ""}</p>{activeJob.last_error ? <p className="muted">{activeJob.last_error}</p> : null}</div> : null}
    {error && <div className="notice error">{error}</div>}
    {artifact?.status === "running" ? (
      <div className={`notice generation-progress${progressStale ? " generation-progress-stale" : ""}`}>
        <strong>{progressStale ? "超过 3 分钟无进度更新，可能卡住；可取消后重试" : "模型持续工作中"}</strong>
        <p>
          已运行 {formatElapsedMs(Number.isFinite(liveElapsedMs) ? liveElapsedMs : 0)}
          {progress?.auto_round ? ` · 补证第 ${progress.auto_round}/${progress.max_auto_rounds || "?"} 轮` : ""}
          {progress?.round ? ` · 第 ${progress.round}/${progress.max_rounds || "?"} 轮` : ""}
          {typeof progress?.coverage_rate === "number" ? ` · 覆盖率 ${(progress.coverage_rate * 100).toFixed(0)}%` : ""}
          {typeof progress?.verification_rate === "number" ? ` · 核验率 ${(progress.verification_rate * 100).toFixed(0)}%` : ""}
          {progress?.last_tool ? ` · 最近工具 ${progress.last_tool}` : ""}
        </p>
        <p className="muted">{progress?.message || "已开始生成，等待首轮模型响应…"}</p>
        {progress?.tool_names?.length ? (
          <p className="muted">已调用：{progress.tool_names.slice(-8).join(", ")}{progress.tool_names.length > 8 ? "…" : ""}</p>
        ) : null}
      </div>
    ) : null}
    {validation && !validation.ok ? (
      <div className="notice structure-validation">
        <strong>确认前校验未通过</strong>
        <p>{validation.summary}</p>
        <ul>
          {validation.issues.map((issue, index) => (
            <li key={`${issue.code}-${index}`}>
              [{issue.severity}]{issue.unit_id ? ` ${issue.unit_id}` : ""} {issue.message}
            </li>
          ))}
        </ul>
        <div className="actions">
          {validation.suggested_patch ? (
            <button type="button" className="button" disabled={busy} onClick={applyStructureSuggestions}>采纳建议并保存</button>
          ) : null}
          <button type="button" className="button-secondary" disabled={busy} onClick={() => setValidation(null)}>返回修改</button>
        </div>
      </div>
    ) : null}
    {stage === 1 ? <div className="two-col">
      <section className="card scope-panel">
        <div className="panel-head"><h2>研究范围</h2><span>四层合同：问题 → 判断 → 时间 → 边界</span></div>
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
        <div className="panel-head"><h2>可读稿</h2><span>由后台结构化内容同步生成，只读</span></div>
        <article className="markdown preview-pane preview-pane-only">
          {md.trim() ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown> : <p className="muted">尚无可读稿。保存研究范围或模型生成后会显示在这里。</p>}
        </article>
      </section>
    </div> : stage === 2 ? <div className="two-col">
      <section className="card scope-panel">
        <div className="panel-head"><h2>研究结构</h2><span>必要证据可手改 · 结构用右下角改稿</span></div>
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
                <p className="muted">日常请用右下角改稿或上方必要证据。直接改 JSON 可覆盖方法登记与变量；保存后会重写可读稿并作废下游。</p>
                <textarea aria-label="结构化内容" className="json-editor" value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} disabled={!formEditable} />
                <button type="button" className="button-secondary" disabled={!formEditable} onClick={saveJson}>保存原始 JSON</button>
              </details> : null}
            </>
          )}
        </div>
      </section>
      <section className="card editor-panel">
        <div className="panel-head"><h2>可读稿</h2><span>由后台结构化内容同步生成，只读</span></div>
        <article className="markdown preview-pane preview-pane-only">
          {md.trim() ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown> : <p className="muted">尚无可读稿。保存研究结构或模型生成后会显示在这里。</p>}
        </article>
      </section>
    </div> : stage === 3 ? <div className="two-col">
      <div className="stage3-left-stack">
        {sourceCoverage ? (
          <SourceCoveragePanel
            runId={runId}
            units={sourceCoverage.units}
            sources={sourceCoverage.sources}
            controlledSources={sourceCoverage.controlledSources}
            coverage={sourceCoverage.coverage}
            boundSourceIds={sourceCoverage.boundSourceIds}
          />
        ) : (
          <section className="card empty-state">
            <h2>先确认研究结构</h2>
            <p className="muted">来源覆盖与补充依赖已确认的判断单元与必要证据。</p>
          </section>
        )}
      </div>
      <section className="card editor-panel">
        <div className="panel-head"><h2>证据准备</h2><span>Stage 03 产出结果，只读</span></div>
        <article className="markdown preview-pane preview-pane-only">
          {md.trim() ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown> : <p className="muted">尚无证据准备结果。生成或补充来源并投影后会显示在这里。</p>}
        </article>
      </section>
    </div> : stage === 4 ? <div className="two-col">
      <section className="card scope-panel">
        <div className="panel-head"><h2>推理核心逻辑</h2><span>结论与推理可手改 · 复杂调整用右下角改稿</span></div>
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
                <p className="muted">日常请用上方推理表单或右下角改稿。直接改 JSON 可覆盖规则评估与推理链；保存后会重写可读稿并作废下游。</p>
                <textarea aria-label="结构化内容" className="json-editor" value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} disabled={!formEditable} />
                <button type="button" className="button-secondary" disabled={!formEditable} onClick={saveJson}>保存原始 JSON</button>
              </details> : null}
            </>
          ) : (
            <section className="card empty-state">
              <h2>先确认研究结构与证据</h2>
              <p className="muted">判断裁决依赖已确认的判断单元与已批准事实。</p>
            </section>
          )}
        </div>
      </section>
      <section className="card editor-panel">
        <div className="panel-head"><h2>可读稿</h2><span>由后台结构化内容同步生成，只读</span></div>
        <article className="markdown preview-pane preview-pane-only">
          {md.trim() ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown> : <p className="muted">尚无可读稿。保存推理逻辑或模型生成后会显示在这里。</p>}
        </article>
      </section>
    </div> : stage === 5 && artifact ? <div className="two-col">
      <section className="card editor-panel">
        <div className="panel-head"><h2>结构化内容</h2><span>权威数据，可编辑后保存</span></div>
        <textarea aria-label="结构化内容" className="json-editor" value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} />
      </section>
      <section className="card editor-panel">
        <div className="panel-head"><h2>可读稿</h2><span>保存结构化内容时自动重写</span></div>
        <article className="markdown preview-pane preview-pane-only">
          {md.trim() ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown> : <p className="muted">尚无可读稿。生成或重新生成后会显示在这里。</p>}
        </article>
      </section>
    </div> : null}
  </>;
}
