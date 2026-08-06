"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function PublishButton({
  runId,
  disabled = false,
  disabledReason = "",
}: {
  runId: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [downloads, setDownloads] = useState<{ delivery?: string; audit?: string }>({});
  const router = useRouter();

  async function publish() {
    setBusy(true);
    setError("");
    setMessage("");
    setDownloads({});
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
    if (d.published || d.validation_summary?.publishable || status === "PUBLISHABLE") {
      setMessage(`发布集 ${d.release_id} 已生成并通过校验：对外交付包与内部审计包已锁定为同一版本。`);
      setDownloads({
        delivery: d.formal_delivery_pack?.download_url,
        audit: d.research_audit_pack?.download_url,
      });
    } else if (d.validate_ok) {
      setMessage(`发布制品已生成（状态 ${status || "STAGE_READY"}），但尚未同时通过交付、审计与知识锁校验。`);
    } else {
      setMessage(`发布制品已生成，正式校验未通过（${status || "RETURN_REQUIRED"}）。请按提示退回修改后重试。`);
    }
    router.refresh();
  }

  return (
    <div>
      <button
        className="button"
        disabled={busy || disabled}
        onClick={publish}
        title={disabled && disabledReason ? disabledReason : undefined}
      >
        {busy ? "正在生成发布制品…" : "生成正式交付与审计包"}
      </button>
      {disabled && disabledReason ? <small className="muted">解锁条件：{disabledReason}</small> : null}
      {message ? <div className="notice">{message}</div> : null}
      {downloads.delivery || downloads.audit ? (
        <div className="actions" style={{ marginTop: 8 }}>
          {downloads.delivery ? <a className="button-secondary" href={downloads.delivery}>下载对外交付包 ↓</a> : null}
          {downloads.audit ? <a className="button-quiet" href={downloads.audit}>下载内部审计包 ↓</a> : null}
        </div>
      ) : null}
      {error ? <div className="notice error">{error}</div> : null}
    </div>
  );
}
