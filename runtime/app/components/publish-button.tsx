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
    const r = await fetch(`/api/runs/${runId}/publish`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const d = await r.json();
    setBusy(false);
    if (!r.ok) {
      setError(d.error || "导出校验失败");
      return;
    }
    setMessage(
      d.validate_ok
        ? `已导出并通过校验：${d.export_rel}（仅供内部验收，不能当作正式发布包）`
        : `已导出 ${d.export_rel}，但交付前校验未通过。请按提示补齐范围→结构→证据→判断→交付的材料。`,
    );
    router.refresh();
  }

  return (
    <div>
      <button className="button-secondary" disabled={busy || disabled} onClick={publish}>
        {busy ? "导出校验中…" : "导出并做交付前校验"}
      </button>
      {message ? <div className="notice">{message}</div> : null}
      {error ? <div className="notice error">{error}</div> : null}
    </div>
  );
}
