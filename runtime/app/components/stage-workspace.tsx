"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Artifact } from "@/engine/types";

export function StageWorkspace({ runId, stage, artifact, unlocked }: { runId: string; stage: number; artifact?: Artifact; unlocked: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(artifact?.error_message || "");
  const [json, setJson] = useState(artifact?.json_content || "{}");
  const [md, setMd] = useState(artifact?.markdown_content || "");

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
        <button className="button" disabled={busy || !unlocked} onClick={() => call(`/api/runs/${runId}/stages/${stage}/generate`, { method: "POST" })}>{busy ? "模型正在工作…" : artifact ? "生成新版本" : "生成本阶段 →"}</button>
        {artifact && artifact.status !== "failed" && <>
          <button className="button-secondary" disabled={busy} onClick={save}>保存编辑</button>
          <button className="button-secondary" disabled={busy || artifact.status !== "needs_review"} onClick={() => call(`/api/runs/${runId}/artifacts/${artifact.id}/approve`, { method: "POST" })}>确认并进入下一阶段</button>
        </>}
      </div>
      <span className="workspace-status">{artifact ? `VERSION ${artifact.version} · ${artifact.status.toUpperCase()} · ${artifact.model_name || "NO MODEL"}` : "AWAITING FIRST GENERATION"}</span>
    </div>
    {!unlocked && <div className="notice">当前阶段已锁定。请先完成并确认上一阶段。</div>}
    {error && <div className="notice error">{error}</div>}
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
