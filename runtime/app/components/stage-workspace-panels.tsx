"use client";

import type { Dispatch, SetStateAction } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ReportMarkdown } from "@/app/components/report-markdown";
import { SourceCoveragePanel } from "@/app/components/source-coverage-panel";
import { researcherMarkdown } from "@/app/lib/researcher-stage-output";
import type { EvidenceSupplementSummary } from "@/skills/gap_detection/supplement_view";
import type {
  Stage3SourceCoverageProps,
  WorkspaceArtifact,
} from "@/app/components/stage-workspace";

export function Stage3WorkspacePanel({
  runId,
  artifact,
  sourceCoverage,
  supplementSummary,
  journey,
  preparationPreview,
  manifestPreview,
}: {
  runId: string;
  artifact?: WorkspaceArtifact;
  sourceCoverage?: Stage3SourceCoverageProps;
  supplementSummary?: EvidenceSupplementSummary;
  journey?: {
    navLabel: string;
    output: string;
    confirmation: string;
    reviewPath: string;
  };
  preparationPreview: string;
  manifestPreview: string;
}) {
  return <div className="two-col">
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
      <div className="panel-head">
        <h2>本阶段交接</h2>
        <span>去{journey?.navLabel || "证据"}页完成确认</span>
      </div>
      <div className="stage-editor-summary-list">
        {supplementSummary ? (
          <div className={`stage-supplement-handoff${supplementSummary.zero_material_change ? " supplement-empty" : ""}`}>
            <div><span>最近一轮补证{artifact?.version ? ` · 第 ${artifact.version} 版` : ""}</span><strong>{supplementSummary.headline}</strong></div>
            <Link href={`/runs/${runId}/evidence?filter=changes#evidence-board`}>筛选本轮变更 →</Link>
          </div>
        ) : null}
        <article className="stage-editor-summary-card">
          <span>本阶段输出</span>
          <h3>{(journey?.output.replace(/\{count\}\s*项\s*/g, "").trim()) || "可核验事实、反证与尚缺的证据"}</h3>
          <p>当前覆盖 {sourceCoverage?.coverage.unit_coverage.length || 0} 个关键判断；仍有 {sourceCoverage?.coverage.coverage_gap_count || 0} 个判断未达到最低证据要求。</p>
          <strong>研究员需要确认</strong>
          <p>{journey?.confirmation || "逐项核对原文、口径、时间与局限；待核对事实只有在证据页确认后，才会进入判断阶段。"}</p>
          <Link className="button" href={`/runs/${runId}${journey?.reviewPath || "/evidence"}`}>打开{journey?.navLabel || "证据"}审阅 →</Link>
        </article>
      </div>
      <details className="structure-advanced">
        <summary>证据准备与审计详情</summary>
        <h3>已保存的证据准备说明</h3>
        <article className="markdown preview-pane preview-pane-only">
          {preparationPreview.trim()
            ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{researcherMarkdown(preparationPreview)}</ReactMarkdown>
            : <p className="muted">尚无证据准备结果。生成或补充来源并投影后会显示在这里。</p>}
        </article>
        <h3>实例清单</h3>
        <pre className="preview-pane preview-pane-only" style={{ whiteSpace: "pre-wrap", fontSize: "12px" }}>
          {manifestPreview.trim() || "尚无实例清单 YAML。保存或生成 Stage03 后会写入 instance_manifest_yaml。"}
        </pre>
      </details>
    </section>
  </div>;
}

export function Stage5WorkspacePanel({
  artifact,
  readerMarkdown,
  rawMarkdown,
  auditPreview,
  json,
  editable,
  showAdvancedJson,
  onReaderMarkdownChange,
  onJsonChange,
  onAdvancedJsonToggle,
  onSaveJson,
}: {
  artifact: WorkspaceArtifact;
  readerMarkdown: string;
  rawMarkdown: string;
  auditPreview: string;
  json: string;
  editable: boolean;
  showAdvancedJson: boolean;
  onReaderMarkdownChange: Dispatch<SetStateAction<string>>;
  onJsonChange: Dispatch<SetStateAction<string>>;
  onAdvancedJsonToggle: (open: boolean) => void;
  onSaveJson: () => void;
}) {
  void artifact;
  return <div className="two-col">
    <section className="card editor-panel">
      <div className="panel-head"><h2>修改报告正文</h2><span>不显示审计编号，可直接编辑</span></div>
      <p className="muted">这里仅编辑读者会看到的内容；结构化判断、证据和来源关系仍保留在审计记录中。</p>
      <textarea
        aria-label="报告正文"
        className="json-editor"
        value={readerMarkdown}
        onChange={(event) => onReaderMarkdownChange(event.target.value)}
        spellCheck
        disabled={!editable}
      />
    </section>
    <section className="card editor-panel">
      <div className="panel-head"><h2>读者预览</h2><span>最终交付效果</span></div>
      <article className="markdown preview-pane preview-pane-only">
        {readerMarkdown.trim()
          ? <ReportMarkdown content={readerMarkdown} />
          : <p className="muted">尚无可读稿。生成或重新生成后会显示在这里。</p>}
      </article>
      <details
        className="structure-advanced"
        open={showAdvancedJson}
        onToggle={(event) => onAdvancedJsonToggle((event.target as HTMLDetailsElement).open)}
      >
        <summary>交付审计与原始内容</summary>
        <h3>原始交付稿</h3>
        <pre className="preview-pane preview-pane-only" style={{ whiteSpace: "pre-wrap", fontSize: "12px" }}>
          {rawMarkdown.trim() || "尚无原始交付稿。"}
        </pre>
        <h3>表达记录</h3>
        <pre className="preview-pane preview-pane-only" style={{ whiteSpace: "pre-wrap", fontSize: "12px" }}>
          {auditPreview.trim() || "尚无表达审计 YAML。保存或生成 Stage05 后会写入 expression_audit_yaml。"}
        </pre>
        <h3>高级：原始 JSON（逃生舱）</h3>
        <p className="muted">日常请编辑可读稿。直接修改 JSON 会按结构化字段重写可读稿。</p>
        <textarea aria-label="结构化内容" className="json-editor" value={json} onChange={(event) => onJsonChange(event.target.value)} spellCheck={false} disabled={!editable} />
        <button type="button" className="button-secondary" disabled={!editable} onClick={onSaveJson}>保存原始 JSON</button>
      </details>
    </section>
  </div>;
}
