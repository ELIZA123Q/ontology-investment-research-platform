"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SourceAcquisitionForm({ runId }: { runId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/runs/${runId}/sources/acquire`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form.entries())),
    });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) {
      setMessage(result.error || result.source?.failure_detail || "来源未通过抓取与引用定位校验");
      router.refresh();
      return;
    }
    setMessage("来源正文、逐字引用与内容指纹已核验；它仍只是证据阶段的候选输入。可在下方手动路径中挂到判断单元并生成待审阅事实草稿。");
    router.refresh();
  }

  return <section className="card source-acquisition">
    <div className="panel-title">
      <div><span>研究者控制的证据入口</span><strong>取得并核验官方公开来源</strong></div>
      <button type="button" className="button-secondary" onClick={() => setOpen((value) => !value)}>{open ? "收起" : "添加来源"}</button>
    </div>
    <p className="muted">系统会实际抓取正文、核对逐字引用并保存时间与 SHA-256。成功也不会直接写成事实或修改判断。</p>
    {open ? <form onSubmit={submit}>
      <div className="source-form-grid">
        <div className="field source-url"><label>公开 URL</label><input name="url" type="url" required /></div>
        <div className="field"><label>来源标题</label><input name="title" required /></div>
        <div className="field"><label>发布者</label><input name="publisher" required /></div>
        <div className="field"><label>发布日期</label><input name="published_at" type="date" required /></div>
        <div className="field"><label>来源等级</label><select name="source_tier" defaultValue="S1"><option>S1</option><option>S2</option><option>S3</option><option>S4</option><option>S5</option><option>S6</option><option>S7</option><option>S8</option></select></div>
        <div className="field"><label>独立来源组（可选）</label><input name="source_group" placeholder="默认使用发布者" /></div>
        <div className="field source-wide"><label>页内定位</label><input name="locator" placeholder="段落标题、表格行或 quote:…" required /></div>
        <div className="field source-wide"><label>正文逐字引用</label><textarea name="source_quote" placeholder="必须能在抓取正文中逐字定位，至少 20 个字符" required /></div>
      </div>
      {message ? <div className="notice">{message}</div> : null}
      <button className="button" disabled={busy}>{busy ? "正在抓取并核验…" : "取得来源并进入候选池"}</button>
    </form> : null}
  </section>;
}
