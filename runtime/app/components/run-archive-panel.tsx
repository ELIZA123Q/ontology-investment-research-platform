"use client";

import { useEffect, useMemo, useState } from "react";
import type { RunArchive } from "@/engine/run_archive";
import { artifactKindLabel, artifactStatusLabel } from "@/app/lib/ui-labels";

export function RunArchivePanel({ runId, archive }: { runId: string; archive: RunArchive }) {
  const [selectedId, setSelectedId] = useState(archive.files[0]?.id || "");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const selected = useMemo(
    () => archive.files.find((item) => item.id === selectedId) || archive.files[0] || null,
    [archive.files, selectedId],
  );

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setBusy(true);
    setError("");
    fetch(`/api/runs/${runId}/archive/file?fileId=${encodeURIComponent(selected.id)}`)
      .then(async (response) => {
        const text = await response.text();
        if (!response.ok) throw new Error(text || "读取档案失败");
        if (!cancelled) setContent(text);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runId, selected]);

  return (
    <div className="three-col" style={{ gridTemplateColumns: "280px minmax(0,1fr) 280px" }}>
      <aside className="card ontology-list">
        <h3>档案文件（{archive.summary.total_files}）</h3>
        {archive.files.map((file) => (
          <button
            key={file.id}
            className={file.id === selected?.id ? "active" : ""}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              border: 0,
              background: file.id === selected?.id ? "var(--mint)" : "transparent",
              padding: "8px 10px",
              borderRadius: 8,
              cursor: "pointer",
              marginBottom: 4,
            }}
            onClick={() => setSelectedId(file.id)}
          >
            <strong>{file.file_name}</strong>
            <br />
            <small className="muted">{file.title}</small>
          </button>
        ))}
      </aside>
      <section className="card">
        <div className="panel-title">
          <div>
            <span>文件预览</span>
            <strong>{selected?.file_name || "未选择"}</strong>
          </div>
          <a className="button-secondary" href={`/api/runs/${runId}/archive.zip`}>下载整包 ZIP</a>
        </div>
        {busy ? <p className="muted">加载中…</p> : null}
        {error ? <div className="notice error">{error}</div> : null}
        {!busy && !error ? (
          <pre className="json-editor" style={{ minHeight: 460, whiteSpace: "pre-wrap" }}>{content}</pre>
        ) : null}
      </section>
      <aside className="card">
        <h3>元数据</h3>
        {selected ? (
          <dl className="stage-summary-list">
            <div><dt>阶段</dt><dd>{selected.stage}</dd></div>
            <div><dt>标题</dt><dd>{selected.title}</dd></div>
            <div><dt>来源</dt><dd>{selected.source}</dd></div>
            <div><dt>类型</dt><dd>{selected.artifact_kind ? artifactKindLabel(selected.artifact_kind) : "派生文件"}</dd></div>
            <div><dt>版本</dt><dd>{selected.version || "—"}</dd></div>
            <div><dt>状态</dt><dd>{selected.status ? artifactStatusLabel(selected.status) : "—"}</dd></div>
            {selected.artifact_id ? <div><dt>原始下载</dt><dd><a href={`/api/runs/${runId}/artifacts/${selected.artifact_id}/file?format=json`}>JSON</a></dd></div> : null}
          </dl>
        ) : <p className="muted">选择左侧文件查看详情</p>}
      </aside>
    </div>
  );
}
