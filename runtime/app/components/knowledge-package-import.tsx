"use client";

import { useState } from "react";

export function KnowledgePackageImport() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(mode: "validate" | "import") {
    if (!file) return;
    setBusy(true);
    setMessage("");
    setError("");
    const response = await fetch(`/api/knowledge/packages/${mode}`, { method: "POST", body: file });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(data.error || data.errors?.join("；") || "知识包校验失败");
      return;
    }
    setMessage(mode === "validate"
      ? `校验通过：${data.manifest?.package_id || file.name}，可提交知识候选。`
      : `已提交候选：${data.package_id}，状态 ${data.status}。`);
  }

  return (
    <div className="knowledge-import-panel">
      <label className="field">
        <span>上传知识包 ZIP</span>
        <input type="file" accept=".zip,application/zip" onChange={(event) => setFile(event.target.files?.[0] || null)} />
      </label>
      <div className="actions">
        <button className="button-secondary" disabled={!file || busy} onClick={() => submit("validate")}>仅校验</button>
        <button className="button" disabled={!file || busy} onClick={() => submit("import")}>{busy ? "处理中…" : "提交候选"}</button>
      </div>
      <small className="muted">上传只进入候选区，不会覆盖正式知识；正式发布仍需专家审阅。</small>
      {message ? <div className="notice">{message}</div> : null}
      {error ? <div className="notice error">{error}</div> : null}
    </div>
  );
}
