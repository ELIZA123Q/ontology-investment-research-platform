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
        ? `工作台导出校验通过：${d.export_rel}（package_kind=workbench_export，不可直接正式发布）`
        : `已导出 ${d.export_rel}；validate_workbench_package 未通过（exit=${d.exit_code}）。请按错误补齐 01—05 追溯链。`,
    );
    router.refresh();
  }

  return (
    <div>
      <button className="button-secondary" disabled={busy || disabled} onClick={publish}>
        {busy ? "导出校验中…" : "导出并校验工作台包"}
      </button>
      {message ? <div className="notice">{message}</div> : null}
      {error ? <div className="notice error">{error}</div> : null}
    </div>
  );
}
