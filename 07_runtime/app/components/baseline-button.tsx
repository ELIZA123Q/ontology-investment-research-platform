"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function BaselineButton({
  runId,
  artifactId,
  status = "missing",
  canGenerate = false,
  inFlight = false,
}: {
  runId: string;
  artifactId?: string;
  status?: "missing" | "needs_review" | "approved";
  canGenerate?: boolean;
  inFlight?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  async function call(url: string) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(url, { method: "POST" });
      const d = await r.json();
      if (!r.ok) setError(d.error || "对照基线操作失败");
      else router.refresh();
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      setError(/load failed|failed to fetch/i.test(raw)
        ? "连接中断；请刷新查看是否已在后台生成。"
        : raw);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const completed = status === "approved";
  const needsReview = status === "needs_review";
  const disabled = busy || completed || inFlight || (!needsReview && !canGenerate);
  const label = completed
    ? "同证据基线已确认"
    : needsReview
      ? busy ? "正在确认…" : "确认基线并锁定盲评输入"
      : inFlight
        ? "同证据基线生成中…"
        : !canGenerate
          ? "先确认冻结证据"
          : busy ? "正在提交生成…" : "基于冻结证据生成对照基线";

  return (
    <div>
      <button
        className={needsReview ? "button" : "button-secondary"}
        disabled={disabled}
        onClick={() => call(needsReview && artifactId
          ? `/api/runs/${runId}/artifacts/${artifactId}/approve`
          : `/api/runs/${runId}/baseline`)}
      >
        {label}
      </button>
      {error && <div className="notice error">{error}</div>}
    </div>
  );
}
