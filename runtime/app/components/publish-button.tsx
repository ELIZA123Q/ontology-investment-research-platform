"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function PublishButton({ runId, disabled = false }: { runId: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  async function publish() {
    setBusy(true);
    setError("");
    setMessage("");
    const r = await fetch(`/api/runs/${runId}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const d = await r.json();
    setBusy(false);
    if (!r.ok) {
      setError(d.error || "导出正式包失败");
      return;
    }
    const status = String(d.validation_summary?.publish_status || "");
    const rel = d.export_rel || d.validation_summary?.export_rel || "";
    if (d.validation_summary?.publishable || status === "PUBLISHABLE") {
      setMessage(`已导出正式包并通过校验：${rel}（状态 PUBLISHABLE）`);
    } else if (d.validate_ok) {
      setMessage(`已导出正式包：${rel}（状态 ${status || "STAGE_READY"}；尚需补齐正式校验项）`);
    } else {
      setMessage(`已导出正式包：${rel}，正式校验未通过（${status || "RETURN_REQUIRED"}）。请按提示退回修改后重试。`);
    }
    router.refresh();
  }

  return (
    <div>
      <button className="button" disabled={busy || disabled} onClick={publish}>
        {busy ? "正在导出正式包…" : "导出正式发布包"}
      </button>
      {message ? <div className="notice">{message}</div> : null}
      {error ? <div className="notice error">{error}</div> : null}
    </div>
  );
}
