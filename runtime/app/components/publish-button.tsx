"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PublishButton({ runId }: { runId: string }) {
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
      setError(d.error || "发布校验失败");
      return;
    }
    setMessage(
      d.validate_ok
        ? `导出并校验通过：${d.export_rel}`
        : `已导出 ${d.export_rel}；validate_run 未通过（exit=${d.exit_code}）。这是预期中的工作台缺口提示。`,
    );
    router.refresh();
  }

  return (
    <div>
      <button className="button-secondary" disabled={busy} onClick={publish}>
        {busy ? "导出校验中…" : "导出并 validate_run"}
      </button>
      {message ? <div className="notice">{message}</div> : null}
      {error ? <div className="notice error">{error}</div> : null}
    </div>
  );
}
