"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function IndependentReviewButton({ runId }: { runId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  async function runReview() {
    setBusy(true);
    setError("");
    const response = await fetch(`/api/runs/${runId}/independent-review`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) setError(data.error || "独立审阅失败");
    else router.refresh();
    setBusy(false);
  }

  return (
    <div>
      <button className="button-secondary" disabled={busy} onClick={runReview}>
        {busy ? "独立审阅中…" : "运行独立审阅"}
      </button>
      {error ? <div className="notice error">{error}</div> : null}
    </div>
  );
}
