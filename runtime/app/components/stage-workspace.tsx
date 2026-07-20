"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Artifact } from "@/engine/types";
import { ControlledScopeProjectionForm } from "@/app/components/controlled-projection-forms";

export function StageWorkspace({ runId, question, stage, artifact, unlocked }: { runId: string; question: string; stage: number; artifact?: Artifact; unlocked: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(artifact?.error_message || "");
  const [json, setJson] = useState(artifact?.json_content || "{}");
  const [md, setMd] = useState(artifact?.markdown_content || "");

  useEffect(() => {
    setJson(artifact?.json_content || "{}");
    setMd(artifact?.markdown_content || "");
    setError(artifact?.error_message || "");
  }, [artifact?.id, artifact?.json_content, artifact?.markdown_content, artifact?.error_message]);

  async function call(url: string, options: RequestInit = {}) {
    setBusy(true); setError("");
    try {
      const r = await fetch(url, options); const d = await r.json();
      if (!r.ok) throw new Error(d.error || "操作失败");
      router.refresh(); return d;
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function save() {
    const d = await call(`/api/runs/${runId}/artifacts/${artifact!.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ json_content: json, markdown_content: md }) });
    if (d) { setJson(d.json_content); setMd(d.markdown_content); }
  }

  return <>
    <div className="workspace-toolbar">
      <div className="actions">
        <button className="button" disabled={busy || !unlocked || artifact?.status === "running"} onClick={() => call(`/api/runs/${runId}/stages/${stage}/generate`, { method: "POST" })}>{busy || artifact?.status === "running" ? "模型正在工作…" : artifact ? "生成新版本" : "生成本阶段 →"}</button>
        {artifact?.status === "running" && <button className="button-secondary" onClick={() => call(`/api/runs/${runId}/artifacts/${artifact.id}/cancel`, { method: "POST" })}>取消本次生成</button>}
        {stage === 3 && artifact?.status === "failed" && <button className="button-secondary" disabled={busy} onClick={() => call(`/api/runs/${runId}/stages/03/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "explicit_gap_fallback", reason: "公开来源取得或模型结构化提交失败，人工选择登记显式证据缺口" }) })}>登记为显式证据缺口</button>}
        {stage === 4 && artifact?.status === "failed" && <button className="button-secondary" disabled={busy} onClick={() => call(`/api/runs/${runId}/stages/04/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "explicit_j0_fallback", reason: "上游只有经人工接受的证据缺口，且模型裁决未在硬时限内完成" }) })}>生成受控 J0 判断</button>}
        {artifact && artifact.status !== "failed" && <>
          <button className="button-secondary" disabled={busy} onClick={save}>保存编辑</button>
          <button className="button-secondary" disabled={busy || artifact.status !== "needs_review"} onClick={() => call(`/api/runs/${runId}/artifacts/${artifact.id}/approve`, { method: "POST" })}>确认并进入下一阶段</button>
        </>}
      </div>
      <span className="workspace-status">{artifact ? `VERSION ${artifact.version} · ${artifact.status.toUpperCase()} · ${artifact.model_name || "NO MODEL"}` : "AWAITING FIRST GENERATION"}</span>
    </div>
    {!unlocked && <div className="notice">当前阶段已锁定。请先完成并确认上一阶段。</div>}
    {error && <div className="notice error">{error}</div>}
    {stage === 1 && artifact?.status !== "running" ? <ControlledScopeProjectionForm runId={runId} question={question} existingJson={artifact?.json_content} enabled={unlocked && !busy} /> : null}
    {artifact && <div className="two-col">
      <section className="card editor-panel">
        <div className="panel-head"><h2>结构化真相</h2><span>JSON · Authority</span></div>
        <textarea aria-label="结构化真相 JSON" className="json-editor" value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} />
      </section>
      <section className="card editor-panel">
        <div className="panel-head"><h2>研究表达</h2><span>Markdown · Projection</span></div>
        <textarea aria-label="Markdown 编辑器" className="markdown-editor" value={md} onChange={(e) => setMd(e.target.value)} />
        <article className="markdown preview-pane"><ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown></article>
      </section>
    </div>}
  </>;
}
